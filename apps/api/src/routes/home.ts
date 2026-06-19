// Home surfaces. /home/neighbors implements the proximity scan (SDD §6):
// discoverable addresses within 2 miles of the active Person, name + approx
// distance only. Coordinates never leave the server. (Geocoding-on-write is M3;
// this reads addresses already geocoded.)

import { Hono } from "hono";
import type { NeighborDTO, NeighborsResponse } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { approxDistance, boundingBox, haversineMiles } from "../lib/geo.js";
import { displayName } from "../lib/privacy.js";

export const home = new Hono<HonoEnv>();

const RADIUS_MILES = 2;

interface Coords { geo_lat: number; geo_lng: number }

home.get("/neighbors", async (c) => {
  const auth = requireAuth(c);
  if (!auth.activePersonId) return c.json<NeighborsResponse>({ addCta: true });

  // The viewer's household group ids (for address cascade + self-exclusion).
  const hhRows = await c.env.DB.prepare(
    `SELECT g.id FROM membership m JOIN grp g ON g.id = m.group_id
     WHERE m.person_id = ? AND g.kind = 'household'`,
  )
    .bind(auth.activePersonId)
    .all<{ id: string }>();
  const householdIds = hhRows.results.map((r) => r.id);

  // Origins: ALL of the Person's own geocoded addresses UNION all of their
  // household(s)' geocoded addresses. A neighbor counts if near ANY origin.
  const originRows = (
    await c.env.DB.prepare(
      `SELECT geo_lat, geo_lng FROM contact_item
       WHERE owner_kind = 'person' AND owner_id = ? AND type = 'address' AND geo_lat IS NOT NULL`,
    )
      .bind(auth.activePersonId)
      .all<Coords>()
  ).results.slice();
  if (householdIds.length) {
    const ph = householdIds.map(() => "?").join(",");
    const hhAddrs = (
      await c.env.DB.prepare(
        `SELECT geo_lat, geo_lng FROM contact_item
         WHERE owner_kind = 'group' AND owner_id IN (${ph}) AND type = 'address' AND geo_lat IS NOT NULL`,
      )
        .bind(...householdIds)
        .all<Coords>()
    ).results;
    originRows.push(...hhAddrs);
  }
  // Dedupe coincident origins (e.g. an own + household copy of the same address).
  const seenOrigin = new Set<string>();
  const origins = originRows.filter((o) => {
    const k = `${o.geo_lat.toFixed(5)},${o.geo_lng.toFixed(5)}`;
    if (seenOrigin.has(k)) return false;
    seenOrigin.add(k);
    return true;
  });
  if (origins.length === 0) return c.json<NeighborsResponse>({ addCta: true });

  // Union bounding box over all origins, then nearest-origin distance.
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const o of origins) {
    const b = boundingBox(o.geo_lat, o.geo_lng, RADIUS_MILES);
    minLat = Math.min(minLat, b.minLat); maxLat = Math.max(maxLat, b.maxLat);
    minLng = Math.min(minLng, b.minLng); maxLng = Math.max(maxLng, b.maxLng);
  }
  const nearest = (lat: number, lng: number): number =>
    Math.min(...origins.map((o) => haversineMiles(o.geo_lat, o.geo_lng, lat, lng)));

  const tagged: (NeighborDTO & { _d: number })[] = [];

  // Person candidates: discoverable, geocoded addresses other than the viewer's
  // and not a co-member of the viewer's household (family isn't a "neighbor").
  const coMemberExclude = householdIds.length
    ? ` AND ci.owner_id NOT IN (SELECT person_id FROM membership WHERE group_id IN (${householdIds.map(() => "?").join(",")}))`
    : "";
  const personRows = await c.env.DB.prepare(
    `SELECT ci.owner_id, ci.geo_lat, ci.geo_lng, p.first_name, p.last_name, p.last_name_visibility
     FROM contact_item ci JOIN person p ON p.id = ci.owner_id
     WHERE ci.owner_kind = 'person' AND ci.type = 'address'
       AND ci.neighbor_discoverable = 1 AND ci.geo_lat IS NOT NULL
       AND ci.owner_id != ?
       AND ci.geo_lat BETWEEN ? AND ? AND ci.geo_lng BETWEEN ? AND ?${coMemberExclude}`,
  )
    .bind(auth.activePersonId, minLat, maxLat, minLng, maxLng, ...householdIds)
    .all<{
      owner_id: string;
      geo_lat: number;
      geo_lng: number;
      first_name: string;
      last_name: string | null;
      last_name_visibility: "full" | "initial";
    }>();
  const seenPerson = new Set<string>();
  for (const r of personRows.results) {
    if (seenPerson.has(r.owner_id)) continue; // a person may have multiple addresses
    const d = nearest(r.geo_lat, r.geo_lng);
    if (d > RADIUS_MILES) continue;
    seenPerson.add(r.owner_id);
    tagged.push({
      id: r.owner_id,
      name: displayName(r.first_name, r.last_name, r.last_name_visibility, false),
      approxDistance: approxDistance(d),
      kind: "person",
      _d: d,
    });
  }

  // Household candidates: discoverable household addresses, excluding the
  // viewer's own household(s).
  const notOwn = householdIds.length ? ` AND ci.owner_id NOT IN (${householdIds.map(() => "?").join(",")})` : "";
  const groupRows = await c.env.DB.prepare(
    `SELECT ci.owner_id, ci.geo_lat, ci.geo_lng, g.name
     FROM contact_item ci JOIN grp g ON g.id = ci.owner_id
     WHERE ci.owner_kind = 'group' AND g.kind = 'household' AND ci.type = 'address'
       AND ci.neighbor_discoverable = 1 AND ci.geo_lat IS NOT NULL
       AND ci.geo_lat BETWEEN ? AND ? AND ci.geo_lng BETWEEN ? AND ?${notOwn}`,
  )
    .bind(minLat, maxLat, minLng, maxLng, ...householdIds)
    .all<{ owner_id: string; geo_lat: number; geo_lng: number; name: string }>();
  const seenGroup = new Set<string>();
  for (const r of groupRows.results) {
    if (seenGroup.has(r.owner_id)) continue;
    const d = nearest(r.geo_lat, r.geo_lng);
    if (d > RADIUS_MILES) continue;
    seenGroup.add(r.owner_id);
    tagged.push({ id: r.owner_id, name: r.name, approxDistance: approxDistance(d), kind: "household", _d: d });
  }

  tagged.sort((a, b) => a._d - b._d);
  return c.json<NeighborsResponse>({ neighbors: tagged.map(({ _d, ...n }) => n) });
});

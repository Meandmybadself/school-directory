// Home surfaces. /home/neighbors implements the proximity scan (SDD §6):
// discoverable addresses within 2 miles of the active Person, name + approx
// distance only. Coordinates never leave the server. (Geocoding-on-write is M3;
// this reads addresses already geocoded.)

import { Hono } from "hono";
import type { NeighborDTO, NeighborsResponse } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { approxDistance, boundingBox, haversineMiles } from "../lib/geo.js";
import { displayName, personListableSql } from "../lib/privacy.js";
import { classroomsByHousehold } from "../lib/serialize.js";

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
  if (origins.length === 0) {
    // No geocoded origin. Only prompt "add your address" if the Person genuinely
    // has NO address at all (own or household). If they have one that simply
    // isn't geocoded yet (pending/unresolvable), show the empty neighbors state
    // instead of telling them to add an address they already have.
    const own = await c.env.DB.prepare(
      "SELECT 1 AS x FROM contact_item WHERE owner_kind = 'person' AND owner_id = ? AND type = 'address' LIMIT 1",
    )
      .bind(auth.activePersonId)
      .first<{ x: number }>();
    let hasAddress = !!own;
    if (!hasAddress && householdIds.length) {
      const ph = householdIds.map(() => "?").join(",");
      const hh = await c.env.DB.prepare(
        `SELECT 1 AS x FROM contact_item WHERE owner_kind = 'group' AND owner_id IN (${ph}) AND type = 'address' LIMIT 1`,
      )
        .bind(...householdIds)
        .first<{ x: number }>();
      hasAddress = !!hh;
    }
    return c.json<NeighborsResponse>(hasAddress ? { neighbors: [] } : { addCta: true });
  }

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
  // Aliased: `contact_item` has an `id` of its own, so a bare one is ambiguous.
  const listable = personListableSql(auth.userId, auth.isSystemAdmin, "p");
  const personRows = await c.env.DB.prepare(
    `SELECT ci.owner_id, ci.geo_lat, ci.geo_lng, p.first_name, p.last_name, p.last_name_visibility
     FROM contact_item ci JOIN person p ON p.id = ci.owner_id
     WHERE ci.owner_kind = 'person' AND ci.type = 'address'
       AND ci.neighbor_discoverable = 1 AND ci.geo_lat IS NOT NULL
       AND ci.owner_id != ?
       AND ci.geo_lat BETWEEN ? AND ? AND ci.geo_lng BETWEEN ? AND ?${coMemberExclude}
       AND ${listable.sql}`,
  )
    .bind(auth.activePersonId, minLat, maxLat, minLng, maxLng, ...householdIds, ...listable.binds)
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

  // The rooms this neighbour's household's children are in — the grade and
  // teacher a parent is scanning these cards for. Both kinds resolve to a
  // HOUSEHOLD: a household card is its own roster, and a person card reads the
  // households that Person belongs to, so a Person in none carries nothing.
  //
  // Two batched reads for the whole row, never one per card. This first one
  // touches `membership` and `grp` and never `person`, so the enumeration gate
  // has nothing to do here — which households a Person is in is not a fact
  // about a Person this viewer might not see, and the cards themselves were
  // already gated above. `classroomsByHousehold` does compose the gate, on the
  // co-members whose rooms it is about to name.
  const personCardIds = tagged.filter((n) => n.kind === "person").map((n) => n.id);
  const householdsOfPerson = new Map<string, string[]>();
  if (personCardIds.length) {
    const hh = await c.env.DB.prepare(
      `SELECT m.person_id, m.group_id
       FROM membership m JOIN grp g ON g.id = m.group_id
       WHERE m.person_id IN (${personCardIds.map(() => "?").join(",")}) AND g.kind = 'household'`,
    )
      .bind(...personCardIds)
      .all<{ person_id: string; group_id: string }>();
    for (const r of hh.results) {
      householdsOfPerson.set(r.person_id, [...(householdsOfPerson.get(r.person_id) ?? []), r.group_id]);
    }
  }
  const lookupIds = [
    ...new Set([
      ...tagged.filter((n) => n.kind === "household").map((n) => n.id),
      ...[...householdsOfPerson.values()].flat(),
    ]),
  ];
  const roomsByHousehold = await classroomsByHousehold(c.env, lookupIds, {
    userId: auth.userId,
    isSystemAdmin: auth.isSystemAdmin,
  });

  const neighbors = tagged.map(({ _d, ...n }) => {
    const ids = n.kind === "household" ? [n.id] : (householdsOfPerson.get(n.id) ?? []);
    // A Person may sit in two households, so the union is deduped by id the way
    // `classroomsByHousehold` dedupes across siblings.
    const rooms: NeighborDTO["classrooms"] = [];
    for (const id of ids) {
      for (const room of roomsByHousehold.get(id) ?? []) {
        if (!rooms.some((x) => x.id === room.id)) rooms.push(room);
      }
    }
    return { ...n, classrooms: rooms };
  });
  return c.json<NeighborsResponse>({ neighbors });
});

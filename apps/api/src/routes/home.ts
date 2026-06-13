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

home.get("/neighbors", async (c) => {
  const auth = requireAuth(c);
  if (!auth.activePersonId) return c.json<NeighborsResponse>({ addCta: true });

  // The active Person's own geocoded address (any visibility — used only as origin).
  const origin = await c.env.DB.prepare(
    `SELECT geo_lat, geo_lng FROM contact_item
     WHERE owner_kind = 'person' AND owner_id = ? AND type = 'address'
       AND geo_lat IS NOT NULL ORDER BY created_at LIMIT 1`,
  )
    .bind(auth.activePersonId)
    .first<{ geo_lat: number; geo_lng: number }>();

  if (!origin) return c.json<NeighborsResponse>({ addCta: true });

  const box = boundingBox(origin.geo_lat, origin.geo_lng, RADIUS_MILES);
  // Candidate discoverable addresses (excluding the viewer's own), pre-filtered by box.
  const rows = await c.env.DB.prepare(
    `SELECT ci.owner_id, ci.geo_lat, ci.geo_lng,
            p.first_name, p.last_name, p.last_name_visibility
     FROM contact_item ci JOIN person p ON p.id = ci.owner_id
     WHERE ci.owner_kind = 'person' AND ci.type = 'address'
       AND ci.neighbor_discoverable = 1 AND ci.geo_lat IS NOT NULL
       AND ci.owner_id != ?
       AND ci.geo_lat BETWEEN ? AND ? AND ci.geo_lng BETWEEN ? AND ?`,
  )
    .bind(auth.activePersonId, box.minLat, box.maxLat, box.minLng, box.maxLng)
    .all<{
      owner_id: string;
      geo_lat: number;
      geo_lng: number;
      first_name: string;
      last_name: string | null;
      last_name_visibility: "full" | "initial" | "hidden";
    }>();

  const neighbors: (NeighborDTO & { _d: number })[] = [];
  for (const r of rows.results) {
    const d = haversineMiles(origin.geo_lat, origin.geo_lng, r.geo_lat, r.geo_lng);
    if (d > RADIUS_MILES) continue;
    neighbors.push({
      id: r.owner_id,
      name: displayName(r.first_name, r.last_name, r.last_name_visibility, false),
      approxDistance: approxDistance(d),
      kind: "person",
      _d: d,
    });
  }
  neighbors.sort((a, b) => a._d - b._d);

  return c.json<NeighborsResponse>({
    neighbors: neighbors.map(({ _d, ...n }) => n),
  });
});

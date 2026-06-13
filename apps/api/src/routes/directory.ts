// The members-only directory: every authenticated member can see every Person's
// name (first name always; last name per the owner's rule) and capabilities.
// Contact details are NOT listed here — those live on the privacy-filtered
// profile. Search is by name.

import { Hono } from "hono";
import type { Capability, PersonSummaryDTO } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { displayName } from "../lib/privacy.js";

export const directory = new Hono<HonoEnv>();

const PAGE = 50;

directory.get("/", async (c) => {
  const auth = requireAuth(c);
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const offset = Math.max(0, Number.parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const like = `%${q}%`;

  // Persons the viewer controls (they see their own full names).
  const controlledRows = await c.env.DB.prepare("SELECT person_id FROM control WHERE user_id = ?")
    .bind(auth.userId)
    .all<{ person_id: string }>();
  const controlled = new Set(controlledRows.results.map((r) => r.person_id));

  const whereSql = q
    ? "WHERE lower(first_name) LIKE ? OR lower(coalesce(last_name,'')) LIKE ?"
    : "";
  const whereBinds = q ? [like, like] : [];

  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM person ${whereSql}`)
    .bind(...whereBinds)
    .first<{ n: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT id, first_name, last_name, last_name_visibility, photo_object_key
     FROM person ${whereSql}
     ORDER BY first_name COLLATE NOCASE, last_name COLLATE NOCASE, id
     LIMIT ? OFFSET ?`,
  )
    .bind(...whereBinds, PAGE, offset)
    .all<{
      id: string;
      first_name: string;
      last_name: string | null;
      last_name_visibility: "full" | "initial";
      photo_object_key: string | null;
    }>();

  // Batch capability grants for the page in one query.
  const ids = rows.results.map((r) => r.id);
  const caps = new Map<string, Capability[]>();
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const capRows = await c.env.DB.prepare(
      `SELECT person_id, capability FROM capability_grant WHERE person_id IN (${placeholders})`,
    )
      .bind(...ids)
      .all<{ person_id: string; capability: Capability }>();
    for (const r of capRows.results) {
      const arr = caps.get(r.person_id) ?? [];
      arr.push(r.capability);
      caps.set(r.person_id, arr);
    }
  }

  const people: PersonSummaryDTO[] = rows.results.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    displayName: displayName(r.first_name, r.last_name, r.last_name_visibility, controlled.has(r.id)),
    capabilities: caps.get(r.id) ?? [],
    photoUrl: r.photo_object_key ? `/photos/${r.photo_object_key}` : null,
  }));

  return c.json({ people, total: totalRow?.n ?? 0, offset, pageSize: PAGE });
});

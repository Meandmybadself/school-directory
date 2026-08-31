// The members-only directory: every authenticated member can see every Person's
// name (first name always; last name per the owner's rule) and capabilities.
// Contact details are NOT listed here — those live on the privacy-filtered
// profile. Search is by name, narrowed by capability.

import { Hono } from "hono";
import { CAPABILITIES } from "@sd/shared";
import type { Capability, PersonSummaryDTO } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { displayName, personSearchSql } from "../lib/privacy.js";

export const directory = new Hono<HonoEnv>();

const PAGE = 50;

/** Capability codes asked for, as `?capability=teacher&capability=staff` or one
 *  comma-separated `?capability=teacher,staff`. No code asked for is no filter.
 *
 *  A code that isn't a capability is reported rather than dropped, and the route
 *  answers it with a 400: dropping it would serve a listing WIDER than the one
 *  asked for while looking like it had been filtered, and a filter that quietly
 *  doesn't apply is the failure worth being loud about. The client only ever
 *  sends codes from `CAPABILITIES`, so only a hand-edited URL reaches this.
 *
 *  Unlike a name, a capability carries no display rule: every one a Person holds
 *  is rendered as a tag on the very row this selects, so matching on it tells a
 *  member nothing the response wasn't already going to show them (invariant 18).
 *  Whether the Person may be enumerated at all is a different question, and
 *  stays the `personSearchSql` term this only ever narrows. */
function requestedCapabilities(raw: string[]): { caps: Capability[]; invalid: boolean } {
  const asked = [...new Set(raw.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean))];
  const caps = asked.filter((x): x is Capability => CAPABILITIES.includes(x as Capability));
  return { caps, invalid: caps.length !== asked.length };
}

directory.get("/", async (c) => {
  const auth = requireAuth(c);
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const offset = Math.max(0, Number.parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const { caps: roles, invalid } = requestedCapabilities(c.req.queries("capability") ?? []);
  if (invalid) return c.json({ error: "invalid_capability" }, 400);

  // Persons the viewer controls (they see their own full names).
  const controlledRows = await c.env.DB.prepare("SELECT person_id FROM control WHERE user_id = ?")
    .bind(auth.userId)
    .all<{ person_id: string }>();
  const controlled = new Set(controlledRows.results.map((r) => r.person_id));

  // Searching a surname the viewer isn't allowed to READ would confirm it by
  // omission, so the predicate carries the display rule — and, since 0018, the
  // enumeration gate that hides an unlisted Person. Both statements below use
  // it: the COUNT leaks the same bits as the page does.
  //
  // The WHERE is unconditional now. It used to be dropped for an empty query,
  // which was fine when "no query" meant "no predicate"; it no longer does, and
  // an unfiltered listing is exactly where an unlisted Person must not appear.
  const search = personSearchSql(q, auth.userId, auth.isSystemAdmin);

  // Several selected roles read as OR — "show me teachers and staff" — so the
  // filter is one `IN`, and a Person holding any of them matches once. It only
  // ever narrows what `search` already allows; both statements below take both
  // terms, because a total that ignored either would page past the end of the
  // list the member can actually see.
  //
  // Deliberately spelled as a trailing ` AND …` fragment appended INSIDE each
  // template rather than folded with `search` into one `where` local: the
  // invariant-21 tripwire (test/personListable.test.ts) reads the statement text
  // and follows `${x.sql}` back to `personSearchSql`, so hiding the gate behind a
  // second local would read to it as an unguarded listing. Keeping `${search.sql}`
  // in the statement keeps the scan honest about what this route does.
  const filter = roles.length
    ? {
        sql: ` AND id IN (SELECT person_id FROM capability_grant WHERE capability IN (${roles
          .map(() => "?")
          .join(",")}))`,
        binds: roles as unknown[],
      }
    : { sql: "", binds: [] as unknown[] };
  const binds = [...search.binds, ...filter.binds];

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM person WHERE ${search.sql}${filter.sql}`,
  )
    .bind(...binds)
    .first<{ n: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT id, first_name, last_name, last_name_visibility, photo_object_key
     FROM person WHERE ${search.sql}${filter.sql}
     ORDER BY first_name COLLATE NOCASE, last_name COLLATE NOCASE, id
     LIMIT ? OFFSET ?`,
  )
    .bind(...binds, PAGE, offset)
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

// Anonymous volunteer-sheet reads — the public page at calendar.eisenhower.school/v/:slug.
//
// Deliberately unauthenticated, the same way routes/calendarPublic.ts,
// routes/ics.ts and routes/newsletterPublic.ts are: no handler here calls
// requireAuth, and that absence IS the mechanism. Grep this file for
// `requireAuth` and finding nothing is the point.
//
// What makes this route different from its member twin is not the query — it's
// the same rows — but `publicSheetOf`, which drops every volunteer's name and
// leaves only a filled count. A sheet's URL is human-readable and therefore
// enumerable, exactly like a newsletter issue's, so the rule from invariant 1
// applies with full force here: nothing member-private may ever reach this
// response. If you are adding a field and it names, identifies or contacts a
// member, it does not belong on this side of the seam.
//
// There is no write route here on purpose. Claiming a spot requires a session
// (routes/volunteers.ts); this file is read-only and always will be.

import { Hono } from "hono";
import type { HonoEnv } from "../env.js";
import { loadPublicSheet } from "../lib/volunteers.js";

export const volunteersPublic = new Hono<HonoEnv>();

/** GET /volunteers-public/sheets/:slug — one PUBLISHED sheet, narrowed.
 *
 *  A draft resolves to 404, so guessing the slug of a sheet an admin is still
 *  building reveals nothing — the same posture the newsletter archive takes
 *  toward an unsent issue. */
volunteersPublic.get("/sheets/:slug", async (c) => {
  const sheet = await loadPublicSheet(c.env, c.req.param("slug"));
  if (!sheet) return c.json({ error: "not_found" }, 404);
  return c.json({ sheet });
});

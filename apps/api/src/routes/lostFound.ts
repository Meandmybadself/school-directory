// Lost & found, the staff half. Every route needs a session AND the roster gate
// (`lostFoundAccess`, the `rosterAccess` PTO and the newsletter share —
// invariant 31), except `/access`, which must answer a member who isn't staff
// or the app has nothing to show but a spinner, and the two settings routes,
// which are system-admin only.
//
// CROSS-SITE WRITES. `sd_session` is SameSite=Lax, which says nothing between
// sibling subdomains: a form on any *.eisenhower.school page would carry it.
// So every write here must arrive with a Content-Type a plain form can't send
// — `application/json`, or `image/jpeg` for photos — which makes the browser
// preflight it against ALLOWED_ORIGINS first (`requireNonFormWrite` below).
// The actions that need no input still send `{}` for exactly this reason: a
// body-less POST to /publish would otherwise be one hidden form away from
// putting a held photo of a child's name online.
//
// Photos arrive as RAW bodies, the way /newsletter/media takes them, not as
// multipart. The client sends the full photo, then a small thumbnail, and the
// thumbnail is what the model looks at.
//
// AUDIT ORDERING. Drafts are pushed the moment the write commits, before the
// reload that builds the response (invariant 22's rule).

import { Hono } from "hono";
import type { Context } from "hono";
import type { AuthContext, HonoEnv } from "../env.js";
import { setSetting } from "../lib/db.js";
import { ulid } from "../lib/ids.js";
import {
  LOSTFOUND_GROUP_SETTING,
  STAFF_ITEM_SELECT,
  claimOf,
  cleanFields,
  cleanText,
  deleteItem,
  getStaffItem,
  lostFoundAccess,
  markPending,
  retagStuck,
  saveFields,
  staffItemOf,
  versionedKey,
  syncVector,
  tagItem,
  type LfClaimRow,
  type LfStaffRow,
} from "../lib/lostFound.js";
import { genericGroups, groupExists } from "../lib/rosterGate.js";
import { DAYS, nowIso } from "../lib/time.js";
import { LF_DONATE_AFTER_DAYS } from "@sd/shared";

const JPEG = "image/jpeg";
/** Most items one `?ids=` read returns. A batch bigger than this simply polls
 *  in slices; D1's 100-parameter ceiling is the hard limit behind it. */
const LF_IDS_MAX = 50;
import { requireAuth } from "../middleware/session.js";

export const lostFound = new Hono<HonoEnv>();

/** Refuse any write whose body type a cross-site form could send. See the header. */
lostFound.use("*", async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return next();
  const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json" && type !== JPEG) return c.json({ error: "unsupported_type" }, 415);
  return next();
});

class LfForbidden extends Error {}

/** Session + the lost & found roster. Every route below but three starts here. */
async function requireStaff(c: Context<HonoEnv>): Promise<AuthContext> {
  const auth = requireAuth(c);
  if (!(await lostFoundAccess(c.env, auth)).canUse) throw new LfForbidden();
  return auth;
}

/** Turn the gate's refusal into a 403. "No session" falls through to the
 *  app-level 401, which is answered identically everywhere in this API. */
function guarded(fn: (c: Context<HonoEnv>) => Promise<Response>) {
  return async (c: Context<HonoEnv>): Promise<Response> => {
    try {
      return await fn(c);
    } catch (err) {
      if (err instanceof LfForbidden) return c.json({ error: "forbidden" }, 403);
      throw err;
    }
  };
}

const param = (c: Context<HonoEnv>, name: string) => c.req.param(name) ?? "";
const originOf = (c: Context<HonoEnv>) => new URL(c.req.url).origin;

/** The current staff view of one item, or a 404. */
async function itemResponse(c: Context<HonoEnv>, id: string): Promise<Response> {
  const row = await getStaffItem(c.env, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(staffItemOf(row, originOf(c)));
}

// ── Access and settings ─────────────────────────────────────────────────────

/** GET /lostfound/access — may this member run the lost & found? Session only. */
lostFound.get(
  "/access",
  guarded(async (c) => c.json(await lostFoundAccess(c.env, requireAuth(c)))),
);

/** GET /lostfound/groups — the groups a system admin may name as staff. */
lostFound.get(
  "/groups",
  guarded(async (c) => {
    if (!requireAuth(c).isSystemAdmin) return c.json({ error: "forbidden" }, 403);
    return c.json({ groups: await genericGroups(c.env) });
  }),
);

/** PUT /lostfound/settings { groupId } — name (or clear) the staff group. */
lostFound.put(
  "/settings",
  guarded(async (c) => {
    const auth = requireAuth(c);
    if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<{ groupId?: string | null }>().catch(() => null);
    const groupId = body?.groupId ? String(body.groupId) : "";
    if (groupId && !(await groupExists(c.env, groupId))) {
      return c.json({ error: "invalid", message: "No such group." }, 400);
    }
    await setSetting(c.env, LOSTFOUND_GROUP_SETTING, groupId);
    c.var.audit.push({
      action: "lostfound.staff.configured",
      entityKind: "setting",
      entityId: LOSTFOUND_GROUP_SETTING,
      detail: { groupId: groupId || null },
    });
    return c.json(await lostFoundAccess(c.env, auth));
  }),
);

// ── Photos ──────────────────────────────────────────────────────────────────

/** GET /lostfound/media/:key — any item's photo, held and hidden included, for
 *  staff. `private`: the response depends on who asked. The cookie rides an
 *  ordinary <img src> because every SPA is a same-site subdomain, as /photos
 *  relies on. */
lostFound.get(
  "/media/:key",
  guarded(async (c) => {
    await requireStaff(c);
    const obj = await c.env.LOSTFOUND_MEDIA.get(param(c, "key"));
    if (!obj) return c.json({ error: "not_found" }, 404);
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    headers.set("cache-control", "private, max-age=3600");
    return new Response(obj.body, { headers });
  }),
);

// ── Items ───────────────────────────────────────────────────────────────────

/** GET /lostfound/items?status=found|returned  or  ?view=review|attention|hidden
 *  or  ?ids=a,b,c (up to LF_IDS_MAX, any state — the rapid-add screen's one
 *  status check for a whole batch, instead of a poll per photo).
 *  "found" is what the public sees; "review" is what's held back from it. */
lostFound.get(
  "/items",
  guarded(async (c) => {
    await requireStaff(c);
    const status = c.req.query("status");
    const view = c.req.query("view");
    let where = "i.status = 'found' AND i.hidden_at IS NULL AND i.held_at IS NULL";
    if (status === "returned") where = "i.status = 'returned'";
    else if (view === "review") where = "i.status = 'found' AND i.hidden_at IS NULL AND i.held_at IS NOT NULL";
    else if (view === "hidden") where = "i.status = 'found' AND i.hidden_at IS NOT NULL";
    const binds: string[] = [];
    const ids = (c.req.query("ids") ?? "").split(",").filter(Boolean).slice(0, LF_IDS_MAX);
    if (ids.length) {
      where = `i.id IN (${ids.map(() => "?").join(",")})`;
      binds.push(...ids);
    } else if (view === "attention") {
      // Failed descriptions, and anything unclaimed long enough to donate —
      // in SQL, so the oldest items (the ones due) can't fall off the LIMIT.
      where = "i.status = 'found' AND (i.tag_status = 'failed' OR i.found_at < ?)";
      binds.push(new Date(Date.now() - LF_DONATE_AFTER_DAYS * DAYS).toISOString());
    }
    const { results } = await c.env.DB.prepare(`${STAFF_ITEM_SELECT} WHERE ${where} ORDER BY i.found_at DESC LIMIT 300`)
      .bind(...binds)
      .all<LfStaffRow>();
    return c.json({ items: results.map((row) => staffItemOf(row, originOf(c))) });
  }),
);

/** GET /lostfound/items/:id — one item with every claim on it. */
lostFound.get(
  "/items/:id",
  guarded(async (c) => {
    await requireStaff(c);
    const row = await getStaffItem(c.env, param(c, "id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM lf_claim WHERE item_id = ? ORDER BY created_at DESC",
    )
      .bind(row.id)
      .all<LfClaimRow>();
    const thumbKey = row.thumb_key ?? row.photo_key;
    return c.json({
      ...staffItemOf(row, originOf(c)),
      claims: results.map((cl) => claimOf({ ...cl, item_title: row.title, thumb_key: thumbKey }, originOf(c))),
    });
  }),
);

const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const MAX_THUMB_BYTES = 1024 * 1024;

/** The body as JPEG bytes, or an error response. The browser re-encodes every
 *  photo through a canvas before upload, so JPEG is the only type accepted —
 *  and checking the magic bytes, not just the header, keeps the public media
 *  route from ever serving something that merely claimed to be one. */
async function readJpeg(c: Context<HonoEnv>, maxBytes: number): Promise<ArrayBuffer | Response> {
  const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
  if (type !== JPEG) return c.json({ error: "unsupported_type" }, 415);
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty" }, 400);
  if (body.byteLength > maxBytes) return c.json({ error: "too_large" }, 413);
  const head = new Uint8Array(body, 0, 3);
  if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return c.json({ error: "unsupported_type" }, 415);
  return body;
}

/** POST /lostfound/items?location= — raw JPEG body (the full-size photo). The
 *  item starts HELD; the model releases it if it reads no writing on it
 *  (invariant 33). */
lostFound.post(
  "/items",
  guarded(async (c) => {
    const auth = await requireStaff(c);
    const photo = await readJpeg(c, MAX_PHOTO_BYTES);
    if (photo instanceof Response) return photo;

    const id = ulid();
    const photoKey = `${id}.jpg`;
    await c.env.LOSTFOUND_MEDIA.put(photoKey, photo, { httpMetadata: { contentType: JPEG } });
    const now = nowIso();
    const location = cleanText(c.req.query("location"), 120);
    try {
      await c.env.DB.prepare(
        `INSERT INTO lf_item (id, photo_key, location, search_text, held_at, found_at, created_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        // Held from the first moment: nobody has looked at the photo yet.
        .bind(id, photoKey, location, location.toLowerCase(), now, now, auth.userId, now)
        .run();
    } catch (err) {
      await c.env.LOSTFOUND_MEDIA.delete(photoKey);
      throw err;
    }
    c.var.audit.push({ action: "lostfound.item.created", entityKind: "lf_item", entityId: id });
    const row = await getStaffItem(c.env, id);
    return c.json(staffItemOf(row!, originOf(c)), 201);
  }),
);

/** PUT /lostfound/items/:id/thumb — raw JPEG thumbnail; starts the description
 *  the first time. Sent again after a rotation, under a fresh key. */
lostFound.put(
  "/items/:id/thumb",
  guarded(async (c) => {
    await requireStaff(c);
    const row = await getStaffItem(c.env, param(c, "id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    const thumb = await readJpeg(c, MAX_THUMB_BYTES);
    if (thumb instanceof Response) return thumb;

    const thumbKey = versionedKey(row.id, true);
    await c.env.LOSTFOUND_MEDIA.put(thumbKey, thumb, { httpMetadata: { contentType: JPEG } });
    await c.env.DB.prepare("UPDATE lf_item SET thumb_key = ?, updated_at = ? WHERE id = ?")
      .bind(thumbKey, nowIso(), row.id)
      .run();
    if (row.thumb_key && row.thumb_key !== thumbKey) await c.env.LOSTFOUND_MEDIA.delete(row.thumb_key);
    // Described after responding, so staff can keep photographing. A Worker
    // that dies mid-call leaves the item pending; the daily sweep retries it.
    if (row.tag_status === "pending") c.executionCtx.waitUntil(tagItem(c.env, row.id, thumb));
    return c.json({ ok: true });
  }),
);

/** PUT /lostfound/items/:id/photo — raw JPEG; replaces the full-size photo.
 *  The staff app sends it only to ROTATE a photo (then the thumbnail, via the
 *  route above). It moves no state: the hold stays where it was, because a
 *  staff member who could swap the picture here could equally press Publish —
 *  the roster is what's trusted with the photo, not this route. */
lostFound.put(
  "/items/:id/photo",
  guarded(async (c) => {
    await requireStaff(c);
    const row = await getStaffItem(c.env, param(c, "id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    const photo = await readJpeg(c, MAX_PHOTO_BYTES);
    if (photo instanceof Response) return photo;

    const photoKey = versionedKey(row.id, false);
    await c.env.LOSTFOUND_MEDIA.put(photoKey, photo, { httpMetadata: { contentType: JPEG } });
    await c.env.DB.prepare("UPDATE lf_item SET photo_key = ?, updated_at = ? WHERE id = ?")
      .bind(photoKey, nowIso(), row.id)
      .run();
    await c.env.LOSTFOUND_MEDIA.delete(row.photo_key);
    c.var.audit.push({
      action: "lostfound.item.updated",
      entityKind: "lf_item",
      entityId: row.id,
      detail: { photo: "replaced" },
    });
    return itemResponse(c, row.id);
  }),
);

/** PATCH /lostfound/items/:id — staff's own description, sent whole. Saving
 *  marks the item described, so a model call still in flight is discarded
 *  rather than written over these edits. */
lostFound.patch(
  "/items/:id",
  guarded(async (c) => {
    await requireStaff(c);
    const id = param(c, "id");
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const fields = cleanFields(body);
    if (!fields.title) return c.json({ error: "invalid", message: "A title is required." }, 400);
    if (!(await saveFields(c.env, id, fields, { location: cleanText(body.location, 120) }))) {
      return c.json({ error: "not_found" }, 404);
    }
    // Field names only: the values may include what was written on the item.
    c.var.audit.push({ action: "lostfound.item.updated", entityKind: "lf_item", entityId: id });
    c.executionCtx.waitUntil(syncVector(c.env, id));
    return itemResponse(c, id);
  }),
);

/** A one-way transition guarded in SQL: a repeat changes nothing and records
 *  nothing (an append-only log must not be paddable by a double tap). `sql`
 *  takes ?1 = now and ?2 = the item id. */
function transition(
  path: string,
  action:
    | "lostfound.item.published"
    | "lostfound.item.hidden"
    | "lostfound.item.unhidden"
    | "lostfound.item.returned"
    | "lostfound.item.restored",
  sql: string,
  after?: (c: Context<HonoEnv>, id: string) => D1PreparedStatement[],
) {
  lostFound.post(
    path,
    guarded(async (c) => {
      await requireStaff(c);
      const id = param(c, "id");
      const now = nowIso();
      const res = await c.env.DB.prepare(sql).bind(now, id).run();
      if ((res.meta?.changes ?? 0) > 0) {
        if (after) await c.env.DB.batch(after(c, id));
        c.var.audit.push({ action, entityKind: "lf_item", entityId: id });
        c.executionCtx.waitUntil(syncVector(c.env, id));
      }
      return itemResponse(c, id);
    }),
  );
}

// Staff have looked at the photo and it shows no name (or they retook it).
transition(
  "/items/:id/publish",
  "lostfound.item.published",
  "UPDATE lf_item SET held_at = NULL, updated_at = ?1 WHERE id = ?2 AND held_at IS NOT NULL",
);
transition(
  "/items/:id/hide",
  "lostfound.item.hidden",
  "UPDATE lf_item SET hidden_at = ?1, updated_at = ?1 WHERE id = ?2 AND hidden_at IS NULL",
);
transition(
  "/items/:id/unhide",
  "lostfound.item.unhidden",
  "UPDATE lf_item SET hidden_at = NULL, updated_at = ?1 WHERE id = ?2 AND hidden_at IS NOT NULL",
);
transition(
  "/items/:id/return",
  "lostfound.item.returned",
  "UPDATE lf_item SET status = 'returned', returned_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'found'",
  // Its open claims are settled by the return — whoever it went home with.
  (c, id) => [
    c.env.DB.prepare(
      "UPDATE lf_claim SET resolved_at = ?, resolution = 'returned' WHERE item_id = ? AND resolved_at IS NULL",
    ).bind(nowIso(), id),
  ],
);
transition(
  "/items/:id/restore",
  "lostfound.item.restored",
  "UPDATE lf_item SET status = 'found', returned_at = NULL, updated_at = ?1 WHERE id = ?2 AND status = 'returned'",
);

/** POST /lostfound/items/:id/retag — ask the model again (replaces the description). */
lostFound.post(
  "/items/:id/retag",
  guarded(async (c) => {
    await requireStaff(c);
    const id = param(c, "id");
    const row = await getStaffItem(c.env, id);
    if (!row) return c.json({ error: "not_found" }, 404);
    await markPending(c.env, id);
    c.var.audit.push({ action: "lostfound.item.retagged", entityKind: "lf_item", entityId: id });
    c.executionCtx.waitUntil(tagItem(c.env, id));
    return itemResponse(c, id);
  }),
);

/** DELETE /lostfound/items/:id — gone for good: row, claims, photos, vector. */
lostFound.delete(
  "/items/:id",
  guarded(async (c) => {
    await requireStaff(c);
    const row = await getStaffItem(c.env, param(c, "id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    await deleteItem(c.env, row);
    c.var.audit.push({ action: "lostfound.item.deleted", entityKind: "lf_item", entityId: row.id });
    return c.json({ ok: true });
  }),
);

// ── Claims ──────────────────────────────────────────────────────────────────

/** GET /lostfound/claims — open claims, oldest first (the queue). */
lostFound.get(
  "/claims",
  guarded(async (c) => {
    await requireStaff(c);
    const { results } = await c.env.DB.prepare(
      `SELECT cl.*, i.title AS item_title, COALESCE(i.thumb_key, i.photo_key) AS thumb_key
         FROM lf_claim cl JOIN lf_item i ON i.id = cl.item_id
        WHERE cl.resolved_at IS NULL
        ORDER BY cl.created_at ASC`,
    ).all<LfClaimRow & { item_title: string; thumb_key: string }>();
    return c.json({ claims: results.map((r) => claimOf(r, originOf(c))) });
  }),
);

/** POST /lostfound/claims/:id/dismiss — not theirs, or spam. */
lostFound.post(
  "/claims/:id/dismiss",
  guarded(async (c) => {
    await requireStaff(c);
    const id = param(c, "id");
    const res = await c.env.DB.prepare(
      "UPDATE lf_claim SET resolved_at = ?, resolution = 'dismissed' WHERE id = ? AND resolved_at IS NULL",
    )
      .bind(nowIso(), id)
      .run();
    if ((res.meta?.changes ?? 0) > 0) {
      c.var.audit.push({ action: "lostfound.claim.dismissed", entityKind: "lf_claim", entityId: id });
    }
    return c.json({ ok: true });
  }),
);

/** POST /lostfound/retag-failed — retry a few failed descriptions now, while
 *  staff wait. Not audited, like the model's own writes. */
lostFound.post(
  "/retag-failed",
  guarded(async (c) => {
    await requireStaff(c);
    return c.json({ retried: await retagStuck(c.env, 5) });
  }),
);

// The PTO's planning boards. Every route here requires a session AND membership
// of the PTO board group — there is no anonymous half of this feature and no
// `/pto-public/*` router beside it, unlike the calendar, the newsletter and the
// store. See the header of migration 0024 for why that absence is the design.
//
// The gate is `ptoAccess` in lib/ptoBoard.ts and it is called by `requirePto`
// below, once per request, on every route including the reads. It is written as
// one helper rather than inlined the way routes/store.ts inlines
// `auth.isSystemAdmin`, because unlike that one-line check this is a query with
// a bootstrap case in it, and a second copy would be a second thing to get
// right.
//
// AUDIT ORDERING. Drafts are pushed the moment the write commits, before any
// reload of the board — invariant 22's rule and the reason
// test/volunteerSignupAudit.test.ts exists. Pushing after the reload reads
// naturally and is wrong: the reload can fail on its own, and then a card that
// really did move has no record of moving.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AuthContext, HonoEnv } from "../env.js";
import { setSetting } from "../lib/db.js";
import {
  PtoError,
  addComment,
  assignableRoster,
  boardById,
  boardBySlug,
  boardImpact,
  cardById,
  cardComments,
  commentById,
  createBoard,
  createCard,
  createLabel,
  createList,
  deleteBoard,
  deleteCard,
  deleteComment,
  deleteLabel,
  deleteList,
  eventOptions,
  listBoardId,
  listBoards,
  loadBoard,
  moveCard,
  patchBoard,
  patchCard,
  ptoAccess,
  renameList,
  setAssignees,
  viewerOf,
  PTO_GROUP_SETTING,
} from "../lib/ptoBoard.js";
import { requireAuth } from "../middleware/session.js";

export const pto = new Hono<HonoEnv>();

/** Thrown by `requirePto`, turned into a 403 by `guarded` below. A class rather
 *  than an early `return c.json(...)` so the gate can live inside a helper and
 *  still stop the handler. */
class PtoForbidden extends Error {}

/** Session + PTO-board membership. Every route below starts here. */
async function requirePto(c: Context<HonoEnv>): Promise<AuthContext> {
  const auth = requireAuth(c);
  const access = await ptoAccess(c.env, auth);
  if (!access.canUse) throw new PtoForbidden();
  return auth;
}

/**
 * Wrap a handler so the two errors this feature raises become responses.
 *
 * `UnauthorizedError` deliberately falls through to the app-level `onError` —
 * "no session" is answered identically everywhere in this API and should not
 * grow a second spelling here.
 */
function guarded(fn: (c: Context<HonoEnv>) => Promise<Response>) {
  return async (c: Context<HonoEnv>): Promise<Response> => {
    try {
      return await fn(c);
    } catch (err) {
      if (err instanceof PtoForbidden) return c.json({ error: "forbidden" }, 403);
      if (err instanceof PtoError) return c.json({ error: "invalid", message: err.message }, 400);
      throw err;
    }
  };
}


/**
 * A path parameter, as a string.
 *
 * `c.req.param` is typed against the ROUTE's path, and `guarded` above wraps a
 * handler typed against a bare `Context<HonoEnv>` — so inside a wrapper the
 * compiler no longer knows `:id` is there and widens to `string | undefined`.
 * This restates what the router already guarantees: a route does not match
 * unless its parameters are present.
 */
function param(c: Context<HonoEnv>, name: string): string {
  return c.req.param(name) ?? "";
}

// ── Access ──────────────────────────────────────────────────────────────────

/** GET /pto/access — may this member use the boards?
 *
 *  The ONE route here that does not go through `requirePto`, and it must not:
 *  a member who is not on the PTO board still needs an answer, or the app has
 *  nothing to render but a spinner. It needs a session, and it says nothing a
 *  signed-in member could not already learn — `GET /groups` lets any member see
 *  every group's name (invariant 21 records that as an accepted cost), and the
 *  boolean is about the caller themselves. */
pto.get(
  "/access",
  guarded(async (c) => {
    const auth = requireAuth(c);
    return c.json(await ptoAccess(c.env, auth));
  }),
);

// ── Settings (system admin) ─────────────────────────────────────────────────

/** PUT /pto/settings { groupId } — name the group whose roster may use the
 *  boards.
 *
 *  System admins only, checked with the same inline two lines the rest of this
 *  codebase uses. This is the single lever over who gets in, so it is audited —
 *  `pto.group.configured`, the shape `registration.toggled` already has.
 *
 *  A null groupId clears it, which returns the instance to the bootstrap state
 *  where only system admins are admitted. That is deliberate rather than
 *  refused: an admin who picked the wrong group needs a way back. */
pto.put(
  "/settings",
  guarded(async (c) => {
    const auth = requireAuth(c);
    if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<{ groupId?: string | null }>().catch(() => null);
    const groupId = body?.groupId ? String(body.groupId) : "";

    if (groupId) {
      const group = await c.env.DB.prepare("SELECT id FROM grp WHERE id = ?")
        .bind(groupId)
        .first<{ id: string }>();
      if (!group) return c.json({ error: "invalid", message: "No such group." }, 400);
    }

    await setSetting(c.env, PTO_GROUP_SETTING, groupId);
    c.var.audit.push({
      action: "pto.group.configured",
      entityKind: "setting",
      entityId: PTO_GROUP_SETTING,
      detail: { groupId: groupId || null },
    });
    return c.json(await ptoAccess(c.env, auth));
  }),
);

// ── Boards ──────────────────────────────────────────────────────────────────

/** GET /pto/boards?archived=1 */
pto.get(
  "/boards",
  guarded(async (c) => {
    await requirePto(c);
    const archived = c.req.query("archived") === "1";
    return c.json({ boards: await listBoards(c.env, archived) });
  }),
);

/** POST /pto/boards { title, summary?, managedEventId? } */
pto.post(
  "/boards",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const row = await createBoard(c.env, auth, body);
    c.var.audit.push({
      action: "pto.board.created",
      entityKind: "pto_board",
      entityId: row.id,
      detail: { title: row.title, slug: row.slug },
    });
    const viewer = await viewerOf(c.env, auth);
    return c.json({ board: await loadBoard(c.env, viewer, row) }, 201);
  }),
);

/** GET /pto/boards/:slug — the whole board in one payload. */
pto.get(
  "/boards/:slug",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const row = await boardBySlug(c.env, param(c, "slug"));
    if (!row) return c.json({ error: "not_found" }, 404);
    const viewer = await viewerOf(c.env, auth);
    return c.json({ board: await loadBoard(c.env, viewer, row) });
  }),
);

/** PATCH /pto/boards/:id */
pto.patch(
  "/boards/:id",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const row = await patchBoard(c.env, param(c, "id"), body);
    if (!row) return c.json({ error: "not_found" }, 404);
    c.var.audit.push({
      action: "pto.board.updated",
      entityKind: "pto_board",
      entityId: row.id,
      detail: { title: row.title, archived: row.archived_at !== null },
    });
    const viewer = await viewerOf(c.env, auth);
    return c.json({ board: await loadBoard(c.env, viewer, row) });
  }),
);

/** GET /pto/boards/:id/removal-impact — what a delete would take with it.
 *
 *  Its own route rather than a field on the board, for the reason invariant 25
 *  gives: an ordinary board view shouldn't pay for four counts nobody reads. */
pto.get(
  "/boards/:id/removal-impact",
  guarded(async (c) => {
    await requirePto(c);
    const row = await boardById(c.env, param(c, "id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ impact: await boardImpact(c.env, row.id) });
  }),
);

/** DELETE /pto/boards/:id — permanent, and it takes the cards with it.
 *
 *  Counted BEFORE it happens and the counts go on the audit row, because
 *  afterwards nothing holds them — the same obligation `deleteManagedEvent` and
 *  `DELETE /persons/:id` carry (invariants 13 and 25). Archiving is the
 *  reversible option and is what the UI offers first. */
pto.delete(
  "/boards/:id",
  guarded(async (c) => {
    await requirePto(c);
    const row = await boardById(c.env, param(c, "id"));
    if (!row) return c.json({ error: "not_found" }, 404);

    const impact = await boardImpact(c.env, row.id);
    await deleteBoard(c.env, row.id);
    c.var.audit.push({
      action: "pto.board.deleted",
      entityKind: "pto_board",
      entityId: row.id,
      detail: { title: row.title, slug: row.slug, ...impact },
    });
    return c.json({ ok: true, impact });
  }),
);

// ── Columns ─────────────────────────────────────────────────────────────────

pto.post(
  "/boards/:id/lists",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const board = await boardById(c.env, param(c, "id"));
    if (!board) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<{ title?: unknown }>().catch(() => ({}) as { title?: unknown });
    const id = await createList(c.env, board.id, body.title);
    c.var.audit.push({ action: "pto.list.created", entityKind: "pto_list", entityId: id });
    const viewer = await viewerOf(c.env, auth);
    return c.json({ board: await loadBoard(c.env, viewer, board) }, 201);
  }),
);

pto.patch(
  "/lists/:id",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const boardId = await listBoardId(c.env, param(c, "id"));
    if (!boardId) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<{ title?: unknown }>().catch(() => ({}) as { title?: unknown });
    await renameList(c.env, param(c, "id"), body.title);
    c.var.audit.push({
      action: "pto.list.updated",
      entityKind: "pto_list",
      entityId: param(c, "id"),
    });
    const viewer = await viewerOf(c.env, auth);
    return c.json({ board: await loadBoard(c.env, viewer, (await boardById(c.env, boardId))!) });
  }),
);

/** DELETE /pto/lists/:id — takes its cards with it, counted first. */
pto.delete(
  "/lists/:id",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const boardId = await listBoardId(c.env, param(c, "id"));
    if (!boardId) return c.json({ error: "not_found" }, 404);
    const { cards } = await deleteList(c.env, param(c, "id"));
    c.var.audit.push({
      action: "pto.list.deleted",
      entityKind: "pto_list",
      entityId: param(c, "id"),
      detail: { cards },
    });
    const viewer = await viewerOf(c.env, auth);
    return c.json({ board: await loadBoard(c.env, viewer, (await boardById(c.env, boardId))!) });
  }),
);

// ── Cards ───────────────────────────────────────────────────────────────────

pto.post(
  "/boards/:id/cards",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const board = await boardById(c.env, param(c, "id"));
    if (!board) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const card = await createCard(c.env, auth, board.id, body);
    c.var.audit.push({
      action: "pto.card.created",
      entityKind: "pto_card",
      entityId: card.id,
      detail: { title: card.title, boardId: board.id },
    });
    const viewer = await viewerOf(c.env, auth);
    return c.json({ board: await loadBoard(c.env, viewer, board) }, 201);
  }),
);

pto.patch(
  "/cards/:id",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const card = await cardById(c.env, param(c, "id"));
    if (!card) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    await patchCard(c.env, card, body);
    c.var.audit.push({
      action: "pto.card.updated",
      entityKind: "pto_card",
      entityId: card.id,
      detail: { boardId: card.board_id },
    });
    const viewer = await viewerOf(c.env, auth);
    return c.json({ board: await loadBoard(c.env, viewer, (await boardById(c.env, card.board_id))!) });
  }),
);

/** POST /pto/cards/:id/move { listId, afterCardId?, beforeCardId? }
 *
 *  Re-dropping a card exactly where it already was writes nothing and pushes no
 *  draft — an append-only log must not be paddable by a jittery mouse, the same
 *  silent no-op invariant 27 gives a repeated classroom placement. */
pto.post(
  "/cards/:id/move",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const card = await cardById(c.env, param(c, "id"));
    if (!card) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const { moved, fromListId } = await moveCard(c.env, card, body);
    if (moved) {
      c.var.audit.push({
        action: "pto.card.moved",
        entityKind: "pto_card",
        entityId: card.id,
        detail: { fromListId, toListId: String(body.listId ?? fromListId) },
      });
    }
    const viewer = await viewerOf(c.env, auth);
    return c.json({ board: await loadBoard(c.env, viewer, (await boardById(c.env, card.board_id))!) });
  }),
);

pto.delete(
  "/cards/:id",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const card = await cardById(c.env, param(c, "id"));
    if (!card) return c.json({ error: "not_found" }, 404);
    await deleteCard(c.env, card.id);
    c.var.audit.push({
      action: "pto.card.deleted",
      entityKind: "pto_card",
      entityId: card.id,
      // The title, because in a second nothing else in the system will hold it —
      // the same reason `person.deleted` carries a name (invariant 25).
      detail: { title: card.title, boardId: card.board_id },
    });
    const viewer = await viewerOf(c.env, auth);
    return c.json({ board: await loadBoard(c.env, viewer, (await boardById(c.env, card.board_id))!) });
  }),
);

/** PUT /pto/cards/:id/assignees { personIds } — replace the set.
 *
 *  One audit row per PUT rather than one per person added or removed: the client
 *  sends the whole set, so that is the act. Ids travel as ULIDs and never as
 *  names — resolving them is `ptoRosterOf`'s job, which is where the gate lives. */
pto.put(
  "/cards/:id/assignees",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const card = await cardById(c.env, param(c, "id"));
    if (!card) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<{ personIds?: unknown }>().catch(() => ({}) as { personIds?: unknown });
    await setAssignees(c.env, card.id, auth, body.personIds);
    c.var.audit.push({
      action: "pto.card.assigned",
      entityKind: "pto_card",
      entityId: card.id,
      detail: { personIds: Array.isArray(body.personIds) ? body.personIds.map(String) : [] },
    });
    const viewer = await viewerOf(c.env, auth);
    return c.json({ board: await loadBoard(c.env, viewer, (await boardById(c.env, card.board_id))!) });
  }),
);

// ── Comments ────────────────────────────────────────────────────────────────

pto.get(
  "/cards/:id/comments",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const card = await cardById(c.env, param(c, "id"));
    if (!card) return c.json({ error: "not_found" }, 404);
    const viewer = await viewerOf(c.env, auth);
    return c.json({ comments: await cardComments(c.env, viewer, card.id) });
  }),
);

pto.post(
  "/cards/:id/comments",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const card = await cardById(c.env, param(c, "id"));
    if (!card) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<{ body?: unknown }>().catch(() => ({}) as { body?: unknown });
    const id = await addComment(c.env, card.id, auth, body.body);
    // The comment's TEXT stays out of `detail`. The log's reader is a system
    // admin and could read the board anyway, but a transcript of the board in a
    // second, append-only, never-swept table is not what invariant 5 is for.
    c.var.audit.push({
      action: "pto.comment.created",
      entityKind: "pto_card_comment",
      entityId: id,
      detail: { cardId: card.id },
    });
    const viewer = await viewerOf(c.env, auth);
    return c.json({ comments: await cardComments(c.env, viewer, card.id) }, 201);
  }),
);

/** DELETE /pto/comments/:id — your own, or anyone's if you're a system admin. */
pto.delete(
  "/comments/:id",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const row = await commentById(c.env, param(c, "id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.author_user_id !== auth.userId && !auth.isSystemAdmin) {
      return c.json({ error: "forbidden" }, 403);
    }
    await deleteComment(c.env, row.id);
    c.var.audit.push({
      action: "pto.comment.deleted",
      entityKind: "pto_card_comment",
      entityId: row.id,
      detail: { cardId: row.card_id },
    });
    const viewer = await viewerOf(c.env, auth);
    return c.json({ comments: await cardComments(c.env, viewer, row.card_id) });
  }),
);

// ── Labels ──────────────────────────────────────────────────────────────────

pto.post(
  "/boards/:id/labels",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const board = await boardById(c.env, param(c, "id"));
    if (!board) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<{ name?: unknown; color?: unknown }>().catch(() => ({}) as { name?: unknown; color?: unknown });
    await createLabel(c.env, board.id, body.name, body.color);
    c.var.audit.push({ action: "pto.board.updated", entityKind: "pto_board", entityId: board.id });
    const viewer = await viewerOf(c.env, auth);
    return c.json({ board: await loadBoard(c.env, viewer, board) }, 201);
  }),
);

pto.delete(
  "/boards/:id/labels/:labelId",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const board = await boardById(c.env, param(c, "id"));
    if (!board) return c.json({ error: "not_found" }, 404);
    await deleteLabel(c.env, board.id, param(c, "labelId"));
    c.var.audit.push({ action: "pto.board.updated", entityKind: "pto_board", entityId: board.id });
    const viewer = await viewerOf(c.env, auth);
    return c.json({ board: await loadBoard(c.env, viewer, board) });
  }),
);

// ── Pickers ─────────────────────────────────────────────────────────────────

/** GET /pto/roster — who a card may be assigned to. */
pto.get(
  "/roster",
  guarded(async (c) => {
    const auth = await requirePto(c);
    const viewer = await viewerOf(c.env, auth);
    return c.json({ people: await assignableRoster(c.env, viewer) });
  }),
);

/** GET /pto/events — managed events a board may be pointed at. */
pto.get(
  "/events",
  guarded(async (c) => {
    await requirePto(c);
    return c.json({ events: await eventOptions(c.env) });
  }),
);

/** GET /pto/groups — generic groups, for the settings picker (system admin).
 *
 *  Names and ids only. `GET /groups` already serves every group's name to any
 *  authenticated member (invariant 21 records that as an accepted cost), so this
 *  discloses nothing new; it exists so the settings screen doesn't have to
 *  reach into the directory app's paging. */
pto.get(
  "/groups",
  guarded(async (c) => {
    const auth = requireAuth(c);
    if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
    const rows = await c.env.DB.prepare(
      `SELECT g.id, g.name, g.kind,
              (SELECT COUNT(*) FROM membership m WHERE m.group_id = g.id) AS member_count
         FROM grp g WHERE g.kind = 'generic' ORDER BY lower(g.name)`,
    ).all<{ id: string; name: string; kind: string; member_count: number }>();
    return c.json({
      groups: rows.results.map((r) => ({ id: r.id, name: r.name, memberCount: r.member_count })),
    });
  }),
);

// The PTO's planning boards (migration 0024) — the gate, the reads, and the
// ordering arithmetic. Routes live in routes/pto.ts.
//
// Two things in this file are the whole security story for the feature, and
// both are here rather than in the route so there is exactly one of each:
//
//   ptoAccess   — may this caller touch the boards at all. Every route calls it.
//   ptoRosterOf — what a Person on a card is CALLED, resolved through
//                 `personListableSql` (invariant 21). Nothing else in this file
//                 reads `person`.
//
// There is deliberately no public projection here — no `publicBoardOf`, no
// `/pto-public/*` router — and that absence is the design. See the header of
// migration 0024 and the PTO section of packages/shared/src/types.ts.

import type {
  PtoAccessDTO,
  PtoBoardDTO,
  PtoBoardDetailDTO,
  PtoBoardEventDTO,
  PtoBoardImpactDTO,
  PtoCardDTO,
  PtoCommentDTO,
  PtoEventOptionDTO,
  PtoLabelColor,
  PtoLabelDTO,
  PtoListDTO,
  PtoPersonDTO,
} from "@sd/shared";
import { PTO_LABEL_COLORS, eventPath } from "@sd/shared";
import type { AuthContext, Env } from "../env.js";
import { getSetting } from "./db.js";
import { ulid } from "./ids.js";
import { displayName, personListableSql } from "./privacy.js";
import { nowIso } from "./time.js";

/** The `setting` key naming the group whose roster may use the boards.
 *
 *  A setting rather than a new `grp.kind`, because "which group is the PTO
 *  board" is instance configuration in the same sense `registration_open` is,
 *  and because a fourth GroupKind would ripple into every group screen in
 *  apps/web for nothing. The group itself is an ordinary `generic` group,
 *  created and rostered with the tools that already exist. */
export const PTO_GROUP_SETTING = "pto_board_group_id";

/** Limits. Generous enough that nobody sane hits them, small enough that a
 *  scripted client can't turn a board into a denial-of-service. */
const MAX_TITLE = 200;
const MAX_TEXT = 8000;
const MAX_COMMENT = 4000;
const MAX_LISTS = 30;
const MAX_CARDS_PER_BOARD = 1000;
const MAX_LABELS = 12;

export class PtoError extends Error {}

function trimmed(value: unknown, max: number, what: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) throw new PtoError(`${what} is required.`);
  if (s.length > max) throw new PtoError(`${what} must be ${max} characters or fewer.`);
  return s;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > max) throw new PtoError(`That text must be ${max} characters or fewer.`);
  return s;
}

/** An ISO-8601 instant, or null. Rejects garbage rather than storing it — a
 *  due date that doesn't parse renders as "Invalid Date" forever. */
function optionalInstant(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new PtoError("That date could not be read.");
  return d.toISOString();
}

// ── The gate ────────────────────────────────────────────────────────────────

/**
 * May this caller use the boards, and what may they configure?
 *
 * A system admin is always in — being one is a fact about the account, not
 * something a roster decides, the same short-circuit `personListableSql` makes.
 *
 * Everyone else is in iff some Person they control sits on the configured
 * group's roster with **`self_asserted = 0`**. That last clause is the one worth
 * defending. Migration 0023 added the column precisely to separate being ON a
 * list from being TRUSTED by it: `PUT /persons/:id/classroom` lets a parent put
 * their own child on a roster with no authority over it, and while only
 * classrooms can be self-asserted today, a gate that ignored the column would
 * silently become wrong the day that door widens. Every row
 * `POST /groups/:id/members` writes — the only way into a generic group, and it
 * is behind `requireGroupAdmin` — has `self_asserted = 0`, so honouring it costs
 * this gate nothing today and cannot be forgotten later.
 *
 * With no group configured, only system admins are admitted. That is the correct
 * bootstrap rather than a hole: an admin creates the group in apps/web, adds the
 * board, and names it here.
 *
 * Note what this does NOT do: it does not read `person`. Membership and control
 * are the whole question, and applying the enumeration gate here would be the
 * wrong predicate — an unlisted PTO board member is still on the PTO board. The
 * gate belongs on what their NAME does, which is `ptoRosterOf`'s job below.
 */
export async function ptoAccess(env: Env, auth: AuthContext): Promise<PtoAccessDTO> {
  const groupId = await getSetting(env, PTO_GROUP_SETTING);
  const group = groupId
    ? await env.DB.prepare("SELECT id, name FROM grp WHERE id = ?")
        .bind(groupId)
        .first<{ id: string; name: string }>()
    : null;

  if (auth.isSystemAdmin) {
    return {
      canUse: true,
      isSystemAdmin: true,
      groupName: group?.name ?? null,
      groupId: group?.id ?? null,
    };
  }

  const row = group
    ? await env.DB.prepare(
        `SELECT 1 AS ok
           FROM membership m
           JOIN control c ON c.person_id = m.person_id
          WHERE m.group_id = ? AND m.self_asserted = 0 AND c.user_id = ?
          LIMIT 1`,
      )
        .bind(group.id, auth.userId)
        .first<{ ok: number }>()
    : null;

  return {
    canUse: !!row,
    isSystemAdmin: false,
    groupName: group?.name ?? null,
    groupId: group?.id ?? null,
  };
}

// ── Names ───────────────────────────────────────────────────────────────────

/** How a withheld or missing Person reads on a card.
 *
 *  Deliberately the same string for both cases, exactly as `personLabel` returns
 *  "A member" for both in lib/slackNotify.ts: telling them apart would make a
 *  card's assignee list an oracle for `unlisted_at`. And the entry is KEPT
 *  rather than dropped — a card that quietly lost its assignee would read as
 *  unclaimed, which is invariant 21's `filled`-count problem in another costume. */
const WITHHELD = { id: null as null, displayName: "A PTO member", isYou: false as const };

export interface PtoViewer {
  userId: string;
  isSystemAdmin: boolean;
  /** Persons this User controls — for `isYou`, and for the Controller exemption
   *  the enumeration gate grants. */
  controlledPersonIds: Set<string>;
}

export async function viewerOf(env: Env, auth: AuthContext): Promise<PtoViewer> {
  const rows = await env.DB.prepare("SELECT person_id FROM control WHERE user_id = ?")
    .bind(auth.userId)
    .all<{ person_id: string }>();
  return {
    userId: auth.userId,
    isSystemAdmin: auth.isSystemAdmin,
    controlledPersonIds: new Set(rows.results.map((r) => r.person_id)),
  };
}

/**
 * Resolve Person ids to names, applying the enumeration gate and the last-name
 * display rule.
 *
 * Composes `personListableSql`, so this is a GUARDED read of `person` under
 * invariant 21 and spends none of test/personListable.test.ts's exemption
 * budget — which CLAUDE.md records as 7 of 8 already gone. A row the gate
 * withholds simply doesn't come back, and callers render `WITHHELD` in its
 * place.
 *
 * Batched: one `IN (…)` for a whole board rather than a lookup per card, the
 * same economy `sharesForMany` makes in lib/privacy.ts.
 */
export async function ptoRosterOf(
  env: Env,
  viewer: PtoViewer,
  personIds: string[],
): Promise<Map<string, PtoPersonDTO>> {
  const out = new Map<string, PtoPersonDTO>();
  const ids = [...new Set(personIds)].filter(Boolean);
  if (!ids.length) return out;

  const listable = personListableSql(viewer.userId, viewer.isSystemAdmin);
  const rows = await env.DB.prepare(
    `SELECT id, first_name, last_name, last_name_visibility
       FROM person
      WHERE id IN (${ids.map(() => "?").join(",")}) AND ${listable.sql}`,
  )
    .bind(...ids, ...listable.binds)
    .all<{
      id: string;
      first_name: string;
      last_name: string | null;
      last_name_visibility: "full" | "initial";
    }>();

  for (const r of rows.results) {
    const isYou = viewer.controlledPersonIds.has(r.id);
    out.set(r.id, {
      id: r.id,
      displayName: displayName(r.first_name, r.last_name, r.last_name_visibility, isYou),
      isYou,
    });
  }
  return out;
}

/**
 * The Persons a card may be assigned to: the PTO board group's roster.
 *
 * Same gate as `ptoRosterOf` — it composes `personListableSql` — so an unlisted
 * board member is absent from the picker for anyone but a system admin or their
 * own Controller. That is the correct outcome and worth stating: `unlisted_at`
 * is a stronger withholding than anything a Controller can set (invariant 21),
 * so it outranks "but they're on the committee". They can still be assigned by
 * someone who can see them, and the card renders `WITHHELD` to everyone else.
 *
 * With no group configured this returns nobody, so a bootstrapping system admin
 * sees an empty picker rather than the whole school.
 */
export async function assignableRoster(env: Env, viewer: PtoViewer): Promise<PtoPersonDTO[]> {
  const groupId = await getSetting(env, PTO_GROUP_SETTING);
  if (!groupId) return [];

  const listable = personListableSql(viewer.userId, viewer.isSystemAdmin, "p");
  const rows = await env.DB.prepare(
    `SELECT p.id, p.first_name, p.last_name, p.last_name_visibility
       FROM person p
       JOIN membership m ON m.person_id = p.id
      WHERE m.group_id = ? AND m.self_asserted = 0 AND ${listable.sql}
      ORDER BY lower(p.first_name), lower(coalesce(p.last_name, ''))`,
  )
    .bind(groupId, ...listable.binds)
    .all<{
      id: string;
      first_name: string;
      last_name: string | null;
      last_name_visibility: "full" | "initial";
    }>();

  return rows.results.map((r) => {
    const isYou = viewer.controlledPersonIds.has(r.id);
    return {
      id: r.id,
      displayName: displayName(r.first_name, r.last_name, r.last_name_visibility, isYou),
      isYou,
    };
  });
}

/**
 * What to call the author of a comment.
 *
 * Two steps rather than one join, and the split is deliberate. `control` is read
 * first to find each author's oldest Person — that statement touches no `person`
 * row and needs no gate — and the ids then go through `ptoRosterOf`, which
 * composes `personListableSql`. So the name a comment carries clears invariant
 * 21's gate by construction, and this file spends none of
 * test/personListable.test.ts's exemption budget.
 *
 * The fallback is `WITHHELD.displayName`, never the author's EMAIL. Falling back
 * to an address was the obvious spelling and is the wrong one: an email is a
 * contact item governed by its own visibility rules (invariant 1), so putting
 * one here would route around them — and it would do so exactly for the authors
 * the gate just withheld, turning a comment byline into an oracle for
 * `unlisted_at` plus a contact leak in the same line.
 */
async function authorLabels(
  env: Env,
  viewer: PtoViewer,
  userIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return out;

  const rows = await env.DB.prepare(
    `SELECT user_id, person_id FROM control
      WHERE user_id IN (${ids.map(() => "?").join(",")})
      ORDER BY since ASC`,
  )
    .bind(...ids)
    .all<{ user_id: string; person_id: string }>();

  const personByUser = new Map<string, string>();
  for (const r of rows.results) {
    if (!personByUser.has(r.user_id)) personByUser.set(r.user_id, r.person_id);
  }

  const roster = await ptoRosterOf(env, viewer, [...personByUser.values()]);
  for (const [userId, personId] of personByUser) {
    const person = roster.get(personId);
    if (person) out.set(userId, person.displayName);
  }
  return out;
}

// ── Ordering ────────────────────────────────────────────────────────────────
//
// Positions are floats and a move is a midpoint insertion, so a drag is ONE
// UPDATE of ONE row. See migration 0024's header for why last-write-wins is the
// right answer for a shared board where it is not for a volunteer signup.

const POSITION_STEP = 1024;
/** Below this, two neighbours are close enough that another midpoint would start
 *  losing precision. Rewriting the column costs one batch and happens roughly
 *  never in practice — a column has to be dragged through ~50 midpoints between
 *  the same pair to get here. */
const POSITION_EPSILON = 0.0001;

/** The position a new item appended to `rows` should take. */
export function appendPosition(existing: { position: number }[]): number {
  const max = existing.reduce((m, r) => Math.max(m, r.position), 0);
  return max + POSITION_STEP;
}

/** The position between two neighbours, either of which may be absent (top or
 *  bottom of the column). Returns null when the gap has collapsed and the
 *  caller should normalize first. */
export function midpoint(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return POSITION_STEP;
  if (before === null) return after! - POSITION_STEP;
  if (after === null) return before + POSITION_STEP;
  if (Math.abs(after - before) < POSITION_EPSILON) return null;
  return (before + after) / 2;
}

/** Rewrite a column's positions to evenly spaced whole numbers. Only reached
 *  when `midpoint` reports the gap has collapsed. */
export async function normalizeListPositions(env: Env, listId: string): Promise<void> {
  const rows = await env.DB.prepare(
    "SELECT id FROM pto_card WHERE list_id = ? AND archived_at IS NULL ORDER BY position, id",
  )
    .bind(listId)
    .all<{ id: string }>();
  if (!rows.results.length) return;
  await env.DB.batch(
    rows.results.map((r, i) =>
      env.DB.prepare("UPDATE pto_card SET position = ? WHERE id = ?").bind((i + 1) * POSITION_STEP, r.id),
    ),
  );
}

// ── Board reads ─────────────────────────────────────────────────────────────

interface BoardRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  managed_event_id: string | null;
  position: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The calendar event a board names, resolved LIVE from `managed_event`.
 *
 * The board stores no date of its own — invariant 8's rule, and the same one
 * apps/home applies to its events block: a date copied here is wrong the moment
 * the school moves the event, and a board has no editor watching for that.
 *
 * The occurrence shown is the next one at or after now, falling back to the most
 * recent past one so a board opened in June still says when its event was. The
 * path is minted in SCHOOL_TIMEZONE because this runs on a Worker with no reader
 * timezone to use — `findEventByPath` on the calendar side searches ±1 day, so
 * the two can disagree about a boundary without breaking the link.
 */
async function boardEvents(
  env: Env,
  seriesIds: string[],
): Promise<Map<string, PtoBoardEventDTO>> {
  const out = new Map<string, PtoBoardEventDTO>();
  const ids = [...new Set(seriesIds)].filter(Boolean);
  if (!ids.length) return out;

  const placeholders = ids.map(() => "?").join(",");
  const now = nowIso();
  const rows = await env.DB.prepare(
    `SELECT e.id, e.title, e.all_day,
            (SELECT MIN(ce.starts_at) FROM calendar_event ce
              WHERE ce.managed_event_id = e.id AND ce.starts_at >= ?) AS next_start,
            (SELECT MAX(ce.starts_at) FROM calendar_event ce
              WHERE ce.managed_event_id = e.id) AS last_start
       FROM managed_event e WHERE e.id IN (${placeholders})`,
  )
    .bind(now, ...ids)
    .all<{
      id: string;
      title: string;
      all_day: number;
      next_start: string | null;
      last_start: string | null;
    }>();

  const tz = env.SCHOOL_TIMEZONE || "America/Chicago";
  for (const r of rows.results) {
    const start = r.next_start ?? r.last_start;
    const allDay = r.all_day === 1;
    out.set(r.id, {
      seriesId: r.id,
      title: r.title,
      start,
      allDay,
      path: start ? eventPath({ title: r.title, start, allDay }, tz) : null,
    });
  }
  return out;
}

function boardSummary(
  row: BoardRow,
  cardCount: number,
  event: PtoBoardEventDTO | null,
): PtoBoardDTO {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    position: row.position,
    archived: row.archived_at !== null,
    event,
    cardCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listBoards(env: Env, includeArchived: boolean): Promise<PtoBoardDTO[]> {
  const rows = await env.DB.prepare(
    `SELECT b.id, b.slug, b.title, b.summary, b.managed_event_id, b.position,
            b.archived_at, b.created_at, b.updated_at,
            (SELECT COUNT(*) FROM pto_card c
              WHERE c.board_id = b.id AND c.archived_at IS NULL) AS card_count
       FROM pto_board b
      ${includeArchived ? "" : "WHERE b.archived_at IS NULL"}
      ORDER BY b.archived_at IS NOT NULL, b.position, b.created_at`,
  ).all<BoardRow & { card_count: number }>();

  const events = await boardEvents(
    env,
    rows.results.map((r) => r.managed_event_id ?? "").filter(Boolean),
  );
  return rows.results.map((r) =>
    boardSummary(r, r.card_count, r.managed_event_id ? events.get(r.managed_event_id) ?? null : null),
  );
}

export async function boardBySlug(env: Env, slug: string): Promise<BoardRow | null> {
  return env.DB.prepare(
    `SELECT id, slug, title, summary, managed_event_id, position, archived_at, created_at, updated_at
       FROM pto_board WHERE slug = ?`,
  )
    .bind(slug)
    .first<BoardRow>();
}

export async function boardById(env: Env, id: string): Promise<BoardRow | null> {
  return env.DB.prepare(
    `SELECT id, slug, title, summary, managed_event_id, position, archived_at, created_at, updated_at
       FROM pto_board WHERE id = ?`,
  )
    .bind(id)
    .first<BoardRow>();
}

/** One board, whole: lists, cards, assignees, labels and comment counts.
 *
 *  Five statements, not one per list — a board is useless in pieces, and D1
 *  round trips are what this screen actually costs. */
export async function loadBoard(
  env: Env,
  viewer: PtoViewer,
  row: BoardRow,
): Promise<PtoBoardDetailDTO> {
  const [lists, cards, labels, cardLabels, assignees, comments] = await Promise.all([
    env.DB.prepare(
      "SELECT id, title, position FROM pto_list WHERE board_id = ? ORDER BY position, id",
    )
      .bind(row.id)
      .all<{ id: string; title: string; position: number }>(),
    env.DB.prepare(
      `SELECT id, list_id, title, description, due_at, position, created_at, updated_at
         FROM pto_card WHERE board_id = ? AND archived_at IS NULL ORDER BY position, id`,
    )
      .bind(row.id)
      .all<{
        id: string;
        list_id: string;
        title: string;
        description: string | null;
        due_at: string | null;
        position: number;
        created_at: string;
        updated_at: string;
      }>(),
    env.DB.prepare("SELECT id, name, color FROM pto_label WHERE board_id = ? ORDER BY position, id")
      .bind(row.id)
      .all<{ id: string; name: string; color: PtoLabelColor }>(),
    env.DB.prepare(
      `SELECT cl.card_id, cl.label_id FROM pto_card_label cl
         JOIN pto_card c ON c.id = cl.card_id WHERE c.board_id = ?`,
    )
      .bind(row.id)
      .all<{ card_id: string; label_id: string }>(),
    env.DB.prepare(
      `SELECT a.card_id, a.person_id FROM pto_card_assignee a
         JOIN pto_card c ON c.id = a.card_id WHERE c.board_id = ?
         ORDER BY a.assigned_at`,
    )
      .bind(row.id)
      .all<{ card_id: string; person_id: string }>(),
    env.DB.prepare(
      `SELECT cm.card_id, COUNT(*) AS n FROM pto_card_comment cm
         JOIN pto_card c ON c.id = cm.card_id WHERE c.board_id = ?
         GROUP BY cm.card_id`,
    )
      .bind(row.id)
      .all<{ card_id: string; n: number }>(),
  ]);

  const roster = await ptoRosterOf(env, viewer, assignees.results.map((a) => a.person_id));

  const labelsByCard = new Map<string, string[]>();
  for (const cl of cardLabels.results) {
    const list = labelsByCard.get(cl.card_id) ?? [];
    list.push(cl.label_id);
    labelsByCard.set(cl.card_id, list);
  }
  const assigneesByCard = new Map<string, PtoCardDTO["assignees"]>();
  for (const a of assignees.results) {
    const list = assigneesByCard.get(a.card_id) ?? [];
    // Withheld rather than dropped — see WITHHELD above.
    list.push(roster.get(a.person_id) ?? WITHHELD);
    assigneesByCard.set(a.card_id, list);
  }
  const commentCounts = new Map(comments.results.map((c) => [c.card_id, c.n]));

  const cardsByList = new Map<string, PtoCardDTO[]>();
  for (const c of cards.results) {
    const dto: PtoCardDTO = {
      id: c.id,
      listId: c.list_id,
      title: c.title,
      description: c.description,
      dueAt: c.due_at,
      position: c.position,
      assignees: assigneesByCard.get(c.id) ?? [],
      labelIds: labelsByCard.get(c.id) ?? [],
      commentCount: commentCounts.get(c.id) ?? 0,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    };
    const list = cardsByList.get(c.list_id) ?? [];
    list.push(dto);
    cardsByList.set(c.list_id, list);
  }

  const listDtos: PtoListDTO[] = lists.results.map((l) => ({
    id: l.id,
    title: l.title,
    position: l.position,
    cards: cardsByList.get(l.id) ?? [],
  }));

  const event = row.managed_event_id
    ? (await boardEvents(env, [row.managed_event_id])).get(row.managed_event_id) ?? null
    : null;

  const cardCount = cards.results.length;
  const labelDtos: PtoLabelDTO[] = labels.results.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
  }));

  return { ...boardSummary(row, cardCount, event), lists: listDtos, labels: labelDtos };
}

export async function cardComments(
  env: Env,
  viewer: PtoViewer,
  cardId: string,
): Promise<PtoCommentDTO[]> {
  const rows = await env.DB.prepare(
    "SELECT id, author_user_id, body, created_at FROM pto_card_comment WHERE card_id = ? ORDER BY created_at",
  )
    .bind(cardId)
    .all<{ id: string; author_user_id: string; body: string; created_at: string }>();
  const labels = await authorLabels(env, viewer, rows.results.map((r) => r.author_user_id));
  return rows.results.map((r) => ({
    id: r.id,
    body: r.body,
    authorName: labels.get(r.author_user_id) ?? WITHHELD.displayName,
    isYou: r.author_user_id === viewer.userId,
    createdAt: r.created_at,
  }));
}

// ── Board writes ────────────────────────────────────────────────────────────

/** A URL segment for a board. Members-only, so unlike a volunteer sheet's slug
 *  this is not an enumerable public handle and nothing follows from guessing
 *  one; it is here so a board link reads like a board. */
function slugify(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLowerCase()
      .replace(/['\u2018\u2019]/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 60)
      .replace(/-+$/u, "") || "board"
  );
}

async function uniqueSlug(env: Env, title: string): Promise<string> {
  const base = slugify(title);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const clash = await env.DB.prepare("SELECT 1 AS ok FROM pto_board WHERE slug = ?")
      .bind(candidate)
      .first<{ ok: number }>();
    if (!clash) return candidate;
  }
  return `${base}-${ulid().slice(-6).toLowerCase()}`;
}

/** A managed event id, checked to exist. Null clears the link. */
async function resolveEventId(env: Env, value: unknown): Promise<string | null> {
  if (value === null || value === undefined || value === "") return null;
  const id = String(value);
  const row = await env.DB.prepare("SELECT id FROM managed_event WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!row) throw new PtoError("That calendar event no longer exists.");
  return row.id;
}

/** The three columns a new board opens with. Named here rather than left to the
 *  client so every board starts the same shape, and so a board is useful the
 *  second it is created rather than after four more requests. */
const STARTER_LISTS = ["To do", "In progress", "Done"];

/** The starter labels. Names are English on purpose — the board is authoring
 *  chrome, like the calendar's and newsletter's admin screens (invariant 6
 *  governs member-facing copy, and these are editable text the moment they
 *  exist). */
const STARTER_LABELS: Array<{ name: string; color: PtoLabelColor }> = [
  { name: "Needs a volunteer", color: "orange" },
  { name: "Waiting on someone", color: "purple" },
  { name: "Money", color: "green" },
];

export async function createBoard(
  env: Env,
  auth: AuthContext,
  body: { title?: unknown; summary?: unknown; managedEventId?: unknown },
): Promise<BoardRow> {
  const title = trimmed(body.title, MAX_TITLE, "Title");
  const summary = optionalText(body.summary, MAX_TEXT);
  const managedEventId = await resolveEventId(env, body.managedEventId);
  const slug = await uniqueSlug(env, title);
  const now = nowIso();
  const id = ulid();

  const existing = await env.DB.prepare("SELECT position FROM pto_board").all<{ position: number }>();
  const position = appendPosition(existing.results);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO pto_board
         (id, slug, title, summary, managed_event_id, position, archived_at, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,NULL,?,?,?)`,
    ).bind(id, slug, title, summary, managedEventId, position, auth.userId, now, now),
    ...STARTER_LISTS.map((t, i) =>
      env.DB.prepare(
        "INSERT INTO pto_list (id, board_id, title, position, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      ).bind(ulid(), id, t, (i + 1) * POSITION_STEP, now, now),
    ),
    ...STARTER_LABELS.map((l, i) =>
      env.DB.prepare("INSERT INTO pto_label (id, board_id, name, color, position) VALUES (?,?,?,?,?)").bind(
        ulid(),
        id,
        l.name,
        l.color,
        (i + 1) * POSITION_STEP,
      ),
    ),
  ]);

  return (await boardById(env, id))!;
}

export async function patchBoard(
  env: Env,
  id: string,
  body: { title?: unknown; summary?: unknown; managedEventId?: unknown; archived?: unknown },
): Promise<BoardRow | null> {
  const board = await boardById(env, id);
  if (!board) return null;

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.title !== undefined) {
    sets.push("title = ?");
    binds.push(trimmed(body.title, MAX_TITLE, "Title"));
  }
  if (body.summary !== undefined) {
    sets.push("summary = ?");
    binds.push(optionalText(body.summary, MAX_TEXT));
  }
  if (body.managedEventId !== undefined) {
    sets.push("managed_event_id = ?");
    binds.push(await resolveEventId(env, body.managedEventId));
  }
  if (body.archived !== undefined) {
    sets.push("archived_at = ?");
    binds.push(body.archived ? nowIso() : null);
  }
  if (!sets.length) return board;

  sets.push("updated_at = ?");
  binds.push(nowIso(), id);
  await env.DB.prepare(`UPDATE pto_board SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  return boardById(env, id);
}

/**
 * What deleting this board is about to remove, counted BEFORE it happens.
 *
 * The same obligation `volunteerFootprint` carries in lib/volunteers.ts and
 * `GET /persons/:id/removal-impact` carries in invariant 25: none of it is
 * countable afterwards and none of it is recoverable, so the admin is shown
 * these numbers at the confirmation and the audit row keeps them after.
 */
export async function boardImpact(env: Env, boardId: string): Promise<PtoBoardImpactDTO> {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM pto_list WHERE board_id = ?1) AS lists,
       (SELECT COUNT(*) FROM pto_card WHERE board_id = ?1) AS cards,
       (SELECT COUNT(*) FROM pto_card_assignee a JOIN pto_card c ON c.id = a.card_id
         WHERE c.board_id = ?1) AS assignees,
       (SELECT COUNT(*) FROM pto_card_comment m JOIN pto_card c ON c.id = m.card_id
         WHERE c.board_id = ?1) AS comments`,
  )
    .bind(boardId)
    .first<PtoBoardImpactDTO>();
  return row ?? { lists: 0, cards: 0, assignees: 0, comments: 0 };
}

/**
 * Delete a board and everything hanging off it, children first.
 *
 * Explicit child deletes in one batch rather than `ON DELETE CASCADE`, matching
 * `sheetCascade` and `deleteManagedEvent`. The order is the point: skip a child
 * and the outcome is either a constraint failure or, worse, silence — orphaned
 * assignee rows that no read joins and nobody ever sees again.
 */
export async function deleteBoard(env: Env, boardId: string): Promise<void> {
  const cards = `SELECT id FROM pto_card WHERE board_id = ?`;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM pto_card_assignee WHERE card_id IN (${cards})`).bind(boardId),
    env.DB.prepare(`DELETE FROM pto_card_comment WHERE card_id IN (${cards})`).bind(boardId),
    env.DB.prepare(`DELETE FROM pto_card_label WHERE card_id IN (${cards})`).bind(boardId),
    env.DB.prepare("DELETE FROM pto_card WHERE board_id = ?").bind(boardId),
    env.DB.prepare("DELETE FROM pto_label WHERE board_id = ?").bind(boardId),
    env.DB.prepare("DELETE FROM pto_list WHERE board_id = ?").bind(boardId),
    env.DB.prepare("DELETE FROM pto_board WHERE id = ?").bind(boardId),
  ]);
}

// ── List writes ─────────────────────────────────────────────────────────────

export async function createList(env: Env, boardId: string, title: unknown): Promise<string> {
  const existing = await env.DB.prepare("SELECT position FROM pto_list WHERE board_id = ?")
    .bind(boardId)
    .all<{ position: number }>();
  if (existing.results.length >= MAX_LISTS) {
    throw new PtoError(`A board may have at most ${MAX_LISTS} columns.`);
  }
  const id = ulid();
  const now = nowIso();
  await env.DB.prepare(
    "INSERT INTO pto_list (id, board_id, title, position, created_at, updated_at) VALUES (?,?,?,?,?,?)",
  )
    .bind(id, boardId, trimmed(title, MAX_TITLE, "Title"), appendPosition(existing.results), now, now)
    .run();
  return id;
}

/** The board a list belongs to — every route resolves this before acting, since
 *  authorization here is board-scoped. */
export async function listBoardId(env: Env, listId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT board_id FROM pto_list WHERE id = ?")
    .bind(listId)
    .first<{ board_id: string }>();
  return row?.board_id ?? null;
}

export async function renameList(env: Env, listId: string, title: unknown): Promise<void> {
  await env.DB.prepare("UPDATE pto_list SET title = ?, updated_at = ? WHERE id = ?")
    .bind(trimmed(title, MAX_TITLE, "Title"), nowIso(), listId)
    .run();
}

/** Deleting a column takes its cards with it — same children-first order as a
 *  board delete, for the same reason. */
export async function deleteList(env: Env, listId: string): Promise<{ cards: number }> {
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM pto_card WHERE list_id = ?")
    .bind(listId)
    .first<{ n: number }>();
  const cards = `SELECT id FROM pto_card WHERE list_id = ?`;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM pto_card_assignee WHERE card_id IN (${cards})`).bind(listId),
    env.DB.prepare(`DELETE FROM pto_card_comment WHERE card_id IN (${cards})`).bind(listId),
    env.DB.prepare(`DELETE FROM pto_card_label WHERE card_id IN (${cards})`).bind(listId),
    env.DB.prepare("DELETE FROM pto_card WHERE list_id = ?").bind(listId),
    env.DB.prepare("DELETE FROM pto_list WHERE id = ?").bind(listId),
  ]);
  return { cards: count?.n ?? 0 };
}

// ── Card writes ─────────────────────────────────────────────────────────────

export interface CardRow {
  id: string;
  board_id: string;
  list_id: string;
  title: string;
  position: number;
}

export async function cardById(env: Env, id: string): Promise<CardRow | null> {
  return env.DB.prepare("SELECT id, board_id, list_id, title, position FROM pto_card WHERE id = ?")
    .bind(id)
    .first<CardRow>();
}

export async function createCard(
  env: Env,
  auth: AuthContext,
  boardId: string,
  body: { listId?: unknown; title?: unknown; description?: unknown; dueAt?: unknown },
): Promise<CardRow> {
  const listId = String(body.listId ?? "");
  const owner = await listBoardId(env, listId);
  if (owner !== boardId) throw new PtoError("That column is not on this board.");

  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM pto_card WHERE board_id = ?")
    .bind(boardId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_CARDS_PER_BOARD) {
    throw new PtoError(`A board may have at most ${MAX_CARDS_PER_BOARD} cards.`);
  }

  const siblings = await env.DB.prepare(
    "SELECT position FROM pto_card WHERE list_id = ? AND archived_at IS NULL",
  )
    .bind(listId)
    .all<{ position: number }>();

  const id = ulid();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO pto_card
       (id, board_id, list_id, title, description, due_at, position, archived_at, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,NULL,?,?,?)`,
  )
    .bind(
      id,
      boardId,
      listId,
      trimmed(body.title, MAX_TITLE, "Title"),
      optionalText(body.description, MAX_TEXT),
      optionalInstant(body.dueAt),
      appendPosition(siblings.results),
      auth.userId,
      now,
      now,
    )
    .run();
  return (await cardById(env, id))!;
}

export async function patchCard(
  env: Env,
  card: CardRow,
  body: {
    title?: unknown;
    description?: unknown;
    dueAt?: unknown;
    labelIds?: unknown;
    archived?: unknown;
  },
): Promise<void> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.title !== undefined) {
    sets.push("title = ?");
    binds.push(trimmed(body.title, MAX_TITLE, "Title"));
  }
  if (body.description !== undefined) {
    sets.push("description = ?");
    binds.push(optionalText(body.description, MAX_TEXT));
  }
  if (body.dueAt !== undefined) {
    sets.push("due_at = ?");
    binds.push(optionalInstant(body.dueAt));
  }
  if (body.archived !== undefined) {
    sets.push("archived_at = ?");
    binds.push(body.archived ? nowIso() : null);
  }

  const statements = [];
  if (sets.length) {
    sets.push("updated_at = ?");
    binds.push(nowIso(), card.id);
    statements.push(
      env.DB.prepare(`UPDATE pto_card SET ${sets.join(", ")} WHERE id = ?`).bind(...binds),
    );
  }

  if (Array.isArray(body.labelIds)) {
    // Labels are replaced as a set, and only ones belonging to THIS board may be
    // attached — a hand-edited request must not be able to borrow another
    // board's label and leak its name onto this one.
    const ids = body.labelIds.map(String).filter(Boolean).slice(0, MAX_LABELS);
    statements.push(env.DB.prepare("DELETE FROM pto_card_label WHERE card_id = ?").bind(card.id));
    for (const labelId of new Set(ids)) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO pto_card_label (card_id, label_id)
             SELECT ?, id FROM pto_label WHERE id = ? AND board_id = ?`,
        ).bind(card.id, labelId, card.board_id),
      );
    }
  }

  if (statements.length) await env.DB.batch(statements);
}

/**
 * Move a card, by naming its new neighbours rather than an index.
 *
 * ONE `UPDATE`, of `list_id` and `position` together, so the two can never
 * disagree. Returns false when the card is already exactly where it was asked to
 * go: re-dropping a card on its own spot must write nothing and push no audit
 * draft, because an append-only log should not be paddable by a jittery mouse
 * — the same silent-no-op rule invariant 27 gives classroom placement.
 */
export async function moveCard(
  env: Env,
  card: CardRow,
  body: { listId?: unknown; afterCardId?: unknown; beforeCardId?: unknown },
): Promise<{ moved: boolean; fromListId: string }> {
  const listId = String(body.listId ?? card.list_id);
  const owner = await listBoardId(env, listId);
  if (owner !== card.board_id) throw new PtoError("That column is not on this board.");

  const neighbour = async (id: unknown): Promise<number | null> => {
    if (!id) return null;
    const row = await env.DB.prepare(
      "SELECT position FROM pto_card WHERE id = ? AND list_id = ? AND archived_at IS NULL",
    )
      .bind(String(id), listId)
      .first<{ position: number }>();
    return row?.position ?? null;
  };
  const after = await neighbour(body.afterCardId);
  const before = await neighbour(body.beforeCardId);

  let position = midpoint(after, before);
  if (position === null) {
    // The gap between the neighbours has collapsed. Rewrite the column and read
    // the neighbours again — this happens roughly never, and costs one batch.
    await normalizeListPositions(env, listId);
    const a = await neighbour(body.afterCardId);
    const b = await neighbour(body.beforeCardId);
    position = midpoint(a, b) ?? appendPosition([]);
  }

  if (card.list_id === listId && Math.abs(card.position - position) < POSITION_EPSILON) {
    return { moved: false, fromListId: card.list_id };
  }

  await env.DB.prepare("UPDATE pto_card SET list_id = ?, position = ?, updated_at = ? WHERE id = ?")
    .bind(listId, position, nowIso(), card.id)
    .run();
  return { moved: true, fromListId: card.list_id };
}

export async function deleteCard(env: Env, cardId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM pto_card_assignee WHERE card_id = ?").bind(cardId),
    env.DB.prepare("DELETE FROM pto_card_comment WHERE card_id = ?").bind(cardId),
    env.DB.prepare("DELETE FROM pto_card_label WHERE card_id = ?").bind(cardId),
    env.DB.prepare("DELETE FROM pto_card WHERE id = ?").bind(cardId),
  ]);
}

/**
 * Replace a card's assignees.
 *
 * The insert is an `INSERT … SELECT` against the PTO group's roster, so a
 * hand-edited request cannot assign a card to an arbitrary Person id: only
 * someone actually on the board's roster survives the SELECT. That check lives
 * in the statement rather than in a preceding read for the reason D1 always
 * gives — there is no transaction to hold a read and a write together.
 *
 * The roster SELECT reads `membership` and `control`, never `person`: this is an
 * authorization question ("is this Person on the PTO board?"), and the
 * enumeration gate is a visibility question answered separately, when the name
 * is rendered by `ptoRosterOf`. Applying it here would be the wrong predicate —
 * and would quietly make an unlisted board member un-assignable by the people
 * who can see them.
 */
export async function setAssignees(
  env: Env,
  cardId: string,
  auth: AuthContext,
  personIds: unknown,
): Promise<void> {
  const groupId = await getSetting(env, PTO_GROUP_SETTING);
  const ids = Array.isArray(personIds) ? [...new Set(personIds.map(String).filter(Boolean))] : [];
  const now = nowIso();

  const statements = [env.DB.prepare("DELETE FROM pto_card_assignee WHERE card_id = ?").bind(cardId)];
  if (groupId) {
    for (const personId of ids.slice(0, 20)) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO pto_card_assignee (card_id, person_id, assigned_by, assigned_at)
             SELECT ?, m.person_id, ?, ?
               FROM membership m
              WHERE m.person_id = ? AND m.group_id = ? AND m.self_asserted = 0`,
        ).bind(cardId, auth.userId, now, personId, groupId),
      );
    }
  }
  await env.DB.batch(statements);
}

export async function addComment(
  env: Env,
  cardId: string,
  auth: AuthContext,
  body: unknown,
): Promise<string> {
  const id = ulid();
  await env.DB.prepare(
    "INSERT INTO pto_card_comment (id, card_id, author_user_id, body, created_at) VALUES (?,?,?,?,?)",
  )
    .bind(id, cardId, auth.userId, trimmed(body, MAX_COMMENT, "Comment"), nowIso())
    .run();
  return id;
}

/** A comment, with the card it is on — routes need both to authorize a delete. */
export async function commentById(env: Env, id: string) {
  return env.DB.prepare(
    `SELECT m.id, m.card_id, m.author_user_id, c.board_id
       FROM pto_card_comment m JOIN pto_card c ON c.id = m.card_id
      WHERE m.id = ?`,
  )
    .bind(id)
    .first<{ id: string; card_id: string; author_user_id: string; board_id: string }>();
}

export async function deleteComment(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM pto_card_comment WHERE id = ?").bind(id).run();
}

// ── Label writes ────────────────────────────────────────────────────────────

export function isLabelColor(value: unknown): value is PtoLabelColor {
  return typeof value === "string" && (PTO_LABEL_COLORS as string[]).includes(value);
}

export async function createLabel(
  env: Env,
  boardId: string,
  name: unknown,
  color: unknown,
): Promise<string> {
  const existing = await env.DB.prepare("SELECT position FROM pto_label WHERE board_id = ?")
    .bind(boardId)
    .all<{ position: number }>();
  if (existing.results.length >= MAX_LABELS) {
    throw new PtoError(`A board may have at most ${MAX_LABELS} labels.`);
  }
  const id = ulid();
  await env.DB.prepare("INSERT INTO pto_label (id, board_id, name, color, position) VALUES (?,?,?,?,?)")
    .bind(
      id,
      boardId,
      trimmed(name, 60, "Label name"),
      isLabelColor(color) ? color : "slate",
      appendPosition(existing.results),
    )
    .run();
  return id;
}

export async function deleteLabel(env: Env, boardId: string, labelId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM pto_card_label WHERE label_id = ?
         AND label_id IN (SELECT id FROM pto_label WHERE board_id = ?)`,
    ).bind(labelId, boardId),
    env.DB.prepare("DELETE FROM pto_label WHERE id = ? AND board_id = ?").bind(labelId, boardId),
  ]);
}

// ── The event picker ────────────────────────────────────────────────────────

/** Managed events a board may be pointed at.
 *
 *  Only MANAGED events, for the reason invariant 8 gives and invariant 13 gives
 *  for volunteer sheets: an imported ICS event has no durable id to hang
 *  anything off. */
export async function eventOptions(env: Env): Promise<PtoEventOptionDTO[]> {
  const rows = await env.DB.prepare(
    `SELECT e.id, e.title, e.starts_at, c.name AS calendar_name
       FROM managed_event e JOIN managed_calendar c ON c.id = e.calendar_id
      ORDER BY e.starts_at DESC
      LIMIT 200`,
  ).all<{ id: string; title: string; starts_at: string; calendar_name: string }>();
  return rows.results.map((r) => ({
    seriesId: r.id,
    title: r.title,
    start: r.starts_at,
    calendarName: r.calendar_name,
  }));
}

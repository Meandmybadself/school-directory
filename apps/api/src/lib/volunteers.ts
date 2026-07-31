// Volunteer signups: sheets of positions hung off one occurrence of an authored
// event, which members claim spots on as one of the Persons they control.
//
// Identity, first, because everything else follows from it: a sheet names its
// occurrence by (managed_event_id, occurrence_start) — the ICS UID +
// RECURRENCE-ID pair migration 0009 reserved — and NEVER by calendar_event.id,
// which is re-minted on every refresh (CLAUDE.md invariant 8). Reading a sheet
// therefore joins `managed_event` for the title/location/duration and takes the
// occurrence's instant from the sheet's own column. The derived cache is
// consulted for exactly one thing: telling an admin that the date they opened a
// sheet on no longer exists, because the series was edited afterwards.
//
// `publicSheetOf` at the bottom is THE public/private seam, the companion to
// lib/calendar.ts's `publicEventOf`. Anonymous readers get positions and filled
// counts; who filled them is member-only (invariant 1). Build the public shape
// field by field — never by spreading — so a field added to the member DTO
// cannot reach an anonymous response by itself.

import type {
  LastNameDisplay,
  ManagedOccurrenceDTO,
  PublicVolunteerSheetDTO,
  VolunteerPositionDTO,
  VolunteerPositionInput,
  VolunteerSheetDTO,
  VolunteerSheetInput,
  VolunteerSignupDTO,
} from "@sd/shared";
import { volunteerSheetSlug } from "@sd/shared";
import type { Env } from "../env.js";
import { displayName } from "./privacy.js";
import { ulid } from "./ids.js";
import { nowIso } from "./time.js";

/** Cap on positions per sheet. A signup sheet with 100 jobs on it is a spread-
 *  sheet, not a sign-up sheet; this also bounds the read query. */
const MAX_POSITIONS = 60;
/** Cap on people needed for one position. */
const MAX_SLOTS = 200;
const MAX_TITLE = 120;
const MAX_TEXT = 2000;
const MAX_NOTE = 500;

/** Invalid authored input. Routes translate this into a 400 carrying the
 *  message, exactly as ManagedEventError does. */
export class VolunteerError extends Error {}

/** Why a claim was refused. The route maps these to a status; the client shows
 *  a specific message rather than a generic failure. */
export type ClaimFailure = "full" | "duplicate" | "closed" | "not_found";

// ── Row shapes ──────────────────────────────────────────────────────────────

interface SheetRow {
  id: string;
  managed_event_id: string;
  occurrence_start: string;
  slug: string;
  intro: string | null;
  published_at: string | null;
  closes_at: string | null;
  created_at: string;
  /** Joined from managed_event — the durable description of the series. */
  title: string;
  location: string | null;
  description: string | null;
  event_starts_at: string;
  event_ends_at: string | null;
  all_day: number;
}

interface PositionRow {
  id: string;
  sheet_id: string;
  title: string;
  description: string | null;
  slots: number;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
}

interface SignupRow {
  id: string;
  position_id: string;
  person_id: string;
  note: string | null;
  created_at: string;
  first_name: string;
  last_name: string | null;
  last_name_visibility: LastNameDisplay;
}

/** Who is reading. `controlledPersonIds` drives both `isYou` and the last-name
 *  rule, so it is resolved once per request rather than per signup. */
export interface Viewer {
  userId: string;
  isSystemAdmin: boolean;
  controlledPersonIds: Set<string>;
}

/** The Persons this User controls. One query, reused for every name on a sheet. */
export async function viewerOf(
  env: Env,
  userId: string,
  isSystemAdmin: boolean,
): Promise<Viewer> {
  const rows = await env.DB.prepare("SELECT person_id FROM control WHERE user_id = ?")
    .bind(userId)
    .all<{ person_id: string }>();
  return {
    userId,
    isSystemAdmin,
    controlledPersonIds: new Set(rows.results.map((r) => r.person_id)),
  };
}

// ── Input coercion ──────────────────────────────────────────────────────────

function trimmed(value: unknown, max: number, field: string): string {
  const s = String(value ?? "").trim();
  if (!s) throw new VolunteerError(`${field} is required.`);
  if (s.length > max) throw new VolunteerError(`${field} is too long (max ${max} characters).`);
  return s;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

/** Validate an optional ISO-8601 instant. Stored strings are compared as text
 *  everywhere else in this codebase, so a malformed one would silently sort
 *  wrong rather than throw — reject it here instead. */
function optionalInstant(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new VolunteerError(`${field} is not a valid date.`);
  return d.toISOString();
}

function coerceSlots(value: unknown): number {
  if (value === undefined || value === null) return 1;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) throw new VolunteerError("Number of people must be at least 1.");
  if (n > MAX_SLOTS) throw new VolunteerError(`Number of people must be ${MAX_SLOTS} or fewer.`);
  return n;
}

// ── Slugs ───────────────────────────────────────────────────────────────────

/** Append -2, -3, … until the slug is free, mirroring newsletter's `uniqueSlug`.
 *  Two occurrences of a weekly event in the same week is ordinary. */
export async function uniqueVolunteerSlug(env: Env, base: string): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const row = await env.DB.prepare("SELECT id FROM volunteer_sheet WHERE slug = ?")
      .bind(candidate)
      .first<{ id: string }>();
    if (!row) return candidate;
  }
  return `${base}-${ulid().toLowerCase().slice(-6)}`;
}

// ── Reads ───────────────────────────────────────────────────────────────────

const SHEET_SELECT = `
  SELECT s.id, s.managed_event_id, s.occurrence_start, s.slug, s.intro,
         s.published_at, s.closes_at, s.created_at,
         e.title, e.location, e.description,
         e.starts_at AS event_starts_at, e.ends_at AS event_ends_at, e.all_day
    FROM volunteer_sheet s
    JOIN managed_event e ON e.id = s.managed_event_id`;

async function sheetRowBy(env: Env, column: "slug" | "id", value: string): Promise<SheetRow | null> {
  return await env.DB.prepare(`${SHEET_SELECT} WHERE s.${column} = ?`)
    .bind(value)
    .first<SheetRow>();
}

/** This occurrence's end, derived from the SERIES duration rather than stored.
 *  Every occurrence of a rule has the same length, so duration is the durable
 *  fact and the end is arithmetic on the occurrence's own start. Reading it off
 *  a `calendar_event` row would tie the sheet to the disposable cache. */
function occurrenceEnd(row: SheetRow): string | null {
  if (!row.event_ends_at) return null;
  const durationMs = new Date(row.event_ends_at).getTime() - new Date(row.event_starts_at).getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  return new Date(new Date(row.occurrence_start).getTime() + durationMs).toISOString();
}

function isClosed(row: SheetRow, now: string): boolean {
  return !!row.closes_at && row.closes_at <= now;
}

/** Positions + signups for a set of sheets, in one round trip each. */
async function positionsOf(
  env: Env,
  sheetId: string,
  viewer: Viewer | null,
): Promise<VolunteerPositionDTO[]> {
  const positions = await env.DB.prepare(
    `SELECT id, sheet_id, title, description, slots, starts_at, ends_at, sort_order
       FROM volunteer_position WHERE sheet_id = ?
      ORDER BY sort_order ASC, created_at ASC
      LIMIT ?`,
  )
    .bind(sheetId, MAX_POSITIONS)
    .all<PositionRow>();
  if (positions.results.length === 0) return [];

  const holes = positions.results.map(() => "?").join(",");
  const signups = await env.DB.prepare(
    `SELECT su.id, su.position_id, su.person_id, su.note, su.created_at,
            p.first_name, p.last_name, p.last_name_visibility
       FROM volunteer_signup su
       JOIN person p ON p.id = su.person_id
      WHERE su.position_id IN (${holes})
      ORDER BY su.created_at ASC`,
  )
    .bind(...positions.results.map((p) => p.id))
    .all<SignupRow>();

  const byPosition = new Map<string, SignupRow[]>();
  for (const s of signups.results) {
    const list = byPosition.get(s.position_id);
    if (list) list.push(s);
    else byPosition.set(s.position_id, [s]);
  }

  return positions.results.map((p) => {
    const rows = byPosition.get(p.id) ?? [];
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      slots: p.slots,
      filled: rows.length,
      startsAt: p.starts_at,
      endsAt: p.ends_at,
      // `viewer` is null only when the caller is building the public projection,
      // where these are dropped anyway. Emitting an empty list rather than
      // reading names we're about to discard keeps the anonymous path from ever
      // holding a member's name in memory.
      signups: viewer ? rows.map((r) => signupDto(r, viewer)) : [],
    };
  });
}

function signupDto(row: SignupRow, viewer: Viewer): VolunteerSignupDTO {
  const isYou = viewer.controlledPersonIds.has(row.person_id);
  return {
    id: row.id,
    personId: row.person_id,
    displayName: displayName(row.first_name, row.last_name, row.last_name_visibility, isYou),
    note: row.note,
    isYou,
    createdAt: row.created_at,
  };
}

async function sheetDto(env: Env, row: SheetRow, viewer: Viewer | null): Promise<VolunteerSheetDTO> {
  const now = nowIso();
  return {
    id: row.id,
    slug: row.slug,
    intro: row.intro,
    closesAt: row.closes_at,
    closed: isClosed(row, now),
    published: !!row.published_at,
    event: {
      seriesId: row.managed_event_id,
      recurrenceId: row.occurrence_start,
      title: row.title,
      location: row.location,
      description: row.description,
      start: row.occurrence_start,
      end: occurrenceEnd(row),
      allDay: row.all_day === 1,
    },
    positions: await positionsOf(env, row.id, viewer),
    canManage: !!viewer?.isSystemAdmin,
  };
}

/** A sheet as a signed-in member sees it, or null if there is no such slug. */
export async function loadSheetForMember(
  env: Env,
  slug: string,
  viewer: Viewer,
): Promise<VolunteerSheetDTO | null> {
  const row = await sheetRowBy(env, "slug", slug);
  if (!row) return null;
  // A draft is admin-only: it is not on the calendar and has no public page, so
  // an ordinary member reaching it would be reading something not yet announced.
  if (!row.published_at && !viewer.isSystemAdmin) return null;
  return await sheetDto(env, row, viewer);
}

/** A sheet by its id, for the admin screens. Includes the orphan check. */
export async function loadSheetForAdmin(env: Env, id: string): Promise<VolunteerSheetDTO | null> {
  const row = await sheetRowBy(env, "id", id);
  if (!row) return null;
  const dto = await sheetDto(env, row, {
    userId: "",
    isSystemAdmin: true,
    controlledPersonIds: new Set(),
  });
  dto.orphaned = !(await occurrenceExists(env, row.managed_event_id, row.occurrence_start));
  return dto;
}

/** Does the materialized agenda still contain this occurrence? Only ever used to
 *  WARN. A sheet whose date was edited away keeps its signups; it just isn't on
 *  anyone's calendar until the admin fixes the series or moves the sheet. */
async function occurrenceExists(env: Env, seriesId: string, start: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 AS ok FROM calendar_event WHERE managed_event_id = ? AND starts_at = ? LIMIT 1",
  )
    .bind(seriesId, start)
    .first<{ ok: number }>();
  return !!row;
}

/** A published sheet as an ANONYMOUS caller sees it, or null. Draft sheets 404
 *  here — guessing tomorrow's slug reveals nothing, matching the newsletter
 *  archive's posture. */
export async function loadPublicSheet(
  env: Env,
  slug: string,
): Promise<PublicVolunteerSheetDTO | null> {
  const row = await sheetRowBy(env, "slug", slug);
  if (!row || !row.published_at) return null;
  return publicSheetOf(await sheetDto(env, row, null));
}

/** Every occurrence of one authored event, with the sheet already open on it —
 *  the admin's "which date?" picker. Read from the materialized agenda, so it
 *  offers exactly the dates a member can currently see. */
export async function listOccurrences(
  env: Env,
  managedEventId: string,
): Promise<ManagedOccurrenceDTO[]> {
  const [events, sheets] = await Promise.all([
    env.DB.prepare(
      `SELECT starts_at, ends_at, all_day FROM calendar_event
        WHERE managed_event_id = ? ORDER BY starts_at ASC`,
    )
      .bind(managedEventId)
      .all<{ starts_at: string; ends_at: string | null; all_day: number }>(),
    env.DB.prepare(
      `SELECT s.id, s.slug, s.occurrence_start, s.published_at,
              (SELECT COUNT(*) FROM volunteer_position WHERE sheet_id = s.id) AS position_count
         FROM volunteer_sheet s WHERE s.managed_event_id = ?`,
    )
      .bind(managedEventId)
      .all<{
        id: string;
        slug: string;
        occurrence_start: string;
        published_at: string | null;
        position_count: number;
      }>(),
  ]);

  const bySheetStart = new Map(sheets.results.map((s) => [s.occurrence_start, s]));
  const out: ManagedOccurrenceDTO[] = events.results.map((e) => {
    const sheet = bySheetStart.get(e.starts_at);
    bySheetStart.delete(e.starts_at);
    return {
      start: e.starts_at,
      end: e.ends_at,
      allDay: e.all_day === 1,
      sheet: sheet
        ? {
            id: sheet.id,
            slug: sheet.slug,
            published: !!sheet.published_at,
            positionCount: sheet.position_count,
          }
        : null,
    };
  });

  // Whatever is left over is orphaned — a sheet on a date the series no longer
  // produces. Surface it rather than hiding it, so its signups are reachable.
  for (const s of bySheetStart.values()) {
    out.push({
      start: s.occurrence_start,
      end: null,
      allDay: false,
      sheet: {
        id: s.id,
        slug: s.slug,
        published: !!s.published_at,
        positionCount: s.position_count,
      },
    });
  }
  out.sort((a, b) => a.start.localeCompare(b.start));
  return out;
}

// ── Sheet writes (admin) ────────────────────────────────────────────────────

export async function createSheet(
  env: Env,
  managedEventId: string,
  body: VolunteerSheetInput,
  userId: string,
): Promise<VolunteerSheetDTO | null> {
  const event = await env.DB.prepare("SELECT id, title FROM managed_event WHERE id = ?")
    .bind(managedEventId)
    .first<{ id: string; title: string }>();
  if (!event) return null;

  const occurrenceStart = optionalInstant(body.occurrenceStart, "Date");
  if (!occurrenceStart) throw new VolunteerError("Pick which date to open signups for.");

  const existing = await env.DB.prepare(
    "SELECT id FROM volunteer_sheet WHERE managed_event_id = ? AND occurrence_start = ?",
  )
    .bind(managedEventId, occurrenceStart)
    .first<{ id: string }>();
  if (existing) throw new VolunteerError("This date already has a volunteer sheet.");

  const now = nowIso();
  const id = ulid();
  const slug = await uniqueVolunteerSlug(env, volunteerSheetSlug(event.title, occurrenceStart));

  await env.DB.prepare(
    `INSERT INTO volunteer_sheet
       (id, managed_event_id, occurrence_start, slug, intro, published_at, closes_at,
        created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      managedEventId,
      occurrenceStart,
      slug,
      optionalText(body.intro, MAX_TEXT),
      // Sheets start as drafts: positions have to exist before a link is worth
      // sharing, and publishing is what puts it on the public calendar.
      body.published ? now : null,
      optionalInstant(body.closesAt, "Closing date"),
      userId,
      now,
      now,
    )
    .run();

  return await loadSheetForAdmin(env, id);
}

export async function updateSheet(
  env: Env,
  id: string,
  body: VolunteerSheetInput,
): Promise<VolunteerSheetDTO | null> {
  const row = await sheetRowBy(env, "id", id);
  if (!row) return null;

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.intro !== undefined) {
    sets.push("intro = ?");
    binds.push(optionalText(body.intro, MAX_TEXT));
  }
  if (body.closesAt !== undefined) {
    sets.push("closes_at = ?");
    binds.push(optionalInstant(body.closesAt, "Closing date"));
  }
  if (body.published !== undefined) {
    sets.push("published_at = ?");
    // Unpublishing keeps the sheet and its signups; it only withdraws the public
    // page and the calendar's link to it.
    binds.push(body.published ? (row.published_at ?? nowIso()) : null);
  }
  // `occurrenceStart` is deliberately not updatable — see VolunteerSheetInput.
  if (sets.length === 0) throw new VolunteerError("Nothing to update.");

  sets.push("updated_at = ?");
  binds.push(nowIso(), id);
  await env.DB.prepare(`UPDATE volunteer_sheet SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  return await loadSheetForAdmin(env, id);
}

/** Delete a sheet and everything hanging off it. Explicit child deletes rather
 *  than ON DELETE CASCADE, matching how deleteManagedEvent does it. */
export async function deleteSheet(env: Env, id: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM volunteer_sheet WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!row) return false;
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM volunteer_signup WHERE position_id IN (SELECT id FROM volunteer_position WHERE sheet_id = ?)",
    ).bind(id),
    env.DB.prepare("DELETE FROM volunteer_position WHERE sheet_id = ?").bind(id),
    env.DB.prepare("DELETE FROM volunteer_sheet WHERE id = ?").bind(id),
  ]);
  return true;
}

// ── Position writes (admin) ─────────────────────────────────────────────────

export async function createPosition(
  env: Env,
  sheetId: string,
  body: VolunteerPositionInput,
): Promise<VolunteerSheetDTO | null> {
  const sheet = await env.DB.prepare("SELECT id FROM volunteer_sheet WHERE id = ?")
    .bind(sheetId)
    .first<{ id: string }>();
  if (!sheet) return null;

  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM volunteer_position WHERE sheet_id = ?",
  )
    .bind(sheetId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_POSITIONS) {
    throw new VolunteerError(`A sheet may have at most ${MAX_POSITIONS} positions.`);
  }

  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO volunteer_position
       (id, sheet_id, title, description, slots, starts_at, ends_at, sort_order, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      ulid(),
      sheetId,
      trimmed(body.title, MAX_TITLE, "Title"),
      optionalText(body.description, MAX_TEXT),
      coerceSlots(body.slots),
      optionalInstant(body.startsAt, "Start time"),
      optionalInstant(body.endsAt, "End time"),
      body.sortOrder ?? (count?.n ?? 0),
      now,
      now,
    )
    .run();

  return await loadSheetForAdmin(env, sheetId);
}

export async function updatePosition(
  env: Env,
  id: string,
  body: Partial<VolunteerPositionInput>,
): Promise<VolunteerSheetDTO | null> {
  const row = await env.DB.prepare(
    "SELECT id, sheet_id FROM volunteer_position WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; sheet_id: string }>();
  if (!row) return null;

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
  if (body.slots !== undefined) {
    // Lowering `slots` below what is already filled is allowed and does NOT
    // evict anyone: the people who volunteered committed in good faith. The
    // position simply reads as over-full until someone withdraws.
    sets.push("slots = ?");
    binds.push(coerceSlots(body.slots));
  }
  if (body.startsAt !== undefined) {
    sets.push("starts_at = ?");
    binds.push(optionalInstant(body.startsAt, "Start time"));
  }
  if (body.endsAt !== undefined) {
    sets.push("ends_at = ?");
    binds.push(optionalInstant(body.endsAt, "End time"));
  }
  if (body.sortOrder !== undefined) {
    sets.push("sort_order = ?");
    binds.push(Math.floor(Number(body.sortOrder)) || 0);
  }
  if (sets.length === 0) throw new VolunteerError("Nothing to update.");

  sets.push("updated_at = ?");
  binds.push(nowIso(), id);
  await env.DB.prepare(`UPDATE volunteer_position SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  return await loadSheetForAdmin(env, row.sheet_id);
}

export async function deletePosition(env: Env, id: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT id, sheet_id FROM volunteer_position WHERE id = ?")
    .bind(id)
    .first<{ id: string; sheet_id: string }>();
  if (!row) return null;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM volunteer_signup WHERE position_id = ?").bind(id),
    env.DB.prepare("DELETE FROM volunteer_position WHERE id = ?").bind(id),
  ]);
  return row.sheet_id;
}

// ── Claiming and releasing a spot (members) ─────────────────────────────────

export interface ClaimResult {
  ok: boolean;
  reason?: ClaimFailure;
  /** The sheet's slug, so the route can return the refreshed sheet. */
  slug?: string;
}

/** Take one spot on a position, for a Person the caller controls.
 *
 *  Overfill is prevented by the WHERE clause on the INSERT rather than by
 *  reading the count first: D1 runs one statement atomically but gives no
 *  transaction around a read-then-write, so two parents tapping the last spot at
 *  the same moment would both pass a prior count check. `meta.changes` is the
 *  authority on whether the row landed.
 *
 *  The caller must already have verified control of `personId` — that is an
 *  authorization decision and lives in the route, next to the session. */
export async function claimSpot(
  env: Env,
  positionId: string,
  personId: string,
  userId: string,
  note: string | null,
): Promise<ClaimResult> {
  const position = await env.DB.prepare(
    `SELECT p.id, p.sheet_id, s.slug, s.closes_at, s.published_at
       FROM volunteer_position p
       JOIN volunteer_sheet s ON s.id = p.sheet_id
      WHERE p.id = ?`,
  )
    .bind(positionId)
    .first<{
      id: string;
      sheet_id: string;
      slug: string;
      closes_at: string | null;
      published_at: string | null;
    }>();
  if (!position || !position.published_at) return { ok: false, reason: "not_found" };
  if (position.closes_at && position.closes_at <= nowIso()) {
    return { ok: false, reason: "closed", slug: position.slug };
  }

  const already = await env.DB.prepare(
    "SELECT id FROM volunteer_signup WHERE position_id = ? AND person_id = ?",
  )
    .bind(positionId, personId)
    .first<{ id: string }>();
  if (already) return { ok: false, reason: "duplicate", slug: position.slug };

  const res = await env.DB.prepare(
    `INSERT INTO volunteer_signup (id, position_id, person_id, user_id, note, created_at)
     SELECT ?,?,?,?,?,?
      WHERE (SELECT COUNT(*) FROM volunteer_signup WHERE position_id = ?)
          < (SELECT slots FROM volunteer_position WHERE id = ?)`,
  )
    .bind(
      ulid(),
      positionId,
      personId,
      userId,
      optionalText(note, MAX_NOTE),
      nowIso(),
      positionId,
      positionId,
    )
    .run();

  // No row inserted means the guard bit: the last spot went to someone else
  // between the check above and this statement.
  if (!res.meta || res.meta.changes === 0) {
    return { ok: false, reason: "full", slug: position.slug };
  }
  return { ok: true, slug: position.slug };
}

/** Who a signup belongs to, for the route's authorization check. */
export async function signupOwner(
  env: Env,
  signupId: string,
): Promise<{ personId: string; userId: string; slug: string } | null> {
  const row = await env.DB.prepare(
    `SELECT su.person_id, su.user_id, s.slug
       FROM volunteer_signup su
       JOIN volunteer_position p ON p.id = su.position_id
       JOIN volunteer_sheet s ON s.id = p.sheet_id
      WHERE su.id = ?`,
  )
    .bind(signupId)
    .first<{ person_id: string; user_id: string; slug: string }>();
  return row ? { personId: row.person_id, userId: row.user_id, slug: row.slug } : null;
}

export async function releaseSpot(env: Env, signupId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM volunteer_signup WHERE id = ?").bind(signupId).run();
}

// ── The public/private seam ─────────────────────────────────────────────────

/** THE public/private seam for volunteer sheets, the companion to
 *  lib/calendar.ts's `publicEventOf`. Builds the anonymous-facing shape field by
 *  field — never by spreading — so a field added to VolunteerSheetDTO stays out
 *  of the public response until someone edits this function on purpose.
 *
 *  Two things are withheld deliberately, not incidentally:
 *
 *  - **Names.** `positions[].signups` is dropped entirely; a public reader gets
 *    `filled` and nothing else. Who volunteered is member-only (invariant 1),
 *    and this page's URL is enumerable, so a name here would be a name on the
 *    open internet.
 *  - **`event.seriesId` / `event.recurrenceId`.** The durable handle that
 *    addresses signup data, withheld for exactly the reason
 *    PublicCalendarEventDTO withholds it (invariant 12). The occurrence's
 *    instant still goes out as `event.start` — the public agenda already
 *    publishes that — but the pair that identifies the row does not.
 *
 *  If you are here because you added a field to VolunteerSheetDTO: the default
 *  answer is to leave this function alone. */
export function publicSheetOf(sheet: VolunteerSheetDTO): PublicVolunteerSheetDTO {
  return {
    slug: sheet.slug,
    intro: sheet.intro,
    closesAt: sheet.closesAt,
    closed: sheet.closed,
    event: {
      title: sheet.event.title,
      location: sheet.event.location,
      description: sheet.event.description,
      start: sheet.event.start,
      end: sheet.event.end,
      allDay: sheet.event.allDay,
    },
    positions: sheet.positions.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      slots: p.slots,
      filled: p.filled,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
    })),
  };
}

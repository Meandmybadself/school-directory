// Managed calendars: calendars and events authored here, rather than imported
// from someone else's ICS URL (see lib/calendar.ts for that half).
//
// The write model is `managed_calendar` + `managed_event`. The read model is the
// same `calendar_event` table imported feeds materialize into, so
// GET /calendar/events keeps a single query — a managed row is one whose
// `source_id` is null and whose `managed_calendar_id`/`managed_event_id` are set.
//
// Recurrence expansion goes THROUGH the ICS writer: we render the event as a
// one-VEVENT calendar, then parse it back with lib/calendar.ts's `parseIcs`. That
// keeps exactly one recurrence engine (ical.js) in the codebase and guarantees a
// member's agenda and a subscriber's feed show the same occurrences. Because
// every rule carries a mandatory UNTIL, expansion is finite and runs once on
// write — no cron is needed to slide a window forward.

import type {
  ManagedCalendarDTO,
  ManagedCalendarInput,
  ManagedEventDTO,
  ManagedEventInput,
  RecurFreq,
  RecurrenceInput,
  Weekday,
} from "@sd/shared";
import { WEEKDAYS } from "@sd/shared";
import type { Env } from "../env.js";
import { parseIcs, type ParsedEvent } from "./calendar.js";
import { renderCalendar, type IcsEventInput } from "./icsWriter.js";
import { ulid } from "./ids.js";
import { nowIso } from "./time.js";

/** Ceiling on occurrences one event may expand to. A mandatory UNTIL already
 *  bounds every rule, so this only catches an absurd request (e.g. daily for a
 *  decade) — and unlike an untrusted upstream feed, this is authored input, so we
 *  reject it with a clear message instead of silently truncating. */
export const MAX_OCCURRENCES = 730;
/** D1 batches are kept modest, matching refreshSource's chunking. */
const INSERT_CHUNK = 100;
/** UID suffix. The ULID alone is already unique; the domain just makes the UID
 *  well-formed for calendar clients. */
const UID_DOMAIN = "eisenhower.school";
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = "#0068A8";

/** Invalid authored input. Routes translate this into a 400 with the message. */
export class ManagedEventError extends Error {}

// ── Row shapes ──────────────────────────────────────────────────────────────

interface CalendarRow {
  id: string;
  name: string;
  color: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  event_count: number;
}

interface EventRow {
  id: string;
  calendar_id: string;
  title: string;
  location: string | null;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: number;
  recur_freq: string | null;
  recur_interval: number;
  recur_byday: string | null;
  recur_until: string | null;
  sequence: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  occurrence_count: number;
}

function icsUrl(apiOrigin: string, calendarId: string): string {
  return `${apiOrigin}/ics/${calendarId}.ics`;
}

function toCalendarDTO(r: CalendarRow, apiOrigin: string): ManagedCalendarDTO {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    description: r.description,
    eventCount: r.event_count,
    icsUrl: icsUrl(apiOrigin, r.id),
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

/** Rebuild the structured recurrence from its columns, or null for a one-off. */
function recurrenceOf(r: EventRow): RecurrenceInput | null {
  if (!r.recur_freq || !r.recur_until) return null;
  const rec: RecurrenceInput = {
    freq: r.recur_freq as RecurFreq,
    interval: r.recur_interval,
    until: r.recur_until,
  };
  if (r.recur_byday) rec.byDay = r.recur_byday.split(",") as Weekday[];
  return rec;
}

function toEventDTO(r: EventRow): ManagedEventDTO {
  return {
    id: r.id,
    calendarId: r.calendar_id,
    title: r.title,
    location: r.location,
    description: r.description,
    start: r.starts_at,
    end: r.ends_at,
    allDay: r.all_day === 1,
    recurrence: recurrenceOf(r),
    occurrenceCount: r.occurrence_count,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Validation ──────────────────────────────────────────────────────────────

function isoOrThrow(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ManagedEventError(`${field} is required.`);
  }
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) throw new ManagedEventError(`${field} is not a valid date.`);
  return new Date(ms).toISOString();
}

/** Normalize an authored recurrence, rejecting anything the ICS writer or the
 *  expander can't represent. */
function validateRecurrence(
  raw: RecurrenceInput | null | undefined,
  start: string,
): RecurrenceInput | null {
  if (!raw) return null;
  if (raw.freq !== "daily" && raw.freq !== "weekly" && raw.freq !== "monthly") {
    throw new ManagedEventError("Repeat must be daily, weekly, or monthly.");
  }
  const interval = raw.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1) {
    throw new ManagedEventError("Repeat interval must be a whole number of 1 or more.");
  }
  const until = isoOrThrow(raw.until, "Repeat end date");
  if (new Date(until).getTime() < new Date(start).getTime()) {
    throw new ManagedEventError("Repeat end date must be on or after the start.");
  }

  const rec: RecurrenceInput = { freq: raw.freq, interval, until };
  if (raw.freq === "weekly" && raw.byDay?.length) {
    const days = [...new Set(raw.byDay)];
    if (days.some((d) => !WEEKDAYS.includes(d))) {
      throw new ManagedEventError("Repeat weekdays are invalid.");
    }
    // Keep calendar order so the emitted BYDAY reads naturally.
    rec.byDay = WEEKDAYS.filter((d) => days.includes(d));
  }
  return rec;
}

interface NormalizedEvent {
  title: string;
  location: string | null;
  description: string | null;
  start: string;
  end: string | null;
  allDay: boolean;
  recurrence: RecurrenceInput | null;
}

/** Validate and normalize authored event input. `base` supplies current values
 *  when patching, so a partial body only overrides what it names. */
function normalizeEvent(input: Partial<ManagedEventInput>, base?: NormalizedEvent): NormalizedEvent {
  const title = (input.title ?? base?.title ?? "").trim();
  if (!title) throw new ManagedEventError("Title is required.");

  const allDay = input.allDay ?? base?.allDay ?? false;
  const start = input.start !== undefined ? isoOrThrow(input.start, "Start") : base!.start;

  const rawEnd = input.end !== undefined ? input.end : base?.end;
  const end = rawEnd ? isoOrThrow(rawEnd, "End") : null;
  if (end && new Date(end).getTime() < new Date(start).getTime()) {
    throw new ManagedEventError("End must be on or after the start.");
  }

  const rawRec = input.recurrence !== undefined ? input.recurrence : base?.recurrence;
  return {
    title,
    location: (input.location !== undefined ? input.location : base?.location)?.trim() || null,
    description:
      (input.description !== undefined ? input.description : base?.description)?.trim() || null,
    start,
    end,
    allDay,
    recurrence: validateRecurrence(rawRec, start),
  };
}

// ── Expansion ───────────────────────────────────────────────────────────────

/** Render one event as a single-VEVENT calendar. Also what /ics serves, per event. */
function icsInputOf(id: string, e: NormalizedEvent, sequence: number, updatedAt: string): IcsEventInput {
  return {
    uid: `${id}@${UID_DOMAIN}`,
    title: e.title,
    location: e.location,
    description: e.description,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    recurrence: e.recurrence,
    sequence,
    updatedAt,
  };
}

/** Expand an authored event into concrete occurrences by round-tripping it
 *  through the ICS writer and `parseIcs`. Throws if the rule is too large. */
export function expandEvent(id: string, e: NormalizedEvent): ParsedEvent[] {
  const ics = renderCalendar(e.title, [icsInputOf(id, e, 0, nowIso())]);
  // Cover the whole series: from its first occurrence through UNTIL. `parseIcs`
  // treats windowEnd as exclusive for non-recurring events, so a one-off needs a
  // window that strictly contains its start.
  const startMs = new Date(e.start).getTime();
  const windowStart = new Date(startMs);
  const windowEnd = e.recurrence
    ? new Date(new Date(e.recurrence.until).getTime() + 24 * 60 * 60 * 1000)
    : new Date(startMs + 1);

  const occurrences = parseIcs(ics, windowStart, windowEnd);
  if (occurrences.length === 0) {
    // A rule whose UNTIL precedes its first occurrence, or an unparseable date.
    throw new ManagedEventError("That event doesn't produce any dates — check the start and repeat end.");
  }
  if (occurrences.length > MAX_OCCURRENCES) {
    throw new ManagedEventError(
      `That repeat produces ${occurrences.length} events (limit ${MAX_OCCURRENCES}). Shorten the repeat end date or use a longer interval.`,
    );
  }
  occurrences.sort((a, b) => a.start.localeCompare(b.start));
  return occurrences;
}

/** Replace this event's materialized occurrences. Mirrors refreshSource's
 *  delete-then-insert, scoped to one event rather than a whole feed. */
async function materialize(
  env: Env,
  eventId: string,
  calendarId: string,
  occurrences: ParsedEvent[],
): Promise<void> {
  const inserts = occurrences.map((o) =>
    env.DB.prepare(
      `INSERT INTO calendar_event
         (id, source_id, managed_calendar_id, managed_event_id, uid, title, location, description,
          starts_at, ends_at, all_day, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      ulid(),
      calendarId,
      eventId,
      o.uid,
      o.title,
      o.location,
      o.description,
      o.start,
      o.end,
      o.allDay ? 1 : 0,
      nowIso(),
    ),
  );
  await env.DB.prepare("DELETE FROM calendar_event WHERE managed_event_id = ?").bind(eventId).run();
  for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
    await env.DB.batch(inserts.slice(i, i + INSERT_CHUNK));
  }
}

// ── Calendars ───────────────────────────────────────────────────────────────

const CALENDAR_SELECT = `SELECT c.id, c.name, c.color, c.description, c.created_by, c.created_at, c.updated_at,
         (SELECT COUNT(*) FROM managed_event e WHERE e.calendar_id = c.id) AS event_count
  FROM managed_calendar c`;

export async function listManagedCalendars(env: Env, apiOrigin: string): Promise<ManagedCalendarDTO[]> {
  const rows = await env.DB.prepare(`${CALENDAR_SELECT} ORDER BY c.name COLLATE NOCASE`).all<CalendarRow>();
  return rows.results.map((r) => toCalendarDTO(r, apiOrigin));
}

/** One calendar, or null if it doesn't exist. Backs the calendar detail page. */
export async function loadCalendar(env: Env, id: string, apiOrigin: string): Promise<ManagedCalendarDTO | null> {
  const row = await env.DB.prepare(`${CALENDAR_SELECT} WHERE c.id = ?`).bind(id).first<CalendarRow>();
  return row ? toCalendarDTO(row, apiOrigin) : null;
}

export async function createManagedCalendar(
  env: Env,
  input: ManagedCalendarInput,
  createdBy: string,
  apiOrigin: string,
): Promise<ManagedCalendarDTO> {
  const name = input.name?.trim();
  if (!name) throw new ManagedEventError("Name is required.");
  const color = input.color && HEX_COLOR.test(input.color) ? input.color : DEFAULT_COLOR;
  const id = ulid();
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO managed_calendar (id, name, color, description, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  )
    .bind(id, name, color, input.description?.trim() || null, createdBy, ts, ts)
    .run();
  return (await loadCalendar(env, id, apiOrigin))!;
}

export async function updateManagedCalendar(
  env: Env,
  id: string,
  patch: Partial<ManagedCalendarInput>,
  apiOrigin: string,
): Promise<ManagedCalendarDTO | null> {
  const exists = await env.DB.prepare("SELECT id FROM managed_calendar WHERE id = ?").bind(id).first();
  if (!exists) return null;

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof patch.name === "string") {
    if (!patch.name.trim()) throw new ManagedEventError("Name is required.");
    sets.push("name = ?");
    binds.push(patch.name.trim());
  }
  if (typeof patch.color === "string") {
    if (!HEX_COLOR.test(patch.color)) throw new ManagedEventError("Color must be a hex value like #0068A8.");
    sets.push("color = ?");
    binds.push(patch.color);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    binds.push(patch.description?.trim() || null);
  }
  if (!sets.length) throw new ManagedEventError("Nothing to update.");

  sets.push("updated_at = ?");
  binds.push(nowIso(), id);
  await env.DB.prepare(`UPDATE managed_calendar SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  return loadCalendar(env, id, apiOrigin);
}

/** Delete a calendar, its events, and their materialized occurrences. Explicit
 *  multi-statement delete, matching how calendar_source deletion works — nothing
 *  in this schema relies on FK cascade. */
export async function deleteManagedCalendar(env: Env, id: string): Promise<boolean> {
  const res = await env.DB.batch([
    env.DB.prepare("DELETE FROM calendar_event WHERE managed_calendar_id = ?").bind(id),
    env.DB.prepare("DELETE FROM managed_event WHERE calendar_id = ?").bind(id),
    env.DB.prepare("DELETE FROM managed_calendar WHERE id = ?").bind(id),
  ]);
  return !!res[2]?.meta.changes;
}

// ── Events ──────────────────────────────────────────────────────────────────

const EVENT_SELECT = `SELECT e.id, e.calendar_id, e.title, e.location, e.description, e.starts_at, e.ends_at,
         e.all_day, e.recur_freq, e.recur_interval, e.recur_byday, e.recur_until, e.sequence,
         e.created_by, e.created_at, e.updated_at,
         (SELECT COUNT(*) FROM calendar_event ce WHERE ce.managed_event_id = e.id) AS occurrence_count
  FROM managed_event e`;

export async function listManagedEvents(env: Env, calendarId: string): Promise<ManagedEventDTO[]> {
  const rows = await env.DB.prepare(`${EVENT_SELECT} WHERE e.calendar_id = ? ORDER BY e.starts_at ASC`)
    .bind(calendarId)
    .all<EventRow>();
  return rows.results.map(toEventDTO);
}

async function loadEvent(env: Env, id: string): Promise<ManagedEventDTO | null> {
  const row = await env.DB.prepare(`${EVENT_SELECT} WHERE e.id = ?`).bind(id).first<EventRow>();
  return row ? toEventDTO(row) : null;
}

function recurBinds(rec: RecurrenceInput | null): [string | null, number, string | null, string | null] {
  return [rec?.freq ?? null, rec?.interval ?? 1, rec?.byDay?.join(",") ?? null, rec?.until ?? null];
}

export async function createManagedEvent(
  env: Env,
  calendarId: string,
  input: ManagedEventInput,
  createdBy: string,
): Promise<ManagedEventDTO | null> {
  const cal = await env.DB.prepare("SELECT id FROM managed_calendar WHERE id = ?").bind(calendarId).first();
  if (!cal) return null;

  const normalized = normalizeEvent(input);
  const id = ulid();
  // Expand before writing anything, so an over-large rule is rejected without
  // leaving a half-created event behind.
  const occurrences = expandEvent(id, normalized);

  const ts = nowIso();
  const [freq, interval, byday, until] = recurBinds(normalized.recurrence);
  await env.DB.prepare(
    `INSERT INTO managed_event
       (id, calendar_id, title, location, description, starts_at, ends_at, all_day,
        recur_freq, recur_interval, recur_byday, recur_until, sequence, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
  )
    .bind(
      id,
      calendarId,
      normalized.title,
      normalized.location,
      normalized.description,
      normalized.start,
      normalized.end,
      normalized.allDay ? 1 : 0,
      freq,
      interval,
      byday,
      until,
      createdBy,
      ts,
      ts,
    )
    .run();
  await materialize(env, id, calendarId, occurrences);
  return loadEvent(env, id);
}

export async function updateManagedEvent(
  env: Env,
  id: string,
  patch: Partial<ManagedEventInput>,
): Promise<ManagedEventDTO | null> {
  const existing = await env.DB.prepare(`${EVENT_SELECT} WHERE e.id = ?`).bind(id).first<EventRow>();
  if (!existing) return null;

  const current = toEventDTO(existing);
  const normalized = normalizeEvent(patch, {
    title: current.title,
    location: current.location,
    description: current.description,
    start: current.start,
    end: current.end,
    allDay: current.allDay,
    recurrence: current.recurrence,
  });
  const occurrences = expandEvent(id, normalized);

  const [freq, interval, byday, until] = recurBinds(normalized.recurrence);
  await env.DB.prepare(
    `UPDATE managed_event
        SET title = ?, location = ?, description = ?, starts_at = ?, ends_at = ?, all_day = ?,
            recur_freq = ?, recur_interval = ?, recur_byday = ?, recur_until = ?,
            sequence = sequence + 1, updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      normalized.title,
      normalized.location,
      normalized.description,
      normalized.start,
      normalized.end,
      normalized.allDay ? 1 : 0,
      freq,
      interval,
      byday,
      until,
      nowIso(),
      id,
    )
    .run();
  await materialize(env, id, existing.calendar_id, occurrences);
  return loadEvent(env, id);
}

export async function deleteManagedEvent(env: Env, id: string): Promise<boolean> {
  const res = await env.DB.batch([
    env.DB.prepare("DELETE FROM calendar_event WHERE managed_event_id = ?").bind(id),
    env.DB.prepare("DELETE FROM managed_event WHERE id = ?").bind(id),
  ]);
  return !!res[1]?.meta.changes;
}

// ── Publishing ──────────────────────────────────────────────────────────────

/** Render a managed calendar as a text/calendar document, or null if unknown.
 *  Serializes each event's authored recurrence as an RRULE — subscribers expand
 *  it themselves, so the feed stays compact however long the series runs. */
export async function renderManagedCalendarIcs(env: Env, calendarId: string): Promise<string | null> {
  const cal = await env.DB
    .prepare("SELECT id, name FROM managed_calendar WHERE id = ?")
    .bind(calendarId)
    .first<{ id: string; name: string }>();
  if (!cal) return null;

  const rows = await env.DB.prepare(`${EVENT_SELECT} WHERE e.calendar_id = ? ORDER BY e.starts_at ASC`)
    .bind(calendarId)
    .all<EventRow>();

  const events = rows.results.map((r) => {
    const dto = toEventDTO(r);
    return icsInputOf(
      dto.id,
      {
        title: dto.title,
        location: dto.location,
        description: dto.description,
        start: dto.start,
        end: dto.end,
        allDay: dto.allDay,
        recurrence: dto.recurrence,
      },
      r.sequence,
      dto.updatedAt,
    );
  });
  return renderCalendar(cal.name, events);
}

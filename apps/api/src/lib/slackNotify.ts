// THE audit → Slack seam (invariant 22).
//
// Every other projection in this codebase — `publicEventOf`, `publicSheetOf`,
// `issuePageOf` — withholds data from a less-privileged reader INSIDE the
// system. This one faces a THIRD PARTY. A Slack channel has its own retention,
// its own search, its own export, and its own membership list that grows later
// without asking us. So a value that is perfectly safe to write into
// `audit_log` — which only a system admin ever reads, through a route we
// control — is not thereby safe to send here.
//
// Two mechanisms keep that honest, and neither relies on anyone remembering:
//
//  1. FORMATTERS is a curated `Partial<Record<AuditAction, …>>`. An action with
//     no entry sends nothing, which is the default for every action in the
//     union, including one added to it after this file was last touched — the
//     same property invariant 12 gives the public calendar projection. The
//     `satisfies` still catches a misspelled action name at compile time.
//
//  2. A formatter's input type, `SlackFormatInput`, has NO `detail` field. That
//     is the whole defence against forwarding the raw blob: there is nothing to
//     forward, because it is not in scope. `calendar.source.created` is the
//     case that forced this — it puts the feed's `url` in `detail`, and that
//     may be a secret Google/Outlook subscribe link (invariant 12).
//
// What a formatter may say instead comes from exactly three places: the
// entity's own id, the `notify` bag a route curated by hand at the push site,
// and the two shared lookups below.

import type { AuditAction } from "@sd/shared";
import type { Env } from "../env.js";
import type { AuditDraft, AuditMeta } from "./audit.js";
import { displayName, personListableSql } from "./privacy.js";
import { postToSlack } from "./slack.js";

/** The reader this channel represents, expressed as a viewer of the roster.
 *
 *  Nobody: not a system admin, controlling no Person. That is the honest
 *  description — a channel is not a person, and it holds no session — and it is
 *  what makes `personListableSql` below collapse to `unlisted_at IS NULL`, so
 *  an unlisted Person's row simply never comes back and `personLabel` renders
 *  the generic form instead of their name.
 *
 *  Deliberately NOT `personListableSql(x, true)`: passing `isSystemAdmin: true`
 *  short-circuits the seam to the literal `"1"`, which reads like a guard,
 *  satisfies test/personListable.test.ts's scan, and gates nothing. */
const NO_VIEWER = "";

/** What a Person is called in this channel.
 *
 *  Composes `personListableSql` rather than re-deriving the rule, so this call
 *  site is a GUARDED read of `person` under invariant 21, not an exempt one —
 *  it spends none of that test's exemption budget and stays under its scan.
 *
 *  An unlisted Person is withheld here for the reason invariant 21 gives and
 *  one Slack adds: the flag is reversible and a channel is not. A name posted
 *  today outlives the family's decision to come off the roster tomorrow.
 *  `last_name_visibility` is applied on top, with `viewerIsController` false —
 *  nothing about being read from Slack grants a Controller's extra trust. */
export async function personLabel(env: Env, personId: string): Promise<string> {
  const listable = personListableSql(NO_VIEWER, false);
  const row = await env.DB.prepare(
    `SELECT first_name, last_name, last_name_visibility
       FROM person
      WHERE id = ? AND ${listable.sql}`,
  )
    .bind(personId, ...listable.binds)
    .first<{ first_name: string; last_name: string | null; last_name_visibility: "full" | "initial" }>();
  // Covers both "no such Person" and "withheld", on purpose: telling those two
  // apart in the message would make the channel an oracle for the flag.
  if (!row) return "A member";
  return displayName(row.first_name, row.last_name, row.last_name_visibility, false);
}

/** Slack mrkdwn is not HTML, but `&`, `<` and `>` still carry meaning — `<…|…>`
 *  is a link. Member-entered text (names, event and position titles, a
 *  newsletter subject) is escaped so it cannot forge one. Same reasoning as
 *  `esc` in lib/email.ts. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A Slack link. The label is escaped; the URL is ours, never member-entered. */
function link(url: string, label: string): string {
  return `<${url}|${esc(label)}>`;
}

// ── The formatter contract ──────────────────────────────────────────────────

/** Scalars only. A route may not smuggle a row in here by widening the value
 *  type — if a formatter needs a name, it looks it up through the gated helper
 *  above rather than being handed one. */
export type NotifyBag = Readonly<Record<string, string | number | boolean | null>>;

export interface SlackFormatInput {
  /** This action's entity id. Safe on its own — an opaque ULID — but note it
   *  may name a row that is already GONE: `calendar.source.deleted` runs its
   *  DELETE before the draft is flushed. Anything a deletion takes away has to
   *  travel in `notify` instead. */
  entityId: string | null;
  /** What the pushing route decided, by name, may leave the system. Empty
   *  unless that route set `AuditDraft.notify`. */
  notify: NotifyBag;
  /** The acting human — "dana@school.edu", or "admin@school.edu (as
   *  dana@school.edu)" during a masquerade. */
  actor: string;
  env: Env;
}

/** Returns one line of Slack mrkdwn, or null to decline this instance — which
 *  is how `admin.action`, a fifteen-way catch-all, reports only the four ops
 *  that belong in a channel. */
type SlackFormatter = (input: SlackFormatInput) => Promise<string | null> | string | null;

function str(bag: NotifyBag, key: string, fallback = "(unknown)"): string {
  const v = bag[key];
  return typeof v === "string" && v ? esc(v) : fallback;
}
function num(bag: NotifyBag, key: string): number {
  const v = bag[key];
  return typeof v === "number" ? v : 0;
}

// ── The allowlist ───────────────────────────────────────────────────────────
//
// Curated for a school PTO's channel: things that are rare, or security-
// relevant, or that someone is actively waiting to hear. Two whole families are
// deliberately absent and should stay absent unless the reasoning changes:
//
//   Routine member traffic — auth.signin/signout, person.updated, contact.*,
//   share.* — is the highest-frequency thing in the log and would bury
//   everything else.
//
//   Authoring CRUD — calendar.event.*, calendar.managed.*, volunteer.sheet.*,
//   volunteer.position.*, newsletter.issue.updated — fires once per HTTP
//   REQUEST, and the coalescing below only merges drafts within one request.
//   Building a sheet with six positions is six requests, so it would be six
//   messages however this file batches. newsletter.issue.updated is the worst
//   of them: it fires on every autosave while someone is typing.

const FORMATTERS = {
  // ── Volunteering: the one member-initiated action worth watching live ──
  "volunteer.signup.created": async ({ env, notify }) => {
    const who = await personLabel(env, String(notify.personId ?? ""));
    const where = env.CALENDAR_URL ? ` ${link(`${env.CALENDAR_URL}/v/${notify.sheetSlug}`, "View sheet")}` : "";
    return (
      `:raising_hand: *${esc(who)}* signed up for *${str(notify, "positionTitle")}*` +
      ` — ${str(notify, "eventTitle")} (${num(notify, "filled")}/${num(notify, "slots")} filled).${where}`
    );
  },

  "volunteer.signup.deleted": async ({ env, notify }) => {
    const who = await personLabel(env, String(notify.personId ?? ""));
    const where = env.CALENDAR_URL ? ` ${link(`${env.CALENDAR_URL}/v/${notify.sheetSlug}`, "View sheet")}` : "";
    return (
      `:leftwards_arrow_with_hook: *${esc(who)}* gave back *${str(notify, "positionTitle")}*` +
      ` — ${str(notify, "eventTitle")} (${num(notify, "filled")}/${num(notify, "slots")} filled).${where}`
    );
  },

  // ── Newsletter: the two "it actually left the building" events ──
  "newsletter.issue.sent": async ({ env, entityId, notify, actor }) => {
    const issue = await issueLabel(env, entityId);
    const read = issue && env.NEWSLETTER_URL ? ` ${link(`${env.NEWSLETTER_URL}/n/${issue.slug}`, "Read it")}` : "";
    return (
      `:mailbox_with_mail: Newsletter *${esc(issue?.title ?? "(untitled)")}* sent to` +
      ` ${num(notify, "recipientTotal")} subscribers — ${actor}.${read}`
    );
  },

  "newsletter.issue.retried": async ({ env, entityId, actor }) => {
    const issue = await issueLabel(env, entityId);
    return `:arrows_counterclockwise: Retrying delivery of *${esc(issue?.title ?? "(untitled)")}* — ${actor}.`;
  },

  // ── Instance-level admin: rare, wide blast radius ──
  "bulk.import": ({ notify, actor }) =>
    `:inbox_tray: *Roster import* — ${num(notify, "rows")} rows → ${num(notify, "personsCreated")} people,` +
    ` ${num(notify, "groupsCreated")} groups, ${num(notify, "invitesQueued")} invites queued` +
    ` (${num(notify, "emailsSent")} emailed) — ${actor}.`,

  "registration.toggled": ({ notify, actor }) =>
    `:door: Registration ${notify.open === true ? "*opened*" : "*closed*"} — ${actor}.`,

  // ── Security ──
  "masquerade.start": ({ notify, actor }) =>
    `:eyes: ${actor} started masquerading as *${str(notify, "targetEmail")}*.`,

  /** The catch-all, dispatched on the `op` its route curated into `notify`.
   *  Only these four ops reach the channel; every other op (group.create,
   *  member.add, bootstrap_admin, …) declines by falling through to null. */
  "admin.action": ({ notify, actor }) => {
    const email = str(notify, "email");
    switch (notify.op) {
      case "user.disabled":
        return `:no_entry: *${email}* was removed from the directory — ${actor}.`;
      case "user.enabled":
        return `:white_check_mark: *${email}* was restored — ${actor}.`;
      case "user.admin.granted":
        return `:key: *${email}* was made a system admin — ${actor}.`;
      case "user.admin.revoked":
        return `:key: *${email}* is no longer a system admin — ${actor}.`;
      default:
        return null;
    }
  },

  // ── Calendar feeds ──
  "calendar.source.created": async ({ env, entityId, actor }) => {
    // The name is READ BACK from the row, never taken from `detail` — which
    // here holds the feed's `url`, possibly a secret subscribe link
    // (invariant 12). The formatter cannot see `detail` at all; this comment
    // records why that mattered enough to shape the type.
    const row = entityId
      ? await env.DB.prepare("SELECT name FROM calendar_source WHERE id = ?")
          .bind(entityId)
          .first<{ name: string }>()
      : null;
    return `:calendar: Calendar feed added: *${esc(row?.name ?? "(unknown)")}* — ${actor}.`;
  },

  "calendar.source.deleted": ({ notify, actor }) =>
    // No lookup possible: the row is gone by the time this runs, which is why
    // its route captures the name into `notify` before the delete.
    `:calendar: Calendar feed removed: *${str(notify, "name")}* — ${actor}.`,
} satisfies Partial<Record<AuditAction, SlackFormatter>>;

// ── Shared lookups ──────────────────────────────────────────────────────────

/** A newsletter issue's title and slug. Safe to read back: unlike a deleted
 *  calendar source, an issue still exists when it is sent or retried. */
async function issueLabel(
  env: Env,
  issueId: string | null,
): Promise<{ title: string; slug: string } | null> {
  if (!issueId) return null;
  return env.DB.prepare("SELECT title, slug FROM newsletter_issue WHERE id = ?")
    .bind(issueId)
    .first<{ title: string; slug: string }>();
}

/** The acting human. `user.email` carries no enumeration gate — invariant 21 is
 *  a rule about `person`, not `user` — so this is the same plain lookup
 *  GET /admin/audit already does to render its actor column.
 *
 *  Resolved from `meta.actorUserId` (the REAL human) rather than from
 *  `c.var.auth.email` (the EFFECTIVE one), because those differ during a
 *  masquerade and the admin is the one who acted. Both ids come back in one
 *  statement. */
async function actorLabel(env: Env, meta: AuditMeta): Promise<string> {
  if (!meta.actorUserId) return "someone signed out";
  const ids = meta.masqueradingAs ? [meta.actorUserId, meta.masqueradingAs] : [meta.actorUserId];
  const rows = await env.DB.prepare(
    `SELECT id, email FROM user WHERE id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(...ids)
    .all<{ id: string; email: string }>();
  const byId = new Map(rows.results.map((r) => [r.id, r.email]));
  const actor = esc(byId.get(meta.actorUserId) ?? "(unknown)");
  if (!meta.masqueradingAs) return actor;
  return `${actor} (as ${esc(byId.get(meta.masqueradingAs) ?? "(unknown)")})`;
}

// ── Entry point ─────────────────────────────────────────────────────────────

/** How many lines one message may carry before the rest are summarised. Not a
 *  rate limit — the allowlist above is what keeps the volume down — just a
 *  ceiling so a future endpoint that loops `audit.push` over rows can't post a
 *  thousand-line wall. */
const MAX_LINES = 20;

/** Build the Slack lines for one request's worth of audit drafts.
 *
 *  Exported for tests: this is the seam whose behaviour is worth pinning, and
 *  it is pure apart from the two lookups above. Returns [] when nothing in the
 *  batch is curated, which is the common case. */
export async function slackLinesOf(
  env: Env,
  drafts: readonly AuditDraft[],
  meta: AuditMeta,
): Promise<string[]> {
  // `Object.hasOwn`, not `in`: `in` walks the prototype chain, so "toString"
  // would match, resolve to `Object.prototype.toString`, and — called as a
  // formatter — return the truthy string "[object Object]" straight into the
  // channel. Unreachable while every push site uses an `AuditAction` literal,
  // but "an action with no entry sends nothing" is either true of any string or
  // it is not a property worth claiming.
  const curated = drafts.filter((d) => Object.hasOwn(FORMATTERS, d.action));
  if (!curated.length) return [];

  // One lookup for the whole batch rather than one per line.
  const actor = await actorLabel(env, meta);

  const lines: string[] = [];
  for (const draft of curated) {
    const formatter = FORMATTERS[draft.action as keyof typeof FORMATTERS] as SlackFormatter;
    const line = await formatter({
      entityId: draft.entityId ?? null,
      notify: draft.notify ?? {},
      actor,
      env,
    });
    if (line) lines.push(line);
  }
  return lines;
}

/** Fire-and-forget entry point, called from the audit middleware with the whole
 *  request's drafts.
 *
 *  Coalesces to ONE post per request: `c.var.audit` is already the batch, and a
 *  handler that pushes two curated drafts should read as one event in the
 *  channel rather than two. Never throws — a Slack failure must not affect the
 *  audit write, and a dropped message is cosmetic where a dropped audit row is
 *  not (invariant 5), which is why the two share no machinery. */
export async function notifySlackForAudit(
  env: Env,
  drafts: readonly AuditDraft[],
  meta: AuditMeta,
): Promise<void> {
  try {
    const lines = await slackLinesOf(env, drafts, meta);
    if (!lines.length) return;
    const shown = lines.slice(0, MAX_LINES);
    if (lines.length > shown.length) shown.push(`…and ${lines.length - shown.length} more.`);
    // One line posts as itself; several post as a bulleted list.
    const text = shown.length === 1 ? shown[0]! : shown.map((l) => `• ${l}`).join("\n");
    await postToSlack(env, { text });
  } catch (err) {
    console.error(`[slack] notify failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

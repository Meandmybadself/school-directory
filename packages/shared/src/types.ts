// Domain types shared between the API (Workers) and the web client.
// These describe the *serialized* shapes that cross the wire — privacy filtering
// and geo-coordinate stripping happen on the server before anything here is sent.

export type Locale = "en" | "es" | "zh" | "so";
export const LOCALES: Locale[] = ["en", "es", "zh", "so"];

export type Capability =
  | "parent"
  | "teacher"
  | "staff"
  | "student"
  | "household_admin";

/** All capability codes (mirrors the `capability` seed table). */
export const CAPABILITIES: Capability[] = [
  "parent",
  "teacher",
  "staff",
  "student",
  "household_admin",
];

/** Capabilities a User may assign when creating a Person they manage.
 *  `household_admin` is intentionally excluded — it's a household role granted
 *  through group membership, not a self-assigned type. */
export const ASSIGNABLE_CAPABILITIES: Capability[] = [
  "parent",
  "student",
  "teacher",
  "staff",
];

/** Visibility level on a field or contact item. There is no "public" level. */
export type Visibility = "service" | "private";

/** How a Person's last name renders to viewers who can see it.
 *  Note: there is intentionally no "hidden" — a name is needed to disambiguate
 *  the many members who share a first name. */
export type LastNameDisplay = "full" | "initial";

export type ContactType = "address" | "phone" | "email" | "url";

export type GroupKind = "household" | "classroom" | "generic";

// ── Wire DTOs ──────────────────────────────────────────────────────────────

/** A contact item as serialized to a client. geo_lat/geo_lng are NEVER included. */
export interface ContactItemDTO {
  id: string;
  type: ContactType;
  label: string | null;
  value: string;
  visibility: Visibility;
  /** Address-only: whether this address opts into neighbor discovery. */
  neighborDiscoverable?: boolean;
  /** Address-only: true when the address is geocoded AND the viewer may see the
   *  exact location (a controller). Drives the server-rendered map thumbnail.
   *  Coordinates themselves are never serialized. */
  hasLocation?: boolean;
  /** Resolved share state for the active viewer's UI chip. */
  shareCount?: number;
  /** Set when this item is cascaded from a group the Person belongs to (e.g. a
   *  household's shared address). Read-only on the Person; edited on the group. */
  viaGroup?: { id: string; name: string };
}

export interface PersonSummaryDTO {
  id: string;
  /** Already last-name-rule-applied for the requesting viewer (e.g. "Dana R."). */
  displayName: string;
  firstName: string;
  capabilities: Capability[];
  photoUrl: string | null;
}

export interface PersonProfileDTO extends PersonSummaryDTO {
  /** Present only when the viewer controls this Person (full editable view). */
  lastName?: string | null;
  lastNameDisplay?: LastNameDisplay;
  contacts: ContactItemDTO[];
  /** Contacts cascaded from the Person's groups (e.g. household address),
   *  privacy-filtered for the viewer. Read-only; carry `viaGroup`. */
  groupContacts?: ContactItemDTO[];
  groups: GroupSummaryDTO[];
  /** True when the requesting User is a Controller of this Person. */
  controlledByViewer: boolean;
  /** Set when the profile was built with `?as=member`: a Controller asked to see
   *  it exactly as an ordinary member does, so private items are absent. */
  previewAsMember?: boolean;
  /** Preview only — how many of this Person's own contact items members cannot
   *  see. Group-owned cascaded items are excluded; they're edited on the group. */
  hiddenFromMembers?: number;
  /** True when this Person is off the roster (migration 0018). Only ever present
   *  for a viewer who already cleared the enumeration gate — a system admin or a
   *  Controller — because nobody else is served this profile at all. */
  unlisted?: boolean;
}

export interface GroupSummaryDTO {
  id: string;
  kind: GroupKind;
  name: string;
  memberCount: number;
  /** Viewer's role in this group, if any. */
  isAdmin?: boolean;
  /** Parent group in the hierarchy (School → Grade → Classroom), or null. */
  parentId?: string | null;
}

/** A bare group reference for breadcrumbs / pickers. */
export interface GroupRefDTO {
  id: string;
  name: string;
  kind: GroupKind;
}

export interface GroupMemberDTO {
  personId: string;
  /** Last-name-rule-applied display name. */
  displayName: string;
  title: string | null;
  isAdmin: boolean;
  /** True when this member is one of the viewing User's controlled Persons. */
  isYou: boolean;
  capabilities: Capability[];
  photoUrl: string | null;
}

export interface GroupDetailDTO {
  id: string;
  kind: GroupKind;
  name: string;
  memberCount: number;
  /** True when the viewer's active Person is an admin of this group. */
  viewerIsAdmin: boolean;
  /** True when the viewer's active Person is a member at all. */
  viewerIsMember: boolean;
  /** True when the viewer may delete this group. Deleting takes the authority to
   *  create the kind (generic groups are system-admin-only) plus admin rights
   *  over the group; the server owns the rule, the UI just reads it. */
  viewerCanDelete?: boolean;
  /** True when the viewer may add, retitle and remove members. Wider than
   *  `viewerIsAdmin`: a system admin runs every group's roster even when they
   *  belong to none of them, which is the same authority `requireGroupAdmin`
   *  enforces on the member routes. Kept separate because `viewerIsAdmin` also
   *  means "you run this group" for the badge and the group-owned contacts,
   *  which a system admin who isn't a member is not offered. */
  viewerCanManageMembers?: boolean;
  members: GroupMemberDTO[];
  /** Group-owned contact items (e.g. household cascading address), filtered. */
  contacts: ContactItemDTO[];
  /** Hierarchy. `ancestors` runs root → … → immediate parent (breadcrumb);
   *  `children` are the immediate sub-groups. A household may sit UNDER a group
   *  but never contains one, so `children` is always empty for a household. */
  parentId?: string | null;
  ancestors?: GroupRefDTO[];
  children?: GroupSummaryDTO[];
}

export interface ControllablePersonDTO {
  id: string;
  firstName: string;
  displayName: string;
  capabilities: Capability[];
  photoUrl: string | null;
}

// ── Calendar ────────────────────────────────────────────────────────────────

/** An admin-managed public ICS feed that populates the shared calendar. */
export interface CalendarSourceDTO {
  id: string;
  url: string;
  name: string;
  /** Hex color for the source's event tag. */
  color: string;
  enabled: boolean;
  /** ISO-8601, or null until first fetched. */
  lastFetchedAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  /** Count of stored upcoming events from this source. */
  eventCount: number;
}

export interface CalendarSourceInput {
  url: string;
  name: string;
  color?: string;
  enabled?: boolean;
}

/** Where an event came from: an imported ICS feed, or a calendar authored here. */
export type CalendarEventKind = "imported" | "managed";

/** A single (possibly recurrence-expanded) event, already source-joined. */
export interface CalendarEventDTO {
  /** Render key only — NOT a durable handle. Materialized rows are recreated
   *  (with fresh ULIDs) whenever their feed refreshes or their event is edited.
   *  Use `seriesId` + `recurrenceId` to refer to a managed occurrence. */
  id: string;
  kind: CalendarEventKind;
  /** Managed only — the durable `managed_event` id this occurrence belongs to. */
  seriesId?: string;
  /** Managed only — ISO-8601 UTC start of this occurrence, the RECURRENCE-ID
   *  equivalent. `(seriesId, recurrenceId)` is stable across re-materialization
   *  and is what a volunteer sheet attaches to. */
  recurrenceId?: string;
  title: string;
  location: string | null;
  description: string | null;
  /** ISO-8601 UTC. */
  start: string;
  /** ISO-8601 UTC, or null. */
  end: string | null;
  allDay: boolean;
  /** Every calendar this (de-duplicated) event appears on — imported source ids
   *  and/or managed calendar ids — for the per-calendar filter. The event is
   *  hidden only when all of its calendars are hidden. */
  sourceIds: string[];
  /** Representative calendar, for the event's color tag. */
  source: { name: string; color: string };
  /** Slug of this occurrence's PUBLISHED volunteer sheet, or null when it has
   *  none. Managed events only — an imported event has no durable handle to hang
   *  a sheet off (invariant 8). Drives the "volunteers needed" affordance in the
   *  agenda; the sheet itself lives at /v/{slug} on the calendar site. */
  volunteerSlug: string | null;
}

/** The subset of an event an ANONYMOUS caller may see, served by
 *  /calendar-public/events.
 *
 *  Hand-written rather than `Omit<CalendarEventDTO, …>` on purpose, exactly like
 *  NewsletterBrandingDTO: a field added to CalendarEventDTO must be added HERE
 *  and to `publicEventOf()` before it can reach the public agenda. Structural
 *  typing would have made that a silent, automatic leak instead.
 *
 *  `seriesId`/`recurrenceId` are deliberately withheld even though they carry no
 *  PII today. They are the durable handle a volunteer signup attaches to (see
 *  CalendarEventDTO above and CLAUDE.md invariant 8), so withholding the join
 *  key means that even a careless future edit to `publicEventOf` can't make
 *  member signup data addressable from an unauthenticated response.
 *
 *  `volunteerSlug` IS carried, and is the one considered exception. It is an
 *  opaque per-sheet handle, not the durable join key: it addresses the public
 *  volunteer page — which itself publishes counts and never names — and it
 *  cannot be used to reach the member-only sheet, which is gated on the session
 *  rather than on knowing an id. The whole point of the sheet having its own
 *  slug is that the public link needn't reveal (seriesId, recurrenceId). */
export interface PublicCalendarEventDTO {
  id: string;
  kind: CalendarEventKind;
  title: string;
  location: string | null;
  description: string | null;
  start: string;
  end: string | null;
  allDay: boolean;
  sourceIds: string[];
  source: { name: string; color: string };
  volunteerSlug: string | null;
}

/** Public-facing calendar feed — for the show/hide filter and ICS download link.
 *  The URL is exposed (these are public feeds); admin-only status stays private.
 *  Covers both imported sources (the upstream feed URL) and managed calendars
 *  (this API's own published /ics/:id.ics URL). */
export interface CalendarFeedDTO {
  id: string;
  name: string;
  color: string;
  url: string;
}

/** The subset of a calendar an ANONYMOUS caller may see. Hand-written for the
 *  same reason as PublicCalendarEventDTO.
 *
 *  `url` is ALWAYS a feed on this API's own origin — /ics/:id.ics for a managed
 *  calendar, /ics/source/:id.ics for an imported one — and never the URL an
 *  admin pasted. Providers like Google and Outlook hand out secret subscribe
 *  links that grant the raw upstream feed, which carries ORGANIZER/ATTENDEE
 *  addresses this app deliberately never stores, and a URL served publicly can't
 *  be un-published. The imported form is therefore a mirror of what we store
 *  (see renderImportedSourceIcs), which is exactly the data the agenda already
 *  shows. Members still get the real upstream URLs from the authenticated
 *  /calendar/sources. */
export interface PublicCalendarFeedDTO {
  id: string;
  name: string;
  color: string;
  url: string;
}

// ── Managed calendars (authored here, rather than imported) ─────────────────

export type RecurFreq = "daily" | "weekly" | "monthly";

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** A recurrence rule, stored structured. The RRULE line in a published feed is
 *  derived from this — the string form is never the source of truth. */
export interface RecurrenceInput {
  freq: RecurFreq;
  /** Every N days/weeks/months. Defaults to 1. */
  interval?: number;
  /** Weekly only — which weekdays the event lands on. */
  byDay?: Weekday[];
  /** ISO-8601 UTC. Required: bounding every rule keeps expansion finite. */
  until: string;
}

/** A calendar created in this app. Analogous to CalendarSourceDTO, but instead
 *  of fetching an external URL it publishes one. */
export interface ManagedCalendarDTO {
  id: string;
  name: string;
  color: string;
  description: string | null;
  /** Count of events (series, not expanded occurrences) on this calendar. */
  eventCount: number;
  /** Absolute, public, unauthenticated .ics URL for this calendar. */
  icsUrl: string;
  createdBy: string | null;
  createdAt: string;
}

export interface ManagedCalendarInput {
  name: string;
  color?: string;
  description?: string | null;
}

/** One authored event and its recurrence rule — the editable master row. */
export interface ManagedEventDTO {
  /** Durable series id: created once, never regenerated. */
  id: string;
  calendarId: string;
  title: string;
  location: string | null;
  description: string | null;
  /** ISO-8601 UTC start of the first occurrence. */
  start: string;
  /** ISO-8601 UTC end, or null. For all-day events this is the RFC5545-exclusive
   *  day after the last day, not the inclusive last day. */
  end: string | null;
  allDay: boolean;
  recurrence: RecurrenceInput | null;
  /** Number of materialized occurrences currently visible in the agenda. */
  occurrenceCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedEventInput {
  title: string;
  location?: string | null;
  description?: string | null;
  start: string;
  end?: string | null;
  allDay?: boolean;
  recurrence?: RecurrenceInput | null;
}

// ── Volunteer signups ───────────────────────────────────────────────────────
//
// A volunteer SHEET hangs off one occurrence of a managed event and holds
// POSITIONS ("snack table, 4 people, 5–7pm"); members claim a SIGNUP on a
// position as one of the Persons they control. Three audiences read this data
// and they see three different things:
//
//   anonymous  → PublicVolunteerSheetDTO: positions and filled COUNTS, no names
//   member     → VolunteerSheetDTO: the same plus who took each spot
//   admin      → VolunteerSheetDTO with `manage` set
//
// The first split is the one that matters and it is enforced server-side in
// lib/volunteers.ts's `publicSheetOf`, the companion to `publicEventOf`.

/** One person's claim on a position. Member-visible only — this shape never
 *  appears in an anonymous response. */
export interface VolunteerSignupDTO {
  id: string;
  personId: string;
  /** Last-name-rule-applied, like every other name that crosses the wire. */
  displayName: string;
  note: string | null;
  /** True when this signup is for one of the viewing User's controlled Persons —
   *  i.e. when the viewer may withdraw it. */
  isYou: boolean;
  createdAt: string;
}

/** A job on a sheet: what it is, how many people it takes, and optionally the
 *  slice of the event they're needed for. */
export interface VolunteerPositionDTO {
  id: string;
  title: string;
  description: string | null;
  /** How many people are needed. */
  slots: number;
  /** How many are signed up. Always present, for both audiences. */
  filled: number;
  /** Optional shift window, ISO-8601 UTC. Display-only; independent of the
   *  event's own start/end, since a shift may cover part of an event. */
  startsAt: string | null;
  endsAt: string | null;
  /** Who took the spots. Member-only — absent from the public projection. */
  signups: VolunteerSignupDTO[];
}

/** The occurrence a sheet belongs to, resolved from `managed_event` plus the
 *  sheet's own `occurrence_start` — never from `calendar_event`, whose ids and
 *  rows are disposable (invariant 8). */
export interface VolunteerEventDTO {
  /** The durable `managed_event` id. Member-only; see PublicVolunteerSheetDTO. */
  seriesId: string;
  /** ISO-8601 UTC start of this occurrence. Member-only, as the RECURRENCE-ID
   *  half of the durable pair — the same instant reaches anonymous callers as
   *  the plain `start` below, which is what the public agenda already shows. */
  recurrenceId: string;
  title: string;
  location: string | null;
  description: string | null;
  start: string;
  end: string | null;
  allDay: boolean;
}

/** A sheet as a signed-in member sees it. */
export interface VolunteerSheetDTO {
  id: string;
  /** The public URL segment: /v/{slug} on the calendar site. */
  slug: string;
  intro: string | null;
  /** ISO-8601 UTC after which claims are refused, or null for "until it fills". */
  closesAt: string | null;
  /** Server's verdict on whether claims are currently accepted — resolved here
   *  rather than in the client so a stale clock can't invite a doomed request. */
  closed: boolean;
  /** False while the sheet is a draft; the public route 404s on those. */
  published: boolean;
  event: VolunteerEventDTO;
  positions: VolunteerPositionDTO[];
  /** True when the viewer may edit the sheet (system admins today). */
  canManage: boolean;
  /** Admin-facing: the occurrence this sheet names no longer exists in the
   *  materialized agenda, because the series was edited after it was created.
   *  The sheet and its signups are intact — it just isn't on the calendar. */
  orphaned?: boolean;
}

/** The subset of a sheet an ANONYMOUS caller may see, served by
 *  /volunteers-public/sheets/:slug.
 *
 *  Hand-written rather than `Omit<VolunteerSheetDTO, …>` for the same reason as
 *  PublicCalendarEventDTO: structural typing would let a field added upstream
 *  ride along into a public response by itself. Build it field by field in
 *  `publicSheetOf`, never by spreading.
 *
 *  Two withholdings are the point of this type. **Names never appear** — a
 *  volunteer's identity is member-only (invariant 1), so positions carry a
 *  `filled` count and nothing else about who filled them; `VolunteerSignupDTO`
 *  must never be reachable from here. And `seriesId`/`recurrenceId` are withheld
 *  exactly as PublicCalendarEventDTO withholds them, so the durable handle that
 *  addresses member signup data stays out of unauthenticated responses. The
 *  occurrence's instant still reaches the reader as `event.start`, which the
 *  public agenda publishes anyway; it is the durable PAIR that is withheld. */
export interface PublicVolunteerSheetDTO {
  slug: string;
  intro: string | null;
  closesAt: string | null;
  closed: boolean;
  event: {
    title: string;
    location: string | null;
    description: string | null;
    start: string;
    end: string | null;
    allDay: boolean;
  };
  positions: Array<{
    id: string;
    title: string;
    description: string | null;
    slots: number;
    filled: number;
    startsAt: string | null;
    endsAt: string | null;
  }>;
}

export interface VolunteerSheetInput {
  /** ISO-8601 UTC start of the occurrence to open. Create-only — moving a sheet
   *  to another date would silently relocate everyone who already signed up. */
  occurrenceStart?: string;
  intro?: string | null;
  closesAt?: string | null;
  published?: boolean;
}

export interface VolunteerPositionInput {
  title: string;
  description?: string | null;
  slots?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  sortOrder?: number;
}

export interface VolunteerSignupInput {
  /** A Person the requesting User controls. */
  personId: string;
  note?: string | null;
}

/** One occurrence of an authored event, for the admin's "which date?" picker.
 *  Read from the materialized agenda, so it lists exactly the dates a member
 *  can currently see. */
export interface ManagedOccurrenceDTO {
  /** ISO-8601 UTC start — the value that becomes a sheet's `occurrenceStart`. */
  start: string;
  end: string | null;
  allDay: boolean;
  /** The sheet already open on this date, if any. */
  sheet: { id: string; slug: string; published: boolean; positionCount: number } | null;
}

/** A current grantee of a share, for the visibility sheet's "Shared with" list. */
export interface ShareGranteeDTO {
  id: string; // share row id
  targetKind: "person" | "group";
  targetId: string;
  name: string;
}

/** A pickable target when adding a grantee. */
export interface ShareTargetDTO {
  kind: "person" | "group";
  id: string;
  name: string;
  /** For groups, the kind (household/classroom/generic) for the icon. */
  groupKind?: GroupKind;
}

export interface CreateShareBody {
  subjectKind: "contact_item" | "field";
  subjectRef: string;
  targetKind: "person" | "group";
  targetId: string;
}

export interface AdminUserDTO {
  id: string;
  email: string;
  isSystemAdmin: boolean;
  personCount: number;
  /** Disabled accounts cannot sign in, receive the newsletter, or be
   *  masqueraded as, and they keep everything they own. Reversible. */
  disabled: boolean;
  /** ISO-8601, or null while active. */
  disabledAt: string | null;
}

/** What permanently deleting a User would remove — a dry run, computed on
 *  demand and never acted on automatically.
 *
 *  The whole point of this shape is that "delete a user and everything they
 *  made" is not a thing this schema can answer: `grp` records no creator, and
 *  `control` is many-to-many precisely so two parents can share a child. So the
 *  report distinguishes what is genuinely only theirs from what merely passes
 *  through them, and an admin reads it before anything irreversible happens. */
export interface UserDeletionImpactDTO {
  user: { id: string; email: string; disabled: boolean };
  /** Sole controller — nobody else can edit these, so a delete would take them. */
  orphanedPersons: { id: string; name: string }[];
  /** Co-controlled. A delete would drop only this user's control row and leave
   *  the Person for whoever else holds one. */
  sharedPersons: { id: string; name: string; otherControllers: number }[];
  /** Households left with no members once the orphaned Persons are gone. */
  emptiedHouseholds: { id: string; name: string }[];
  /** Groups this user administers that would SURVIVE — classrooms and generic
   *  groups belong to the school, not to a member, so a delete never removes
   *  them. Listed because losing their only admin is worth knowing about. */
  retainedGroupsAdministered: { id: string; name: string; kind: GroupKind }[];
  /** Audit rows naming this user. Always retained — the log is append-only and
   *  hash-chained, so removing entries would break tamper-evidence and erase
   *  the record of what they did. */
  auditEntries: number;
}

/** One normalized row submitted to bulk import (client maps CSV columns to these). */
export interface BulkImportRow {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  group?: string;
  groupKind?: GroupKind;
  title?: string;
  /** Comma- or space-separated capability codes. */
  capabilities?: string;
}

export interface BulkImportResult {
  dryRun: boolean;
  rowsProcessed: number;
  personsCreated: number;
  personsMatched: number;
  groupsCreated: number;
  membershipsCreated: number;
  invitesQueued: number;
  errors: { row: number; message: string }[];
}

export const BULK_IMPORT_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "group",
  "title",
  "capabilities",
] as const;
export type BulkImportField = (typeof BULK_IMPORT_FIELDS)[number];

export interface AuditEntryDTO {
  id: string;
  action: AuditAction | string;
  /** Acting human's email (the admin during masquerade), or null for system. */
  actorEmail: string | null;
  /** When masquerading, the email of the target being acted as. */
  masqueradingAsEmail: string | null;
  entityKind: string | null;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
}

export interface MeDTO {
  user: {
    id: string;
    email: string;
    isSystemAdmin: boolean;
    locale: Locale | null;
  };
  persons: ControllablePersonDTO[];
  activePersonId: string | null;
  masqueradingAs: string | null;
}

export interface NeighborDTO {
  /** Person (or household) id — the card links to this profile/group. */
  id: string;
  /** Person or household display name (last-name rule applied). */
  name: string;
  /** Rounded, human string e.g. "~0.4 mi". Never raw coordinates. */
  approxDistance: string;
  kind: "person" | "household";
}

export type NeighborsResponse =
  | { neighbors: NeighborDTO[] }
  | { addCta: true };

// ── Request bodies ──────────────────────────────────────────────────────────

export interface AuthStartBody {
  email: string;
  /** Origin to return to after the magic link is clicked, so a sibling app
   *  (calendar.eisenhower.school) can start a sign-in and get the member back.
   *  Ignored unless it exactly matches an allowed origin; omit for the default. */
  returnTo?: string;
}

export interface ContactItemInput {
  type: ContactType;
  label?: string | null;
  value: string;
  visibility?: Visibility;
  neighborDiscoverable?: boolean;
}

export interface PersonPatchBody {
  firstName?: string;
  lastName?: string | null;
  lastNameDisplay?: LastNameDisplay;
}

/** Body for POST /me/persons — create a Person the requesting User controls.
 *  Used both for self-onboarding (name only) and for adding family members. */
export interface CreatePersonBody {
  firstName: string;
  lastName?: string | null;
  /** Optional capability codes to grant (validated server-side). */
  capabilities?: Capability[];
  /** Optional household group to add the new Person to. Must be a household the
   *  requesting User administers; the household's address then cascades. */
  householdId?: string | null;
}

/** A household the requesting User administers (for the create-person picker). */
export interface MyHouseholdDTO {
  id: string;
  name: string;
}

// ── Instance settings ──────────────────────────────────────────────────────

/** How system admins hear about something that happened without them. `off` by
 *  default (NFR-1): the instance sends nothing until an admin opts in.
 *  - `instant` — one email per event, as it happens.
 *  - `daily`   — a single digest of everything since the last one.
 *
 *  Shared by new-member notifications and new-subscriber notifications; the two
 *  are separate settings on separate screens, but the shape and the machinery
 *  behind them (lib/notify.ts) are one. */
export type NotifyMode = "off" | "instant" | "daily";

export const NOTIFY_MODES = ["off", "instant", "daily"] as const;

/** How system admins hear about new sign-ups specifically. */
export type NewUserNotify = NotifyMode;

export const NEW_USER_NOTIFY_MODES = NOTIFY_MODES;

export interface NotificationSettingsDTO {
  newUser: NewUserNotify;
}

// ── Newsletter ─────────────────────────────────────────────────────────────

/** `draft` is the only mutable state. `sending` is entered by an atomic
 *  compare-and-swap so a double-clicked Send can't queue a second fan-out, and
 *  it is never left except by the fan-out finishing. */
export type NewsletterIssueStatus = "draft" | "sending" | "sent";

export const NEWSLETTER_ISSUE_STATUSES = ["draft", "sending", "sent"] as const;

/** One recipient's delivery outcome for one issue. */
export type NewsletterRecipientStatus = "pending" | "sent" | "failed";

/** A ProseMirror/TipTap document node, described structurally rather than
 *  imported from @tiptap/core — `@sd/shared` stays framework-free, and the
 *  editor and this type independently describe the same stored wire shape. */
export interface NewsletterNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: NewsletterNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

/** The one newsletter-specific node type. It is an atom: it has no children,
 *  and its event list is resolved (live while drafting, frozen at send) rather
 *  than stored in the document. */
export const EVENTS_BLOCK_TYPE = "eventsBlock";

/** Attributes on an `eventsBlock` node. Several may appear in one issue, each
 *  with its own calendars and window, so `blockId` keys the frozen snapshot. */
export interface NewsletterEventsBlockAttrs {
  /** Assigned when the block is inserted; stable for the issue's lifetime. */
  blockId: string;
  /** calendar_source / managed_calendar ids (see CalendarFeedDTO). Empty means
   *  "every calendar", matching the settings default. */
  calendarIds: string[];
  /** Days ahead of the render moment to include. Used only when the block has
   *  no fixed range — see `rangeStart`. */
  lookaheadDays: number;
  /** Start of an explicit window, as a YYYY-MM-DD calendar date read in the
   *  school's zone. Set together with `rangeEnd`; when BOTH are present the
   *  block is pinned to those dates and `lookaheadDays` is ignored. Null means
   *  the rolling "next N days" window. */
  rangeStart: string | null;
  /** Inclusive end of the explicit window; see `rangeStart`. */
  rangeEnd: string | null;
  /** Events the author removed from the block, as `eventKey` handles. Applied
   *  at render time, so the frozen snapshot keeps the whole queried window and
   *  the removal travels with the (immutable) document instead. */
  excluded: string[];
  /** Optional heading rendered above the list; null renders no heading. */
  heading: string | null;
}

/** Instance-wide newsletter configuration. Stored as one JSON blob under a
 *  single `setting` key rather than its own table. */
export interface NewsletterSettingsDTO {
  /** Display name on the From header. */
  senderName: string;
  /** From address. Must be a Resend-verified sender or delivery fails. */
  senderEmail: string;
  replyTo: string | null;
  /** The footer, as hand-written HTML. Used in the email's HTML part and on the
   *  public archive pages; the text-only part gets it flattened by
   *  `footerTextOf`. Stored already sanitized by `sanitizeFooterHtml` — see
   *  invariant 9 in CLAUDE.md. */
  footerHtml: string;
  /** Physical mailing address, expected in bulk mail. */
  mailingAddress: string;
  unsubscribeWording: string;
  /** Absolute URL of an uploaded logo, or null. */
  logoUrl: string | null;
  /** Hex, e.g. "#0068A8". Applied to the email and the public page. */
  accentColor: string;
  /** Masthead title, distinct from any single issue's title. */
  newsletterTitle: string;
  /** Pre-fills a newly inserted events block. */
  defaultCalendarIds: string[];
  defaultLookaheadDays: number;
  /** The school's IANA zone, e.g. "America/Chicago". Comes from the Worker's
   *  SCHOOL_TIMEZONE var, NOT from the settings blob — it is echoed here (and
   *  ignored on write) purely so the composer can resolve an events block's
   *  fixed date range to the same instants the server will at send time. */
  timeZone: string;
  /** Public calendar site, from the Worker's CALENDAR_URL var. Env-derived and
   *  ignored on write, like `timeZone`. Events blocks link out to it. */
  calendarUrl: string;
  /** How system admins hear about someone confirming a subscription through the
   *  PUBLIC form. `off` by default, like every other notification (NFR-1).
   *
   *  Only the public double opt-in fires this. Addresses an admin adds on the
   *  subscribers screen or via bulk import never notify — the admin who added
   *  them already knows — which is the same rule notify.ts applies to
   *  admin-provisioned member accounts. */
  newSubscriberNotify: NotifyMode;
}

export interface NewsletterIssueSummaryDTO {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  status: NewsletterIssueStatus;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  /** Audience size measured when the send began; 0 while still a draft. */
  recipientTotal: number;
}

export interface NewsletterIssueDTO extends NewsletterIssueSummaryDTO {
  subject: string;
  content: NewsletterNode;
  /** Frozen per-block event lists, keyed by `blockId`. Absent while `draft`. */
  eventsSnapshot: Record<string, CalendarEventDTO[]> | null;
  /** Present once sending has begun, for the admin's progress display. */
  recipientCounts: { pending: number; sent: number; failed: number } | null;
  /** Whether a review link is live, and when it was minted. Never the token:
   *  only its hash is stored, so the URL shown at mint time is the one and only
   *  copy. "I lost it" is answered by minting a new one, which invalidates the
   *  old — see migration 0015. */
  previewLink: { active: boolean; createdAt: string | null };
}

export interface NewsletterIssueInput {
  title: string;
  subtitle?: string | null;
  /** Email subject. Defaults to `title` when omitted. */
  subject?: string;
  /** Defaults to `<today>-<slugified title>` when omitted. */
  slug?: string;
  content: NewsletterNode;
}

/** Body for POST …/test-send. Capped server-side. */
export interface NewsletterTestSendBody {
  to: string[];
}

export interface NewsletterSendResultDTO {
  status: NewsletterIssueStatus;
  recipientTotal: number;
}

export interface NewsletterSubscriberDTO {
  id: string;
  email: string;
  subscribed: boolean;
  createdAt: string;
}

/** Summary returned by POST /newsletter/subscribers/import. Counts are over the
 *  unique, valid addresses found in the pasted/uploaded list. */
export interface NewsletterSubscriberImportResultDTO {
  /** Addresses that had no row before — brand-new subscribers. */
  added: number;
  /** Addresses whose row existed but was unsubscribed, now re-subscribed. */
  resubscribed: number;
  /** Addresses that were already active subscribers — no change. */
  alreadyActive: number;
  /** Count of duplicate addresses collapsed within the input itself. */
  duplicates: number;
  /** Tokens that looked like an address but failed validation (capped). */
  invalid: string[];
  /** Total unique, valid addresses processed (added + resubscribed + alreadyActive). */
  total: number;
}

/** A member's own newsletter preference (GET/PUT /me/newsletter). */
export interface NewsletterSubscriptionDTO {
  subscribed: boolean;
}

/** Branding needed to render a public page, without exposing sender identity. */
export interface NewsletterBrandingDTO {
  newsletterTitle: string;
  accentColor: string;
  logoUrl: string | null;
  /** Sanitized HTML footer. Public, like the rest of this DTO — nothing
   *  member-private may be put in a footer. */
  footerHtml: string;
  /** Public calendar site, e.g. "https://calendar.eisenhower.school", or "" to
   *  render no link. Every events block links out to it. Safe to expose on the
   *  public archive: the calendar's home screen is deliberately ungated. */
  calendarUrl: string;
}

export interface PublicNewsletterIssueSummaryDTO {
  slug: string;
  title: string;
  subtitle: string | null;
  /** ISO-8601. Only sent issues are ever public, so this is never null. */
  sentAt: string;
  /** First few lines of body text, for the archive card and OG description. */
  excerpt: string;
}

/** One issue's reader-facing page — everything needed to render it, whether it
 *  was reached by a sent issue's public slug or by a review token.
 *
 *  Carries data, not pre-rendered HTML: the page runs the same shared renderer
 *  the email did, over the same content and snapshot.
 *
 *  THE public seam for issue pages, built field by field by `issuePageOf` in
 *  apps/api/src/lib/newsletter.ts — the companion to `publicEventOf` and
 *  `publicSheetOf`. Never build it by spreading a wider DTO, and read that
 *  function's comment before adding a field here: a column added to
 *  `newsletter_issue` must not be able to reach a reader until someone edits
 *  that projection on purpose. */
export interface NewsletterIssuePageDTO {
  /** The permanent archive URL's slug — null for an issue that hasn't been
   *  sent, which has no `/n/` page of its own yet, only its token's. */
  slug: string | null;
  title: string;
  subtitle: string | null;
  status: NewsletterIssueStatus;
  sentAt: string | null;
  /** For the "last edited …" line an unsent issue shows in place of a date. */
  updatedAt: string;
  /** First few lines of body text, for the OG description. */
  excerpt: string;
  content: NewsletterNode;
  /** Narrowed on read, like the public agenda. A sent issue's snapshot is
   *  FROZEN at send as full CalendarEventDTOs (that stored artifact stays
   *  byte-identical to what was mailed — invariant 10) and an unsent one's is
   *  resolved live, but either way an issue page is readable without a session,
   *  so both go out through `publicEventOf`. Without that, an issue page would
   *  be a second, quieter way to read seriesId/recurrenceId. See invariant 12. */
  eventsSnapshot: Record<string, PublicCalendarEventDTO[]>;
  branding: NewsletterBrandingDTO;
}

export interface PublicNewsletterArchiveDTO {
  issues: PublicNewsletterIssueSummaryDTO[];
  branding: NewsletterBrandingDTO;
}

/** Branding on its own, for a public page that isn't showing an issue — the
 *  subscribe form. Same narrowing as everywhere else: `brandingOf` is the only
 *  thing that builds a NewsletterBrandingDTO, so sender identity can't leak
 *  into a page just because a new page needed a masthead. */
export interface PublicNewsletterBrandingDTO {
  branding: NewsletterBrandingDTO;
}

/** What a pending double opt-in confirmation reveals: the address it was mailed
 *  to, so the confirm page can show whose subscription is about to start.
 *
 *  Holding the token is what authorizes seeing this, exactly as with the
 *  unsubscribe token — the token went to that address and nowhere else. */
export interface PublicNewsletterConfirmationDTO {
  email: string;
}

// ── Audit ─────────────────────────────────────────────────────────────────

/** Actions captured in the append-only audit log (FR-31). */
export type AuditAction =
  | "auth.signin"
  | "auth.signout"
  | "invite.sent"
  | "invite.accepted"
  | "control.granted"
  | "control.revoked"
  | "masquerade.start"
  | "masquerade.stop"
  | "share.created"
  | "share.revoked"
  | "bulk.import"
  | "registration.toggled"
  | "notify.toggled"
  | "calendar.source.created"
  | "calendar.source.updated"
  | "calendar.source.deleted"
  | "calendar.refreshed"
  | "calendar.managed.created"
  | "calendar.managed.updated"
  | "calendar.managed.deleted"
  | "calendar.event.created"
  | "calendar.event.updated"
  | "calendar.event.deleted"
  | "newsletter.issue.created"
  | "newsletter.issue.updated"
  | "newsletter.issue.deleted"
  | "newsletter.issue.sent"
  | "newsletter.issue.retried"
  /** A review link was minted (or re-minted, invalidating the previous one) or
   *  revoked. Deliberately not the generic share.created/share.revoked above:
   *  those belong to routes/shares.ts, which grants a Person or Group sight of
   *  a private contact field. This is a bearer URL onto one issue — a different
   *  mechanism with a different blast radius, and worth telling apart in a log
   *  someone reads after the fact. */
  | "newsletter.issue.preview_link_created"
  | "newsletter.issue.preview_link_revoked"
  | "newsletter.media.uploaded"
  /** Someone completed double opt-in from the public form. Anonymous — there is
   *  no session on that route — so the actor column is null and the confirmed
   *  address is the only identity the row carries. */
  | "newsletter.subscribed"
  | "newsletter.test_sent"
  | "newsletter.settings.updated"
  | "newsletter.subscriber.added"
  | "newsletter.subscriber.imported"
  | "newsletter.subscriber.removed"
  | "newsletter.subscription.toggled"
  | "volunteer.sheet.created"
  | "volunteer.sheet.updated"
  | "volunteer.sheet.deleted"
  | "volunteer.position.created"
  | "volunteer.position.updated"
  | "volunteer.position.deleted"
  // Signup create/delete are member actions, not admin ones — the only entries
  // in this log an ordinary member generates. They are recorded because a spot
  // changing hands is exactly the kind of thing someone later asks about.
  | "volunteer.signup.created"
  | "volunteer.signup.deleted"
  | "person.updated"
  | "contact.created"
  | "contact.updated"
  | "contact.deleted"
  | "admin.action";

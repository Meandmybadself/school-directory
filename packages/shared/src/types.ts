// Domain types shared between the API (Workers) and the web client.
// These describe the *serialized* shapes that cross the wire — privacy filtering
// and geo-coordinate stripping happen on the server before anything here is sent.

export type Locale = "en" | "es" | "zh";
export const LOCALES: Locale[] = ["en", "es", "zh"];

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
   *  and is what a future volunteer signup attaches to. */
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
 *  member signup data addressable from an unauthenticated response. */
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
 *  `url` is nullable here and null for every IMPORTED feed. A managed calendar's
 *  URL is this API's own /ics/:id.ics, which is already world-readable — but an
 *  imported feed's URL is whatever an admin pasted, and providers like Google
 *  and Outlook hand out secret subscribe links that grant the raw upstream feed.
 *  That raw ICS carries ORGANIZER/ATTENDEE addresses this app deliberately never
 *  stores, and a URL served publicly can't be un-published. Members still get
 *  every URL from the authenticated /calendar/sources. */
export interface PublicCalendarFeedDTO {
  id: string;
  name: string;
  color: string;
  url: string | null;
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

/** How system admins hear about new sign-ups. `off` by default (NFR-1): the
 *  instance sends nothing until an admin opts in.
 *  - `instant` — one email per join, as it happens.
 *  - `daily`   — a single digest of everyone who joined since the last one. */
export type NewUserNotify = "off" | "instant" | "daily";

export const NEW_USER_NOTIFY_MODES = ["off", "instant", "daily"] as const;

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
  /** Days ahead of the render moment to include. */
  lookaheadDays: number;
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
  footerText: string;
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

/** A member's own newsletter preference (GET/PUT /me/newsletter). */
export interface NewsletterSubscriptionDTO {
  subscribed: boolean;
}

/** Branding needed to render a public page, without exposing sender identity. */
export interface NewsletterBrandingDTO {
  newsletterTitle: string;
  accentColor: string;
  logoUrl: string | null;
  footerText: string;
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

/** Carries data, not pre-rendered HTML: the public page runs the same shared
 *  renderer the email did, over the same frozen content and snapshot. */
export interface PublicNewsletterIssueDTO extends PublicNewsletterIssueSummaryDTO {
  content: NewsletterNode;
  eventsSnapshot: Record<string, CalendarEventDTO[]>;
  branding: NewsletterBrandingDTO;
}

export interface PublicNewsletterArchiveDTO {
  issues: PublicNewsletterIssueSummaryDTO[];
  branding: NewsletterBrandingDTO;
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
  | "newsletter.media.uploaded"
  | "newsletter.test_sent"
  | "newsletter.settings.updated"
  | "newsletter.subscriber.added"
  | "newsletter.subscriber.removed"
  | "newsletter.subscription.toggled"
  | "person.updated"
  | "contact.created"
  | "contact.updated"
  | "contact.deleted"
  | "admin.action";

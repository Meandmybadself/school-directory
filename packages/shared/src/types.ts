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

/** Visibility level on a field or contact item. There is no "public" level. */
export type Visibility = "service" | "private";

/** How a Person's last name renders to viewers who can see it. */
export type LastNameDisplay = "full" | "initial" | "hidden";

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
  /** Resolved share state for the active viewer's UI chip. */
  shareCount?: number;
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
  groups: GroupSummaryDTO[];
  /** True when the requesting User is a Controller of this Person. */
  controlledByViewer: boolean;
}

export interface GroupSummaryDTO {
  id: string;
  kind: GroupKind;
  name: string;
  memberCount: number;
  /** Viewer's role in this group, if any. */
  isAdmin?: boolean;
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
  members: GroupMemberDTO[];
  /** Group-owned contact items (e.g. household cascading address), filtered. */
  contacts: ContactItemDTO[];
}

export interface ControllablePersonDTO {
  id: string;
  firstName: string;
  displayName: string;
  capabilities: Capability[];
  photoUrl: string | null;
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
  | "person.updated"
  | "contact.created"
  | "contact.updated"
  | "contact.deleted"
  | "admin.action";

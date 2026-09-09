// The PTO's own facts, transcribed once.
//
// This file is to apps/pto what `apps/home/src/district.ts` is to the front
// door, and it exists for the same reason: everything in it is a PROPER NOUN or
// a URL — "Read-A-Thon", "XinXing", the GiveMN campaign page — and proper nouns
// are configuration, not copy. Invariant 6 governs the sentences AROUND them,
// which live in the shared dictionaries in all four languages. An event called
// "Trilingual Bingo Night" is called that in Somali too.
//
// PROVENANCE. Transcribed from the PTO's own substrate at ~/Sites/eisenhower-pto
// — `data/events.json`, `data/roster.json` and `data/links.json` — which was in
// turn built from public PTO documents, meeting minutes (2022–24) and email
// records. What was deliberately NOT carried across is as important as what was:
// that repo's blueprint page is an internal planning aid, and its treasury
// figure, its per-event fundraising yields, its list of where volunteer hours
// leak away, and its notes about which accounts got locked out are all things a
// board says to itself and not things a public page says to a family.
//
// NOTHING IN HERE EXPIRES, which is the bar for transcribing anything at all.
// Board HOLDERS are absent for exactly that reason — the roster turns over every
// October and `roster.json` deliberately leaves every `holderPersonId` null — so
// this page names the SEATS and points at the directory for the people. No date
// is transcribed either: the upcoming-events block reads the live calendar.

import type { Strings } from "@sd/shared";

/** The six things a PTO event can be FOR. Drives the colour of a tag on the
 *  year strip; the labels themselves are dictionary keys. */
export type Category =
  | "fundraiser"
  | "community"
  | "cultural"
  | "appreciation"
  | "enrichment"
  | "governance";

export const CATEGORY_LABEL: Record<Category, keyof Strings> = {
  fundraiser: "ptoCatFundraiser",
  community: "ptoCatCommunity",
  cultural: "ptoCatCultural",
  appreciation: "ptoCatAppreciation",
  enrichment: "ptoCatEnrichment",
  governance: "ptoCatGovernance",
};

/** A board seat: what it is called and what it owns, both as dictionary keys.
 *  The seat NAMES are translated — unlike an event name, "Vice President" is a
 *  job description rather than a proper noun, and a Somali-speaking parent
 *  reading who to ask should read it in Somali. */
export interface Seat {
  title: keyof Strings;
  body: keyof Strings;
}

export const SEATS: Seat[] = [
  { title: "ptoRolePresident", body: "ptoRolePresidentBody" },
  { title: "ptoRoleVicePresident", body: "ptoRoleVicePresidentBody" },
  { title: "ptoRoleSecretary", body: "ptoRoleSecretaryBody" },
  { title: "ptoRoleTreasurer", body: "ptoRoleTreasurerBody" },
  { title: "ptoRoleFundraising", body: "ptoRoleFundraisingBody" },
  { title: "ptoRoleVolunteer", body: "ptoRoleVolunteerBody" },
  { title: "ptoRoleTeacherRep", body: "ptoRoleTeacherRepBody" },
  { title: "ptoRoleMemberAtLarge", body: "ptoRoleMemberAtLargeBody" },
];

/** One month of the school year, and what happens in it.
 *
 *  `month` is a 0-based calendar month so the name can be rendered by `Intl` in
 *  the reader's language — twelve month names is exactly the kind of thing a
 *  dictionary should not be asked to carry, since every platform already has
 *  them in every locale.
 *
 *  The ORDER of this array is the school year: August first, July last. That is
 *  the substrate's own rule (`MONTHS` in its `agents/lib.mjs` starts at Aug and
 *  wraps at Jul) and it is why this is a list rather than something sorted at
 *  render time. */
export interface YearMonth {
  /** 0 = January. */
  month: number;
  events: Array<{ name: string; category: Category }>;
}

export const YEAR: YearMonth[] = [
  {
    month: 7,
    events: [
      { name: "Playground Night", category: "community" },
      { name: "Staff welcome-back", category: "appreciation" },
    ],
  },
  {
    month: 8,
    events: [
      { name: "First PTO meeting", category: "governance" },
      { name: "Field Day", category: "community" },
      { name: "Popcorn Fridays begin", category: "fundraiser" },
      { name: "Restaurant night", category: "fundraiser" },
    ],
  },
  {
    month: 9,
    events: [
      { name: "Board elections", category: "governance" },
      { name: "Scholastic Book Fair", category: "fundraiser" },
      { name: "Conference staff meals", category: "appreciation" },
      { name: "Talent Show", category: "community" },
      { name: "Art Adventure begins", category: "enrichment" },
    ],
  },
  {
    month: 10,
    events: [
      { name: "Give to the Max Day", category: "fundraiser" },
      { name: "Trilingual Bingo Night", category: "cultural" },
      { name: "Food-bag drive", category: "community" },
    ],
  },
  {
    month: 11,
    events: [
      { name: "Imagination Fair", category: "community" },
      { name: "Winter book fair", category: "community" },
      { name: "Restaurant night", category: "fundraiser" },
    ],
  },
  {
    month: 0,
    events: [
      { name: "Read-A-Thon prep", category: "fundraiser" },
      { name: "Chinese New Year prep", category: "cultural" },
      { name: "BRAVO", category: "enrichment" },
    ],
  },
  {
    month: 1,
    events: [
      { name: "Read-A-Thon", category: "fundraiser" },
      { name: "Chinese New Year", category: "cultural" },
      { name: "Plant Sale pre-orders", category: "fundraiser" },
      { name: "Conference staff meals", category: "appreciation" },
    ],
  },
  {
    month: 2,
    events: [
      { name: "PTO meeting", category: "governance" },
      { name: "Popcorn Fridays", category: "fundraiser" },
    ],
  },
  {
    month: 3,
    events: [
      { name: "Spring Arts & Cultural Festival", category: "cultural" },
      { name: "Juntos Gala", category: "cultural" },
      { name: "Spring Plant Sale", category: "fundraiser" },
    ],
  },
  {
    month: 4,
    events: [
      { name: "Teacher Appreciation Week", category: "appreciation" },
      { name: "Juntos end-of-year fiesta", category: "cultural" },
      { name: "Plant pickup", category: "fundraiser" },
      { name: "Yearbook", category: "community" },
    ],
  },
  {
    month: 5,
    events: [
      { name: "Volunteer Appreciation", category: "appreciation" },
      { name: "Day of Play", category: "community" },
      { name: "Board transition", category: "governance" },
    ],
  },
  {
    month: 6,
    events: [{ name: "Summer park meet-ups", category: "community" }],
  },
];

/** Runs all year, underneath the month strip. Named separately because a
 *  recurring thing put in a month reads as happening only then. */
export const YEAR_ROUND = [
  "Popcorn Fridays",
  "Box Tops",
  "The PTO store",
  "Stock the Staff Lounge",
  "Restaurant nights",
  "Art Adventure · BRAVO",
];

/** A link a FAMILY would use.
 *
 *  A curated subset of the substrate's `links.json`, and curated in both
 *  directions. Retired tools are absent (that file marks Smore and PTOffice
 *  `active: false` precisely so they drop out); so are the links that only mean
 *  something to a board member — the shared Google Doc calendar, the survey
 *  form, the Get Movin' registration host that only exists for six weeks a year.
 *
 *  Venmo is deliberately absent. `links.json` carries `https://venmo.com/` with
 *  no handle on it — a placeholder, not an address — and a donate button that
 *  lands on Venmo's home page is worse than one that isn't there.
 *
 *  SignUpGenius is absent too, and for a better reason: this instance HAS a
 *  volunteer sign-up system of its own, on the calendar, where a shift is
 *  claimed by a directory Person and the sheet lives on the event (invariant
 *  13). Sending a family to a third-party sign-up from the page that explains
 *  the PTO would point them away from the thing built to replace it. "Take a
 *  shift" links to the calendar. */
export interface PtoLink {
  /** The label is a proper noun or the service's own name, so it is data. */
  label: string;
  url: string;
}

export const DONATE: PtoLink = {
  label: "GiveMN",
  url: "https://www.givemn.org/organization/Eisenhower-Xx-Juntos-Pto",
};

export const WISHLISTS: PtoLink[] = [
  { label: "Staff lounge", url: "https://www.amazon.com/hz/wishlist/ls/3URWOKAJJQTEU" },
  { label: "Art room", url: "https://www.amazon.com/hz/wishlist/ls/1OQDDVBJE544I" },
];

export const SOCIAL: PtoLink[] = [
  { label: "Facebook", url: "https://www.facebook.com/groups/159524300738821" },
  { label: "Instagram", url: "https://www.instagram.com/eisenhowerelementary270" },
];

/** The three co-located programs. Proper nouns, in every language — the same
 *  rule `SCHOOL_LABEL` follows in apps/home/src/district.ts. */
export const PROGRAMS = ["Community", "XinXing", "Juntos"];

/** Where the PTO meets. A room name, hence data; the sentence about the meetings
 *  is `ptoMeetingsBody`. */
export const MEETING_PLACE = "Media Center";

/** The nonprofit itself — the registration facts a donor or an employer asks
 *  for, and the address a letter goes to.
 *
 *  Squarely inside this file's bar: an EIN is issued once and never reissued, a
 *  legal name is a proper noun, and the address is the school's, which is the
 *  registered one. Nothing here expires, so nothing here can go quietly stale
 *  the way a board roster or a date would. The words that LABEL these lines are
 *  dictionary keys (invariant 6), as everywhere else on this page.
 *
 *  The street is transcribed in ordinary case; the registry prints it in caps,
 *  which is a filing convention rather than how the road is spelled. The phone
 *  is the school office's — the same number apps/home's `SCHOOL_PHONES` carries,
 *  which is not duplication to consolidate: that file transcribes the
 *  DISTRICT's mailing, this one the PTO's own registration, and the day the PTO
 *  gets a line of its own only one of them changes. */
export const ORG = {
  /** Who a check is made out to, and the first line of an envelope. */
  legalName: "Parent Teacher Organization",
  street: "1001 Highway 7",
  /** Held in PARTS rather than as one printed line, because the page publishes
   *  the same address twice — once for a person to read and once as
   *  schema.org `PostalAddress` — and a structured consumer needs the locality,
   *  the region and the postal code apart. The printed line is derived from
   *  these (`cityStateZip`), never the other way around, for the reason
   *  `telHref` is derived: two spellings of one fact drift. */
  locality: "Hopkins",
  region: "MN",
  postalCode: "55305-4723",
  /** ISO 3166-1, for the structured copy. */
  country: "US",
  /** As printed. The dialable href is derived, so the two cannot drift. */
  phone: "(952) 988-4300",
  /** What an employer's matching-gift form asks for, and what a donor keeps for
   *  their own records. Public by nature — it is on every Form 990. */
  ein: "41-1614554",
};

/** The second line of the envelope. US postal order in every language: an
 *  address is read by the Postal Service, not by the reader. */
export function cityStateZip(): string {
  return `${ORG.locality}, ${ORG.region} ${ORG.postalCode}`;
}

/** E.164, which is what a structured consumer wants where a reader wants
 *  `ORG.phone`. Derived from the same digits `telHref` dials. */
export function phoneE164(printed: string): string {
  return `+1${printed.replace(/\D/gu, "")}`;
}

/** A dialable href from a number as it is printed — the same derivation
 *  apps/home/src/district.ts makes, and for the same reason. */
export function telHref(printed: string): string {
  return `tel:${phoneE164(printed)}`;
}

/** Month name in the reader's language. Twelve names the platform already has,
 *  in every locale, so the dictionaries are not asked to carry them. */
export function monthName(month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, month, 15)),
  );
}

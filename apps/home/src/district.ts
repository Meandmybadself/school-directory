// What the school district publishes, transcribed from the back-to-school
// mailing that lands in every Hopkins family's mailbox in August.
//
// This is DATA — phone numbers, URLs, bell times — and the
// words that label each row are dictionary keys (CLAUDE.md invariant 6), joined
// to this in `page.ts`. The one exception is a school's own NAME, which is a
// proper noun and stays in Latin script in all four languages, for the same
// reason `SCHOOL_CITY` is configuration rather than copy.
//
// Nothing here expires, which is the point: it is the durable half of what a
// family needs. The dated half — when the open house is, when school starts —
// is deliberately NOT repeated here. That is the calendar's job, and the page
// reads it live (`events.ts`) rather than keeping a copy that goes stale the
// moment the school moves a date.

import type { Strings } from "@sd/shared";

/** The school this site belongs to, as the district writes it. */
export const SCHOOL_LABEL = "Eisenhower Elementary";

/** The bell times of an ordinary day, given as a real school day so the UTC
 *  offset resolves the way it does on an actual Tuesday rather than being
 *  guessed from a bare clock time. Hopkins is on CDT (-05:00) in September. */
export const SCHOOL_HOURS = {
  start: "2026-09-01T07:40:00-05:00",
  end: "2026-09-01T14:10:00-05:00",
};

/** Build a dialable href from a number as it is printed. Derived rather than
 *  written twice, so the link can never drift from the label. */
function tel(printed: string): string {
  return `tel:+1${printed.replace(/\D/gu, "")}`;
}

/** A number to call, labelled by what the department does. */
export interface PhoneRow {
  /** Dictionary key naming the department or the reason to call. */
  key: keyof Strings;
  /** Dictionary key for a line of detail under it, where there is one. */
  noteKey?: keyof Strings;
  /** As printed, e.g. "952-988-4300". Also the link's text. */
  phone: string;
}

/** Somewhere to read more, on the district's own site. */
export interface Resource {
  key: keyof Strings;
  noteKey: keyof Strings;
  /** Shown as the link — a bare path on the district's host, the way the
   *  mailing prints it, which reads the same in every language. */
  label: string;
  href: string;
}

export function hrefOf(row: PhoneRow): string {
  return tel(row.phone);
}

/** Eisenhower's own two numbers. The office covers the immersion program too —
 *  one number, as the mailing lists it. */
export const SCHOOL_PHONES: PhoneRow[] = [
  { key: "landingFactOffice", noteKey: "landingFactOfficeBody", phone: "952-988-4300" },
  {
    key: "landingFactInterpreters",
    noteKey: "landingFactInterpretersBody",
    phone: "952-988-5391",
  },
];

/** The district's departments, in the order the mailing prints them. */
export const DISTRICT_PHONES: PhoneRow[] = [
  { key: "landingDeptAthletics", phone: "952-988-4691" },
  { key: "landingDeptCommunityEd", phone: "952-988-4070" },
  { key: "landingDeptEarlyChildhood", phone: "952-988-5000" },
  { key: "landingDeptEarlyChildhoodScreening", phone: "952-988-5017" },
  { key: "landingDeptHumanResources", phone: "952-988-4030" },
  { key: "landingDeptSchoolAgeCare", phone: "952-988-4080" },
  { key: "landingDeptNutrition", phone: "952-988-4060" },
  { key: "landingDeptSpecialServices", phone: "952-988-4042" },
  { key: "landingDeptSuperintendent", phone: "952-988-2066" },
  { key: "landingDeptTransportation", phone: "952-988-4115" },
];

/** The pages the mailing points families at, each with the one line that says
 *  why you would open it. */
export const RESOURCES: Resource[] = [
  {
    key: "landingFactEnroll",
    noteKey: "landingFactEnrollBody",
    label: "HopkinsSchools.org/enroll",
    href: "https://hopkinsschools.org/enroll",
  },
  {
    key: "landingFactPortal",
    noteKey: "landingFactPortalBody",
    label: "HopkinsSchools.org/technology",
    href: "https://hopkinsschools.org/technology",
  },
  {
    key: "landingFactBuses",
    noteKey: "landingFactBusesBody",
    label: "HopkinsSchools.org/transportation",
    href: "https://hopkinsschools.org/transportation",
  },
  {
    key: "landingFactMeals",
    noteKey: "landingFactMealsBody",
    label: "HopkinsSchools.org/nutrition",
    href: "https://hopkinsschools.org/nutrition",
  },
  {
    key: "landingFactSafety",
    noteKey: "landingFactSafetyBody",
    label: "HopkinsSchools.org/safety",
    href: "https://hopkinsschools.org/safety",
  },
  {
    key: "landingFactRoyalReport",
    noteKey: "landingFactRoyalReportBody",
    label: "HopkinsSchools.org/RoyalReport",
    href: "https://hopkinsschools.org/RoyalReport",
  },
];

/** The bus office, which the mailing gives as an address rather than a page. */
export const BUS_EMAIL = "SchoolBus@HopkinsSchools.org";

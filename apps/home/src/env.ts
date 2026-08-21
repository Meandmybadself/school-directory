export interface Env {
  /** Org name interpolated into `{school}` slots, e.g. "Eisenhower PTO". */
  SCHOOL_NAME: string;
  /** Canonical origin of this page, without a trailing slash. */
  SITE_ORIGIN: string;
  DIRECTORY_URL: string;
  CALENDAR_URL: string;
  NEWSLETTER_URL: string;
  /** The API, read once per render for the upcoming-events block and nothing
   *  else — the anonymous `/calendar-public/*` half of it. Unset means the
   *  block simply doesn't render; see `events.ts`. */
  API_URL: string;
  /** The school's own website — where this hostname used to redirect. */
  SCHOOL_SITE_URL: string;
  /** Who publishes the school-year dates and the school-day facts this page
   *  repeats. Named and linked wherever they appear, because none of it is the
   *  PTO's to change and a reader chasing a detail should land on the source. */
  DISTRICT_NAME: string;
  DISTRICT_URL: string;
  FEEDBACK_EMAIL: string;
  /** Where the school is. Split into three because each part has a different
   *  job: the first two are read by people (`Hopkins, Minnesota`), the third is
   *  read by search engines, which want a region CODE in the US. Kept out of
   *  the dictionaries because a place name is configuration, not copy — it is
   *  the same in all four languages, the way it is written on an envelope. */
  SCHOOL_CITY: string;
  SCHOOL_REGION: string;
  /** ISO 3166-2 subdivision code, e.g. "MN" — `addressRegion` in the JSON-LD. */
  SCHOOL_REGION_CODE: string;
}

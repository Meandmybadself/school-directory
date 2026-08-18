export interface Env {
  /** Org name interpolated into `{school}` slots, e.g. "Eisenhower PTO". */
  SCHOOL_NAME: string;
  /** Canonical origin of this page, without a trailing slash. */
  SITE_ORIGIN: string;
  DIRECTORY_URL: string;
  CALENDAR_URL: string;
  NEWSLETTER_URL: string;
  /** The school's own website — where this hostname used to redirect. */
  SCHOOL_SITE_URL: string;
  FEEDBACK_EMAIL: string;
}

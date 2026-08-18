/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SCHOOL_NAME?: string;
  /** Where the site footer sends feedback. */
  readonly VITE_FEEDBACK_EMAIL?: string;
  /** The calendar app's origin — linked to from nav and the Home events block. */
  readonly VITE_CALENDAR_URL?: string;
  /** The newsletter app's origin — linked to from the Home latest-issue card. */
  readonly VITE_NEWSLETTER_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

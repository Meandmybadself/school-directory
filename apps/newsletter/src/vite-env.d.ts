/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SCHOOL_NAME?: string;
  /** Where the site footer sends feedback. */
  readonly VITE_FEEDBACK_EMAIL?: string;
  /** The directory app's origin — linked to from nav and the sign-in footer. */
  readonly VITE_DIRECTORY_URL?: string;
  /** The calendar app's origin — linked to from nav. */
  readonly VITE_CALENDAR_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

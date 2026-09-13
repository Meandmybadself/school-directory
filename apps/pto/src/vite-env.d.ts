/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SCHOOL_NAME?: string;
  /** Where the site footer sends feedback. */
  readonly VITE_FEEDBACK_EMAIL?: string;
  /** Sibling app origins — what the platform switcher links to. The same
   *  four names in every app; see `PLATFORM_ORIGINS` in lib/api.ts. */
  readonly VITE_DIRECTORY_URL?: string;
  readonly VITE_CALENDAR_URL?: string;
  readonly VITE_NEWSLETTER_URL?: string;
  readonly VITE_PTO_URL?: string;
  readonly VITE_STORE_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

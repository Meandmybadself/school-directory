// Worker bindings + per-request context shared across routes/middleware.

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  // vars
  SCHOOL_NAME: string;
  APP_URL: string;
  ALLOWED_ORIGINS: string;
  /** Override the Nominatim search endpoint (e.g. a self-hosted instance). */
  NOMINATIM_URL?: string;
  /** Comma-separated emails granted system_admin on sign-in (bootstrap). They
   *  can sign in even when registration is closed. */
  BOOTSTRAP_ADMIN_EMAILS?: string;
  /** Static-map image URL template with {lat} {lon} {w} {h} {zoom} placeholders.
   *  Used server-side only to render an address thumbnail; coords never leave. */
  STATIC_MAP_URL?: string;
  // secrets (may be empty in local dev)
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  SESSION_SECRET?: string;
}

/** Authenticated context attached to a request after session middleware. */
export interface AuthContext {
  /** Effective user — the one whose data is in scope (the target during masquerade). */
  userId: string;
  /** The real human behind the request — the admin during masquerade, else == userId. */
  realUserId: string;
  /** Effective user's email. */
  email: string;
  /** Effective user's system-admin flag (a masqueraded target is NOT admin). */
  isSystemAdmin: boolean;
  sessionId: string;
  /** Active Person the user is acting as (from cookie/preference), if any. */
  activePersonId: string | null;
  /** True when an admin is masquerading as `userId`. */
  isMasquerading: boolean;
}

/** Hono generic env: bindings + per-request variables. */
export interface HonoEnv {
  Bindings: Env;
  Variables: {
    auth?: AuthContext;
    /** Buffered audit entries flushed by audit middleware after the handler. */
    audit: import("./lib/audit.js").AuditDraft[];
    ip: string | null;
    userAgent: string | null;
  };
}

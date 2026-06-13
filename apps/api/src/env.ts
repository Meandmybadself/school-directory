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
  // secrets (may be empty in local dev)
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  SESSION_SECRET?: string;
}

/** Authenticated context attached to a request after session middleware. */
export interface AuthContext {
  userId: string;
  email: string;
  isSystemAdmin: boolean;
  sessionId: string;
  /** Active Person the user is acting as (from cookie/preference), if any. */
  activePersonId: string | null;
  /** When masquerading, the admin's real user id; else null. */
  masqueradingAs: string | null;
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

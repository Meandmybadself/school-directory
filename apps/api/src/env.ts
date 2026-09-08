// Worker bindings + per-request context shared across routes/middleware.

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  /** Newsletter images and logos. A SEPARATE bucket from PHOTOS, not a prefix
   *  inside it: these objects are served by a fully public route, and a bucket
   *  with no private data co-resident cannot leak a member's profile photo
   *  through a forgotten prefix check. */
  NEWSLETTER_MEDIA: R2Bucket;
  // vars
  SCHOOL_NAME: string;
  APP_URL: string;
  ALLOWED_ORIGINS: string;
  /** Public origin of the newsletter app — where "view in browser" and
   *  unsubscribe links in a sent email point. */
  NEWSLETTER_URL: string;
  /** Public calendar site. Events blocks in a newsletter link out to it. */
  CALENDAR_URL?: string;
  /** Public origin of the store. Stripe's success/cancel URLs and the
   *  order-status links in confirmation email point here, so it must be the
   *  reader-facing host and not this API. */
  STORE_URL: string;
  /** Public origin of the PTO site. Nothing this API sends by email points at
   *  it yet — it is here so the origin has one home, beside its siblings. */
  PTO_URL?: string;
  /** IANA zone used to name the day/time of events rendered server-side (email
   *  and public archive), which have no viewer to infer a zone from. */
  SCHOOL_TIMEZONE?: string;
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
  /** Slack Incoming Webhook posting system events to the admins' channel
   *  (invariant 22). Absent — the default, and the case in local dev — turns
   *  the feature off entirely and logs the message instead, exactly as an
   *  absent RESEND_API_KEY does for mail. The value is a bearer capability to
   *  post into that channel, so it lives here as a secret and is never logged. */
  SLACK_WEBHOOK_URL?: string;
  /** Printful v1 API key, and the store it acts on. Absent — the default, and
   *  the case in local dev — turns the catalog and fulfilment calls off and
   *  logs them instead, exactly as an absent RESEND_API_KEY does for mail, so
   *  the whole storefront is still walkable without a Printful account.
   *
   *  Both are expected to CHANGE ONCE: this instance starts against a personal
   *  Printful store and moves to the PTO's. Nothing durable is keyed on them —
   *  see migration 0022 — so that day is a secret rotation plus an admin
   *  re-point, not a migration. */
  PRINTFUL_API_KEY?: string;
  PRINTFUL_STORE_ID?: string;
  /** Stripe secret key and the signing secret for the webhook endpoint at
   *  /store-webhooks/stripe. Same absent-means-off contract; with no key the
   *  cart is walkable right up to the redirect. Also expected to change once,
   *  from a personal account to the PTO's — which is why every order freezes
   *  its own totals and lines rather than being re-derived from Stripe. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Shared secret Printful is configured to send with its webhooks. Printful's
   *  v1 webhooks are not signed the way Stripe's are, so this is what the
   *  shipment endpoint checks; see routes/storeWebhooks.ts for why a forged
   *  call is bounded even without it. */
  PRINTFUL_WEBHOOK_SECRET?: string;
  /** Keys the store's own HMACs: the signed shipping quote and the derived
   *  order-status token (lib/storeQuote.ts, lib/storeOrder.ts).
   *
   *  Unlike every other optional secret here it does NOT degrade gracefully in
   *  production. A guessable quote key is a guessable PRICE, so the dev
   *  fallback exists only while STRIPE_SECRET_KEY is also absent — the one
   *  configuration where no card can be charged. Rotating it invalidates every
   *  order-status link already emailed, which is why it is separate from
   *  anything on the auth path. */
  STORE_SECRET?: string;
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

// School Directory API — Hono on Cloudflare Workers.
// Pipeline: context → CORS → session → audit-flush, then routes.

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, HonoEnv } from "./env.js";
import { refreshAllSources } from "./lib/calendar.js";
import { refreshStoreCatalog } from "./lib/store.js";
import { retryStuckOrders, sweepAbandonedOrders } from "./lib/storeOrder.js";
import { allowedOrigins } from "./lib/db.js";
import { sendNewSubscriberDigest, sendNewUserDigest } from "./lib/notify.js";
import { runDailySweeps } from "./lib/sweep.js";
import { contextMiddleware } from "./middleware/context.js";
import { requireAuth, sessionMiddleware, UnauthorizedError } from "./middleware/session.js";
import { auditMiddleware } from "./middleware/audit.js";
import { auth } from "./routes/auth.js";
import { me } from "./routes/me.js";
import { persons } from "./routes/persons.js";
import { contacts } from "./routes/contacts.js";
import { controllers } from "./routes/controllers.js";
import { home } from "./routes/home.js";
import { directory } from "./routes/directory.js";
import { groups } from "./routes/groups.js";
import { shares } from "./routes/shares.js";
import { admin } from "./routes/admin.js";
import { settings } from "./routes/settings.js";
import { calendar } from "./routes/calendar.js";
import { calendarPublic } from "./routes/calendarPublic.js";
import { managedCalendar } from "./routes/managedCalendar.js";
import { ics } from "./routes/ics.js";
import { newsletter } from "./routes/newsletter.js";
import { newsletterPublic } from "./routes/newsletterPublic.js";
import { volunteers } from "./routes/volunteers.js";
import { volunteersPublic } from "./routes/volunteersPublic.js";
import { store } from "./routes/store.js";
import { storePublic } from "./routes/storePublic.js";
import { storeWebhooks } from "./routes/storeWebhooks.js";
import { pto } from "./routes/pto.js";

const app = new Hono<HonoEnv>();

app.use("*", contextMiddleware);

app.use("*", (c, next) =>
  cors({
    origin: (origin) => {
      const allowed = allowedOrigins(c.env);
      return origin && allowed.includes(origin) ? origin : allowed[0] ?? "";
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })(c, next),
);

app.use("*", sessionMiddleware);
app.use("*", auditMiddleware);

// Health / config probe.
app.get("/health", (c) => c.json({ ok: true, school: c.env.SCHOOL_NAME }));

// Routes.
app.route("/auth", auth);
app.route("/me", me);
app.route("/persons", persons);
app.route("/home", home);
app.route("/directory", directory);
app.route("/groups", groups);
app.route("/shares", shares);
app.route("/admin", admin);
app.route("/admin", managedCalendar); // managed-calendar CRUD, same /admin base
app.route("/settings", settings);
app.route("/calendar", calendar);
app.route("/calendar-public", calendarPublic); // anonymous agenda reads — no auth by design
app.route("/ics", ics); // public published feeds — no auth by design
app.route("/newsletter", newsletter); // authoring — system admins only
app.route("/newsletter-public", newsletterPublic); // archive + subscribe/unsubscribe — no auth by design
app.route("/volunteers", volunteers); // signup reads with names + claims — members only
app.route("/volunteers-public", volunteersPublic); // signup counts, no names — no auth by design
app.route("/store", store); // admin catalog/orders, plus a member's own orders
app.route("/store-public", storePublic); // catalog, cart pricing, checkout, order status — no auth by design
// Vendor callbacks. Not "no auth by design" like the routers above: the trust
// boundary is a signature, checked inside each handler against the RAW body.
app.route("/store-webhooks", storeWebhooks);
// The PTO's planning boards. No `/pto-public/*` twin beside it, unlike every
// other feature router above: a board has ONE audience and the public seam
// deliberately does not exist (migration 0024).
app.route("/pto", pto);
// share-targets is exposed under /shares/targets via the shares router.
app.route("/", contacts); // /persons/:id/contacts + /contacts/:id
app.route("/", controllers); // /persons/:id/controllers + /control-invites
app.post("/control-invites/:id/accept", (c) =>
  // Acceptance happens via the magic-link callback (kind=invite); this endpoint
  // exists for admin-driven grants in a later milestone.
  c.json({ error: "use_magic_link" }, 400),
);

// Profile photo serving (R2). MEMBERS ONLY — these are photographs of children,
// and an unguessable key is not an access rule: a URL in a cache, a referrer or
// a screenshot would make one permanently public, with no way to revoke it short
// of replacing the photo. `sd_session` is host-only to this API and every SPA is
// a same-site subdomain, so an ordinary <img src> carries the cookie under
// SameSite=Lax and needs no crossorigin attribute. Still `private` in the cache
// header: the response varies by who asked.
app.get("/photos/:key", async (c) => {
  requireAuth(c);
  const obj = await c.env.PHOTOS.get(c.req.param("key"));
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  return new Response(obj.body, { headers });
});

// Newsletter images (R2). Fully public and long-cached: these have to load
// inside an email client that sends no cookies, and on a public archive page.
// They live in their own bucket precisely so that being public here can never
// expose a member's profile photo. Keys are ULID-random, hence immutable.
app.get("/newsletter-media/:key", async (c) => {
  const obj = await c.env.NEWSLETTER_MEDIA.get(c.req.param("key"));
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("access-control-allow-origin", "*");
  return new Response(obj.body, { headers });
});

app.onError((err, c) => {
  if (err instanceof UnauthorizedError) {
    return c.json({ error: "unauthorized" }, 401);
  }
  console.error("[api] unhandled", err);
  return c.json({ error: "internal" }, 500);
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

// Cron (see wrangler.toml [triggers]). Two schedules share this handler:
//   0 */3 * * *  — refresh the shared calendar from its ICS feeds. Errors are
//                  recorded per-source and never throw.
//   0 13 * * *   — send the admin digests (~8am Central): new members and new
//                  newsletter subscribers. Each is a no-op unless an admin has
//                  set that notification to "daily", and they are independent
//                  settings, so one may fire while the other doesn't.
// The two never collide: */3 fires on even hours only.
//
// A third schedule joins them for the store:
//   */15 * * * *  — re-drive paid orders that never reached Printful. Fifteen
//                   minutes rather than riding the 3-hourly refresh because the
//                   thing being recovered is a CHARGED order that hasn't been
//                   printed; the inline waitUntil handles it in seconds in the
//                   normal case, and this is only the backstop for a Worker that
//                   died mid-flight. Overlapping fires are harmless — the
//                   submission claim is a guarded UPDATE only one caller wins.
//
// Registering it took the account to its ceiling: the Workers FREE plan allows
// five cron triggers per ACCOUNT, and these three plus bus-notify's two are all
// five. A fourth schedule here will fail the deploy at the trigger step, after
// the code has already uploaded — working code, broken-looking deploy. That is
// the cost to weigh before adding one.
const DIGEST_CRON = "0 13 * * *";
const STORE_CRON = "*/15 * * * *";

const scheduled: ExportedHandlerScheduledHandler<Env> = (event, env, ctx) => {
  if (event.cron === STORE_CRON) {
    ctx.waitUntil(retryStuckOrders(env));
    return;
  }
  if (event.cron === DIGEST_CRON) {
    // Separately awaited inside their own try/catch, so one failing digest
    // can't swallow the other.
    ctx.waitUntil(sendNewUserDigest(env));
    ctx.waitUntil(sendNewSubscriberDigest(env));
    // Housekeeping for the four tables that would otherwise only ever grow.
    // Two of them back a rate limit that counts rows, which makes their
    // retention a security parameter rather than tidiness — see lib/sweep.ts.
    ctx.waitUntil(runDailySweeps(env));
    // Unpaid checkouts are marked `abandoned`, never deleted — see migration
    // 0022. It rides the daily sweep rather than lib/sweep.ts because it is an
    // UPDATE, and that file is deliberately only DELETEs of growing tables.
    ctx.waitUntil(sweepAbandonedOrders(env));
    return;
  }
  ctx.waitUntil(refreshAllSources(env));
  // A design discontinued upstream should stop being for sale without waiting
  // for an admin to notice. Never throws; one bad product doesn't stop the rest.
  ctx.waitUntil(refreshStoreCatalog(env));
};

export default { fetch: app.fetch, scheduled };

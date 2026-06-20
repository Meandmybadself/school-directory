// School Directory API — Hono on Cloudflare Workers.
// Pipeline: context → CORS → session → audit-flush, then routes.

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, HonoEnv } from "./env.js";
import { refreshAllSources } from "./lib/calendar.js";
import { contextMiddleware } from "./middleware/context.js";
import { sessionMiddleware, UnauthorizedError } from "./middleware/session.js";
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

const app = new Hono<HonoEnv>();

app.use("*", contextMiddleware);

app.use("*", (c, next) =>
  cors({
    origin: (origin) => {
      const allowed = (c.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim());
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
app.route("/settings", settings);
app.route("/calendar", calendar);
// share-targets is exposed under /shares/targets via the shares router.
app.route("/", contacts); // /persons/:id/contacts + /contacts/:id
app.route("/", controllers); // /persons/:id/controllers + /control-invites
app.post("/control-invites/:id/accept", (c) =>
  // Acceptance happens via the magic-link callback (kind=invite); this endpoint
  // exists for admin-driven grants in a later milestone.
  c.json({ error: "use_magic_link" }, 400),
);

// Profile photo serving (R2). Signed/time-limited URLs land in M2; for now a
// controller-agnostic passthrough of the object if it exists.
app.get("/photos/:key", async (c) => {
  const obj = await c.env.PHOTOS.get(c.req.param("key"));
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
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

// Cron: refresh the shared calendar from its ICS feeds (see wrangler.toml
// [triggers]). Errors are recorded per-source and never throw.
const scheduled: ExportedHandlerScheduledHandler<Env> = (_event, env, ctx) => {
  ctx.waitUntil(refreshAllSources(env));
};

export default { fetch: app.fetch, scheduled };

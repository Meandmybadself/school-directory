// Instance settings. Registration toggle (FR-4) — readable and writable by
// system admins. The /auth/start flow reads this server-side; it is never used
// to reveal account existence to clients.

import { Hono } from "hono";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { isRegistrationOpen, setSetting } from "../lib/db.js";

export const settings = new Hono<HonoEnv>();

/** GET /settings/registration → { open } (system admins). */
settings.get("/registration", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  return c.json({ open: await isRegistrationOpen(c.env) });
});

/** PUT /settings/registration { open } (system admins). */
settings.put("/registration", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<{ open: boolean }>().catch(() => null);
  if (typeof body?.open !== "boolean") return c.json({ error: "invalid_body" }, 400);

  await setSetting(c.env, "registration_open", body.open ? "true" : "false");
  c.var.audit.push({ action: "registration.toggled", entityKind: "setting", entityId: "registration_open", detail: { open: body.open } });
  return c.json({ open: body.open });
});

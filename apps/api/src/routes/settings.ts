// Instance settings. Registration toggle (FR-4) — readable and writable by
// system admins. The /auth/start flow reads this server-side; it is never used
// to reveal account existence to clients.

import { Hono } from "hono";
import { NEW_USER_NOTIFY_MODES, type NewUserNotify } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { isRegistrationOpen, setSetting } from "../lib/db.js";
import { getNewUserNotify, setNewUserNotify } from "../lib/notify.js";

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
  c.var.audit.push({
    action: "registration.toggled",
    entityKind: "setting",
    entityId: "registration_open",
    detail: { open: body.open },
    notify: { open: body.open },
  });
  return c.json({ open: body.open });
});

/**
 * GET /settings/notifications → { newUser } — the CALLER's own new-member mode.
 *
 * Per admin, not per instance (migration 0026): each admin decides whether
 * sign-ups reach their own inbox, and nobody can turn it on for anyone else.
 * A masquerade is already refused — a masqueraded target is never
 * `isSystemAdmin` — so an admin can't change the choice of the admin they are
 * viewing as.
 */
settings.get("/notifications", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  return c.json({ newUser: await getNewUserNotify(c.env, auth.userId) });
});

/** PUT /settings/notifications { newUser } — set the caller's own mode. */
settings.put("/notifications", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<{ newUser: NewUserNotify }>().catch(() => null);
  const mode = body?.newUser;
  if (!mode || !NEW_USER_NOTIFY_MODES.includes(mode)) return c.json({ error: "invalid_body" }, 400);

  await setNewUserNotify(c.env, auth.userId, mode);
  c.var.audit.push({
    action: "notify.toggled",
    entityKind: "user",
    entityId: auth.userId,
    detail: { setting: "new_user_notify", mode },
  });
  return c.json({ newUser: mode });
});

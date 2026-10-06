// Instance settings. Registration toggle (FR-4) — readable and writable by
// system admins. The /auth/start flow reads this server-side; it is never used
// to reveal account existence to clients.

import { Hono } from "hono";
import { NEW_USER_NOTIFY_MODES, type NewUserNotify, type NotificationSettingsDTO } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { isRegistrationOpen, setSetting } from "../lib/db.js";
import {
  getAccessRequestNotify,
  getNewUserNotify,
  setAccessRequestNotify,
  setNewUserNotify,
} from "../lib/notify.js";

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
 * GET /settings/notifications → { newUser, accessRequest } — the CALLER's own
 * notification choices.
 *
 * Per admin, not per instance (migrations 0026, 0034): each admin decides what
 * reaches their own inbox, and nobody can change it for anyone else. A
 * masquerade is already refused — a masqueraded target is never
 * `isSystemAdmin` — so an admin can't change the choice of the admin they are
 * viewing as.
 */
settings.get("/notifications", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  return c.json(await notificationsOf(c.env, auth.userId));
});

/** PUT /settings/notifications { newUser?, accessRequest? } — set the caller's
 *  own choices. Either field may be sent alone; one audit row per field that
 *  was sent. */
settings.put("/notifications", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req
    .json<{ newUser?: NewUserNotify; accessRequest?: boolean }>()
    .catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  const { newUser, accessRequest } = body;
  if (newUser === undefined && accessRequest === undefined) return c.json({ error: "invalid_body" }, 400);
  if (newUser !== undefined && !NEW_USER_NOTIFY_MODES.includes(newUser)) {
    return c.json({ error: "invalid_body" }, 400);
  }
  if (accessRequest !== undefined && typeof accessRequest !== "boolean") {
    return c.json({ error: "invalid_body" }, 400);
  }

  if (newUser !== undefined) {
    await setNewUserNotify(c.env, auth.userId, newUser);
    c.var.audit.push({
      action: "notify.toggled",
      entityKind: "user",
      entityId: auth.userId,
      detail: { setting: "new_user_notify", mode: newUser },
    });
  }
  if (accessRequest !== undefined) {
    await setAccessRequestNotify(c.env, auth.userId, accessRequest);
    c.var.audit.push({
      action: "notify.toggled",
      entityKind: "user",
      entityId: auth.userId,
      detail: { setting: "access_request_notify", on: accessRequest },
    });
  }
  return c.json(await notificationsOf(c.env, auth.userId));
});

async function notificationsOf(env: HonoEnv["Bindings"], userId: string): Promise<NotificationSettingsDTO> {
  const [newUser, accessRequest] = await Promise.all([
    getNewUserNotify(env, userId),
    getAccessRequestNotify(env, userId),
  ]);
  return { newUser, accessRequest };
}

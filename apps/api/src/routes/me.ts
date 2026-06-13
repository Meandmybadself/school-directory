// /me — the requesting User, the Persons they control, and the active Person.

import { Hono } from "hono";
import type { ControllablePersonDTO, Locale, MeDTO } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { capabilitiesFor } from "../lib/serialize.js";
import { setActivePersonCookie } from "../lib/cookies.js";
import { displayName } from "../lib/privacy.js";

export const me = new Hono<HonoEnv>();

me.get("/", async (c) => {
  const auth = requireAuth(c);

  const personRows = await c.env.DB.prepare(
    `SELECT p.id, p.first_name, p.last_name, p.last_name_visibility, p.photo_object_key
     FROM control ctl JOIN person p ON p.id = ctl.person_id
     WHERE ctl.user_id = ? ORDER BY ctl.since ASC`,
  )
    .bind(auth.userId)
    .all<{
      id: string;
      first_name: string;
      last_name: string | null;
      last_name_visibility: "full" | "initial" | "hidden";
      photo_object_key: string | null;
    }>();

  const persons: ControllablePersonDTO[] = [];
  for (const p of personRows.results) {
    persons.push({
      id: p.id,
      firstName: p.first_name,
      // Controllers see the full name in the switcher.
      displayName: displayName(p.first_name, p.last_name, p.last_name_visibility, true),
      capabilities: await capabilitiesFor(c.env, p.id),
      photoUrl: p.photo_object_key ? `/photos/${p.photo_object_key}` : null,
    });
  }

  const userRow = await c.env.DB.prepare("SELECT locale FROM user WHERE id = ?")
    .bind(auth.userId)
    .first<{ locale: Locale | null }>();

  const dto: MeDTO = {
    user: {
      id: auth.userId,
      email: auth.email,
      isSystemAdmin: auth.isSystemAdmin,
      locale: userRow?.locale ?? null,
    },
    persons,
    activePersonId: auth.activePersonId,
    // Surface the acting admin's id while masquerading so the client shows the banner.
    masqueradingAs: auth.isMasquerading ? auth.realUserId : null,
  };
  return c.json(dto);
});

/** POST /me/active-person { personId } — switch the active Person. */
me.post("/active-person", async (c) => {
  const auth = requireAuth(c);
  const body = await c.req.json<{ personId: string }>().catch(() => null);
  if (!body?.personId) return c.json({ error: "personId required" }, 400);

  const controls = await c.env.DB.prepare(
    "SELECT 1 AS ok FROM control WHERE user_id = ? AND person_id = ? LIMIT 1",
  )
    .bind(auth.userId, body.personId)
    .first<{ ok: number }>();
  if (!controls) return c.json({ error: "not_controlled" }, 403);

  setActivePersonCookie(c, body.personId);
  return c.json({ ok: true, activePersonId: body.personId });
});

/** PUT /me/locale { locale } — set the user's preferred UI locale. */
me.put("/locale", async (c) => {
  const auth = requireAuth(c);
  const body = await c.req.json<{ locale: Locale }>().catch(() => null);
  const allowed: Locale[] = ["en", "es", "zh"];
  if (!body || !allowed.includes(body.locale)) {
    return c.json({ error: "invalid_locale" }, 400);
  }
  await c.env.DB.prepare("UPDATE user SET locale = ? WHERE id = ?")
    .bind(body.locale, auth.userId)
    .run();
  return c.json({ ok: true, locale: body.locale });
});

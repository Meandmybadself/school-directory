// /me — the requesting User, the Persons they control, and the active Person.

import { Hono } from "hono";
import type { Context } from "hono";
import type { Capability, ControllablePersonDTO, CreatePersonBody, Locale, MeDTO, MyHouseholdDTO } from "@sd/shared";
import { CAPABILITIES } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { capabilitiesFor } from "../lib/serialize.js";
import { setActivePersonCookie } from "../lib/cookies.js";
import { displayName } from "../lib/privacy.js";
import { ulid } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";

export const me = new Hono<HonoEnv>();

/** True if the User administers the given household (controls an admin member). */
async function adminsHousehold(c: Context<HonoEnv>, userId: string, groupId: string): Promise<boolean> {
  const row = await c.env.DB.prepare(
    `SELECT 1 AS ok FROM grp g
     JOIN membership m ON m.group_id = g.id AND m.is_admin = 1
     JOIN control ctl ON ctl.person_id = m.person_id
     WHERE g.id = ? AND g.kind = 'household' AND ctl.user_id = ? LIMIT 1`,
  )
    .bind(groupId, userId)
    .first<{ ok: number }>();
  return !!row;
}

/** POST /me/persons — create a directory Person the requesting User controls.
 *  Used for self-onboarding (name only) AND for adding family members (children,
 *  partners, …) with optional capabilities and a household. The first Person a
 *  User creates becomes their active Person; later ones do not steal focus. */
me.post("/persons", async (c) => {
  const auth = requireAuth(c);
  const body = await c.req.json<CreatePersonBody>().catch(() => null);
  const firstName = body?.firstName?.trim();
  if (!firstName) return c.json({ error: "invalid_body" }, 400);
  const lastName = body?.lastName?.trim() || null;

  // Whitelist requested capabilities against the known set.
  const caps: Capability[] = Array.isArray(body?.capabilities)
    ? [...new Set(body!.capabilities)].filter((x): x is Capability => CAPABILITIES.includes(x as Capability))
    : [];

  // A household, if given, must be one this User administers (so the new member
  // legitimately inherits its cascading address).
  let householdId: string | null = null;
  if (body?.householdId) {
    if (!(await adminsHousehold(c, auth.userId, body.householdId))) {
      return c.json({ error: "forbidden_household" }, 403);
    }
    householdId = body.householdId;
  }

  // The very first Person a User creates becomes active (onboarding); additional
  // family members are added without switching who the User is acting as.
  const existing = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM control WHERE user_id = ?")
    .bind(auth.userId)
    .first<{ n: number }>();
  const makeActive = (existing?.n ?? 0) === 0;

  const personId = ulid();
  const stmts = [
    c.env.DB.prepare(
      "INSERT INTO person (id, first_name, last_name, last_name_visibility, created_at) VALUES (?,?,?, 'full', ?)",
    ).bind(personId, firstName, lastName, nowIso()),
    c.env.DB.prepare(
      "INSERT INTO control (user_id, person_id, granted_by, since) VALUES (?,?,?,?)",
    ).bind(auth.userId, personId, auth.userId, nowIso()),
    ...caps.map((cap) =>
      c.env.DB.prepare("INSERT INTO capability_grant (person_id, capability) VALUES (?, ?)").bind(personId, cap),
    ),
  ];
  if (householdId) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO membership (group_id, person_id, title, is_admin, joined_at) VALUES (?,?,NULL,0,?)",
      ).bind(householdId, personId, nowIso()),
    );
  }
  await c.env.DB.batch(stmts);

  if (makeActive) setActivePersonCookie(c, personId);

  c.var.audit.push({ action: "control.granted", entityKind: "person", entityId: personId, detail: { userId: auth.userId, self: true } });
  if (householdId) {
    c.var.audit.push({ action: "admin.action", entityKind: "group", entityId: householdId, detail: { op: "member.add", personId } });
  }
  return c.json({ id: personId, activated: makeActive }, 201);
});

/** GET /me/households — households the User administers, for the create-person
 *  picker. Names only. */
me.get("/households", async (c) => {
  const auth = requireAuth(c);
  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT g.id, g.name FROM grp g
     JOIN membership m ON m.group_id = g.id AND m.is_admin = 1
     JOIN control ctl ON ctl.person_id = m.person_id
     WHERE g.kind = 'household' AND ctl.user_id = ?
     ORDER BY g.name COLLATE NOCASE`,
  )
    .bind(auth.userId)
    .all<{ id: string; name: string }>();
  const households: MyHouseholdDTO[] = rows.results.map((g) => ({ id: g.id, name: g.name }));
  return c.json({ households });
});

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
      last_name_visibility: "full" | "initial";
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

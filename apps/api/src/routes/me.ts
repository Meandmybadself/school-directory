// /me — the requesting User, the Persons they control, and the active Person.

import { Hono } from "hono";
import type { Context } from "hono";
import type { Capability, ControllablePersonDTO, CreatePersonBody, Locale, MeDTO, MyHouseholdDTO } from "@sd/shared";
import { ASSIGNABLE_CAPABILITIES, LOCALES } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { capabilitiesFor } from "../lib/serialize.js";
import { setActivePersonCookie } from "../lib/cookies.js";
import { displayName } from "../lib/privacy.js";
import { ulid } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { accessClaimStatus, accessRowOf, accessStateOf, type AccessRow } from "../lib/directoryAccess.js";
import { notifyAccessRequest } from "../lib/notify.js";

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

  // Whitelist requested capabilities against the ASSIGNABLE set, not every known
  // code. `household_admin` is the difference: it is earned by being the admin
  // member of a household (POST /groups grants it), never handed out on a Person
  // somebody just made up. Nothing authorizes on it today — it renders as a
  // badge — so this closes a labelling lie rather than a privilege hole, but the
  // client has only ever offered these four and the server should agree.
  const caps: Capability[] = Array.isArray(body?.capabilities)
    ? [...new Set(body!.capabilities)].filter((x): x is Capability =>
        ASSIGNABLE_CAPABILITIES.includes(x as Capability),
      )
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

  // Pushed before control.granted: the Person existing is the primary fact and
  // the grant is a consequence of it. The name is deliberately NOT in `notify` —
  // a formatter that wants one looks it up through `personLabel`, which applies
  // the unlisted gate and the surname rule (invariants 21 and 22).
  c.var.audit.push({
    action: "person.created",
    entityKind: "person",
    entityId: personId,
    detail: { userId: auth.userId, householdId, capabilities: caps },
    notify: { householdId },
  });
  c.var.audit.push({
    action: "control.granted",
    entityKind: "person",
    entityId: personId,
    detail: { userId: auth.userId, self: true },
    // `self` reaches the notifier so it can DECLINE this one: the
    // person.created draft above already reported the same act, and a channel
    // saying it twice in one message is noise rather than detail.
    notify: { self: true },
  });
  if (householdId) {
    c.var.audit.push({
      action: "admin.action",
      entityKind: "group",
      entityId: householdId,
      detail: { op: "member.add", personId },
      notify: { op: "member.add", personId },
    });
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

  // UNLISTED-EXEMPT: every row is a Person the viewer controls (WHERE
  // ctl.user_id = ?), which is the gate's own exception.
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

  // One read, not two: `/me` runs on every app load, and the access dates live
  // on the same row the locale does. They are deliberately NOT taken from the
  // session join — that one carries a boolean, and this has to distinguish
  // "never asked" from "asked and waiting" from "declined".
  const userRow = await c.env.DB.prepare(
    `SELECT locale, access_submitted_at, access_approved_at, access_declined_at
       FROM user WHERE id = ?`,
  )
    .bind(auth.userId)
    .first<{ locale: Locale | null } & AccessRow>();

  // The gate, reported on the one route deliberately outside it (migration
  // 0029). A pending member has to be told WHY the directory is empty, and a
  // route that refused them could not do the telling — the same reason
  // `GET /pto/access` and `GET /newsletter/access` sit outside their own gates.
  const access = accessStateOf(
    userRow ?? { access_submitted_at: null, access_approved_at: null, access_declined_at: null },
    auth.isSystemAdmin,
  );

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
    directoryAccess: access,
  };
  // Itemised for the two states that SHOW the form. `pending` and `approved`
  // have nothing to fill in, so a list of conditions there is noise — but a
  // declined family is being asked to fix something and ask again, and without
  // this their form would render every condition as unmet and keep the submit
  // button disabled on a claim that is actually complete.
  if (access === "incomplete" || access === "declined") {
    dto.accessClaim = await accessClaimStatus(c.env, auth.userId);
  }
  return c.json(dto);
});

/**
 * GET /me/classroom-options — the rooms an applicant may choose from.
 *
 * Its own route because `GET /groups` is gated (invariant 32) and this is the
 * one thing a PENDING account legitimately needs from it: you cannot name your
 * child's classroom without being shown the list of classrooms. Narrow on
 * purpose — `kind = 'classroom'`, id and name only, no counts, no rosters, no
 * contacts, nothing about who is in them.
 *
 * What it discloses is the set of room names, which are the district's own
 * (`Grade 1 · Community School · Leslie Neal · Rm 110`) and are printed on
 * every class list sent home. Invariant 21 already accepts that any member may
 * search every group's NAME; this gives a pending member strictly less than
 * that, and gives it for the length of one form.
 */
me.get("/classroom-options", async (c) => {
  requireAuth(c);
  const rows = await c.env.DB.prepare(
    "SELECT id, name FROM grp WHERE kind = 'classroom' ORDER BY name COLLATE NOCASE",
  ).all<{ id: string; name: string }>();
  return c.json({ classrooms: rows.results });
});

/**
 * POST /me/access-request { note? } — ask to read the directory.
 *
 * The claim is not carried in this body: it is the Person rows the applicant
 * already created, read live by the admin queue. All this route does is record
 * that they are ready to be looked at — which is why it re-derives completeness
 * server-side rather than trusting the client's own enabled/disabled button.
 *
 * Idempotent while pending: asking twice is an answer, not a failure, and must
 * not push a second audit draft — an append-only log (invariant 5) is not
 * paddable by a double tap, the rule invariants 27 and 28 both state for a
 * repeated placement and a re-dropped card.
 *
 * Re-asking after a DECLINE is allowed and clears the decision back to pending:
 * a family told "we could not find your child" fixes the room and asks again,
 * which is the whole point of declining being reversible.
 */
me.post("/access-request", async (c) => {
  const auth = requireAuth(c);
  const body = await c.req.json<{ note?: string }>().catch(() => null);
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : null;

  const row = await accessRowOf(c.env, auth.userId);
  const state = accessStateOf(row, auth.isSystemAdmin);
  if (state === "approved" || state === "pending") {
    return c.json({ directoryAccess: state });
  }

  const claim = await accessClaimStatus(c.env, auth.userId);
  if (!claim.complete) return c.json({ error: "claim_incomplete", accessClaim: claim }, 400);

  await c.env.DB.prepare(
    // The note is only REPLACED when they wrote one. Re-asking after a decline
    // is the moment a reviewer most needs the original explanation ("we
    // started in January"), and blanking it because the second form came back
    // empty would delete the one thing that might answer why the first
    // decision was wrong.
    `UPDATE user
        SET access_submitted_at = ?, access_declined_at = NULL,
            access_note = COALESCE(?, access_note)
      WHERE id = ?`,
  )
    .bind(nowIso(), note, auth.userId)
    .run();

  c.var.audit.push({
    action: "access.requested",
    entityKind: "user",
    entityId: auth.userId,
    detail: { resubmitted: state === "declined" },
    // The ONLY thing this feature puts in a `notify` bag, and it is a boolean.
    // A formatter cannot see `detail` (invariant 22), so without this the Slack
    // line could not tell a first application from one made again after a
    // decline — which is the one distinction a reviewer wants from a channel.
    // Nothing identifying goes here on purpose: the claim is a child's name and
    // a teacher, and it belongs on the queue screen behind a session.
    notify: { resubmitted: state === "declined" },
  });
  c.executionCtx.waitUntil(notifyAccessRequest(c.env, { email: auth.email }));
  return c.json({ directoryAccess: "pending" as const });
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

/** GET /me/newsletter → { subscribed } — the member's own newsletter preference.
 *  Opting out is stored as a timestamp on the user row rather than a boolean, so
 *  the audit trail carries when it happened. */
me.get("/newsletter", async (c) => {
  const auth = requireAuth(c);
  const row = await c.env.DB.prepare("SELECT newsletter_opt_out_at FROM user WHERE id = ?")
    .bind(auth.userId)
    .first<{ newsletter_opt_out_at: string | null }>();
  return c.json({ subscribed: row?.newsletter_opt_out_at == null });
});

/** PUT /me/newsletter { subscribed } — subscribe or unsubscribe yourself. */
me.put("/newsletter", async (c) => {
  const auth = requireAuth(c);
  const body = await c.req.json<{ subscribed: boolean }>().catch(() => null);
  if (typeof body?.subscribed !== "boolean") return c.json({ error: "invalid_body" }, 400);

  await c.env.DB.prepare("UPDATE user SET newsletter_opt_out_at = ? WHERE id = ?")
    .bind(body.subscribed ? null : nowIso(), auth.userId)
    .run();

  c.var.audit.push({
    action: "newsletter.subscription.toggled",
    entityKind: "user",
    entityId: auth.userId,
    detail: { subscribed: body.subscribed },
  });
  return c.json({ subscribed: body.subscribed });
});

/** PUT /me/locale { locale } — set the user's preferred UI locale. */
me.put("/locale", async (c) => {
  const auth = requireAuth(c);
  const body = await c.req.json<{ locale: Locale }>().catch(() => null);
  // LOCALES, not a copy of it: a locale added to @sd/shared is one the picker
  // already offers, and a hand-kept list here would silently reject it.
  if (!body || !LOCALES.includes(body.locale)) {
    return c.json({ error: "invalid_locale" }, 400);
  }
  await c.env.DB.prepare("UPDATE user SET locale = ? WHERE id = ?")
    .bind(body.locale, auth.userId)
    .run();
  return c.json({ ok: true, locale: body.locale });
});

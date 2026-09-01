// Persons & profiles — privacy-filtered reads, controller-gated writes.

import { Hono } from "hono";
import type { PersonPatchBody, PersonRemovalImpactDTO } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { buildProfile } from "../lib/serialize.js";
import { isController, personListableSql } from "../lib/privacy.js";
import { clearActivePersonCookie } from "../lib/cookies.js";
import { nowIso } from "../lib/time.js";
import { ulid } from "../lib/ids.js";

export const persons = new Hono<HonoEnv>();

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

/** GET /persons/:id — profile as the active viewer is permitted to see it.
 *  `?as=member` asks a Controller's view to be downgraded to a plain member's,
 *  so the view screen is an honest preview of what everyone else sees. */
persons.get("/:id", async (c) => {
  const auth = requireAuth(c);
  const viewer = { userId: auth.userId, personId: auth.activePersonId };
  const profile = await buildProfile(c.env, viewer, c.req.param("id"), {
    asMember: c.req.query("as") === "member",
    isSystemAdmin: auth.isSystemAdmin,
  });
  if (!profile) return c.json({ error: "not_found" }, 404);
  return c.json(profile);
});

/** PATCH /persons/:id — update name fields. Controllers only. */
persons.patch("/:id", async (c) => {
  const auth = requireAuth(c);
  const personId = c.req.param("id");
  if (!(await isController(c.env, auth.userId, personId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const body = await c.req.json<PersonPatchBody>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.firstName === "string" && body.firstName.trim()) {
    sets.push("first_name = ?");
    binds.push(body.firstName.trim());
  }
  if (body.lastName !== undefined) {
    sets.push("last_name = ?");
    binds.push(body.lastName ? body.lastName.trim() : null);
  }
  if (body.lastNameDisplay && ["full", "initial"].includes(body.lastNameDisplay)) {
    sets.push("last_name_visibility = ?");
    binds.push(body.lastNameDisplay);
  }
  if (!sets.length) return c.json({ error: "nothing_to_update" }, 400);

  binds.push(personId);
  await c.env.DB.prepare(`UPDATE person SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();

  c.var.audit.push({
    action: "person.updated",
    entityKind: "person",
    entityId: personId,
    detail: { fields: sets.map((s) => s.split(" ")[0]) },
  });

  const profile = await buildProfile(
    c.env,
    { userId: auth.userId, personId: auth.activePersonId },
    personId,
    { isSystemAdmin: auth.isSystemAdmin },
  );
  return c.json(profile);
});

/** POST /persons/:id/photo — upload a profile photo to R2. Controllers only.
 *  Body is the raw image; Content-Type identifies the format. */
persons.post("/:id/photo", async (c) => {
  const auth = requireAuth(c);
  const personId = c.req.param("id");
  if (!(await isController(c.env, auth.userId, personId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const contentType = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
  const ext = PHOTO_TYPES[contentType];
  if (!ext) return c.json({ error: "unsupported_type" }, 415);

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty" }, 400);
  if (body.byteLength > MAX_PHOTO_BYTES) return c.json({ error: "too_large" }, 413);

  const key = `${ulid()}.${ext}`;
  await c.env.PHOTOS.put(key, body, { httpMetadata: { contentType } });

  // UNLISTED-EXEMPT: single row by id behind an isController gate, and it
  // returns no identity — just the key of the object being replaced.
  const prev = await c.env.DB.prepare("SELECT photo_object_key FROM person WHERE id = ?")
    .bind(personId)
    .first<{ photo_object_key: string | null }>();
  await c.env.DB.prepare("UPDATE person SET photo_object_key = ? WHERE id = ?")
    .bind(key, personId)
    .run();
  if (prev?.photo_object_key) {
    c.executionCtx.waitUntil(c.env.PHOTOS.delete(prev.photo_object_key));
  }

  c.var.audit.push({ action: "person.updated", entityKind: "person", entityId: personId, detail: { photo: true } });
  return c.json({ photoUrl: `/photos/${key}` }, 201);
});

/** POST /persons/:id/unlisted { unlisted } — take a Person off the roster, or
 *  put them back.
 *
 *  System-admin only, and deliberately not something a Controller may do to
 *  their own Person. Every other privacy control here governs what one FIELD
 *  reveals — `visibility`, `neighborDiscoverable`, `lastNameDisplay`. This one
 *  removes someone from the census: from classroom rosters, from a co-parent's
 *  search, from the volunteer names a sheet shows. That is a different kind of
 *  withholding, and it is the school's call rather than a family's.
 *
 *  Idempotent, like POST /admin/users/:id/disabled: setting what is already set
 *  is an answer, not a failure. A Controller still SEES the flag on a Person
 *  they control (buildProfile surfaces it to them) — they just can't move it.
 */
persons.post("/:id/unlisted", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const personId = c.req.param("id");
  const body = await c.req.json<{ unlisted?: boolean }>().catch(() => null);
  if (typeof body?.unlisted !== "boolean") return c.json({ error: "invalid_body" }, 400);

  // UNLISTED-EXEMPT: the route is system-admin gated above, and this is the one
  // read whose whole job is to find a Person the gate would hide.
  const target = await c.env.DB.prepare("SELECT id, unlisted_at FROM person WHERE id = ?")
    .bind(personId)
    .first<{ id: string; unlisted_at: string | null }>();
  if (!target) return c.json({ error: "not_found" }, 404);

  const already = target.unlisted_at !== null;
  if (already === body.unlisted) return c.json({ ok: true, unlisted: already });

  const unlistedAt = body.unlisted ? nowIso() : null;
  await c.env.DB.prepare("UPDATE person SET unlisted_at = ? WHERE id = ?")
    .bind(unlistedAt, personId)
    .run();

  c.var.audit.push({
    action: "admin.action",
    entityKind: "person",
    entityId: personId,
    detail: { op: body.unlisted ? "person.unlisted" : "person.relisted" },
  });
  return c.json({ ok: true, unlisted: body.unlisted });
});

// ── Removal ────────────────────────────────────────────────────────────────
//
// The one destructive act an ordinary member may perform, and unlike disabling
// a User (invariant 17) it is permanent: there is no `deleted_at` to reverse,
// because a Person nobody controls and nobody sees is not a thing worth keeping
// a tombstone of. That makes the guards, the pre-count and the audit `detail`
// the whole of the design.
//
// WHO MAY. A sole Controller, which is a narrower test than "whoever created
// them" and the right one. `control` is many-to-many by design — two parents,
// one child — so a Person another User also controls is not this user's to
// take; that is invariant 17's rule for User deletion, and it applies unchanged
// one level down. Reading it as "created" instead would have keyed on
// `control.granted_by`, which is wrong in both directions: a co-parent left as
// the only Controller after the other leaves could never clean up, and a Person
// created by someone who has since been joined by a second Controller would
// still look deletable.
//
// WHAT IT TAKES WITH IT. Everything that hangs off the Person and nothing that
// belongs to the school. Contacts, shares (in both directions — as subject and
// as target), memberships, capabilities, control rows, unconsumed invitations
// and volunteer signups all go; groups do not, except a household left with no
// members at all, which is the rule GET /admin/users/:id/impact already states.
// `audit_log` is never touched, for invariant 5's reason: it is append-only and
// hash-chained, and dropping rows would erase the record of the deletion along
// with everything else the Person did.

/** The guards and the counts, shared by the preview and the delete so the two
 *  can never disagree about what is about to happen. */
async function removalImpact(
  env: HonoEnv["Bindings"],
  userId: string,
  personId: string,
): Promise<PersonRemovalImpactDTO> {
  const [others, contacts, groups, signups, orphanAdmin, emptied] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM control WHERE person_id = ? AND user_id <> ?")
      .bind(personId, userId)
      .first<{ n: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS n FROM contact_item WHERE owner_kind = 'person' AND owner_id = ?",
    )
      .bind(personId)
      .first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM membership WHERE person_id = ?")
      .bind(personId)
      .first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM volunteer_signup WHERE person_id = ?")
      .bind(personId)
      .first<{ n: number }>(),
    // Households this Person is the ONLY admin of, that would still have other
    // members afterwards. Removing them there leaves a group nobody can edit —
    // recoverable only by a system admin, so it is refused rather than warned
    // about. A household they alone occupy is not this case; it is `emptied`.
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM membership mine
         JOIN grp g ON g.id = mine.group_id AND g.kind = 'household'
        WHERE mine.person_id = ? AND mine.is_admin = 1
          AND NOT EXISTS (SELECT 1 FROM membership o WHERE o.group_id = mine.group_id
                            AND o.person_id <> mine.person_id AND o.is_admin = 1)
          AND EXISTS (SELECT 1 FROM membership o WHERE o.group_id = mine.group_id
                        AND o.person_id <> mine.person_id)`,
    )
      .bind(personId)
      .first<{ n: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM membership mine
         JOIN grp g ON g.id = mine.group_id AND g.kind = 'household'
        WHERE mine.person_id = ?
          AND NOT EXISTS (SELECT 1 FROM membership o WHERE o.group_id = mine.group_id
                            AND o.person_id <> mine.person_id)`,
    )
      .bind(personId)
      .first<{ n: number }>(),
  ]);

  const otherControllers = others?.n ?? 0;
  const reason: PersonRemovalImpactDTO["reason"] =
    otherControllers > 0 ? "shared" : (orphanAdmin?.n ?? 0) > 0 ? "household_admin" : undefined;

  return {
    personId,
    allowed: reason === undefined,
    ...(reason ? { reason } : {}),
    otherControllers,
    contactItems: contacts?.n ?? 0,
    groups: groups?.n ?? 0,
    volunteerSignups: signups?.n ?? 0,
    emptiedHouseholds: emptied?.n ?? 0,
    isActive: false,
  };
}

/** GET /persons/:id/removal-impact — what DELETE would do, before doing it.
 *
 *  Its own route rather than a field on `PersonProfileDTO`: every profile view
 *  in the app would otherwise pay for six counts nobody reads, where this is
 *  fetched once, when someone opens the confirmation. */
persons.get("/:id/removal-impact", async (c) => {
  const auth = requireAuth(c);
  const personId = c.req.param("id");
  if (!(await isController(c.env, auth.userId, personId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const impact = await removalImpact(c.env, auth.userId, personId);
  return c.json({ ...impact, isActive: auth.activePersonId === personId });
});

/** DELETE /persons/:id — remove a Person and everything hanging off them. */
persons.delete("/:id", async (c) => {
  const auth = requireAuth(c);
  const personId = c.req.param("id");
  if (!(await isController(c.env, auth.userId, personId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  // Re-run rather than trust anything the client saw: the preview above is an
  // explanation, not a permit, and a second Controller may have been added in
  // between.
  const impact = await removalImpact(c.env, auth.userId, personId);
  if (!impact.allowed) return c.json({ error: impact.reason, impact }, 409);

  // The name, for the audit row. Composed with the enumeration gate rather than
  // an exemption: `personListableSql` admits a Person to anyone who controls
  // them (invariant 21), which the isController check above has already
  // established — so the guard costs nothing here and spends none of
  // test/personListable.test.ts's remaining exemption budget.
  const listable = personListableSql(auth.userId, auth.isSystemAdmin, "p");
  const person = await c.env.DB.prepare(
    `SELECT p.first_name, p.last_name, p.photo_object_key FROM person p
      WHERE p.id = ? AND ${listable.sql}`,
  )
    .bind(personId, ...listable.binds)
    .first<{ first_name: string; last_name: string | null; photo_object_key: string | null }>();
  if (!person) return c.json({ error: "not_found" }, 404);

  // Households that will be left empty, resolved to ids BEFORE the memberships
  // go: afterwards there is nothing left to join them by.
  const emptied = await c.env.DB.prepare(
    `SELECT mine.group_id AS id FROM membership mine
       JOIN grp g ON g.id = mine.group_id AND g.kind = 'household'
      WHERE mine.person_id = ?
        AND NOT EXISTS (SELECT 1 FROM membership o WHERE o.group_id = mine.group_id
                          AND o.person_id <> mine.person_id)`,
  )
    .bind(personId)
    .all<{ id: string }>();
  const emptiedIds = emptied.results.map((r) => r.id);

  // Children first, then the row itself — the same ordering `sheetCascade`
  // takes for the same reason (invariant 13): a foreign key left dangling is
  // either a constraint failure or, worse, a row invisible to every read.
  const stmts = [
    c.env.DB.prepare("DELETE FROM volunteer_signup WHERE person_id = ?").bind(personId),
    // Shares in both directions. As SUBJECT, a share names either a contact
    // item of theirs or the synthetic `person:{id}:last_name` field ref; as
    // TARGET, it is someone else's field shared WITH them, which stops meaning
    // anything the moment they are gone.
    c.env.DB.prepare(
      `DELETE FROM share WHERE (subject_kind = 'contact_item' AND subject_ref IN
         (SELECT id FROM contact_item WHERE owner_kind = 'person' AND owner_id = ?))
         OR (subject_kind = 'field' AND subject_ref LIKE ?)
         OR (target_kind = 'person' AND target_id = ?)`,
    ).bind(personId, `person:${personId}:%`, personId),
    c.env.DB.prepare("DELETE FROM contact_item WHERE owner_kind = 'person' AND owner_id = ?").bind(personId),
    c.env.DB.prepare("DELETE FROM capability_grant WHERE person_id = ?").bind(personId),
    c.env.DB.prepare("DELETE FROM membership WHERE person_id = ?").bind(personId),
    c.env.DB.prepare("DELETE FROM control WHERE person_id = ?").bind(personId),
    // Invitations to co-manage them, and the tokens that would bind them. An
    // unconsumed invite left behind is a live capability pointing at a row that
    // no longer exists — /auth/callback would create a user for it and then
    // grant control of nothing.
    c.env.DB.prepare("DELETE FROM control_invite WHERE person_id = ?").bind(personId),
    c.env.DB.prepare("DELETE FROM auth_token WHERE person_id = ?").bind(personId),
    c.env.DB.prepare("DELETE FROM person WHERE id = ?").bind(personId),
    ...emptiedIds.flatMap((groupId) => [
      c.env.DB.prepare("DELETE FROM contact_item WHERE owner_kind = 'group' AND owner_id = ?").bind(groupId),
      c.env.DB.prepare("DELETE FROM share WHERE target_kind = 'group' AND target_id = ?").bind(groupId),
      c.env.DB.prepare("DELETE FROM grp WHERE id = ?").bind(groupId),
    ]),
  ];
  await c.env.DB.batch(stmts);

  if (person.photo_object_key) {
    c.executionCtx.waitUntil(c.env.PHOTOS.delete(person.photo_object_key));
  }
  // A dangling cookie self-heals — resolveActivePerson falls back to the
  // earliest Person still controlled — but clearing it means the next request
  // doesn't have to.
  if (auth.activePersonId === personId) clearActivePersonCookie(c);

  // The name goes in `detail` because in a second nothing else will hold it,
  // and an audit row saying a ULID was deleted is not a record of anything.
  // It stays OUT of `notify` for invariant 22's reason — see the `person.deleted`
  // comment on AuditAction: with the row gone there is no gated lookup left, so
  // the action has no Slack formatter and says nothing to the channel at all.
  c.var.audit.push({
    action: "person.deleted",
    entityKind: "person",
    entityId: personId,
    detail: {
      firstName: person.first_name,
      lastName: person.last_name,
      contactItems: impact.contactItems,
      groups: impact.groups,
      volunteerSignups: impact.volunteerSignups,
      emptiedHouseholds: emptiedIds,
    },
  });
  return c.json({ ok: true, emptiedHouseholds: emptiedIds.length });
});

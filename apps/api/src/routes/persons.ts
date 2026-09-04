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

// ── Classroom placement (a Controller's own children) ────────────────────────
//
// The one roster a member may edit without administering it. `POST
// /groups/:id/members` stays behind `requireGroupAdmin` and is unchanged; this
// is a narrower door with different hinges, and the difference is the point:
// there it is authority over a ROSTER, here it is authority over a PERSON, which
// is `isController` — the same gate every other write in this file uses.
//
// Three rules hold it, and each is a containment decision rather than a
// nicety. They are enforced here, on the server, and only mirrored in the DTO
// `GET /groups/:id` builds:
//
//  1. THE MEMBERSHIP IS SELF-ASSERTED, and that — not the cap below — is what
//     makes this safe. `self_asserted = 1` (migration 0023) puts the child on
//     the roster while `viewerIsDirectMember` (routes/groups.ts) and
//     `effectiveGroupIdsForPerson` (lib/groupTree.ts) both skip the row. Being on
//     a list and being trusted by the people on it are different things.
//     The first draft of this route relied on rule 2 plus the cap instead, and
//     that reasoning was wrong in two places, so it is written out here rather
//     than quietly fixed: `student` is not a school-conferred fact — any member
//     can mint a Person holding it via POST /me/persons, since
//     ASSIGNABLE_CAPABILITIES includes it and nobody approves it — and the cap
//     bounds SIMULTANEOUS membership where reading is a repeatable GET, so one
//     Person walked through all 34 rooms one PUT at a time reads all 34. What
//     needed weakening was the membership, not the count.
//
//  2. ONE CLASSROOM AT A TIME. A Person holds at most one classroom membership;
//     placing them in a second MOVES them. This is now a correctness rule about
//     rosters rather than a privacy control — a child sits in one room — and it
//     is why the write re-derives the set to delete INSIDE the batch.
//
//  3. STUDENTS ONLY, so a classroom roster keeps meaning "the children in this
//     room" and a bare adult account does not land on one. Load-bearing for
//     legibility, NOT for confinement — see rule 1 for why it cannot be. A room
//     parent is still added the old way, by whoever administers the room.
//
//  4. NEVER AN ADMIN MEMBERSHIP. Both routes refuse outright if the Person holds
//     one AND scope every DELETE to `is_admin = 0`, so this can never quietly
//     unseat whoever runs a classroom — the concern
//     `DELETE /groups/:id/members/:personId` answers with its last-admin check,
//     answered here by never touching the rows that raise it.

/** Every classroom membership a Person holds, admin flag included. The rule
 *  above allows at most one, but a system admin can have placed them in several
 *  through the roster route, so this reads the SET rather than assuming one —
 *  and the caller decides what to do with a surprise instead of silently
 *  half-fixing it. */
async function classroomMemberships(
  env: HonoEnv["Bindings"],
  personId: string,
): Promise<{ groupId: string; name: string; isAdmin: boolean }[]> {
  const rows = await env.DB.prepare(
    `SELECT g.id, g.name, m.is_admin FROM membership m
       JOIN grp g ON g.id = m.group_id
      WHERE m.person_id = ? AND g.kind = 'classroom'
      ORDER BY g.name`,
  )
    .bind(personId)
    .all<{ id: string; name: string; is_admin: number }>();
  return rows.results.map((r) => ({ groupId: r.id, name: r.name, isAdmin: r.is_admin === 1 }));
}

/** PUT /persons/:id/classroom { groupId } — place a Person in a classroom,
 *  moving them out of any other. Controllers only.
 *
 *  PUT rather than POST because it is idempotent and single-valued: a Person HAS
 *  a classroom, and sending the same one twice is the same state, not a second
 *  membership. That shape is also what makes "adding replaces" honest in the URL
 *  instead of a surprise in the handler. */
persons.put("/:id/classroom", async (c) => {
  const auth = requireAuth(c);
  const personId = c.req.param("id");
  if (!(await isController(c.env, auth.userId, personId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const body = await c.req.json<{ groupId?: string }>().catch(() => null);
  const groupId = body?.groupId?.trim();
  if (!groupId) return c.json({ error: "invalid_body" }, 400);

  const group = await c.env.DB.prepare("SELECT id, kind, name FROM grp WHERE id = ?")
    .bind(groupId)
    .first<{ id: string; kind: string; name: string }>();
  if (!group) return c.json({ error: "not_found" }, 404);
  // A 400, not a 403: the caller may well administer this group. It is the wrong
  // KIND of group for this door, and saying so is not a leak — `GET /groups/:id`
  // already tells any member what kind every group is.
  if (group.kind !== "classroom") return c.json({ error: "not_a_classroom" }, 400);

  const student = await c.env.DB.prepare(
    "SELECT 1 AS ok FROM capability_grant WHERE person_id = ? AND capability = 'student' LIMIT 1",
  )
    .bind(personId)
    .first<{ ok: number }>();
  if (!student) return c.json({ error: "not_a_student" }, 403);

  const current = await classroomMemberships(c.env, personId);
  // Rule 3. A Person who runs a room is not one this route may shuffle, and
  // refusing is better than moving them and leaving the room admin-less — the
  // outcome `DELETE /groups/:id/members/:personId` guards against by counting.
  if (current.some((m) => m.isAdmin)) {
    return c.json({ error: "runs_a_classroom" }, 409);
  }
  // Already exactly here: no write, and deliberately no audit row. An audit log
  // is a record of change (invariant 5), and a client that re-sends the same
  // placement — a double tap, a retry — must not be able to pad it.
  if (current.length === 1 && current[0]!.groupId === groupId) {
    return c.json({ ok: true, moved: false });
  }

  const leaving = current.filter((m) => m.groupId !== groupId);
  await c.env.DB.batch([
    // Scoped by KIND, evaluated at write time — deliberately not the id list the
    // read above produced. D1 has no read-then-write transaction, so a delete
    // naming ids read a moment ago is a read-then-write with no guard: two
    // concurrent PUTs for the same child (two parents, or one parent in two
    // tabs) would each see an empty `current`, each delete nothing, and each
    // insert — leaving the child in two rooms and breaking the very rule that
    // bounds this route. Re-deriving the set inside the batch closes it without
    // a compare-and-swap, because the batch is the transaction.
    // `is_admin = 0` is still here: this statement may never unseat whoever runs
    // a classroom, however it is later reordered.
    c.env.DB.prepare(
      `DELETE FROM membership
        WHERE person_id = ? AND is_admin = 0 AND group_id <> ?
          AND group_id IN (SELECT id FROM grp WHERE kind = 'classroom')`,
    ).bind(personId, groupId),
    // `is_admin` is a literal 0 and `title` a literal null — this door cannot
    // mint an admin or a title, whatever a body says, and there is no field in
    // scope that could carry one. `self_asserted` is a literal 1: nobody with
    // authority over this room approved it, and migration 0023 explains what
    // that costs the row.
    c.env.DB.prepare(
      `INSERT INTO membership (group_id, person_id, title, is_admin, self_asserted, joined_at)
       VALUES (?,?,NULL,0,1,?)
       ON CONFLICT (group_id, person_id) DO NOTHING`,
    ).bind(groupId, personId, nowIso()),
  ]);

  // One row for one act. A move carries where they came from, because the
  // membership table keeps no history and afterwards nothing else remembers.
  c.var.audit.push({
    action: "classroom.enrolled",
    entityKind: "person",
    entityId: personId,
    detail: {
      groupId,
      groupName: group.name,
      movedFrom: leaving.map((m) => ({ groupId: m.groupId, name: m.name })),
    },
  });
  return c.json({ ok: true, moved: true, leftCount: leaving.length });
});

/** DELETE /persons/:id/classroom?groupId= — take a Person out of ONE classroom.
 *
 *  Symmetric with the PUT and for a practical reason: without it a mis-tap is a
 *  support request, since the room has no admin of its own to undo it. It can
 *  only ever remove the caller's own controlled Person, and never an admin
 *  membership.
 *
 *  `groupId` is REQUIRED, and that is the correction to this route's first
 *  draft. It removed every classroom membership the Person held, while the UI
 *  that calls it says "remove from THIS class" — so a parent fixing a Room 12
 *  mistake would silently lose the child's Chorus placement too (see
 *  `ClassroomCandidateDTO.currentClassrooms` for how a child comes to hold
 *  two). A remove names the room it removes from. */
persons.delete("/:id/classroom", async (c) => {
  const auth = requireAuth(c);
  const personId = c.req.param("id");
  if (!(await isController(c.env, auth.userId, personId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const groupId = c.req.query("groupId")?.trim();
  if (!groupId) return c.json({ error: "invalid_body" }, 400);

  const current = await classroomMemberships(c.env, personId);
  const target = current.find((m) => m.groupId === groupId);
  if (!target) return c.json({ error: "not_enrolled" }, 404);
  // Not this route's Person to move — the same refusal the PUT gives, for the
  // same reason: it may never leave a classroom without an admin.
  if (target.isAdmin) return c.json({ error: "runs_a_classroom" }, 409);

  const res = await c.env.DB.prepare(
    "DELETE FROM membership WHERE person_id = ? AND group_id = ? AND is_admin = 0",
  )
    .bind(personId, groupId)
    .run();
  // Nothing removed means it went between the read and the write; say so rather
  // than record a removal that did not happen.
  if (!res.meta.changes) return c.json({ error: "not_enrolled" }, 404);

  c.var.audit.push({
    action: "classroom.unenrolled",
    entityKind: "person",
    entityId: personId,
    detail: { groupId, groupName: target.name },
  });
  return c.json({ ok: true });
});

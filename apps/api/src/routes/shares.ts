// Shares — grant a private field/contact item to specific Persons or Groups
// (FR-18). Only a Controller of the subject's owning Person may manage shares.
// A contact item with visibility 'private' + ≥1 share renders as "Shared · N".

import { Hono } from "hono";
import type { Context } from "hono";
import type { CreateShareBody, ShareGranteeDTO, ShareTargetDTO } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { isController, personSearchSql } from "../lib/privacy.js";
import { ulid } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";

export const shares = new Hono<HonoEnv>();

/** Resolve the Person who owns a share subject; null if not a controllable person subject. */
async function subjectOwnerPerson(
  c: Context<HonoEnv>,
  subjectKind: string,
  subjectRef: string,
): Promise<string | null> {
  if (subjectKind === "contact_item") {
    const row = await c.env.DB.prepare(
      "SELECT owner_kind, owner_id FROM contact_item WHERE id = ?",
    )
      .bind(subjectRef)
      .first<{ owner_kind: string; owner_id: string }>();
    if (!row || row.owner_kind !== "person") return null;
    return row.owner_id;
  }
  if (subjectKind === "field") {
    // "person:{id}:{field}"
    const m = /^person:([^:]+):/.exec(subjectRef);
    return m ? m[1]! : null;
  }
  return null;
}

/** GET /shares?subjectKind=&subjectRef= — current grantees (controller only). */
shares.get("/", async (c) => {
  const auth = requireAuth(c);
  const subjectKind = c.req.query("subjectKind") ?? "";
  const subjectRef = c.req.query("subjectRef") ?? "";
  const ownerPerson = await subjectOwnerPerson(c, subjectKind, subjectRef);
  if (!ownerPerson || !(await isController(c.env, auth.userId, ownerPerson))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const rows = await c.env.DB.prepare(
    "SELECT id, target_kind, target_id FROM share WHERE subject_kind = ? AND subject_ref = ?",
  )
    .bind(subjectKind, subjectRef)
    .all<{ id: string; target_kind: "person" | "group"; target_id: string }>();

  // Two queries for the whole list, not one per grantee — the same batching
  // buildProfile uses for shares. An id that resolves to nothing degrades to a
  // placeholder rather than dropping the row: this list is the answer to "who
  // can see this", and a silently shorter one is the wrong kind of wrong.
  const names = await targetNames(c, rows.results);
  const grantees: ShareGranteeDTO[] = rows.results.map((r) => ({
    id: r.id,
    targetKind: r.target_kind,
    targetId: r.target_id,
    name: names.get(`${r.target_kind}:${r.target_id}`) ?? (r.target_kind === "group" ? "Group" : "Member"),
  }));
  return c.json({ grantees });
});

/** POST /shares — create a share (controller of subject owner only). */
shares.post("/", async (c) => {
  const auth = requireAuth(c);
  const body = await c.req.json<CreateShareBody>().catch(() => null);
  if (!body?.subjectKind || !body.subjectRef || !body.targetKind || !body.targetId) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const ownerPerson = await subjectOwnerPerson(c, body.subjectKind, body.subjectRef);
  if (!ownerPerson || !(await isController(c.env, auth.userId, ownerPerson))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const id = ulid();
  await c.env.DB.prepare(
    `INSERT INTO share (id, subject_kind, subject_ref, target_kind, target_id, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (subject_kind, subject_ref, target_kind, target_id) DO NOTHING`,
  )
    .bind(id, body.subjectKind, body.subjectRef, body.targetKind, body.targetId, auth.userId, nowIso())
    .run();

  c.var.audit.push({
    action: "share.created",
    entityKind: body.subjectKind,
    entityId: body.subjectRef,
    detail: { targetKind: body.targetKind, targetId: body.targetId },
  });
  return c.json({ ok: true }, 201);
});

/** DELETE /shares/:id — revoke a share (controller of subject owner only). */
shares.delete("/:id", async (c) => {
  const auth = requireAuth(c);
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT subject_kind, subject_ref FROM share WHERE id = ?",
  )
    .bind(id)
    .first<{ subject_kind: string; subject_ref: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);

  const ownerPerson = await subjectOwnerPerson(c, row.subject_kind, row.subject_ref);
  if (!ownerPerson || !(await isController(c.env, auth.userId, ownerPerson))) {
    return c.json({ error: "forbidden" }, 403);
  }
  await c.env.DB.prepare("DELETE FROM share WHERE id = ?").bind(id).run();
  c.var.audit.push({ action: "share.revoked", entityKind: row.subject_kind, entityId: row.subject_ref });
  return c.json({ ok: true });
});

/** GET /share-targets?q= — Persons + Groups the user can share with. */
shares.get("/targets", async (c) => {
  const auth = requireAuth(c);
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const like = `%${q}%`;

  // The picker renders a last initial, so it must not MATCH on more than that
  // for a Person set to 'initial' — see personSearchSql.
  const search = personSearchSql(q, auth.userId);
  const people = await c.env.DB.prepare(
    `SELECT id, first_name, last_name, last_name_visibility FROM person
     WHERE ${search.sql}
     ORDER BY first_name LIMIT 25`,
  )
    .bind(...search.binds)
    .all<{ id: string; first_name: string; last_name: string | null; last_name_visibility: string }>();

  const groups = await c.env.DB.prepare(
    `SELECT id, name, kind FROM grp WHERE (? = '' OR lower(name) LIKE ?) ORDER BY name LIMIT 25`,
  )
    .bind(q, like)
    .all<{ id: string; name: string; kind: ShareTargetDTO["groupKind"] }>();

  const targets: ShareTargetDTO[] = [
    ...people.results.map((p) => ({
      kind: "person" as const,
      id: p.id,
      // First name + last initial for the picker (directory-safe).
      name: p.last_name ? `${p.first_name} ${p.last_name.charAt(0)}.` : p.first_name,
    })),
    ...groups.results.map((g) => ({ kind: "group" as const, id: g.id, name: g.name, groupKind: g.kind })),
  ];
  return c.json({ targets });
});

/** Display names for a whole grantee list, keyed "kind:id". Persons render as
 *  first name + last initial, matching the picker and the directory — this is a
 *  list of who you shared with, not a place to widen a name. */
async function targetNames(
  c: Context<HonoEnv>,
  rows: { target_kind: "person" | "group"; target_id: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const personIds = [...new Set(rows.filter((r) => r.target_kind === "person").map((r) => r.target_id))];
  const groupIds = [...new Set(rows.filter((r) => r.target_kind === "group").map((r) => r.target_id))];

  if (personIds.length) {
    const ps = await c.env.DB.prepare(
      `SELECT id, first_name, last_name FROM person WHERE id IN (${personIds.map(() => "?").join(",")})`,
    )
      .bind(...personIds)
      .all<{ id: string; first_name: string; last_name: string | null }>();
    for (const p of ps.results) {
      out.set(`person:${p.id}`, p.last_name ? `${p.first_name} ${p.last_name.charAt(0)}.` : p.first_name);
    }
  }
  if (groupIds.length) {
    const gs = await c.env.DB.prepare(
      `SELECT id, name FROM grp WHERE id IN (${groupIds.map(() => "?").join(",")})`,
    )
      .bind(...groupIds)
      .all<{ id: string; name: string }>();
    for (const g of gs.results) out.set(`group:${g.id}`, g.name);
  }
  return out;
}

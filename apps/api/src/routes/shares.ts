// Shares — grant a private field/contact item to specific Persons or Groups
// (FR-18). Only a Controller of the subject's owning Person may manage shares.
// A contact item with visibility 'private' + ≥1 share renders as "Shared · N".

import { Hono } from "hono";
import type { Context } from "hono";
import type { CreateShareBody, ShareGranteeDTO, ShareTargetDTO } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { isController } from "../lib/privacy.js";
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

  const grantees: ShareGranteeDTO[] = [];
  for (const r of rows.results) {
    grantees.push({ id: r.id, targetKind: r.target_kind, targetId: r.target_id, name: await targetName(c, r.target_kind, r.target_id) });
  }
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
  requireAuth(c);
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const like = `%${q}%`;

  const people = await c.env.DB.prepare(
    `SELECT id, first_name, last_name, last_name_visibility FROM person
     WHERE (? = '' OR lower(first_name) LIKE ? OR lower(coalesce(last_name,'')) LIKE ?)
     ORDER BY first_name LIMIT 25`,
  )
    .bind(q, like, like)
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

async function targetName(
  c: Context<HonoEnv>,
  kind: "person" | "group",
  id: string,
): Promise<string> {
  if (kind === "group") {
    const g = await c.env.DB.prepare("SELECT name FROM grp WHERE id = ?").bind(id).first<{ name: string }>();
    return g?.name ?? "Group";
  }
  const p = await c.env.DB.prepare("SELECT first_name, last_name FROM person WHERE id = ?")
    .bind(id)
    .first<{ first_name: string; last_name: string | null }>();
  if (!p) return "Member";
  return p.last_name ? `${p.first_name} ${p.last_name.charAt(0)}.` : p.first_name;
}

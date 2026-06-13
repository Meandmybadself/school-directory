// CSV bulk import pipeline (SDD §9). Idempotent on re-run: dedupes within a file
// and matches existing entities so a second run of the same file is a no-op.
// Dry-run computes the same plan with no writes by simulating created entities
// in memory so later rows "see" earlier ones.

import type { BulkImportResult, BulkImportRow, Capability, GroupKind } from "@sd/shared";
import type { Env } from "../env.js";
import { ulid } from "./ids.js";
import { nowIso, isoPlus, INVITE_TTL } from "./time.js";
import { normalizeEmail, findUserByEmail } from "./db.js";
import { randomToken, sha256 } from "./crypto.js";

const CAPS: Capability[] = ["parent", "teacher", "staff", "student", "household_admin"];
const MAX_ROWS = 2000;

function parseCaps(raw: string | undefined): Capability[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is Capability => (CAPS as string[]).includes(s));
}

export async function runBulkImport(
  env: Env,
  rows: BulkImportRow[],
  dryRun: boolean,
): Promise<BulkImportResult> {
  const result: BulkImportResult = {
    dryRun,
    rowsProcessed: 0,
    personsCreated: 0,
    personsMatched: 0,
    groupsCreated: 0,
    membershipsCreated: 0,
    invitesQueued: 0,
    errors: [],
  };
  const commit = !dryRun;

  if (rows.length > MAX_ROWS) {
    result.errors.push({ row: 0, message: `Too many rows (max ${MAX_ROWS}).` });
    return result;
  }

  // In-memory state so the plan is consistent within one import (dry or real).
  const personByKey = new Map<string, string>(); // dedupe key -> personId
  const groupByName = new Map<string, string>(); // group name -> groupId
  const membershipSeen = new Set<string>(); // `${groupId}:${personId}`
  const inviteSeen = new Set<string>(); // `${personId}:${email}`
  let synthetic = 0;
  const synthId = (p: string) => `dry_${p}_${++synthetic}`;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 1;
    try {
      const firstName = row.firstName?.trim();
      if (!firstName) {
        result.errors.push({ row: rowNum, message: "Missing firstName." });
        continue;
      }
      const lastName = row.lastName?.trim() || null;
      const email = row.email ? normalizeEmail(row.email) : "";
      const groupName = row.group?.trim() || "";
      // Identity key always includes the name, so two children sharing one
      // parent email don't collapse together, while the exact same row dedupes.
      const nameKey = `${firstName.toLowerCase()}|${(lastName ?? "").toLowerCase()}`;
      const dedupeKey = email ? `${email}|${nameKey}` : `n|${nameKey}`;

      // ── Resolve the Person ──────────────────────────────────────────────
      let personId = personByKey.get(dedupeKey) ?? null;
      if (personId) {
        result.personsMatched++;
      } else {
        const resolved = await resolvePerson(env, { firstName, lastName, email, groupName }, commit);
        personId = resolved.id;
        if (resolved.created) result.personsCreated++;
        else result.personsMatched++;
        if (commit && resolved.created) {
          await env.DB.prepare(
            "INSERT INTO person (id, first_name, last_name, last_name_visibility, created_at) VALUES (?,?,?, 'full', ?)",
          )
            .bind(personId, firstName, lastName, nowIso())
            .run();
          // A row whose email already maps to a User attaches the new Person to
          // that account (e.g. a parent listed for each of their children).
          if (resolved.grantControlUserId) {
            await env.DB.prepare(
              "INSERT INTO control (user_id, person_id, granted_by, since) VALUES (?,?,NULL,?) ON CONFLICT DO NOTHING",
            )
              .bind(resolved.grantControlUserId, personId, nowIso())
              .run();
          }
        }
        personByKey.set(dedupeKey, personId);

        // Queue an invite for a brand-new unclaimed person with no account yet.
        if (resolved.created && resolved.shouldInvite && email) {
          const ikey = `${personId}:${email}`;
          if (!inviteSeen.has(ikey) && !(await hasPendingInvite(env, personId, email))) {
            inviteSeen.add(ikey);
            result.invitesQueued++;
            if (commit) await queueInvite(env, personId, email);
          }
        }
      }

      // ── Capabilities ────────────────────────────────────────────────────
      const caps = parseCaps(row.capabilities);
      if (commit && !personId.startsWith("dry_")) {
        for (const cap of caps) {
          await env.DB.prepare(
            "INSERT INTO capability_grant (person_id, capability) VALUES (?, ?) ON CONFLICT DO NOTHING",
          )
            .bind(personId, cap)
            .run();
        }
      }

      // ── Group + membership ──────────────────────────────────────────────
      if (groupName) {
        let groupId = groupByName.get(groupName) ?? null;
        if (!groupId) {
          const g = await resolveGroup(env, groupName, row.groupKind ?? "classroom", commit);
          groupId = g.id;
          if (g.created) {
            result.groupsCreated++;
            if (commit) {
              await env.DB.prepare("INSERT INTO grp (id, kind, name, created_at) VALUES (?,?,?,?)")
                .bind(groupId, g.kind, groupName, nowIso())
                .run();
            }
          }
          groupByName.set(groupName, groupId);
        }
        const mkey = `${groupId}:${personId}`;
        if (!membershipSeen.has(mkey)) {
          membershipSeen.add(mkey);
          const exists = commit ? await membershipExists(env, groupId, personId) : false;
          if (!exists) {
            result.membershipsCreated++;
            if (commit) {
              await env.DB.prepare(
                `INSERT INTO membership (group_id, person_id, title, is_admin, joined_at)
                 VALUES (?,?,?,0,?) ON CONFLICT (group_id, person_id) DO UPDATE SET title = excluded.title`,
              )
                .bind(groupId, personId, row.title?.trim() || null, nowIso())
                .run();
            }
          }
        }
      }

      result.rowsProcessed++;
    } catch (err) {
      result.errors.push({ row: rowNum, message: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return result;

  // ── helpers (closures share synthId for dry-run) ──────────────────────────
  async function resolvePerson(
    e: Env,
    r: { firstName: string; lastName: string | null; email: string; groupName: string },
    write: boolean,
  ): Promise<{ id: string; created: boolean; grantControlUserId: string | null; shouldInvite: boolean }> {
    const created = (extra?: Partial<{ grantControlUserId: string | null; shouldInvite: boolean }>) => ({
      id: write ? ulid() : synthId("p"),
      created: true,
      grantControlUserId: extra?.grantControlUserId ?? null,
      shouldInvite: extra?.shouldInvite ?? false,
    });
    const matched = (id: string) => ({ id, created: false, grantControlUserId: null, shouldInvite: false });

    if (r.email) {
      const user = await findUserByEmail(e, r.email);
      if (user) {
        // Match the *named* Person among those this account controls.
        const named = await e.DB.prepare(
          `SELECT p.id FROM control c JOIN person p ON p.id = c.person_id
           WHERE c.user_id = ? AND lower(p.first_name) = lower(?) AND lower(coalesce(p.last_name,'')) = lower(?) LIMIT 1`,
        )
          .bind(user.id, r.firstName, r.lastName ?? "")
          .first<{ id: string }>();
        if (named) return matched(named.id);
        // New Person belonging to an existing account; no invite needed.
        return created({ grantControlUserId: user.id });
      }
      // No user: match a Person from a prior import via its still-pending invite,
      // so re-runs don't duplicate. Else create + invite.
      const pending = await e.DB.prepare(
        `SELECT ci.person_id FROM control_invite ci JOIN person p ON p.id = ci.person_id
         WHERE ci.to_email = ? AND ci.status = 'pending'
           AND lower(p.first_name) = lower(?) AND lower(coalesce(p.last_name,'')) = lower(?)
         ORDER BY ci.created_at LIMIT 1`,
      )
        .bind(r.email, r.firstName, r.lastName ?? "")
        .first<{ person_id: string }>();
      if (pending) return matched(pending.person_id);
      return created({ shouldInvite: true });
    }

    // No email: match by name, scoped to the target group when given.
    const match = r.groupName
      ? await e.DB.prepare(
          `SELECT p.id FROM person p JOIN membership m ON m.person_id = p.id
           JOIN grp g ON g.id = m.group_id
           WHERE lower(p.first_name) = lower(?) AND lower(coalesce(p.last_name,'')) = lower(?) AND g.name = ? LIMIT 1`,
        ).bind(r.firstName, r.lastName ?? "", r.groupName).first<{ id: string }>()
      : await e.DB.prepare(
          "SELECT id FROM person WHERE lower(first_name) = lower(?) AND lower(coalesce(last_name,'')) = lower(?) LIMIT 2",
        ).bind(r.firstName, r.lastName ?? "").all<{ id: string }>().then((rs) => (rs.results.length === 1 ? rs.results[0]! : null));
    if (match) return matched(match.id);
    return created();
  }

  async function resolveGroup(
    e: Env,
    name: string,
    kind: GroupKind,
    write: boolean,
  ): Promise<{ id: string; created: boolean; kind: GroupKind }> {
    const found = await e.DB.prepare("SELECT id, kind FROM grp WHERE name = ? LIMIT 1")
      .bind(name)
      .first<{ id: string; kind: GroupKind }>();
    if (found) return { id: found.id, created: false, kind: found.kind };
    return { id: write ? ulid() : synthId("g"), created: true, kind };
  }

  async function membershipExists(e: Env, groupId: string, personId: string): Promise<boolean> {
    if (personId.startsWith("dry_") || groupId.startsWith("dry_")) return false;
    const row = await e.DB.prepare(
      "SELECT 1 AS ok FROM membership WHERE group_id = ? AND person_id = ? LIMIT 1",
    )
      .bind(groupId, personId)
      .first<{ ok: number }>();
    return !!row;
  }

  async function hasPendingInvite(e: Env, personId: string, email: string): Promise<boolean> {
    if (personId.startsWith("dry_")) return false;
    const row = await e.DB.prepare(
      "SELECT 1 AS ok FROM control_invite WHERE person_id = ? AND to_email = ? AND status = 'pending' LIMIT 1",
    )
      .bind(personId, email)
      .first<{ ok: number }>();
    return !!row;
  }

  async function queueInvite(e: Env, personId: string, email: string): Promise<void> {
    const token = randomToken();
    const tokenHash = await sha256(token);
    await e.DB.batch([
      e.DB.prepare(
        `INSERT INTO control_invite (id, person_id, invited_by, to_email, status, token_hash, expires_at, created_at)
         VALUES (?,?,?,?, 'pending', ?, ?, ?)`,
      ).bind(ulid(), personId, null, email, tokenHash, isoPlus(INVITE_TTL), nowIso()),
      e.DB.prepare(
        `INSERT INTO auth_token (id, email, kind, token_hash, person_id, invited_by, reg_open_at_issue, expires_at, created_at)
         VALUES (?,?, 'invite', ?, ?, NULL, 1, ?, ?)`,
      ).bind(ulid(), email, tokenHash, personId, isoPlus(INVITE_TTL), nowIso()),
    ]);
  }
}

// CSV bulk import pipeline (SDD §9). Idempotent on re-run: dedupes within a file
// and matches existing entities so a second run of the same file is a no-op.
// Dry-run computes the same plan with no writes by simulating created entities
// in memory so later rows "see" earlier ones.
//
// UNLISTED-EXEMPT-FILE: every `person` read here is DEDUPLICATION, not
// enumeration — "have we already got this family?" on a system-admin-only route.
// A match the query can't see is a duplicate Person it would silently create, so
// applying the enumeration gate here would corrupt the roster rather than
// protect anybody. Nothing in this file returns a name to a member.

import type { BulkImportOptions, BulkImportResult, BulkImportRow, Capability, GroupKind, Visibility } from "@sd/shared";
import type { Env } from "../env.js";
import { ulid } from "./ids.js";
import { nowIso, isoPlus, INVITE_TTL } from "./time.js";
import { normalizeEmail, findUserByEmail } from "./db.js";
import { randomToken, sha256 } from "./crypto.js";

const CAPS: Capability[] = ["parent", "teacher", "staff", "student", "household_admin"];
const MAX_ROWS = 2000;

/** A pending invite created during a committed import. Holds the raw token so the
 *  caller can build a sign-in link — never serialize this to the client. */
export interface QueuedInvite {
  email: string;
  token: string;
  personName: string;
}

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
  options: BulkImportOptions = {},
): Promise<{ result: BulkImportResult; invites: QueuedInvite[] }> {
  const invites: QueuedInvite[] = [];
  const result: BulkImportResult = {
    dryRun,
    rowsProcessed: 0,
    personsCreated: 0,
    personsMatched: 0,
    groupsCreated: 0,
    membershipsCreated: 0,
    invitesQueued: 0,
    accountsCreated: 0,
    errors: [],
  };
  const commit = !dryRun;
  const createAccounts = options.createAccounts === true;
  const contactVisibility: Visibility = options.contactVisibility === "service" ? "service" : "private";
  const emailAsContact = options.emailAsContact === true;

  if (rows.length > MAX_ROWS) {
    result.errors.push({ row: 0, message: `Too many rows (max ${MAX_ROWS}).` });
    return { result, invites };
  }

  // In-memory state so the plan is consistent within one import (dry or real).
  const personByKey = new Map<string, string>(); // dedupe key -> personId
  const groupByName = new Map<string, string>(); // group name -> groupId
  const membershipSeen = new Set<string>(); // `${groupId}:${personId}`
  const inviteSeen = new Set<string>(); // `${personId}:${email}`
  const phoneSeen = new Set<string>(); // `${personId}:${phone}`
  const emailItemSeen = new Set<string>(); // `${personId}:${email}`
  const userByEmail = new Map<string, string>(); // accounts minted by THIS import
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
            if (commit) {
              const token = await queueInvite(env, personId, email);
              invites.push({ email, token, personName: [firstName, lastName].filter(Boolean).join(" ") });
            }
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

      // ── Phone / email (contact items) ───────────────────────────────────
      const phone = row.phone?.trim();
      if (phone && !personId.startsWith("dry_")) {
        const pkey = `${personId}:${phone}`;
        if (!phoneSeen.has(pkey)) {
          phoneSeen.add(pkey);
          if (commit && !(await hasContactItem(env, personId, "phone", phone))) {
            await insertContactItem(env, personId, "phone", phone, contactVisibility);
          }
        }
      }
      // Only when the admin has said the column is the Person's own address —
      // see `BulkImportOptions.emailAsContact` for why that is not assumed.
      if (emailAsContact && email && !personId.startsWith("dry_")) {
        const ekey = `${personId}:${email}`;
        if (!emailItemSeen.has(ekey)) {
          emailItemSeen.add(ekey);
          if (commit && !(await hasContactItem(env, personId, "email", email))) {
            await insertContactItem(env, personId, "email", email, contactVisibility);
          }
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

  return { result, invites };

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
      // A Person from a prior import still waiting on an invite nobody clicked.
      // Read up front because BOTH branches below want it: with an account in
      // hand it is adopted (control granted, invite closed) rather than
      // re-created; without one it is simply matched, so re-runs don't duplicate.
      const pending = await e.DB.prepare(
        `SELECT ci.person_id FROM control_invite ci JOIN person p ON p.id = ci.person_id
         WHERE ci.to_email = ? AND ci.status = 'pending'
           AND lower(p.first_name) = lower(?) AND lower(coalesce(p.last_name,'')) = lower(?)
         ORDER BY ci.created_at LIMIT 1`,
      )
        .bind(r.email, r.firstName, r.lastName ?? "")
        .first<{ person_id: string }>();

      const user = await findUserByEmail(e, r.email);
      let userId = user?.id ?? userByEmail.get(r.email) ?? null;
      if (!userId && createAccounts) {
        // Same row `POST /admin/users` writes, minus the optional magic link:
        // `joined_via 'admin'` keeps it out of the new-member notifications,
        // and `email_verified_at` stays null until their first sign-in sets it.
        userId = write ? ulid() : synthId("u");
        if (write) {
          await e.DB.prepare(
            "INSERT INTO user (id, email, is_system_admin, created_at, joined_via) VALUES (?,?,0,?, 'admin')",
          )
            .bind(userId, r.email, nowIso())
            .run();
        }
        userByEmail.set(r.email, userId);
        result.accountsCreated++;
      }

      if (userId) {
        // Match the *named* Person among those this account controls. (An
        // account this import just minted controls nothing yet, and a dry-run
        // id matches no row — both fall through, which is right.)
        const named = await e.DB.prepare(
          `SELECT p.id FROM control c JOIN person p ON p.id = c.person_id
           WHERE c.user_id = ? AND lower(p.first_name) = lower(?) AND lower(coalesce(p.last_name,'')) = lower(?) LIMIT 1`,
        )
          .bind(userId, r.firstName, r.lastName ?? "")
          .first<{ id: string }>();
        if (named) return matched(named.id);
        if (pending) {
          // The invite was addressed to exactly this email and this account
          // holds it, so the Person is theirs: grant it and close the invite,
          // instead of minting a second Person beside the one waiting.
          if (write) await adoptPending(e, userId, pending.person_id, r.email);
          return matched(pending.person_id);
        }
        // New Person belonging to an account; no invite needed.
        return created({ grantControlUserId: userId });
      }
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

  async function hasContactItem(e: Env, personId: string, type: "phone" | "email", value: string): Promise<boolean> {
    if (personId.startsWith("dry_")) return false;
    const row = await e.DB.prepare(
      "SELECT 1 AS ok FROM contact_item WHERE owner_kind = 'person' AND owner_id = ? AND type = ? AND value = ? LIMIT 1",
    )
      .bind(personId, type, value)
      .first<{ ok: number }>();
    return !!row;
  }

  async function insertContactItem(
    e: Env,
    personId: string,
    type: "phone" | "email",
    value: string,
    visibility: Visibility,
  ): Promise<void> {
    await e.DB.prepare(
      `INSERT INTO contact_item
         (id, owner_kind, owner_id, type, label, value, visibility,
          neighbor_discoverable, geocode_status, created_at, updated_at)
       VALUES (?, 'person', ?, ?, NULL, ?, ?, 0, 'none', ?, ?)`,
    )
      .bind(ulid(), personId, type, value, visibility, nowIso(), nowIso())
      .run();
  }

  /** Hand a Person with a pending invite to the account that now holds the
   *  invited address: the control `bindInvite` would have granted on the click,
   *  and the invite closed the same way, minus the household widening — an
   *  import never carries one (migration 0021). */
  async function adoptPending(e: Env, userId: string, personId: string, email: string): Promise<void> {
    await e.DB.batch([
      e.DB.prepare(
        "INSERT INTO control (user_id, person_id, granted_by, since) VALUES (?,?,NULL,?) ON CONFLICT DO NOTHING",
      ).bind(userId, personId, nowIso()),
      e.DB.prepare(
        "UPDATE control_invite SET status = 'accepted' WHERE person_id = ? AND to_email = ? AND status = 'pending'",
      ).bind(personId, email),
    ]);
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

  async function queueInvite(e: Env, personId: string, email: string): Promise<string> {
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
    return token;
  }
}

// Bulk import in "create accounts" mode — a staff roster that signs in with no
// invitation.
//
// WHAT THIS PINS. A row whose email has no account used to get one thing: a
// pending `control_invite` (plus an invite token, mailed only on request). A
// teacher who never clicked that mail and instead typed their address into
// "Email me a link" got a fresh, EMPTY account — `/auth/callback` binds an
// invite only when the token it consumes carries one — and with registration
// closed got nothing at all. `createAccounts` closes that gap the way
// `POST /admin/users` already did one address at a time: the `user` row exists
// from the import, the Person is attached to it, and no invite is minted.
//
// BEHAVIOURAL, for invariant 22's reason: the fake D1 records every statement
// where it EXECUTES, including inside `batch()`, and answers the reads, so a
// mode that quietly fell back to minting an invite fails on a recorded
// `INSERT INTO control_invite` rather than passing a scan.

import { describe, expect, it } from "vitest";
import { runBulkImport } from "../src/lib/bulkImport.js";
import type { Env } from "../src/env.js";

interface Captured {
  sql: string;
  args: unknown[];
}

interface World {
  /** email → user id for accounts that already exist. */
  users?: Record<string, string>;
  /** Persons with a pending invite: `${email}|${first}|${last}` → person id. */
  pending?: Record<string, string>;
}

function fakeEnv(captured: Captured[], world: World = {}): Env {
  const users = world.users ?? {};
  const pending = world.pending ?? {};
  const stmt = (sql: string) => {
    const s = {
      sql,
      args: [] as unknown[],
      bind(...args: unknown[]) {
        s.args = args;
        return s;
      },
      async first() {
        if (sql.includes("FROM user WHERE email = ?")) {
          const id = users[String(s.args[0])];
          return id ? { id, email: s.args[0], is_system_admin: 0, locale: null } : null;
        }
        if (sql.includes("FROM control_invite ci JOIN person p")) {
          const key = `${s.args[0]}|${String(s.args[1]).toLowerCase()}|${String(s.args[2]).toLowerCase()}`;
          const id = pending[key];
          return id ? { person_id: id } : null;
        }
        // Nothing is controlled, nothing exists yet: every other lookup misses.
        return null;
      },
      async all() {
        return { results: [] as unknown[] };
      },
      async run() {
        captured.push({ sql, args: s.args });
        return { meta: { changes: 1 } };
      },
    };
    return s;
  };
  return {
    DB: {
      prepare: (sql: string) => stmt(sql),
      async batch(stmts: Captured[]) {
        captured.push(...stmts.map((x) => ({ sql: x.sql, args: x.args })));
        return [];
      },
    },
  } as unknown as Env;
}

const TEACHER = {
  firstName: "Ashley",
  lastName: "Andrew",
  email: "Ashley.Andrew@hopkinsschools.org",
  phone: "(952) 988-4175",
  capabilities: "teacher",
};

const has = (c: Captured[], frag: string) => c.filter((x) => x.sql.includes(frag));

describe("bulk import — createAccounts", () => {
  it("mints an account, attaches the Person to it, and queues no invite", async () => {
    const captured: Captured[] = [];
    const { result, invites } = await runBulkImport(fakeEnv(captured), [TEACHER], false, {
      createAccounts: true,
      contactVisibility: "service",
      emailAsContact: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.accountsCreated).toBe(1);
    expect(result.personsCreated).toBe(1);
    expect(result.invitesQueued).toBe(0);
    expect(invites).toEqual([]);

    // The account row is the one POST /admin/users writes: admin-joined, so the
    // new-member notification never fires for it, and the email normalised.
    const user = has(captured, "INSERT INTO user");
    expect(user).toHaveLength(1);
    expect(user[0]!.sql).toContain("'admin'");
    expect(user[0]!.args[1]).toBe("ashley.andrew@hopkinsschools.org");
    const userId = user[0]!.args[0];

    // Control goes to THAT account, for the Person this import created.
    const person = has(captured, "INSERT INTO person");
    expect(person).toHaveLength(1);
    const control = has(captured, "INSERT INTO control ");
    expect(control).toHaveLength(1);
    expect(control[0]!.args[0]).toBe(userId);
    expect(control[0]!.args[1]).toBe(person[0]!.args[0]);

    // No invite of either kind — there is nothing for anyone to click.
    expect(has(captured, "INSERT INTO control_invite")).toHaveLength(0);
    expect(has(captured, "INSERT INTO auth_token")).toHaveLength(0);

    // The capability, and BOTH contact items at the chosen visibility.
    const caps = has(captured, "INSERT INTO capability_grant");
    expect(caps.map((c) => c.args[1])).toEqual(["teacher"]);
    const items = has(captured, "INSERT INTO contact_item");
    expect(items.map((i) => [i.args[2], i.args[3], i.args[4]])).toEqual([
      ["phone", "(952) 988-4175", "service"],
      ["email", "ashley.andrew@hopkinsschools.org", "service"],
    ]);
  });

  it("one account per address, however many rows share it", async () => {
    const captured: Captured[] = [];
    const { result } = await runBulkImport(
      fakeEnv(captured),
      [
        { firstName: "Dana", lastName: "Ruiz", email: "dana@example.org" },
        { firstName: "Milo", lastName: "Ruiz", email: "dana@example.org" },
      ],
      false,
      { createAccounts: true },
    );
    expect(result.accountsCreated).toBe(1);
    expect(result.personsCreated).toBe(2);
    expect(has(captured, "INSERT INTO user")).toHaveLength(1);
    const userId = has(captured, "INSERT INTO user")[0]!.args[0];
    const control = has(captured, "INSERT INTO control ");
    expect(control).toHaveLength(2);
    expect(control.every((c) => c.args[0] === userId)).toBe(true);
    // And, with emailAsContact off, the parent's address lands on NO profile.
    expect(has(captured, "INSERT INTO contact_item")).toHaveLength(0);
  });

  it("adopts a Person left waiting by an earlier invite-mode import", async () => {
    const captured: Captured[] = [];
    const env = fakeEnv(captured, {
      pending: { "ashley.andrew@hopkinsschools.org|ashley|andrew": "01PENDING" },
    });
    const { result } = await runBulkImport(env, [TEACHER], false, { createAccounts: true });

    expect(result.accountsCreated).toBe(1);
    expect(result.personsCreated).toBe(0);
    expect(result.personsMatched).toBe(1);
    expect(has(captured, "INSERT INTO person")).toHaveLength(0);
    // The waiting Person is handed to the new account and its invite closed —
    // what the click would have done, done by the import.
    const control = has(captured, "INSERT INTO control ");
    expect(control).toHaveLength(1);
    expect(control[0]!.args[1]).toBe("01PENDING");
    const closed = has(captured, "UPDATE control_invite SET status = 'accepted'");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.args).toEqual(["01PENDING", "ashley.andrew@hopkinsschools.org"]);
  });

  it("dry run counts the account and writes nothing", async () => {
    const captured: Captured[] = [];
    const { result } = await runBulkImport(fakeEnv(captured), [TEACHER], true, { createAccounts: true });
    expect(result.accountsCreated).toBe(1);
    expect(result.personsCreated).toBe(1);
    expect(captured).toEqual([]);
  });
});

describe("bulk import — default (invite) mode is unchanged", () => {
  it("queues an invite, creates no account, keeps the phone private, stores no email item", async () => {
    const captured: Captured[] = [];
    const { result, invites } = await runBulkImport(fakeEnv(captured), [TEACHER], false);

    expect(result.accountsCreated).toBe(0);
    expect(result.invitesQueued).toBe(1);
    expect(invites).toHaveLength(1);
    expect(has(captured, "INSERT INTO user")).toHaveLength(0);
    expect(has(captured, "INSERT INTO control_invite")).toHaveLength(1);
    expect(has(captured, "INSERT INTO auth_token")).toHaveLength(1);
    const items = has(captured, "INSERT INTO contact_item");
    expect(items.map((i) => [i.args[2], i.args[4]])).toEqual([["phone", "private"]]);
  });

  it("an existing account also adopts its waiting Person instead of getting a duplicate", async () => {
    const captured: Captured[] = [];
    const env = fakeEnv(captured, {
      users: { "ashley.andrew@hopkinsschools.org": "01EXISTING" },
      pending: { "ashley.andrew@hopkinsschools.org|ashley|andrew": "01PENDING" },
    });
    const { result } = await runBulkImport(env, [TEACHER], false);
    expect(result.personsCreated).toBe(0);
    expect(result.personsMatched).toBe(1);
    expect(has(captured, "INSERT INTO person")).toHaveLength(0);
    const control = has(captured, "INSERT INTO control ");
    expect(control).toHaveLength(1);
    expect(control[0]!.args.slice(0, 2)).toEqual(["01EXISTING", "01PENDING"]);
  });
});

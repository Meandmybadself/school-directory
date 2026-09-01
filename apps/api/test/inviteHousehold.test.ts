// An invitation that carries the household — the fix for the duplicate child.
//
// THE BUG THIS PINS. The welcome wizard already invites the second parent
// (`Welcome.tsx` → `POST /persons/:id/controllers`), and it already puts them in
// the household. What it could not do was hand over the FAMILY: `bindInvite`
// granted control of the invitee's own Person and nothing else. So parent two
// signed in controlling one Person, was a member of the household but not an
// admin of it, and `GET /me/households` — which filters `m.is_admin = 1` —
// returned nothing. Their very next "add a child" found no household to reuse,
// founded a second one, and re-created children who already existed. Two
// households, two Milos, and parent two controlling neither original. Reachable
// from the correct flow, which is why no route test caught it.
//
// Migration 0021 records which household an invitation is about; this file pins
// both halves of what that buys.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it, vi } from "vitest";
import { controllers } from "../src/routes/controllers.js";
import type { AuthContext, HonoEnv } from "../src/env.js";

vi.mock("../src/lib/email.js", () => ({
  inviteEmail: () => ({ to: "", subject: "", html: "", text: "" }),
  sendEmail: async () => {},
}));

interface Captured {
  sql: string;
  args: unknown[];
}

function testEnv(captured: Captured[], administersHousehold: boolean): HonoEnv["Bindings"] {
  const stmt = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async first() {
      // isController → yes; the household authority check → per the flag.
      if (sql.includes("FROM control WHERE user_id = ? AND person_id")) return { ok: 1 };
      if (sql.includes("g.kind = 'household'")) return administersHousehold ? { ok: 1 } : null;
      if (sql.includes("FROM person")) return { first_name: "Sam", last_name: "Ruiz" };
      if (sql.includes("FROM user WHERE id")) return { email: "dana@eisenhower.edu" };
      return null;
    },
  });
  return {
    DB: {
      prepare: (sql: string) => stmt(sql),
      async batch(stmts: Captured[]) {
        captured.push(...stmts.map((s) => ({ sql: s.sql, args: s.args })));
        return [];
      },
    },
    APP_URL: "https://directory.eisenhower.school",
    SCHOOL_NAME: "Eisenhower",
  } as unknown as HonoEnv["Bindings"];
}

const AUTH: AuthContext = {
  userId: "01DANA",
  realUserId: "01DANA",
  email: "dana@eisenhower.edu",
  isSystemAdmin: false,
  sessionId: "01SESSION",
  activePersonId: "01DANAPERSON",
  isMasquerading: false,
};

function app(): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>();
  a.use(
    "*",
    createMiddleware<HonoEnv>(async (c, next) => {
      c.set("audit", []);
      c.set("auth", AUTH);
      c.executionCtx.waitUntil = () => {};
      await next();
    }),
  );
  a.route("/", controllers);
  return a;
}

async function invite(body: unknown, administersHousehold = true) {
  const captured: Captured[] = [];
  const res = await app().request(
    "/persons/01SAM/controllers",
    { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
    testEnv(captured, administersHousehold),
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
  return { res, captured };
}

describe("POST /persons/:id/controllers", () => {
  it("records the household on BOTH rows the invite needs", async () => {
    const { res, captured } = await invite({ email: "sam@example.com", householdId: "01HOME" });
    expect(res.status).toBe(201);
    // `control_invite` is the record a member sees; `auth_token` is what
    // /auth/callback resolves the click against, by token_hash alone. Neither
    // can reach the other cheaply, so both carry it or the widening is lost.
    const invite_ = captured.find((s) => s.sql.includes("INTO control_invite"))!;
    const token = captured.find((s) => s.sql.includes("INTO auth_token"))!;
    expect(invite_.sql).toContain("group_id");
    expect(token.sql).toContain("group_id");
    expect(invite_.args).toContain("01HOME");
    expect(token.args).toContain("01HOME");
  });

  it("refuses a household the inviter does not administer", async () => {
    // Otherwise a member could hand out sight of a family that isn't theirs —
    // the same authority POST /me/persons requires to place someone in one.
    const { res, captured } = await invite(
      { email: "sam@example.com", householdId: "01SOMEONE_ELSES" },
      false,
    );
    expect(res.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  it("still sends the narrow, person-only invitation when no household is named", async () => {
    // "Help me manage this one child" is a real case (a grandparent, the school
    // nurse) and must not quietly become "see my whole family".
    const { res, captured } = await invite({ email: "nurse@eisenhower.edu" });
    expect(res.status).toBe(201);
    for (const s of captured) expect(s.args).toContain(null);
    const invite_ = captured.find((s) => s.sql.includes("INTO control_invite"))!;
    expect(invite_.args).not.toContain("01HOME");
  });
});

// ── The accept side ────────────────────────────────────────────────────────

const { auth: authRoutes } = await import("../src/routes/auth.js");
const { sha256 } = await import("../src/lib/crypto.js");

/** D1 stand-in for /auth/callback: an invite token, an existing user, and a
 *  record of every statement the widening batch runs. */
function callbackEnv(tokenHash: string, groupId: string | null, captured: Captured[]) {
  const stmt = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async first() {
      if (sql.includes("FROM auth_token WHERE token_hash")) {
        return {
          id: "01TOKEN",
          email: "sam@example.com",
          kind: "invite",
          person_id: "01SAM",
          invited_by: "01DANA",
          group_id: groupId,
          reg_open_at_issue: 1,
          expires_at: "2099-01-01T00:00:00.000Z",
          consumed_at: null,
          return_to: null,
        };
      }
      if (sql.includes("FROM user WHERE email")) {
        return { id: "01SAMUSER", email: "sam@example.com", is_system_admin: 0, locale: null };
      }
      if (sql.includes("disabled_at")) return { disabled_at: null };
      // Already controls their own Person? No — this is the grant being made.
      if (sql.includes("FROM control WHERE user_id = ? AND person_id")) return null;
      // How many Persons the widening hands over.
      if (sql.includes("NOT EXISTS") && sql.includes("FROM membership m")) return { n: 2 };
      return null;
    },
    async run() {
      captured.push({ sql, args: this.args });
      return { meta: { changes: 1 } };
    },
  });
  return {
    DB: {
      prepare: (sql: string) => stmt(sql),
      async batch(stmts: Captured[]) {
        captured.push(...stmts.map((s) => ({ sql: s.sql, args: s.args })));
        return [];
      },
    },
    APP_URL: "https://directory.eisenhower.school",
    ALLOWED_ORIGINS: "https://directory.eisenhower.school",
    SCHOOL_NAME: "Eisenhower",
  } as unknown as HonoEnv["Bindings"];
}

async function acceptInvite(groupId: string | null) {
  const token = "tok_" + groupId;
  const captured: Captured[] = [];
  const app = new Hono<HonoEnv>();
  const audit: { action: string; detail?: Record<string, unknown>; notify?: Record<string, unknown> }[] = [];
  app.use(
    "*",
    createMiddleware<HonoEnv>(async (c, next) => {
      c.set("audit", audit as never);
      c.set("userAgent", "test");
      c.set("ip", "127.0.0.1");
      await next();
    }),
  );
  app.route("/auth", authRoutes);
  const res = await app.request(
    "/auth/callback",
    {
      method: "POST",
      body: new URLSearchParams({ t: token }),
    },
    callbackEnv(await sha256(token), groupId, captured),
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
  return { res, captured, audit };
}

describe("accepting an invitation that names a household", () => {
  it("grants control of every Person in it the INVITER controls", async () => {
    const { captured } = await acceptInvite("01HOME");
    const grant = captured.find(
      (s) => s.sql.includes("INSERT INTO control") && s.sql.includes("SELECT"),
    );
    expect(grant).toBeDefined();
    // Evaluated against what the inviter controls NOW, not a list frozen at
    // send time: a child added between sending and clicking is one the
    // co-parent should get.
    expect(grant!.sql).toContain("JOIN control inv");
    expect(grant!.sql).toContain("ON CONFLICT (user_id, person_id) DO NOTHING");
    // Sourced from membership × control — never from `person`. The invitee is
    // becoming a Controller, which is one of the two audiences the enumeration
    // gate admits, so applying it here would be the wrong predicate AND would
    // spend one of the source scan's few remaining exemptions for nothing.
    expect(grant!.sql).not.toMatch(/FROM person|JOIN person/);
  });

  it("makes them an admin of that household, so their next add reuses it", async () => {
    // This is the line that actually stops the duplicate: GET /me/households
    // filters `m.is_admin = 1`, and `ensureHousehold` reuses what it returns.
    const { captured } = await acceptInvite("01HOME");
    const promote = captured.find((s) => s.sql.includes("UPDATE membership SET is_admin = 1"));
    expect(promote).toBeDefined();
    // Only promotes a membership that already exists — never creates one, so it
    // can't make someone an admin of a household they are not in.
    expect(promote!.sql).toContain("WHERE group_id = ?");
    expect(promote!.sql).not.toContain("INSERT");
    // THE INVITEE'S OWN Person, by id. The grant above has just made "everyone
    // this user controls" mean the whole household, so the natural-reading
    // `person_id IN (SELECT … FROM control WHERE user_id = ?)` would promote
    // every CHILD in the family to household admin. Batch order is what decides
    // it, and the safe spelling is the one that doesn't depend on order at all.
    expect(promote!.args).toEqual(["01HOME", "01SAM"]);
    expect(promote!.sql).not.toContain("FROM control");
    // The badge and the authority are one fact, as POST /groups has it — and it
    // lands on the same single Person, not on the roster.
    const badge = captured.find((s) => s.sql.includes("'household_admin'"))!;
    expect(badge.args).toEqual(["01SAM", "01HOME", "01SAM"]);
  });

  it("leaves a person-only invitation exactly as narrow as it was", async () => {
    const { captured } = await acceptInvite(null);
    expect(captured.some((s) => s.sql.includes("UPDATE membership SET is_admin = 1"))).toBe(false);
    expect(
      captured.some((s) => s.sql.includes("INSERT INTO control") && s.sql.includes("SELECT")),
    ).toBe(false);
    // The one grant it was always about still happens.
    expect(captured.some((s) => s.sql.startsWith("INSERT INTO control (user_id"))).toBe(true);
  });

  it("speaks to Slack for this grant, where a self-grant stays quiet", async () => {
    // invariant 22 keeps `control.granted` silent for the 22-of-22 self-grants
    // and lets through exactly this case: a second parent gaining control by
    // invitation, where who can see a family's data actually changed.
    const { audit } = await acceptInvite("01HOME");
    const granted = audit.find((d) => d.action === "control.granted");
    expect(granted!.notify).toMatchObject({ self: false, personsGranted: 2 });
  });

  it("pushes the grant BEFORE the widening, then enriches it in place", async () => {
    // Ordering, not decoration: the control row is a committed write by the
    // time the widening runs, and the widening is a separate round trip that
    // can fail on its own. Pushed after it, a real grant would have no audit
    // row at all — invariant 22's rule, the same one
    // volunteerSignupAudit.test.ts pins for a claimed spot.
    //
    // The proof that it was pushed EARLY and enriched, rather than assembled
    // late, is that `personsGranted` is present on a draft whose other fields
    // were fixed before the count existed. A late push would look identical
    // here, which is why the count is read before the INSERT that invalidates
    // it — assert both: the count is the pre-insert one, and it landed on the
    // draft rather than on a second, later draft.
    const { audit } = await acceptInvite("01HOME");
    expect(audit.filter((d) => d.action === "control.granted")).toHaveLength(1);
    const granted = audit.find((d) => d.action === "control.granted")!;
    expect(granted.detail).toMatchObject({
      userId: "01SAMUSER",
      viaInvite: true,
      householdId: "01HOME",
      personsGranted: 2,
    });
    const accepted = audit.find((d) => d.action === "invite.accepted")!;
    expect(accepted.detail).toMatchObject({ groupId: "01HOME", personsGranted: 2 });
  });
});

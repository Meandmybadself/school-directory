// Who may edit a group's roster.
//
// The member routes have always let a system admin through — `requireGroupAdmin`
// admits one regardless of membership — but the group detail DTO reported only
// `viewerIsAdmin`, which is membership-derived, so the SPA hid every add/remove
// affordance from the one person the server would have obeyed. These tests pin
// the flag that closes that gap AND the line it must not cross: managing the
// roster is not the same authority as reading the group's own private contacts,
// so `viewerCanManageMembers` widening must never drag `viewerIsAdmin` with it.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { groups } from "../src/routes/groups.js";
import type { AuthContext, HonoEnv } from "../src/env.js";
import { UnauthorizedError } from "../src/middleware/session.js";

const GROUP_ID = "01GROUP";

const MEMBER: AuthContext = {
  userId: "01USER",
  realUserId: "01USER",
  email: "parent@eisenhower.edu",
  isSystemAdmin: false,
  sessionId: "01SESSION",
  activePersonId: "01PERSON",
  isMasquerading: false,
};
const SYS_ADMIN: AuthContext = { ...MEMBER, userId: "01ADMINUSER", activePersonId: "01ADMINPERSON", isSystemAdmin: true };

interface Row {
  sql: string;
  args: unknown[];
}

/**
 * D1 stand-in for GET /groups/:id and the member writes. `viewerPersonIsAdmin`
 * decides whether the roster row for 01PERSON carries is_admin, which is the
 * only input `viewerIsAdmin` has.
 */
function testEnv(
  opts: {
    viewerPersonIsAdmin?: boolean;
    controlled?: string;
    rows?: Row[];
    /** The viewer's membership row was written by the viewer themselves
     *  (`PUT /persons/:id/classroom`, migration 0023) rather than granted by
     *  anyone with authority over the group. */
    selfAsserted?: boolean;
    /** Group-owned contact items to serve from the fake `contact_item` table. */
    contacts?: {
      id: string;
      type: string;
      label: string | null;
      value: string;
      visibility: string;
    }[];
  } = {},
): HonoEnv["Bindings"] {
  const controlled = opts.controlled ?? "01PERSON";
  const rows = opts.rows ?? [];
  const mk = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async first() {
      if (sql.includes("FROM grp WHERE id = ?")) {
        return { id: GROUP_ID, kind: "classroom", name: "Ms. Ruiz · Grade 4", parent_id: null, ok: 1 };
      }
      // isGroupAdmin: a controlled Person holding an admin membership.
      if (sql.includes("JOIN control ctl")) return opts.viewerPersonIsAdmin ? { ok: 1 } : null;
      if (sql.includes("SELECT is_admin FROM membership")) return { is_admin: 0 };
      return null;
    },
    async all() {
      if (sql.includes("SELECT id, parent_id FROM grp")) return { results: [{ id: GROUP_ID, parent_id: null }] };
      if (sql.includes("JOIN person p ON p.id = m.person_id")) {
        return {
          results: [
            {
              person_id: "01PERSON",
              title: null,
              is_admin: opts.viewerPersonIsAdmin ? 1 : 0,
              is_direct: 1,
              self_asserted: opts.selfAsserted ? 1 : 0,
              first_name: "Dana",
              last_name: "Ruiz",
              last_name_visibility: "full",
              photo_object_key: null,
            },
          ],
        };
      }
      if (sql.includes("FROM control WHERE user_id = ?")) return { results: [{ person_id: controlled }] };
      if (sql.includes("FROM contact_item WHERE owner_kind = 'group'")) {
        return {
          results: (opts.contacts ?? []).map((ci) => ({
            ...ci,
            owner_kind: "group",
            owner_id: GROUP_ID,
            neighbor_discoverable: 0,
            geo_lat: null,
            geo_lng: null,
          })),
        };
      }
      return { results: [] };
    },
    async run() {
      rows.push({ sql, args: this.args });
      return { meta: { changes: 1 } };
    },
  });
  return { DB: { prepare: (sql: string) => mk(sql) } } as unknown as HonoEnv["Bindings"];
}

function appWith(auth: AuthContext | null): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.use(
    "*",
    createMiddleware<HonoEnv>(async (c, next) => {
      c.set("audit", []);
      if (auth) c.set("auth", auth);
      await next();
    }),
  );
  app.route("/groups", groups);
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) return c.json({ error: "unauthorized" }, 401);
    throw err;
  });
  return app;
}

async function detail(auth: AuthContext, env: HonoEnv["Bindings"]) {
  const res = await appWith(auth).request(`/groups/${GROUP_ID}`, {}, env);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    viewerIsAdmin: boolean;
    viewerCanManageMembers?: boolean;
    contacts: { id: string; value: string }[];
  };
}

describe("GET /groups/:id — viewerCanManageMembers", () => {
  it("a group admin may manage the roster", async () => {
    const dto = await detail(MEMBER, testEnv({ viewerPersonIsAdmin: true }));
    expect(dto.viewerIsAdmin).toBe(true);
    expect(dto.viewerCanManageMembers).toBe(true);
  });

  it("a plain member may not", async () => {
    const dto = await detail(MEMBER, testEnv({ viewerPersonIsAdmin: false }));
    expect(dto.viewerIsAdmin).toBe(false);
    expect(dto.viewerCanManageMembers).toBe(false);
  });

  it("a system admin who belongs to nothing may — matching what the routes obey", async () => {
    // controlled: nobody on this roster, so membership-derived admin is false.
    const dto = await detail(SYS_ADMIN, testEnv({ viewerPersonIsAdmin: false, controlled: "01NOBODY" }));
    expect(dto.viewerCanManageMembers).toBe(true);
    // …and the membership-derived flag stays false: it still gates this group's
    // own private contacts and its exact address (invariants 1–3).
    expect(dto.viewerIsAdmin).toBe(false);
  });
});

describe("member writes take the same authority the flag advertises", () => {
  const env = () => testEnv({ viewerPersonIsAdmin: false, controlled: "01NOBODY" });

  it("401s with no session", async () => {
    const res = await appWith(null).request(`/groups/${GROUP_ID}/members`, { method: "POST", body: "{}" }, env());
    expect(res.status).toBe(401);
  });

  it("403s a plain member adding someone", async () => {
    const res = await appWith(MEMBER).request(
      `/groups/${GROUP_ID}/members`,
      { method: "POST", body: JSON.stringify({ personId: "01NEW" }), headers: { "Content-Type": "application/json" } },
      testEnv({ viewerPersonIsAdmin: false }),
    );
    expect(res.status).toBe(403);
  });

  it("lets a system admin add and remove", async () => {
    const added = await appWith(SYS_ADMIN).request(
      `/groups/${GROUP_ID}/members`,
      { method: "POST", body: JSON.stringify({ personId: "01NEW" }), headers: { "Content-Type": "application/json" } },
      env(),
    );
    expect(added.status).toBe(201);

    const removed = await appWith(SYS_ADMIN).request(
      `/groups/${GROUP_ID}/members/01NEW`,
      { method: "DELETE" },
      env(),
    );
    expect(removed.status).toBe(200);
  });
});

// A parent may put their own child on a classroom roster without administering
// it (`PUT /persons/:id/classroom`, invariant 27). Being ON the roster is the
// feature; being TRUSTED by it is not, and `self_asserted` (migration 0023) is
// where the two part.
//
// This is the behavioural half of that guarantee. It matters more than the
// route-side assertion that the flag is written: any member can mint a Person
// holding `student` (POST /me/persons) and walk it through every classroom one
// PUT at a time, so if this read honoured a self-written membership, every
// room's private contacts and exact address would be readable by anyone who
// asked 34 times.
describe("a self-asserted membership is not direct membership", () => {
  const PRIVATE_PHONE = { id: "01CI1", type: "phone", label: "Room", value: "555-0100", visibility: "private" };
  const ADDRESS = { id: "01CI2", type: "address", label: "Room", value: "123 Main St", visibility: "service" };

  it("withholds the group's private contacts from a self-placed member", async () => {
    const dto = await detail(MEMBER, testEnv({ selfAsserted: true, contacts: [PRIVATE_PHONE] }));
    expect(dto.contacts.map((c) => c.id)).not.toContain("01CI1");
  });

  it("still serves them to a member somebody with authority added", async () => {
    // The control: the same row, the same reader, differing only in who wrote
    // the membership. Without this the test above would pass on a route that
    // withheld the contact from everyone.
    const dto = await detail(MEMBER, testEnv({ selfAsserted: false, contacts: [PRIVATE_PHONE] }));
    expect(dto.contacts.map((c) => c.id)).toContain("01CI1");
  });

  it("redacts the exact address value for a self-placed member", async () => {
    const self = await detail(MEMBER, testEnv({ selfAsserted: true, contacts: [ADDRESS] }));
    expect(self.contacts.find((c) => c.id === "01CI2")?.value).toBe("");
    const granted = await detail(MEMBER, testEnv({ selfAsserted: false, contacts: [ADDRESS] }));
    expect(granted.contacts.find((c) => c.id === "01CI2")?.value).toBe("123 Main St");
  });
});

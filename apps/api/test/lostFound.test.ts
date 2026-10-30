// Lost & found (invariant 33): the gate on every staff route, the member
// submission path (any session may add an item; it stays held until staff
// publish), the public projection's key set, the name scrub, and the claim
// form's uniform answer.
//
// The route lists are enumerated by hand, as test/ptoRoutes.test.ts's are: if
// you add a route to routes/lostFound.ts, add it to STAFF_ROUTES or — only for
// a route that is deliberately open to any session — MEMBER_ROUTES. A route
// that forgets `requireStaff` is exactly what nothing else will notice.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AuthContext, HonoEnv } from "../src/env.js";
import type { AuditDraft } from "../src/lib/audit.js";
import {
  LISTED,
  cleanFields,
  cleanRotation,
  extractJson,
  isListed,
  itemIdOfKey,
  normalizeContact,
  publicItemOf,
  saveFields,
  staffItemOf,
  scrubNames,
  searchTextOf,
  searchWords,
  tagItem,
  type LfItemRow,
} from "../src/lib/lostFound.js";
import { lostFound } from "../src/routes/lostFound.js";
import { lostFoundPublic } from "../src/routes/lostFoundPublic.js";
import { UnauthorizedError } from "../src/middleware/session.js";

const GROUP = "01GRP";

function auth(userId: string, isSystemAdmin = false): AuthContext {
  return {
    userId,
    realUserId: userId,
    email: `${userId}@eisenhower.edu`,
    isSystemAdmin,
    sessionId: "01SESSION",
    activePersonId: null,
    isMasquerading: false,
    isApproved: true,
  };
}

function row(over: Partial<LfItemRow> = {}): LfItemRow {
  return {
    id: "01ITEM",
    status: "found",
    hidden_at: null,
    held_at: null,
    tag_status: "tagged",
    tag_error: null,
    title: "Blue water bottle",
    description: "A blue metal bottle with a soccer sticker.",
    category: "Water bottle",
    colors: '["blue"]',
    brand: "Hydro Flask",
    material: "metal",
    visible_text: "MILO R.",
    tags: '["bottle","flask"]',
    location: "Gym",
    search_text: "blue water bottle",
    photo_key: "01ITEM.jpg",
    thumb_key: "01ITEM-thumb.jpg",
    suggested_rotation: 0,
    found_at: "2026-10-01T15:00:00.000Z",
    returned_at: null,
    created_by: "01U_STAFF",
    member_submitted: 0,
    updated_at: "2026-10-01T15:00:00.000Z",
    ...over,
  };
}

// ── The staff gate ──────────────────────────────────────────────────────────

/** D1 stand-in answering only the gate's own statements. A gated route that
 *  slipped through would hit `all`/`run` and throw — loud, on purpose. */
function gateEnv(onRoster: boolean): HonoEnv["Bindings"] {
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind: () => ({
            async first() {
              if (sql.includes("FROM setting")) return { value: GROUP };
              if (sql.includes("FROM grp")) return { id: GROUP, name: "Front office" };
              if (sql.includes("FROM membership m")) return onRoster ? { ok: 1 } : null;
              throw new Error(`gateEnv: unhandled statement: ${sql}`);
            },
            async all() {
              throw new Error(`gateEnv: a gated route reached a read: ${sql}`);
            },
            async run() {
              throw new Error(`gateEnv: a gated route reached a write: ${sql}`);
            },
          }),
        };
      },
    },
  } as unknown as HonoEnv["Bindings"];
}

function appWith(session: AuthContext | null, audit: AuditDraft[] = []): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.use("*", async (c, next) => {
    c.set("audit", audit);
    if (session) c.set("auth", session);
    await next();
  });
  app.route("/lostfound", lostFound);
  app.route("/lostfound-public", lostFoundPublic);
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) return c.json({ error: "unauthorized" }, 401);
    throw err;
  });
  return app;
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

const STAFF_ROUTES: Array<[string, string, unknown?]> = [
  ["GET", "/lostfound/items"],
  ["GET", "/lostfound/items?view=attention"],
  ["GET", "/lostfound/items?ids=01ITEM,01OTHER"],
  ["GET", "/lostfound/items/01ITEM"],
  ["PUT", "/lostfound/items/01ITEM/photo", JPEG],
  ["PATCH", "/lostfound/items/01ITEM", { title: "x" }],
  ["POST", "/lostfound/items/01ITEM/publish", {}],
  ["POST", "/lostfound/items/01ITEM/hide", {}],
  ["POST", "/lostfound/items/01ITEM/unhide", {}],
  ["POST", "/lostfound/items/01ITEM/return", {}],
  ["POST", "/lostfound/items/01ITEM/restore", {}],
  ["POST", "/lostfound/items/01ITEM/retag", {}],
  ["DELETE", "/lostfound/items/01ITEM", {}],
  ["GET", "/lostfound/claims"],
  ["GET", "/lostfound/media/01ITEM.jpg"],
  ["POST", "/lostfound/claims/01CLAIM/dismiss", {}],
  ["POST", "/lostfound/retag-failed", {}],
];

/** Open to ANY session — submitting a found item (routes/lostFound.ts's
 *  header). Still refused without a session, and still preflighted. */
const MEMBER_ROUTES: Array<[string, string, unknown?]> = [
  ["POST", "/lostfound/items?location=Gym", JPEG],
  ["PUT", "/lostfound/items/01ITEM/thumb", JPEG],
];

const ALL_ROUTES = [...STAFF_ROUTES, ...MEMBER_ROUTES];

function call(app: Hono<HonoEnv>, method: string, path: string, body: unknown, env: HonoEnv["Bindings"]) {
  const init: RequestInit = { method };
  if (body instanceof Uint8Array) {
    init.body = body;
    init.headers = { "content-type": "image/jpeg" };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  return app.request(path, init, env);
}

describe("every /lostfound route refuses without a session", () => {
  const app = appWith(null);
  for (const [method, path, body] of ALL_ROUTES) {
    it(`${method} ${path} → 401`, async () => {
      expect((await call(app, method, path, body, gateEnv(true))).status).toBe(401);
    });
  }
});

describe("every /lostfound staff route refuses a member who isn't on the staff roster", () => {
  const app = appWith(auth("01U_PARENT"));
  for (const [method, path, body] of STAFF_ROUTES) {
    it(`${method} ${path} → 403`, async () => {
      expect((await call(app, method, path, body, gateEnv(false))).status).toBe(403);
    });
  }
});

describe("a write a cross-site form could send is refused before anything else", () => {
  // `sd_session` is SameSite=Lax, which doesn't separate sibling subdomains;
  // only a body type that forces a CORS preflight does (routes/lostFound.ts).
  const app = appWith(auth("01U_STAFF"));
  for (const [method, path] of ALL_ROUTES.filter(([m]) => m !== "GET")) {
    it(`${method} ${path} with no body / a form body → 415`, async () => {
      expect((await app.request(path, { method }, gateEnv(true))).status).toBe(415);
      const form = await app.request(
        path,
        { method, body: "x=1", headers: { "content-type": "application/x-www-form-urlencoded" } },
        gateEnv(true),
      );
      expect(form.status).toBe(415);
    });
  }
});

describe("the routes outside the staff gate", () => {
  it("GET /lostfound/access answers a member who isn't staff, so the app can say so", async () => {
    const res = await call(appWith(auth("01U_PARENT")), "GET", "/lostfound/access", undefined, gateEnv(false));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ canUse: false, isSystemAdmin: false, groupName: "Front office" });
  });

  it("the staff-group settings are system-admin only, even for staff", async () => {
    const staff = appWith(auth("01U_STAFF"));
    expect((await call(staff, "GET", "/lostfound/groups", undefined, gateEnv(true))).status).toBe(403);
    expect((await call(staff, "PUT", "/lostfound/settings", { groupId: GROUP }, gateEnv(true))).status).toBe(403);
  });
});

// ── Member submission ───────────────────────────────────────────────────────
// Any session may POST an item; what makes that safe is that a non-staff item
// is flagged `member_submitted` (the model never releases its hold — only
// staff's Publish does) and bounded per day.

/** D1 + R2 stand-ins for the submission path: the roster gate, the daily cap's
 *  count, the INSERT (recorded), and the reload that builds the response. */
function submitEnv(opts: { onRoster: boolean; todayCount?: number }) {
  const writes: { sql: string; args: unknown[] }[] = [];
  const media: string[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind: (...args: unknown[]) => ({
            async first() {
              if (sql.includes("FROM setting")) return { value: GROUP };
              if (sql.includes("FROM grp")) return { id: GROUP, name: "Front office" };
              if (sql.includes("FROM membership m")) return opts.onRoster ? { ok: 1 } : null;
              if (sql.includes("COUNT(*) AS n FROM lf_item")) return { n: opts.todayCount ?? 0 };
              if (sql.includes("FROM lf_item i")) {
                // getStaffItem's reload: echo back what the INSERT wrote.
                const ins = writes.find((w) => w.sql.includes("INSERT INTO lf_item"));
                if (!ins) return null;
                return {
                  ...row(),
                  id: ins.args[0],
                  visible_text: "",
                  held_at: ins.args[4],
                  member_submitted: ins.args[7],
                  open_claims: 0,
                  created_by_email: null,
                };
              }
              throw new Error(`submitEnv: unhandled first: ${sql}`);
            },
            async run() {
              writes.push({ sql, args });
              return { meta: { changes: 1 } };
            },
          }),
        };
      },
    },
    LOSTFOUND_MEDIA: {
      put: async (key: string) => void media.push(`put ${key}`),
      delete: async (key: string) => void media.push(`delete ${key}`),
    },
  } as unknown as HonoEnv["Bindings"];
  return { env, writes, media };
}

describe("POST /lostfound/items as a signed-in member", () => {
  async function post(opts: Parameters<typeof submitEnv>[0], who = "01U_PARENT") {
    const audit: AuditDraft[] = [];
    const { env, writes, media } = submitEnv(opts);
    const res = await call(appWith(auth(who), audit), "POST", "/lostfound/items?location=Gym", JPEG, env);
    return { res, writes, media, audit };
  }

  it("creates the item flagged member_submitted, held, and says so in the audit detail", async () => {
    const { res, writes, audit } = await post({ onRoster: false });
    expect(res.status).toBe(201);
    const ins = writes.find((w) => w.sql.includes("INSERT INTO lf_item"))!;
    // (id, photo_key, location, search_text, held_at, found_at, created_by, member_submitted, updated_at)
    expect(ins.args[7]).toBe(1);
    expect(ins.args[4]).toBeTruthy(); // held from the first moment
    expect(audit).toHaveLength(1);
    expect(audit[0]!).toMatchObject({ action: "lostfound.item.created", detail: { memberSubmitted: true } });
    expect(((await res.json()) as { memberSubmitted: boolean }).memberSubmitted).toBe(true);
  });

  it("creates a staff upload unflagged, with no detail — the model may still release it", async () => {
    const { res, writes, audit } = await post({ onRoster: true }, "01U_STAFF");
    expect(res.status).toBe(201);
    expect(writes.find((w) => w.sql.includes("INSERT INTO lf_item"))!.args[7]).toBe(0);
    expect(audit[0]!.detail).toBeUndefined();
  });

  it("refuses a member past the daily cap before anything is stored; staff are exempt", async () => {
    // The literal is deliberate: moving MEMBER_ITEMS_PER_DAY should land here
    // (and in CLAUDE.md's invariant 33) as its own decision, not ride along.
    const capped = await post({ onRoster: false, todayCount: 100 });
    expect(capped.res.status).toBe(429);
    expect(capped.writes).toEqual([]);
    expect(capped.media).toEqual([]);
    expect(capped.audit).toEqual([]);
    // Staff never meet the counter at all: the roster is the trust decision.
    expect((await post({ onRoster: true, todayCount: 999 }, "01U_STAFF")).res.status).toBe(201);
  });
});

describe("PUT /lostfound/items/:id/thumb ownership", () => {
  // The creator's window is EXACTLY "still held, still pending" — the second
  // half of submitting. Past it, the thumbnail is the public grid's image, so
  // only the roster may touch it (the route's comment; invariant 33).
  function thumbEnv(over: Partial<LfItemRow>, onRoster = false) {
    const writes: string[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return {
            bind: () => ({
              async first() {
                if (sql.includes("FROM setting")) return { value: GROUP };
                if (sql.includes("FROM grp")) return { id: GROUP, name: "Front office" };
                if (sql.includes("FROM membership m")) return onRoster ? { ok: 1 } : null;
                if (sql.includes("FROM lf_item i")) {
                  return { ...row(), member_submitted: 1, open_claims: 0, created_by_email: null, ...over };
                }
                throw new Error(`thumbEnv: unhandled first: ${sql}`);
              },
              async run() {
                writes.push(sql);
                return { meta: { changes: 1 } };
              },
            }),
          };
        },
      },
      LOSTFOUND_MEDIA: { put: async () => {}, delete: async () => {} },
    } as unknown as HonoEnv["Bindings"];
    return { env, writes };
  }

  // The pending path launches `tagItem` through the execution context, so give
  // Hono one; with no AI binding the call fails onto the item, harmlessly here.
  const CTX = { waitUntil: () => {} } as unknown as ExecutionContext;
  const put = (who: string, env: HonoEnv["Bindings"]) =>
    appWith(auth(who)).request(
      "/lostfound/items/01ITEM/thumb",
      { method: "PUT", body: JPEG, headers: { "content-type": "image/jpeg" } },
      env,
      CTX,
    );

  const HELD_PENDING: Partial<LfItemRow> = {
    created_by: "01U_PARENT",
    held_at: "2026-10-01T15:00:00.000Z",
    tag_status: "pending",
    visible_text: "",
  };

  it("lets the item's creator send the thumbnail while it is held and pending, and nobody else off the roster", async () => {
    const own = thumbEnv(HELD_PENDING);
    expect((await put("01U_PARENT", own.env)).status).toBe(200);
    expect(own.writes.some((s) => s.includes("SET thumb_key"))).toBe(true);

    const other = thumbEnv(HELD_PENDING);
    expect((await put("01U_OTHER", other.env)).status).toBe(403);
    expect(other.writes).toEqual([]);
  });

  it("refuses the creator once the item is published or described — the public image is the roster's", async () => {
    // Published: staff looked and released the hold.
    const published = thumbEnv({ created_by: "01U_PARENT", held_at: null, tag_status: "tagged" });
    expect((await put("01U_PARENT", published.env)).status).toBe(403);
    expect(published.writes).toEqual([]);

    // Still held, but described: the model has written; staff review is next.
    const described = thumbEnv({ created_by: "01U_PARENT", held_at: "2026-10-01T15:00:00.000Z", tag_status: "tagged" });
    expect((await put("01U_PARENT", described.env)).status).toBe(403);
    expect(described.writes).toEqual([]);
  });

  it("staff keep the route whatever the item's state (rotation re-sends a thumbnail)", async () => {
    const staff = thumbEnv({ created_by: "01U_PARENT", held_at: null, tag_status: "tagged" }, true);
    expect((await put("01U_STAFF", staff.env)).status).toBe(200);
    expect(staff.writes.some((s) => s.includes("SET thumb_key"))).toBe(true);
  });
});

// ── The public projection ───────────────────────────────────────────────────

describe("publicItemOf", () => {
  const ORIGIN = "https://api-directory.eisenhower.school";

  it("has exactly the public keys", () => {
    expect(Object.keys(publicItemOf(row(), ORIGIN)).sort()).toEqual(
      [
        "brand",
        "category",
        "colors",
        "description",
        "foundAt",
        "id",
        "location",
        "material",
        "pending",
        "photoUrl",
        "tags",
        "thumbUrl",
        "title",
      ].sort(),
    );
  });

  it("never carries what was written on the item, who uploaded it, or a widened row's extras", () => {
    const widened = { ...row(), secret_column: "x", open_claims: 3, created_by_email: "office@school" } as LfItemRow;
    const out = JSON.stringify(publicItemOf(widened, ORIGIN));
    expect(out).not.toContain("MILO");
    expect(out).not.toContain("01U_STAFF");
    expect(out).not.toContain("secret_column");
    expect(out).not.toContain("office@school");
  });

  it("falls back to the photo until the thumbnail arrives", () => {
    expect(publicItemOf(row({ thumb_key: null }), ORIGIN).thumbUrl).toBe(`${ORIGIN}/lostfound-media/01ITEM.jpg`);
  });
});

// ── Names stay staff-only ───────────────────────────────────────────────────

describe("scrubNames", () => {
  const fields = (over: Partial<ReturnType<typeof cleanFields>>) => ({ ...cleanFields({ title: "x" }), ...over });

  it("cuts words read off the item from the title, description and tags", () => {
    const out = scrubNames(
      fields({
        title: "Milo's blue jacket",
        description: "Blue jacket; the tag says Milo Rivera.",
        tags: ["jacket", "milo", "rivera"],
        visibleText: "Milo Rivera",
      }),
    );
    expect(JSON.stringify([out.title, out.description, out.tags])).not.toMatch(/milo|rivera/i);
    expect(out.visibleText).toBe("Milo Rivera");
  });

  it("keeps the brand even when the brand is written on the item", () => {
    const out = scrubNames(fields({ title: "Hydro Flask bottle", brand: "Hydro Flask", visibleText: "HYDRO FLASK" }));
    expect(out.title).toBe("Hydro Flask bottle");
  });

  it("handles names with accents", () => {
    const out = scrubNames(fields({ title: "Chaqueta de Zoë", visibleText: "Zoë" }));
    expect(out.title).not.toContain("Zoë");
  });
});

describe("searchTextOf", () => {
  it("is built without visible_text, so the public search can't confirm a name", () => {
    const f = cleanFields({ title: "Red lunch box", visibleText: "AVA K" });
    expect(searchTextOf(f, "Cafeteria")).not.toContain("ava");
  });
});

// ── The model's answer ──────────────────────────────────────────────────────

describe("cleanFields + extractJson", () => {
  it("reads both response shapes Workers AI uses", () => {
    expect(extractJson({ response: '{"title":"a"}' })).toEqual({ title: "a" });
    expect(extractJson({ choices: [{ message: { content: '```json\n{"title":"b"}\n```' } }] })).toEqual({ title: "b" });
  });

  it("keeps only known categories and colours and drops placeholders", () => {
    const f = cleanFields({ title: "Bottle", category: "Spaceship", colors: ["Blue", "teal", "blue"], brand: "not visible" });
    expect(f.category).toBe("Other");
    expect(f.colors).toEqual(["blue"]);
    expect(f.brand).toBe("");
  });
});

describe("searchWords", () => {
  it("is LIKE-safe: letters and digits only, each under D1's 50-byte pattern cap", () => {
    expect(searchWords('blue %_ "bottle" ' + "x".repeat(80))).toEqual(["blue", "bottle", "x".repeat(40)]);
  });
});

describe("normalizeContact", () => {
  it("treats one phone number written two ways as one contact", () => {
    expect(normalizeContact("(612) 555-0100")).toBe(normalizeContact("612.555.0100"));
    expect(normalizeContact(" Pat@Example.com ")).toBe("pat@example.com");
  });
});

// ── The claim form ──────────────────────────────────────────────────────────

/** D1 stand-in for the claim route: one item, configurable counts, and a log
 *  of every write. */
function claimEnv(opts: { item?: LfItemRow | null; total?: number; mine?: number; open?: number }) {
  const writes: string[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind: (...args: unknown[]) => ({
            async first() {
              if (sql.includes("FROM lf_item WHERE id")) return opts.item === undefined ? row() : opts.item;
              if (sql.includes("AS total")) return { total: opts.total ?? 0, mine: opts.mine ?? 0, open: opts.open ?? 0 };
              throw new Error(`claimEnv: unhandled: ${sql}`);
            },
            async run() {
              writes.push(`${sql} ${JSON.stringify(args)}`);
              return { meta: { changes: 1 } };
            },
          }),
        };
      },
    },
  } as unknown as HonoEnv["Bindings"];
  return { env, writes };
}

describe("POST /lostfound-public/items/:id/claims", () => {
  const claim = { name: "Pat", contact: "pat@example.com", message: "Dent on the bottom" };

  async function post(body: unknown, opts: Parameters<typeof claimEnv>[0] = {}) {
    const audit: AuditDraft[] = [];
    const { env, writes } = claimEnv(opts);
    const res = await call(appWith(null, audit), "POST", "/lostfound-public/items/01ITEM/claims", body, env);
    return { status: res.status, json: await res.json(), writes, audit };
  }

  it("stores a claim, audits it with no claimant details, and answers ok", async () => {
    const r = await post(claim);
    expect(r.json).toEqual({ ok: true });
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0]).toContain("contact_key");
    expect(r.audit).toHaveLength(1);
    expect(r.audit[0]!.action).toBe("lostfound.claim.created");
    expect(JSON.stringify(r.audit[0])).not.toMatch(/Pat|example\.com|Dent/);
  });

  it("answers identically — and stores nothing — for a honeypot, a cap, or an unlisted item", async () => {
    for (const r of [
      await post({ ...claim, website: "http://spam" }),
      await post(claim, { total: 50 }),
      await post(claim, { mine: 3 }),
      await post(claim, { open: 10 }),
      await post(claim, { item: row({ hidden_at: "2026-10-01T00:00:00Z" }) }),
      await post(claim, { item: row({ status: "returned" }) }),
      await post(claim, { item: row({ held_at: "2026-10-01T00:00:00Z" }) }),
      await post(claim, { item: null }),
    ]) {
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: true });
      expect(r.writes).toEqual([]);
      expect(r.audit).toEqual([]);
    }
  });

  it("refuses a claim with no name or contact — about the caller's own input only", async () => {
    expect((await post({ name: "", contact: "pat@example.com" })).status).toBe(400);
    expect((await post({ name: "Pat", contact: "" })).status).toBe(400);
  });
});

describe("GET /lostfound-public/items/:id", () => {
  it("404s anything not currently listed", async () => {
    for (const item of [
      row({ hidden_at: "2026-10-01T00:00:00Z" }),
      row({ held_at: "2026-10-01T00:00:00Z" }),
      row({ status: "returned" }),
      null,
    ]) {
      const { env } = claimEnv({ item });
      const res = await call(appWith(null), "GET", "/lostfound-public/items/01ITEM", undefined, env);
      expect(res.status).toBe(404);
    }
  });
});

// ── The model never writes over staff ───────────────────────────────────────

describe("tagItem", () => {
  it("writes the model's answer only while the item is still pending, and records failure the same way", async () => {
    const sqls: string[] = [];
    const env = {
      AI: {
        run: async () => ({ response: { title: "Red mitten", category: "Hat, gloves, or scarf", colors: ["red"] } }),
      },
      DB: {
        prepare(sql: string) {
          return {
            bind: () => ({
              async first() {
                return null; // location lookup: none
              },
              async run() {
                sqls.push(sql);
                // Staff saved first: the guarded UPDATE matches nothing.
                return { meta: { changes: 0 } };
              },
            }),
          };
        },
      },
    } as unknown as HonoEnv["Bindings"];

    await tagItem(env, "01ITEM", new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toContain("AND tag_status = 'pending'");

    sqls.length = 0;
    const failing = { ...env, AI: { run: async () => ({ response: "not json" }) } } as unknown as HonoEnv["Bindings"];
    await tagItem(failing, "01ITEM", new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toMatch(/SET tag_status = 'failed'.*AND tag_status = 'pending'/s);
  });
});

describe("the hold (a name can be in the PHOTO)", () => {
  async function aiWrite(response: Record<string, unknown>) {
    const sqls: string[] = [];
    const env = {
      AI: { run: async () => ({ response }) },
      DB: {
        prepare(sql: string) {
          return {
            bind: () => ({
              first: async () => null,
              run: async () => {
                sqls.push(sql);
                return { meta: { changes: 1 } };
              },
            }),
          };
        },
      },
    } as unknown as HonoEnv["Bindings"];
    await tagItem(env, "01ITEM", new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    return sqls[0]!;
  }

  it("is released by the model only when it reads no writing AND never read any before AND staff submitted it", async () => {
    // SET expressions see the OLD row, so this releases only an item whose
    // stored visible_text was empty — a retag that misses a name it read the
    // first time leaves the hold for staff. A member-submitted item is never
    // released by the model at all (migration 0037): only staff publish it.
    expect(await aiWrite({ title: "Red mitten" })).toContain(
      "held_at = CASE WHEN visible_text = '' AND member_submitted = 0 THEN NULL ELSE held_at END",
    );
  });

  it("is kept when the model read writing", async () => {
    expect(await aiWrite({ title: "Red mitten", visible_text: "AVA" })).toContain("held_at = COALESCE(held_at, ?)");
  });

  it("is never touched by a staff save — publishing is its own act", async () => {
    let sql = "";
    const env = {
      DB: {
        prepare(s: string) {
          sql = s;
          return { bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) };
        },
      },
    } as unknown as HonoEnv["Bindings"];
    await saveFields(env, "01ITEM", cleanFields({ title: "Mitten" }), { location: "Gym" });
    expect(sql).not.toContain("held_at");
  });

  it("is part of the public listing gate, in SQL and for a row in hand", () => {
    expect(LISTED).toContain("held_at IS NULL");
    expect(isListed(row())).toBe(true);
    expect(isListed(row({ held_at: "2026-10-01T00:00:00Z" }))).toBe(false);
    expect(isListed(row({ hidden_at: "2026-10-01T00:00:00Z" }))).toBe(false);
    expect(isListed(row({ status: "returned" }))).toBe(false);
  });
});

describe("the suggested rotation", () => {
  async function aiWrite(response: Record<string, unknown>) {
    const writes: { sql: string; args: unknown[] }[] = [];
    const env = {
      AI: { run: async () => ({ response }) },
      DB: {
        prepare(sql: string) {
          return {
            bind: (...args: unknown[]) => ({
              first: async () => null,
              run: async () => {
                writes.push({ sql, args });
                return { meta: { changes: 1 } };
              },
            }),
          };
        },
      },
    } as unknown as HonoEnv["Bindings"];
    await tagItem(env, "01ITEM", new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    return writes[0]!;
  }

  it("is snapped to a quarter turn, and anything else means leave it", () => {
    expect([0, 90, 180, 270].map(cleanRotation)).toEqual([0, 90, 180, 270]);
    expect(cleanRotation("90")).toBe(90);
    for (const v of [45, -90, 360, "sideways", null, undefined]) expect(cleanRotation(v)).toBe(0);
  });

  it("rides the model's guarded write, so staff edits made first still win", async () => {
    const w = await aiWrite({ title: "Red mitten", rotation: 270 });
    expect(w.sql).toMatch(/suggested_rotation = \?.*AND tag_status = 'pending'/s);
    // The id is last; the rotation is the bind just before it.
    expect(w.args.slice(-2)).toEqual([270, "01ITEM"]);
  });

  it("is never written by a staff save", async () => {
    let sql = "";
    const env = {
      DB: {
        prepare(s: string) {
          sql = s;
          return { bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) };
        },
      },
    } as unknown as HonoEnv["Bindings"];
    await saveFields(env, "01ITEM", cleanFields({ title: "Mitten" }), { location: "Gym" });
    expect(sql).not.toContain("suggested_rotation");
  });

  it("is staff-only", () => {
    const ORIGIN = "https://api-directory.eisenhower.school";
    const r = row({ suggested_rotation: 90 });
    expect(staffItemOf({ ...r, open_claims: 0, created_by_email: null }, ORIGIN).suggestedRotation).toBe(90);
    expect(publicItemOf(r, ORIGIN)).not.toHaveProperty("suggestedRotation");
  });
});

describe("itemIdOfKey (the public photo route's gate)", () => {
  it("maps a photo or thumbnail key to its item, and nothing else", () => {
    const id = "01M3Z5G57Q0DGBMRZVE1FSSSMS";
    expect(itemIdOfKey(`${id}.jpg`)).toBe(id);
    expect(itemIdOfKey(`${id}-thumb.jpg`)).toBe(id);
    expect(itemIdOfKey(`${id}-mfx1k2a.jpg`)).toBe(id);
    expect(itemIdOfKey(`${id}-mfx1k2a-thumb.jpg`)).toBe(id);
    expect(itemIdOfKey(`${id}-../x.jpg`)).toBeNull();
    expect(itemIdOfKey("../secret.jpg")).toBeNull();
    expect(itemIdOfKey(`${id}.png`)).toBeNull();
  });
});

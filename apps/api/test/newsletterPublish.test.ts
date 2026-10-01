// Publishing an issue's page apart from sending it (migration 0031).
//
// The public side — which slugs `/newsletter-public/issues/:slug` serves — is
// pinned in newsletterIssuePage.test.ts. This file pins the authoring side:
//
//   1. Publish and unpublish are compare-and-swaps, so repeating one writes
//      nothing and pushes no audit draft.
//   2. Unpublishing is refused mid-send, and allowed once sent.
//   3. A published page's slug cannot change, and a published draft cannot be
//      deleted — both would break links already out in the world.
//   4. A send publishes an unpublished issue and keeps the date of one already
//      published (COALESCE).
//
// The fake D1 EVALUATES each guard clause it recognises rather than matching
// the statement wholesale, so deleting a clause from a route changes an
// outcome here instead of passing a text scan (invariant 22's reason).

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AuthContext, HonoEnv } from "../src/env.js";
import type { AuditDraft } from "../src/lib/audit.js";
import { newsletter } from "../src/routes/newsletter.js";
import type { IssueRow } from "../src/lib/newsletterSend.js";
import { startSend } from "../src/lib/newsletterSend.js";

const ID = "01ISSUE";

function issue(over: Partial<IssueRow> = {}): IssueRow {
  return {
    id: ID,
    slug: "2099-10-01-october",
    title: "October",
    subtitle: null,
    subject: "October",
    content_json: JSON.stringify({ type: "doc", content: [] }),
    events_snapshot_json: null,
    status: "draft",
    recipient_total: 0,
    sent_at: null,
    published_at: null,
    created_by: null,
    created_at: "2099-09-01T00:00:00.000Z",
    updated_at: "2099-09-01T00:00:00.000Z",
    preview_token_hash: null,
    preview_token_created_at: null,
    audit_session_at: null,
    ...over,
  };
}

interface Fake {
  env: HonoEnv["Bindings"];
  row: IssueRow;
  writes: string[];
}

function fake(row: IssueRow, audience: { email: string }[] = []): Fake {
  const state: Fake = { env: null as never, row, writes: [] };

  const stmt = (sql: string) => {
    let b: unknown[] = [];
    const s = {
      bind(...args: unknown[]) {
        b = args;
        return s;
      },
      async first() {
        if (sql.includes("FROM setting")) return null;
        if (sql.includes("FROM newsletter_issue WHERE id = ?")) return { ...state.row };
        if (sql.includes("COUNT(*)")) return { n: 0 };
        return null;
      },
      async all() {
        if (sql.includes("FROM newsletter_send")) return { results: [] };
        if (sql.includes("newsletter_subscriber") || sql.includes("FROM user")) {
          // Both opt-out columns present and null: an ABSENT one reads as
          // opted out, which would leave nobody to send to.
          return {
            results: audience.map((a, i) => ({
              email: a.email,
              id: `01S${i}`,
              unsubscribed_at: null,
              newsletter_opt_out_at: null,
            })),
          };
        }
        return { results: [] };
      },
      async run() {
        return run(sql, b);
      },
    };
    return s;
  };

  function run(sql: string, b: unknown[]) {
    const r = state.row;
    let changes = 0;
    if (/^UPDATE newsletter_issue SET published_at = \?/.test(sql)) {
      const ok = !sql.includes("published_at IS NULL") || r.published_at === null;
      if (ok) {
        r.published_at = b[0] as string;
        changes = 1;
      }
    } else if (/^UPDATE newsletter_issue SET published_at = NULL/.test(sql)) {
      const ok =
        (!sql.includes("published_at IS NOT NULL") || r.published_at !== null) &&
        (!sql.includes("status != 'sending'") || r.status !== "sending");
      if (ok) {
        r.published_at = null;
        changes = 1;
      }
    } else if (sql.includes("SET status = 'sending'")) {
      if (r.status === "draft") {
        r.status = "sending";
        changes = 1;
      }
    } else if (sql.includes("SET events_snapshot_json = ?")) {
      // [snapshot, total, sent_at, updated_at, published_at fallback, id]
      r.sent_at = b[2] as string;
      if (sql.includes("COALESCE(published_at, ?)")) r.published_at ??= b[4] as string;
      changes = 1;
    } else if (sql.startsWith("DELETE FROM newsletter_issue")) {
      const ok =
        r.status === "draft" && (!sql.includes("published_at IS NULL") || r.published_at === null);
      changes = ok ? 1 : 0;
    }
    if (changes) state.writes.push(sql);
    return { meta: { changes } };
  }

  state.env = {
    SCHOOL_NAME: "Eisenhower",
    SCHOOL_TIMEZONE: "America/Chicago",
    NEWSLETTER_URL: "https://newsletter.eisenhower.school",
    DB: {
      prepare: stmt,
      async batch(stmts: { run: () => Promise<unknown> }[]) {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        return out;
      },
    },
  } as unknown as HonoEnv["Bindings"];
  return state;
}

const ADMIN: AuthContext = {
  userId: "01ADMIN",
  realUserId: "01ADMIN",
  email: "admin@eisenhower.edu",
  isSystemAdmin: true,
  sessionId: "01SESSION",
  activePersonId: null,
  isMasquerading: false,
  isApproved: true,
};

async function call(f: Fake, method: string, path: string, body?: unknown) {
  const audit: AuditDraft[] = [];
  const app = new Hono<HonoEnv>();
  app.use("*", async (c, next) => {
    c.set("audit", audit);
    c.set("auth", ADMIN);
    await next();
  });
  app.route("/newsletter", newsletter);
  const res = await app.request(
    path,
    {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    },
    f.env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
  return { res, audit, json: (await res.json()) as Record<string, any> };
}

describe("publish / unpublish", () => {
  it("publishes a draft without sending it, and it stays a draft", async () => {
    const f = fake(issue());
    const { res, audit, json } = await call(f, "POST", `/newsletter/issues/${ID}/publish`);
    expect(res.status).toBe(200);
    expect(f.row.published_at).not.toBeNull();
    expect(f.row.status).toBe("draft");
    expect(f.row.sent_at).toBeNull();
    expect(json.issue.publishedAt).toBe(f.row.published_at);
    expect(audit.map((a) => a.action)).toEqual(["newsletter.issue.published"]);
  });

  it("publishing what is already up writes nothing and logs nothing", async () => {
    const f = fake(issue({ published_at: "2099-09-05T00:00:00.000Z" }));
    const { res, audit } = await call(f, "POST", `/newsletter/issues/${ID}/publish`);
    expect(res.status).toBe(200);
    expect(f.row.published_at).toBe("2099-09-05T00:00:00.000Z"); // date kept
    expect(f.writes).toEqual([]);
    expect(audit).toEqual([]);
  });

  it("unpublishes, and a second unpublish is a silent no-op", async () => {
    const f = fake(issue({ published_at: "2099-09-05T00:00:00.000Z" }));
    const first = await call(f, "DELETE", `/newsletter/issues/${ID}/publish`);
    expect(first.res.status).toBe(200);
    expect(f.row.published_at).toBeNull();
    expect(first.audit.map((a) => a.action)).toEqual(["newsletter.issue.unpublished"]);

    const again = await call(f, "DELETE", `/newsletter/issues/${ID}/publish`);
    expect(again.res.status).toBe(200);
    expect(again.audit).toEqual([]);
  });

  it("unpublishes a SENT issue", async () => {
    const f = fake(
      issue({ status: "sent", sent_at: "2099-09-05T00:00:00.000Z", published_at: "2099-09-05T00:00:00.000Z" }),
    );
    const { res, audit } = await call(f, "DELETE", `/newsletter/issues/${ID}/publish`);
    expect(res.status).toBe(200);
    expect(f.row.published_at).toBeNull();
    expect(audit[0]?.detail).toMatchObject({ sent: true });
  });

  it("refuses to unpublish while mail carrying the link is still going out", async () => {
    const f = fake(issue({ status: "sending", published_at: "2099-09-05T00:00:00.000Z" }));
    const { res, audit } = await call(f, "DELETE", `/newsletter/issues/${ID}/publish`);
    expect(res.status).toBe(409);
    expect(f.row.published_at).not.toBeNull();
    expect(audit).toEqual([]);
  });
});

describe("what a published page locks", () => {
  it("refuses to change a published draft's slug", async () => {
    const f = fake(issue({ published_at: "2099-09-05T00:00:00.000Z" }));
    const { res } = await call(f, "PATCH", `/newsletter/issues/${ID}`, { slug: "something-else" });
    expect(res.status).toBe(409);
    expect(f.writes).toEqual([]);
  });

  it("still saves a published draft's content, with its slug as-is", async () => {
    const f = fake(issue({ published_at: "2099-09-05T00:00:00.000Z" }));
    const { res } = await call(f, "PATCH", `/newsletter/issues/${ID}`, {
      title: "October, revised",
      slug: "2099-10-01-october",
    });
    expect(res.status).toBe(200);
  });

  it("refuses to delete a published draft", async () => {
    const f = fake(issue({ published_at: "2099-09-05T00:00:00.000Z" }));
    const { res } = await call(f, "DELETE", `/newsletter/issues/${ID}`);
    expect(res.status).toBe(409);
    expect(f.writes).toEqual([]);
  });

  it("deletes an unpublished draft", async () => {
    const f = fake(issue());
    const { res } = await call(f, "DELETE", `/newsletter/issues/${ID}`);
    expect(res.status).toBe(200);
    expect(f.writes.some((w) => w.startsWith("DELETE FROM newsletter_issue"))).toBe(true);
  });
});

describe("sending publishes", () => {
  it("puts an unpublished issue's page up at the send time", async () => {
    const f = fake(issue(), [{ email: "a@x.test" }]);
    const out = await startSend(f.env, ID);
    expect(out.ok).toBe(true);
    expect(f.row.published_at).toBe(f.row.sent_at);
  });

  it("keeps the date of a page published earlier", async () => {
    const f = fake(issue({ published_at: "2099-09-05T00:00:00.000Z" }), [{ email: "a@x.test" }]);
    const out = await startSend(f.env, ID);
    expect(out.ok).toBe(true);
    expect(f.row.published_at).toBe("2099-09-05T00:00:00.000Z");
  });
});

// One audit row per editing SESSION, not per autosave.
//
// `apps/newsletter`'s IssueEditor flushes a PATCH 1.2 seconds after the author
// stops typing, and every PATCH used to push a `newsletter.issue.updated`
// draft. In this instance's log that made it the single largest action — 108
// rows out of ~450, from one issue — which is a transcript of a debounce timer,
// not a record of anything. `audit_log` is append-only and hash-chained
// (invariant 5) and lib/sweep.ts says why it may never be swept, so the fix has
// to be at the push site: mint the row for the sitting, and stay quiet for the
// saves inside it.
//
// These tests are BEHAVIOURAL rather than textual, for the same reason
// slackNotify.test.ts is: the fake D1 below actually evaluates the claim's
// WHERE clause, so a guard that stopped guarding (or a route that pushed
// unconditionally anyway) fails with a second row rather than passing on the
// strength of the SQL still being there. The last case is the one that matters
// most — coalescing the AUDIT row must never coalesce the SAVE.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newsletter } from "../src/routes/newsletter.js";
import type { AuditDraft } from "../src/lib/audit.js";
import type { AuthContext, HonoEnv } from "../src/env.js";

const ADMIN: AuthContext = {
  userId: "01ADMIN",
  realUserId: "01ADMIN",
  email: "admin@eisenhower.edu",
  isSystemAdmin: true,
  sessionId: "01SESSION",
  activePersonId: null,
  isMasquerading: false,
};

const T0 = Date.UTC(2026, 7, 31, 0, 18, 0);
const MIN = 60 * 1000;

interface Issue {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  subject: string;
  content_json: string;
  events_snapshot_json: string | null;
  status: string;
  recipient_total: number;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  preview_token_hash: string | null;
  preview_token_created_at: string | null;
  audit_session_at: string | null;
}

function issueRow(overrides: Partial<Issue> = {}): Issue {
  const at = new Date(T0).toISOString();
  return {
    id: "01ISSUE",
    slug: "back-to-school",
    title: "Back to school",
    subtitle: null,
    subject: "Back to school",
    content_json: JSON.stringify({ type: "doc", content: [] }),
    events_snapshot_json: null,
    status: "draft",
    recipient_total: 0,
    sent_at: null,
    created_by: "01ADMIN",
    created_at: at,
    updated_at: at,
    preview_token_hash: null,
    preview_token_created_at: null,
    audit_session_at: null,
    ...overrides,
  };
}

/**
 * D1 stand-in holding one mutable issue row.
 *
 * The claim's guard is evaluated for real: `audit_session_at IS NULL OR
 * audit_session_at < ?` against the bound cutoff, reporting the outcome as
 * `meta.changes` the way D1 does. That is what makes these tests catch a guard
 * that silently stopped guarding.
 */
function testEnv(store: { issue: Issue | null; writes: string[] }): HonoEnv["Bindings"] {
  const mk = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async first() {
      if (sql.includes("SELECT id FROM newsletter_issue WHERE slug")) return null; // uniqueSlug
      if (sql.includes("FROM newsletter_issue")) return store.issue;
      return null;
    },
    async all() {
      return { results: [] };
    },
    async run() {
      return exec(sql, this.args);
    },
  });

  function exec(sql: string, args: unknown[]): { meta: { changes: number } } {
    if (sql.includes("INSERT INTO newsletter_issue")) {
      store.writes.push("insert");
      const [id, slug, title, subtitle, subject, content, , createdAt, updatedAt, session] =
        args as [string, string, string, string | null, string, string, string, string, string, string];
      store.issue = issueRow({
        id,
        slug,
        title,
        subtitle: subtitle ?? null,
        subject,
        content_json: content,
        created_at: createdAt,
        updated_at: updatedAt,
        audit_session_at: session ?? null,
      });
      return { meta: { changes: 1 } };
    }

    if (sql.includes("SET audit_session_at")) {
      const [now, , cutoff] = args as [string, string, string];
      const current = store.issue?.audit_session_at ?? null;
      const open = current === null || current < cutoff;
      if (open && store.issue) store.issue.audit_session_at = now;
      store.writes.push(open ? "claim:won" : "claim:lost");
      return { meta: { changes: open ? 1 : 0 } };
    }

    if (sql.includes("UPDATE newsletter_issue")) {
      store.writes.push("save");
      const [title, subtitle, subject, slug, content, updatedAt] =
        args as [string, string | null, string, string, string, string];
      if (store.issue) {
        Object.assign(store.issue, {
          title,
          subtitle: subtitle ?? null,
          subject,
          slug,
          content_json: content,
          updated_at: updatedAt,
        });
      }
      return { meta: { changes: 1 } };
    }

    return { meta: { changes: 0 } };
  }

  return {
    DB: {
      prepare: (sql: string) => mk(sql),
      async batch(stmts: { sql: string; args: unknown[] }[]) {
        return stmts.map((s) => exec(s.sql, s.args));
      },
    },
  } as unknown as HonoEnv["Bindings"];
}

let audit: AuditDraft[] = [];

function app(): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>();
  a.use(
    "*",
    createMiddleware<HonoEnv>(async (c, next) => {
      c.set("audit", audit);
      c.set("auth", ADMIN);
      await next();
    }),
  );
  a.route("/newsletter", newsletter);
  return a;
}

/** Bindings ride in as `request`'s third argument, as elsewhere in this suite. */
const req = (env: HonoEnv["Bindings"], path: string, method: string, body: unknown) =>
  app().request(
    path,
    { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    env,
  );

const save = (env: HonoEnv["Bindings"], body: unknown) =>
  req(env, "/newsletter/issues/01ISSUE", "PATCH", body);

const updates = () => audit.filter((d) => d.action === "newsletter.issue.updated");

beforeEach(() => {
  audit = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("newsletter autosave is audited once per sitting", () => {
  it("records the first save and stays quiet for the burst behind it", async () => {
    const store = { issue: issueRow(), writes: [] as string[] };
    const env = testEnv(store);

    // The shape the log actually saw: a dozen saves a few seconds apart.
    for (let i = 0; i < 12; i++) {
      vi.setSystemTime(T0 + i * 5000);
      const res = await save(env, { content: { type: "doc", content: [] } });
      expect(res.status).toBe(200);
    }

    expect(updates()).toHaveLength(1);
    expect(updates()[0]).toMatchObject({
      entityKind: "newsletter_issue",
      entityId: "01ISSUE",
    });
  });

  it("records a genuine second sitting", async () => {
    const store = { issue: issueRow(), writes: [] as string[] };
    const env = testEnv(store);

    await save(env, { title: "Back to school" });
    vi.setSystemTime(T0 + 29 * MIN); // still inside the window
    await save(env, { title: "Back to school" });
    expect(updates()).toHaveLength(1);

    vi.setSystemTime(T0 + 31 * MIN); // a different visit
    await save(env, { title: "Back to school" });
    expect(updates()).toHaveLength(2);
  });

  it("treats creating a draft as opening its first sitting", async () => {
    const store = { issue: null as Issue | null, writes: [] as string[] };
    const env = testEnv(store);

    const created = await req(env, "/newsletter/issues", "POST", { title: "Back to school" });
    expect(created.status).toBe(201);
    expect(store.issue?.audit_session_at).toBe(new Date(T0).toISOString());

    // Typing straight into the new editor: `newsletter.issue.created` already
    // reported this, so the autosaves that follow add nothing.
    vi.setSystemTime(T0 + 4000);
    await req(env, `/newsletter/issues/${store.issue!.id}`, "PATCH", {
      content: { type: "doc", content: [] },
    });

    expect(audit.map((d) => d.action)).toEqual(["newsletter.issue.created"]);
  });

  it("still persists every save it declines to audit", async () => {
    const store = { issue: issueRow(), writes: [] as string[] };
    const env = testEnv(store);

    await save(env, { title: "First" });
    vi.setSystemTime(T0 + 6000);
    await save(env, { title: "Second" });
    vi.setSystemTime(T0 + 12000);
    await save(env, { title: "Third" });

    // Coalescing the audit row must never coalesce the write behind it.
    expect(store.writes.filter((w) => w === "save")).toHaveLength(3);
    expect(store.issue?.title).toBe("Third");
    expect(store.issue?.updated_at).toBe(new Date(T0 + 12000).toISOString());
    expect(updates()).toHaveLength(1);
  });
});

// The budgeted, paced, resumable fan-out — written after the October 2026 send,
// where one unpaced, unbounded run failed 69 of 94 recipients (24 Resend 429s,
// 45 "Too many subrequests") and nothing resumed it.
//
// What this pins, behaviourally (the fake D1 below keeps real rows and
// evaluates each statement's own terms, invariant 22's reason):
//
//   1. A run attempts at most its budget and leaves the issue 'sending' when
//      rows remain, so the cron can carry on; it flips to 'sent' only when
//      nothing is left pending.
//   2. A transient refusal (429, 5xx, no verdict) leaves the row 'pending' —
//      re-attempted automatically — while a non-429 4xx goes to 'failed' and is
//      NOT re-attempted by later automatic passes.
//   3. Only 'pending' rows are scanned: a 'sent' row is never re-mailed.
//   4. The manual retry resets failed → pending, and only after winning the
//      claim.
//   5. resumePendingSends claims only a STALE 'sending' issue (a fresh
//      heartbeat means a run may still be mailing — claiming it would mail
//      duplicates), and heals one that died after its last send by flipping it
//      to 'sent'.
//   6. The pacing arithmetic itself: one burst of CONCURRENCY per SEND_PACE_MS
//      stays at or under Resend's 10/s meter, and the budget stays under the
//      free plan's 50-subrequest invocation cap with headroom.

import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import type { IssueRow } from "../src/lib/newsletterSend.js";
import {
  CONCURRENCY,
  ROUTE_SEND_BUDGET,
  SEND_BUDGET,
  SEND_PACE_MS,
  resumePendingSends,
  retryFailed,
  runFanOut,
} from "../src/lib/newsletterSend.js";

const ID = "01ISSUE";
const NOW = "2099-10-02T18:00:00.000Z";
// Staleness is judged against the real clock (Date.now()), so "stale" has to be
// a date genuinely in the past, while the fixture's other dates stay in 2099.
const STALE = "2000-01-01T00:00:00.000Z";

interface SendRow {
  id: string;
  issue_id: string;
  email: string;
  unsubscribe_token: string;
  status: string;
  error: string | null;
  sent_at: string | null;
}

interface Fake {
  env: Env;
  issue: IssueRow;
  rows: SendRow[];
  fetches: string[]; // recipient emails, in attempt order
}

function issue(over: Partial<IssueRow> = {}): IssueRow {
  return {
    id: ID,
    slug: "2099-10-01-october",
    title: "October",
    subtitle: null,
    subject: "October",
    content_json: JSON.stringify({ type: "doc", content: [] }),
    events_snapshot_json: null,
    status: "sending",
    recipient_total: 0,
    sent_at: null,
    published_at: null,
    edited_at: null,
    edited_by: null,
    created_by: null,
    created_at: "2099-09-01T00:00:00.000Z",
    updated_at: NOW,
    preview_token_hash: null,
    preview_token_created_at: null,
    audit_session_at: null,
    ...over,
  };
}

function sendRows(n: number, status = "pending"): SendRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `01SEND${String(i).padStart(3, "0")}`,
    issue_id: ID,
    email: `p${i}@example.com`,
    unsubscribe_token: `tok${i}`,
    status,
    error: null,
    sent_at: null,
  }));
}

/** Resend double: decides each attempt by recipient address. */
function stubFetch(state: Fake, verdict: (email: string) => "ok" | "429" | "400" | "throw") {
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { to: string };
    state.fetches.push(body.to);
    const v = verdict(body.to);
    if (v === "throw") throw new Error("Too many subrequests by single Worker invocation.");
    if (v === "ok") return new Response("{}", { status: 200 });
    return new Response(v === "429" ? '{"name":"rate_limit_exceeded"}' : '{"name":"validation_error"}', {
      status: v === "429" ? 429 : 400,
    });
  }) as typeof fetch;
}

function fake(row: IssueRow, rows: SendRow[]): Fake {
  const state: Fake = { env: null as never, issue: row, rows, fetches: [] };

  const stmt = (sql: string) => {
    let b: unknown[] = [];
    const s = {
      bind(...args: unknown[]) {
        b = args;
        return s;
      },
      async first() {
        if (sql.includes("FROM setting")) return null;
        if (sql.includes("FROM newsletter_issue") && sql.includes("WHERE id = ?")) {
          return state.issue.id === b[0] ? { ...state.issue } : null;
        }
        if (sql.includes("FROM newsletter_issue") && sql.includes("status = 'sending'")) {
          // resumePendingSends' pickup — honour its own staleness term.
          return state.issue.status === "sending" && state.issue.updated_at < (b[0] as string)
            ? { id: state.issue.id, sent_at: state.issue.sent_at }
            : null;
        }
        if (sql.includes("COUNT(*)") && sql.includes("status = 'pending'")) {
          return { n: state.rows.filter((r) => r.issue_id === b[0] && r.status === "pending").length };
        }
        if (sql.includes("COUNT(*)") && sql.includes("status != 'sent'")) {
          return { n: state.rows.filter((r) => r.issue_id === b[0] && r.status !== "sent").length };
        }
        return null;
      },
      async all() {
        if (sql.includes("FROM newsletter_send") && sql.includes("status = 'pending'")) {
          const limit = sql.includes("LIMIT ?") ? (b[1] as number) : Number.MAX_SAFE_INTEGER;
          return {
            results: state.rows
              .filter((r) => r.issue_id === b[0] && r.status === "pending")
              .slice(0, limit)
              .map((r) => ({ id: r.id, email: r.email, unsubscribe_token: r.unsubscribe_token })),
          };
        }
        return { results: [] };
      },
      async run() {
        let changes = 0;
        if (sql.startsWith("UPDATE newsletter_send SET status = ?, error = ?")) {
          const row = state.rows.find((r) => r.id === b[3]);
          if (row) {
            row.status = b[0] as string;
            row.error = b[1] as string | null;
            row.sent_at = b[2] as string | null;
            changes = 1;
          }
        } else if (sql.includes("SET status = 'failed' WHERE issue_id = ? AND status = 'pending'")) {
          // The resumer's give-up.
          for (const r of state.rows) {
            if (r.issue_id === b[0] && r.status === "pending") {
              r.status = "failed";
              changes++;
            }
          }
        } else if (sql.includes("SET status = 'pending' WHERE issue_id = ? AND status = 'failed'")) {
          for (const r of state.rows) {
            if (r.issue_id === b[0] && r.status === "failed") {
              r.status = "pending";
              changes++;
            }
          }
        } else if (sql.includes("SET status = 'sending'")) {
          // retryFailed's claim: evaluate the guard, don't pattern-match it away.
          const stale = sql.includes("updated_at < ?") && state.issue.updated_at < (b[2] as string);
          if (state.issue.id === b[1] && (state.issue.status === "sent" || (state.issue.status === "sending" && stale))) {
            state.issue.status = "sending";
            state.issue.updated_at = b[0] as string;
            changes = 1;
          }
        } else if (sql.includes("SET status = 'sent'")) {
          if (state.issue.id === b[1]) {
            state.issue.status = "sent";
            state.issue.updated_at = b[0] as string;
            changes = 1;
          }
        } else if (sql.startsWith("UPDATE newsletter_issue SET updated_at = ?") && sql.includes("updated_at < ?")) {
          // resumePendingSends' claim.
          if (state.issue.id === b[1] && state.issue.status === "sending" && state.issue.updated_at < (b[2] as string)) {
            state.issue.updated_at = b[0] as string;
            changes = 1;
          }
        } else if (sql.startsWith("UPDATE newsletter_issue SET updated_at = ?")) {
          if (state.issue.id === b[1]) {
            state.issue.updated_at = b[0] as string;
            changes = 1;
          }
        }
        return { meta: { changes } };
      },
    };
    return s;
  };

  state.env = {
    DB: { prepare: stmt },
    RESEND_API_KEY: "test-key",
    NEWSLETTER_URL: "https://newsletter.example",
    SCHOOL_NAME: "Test School",
  } as unknown as Env;
  return state;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("runFanOut", () => {
  it("attempts at most the budget and leaves the issue 'sending' for the cron", async () => {
    const f = fake(issue(), sendRows(7));
    stubFetch(f, () => "ok");
    await runFanOut(f.env, ID, { budget: 3, paceMs: 0 });

    expect(f.fetches).toHaveLength(3);
    expect(f.rows.filter((r) => r.status === "sent")).toHaveLength(3);
    expect(f.rows.filter((r) => r.status === "pending")).toHaveLength(4);
    expect(f.issue.status).toBe("sending");
  });

  it("flips to 'sent' only when nothing is left pending", async () => {
    const f = fake(issue(), sendRows(4));
    stubFetch(f, () => "ok");
    await runFanOut(f.env, ID, { budget: 10, paceMs: 0 });

    expect(f.rows.every((r) => r.status === "sent")).toBe(true);
    expect(f.issue.status).toBe("sent");
  });

  it("keeps a 429'd row 'pending' (re-attempted later), sends a 4xx row to 'failed', and still completes", async () => {
    const f = fake(issue(), sendRows(3));
    stubFetch(f, (email) => (email === "p0@example.com" ? "429" : email === "p1@example.com" ? "400" : "ok"));
    await runFanOut(f.env, ID, { budget: 10, paceMs: 0 });

    const [rate, bad, ok] = f.rows;
    expect(rate?.status).toBe("pending");
    expect(rate?.error).toContain("429");
    expect(bad?.status).toBe("failed");
    expect(ok?.status).toBe("sent");
    // A transient row outstanding means the run must NOT close the issue out.
    expect(f.issue.status).toBe("sending");
  });

  it("treats a fetch that never got a verdict (the subrequest cap) as transient", async () => {
    const f = fake(issue(), sendRows(1));
    stubFetch(f, () => "throw");
    await runFanOut(f.env, ID, { budget: 10, paceMs: 0 });

    expect(f.rows[0]?.status).toBe("pending");
    expect(f.issue.status).toBe("sending");
  });

  it("never re-mails a row already 'sent'", async () => {
    const rows = sendRows(3);
    rows[0]!.status = "sent";
    const f = fake(issue(), rows);
    stubFetch(f, () => "ok");
    await runFanOut(f.env, ID, { budget: 10, paceMs: 0 });

    expect(f.fetches).not.toContain("p0@example.com");
    expect(f.fetches).toHaveLength(2);
  });

  it("leaves 'failed' rows alone — only the manual retry re-enters them", async () => {
    const rows = sendRows(2);
    rows[0]!.status = "failed";
    const f = fake(issue(), rows);
    stubFetch(f, () => "ok");
    await runFanOut(f.env, ID, { budget: 10, paceMs: 0 });

    expect(f.fetches).toEqual(["p1@example.com"]);
    expect(f.rows[0]?.status).toBe("failed");
    expect(f.issue.status).toBe("sent"); // nothing pending; the failure waits for a human
  });
});

describe("retryFailed", () => {
  it("claims a 'sent' issue and resets failed rows to pending", async () => {
    const rows = sendRows(3, "failed");
    rows[2]!.status = "sent";
    const f = fake(issue({ status: "sent" }), rows);

    expect(await retryFailed(f.env, ID)).toBe(true);
    expect(f.issue.status).toBe("sending");
    expect(f.rows.filter((r) => r.status === "pending")).toHaveLength(2);
    expect(f.rows[2]?.status).toBe("sent");
  });

  it("refuses while a send is live, and the failed rows stay untouched", async () => {
    const f = fake(issue({ status: "sending", updated_at: NOW }), sendRows(2, "failed"));

    expect(await retryFailed(f.env, ID)).toBe(false);
    expect(f.rows.every((r) => r.status === "failed")).toBe(true);
  });
});

describe("resumePendingSends", () => {
  it("claims a stale 'sending' issue and drains it", async () => {
    const f = fake(issue({ updated_at: STALE }), sendRows(2));
    stubFetch(f, () => "ok");
    await resumePendingSends(f.env);

    expect(f.fetches).toHaveLength(2);
    expect(f.issue.status).toBe("sent");
  });

  it("leaves a FRESH 'sending' issue alone — a live run may still be mailing it", async () => {
    const f = fake(issue({ updated_at: new Date().toISOString() }), sendRows(2));
    stubFetch(f, () => "ok");
    await resumePendingSends(f.env);

    expect(f.fetches).toHaveLength(0);
    expect(f.issue.status).toBe("sending");
  });

  it("heals a run that died after its last send by closing the issue out", async () => {
    const f = fake(issue({ updated_at: STALE }), sendRows(2, "sent"));
    stubFetch(f, () => "ok");
    await resumePendingSends(f.env);

    expect(f.fetches).toHaveLength(0);
    expect(f.issue.status).toBe("sent");
  });

  it("gives up after 24h of transient failures: pending rows go to 'failed', the issue closes out, nothing is mailed", async () => {
    // Send began in 2000 (sent_at), far past the 24h give-up; rows are still
    // pending because every pass found only transient refusals.
    const f = fake(issue({ updated_at: STALE, sent_at: "2000-01-01T00:00:00.000Z" }), sendRows(3));
    stubFetch(f, () => "ok");
    await resumePendingSends(f.env);

    expect(f.fetches).toHaveLength(0);
    expect(f.rows.every((r) => r.status === "failed")).toBe(true);
    expect(f.issue.status).toBe("sent");
  });

  it("keeps trying while the send is younger than the give-up window", async () => {
    const f = fake(issue({ updated_at: STALE, sent_at: new Date().toISOString() }), sendRows(2));
    stubFetch(f, () => "ok");
    await resumePendingSends(f.env);

    expect(f.fetches).toHaveLength(2);
    expect(f.issue.status).toBe("sent");
  });

  it("never touches a 'sent' or 'draft' issue", async () => {
    for (const status of ["sent", "draft"] as const) {
      const f = fake(issue({ status, updated_at: STALE }), sendRows(2));
      stubFetch(f, () => "ok");
      await resumePendingSends(f.env);
      expect(f.fetches).toHaveLength(0);
      expect(f.issue.status).toBe(status);
    }
  });
});

describe("the limits themselves", () => {
  it("one burst per pace window stays at or under Resend's 10/s meter", () => {
    expect((CONCURRENCY * 1000) / SEND_PACE_MS).toBeLessThanOrEqual(10);
  });

  it("the budget stays under the free plan's 50-subrequest invocation cap, with headroom", () => {
    expect(SEND_BUDGET).toBeLessThanOrEqual(45);
    expect(SEND_BUDGET).toBeGreaterThan(0);
  });

  it("the route-path first pass fits a request's ~30s waitUntil with wide margin", () => {
    expect(ROUTE_SEND_BUDGET).toBeLessThanOrEqual(SEND_BUDGET);
    const sleeps = (Math.ceil(ROUTE_SEND_BUDGET / CONCURRENCY) - 1) * SEND_PACE_MS;
    expect(sleeps).toBeLessThanOrEqual(10_000);
  });
});

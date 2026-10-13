// Bulk-import invite mailing, rebuilt after the October 2026 newsletter send
// showed what an unpaced, one-fetch-per-address fan-out does on this account
// (Resend's per-second meter plus the Workers free plan's 50-subrequest cap) —
// and bounded to the ~30-second wall a request's waitUntil actually gets.
//
// What this pins:
//
//   1. Invites go out through /emails/batch — one subrequest per INVITE_BATCH
//      messages — so a roster-sized import costs a handful of fetches, not one
//      per family.
//   2. A TRANSIENT batch refusal (429/5xx/timeout) is retried once after a
//      pause; a persistent refusal falls back to single sends for that slice
//      only, so one bad address costs its own send, not its neighbours.
//   3. An invite that never went out is WITHDRAWN (its control_invite and
//      auth_token rows deleted by token hash), because hasPendingInvite would
//      otherwise stop a re-run of the import from ever re-mailing it — the
//      silent, permanent loss the October incident was made of.
//   4. The overflow beyond the per-run batch budget is withdrawn BEFORE any
//      mailing, while the waitUntil is certain to still be alive; the fallback
//      singles are budgeted, and what the budget can't reach is withdrawn too.

import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import { sendBulkInvites } from "../src/routes/admin.js";
import type { QueuedInvite } from "../src/lib/bulkImport.js";
import { sha256 } from "../src/lib/crypto.js";

interface Fake {
  env: Env;
  batchCalls: string[][]; // recipient lists per /emails/batch call
  singleCalls: string[]; // recipients of individual /emails calls
  deletes: string[]; // "ci:<hash>" / "at:<hash>" from withdrawal statements
  order: string[]; // interleaving of "mail" and "withdraw" events
}

function invites(n: number): QueuedInvite[] {
  return Array.from({ length: n }, (_, i) => ({
    email: `fam${i}@example.com`,
    token: `token${i}`,
    personName: `Kid ${i}`,
  }));
}

function fake(): Fake {
  const state: Fake = { env: null as never, batchCalls: [], singleCalls: [], deletes: [], order: [] };
  const stmt = (sql: string) => {
    let b: unknown[] = [];
    const s = {
      bind(...args: unknown[]) {
        b = args;
        return s;
      },
      sql,
      boundHash() {
        return b[0] as string;
      },
    };
    return s;
  };
  state.env = {
    DB: {
      prepare: stmt,
      batch: async (stmts: Array<{ sql: string; boundHash(): string }>) => {
        state.order.push("withdraw");
        for (const st of stmts) {
          if (!st.sql.startsWith("DELETE FROM")) throw new Error(`unexpected write: ${st.sql}`);
          state.deletes.push(`${st.sql.includes("control_invite") ? "ci" : "at"}:${st.boundHash()}`);
        }
        return [];
      },
    },
    RESEND_API_KEY: "test-key",
    SCHOOL_NAME: "Test School",
  } as unknown as Env;
  return state;
}

/** `verdict` answers per CALL, in order, so a test can script "429 then ok". */
function stubFetch(state: Fake, verdict: (kind: "batch" | "single", to: string[], call: number) => "ok" | "422" | "429") {
  let calls = 0;
  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { to?: string } | Array<{ to: string }>;
    const kind = String(url).endsWith("/batch") ? "batch" : "single";
    const to = Array.isArray(body) ? body.map((m) => m.to) : [body.to ?? ""];
    state.order.push("mail");
    if (kind === "batch") state.batchCalls.push(to);
    else state.singleCalls.push(to[0] ?? "");
    const v = verdict(kind, to, calls++);
    if (v === "ok") return new Response("{}", { status: 200 });
    return new Response(v === "429" ? '{"name":"rate_limit_exceeded"}' : '{"name":"validation_error"}', {
      status: Number(v),
    });
  }) as typeof fetch;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("sendBulkInvites", () => {
  it("mails a roster-sized import as a handful of batch calls, never one fetch per family", async () => {
    const f = fake();
    stubFetch(f, () => "ok");
    await sendBulkInvites(f.env, "https://api.example", invites(60), { paceMs: 0 });

    expect(f.batchCalls.map((c) => c.length)).toEqual([10, 10, 10, 10, 10, 10]);
    expect(f.singleCalls).toHaveLength(0);
    expect(f.deletes).toHaveLength(0);
  });

  it("retries a transiently refused batch once instead of exploding it into singles", async () => {
    const f = fake();
    stubFetch(f, (_kind, _to, call) => (call === 0 ? "429" : "ok"));
    await sendBulkInvites(f.env, "https://api.example", invites(10), { paceMs: 0 });

    expect(f.batchCalls).toHaveLength(2); // the refused call and its retry
    expect(f.singleCalls).toHaveLength(0);
    expect(f.deletes).toHaveLength(0);
  });

  it("falls back to single sends for a persistently refused batch only, and withdraws what still fails", async () => {
    const f = fake();
    stubFetch(f, (kind, to) => {
      if (kind === "batch") return to.includes("fam1@example.com") ? "422" : "ok";
      return to[0] === "fam1@example.com" ? "422" : "ok";
    });
    // 30 invites: slice 0–9 (contains fam1) is refused; the other two sail.
    await sendBulkInvites(f.env, "https://api.example", invites(30), { paceMs: 0 });

    expect(f.batchCalls).toHaveLength(3); // a 422 is a verdict — no batch retry
    expect(f.singleCalls).toHaveLength(10); // the refused slice, one by one
    expect(f.singleCalls).not.toContain("fam10@example.com"); // healthy batches never fell back

    // Only the genuinely unmailable invite is withdrawn — both its rows, by hash.
    const hash = await sha256("token1");
    expect(f.deletes).toEqual([`ci:${hash}`, `at:${hash}`]);
  });

  it("stops single-send fallback at its budget and withdraws the rest instead of hitting the subrequest wall", async () => {
    const f = fake();
    stubFetch(f, (kind) => (kind === "batch" ? "422" : "ok"));
    // Three refused batches of 10: the 10-send budget covers the first slice;
    // the remaining 20 must be withdrawn, not attempted.
    await sendBulkInvites(f.env, "https://api.example", invites(30), { paceMs: 0 });

    expect(f.singleCalls).toHaveLength(10);
    expect(f.deletes).toHaveLength(20 * 2);
  });

  it("withdraws the overflow beyond the batch budget UP FRONT, before any mail is attempted", async () => {
    const f = fake();
    stubFetch(f, () => "ok");
    // 160 invites: 150 fit the budget (15 batches of 10); 10 overflow.
    await sendBulkInvites(f.env, "https://api.example", invites(160), { paceMs: 0 });

    expect(f.batchCalls).toHaveLength(15);
    expect(f.singleCalls).toHaveLength(0);
    expect(f.deletes).toHaveLength(10 * 2);
    expect(f.deletes).toContain(`ci:${await sha256("token159")}`);
    // The withdrawal happened while the waitUntil was certain to be alive.
    expect(f.order[0]).toBe("withdraw");
  });
});

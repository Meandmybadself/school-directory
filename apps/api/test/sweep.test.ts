// Daily housekeeping.
//
// Four tables, two kinds of problem. `auth_token` and `newsletter_confirmation`
// back rate limits that COUNT ROWS, which makes their retention a security
// control: shorter than the counting window and an attacker resets their budget
// by waiting. `session` and `control_invite` are ordinary growth, but each has
// one row it must never take — a live masquerade's parent, and a pending invite
// somebody is still waiting on.
//
// None of those couplings is visible in the file that writes the table, which is
// why they're asserted here rather than left to the reader.

import { describe, expect, it } from "vitest";
import {
  runDailySweeps,
  sweepDeadSessions,
  sweepSettledInvites,
  sweepSpentAuthTokens,
} from "../src/lib/sweep.js";
import type { Env } from "../src/env.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function captureEnv(): { env: Env; sql: string[]; binds: unknown[][] } {
  const sql: string[] = [];
  const binds: unknown[][] = [];
  const env = {
    DB: {
      prepare(text: string) {
        return {
          bind(...args: unknown[]) {
            sql.push(text);
            binds.push(args);
            return this;
          },
          async run() {
            return { meta: { changes: 3 } };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, sql, binds };
}

describe("sweepSpentAuthTokens", () => {
  it("keeps every row the rate-limit window still counts", async () => {
    const { env, binds } = captureEnv();
    await sweepSpentAuthTokens(env);
    const cutoff = new Date(String(binds[0]![0]));
    const age = Date.now() - cutoff.getTime();
    // /auth/start counts a rolling DAY. Retention has to clear that with room,
    // or waiting out the sweep becomes a way to reset the cap.
    expect(age).toBeGreaterThan(DAY_MS);
    expect(age).toBeGreaterThanOrEqual(29 * DAY_MS);
  });

  it("only removes rows that are finished with", async () => {
    const { env, sql } = captureEnv();
    await sweepSpentAuthTokens(env);
    // Age alone is not enough: an unclaimed 14-day invite must survive the age
    // test until it is actually consumed or expired.
    expect(sql[0]).toContain("consumed_at IS NOT NULL OR expires_at < ?");
    expect(sql[0]).toContain("created_at < ?");
  });

  it("never keys the age test on expires_at", async () => {
    // A magic link expires in 15 minutes. Sweeping on expiry — which is what the
    // newsletter's confirmation sweep does — would delete what the cap counts
    // almost as fast as it was written.
    const { env, sql } = captureEnv();
    await sweepSpentAuthTokens(env);
    expect(sql[0]).not.toMatch(/WHERE\s+expires_at\s*</);
  });

  it("swallows a failing sweep rather than taking the cron down with it", async () => {
    await expect(sweepSpentAuthTokens(throwingEnv())).resolves.toBeUndefined();
  });
});

function throwingEnv(): Env {
  return {
    DB: {
      prepare() {
        return { bind() { return this; }, async run() { throw new Error("D1_ERROR"); } };
      },
    },
  } as unknown as Env;
}

describe("sweepDeadSessions", () => {
  it("only removes sessions the door already refuses", async () => {
    const { env, sql } = captureEnv();
    await sweepDeadSessions(env);
    // Revoked or expired — never a live one, so this can't sign anybody out.
    expect(sql[0]).toContain("revoked_at IS NOT NULL OR expires_at < ?");
  });

  it("leaves a live masquerade's parent session alone", async () => {
    const { env, sql } = captureEnv();
    await sweepDeadSessions(env);
    // The parent of an in-flight masquerade is neither revoked nor expired, so
    // the predicate above can't match it however old the row is.
    expect(sql[0]).not.toMatch(/DELETE FROM session\s+WHERE created_at < \?\s*$/);
    expect(sql[0]).toContain("AND (");
  });
});

describe("sweepSettledInvites", () => {
  it("never removes a pending invite inside its window", async () => {
    const { env, sql } = captureEnv();
    await sweepSettledInvites(env);
    // Someone still waiting to be given control of their own listing keeps their
    // invite however old it is.
    expect(sql[0]).toContain("status != 'pending' OR expires_at < ?");
  });
});

describe("runDailySweeps", () => {
  it("runs every table, and one failure doesn't stop the rest", async () => {
    let calls = 0;
    const env = {
      DB: {
        prepare(text: string) {
          return {
            bind() { return this; },
            async run() {
              calls++;
              if (text.includes("auth_token")) throw new Error("D1_ERROR");
              return { meta: { changes: 1 } };
            },
          };
        },
      },
    } as unknown as Env;
    await expect(runDailySweeps(env)).resolves.toBeUndefined();
    expect(calls).toBe(4);
  });
});

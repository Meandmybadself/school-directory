// The auth_token sweep, and the one thing it must not do.
//
// The sweep exists because /auth/start's rate limit COUNTS rows in this table,
// which previously had no delete path at all — it grew by a row per magic link
// forever, and every sign-in attempt scanned it. But a sweep over a table a rate
// limit counts is itself a security control: retention shorter than the counting
// window would let an attacker reset their budget by waiting. That coupling is
// invisible in either file on its own, so it is asserted here.

import { describe, expect, it } from "vitest";
import { sweepSpentAuthTokens } from "../src/lib/notify.js";
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
    const env = {
      DB: {
        prepare() {
          return { bind() { return this; }, async run() { throw new Error("D1_ERROR"); } };
        },
      },
    } as unknown as Env;
    await expect(sweepSpentAuthTokens(env)).resolves.toBeUndefined();
  });
});

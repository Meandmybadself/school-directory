// Forwarding aliases (lib/emailForward.ts + the dispatch in src/email.ts):
// a routed address in the EMAIL_FORWARDS secret fans out via message.forward()
// — one unverified destination costs nobody else their copy — and never falls
// through to the lost & found intake.

import { describe, expect, it } from "vitest";
import type { HonoEnv } from "../src/env.js";
import { emailHandler } from "../src/email.js";
import { forwardsFor, parseForwards } from "../src/lib/emailForward.js";

type Bindings = HonoEnv["Bindings"];

describe("parseForwards", () => {
  it("reads the secret's map, lowercasing local parts and keeping only addresses", () => {
    const map = parseForwards('{"PTO": ["a@x.com", "b@y.com", 3, "nonsense"], "admin": ["me@z.com"], "empty": []}');
    expect(map).toEqual({ pto: ["a@x.com", "b@y.com"], admin: ["me@z.com"] });
  });

  it("treats an absent or malformed secret as no aliases, never throwing", () => {
    expect(parseForwards(undefined)).toEqual({});
    expect(parseForwards("not json")).toEqual({});
    expect(parseForwards('["a@x.com"]')).toEqual({});
  });
});

describe("forwardsFor", () => {
  const env = { EMAIL_FORWARDS: '{"pto": ["a@x.com"]}' } as Bindings;

  it("matches the envelope recipient's local part, case-insensitively", () => {
    expect(forwardsFor(env, "PTO@eisenhower.school")).toEqual(["a@x.com"]);
    expect(forwardsFor(env, "found@eisenhower.school")).toBeNull();
    expect(forwardsFor({} as Bindings, "pto@eisenhower.school")).toBeNull();
  });
});

// ── The handler's dispatch ──────────────────────────────────────────────────

function fakeMessage(to: string) {
  const forwarded: string[] = [];
  let rejected: string | null = null;
  const message = {
    from: "sender@example.com",
    to,
    headers: new Headers(),
    raw: new Response("").body,
    rawSize: 0,
    forward: async (dest: string) => {
      if (dest.includes("unverified")) throw new Error("destination address not verified");
      forwarded.push(dest);
    },
    setReject: (reason: string) => {
      rejected = reason;
    },
    reply: async () => {},
  };
  return { message, forwarded, rejected: () => rejected };
}

const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;

/** An env where any DB read means the dispatch wrongly fell through. */
const forwardOnlyEnv = (map: string) =>
  ({
    EMAIL_FORWARDS: map,
    DB: {
      prepare() {
        throw new Error("a forwarding alias reached the intake");
      },
    },
  }) as unknown as Bindings;

describe("emailHandler forwarding dispatch", () => {
  it("fans one alias out to every destination and never touches the intake", async () => {
    const { message, forwarded, rejected } = fakeMessage("pto@eisenhower.school");
    await emailHandler(
      message as never,
      forwardOnlyEnv('{"pto": ["a@x.com", "b@y.com"], "admin": ["me@z.com"]}'),
      ctx,
    );
    expect(forwarded).toEqual(["a@x.com", "b@y.com"]);
    expect(rejected()).toBeNull();
  });

  it("keeps delivering past a destination that isn't verified yet", async () => {
    const { message, forwarded, rejected } = fakeMessage("pto@eisenhower.school");
    await emailHandler(
      message as never,
      forwardOnlyEnv('{"pto": ["unverified@x.com", "b@y.com"]}'),
      ctx,
    );
    expect(forwarded).toEqual(["b@y.com"]);
    expect(rejected()).toBeNull();
  });

  it("rejects — so the sender knows — only when NO destination accepted", async () => {
    const { message, forwarded, rejected } = fakeMessage("pto@eisenhower.school");
    await emailHandler(message as never, forwardOnlyEnv('{"pto": ["unverified@x.com"]}'), ctx);
    expect(forwarded).toEqual([]);
    expect(rejected()).toContain("No deliverable destination");
  });

  it("lets a non-alias address fall through to the intake", async () => {
    // The intake's first read is the sender lookup; a stranger is rejected.
    const env = {
      EMAIL_FORWARDS: '{"pto": ["a@x.com"]}',
      DB: {
        prepare: () => ({ bind: () => ({ first: async () => null }) }),
      },
    } as unknown as Bindings;
    const { message, forwarded, rejected } = fakeMessage("found@eisenhower.school");
    await emailHandler(message as never, env, ctx);
    expect(forwarded).toEqual([]);
    expect(rejected()).toContain("lost & found");
  });
});

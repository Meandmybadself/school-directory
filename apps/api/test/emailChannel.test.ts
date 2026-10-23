// The two outbound channels (lib/email.ts): newsletter mail rides the
// Cloudflare Email Sending binding when it is configured, everything else
// stays on Resend, and the From swap keeps the admin's display name while
// replies keep landing at the old address.

import { describe, expect, it } from "vitest";
import type { HonoEnv } from "../src/env.js";
import { isTransientSendError, sendEmailResult, type SendArgs } from "../src/lib/email.js";

type Bindings = HonoEnv["Bindings"];

function fakeBinding() {
  const sent: Record<string, unknown>[] = [];
  let fail: { code: string; message: string } | null = null;
  return {
    sent,
    setFail(code: string, message = "nope") {
      fail = { code, message };
    },
    binding: {
      async send(builder: Record<string, unknown>) {
        if (fail) {
          const err = new Error(fail.message) as Error & { code: string };
          err.code = fail.code;
          throw err;
        }
        sent.push(builder);
        return { messageId: "mid" };
      },
    },
  };
}

const msg = (over: Partial<SendArgs> = {}): SendArgs => ({
  to: "reader@example.com",
  subject: "Issue #4",
  html: "<p>hi</p>",
  text: "hi",
  ...over,
});

describe("sendEmailResult channel routing", () => {
  it("sends bulk mail through the binding, swapping only the From ADDRESS", async () => {
    const { sent, binding } = fakeBinding();
    const env = { EMAIL: binding, BULK_EMAIL_FROM: "Eisenhower PTO <newsletter@eisenhower.school>" } as unknown as Bindings;
    const r = await sendEmailResult(env, msg({ bulk: true, from: "Ms. Frizzle <news@mailer.meandmybadself.com>" }));
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    // The admin's display name survives; the address is the onboarded domain's.
    expect(sent[0]!.from).toEqual({ name: "Ms. Frizzle", email: "newsletter@eisenhower.school" });
    // Replies keep going where they always did.
    expect(sent[0]!.replyTo).toBe("news@mailer.meandmybadself.com");
  });

  it("keeps an explicit replyTo and falls back to the configured name", async () => {
    const { sent, binding } = fakeBinding();
    const env = { EMAIL: binding, BULK_EMAIL_FROM: "Eisenhower PTO <newsletter@eisenhower.school>" } as unknown as Bindings;
    await sendEmailResult(env, msg({ bulk: true, replyTo: "editor@example.com" }));
    expect(sent[0]!.from).toEqual({ name: "Eisenhower PTO", email: "newsletter@eisenhower.school" });
    expect(sent[0]!.replyTo).toBe("editor@example.com");
  });

  it("never routes transactional mail through the binding", async () => {
    const { sent, binding } = fakeBinding();
    // No RESEND_API_KEY → the Resend path logs instead of fetching, so the
    // assertion that matters is that the BINDING saw nothing.
    const env = { EMAIL: binding, BULK_EMAIL_FROM: "A <a@eisenhower.school>" } as unknown as Bindings;
    const r = await sendEmailResult(env, msg());
    expect(r.ok).toBe(true);
    expect(sent).toEqual([]);
  });

  it("stays on Resend while the channel is half-configured", async () => {
    const { sent, binding } = fakeBinding();
    for (const env of [
      { EMAIL: binding }, // binding, no From — domain not onboarded yet
      { BULK_EMAIL_FROM: "A <a@eisenhower.school>" }, // From, no binding
    ]) {
      const r = await sendEmailResult(env as unknown as Bindings, msg({ bulk: true }));
      expect(r.ok).toBe(true);
    }
    expect(sent).toEqual([]);
  });

  it("surfaces a binding failure as 'E_CODE: message' for the send ledger", async () => {
    const fake = fakeBinding();
    fake.setFail("E_RATE_LIMIT_EXCEEDED", "slow down");
    const env = { EMAIL: fake.binding, BULK_EMAIL_FROM: "A <a@eisenhower.school>" } as unknown as Bindings;
    const r = await sendEmailResult(env, msg({ bulk: true }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^E_RATE_LIMIT_EXCEEDED: slow down/);
  });
});

describe("isTransientSendError knows both channels", () => {
  it("judges Cloudflare codes by the transient set", () => {
    expect(isTransientSendError("E_RATE_LIMIT_EXCEEDED: slow down")).toBe(true);
    expect(isTransientSendError("E_DAILY_LIMIT_EXCEEDED: tomorrow")).toBe(true);
    expect(isTransientSendError("E_INTERNAL_SERVER_ERROR: oops")).toBe(true);
    // Retrying an unverified sender or a suppressed recipient earns the same
    // answer forever — these must be permanent or a send loops every cron.
    expect(isTransientSendError("E_SENDER_NOT_VERIFIED: onboard the domain")).toBe(false);
    expect(isTransientSendError("E_RECIPIENT_SUPPRESSED: bounced before")).toBe(false);
    expect(isTransientSendError("E_VALIDATION_ERROR: bad address")).toBe(false);
  });

  it("still judges Resend statuses the old way", () => {
    expect(isTransientSendError("429: too many")).toBe(true);
    expect(isTransientSendError("500: boom")).toBe(true);
    expect(isTransientSendError("422: bad request")).toBe(false);
    expect(isTransientSendError("network timeout")).toBe(true);
  });
});

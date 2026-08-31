// The audit → Slack seam (invariant 22).
//
// This is the outbound twin of calendarPublic.test.ts and volunteersPublic.
// test.ts, and it asserts the same two kinds of thing they do: that the
// projection emits exactly what it means to, and that something added upstream
// LATER cannot ride along into it. The difference is what "out" means — those
// two guard a response to an anonymous reader inside the system, this one
// guards a message to a third party with retention, search and export.
//
// Four properties are load-bearing here, and each has a test that fails loudly:
//
//   1. An action with no formatter sends nothing — including an action that
//      does not exist yet, which is the case no route-pinned test can cover.
//   2. `detail` never reaches a message. The formatter type has no such field,
//      so this is a regression test for the type being weakened later.
//   3. An unlisted Person is not named (invariants 21 + 22). The fake DB below
//      deliberately honours the guard rather than assuming it, so a guard that
//      collapsed to the literal "1" would FAIL this test rather than pass it.
//   4. Nothing here ever throws, at any layer.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AuditAction } from "@sd/shared";
import type { AuditDraft, AuditMeta } from "../src/lib/audit.js";
import { notifySlackForAudit, personLabel, slackLinesOf } from "../src/lib/slackNotify.js";
import type { Env } from "../src/env.js";

const WEBHOOK = "https://hooks.slack.com/services/T000/B000/xxxxxxxx";

const META: AuditMeta = {
  actorUserId: "01ADMIN",
  masqueradingAs: null,
  ip: null,
  userAgent: null,
};

interface PersonRow {
  id: string;
  first_name: string;
  last_name: string | null;
  last_name_visibility: "full" | "initial";
  unlisted_at: string | null;
}

const PEOPLE: PersonRow[] = [
  { id: "01DANA", first_name: "Dana", last_name: "Ruiz", last_name_visibility: "full", unlisted_at: null },
  { id: "01INIT", first_name: "Sam", last_name: "Okonkwo", last_name_visibility: "initial", unlisted_at: null },
  {
    id: "01HIDDEN",
    first_name: "Jo",
    last_name: "Nguyen",
    last_name_visibility: "full",
    // Off the roster. Invariant 21 hides them from every ordinary member; the
    // Slack channel is a weaker audience still, so they must not be named here.
    unlisted_at: "2026-05-01T00:00:00.000Z",
  },
];

const USERS = [
  { id: "01ADMIN", email: "admin@eisenhower.edu" },
  { id: "01TARGET", email: "parent@eisenhower.edu" },
];

/** The enumeration guard, as it appears in a statement that actually carries
 *  one. Passing `isSystemAdmin: true` to `personListableSql` returns the
 *  literal "1" instead, which is why matching the PREDICATE — not the mere
 *  presence of a `personListableSql` call — is what proves the gate is live.
 *  test/personListable.test.ts's scan cannot tell those two apart; this can. */
const GUARD = /unlisted_at IS NULL/;

/** A D1 stand-in that answers only the statements this seam issues, and throws
 *  on anything else — same "narrow on purpose" idea as the fakes in
 *  newsletterSubscribe.test.ts and auditChain.test.ts.
 *
 *  It HONOURS the unlisted guard rather than assuming it: an unlisted row comes
 *  back when the SQL has no guard, so a regression that removed one is visible
 *  as a leaked name rather than hidden behind a cooperative fake. */
function fakeDb(): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              if (sql.includes("FROM person")) {
                const row = PEOPLE.find((p) => p.id === binds[0]);
                if (!row) return null;
                if (row.unlisted_at !== null && GUARD.test(sql)) return null;
                return row as unknown as T;
              }
              if (sql.includes("FROM calendar_source")) {
                return (binds[0] === "01SRC" ? { name: "District Athletics" } : null) as T | null;
              }
              if (sql.includes("FROM newsletter_issue")) {
                return (binds[0] === "01ISSUE"
                  ? { title: "October Update", slug: "october-update" }
                  : null) as T | null;
              }
              throw new Error(`fakeDb: unhandled first(): ${sql}`);
            },
            async all<T>(): Promise<{ results: T[] }> {
              if (sql.includes("FROM user")) {
                return { results: USERS.filter((u) => binds.includes(u.id)) as unknown as T[] };
              }
              throw new Error(`fakeDb: unhandled all(): ${sql}`);
            },
            async run() {
              throw new Error(`fakeDb: unexpected write: ${sql}`);
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function testEnv(webhook?: string): Env {
  return {
    DB: fakeDb(),
    SCHOOL_NAME: "Eisenhower PTO",
    APP_URL: "https://directory.eisenhower.school",
    ALLOWED_ORIGINS: "https://directory.eisenhower.school",
    CALENDAR_URL: "https://calendar.eisenhower.school",
    NEWSLETTER_URL: "https://newsletter.eisenhower.school",
    SLACK_WEBHOOK_URL: webhook,
  } as unknown as Env;
}

/** Every request Slack received. */
let posted: { url: string; text: string }[] = [];

beforeEach(() => {
  posted = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (String(url).includes("hooks.slack.com")) {
      posted.push({ url: String(url), text: JSON.parse(String(init.body)).text });
      return new Response("ok", { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
});

afterEach(() => vi.unstubAllGlobals());

const lines = (drafts: AuditDraft[], env = testEnv(WEBHOOK), meta = META) =>
  slackLinesOf(env, drafts, meta);

describe("the allowlist is closed by construction", () => {
  it("says nothing about an action that does not exist yet", async () => {
    // The case no route-pinned test can reach: a future AuditAction. A design
    // that denylisted noisy actions instead of allowlisting quiet ones would
    // start posting this the day it was added. See CLAUDE.md invariant 22.
    const future = { action: "something.invented.later" as AuditAction, entityId: "01X" };
    expect(await lines([future])).toEqual([]);
  });

  it("says nothing about an action that names an Object.prototype key", async () => {
    // `action in FORMATTERS` would be TRUE for these — `in` walks the prototype
    // chain — and `FORMATTERS.toString` called as a formatter returns the
    // truthy "[object Object]", which would post. Nothing can push these today
    // (the field is typed `AuditAction`), but the allowlist's promise is about
    // any string or it is not worth making.
    for (const action of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
      expect(await lines([{ action: action as AuditAction }])).toEqual([]);
    }
  });

  it("says nothing about the real actions deliberately left off", async () => {
    // Pinned so that adding one of these to FORMATTERS is a visible diff in
    // this file rather than a quiet flood in someone's channel.
    const excluded: AuditAction[] = [
      "auth.signin",
      "auth.signout",
      "person.updated",
      "contact.updated",
      "share.created",
      "newsletter.issue.updated", // fires on every autosave
      "calendar.event.created",
      "volunteer.position.created",
    ];
    for (const action of excluded) {
      expect(await lines([{ action, entityId: "01X" }])).toEqual([]);
    }
  });

  it("posts nothing at all when a request's drafts are all uncurated", async () => {
    await notifySlackForAudit(testEnv(WEBHOOK), [{ action: "auth.signin" }], META);
    expect(posted).toEqual([]);
  });

  it("declines an admin.action whose op is not one of the four", async () => {
    const draft: AuditDraft = {
      action: "admin.action",
      entityId: "01G",
      notify: { op: "group.create", email: "admin@eisenhower.edu" },
    };
    expect(await lines([draft])).toEqual([]);
  });
});

describe("`detail` cannot reach a message", () => {
  it("never emits the calendar feed URL, which may be a secret subscribe link", async () => {
    // The case that shaped the formatter's input type. routes/admin.ts puts the
    // feed's `url` in `detail`, and invariant 12 says an admin may have pasted a
    // secret Google/Outlook link there. The name is read back off the row.
    const secret = "https://calendar.google.com/private/abc123-secret-token/basic.ics";
    const [line] = await lines([
      {
        action: "calendar.source.created",
        entityKind: "calendar_source",
        entityId: "01SRC",
        detail: { url: secret },
      },
    ]);
    expect(line).toContain("District Athletics");
    expect(line).not.toContain("abc123-secret-token");
    expect(line).not.toContain("calendar.google.com");
  });

  it("falls back to (unknown) rather than to `detail` when notify is absent", async () => {
    // Proves there is no fallback path from `notify` to `detail`: a formatter
    // starved of its bag says nothing useful rather than reaching for the blob.
    const [line] = await lines([
      {
        action: "calendar.source.deleted",
        entityId: "01GONE",
        detail: { url: "https://outlook.office365.com/owa/calendar/secret-token/reachcalendar.ics" },
      },
    ]);
    expect(line).toContain("(unknown)");
    expect(line).not.toContain("secret-token");
  });
});

describe("an unlisted Person is not named", () => {
  it("renders the generic form for someone off the roster", async () => {
    // A guard that collapsed to the literal "1" would return the row here and
    // this would read "Jo Nguyen". That is the exact regression it catches.
    expect(await personLabel(testEnv(), "01HIDDEN")).toBe("A member");
  });

  it("names a listed Person normally", async () => {
    expect(await personLabel(testEnv(), "01DANA")).toBe("Dana Ruiz");
  });

  it("still honours last_name_visibility for a listed Person", async () => {
    // Being read from Slack grants none of a Controller's extra trust.
    expect(await personLabel(testEnv(), "01INIT")).toBe("Sam O.");
  });

  it("says the same thing for a withheld Person and one who does not exist", async () => {
    // Telling those apart would make the channel an oracle for the flag.
    expect(await personLabel(testEnv(), "01NOSUCH")).toBe("A member");
  });

  it("redacts the name in a volunteer line but still reports the count", async () => {
    const [line] = await lines([
      {
        action: "volunteer.signup.created",
        entityId: "01POS",
        notify: {
          personId: "01HIDDEN",
          sheetSlug: "fall-festival",
          positionTitle: "Setup Crew",
          eventTitle: "Fall Festival",
          filled: 3,
          slots: 4,
        },
      },
    ]);
    expect(line).toContain("A member");
    expect(line).not.toContain("Nguyen");
    // The spot still reads as taken — the same reasoning `positionsOf` uses for
    // `filled` (invariant 13): a count that shrank with the name would
    // advertise a covered shift as needing help.
    expect(line).toContain("3/4");
  });
});

describe("message content", () => {
  it("names the person, position, event and count, and links the sheet", async () => {
    const [line] = await lines([
      {
        action: "volunteer.signup.created",
        entityId: "01POS",
        notify: {
          personId: "01DANA",
          sheetSlug: "fall-festival",
          positionTitle: "Setup Crew",
          eventTitle: "Fall Festival",
          filled: 1,
          slots: 4,
        },
      },
    ]);
    expect(line).toContain("Dana Ruiz");
    expect(line).toContain("Setup Crew");
    expect(line).toContain("Fall Festival");
    expect(line).toContain("1/4");
    expect(line).toContain("https://calendar.eisenhower.school/v/fall-festival");
  });

  it("reads a newsletter's title back off the row it was sent from", async () => {
    const [line] = await lines([
      {
        action: "newsletter.issue.sent",
        entityId: "01ISSUE",
        notify: { recipientTotal: 214 },
      },
    ]);
    expect(line).toContain("October Update");
    expect(line).toContain("214 subscribers");
    expect(line).toContain("https://newsletter.eisenhower.school/n/october-update");
    expect(line).toContain("admin@eisenhower.edu");
  });

  it("attributes to the real admin during a masquerade, not the person acted as", async () => {
    // Matches the audit log's own convention: the human who acted is the actor,
    // and the impersonated account is recorded beside them.
    const [line] = await lines(
      [{ action: "registration.toggled", notify: { open: true } }],
      testEnv(WEBHOOK),
      { ...META, masqueradingAs: "01TARGET" },
    );
    expect(line).toContain("admin@eisenhower.edu (as parent@eisenhower.edu)");
  });

  it("escapes member-entered text so it cannot forge a Slack link", async () => {
    const [line] = await lines([
      {
        action: "volunteer.signup.created",
        entityId: "01POS",
        notify: {
          personId: "01DANA",
          sheetSlug: "x",
          positionTitle: "<https://evil.example|Click here>",
          eventTitle: "Bake Sale & Raffle",
          filled: 1,
          slots: 2,
        },
      },
    ]);
    expect(line).toContain("&lt;https://evil.example|Click here&gt;");
    expect(line).toContain("Bake Sale &amp; Raffle");
  });
});

describe("delivery", () => {
  it("coalesces one request's drafts into a single post", async () => {
    // c.var.audit is already the batch; two curated drafts from one handler are
    // one event to a reader, not two notifications.
    await notifySlackForAudit(
      testEnv(WEBHOOK),
      [
        { action: "registration.toggled", notify: { open: false } },
        { action: "admin.action", entityId: "01T", notify: { op: "user.admin.granted", email: "new@eisenhower.edu" } },
      ],
      META,
    );
    expect(posted).toHaveLength(1);
    expect(posted[0]!.text).toContain("Registration *closed*");
    expect(posted[0]!.text).toContain("new@eisenhower.edu");
    expect(posted[0]!.text.split("\n")).toHaveLength(2);
  });

  it("posts a single line without bullet decoration", async () => {
    await notifySlackForAudit(testEnv(WEBHOOK), [{ action: "registration.toggled", notify: { open: true } }], META);
    expect(posted[0]!.text.startsWith("•")).toBe(false);
  });

  it("logs instead of posting when no webhook is configured", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await notifySlackForAudit(testEnv(undefined), [{ action: "registration.toggled", notify: { open: true } }], META);
    expect(posted).toEqual([]);
    expect(log.mock.calls.flat().join(" ")).toContain("[slack:dev]");
    log.mockRestore();
  });
});

describe("nothing here ever throws", () => {
  it("survives Slack rejecting the post", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => new Response("no_service", { status: 404 }));
    await expect(
      notifySlackForAudit(testEnv(WEBHOOK), [{ action: "registration.toggled", notify: { open: true } }], META),
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("survives the network failing outright", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => {
      throw new Error("connection reset");
    });
    await expect(
      notifySlackForAudit(testEnv(WEBHOOK), [{ action: "registration.toggled", notify: { open: true } }], META),
    ).resolves.toBeUndefined();
    err.mockRestore();
  });

  it("survives a formatter whose lookup fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = {
      ...testEnv(WEBHOOK),
      DB: {
        prepare() {
          return {
            bind() {
              return {
                first: async () => {
                  throw new Error("D1_ERROR");
                },
                all: async () => {
                  throw new Error("D1_ERROR");
                },
              };
            },
          };
        },
      },
    } as unknown as Env;
    await expect(
      notifySlackForAudit(env, [{ action: "newsletter.issue.sent", entityId: "01ISSUE", notify: {} }], META),
    ).resolves.toBeUndefined();
    expect(posted).toEqual([]);
    err.mockRestore();
  });

  it("never posts the webhook URL into a log line", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => new Response("bad", { status: 500 }));
    await notifySlackForAudit(testEnv(WEBHOOK), [{ action: "registration.toggled", notify: { open: true } }], META);
    // The URL is a bearer capability to post into the channel; it is treated
    // exactly like RESEND_API_KEY and never echoed, not even on failure.
    expect(err.mock.calls.flat().join(" ")).not.toContain("xxxxxxxx");
    err.mockRestore();
  });
});

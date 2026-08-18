// The public/private seam for newsletter issue pages — the companion to
// calendarPublic.test.ts and volunteersPublic.test.ts, written for the same
// reason: to fail loudly when someone widens what an issue page carries and the
// new field reaches a reader who was never meant to see it.
//
// This seam guards two distinct things.
//
//   The obvious one: `issuePageOf` is fed a row straight out of
//   `newsletter_issue`, a table that now holds `preview_token_hash` — the hash
//   of a live capability URL. A spread instead of a field-by-field projection
//   would publish it on an ENUMERABLE public page.
//
//   The subtler one: an issue page is reachable two ways, by public slug and by
//   review token, and only the first is gated on `status = 'sent'`. The tests
//   below pin both — that a draft slug still 404s on the public route, and that
//   the token route answers without a session — because "is gated" is expressed
//   by a WHERE clause in one query and its ABSENCE in the other, and absence is
//   what a diff is worst at showing.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { CalendarEventDTO, NewsletterBrandingDTO } from "@sd/shared";
import { NEWSLETTER_WEB_CSS, renderNewsletterIssuePageHtml } from "@sd/shared";
import { issuePageOf, type IssuePageRow } from "../src/lib/newsletter.js";
import { newsletterPublic } from "../src/routes/newsletterPublic.js";
import type { HonoEnv } from "../src/env.js";
import { UnauthorizedError } from "../src/middleware/session.js";
import { sha256 } from "../src/lib/crypto.js";

/** Every key a reader of an issue page may see. Changing this list is a
 *  deliberate act — if a test failure sent you here, confirm the new field is
 *  safe for a logged-out stranger before adding it. */
const PAGE_KEYS = [
  "slug",
  "title",
  "subtitle",
  "status",
  "sentAt",
  "updatedAt",
  "excerpt",
  "content",
  "eventsSnapshot",
  "branding",
].sort();

const EVENT: CalendarEventDTO = {
  id: "01EVENT",
  kind: "managed",
  seriesId: "01SERIES",
  recurrenceId: "2099-09-10T18:00:00.000Z",
  title: "General Meeting",
  location: "Media Center",
  description: null,
  start: "2099-09-10T18:00:00.000Z",
  end: null,
  allDay: false,
  sourceIds: ["01MC"],
  source: { name: "PTO events", color: "#0068A8" },
  volunteerSlug: null,
};

const BRANDING: NewsletterBrandingDTO = {
  newsletterTitle: "Eisenhower PTO Newsletter",
  accentColor: "#0068A8",
  logoUrl: null,
  footerHtml: "<p>Because you're part of the community.</p>",
  calendarUrl: "https://calendar.eisenhower.school",
};

const DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello families." }] }],
};

function row(over: Partial<IssuePageRow> = {}): IssuePageRow {
  return {
    slug: "2099-09-01-back-to-school",
    title: "Back to school",
    subtitle: "What to expect",
    status: "sent",
    sent_at: "2099-09-01T12:00:00.000Z",
    updated_at: "2099-08-30T12:00:00.000Z",
    content_json: JSON.stringify(DOC),
    events_snapshot_json: JSON.stringify({ blk: [EVENT] }),
    ...over,
  };
}

/** `issuePageOf` only touches the DB when a row has no frozen snapshot; every
 *  case here supplies one, so the env is never read. */
const NO_ENV = {} as HonoEnv["Bindings"];

describe("issuePageOf — the issue-page projection", () => {
  it("emits exactly the agreed key set, and nothing off the row", async () => {
    const page = await issuePageOf(NO_ENV, row(), BRANDING);
    expect(Object.keys(page).sort()).toEqual(PAGE_KEYS);
  });

  it("cannot leak a column added to newsletter_issue", async () => {
    // The row a route hands over may carry more than the projection names —
    // preview_token_hash is the live example, and it is the hash of a working
    // capability URL.
    const wide = {
      ...row(),
      preview_token_hash: "d34db33f",
      preview_token_created_at: "2099-08-30T12:00:00.000Z",
      created_by: "01USER",
      subject: "Back to school",
    } as unknown as IssuePageRow;

    const page = await issuePageOf(NO_ENV, wide, BRANDING);
    expect(Object.keys(page).sort()).toEqual(PAGE_KEYS);
    expect(JSON.stringify(page)).not.toContain("d34db33f");
    expect(JSON.stringify(page)).not.toContain("01USER");
  });

  it("narrows events, withholding the durable handle a signup keys on", async () => {
    const page = await issuePageOf(NO_ENV, row(), BRANDING);
    const event = page.eventsSnapshot.blk?.[0];
    expect(event).toBeDefined();
    expect(event).not.toHaveProperty("seriesId");
    expect(event).not.toHaveProperty("recurrenceId");
    // Present in the source, absent from the response — proving the narrowing
    // ran rather than the fixture simply lacking them.
    expect(EVENT.seriesId).toBe("01SERIES");
    expect(JSON.stringify(page)).not.toContain("01SERIES");
  });

  it("withholds the slug of an issue that hasn't been sent", async () => {
    // That slug names a page which 404s. Handing it to a reviewer invites them
    // to circulate the wrong URL.
    const page = await issuePageOf(
      NO_ENV,
      row({ status: "draft", sent_at: null, events_snapshot_json: null }) ,
      BRANDING,
    );
    expect(page.slug).toBeNull();
    expect(page.status).toBe("draft");
    expect(page.sentAt).toBeNull();
  });

  it("still reports the slug of a sent one", async () => {
    const page = await issuePageOf(NO_ENV, row(), BRANDING);
    expect(page.slug).toBe("2099-09-01-back-to-school");
  });

  it("survives a corrupt stored snapshot rather than throwing", async () => {
    const page = await issuePageOf(NO_ENV, row({ events_snapshot_json: "{oh no" }), BRANDING);
    expect(page.eventsSnapshot).toEqual({});
  });
});

// ── The rendered page ───────────────────────────────────────────────────────

function render(over: Partial<Parameters<typeof renderNewsletterIssuePageHtml>[0]> = {}) {
  return renderNewsletterIssuePageHtml({
    branding: BRANDING,
    title: "Back to school",
    subtitle: null,
    doc: DOC,
    resolveEvents: () => [],
    dateLabel: "September 1, 2099",
    isDraft: false,
    archiveHref: "/",
    printHref: "/n/x/print",
    ...over,
  });
}

describe("the issue page renderer", () => {
  it("says so, loudly, when the issue has not been sent", () => {
    expect(render({ isDraft: true })).toContain("nl-draft-banner");
    expect(render({ isDraft: false })).not.toContain("nl-draft-banner");
  });

  it("omits the archive link when there is no archive entry to return to", () => {
    // A review link reaches an issue whose /n/ page may not exist.
    const html = render({ archiveHref: "", printHref: "" });
    expect(html).not.toContain("See all issues");
    expect(html).toContain("Back to school");
  });

  it("does not link a print view to itself", () => {
    expect(render({ printHref: "" })).not.toContain("View as PDF");
    expect(render()).toContain("View as PDF");
  });

  it("escapes the title rather than trusting it", () => {
    const html = render({ title: '<script>alert(1)</script>' });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("the print stylesheet", () => {
  it("ships inside the one stylesheet, so any Ctrl+P comes out clean", () => {
    expect(NEWSLETTER_WEB_CSS).toContain("@media print");
    // Site chrome and the affordance itself are meaningless on paper.
    expect(NEWSLETTER_WEB_CSS).toMatch(/@media print\{[\s\S]*\.nl-site-foot/);
    expect(NEWSLETTER_WEB_CSS).toMatch(/@media print\{[\s\S]*\.nl-print-link/);
  });

  it("keeps the draft banner in ink — that is when it matters most", () => {
    const printBlock = NEWSLETTER_WEB_CSS.slice(NEWSLETTER_WEB_CSS.indexOf("@media print"));
    expect(printBlock).not.toContain("nl-draft-banner");
  });
});

// ── The two routes that reach a page ────────────────────────────────────────

/** D1 stand-in. `sent` resolves by slug; `draft` resolves only by token hash.
 *
 *  The hash is computed with the real `sha256`, not hard-coded: the route hashes
 *  the token before looking it up, and a fixture that hard-coded a digest would
 *  keep passing if that hashing were ever dropped — which is the one thing here
 *  worth catching. */
function testEnv(goodHash: string): HonoEnv["Bindings"] {
  const sent = row();
  const draft = row({
    slug: "2099-10-01-october",
    title: "October news",
    status: "draft",
    sent_at: null,
    events_snapshot_json: null,
  });

  return {
    // getNewsletterSettings falls back to defaults built from these when the
    // `setting` row is absent, which is what the stub below reports.
    SCHOOL_NAME: "Eisenhower PTO",
    NEWSLETTER_URL: "https://newsletter.eisenhower.school",
    CALENDAR_URL: "https://calendar.eisenhower.school",
    SCHOOL_TIMEZONE: "America/Chicago",
    DB: {
      prepare(sql: string) {
        return {
          bind: (arg: string) => ({
            first: async () => {
              if (sql.includes("preview_token_hash = ?")) {
                // Only the hash of the token "good" resolves. The value is
                // sha256("good"); anything else misses, as a revoked or
                // guessed token would.
                return arg === goodHash ? draft : null;
              }
              // The public slug route, gated on status='sent' in its own SQL.
              if (sql.includes("status = 'sent'")) {
                return arg === sent.slug ? sent : null;
              }
              return null;
            },
          }),
        };
      },
    },
  } as unknown as HonoEnv["Bindings"];
}

function appWith(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.route("/newsletter-public", newsletterPublic);
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) return c.json({ error: "unauthorized" }, 401);
    throw err;
  });
  return app;
}

describe("issue pages answer without a session", () => {
  const envFor = async () => testEnv(await sha256("good"));

  it("serves a sent issue by its public slug", async () => {
    const res = await appWith().request(
      "/newsletter-public/issues/2099-09-01-back-to-school",
      {},
      await envFor(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(PAGE_KEYS);
  });

  it("404s a slug that names an unsent issue — the gate this feature never touched", async () => {
    const res = await appWith().request(
      "/newsletter-public/issues/2099-10-01-october",
      {},
      await envFor(),
    );
    expect(res.status).toBe(404);
  });

  it("serves that same unsent issue to whoever holds its review token", async () => {
    const res = await appWith().request("/newsletter-public/preview/good", {}, await envFor());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // The reviewer sees the real thing, marked as not yet sent — and gets
    // exactly the same key set a public reader eventually will, no more.
    expect(Object.keys(body).sort()).toEqual(PAGE_KEYS);
    expect(body.title).toBe("October news");
    expect(body.status).toBe("draft");
    expect(body.slug).toBeNull();
  });

  it("404s an unknown review token, exactly as a revoked one now does", async () => {
    const res = await appWith().request("/newsletter-public/preview/nope", {}, await envFor());
    expect(res.status).toBe(404);
  });
});

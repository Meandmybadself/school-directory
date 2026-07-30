// Public newsletter surface — no authentication, by design.
//
// Same trust posture as routes/ics.ts, and the same warning applies with more
// force: NOTHING member-specific may ever be added to these responses. The
// archive is deliberately addressed by a human-readable dated slug, so issues
// are enumerable and crawlable. That is the point — a newsletter link has to
// open from an inbox, a text message or a Facebook group with no sign-in — but
// it means an issue's body must never contain member-private content.
//
// Only issues that have actually been sent are visible; a draft's slug resolves
// to a 404, so guessing tomorrow's URL reveals nothing.

import { Hono } from "hono";
import type {
  NewsletterNode,
  PublicNewsletterIssueSummaryDTO,
} from "@sd/shared";
import { newsletterExcerpt } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { nowIso } from "../lib/time.js";
import { normalizeEmail } from "../lib/db.js";
import { ulid } from "../lib/ids.js";
import { brandingOf, getNewsletterSettings, isEmail } from "../lib/newsletter.js";

export const newsletterPublic = new Hono<HonoEnv>();

const ARCHIVE_PAGE_SIZE = 50;

interface PublicRow {
  slug: string;
  title: string;
  subtitle: string | null;
  content_json: string;
  events_snapshot_json: string | null;
  sent_at: string;
}

function parseDoc(json: string): NewsletterNode {
  try {
    return JSON.parse(json) as NewsletterNode;
  } catch {
    return { type: "doc", content: [] };
  }
}

function summaryOf(row: PublicRow): PublicNewsletterIssueSummaryDTO {
  return {
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    sentAt: row.sent_at,
    excerpt: newsletterExcerpt(parseDoc(row.content_json)),
  };
}

/** GET /newsletter-public/issues?limit= — sent issues, newest first. Also backs
 *  the "latest issue" card on the directory's Home screen, which is why it
 *  takes a limit rather than always returning the whole archive. */
newsletterPublic.get("/issues", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || ARCHIVE_PAGE_SIZE, 1), ARCHIVE_PAGE_SIZE);
  const rows = await c.env.DB.prepare(
    `SELECT slug, title, subtitle, content_json, events_snapshot_json, sent_at
       FROM newsletter_issue
      WHERE status = 'sent' AND sent_at IS NOT NULL
      ORDER BY sent_at DESC
      LIMIT ?`,
  )
    .bind(limit)
    .all<PublicRow>();

  const settings = await getNewsletterSettings(c.env);
  return c.json({
    issues: rows.results.map(summaryOf),
    branding: brandingOf(settings),
  });
});

/** GET /newsletter-public/issues/:slug — one sent issue.
 *
 *  Returns the stored document and the frozen events snapshot rather than
 *  pre-rendered HTML: the page runs the same @sd/shared renderer the email did,
 *  over the same inputs, so the archive can't drift from what was mailed. */
newsletterPublic.get("/issues/:slug", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT slug, title, subtitle, content_json, events_snapshot_json, sent_at
       FROM newsletter_issue
      WHERE slug = ? AND status = 'sent' AND sent_at IS NOT NULL`,
  )
    .bind(c.req.param("slug"))
    .first<PublicRow>();
  if (!row) return c.json({ error: "not_found" }, 404);

  const settings = await getNewsletterSettings(c.env);
  return c.json({
    ...summaryOf(row),
    content: parseDoc(row.content_json),
    eventsSnapshot: row.events_snapshot_json ? JSON.parse(row.events_snapshot_json) : {},
    branding: brandingOf(settings),
  });
});

/** POST /newsletter-public/subscribe { email } — self-serve sign-up.
 *
 *  Always answers `{ ok: true }` regardless of what happened, matching
 *  /auth/start: whether an address is already on the list is not something an
 *  anonymous caller gets to learn. This is single opt-in — someone can add an
 *  address they don't own — which is acceptable for a small school community
 *  where every send carries an unsubscribe link and admins can see the list.
 *  If it is ever abused, the fix is a confirmation link through the existing
 *  auth_token machinery. */
newsletterPublic.post("/subscribe", async (c) => {
  const body = await c.req.json<{ email: string }>().catch(() => null);
  const email = normalizeEmail(String(body?.email ?? ""));
  if (!isEmail(email)) return c.json({ ok: true });

  await c.env.DB.prepare(
    `INSERT INTO newsletter_subscriber (id, email, created_at, unsubscribed_at)
     VALUES (?,?,?,NULL)
     ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL`,
  )
    .bind(ulid(), email, nowIso())
    .run()
    .catch((err: unknown) => {
      console.error(`[newsletter] subscribe failed: ${String(err)}`);
    });

  return c.json({ ok: true });
});

/** GET /newsletter-public/unsubscribe/:token — who the token belongs to.
 *
 *  Read-only on purpose. Mail scanners and link-preview crawlers follow GET
 *  links in email; if this endpoint unsubscribed people, a corporate spam filter
 *  would quietly opt out half the school. The confirm page uses it to show whose
 *  address is about to be removed, and the removal itself is the POST below. */
newsletterPublic.get("/unsubscribe/:token", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT email FROM newsletter_send WHERE unsubscribe_token = ?",
  )
    .bind(c.req.param("token"))
    .first<{ email: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ email: row.email });
});

/** POST /newsletter-public/unsubscribe/:token — stop sending to this address.
 *
 *  Clears the preference on BOTH sides — the member's own opt-out flag and any
 *  standalone subscriber row — because an address can be on the list twice and a
 *  reader who clicks unsubscribe means all of it. */
newsletterPublic.post("/unsubscribe/:token", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT email FROM newsletter_send WHERE unsubscribe_token = ?",
  )
    .bind(c.req.param("token"))
    .first<{ email: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);

  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE user SET newsletter_opt_out_at = ? WHERE email = ? AND newsletter_opt_out_at IS NULL",
    ).bind(now, row.email),
    c.env.DB.prepare(
      "UPDATE newsletter_subscriber SET unsubscribed_at = ? WHERE email = ? AND unsubscribed_at IS NULL",
    ).bind(now, row.email),
  ]);

  return c.json({ ok: true, email: row.email });
});

// Newsletter authoring — system admins only. Mounted at /newsletter.
//
// Every handler opens with the repo's standard admin gate rather than a
// middleware, matching routes/admin.ts and routes/managedCalendar.ts.
//
// The one rule that shapes this file: an issue is mutable only while it is a
// draft. Once a send begins, its content and its frozen events snapshot are
// what went out to real inboxes and what the permanent public archive shows, so
// writes are refused with a 409 rather than quietly rewriting history.

import { Hono } from "hono";
import type {
  NewsletterIssueDTO,
  NewsletterIssueInput,
  NewsletterIssueSummaryDTO,
  NewsletterNode,
  NewsletterSubscriberDTO,
  NewsletterSubscriberImportResultDTO,
  NewsletterTestSendBody,
} from "@sd/shared";
import { issueSlug, sanitizeNewsletterDoc, slugifyTitle } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { ulid } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { normalizeEmail } from "../lib/db.js";
import { sendEmailResult } from "../lib/email.js";
import { startSubscriberDigestWindow } from "../lib/notify.js";
import {
  coerceNewsletterSettings,
  getNewsletterSettings,
  importSubscribers,
  isEmail,
  issueEmailArgs,
  parseSubscriberList,
  resolveAudience,
  resolveEventsSnapshot,
  setNewsletterSettings,
  uniqueSlug,
} from "../lib/newsletter.js";
import {
  recipientCounts,
  retryFailed,
  runFanOut,
  startSend,
  type IssueRow,
} from "../lib/newsletterSend.js";

export const newsletter = new Hono<HonoEnv>();

/** Uploaded images have to be fetchable by an email client, so this is capped
 *  higher than a profile photo but still bounded. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Test sends are for proofreading, not for distribution. */
const MAX_TEST_RECIPIENTS = 10;

/** Upper bound on a single import. A list this large is almost certainly a
 *  mistake (or belongs in the member CSV pipeline); it also bounds the work one
 *  request does. */
const MAX_IMPORT_SUBSCRIBERS = 5000;

function summaryOf(row: IssueRow): NewsletterIssueSummaryDTO {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    status: row.status as NewsletterIssueSummaryDTO["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    recipientTotal: row.recipient_total,
  };
}

function parseContent(json: string): NewsletterNode {
  try {
    return JSON.parse(json) as NewsletterNode;
  } catch {
    return { type: "doc", content: [] };
  }
}

async function detailOf(
  env: HonoEnv["Bindings"],
  row: IssueRow,
): Promise<NewsletterIssueDTO> {
  return {
    ...summaryOf(row),
    subject: row.subject,
    content: parseContent(row.content_json),
    eventsSnapshot: row.events_snapshot_json
      ? (JSON.parse(row.events_snapshot_json) as NewsletterIssueDTO["eventsSnapshot"])
      : null,
    // Counting is only meaningful once recipients exist; skip the query for drafts.
    recipientCounts: row.status === "draft" ? null : await recipientCounts(env, row.id),
  };
}

// ── Issues ──────────────────────────────────────────────────────────────────

/** GET /newsletter/issues — every issue, newest first. */
newsletter.get("/issues", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const rows = await c.env.DB.prepare(
    "SELECT * FROM newsletter_issue ORDER BY created_at DESC LIMIT 200",
  ).all<IssueRow>();
  return c.json({ issues: rows.results.map(summaryOf) });
});

/** POST /newsletter/issues — create a draft. */
newsletter.post("/issues", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<NewsletterIssueInput>().catch(() => null);
  const title = body?.title?.trim();
  if (!body || !title) return c.json({ error: "invalid_body" }, 400);

  const content = sanitizeNewsletterDoc(body.content) ?? { type: "doc", content: [] };
  const now = nowIso();
  const requested = body.slug?.trim() ? slugifyTitle(body.slug) : issueSlug(title, now);
  const slug = await uniqueSlug(c.env, requested || issueSlug(title, now));
  const id = ulid();

  await c.env.DB.prepare(
    `INSERT INTO newsletter_issue
       (id, slug, title, subtitle, subject, content_json, status, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?, 'draft', ?,?,?)`,
  )
    .bind(
      id,
      slug,
      title,
      body.subtitle?.trim() || null,
      body.subject?.trim() || title,
      JSON.stringify(content),
      auth.userId,
      now,
      now,
    )
    .run();

  c.var.audit.push({
    action: "newsletter.issue.created",
    entityKind: "newsletter_issue",
    entityId: id,
    detail: { title, slug },
  });

  const row = await c.env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
    .bind(id)
    .first<IssueRow>();
  return c.json({ issue: await detailOf(c.env, row!) }, 201);
});

/** GET /newsletter/issues/:id — one issue, with live delivery counts. */
newsletter.get("/issues/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const row = await c.env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
    .bind(c.req.param("id"))
    .first<IssueRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ issue: await detailOf(c.env, row) });
});

/** PATCH /newsletter/issues/:id — edit a draft. 409 once it has been sent. */
newsletter.patch("/issues/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
    .bind(id)
    .first<IssueRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "draft") {
    return c.json({ error: "not_draft", message: "A sent issue can't be edited." }, 409);
  }

  const body = await c.req.json<Partial<NewsletterIssueInput>>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  const title = body.title !== undefined ? body.title.trim() : row.title;
  if (!title) return c.json({ error: "invalid_body" }, 400);

  // Sanitize at write time with the same allowlist the renderer enforces at read
  // time, so a hand-crafted document that skipped the editor can't be stored.
  const content =
    body.content !== undefined
      ? (sanitizeNewsletterDoc(body.content) ?? { type: "doc", content: [] })
      : parseContent(row.content_json);

  let slug = row.slug;
  if (body.slug !== undefined) {
    const requested = slugifyTitle(body.slug);
    if (requested && requested !== row.slug) slug = await uniqueSlug(c.env, requested, id);
  }

  await c.env.DB.prepare(
    `UPDATE newsletter_issue
        SET title = ?, subtitle = ?, subject = ?, slug = ?, content_json = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      title,
      body.subtitle !== undefined ? (body.subtitle?.trim() || null) : row.subtitle,
      body.subject !== undefined ? (body.subject.trim() || title) : row.subject,
      slug,
      JSON.stringify(content),
      nowIso(),
      id,
    )
    .run();

  c.var.audit.push({
    action: "newsletter.issue.updated",
    entityKind: "newsletter_issue",
    entityId: id,
  });

  const updated = await c.env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
    .bind(id)
    .first<IssueRow>();
  return c.json({ issue: await detailOf(c.env, updated!) });
});

/** DELETE /newsletter/issues/:id — drafts only. A sent issue stays: its URL is
 *  public, may be linked from elsewhere, and is the record of what was mailed. */
newsletter.delete("/issues/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT status FROM newsletter_issue WHERE id = ?")
    .bind(id)
    .first<{ status: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.status !== "draft") {
    return c.json({ error: "not_draft", message: "A sent issue can't be deleted." }, 409);
  }

  await c.env.DB.prepare("DELETE FROM newsletter_issue WHERE id = ?").bind(id).run();
  c.var.audit.push({
    action: "newsletter.issue.deleted",
    entityKind: "newsletter_issue",
    entityId: id,
  });
  return c.json({ ok: true });
});

/** GET /newsletter/issues/:id/preview — events resolved LIVE, for the composer.
 *  A draft edited across several days keeps showing an accurate list; the frozen
 *  copy only comes into being at send. */
newsletter.get("/issues/:id/preview", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const row = await c.env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
    .bind(c.req.param("id"))
    .first<IssueRow>();
  if (!row) return c.json({ error: "not_found" }, 404);

  // A sent issue previews from its snapshot — that is what its readers see.
  const snapshot = row.events_snapshot_json
    ? JSON.parse(row.events_snapshot_json)
    : await resolveEventsSnapshot(c.env, parseContent(row.content_json), nowIso());
  return c.json({ eventsSnapshot: snapshot });
});

// ── Sending ─────────────────────────────────────────────────────────────────

/** POST /newsletter/issues/:id/test-send — proofread copy to a few addresses.
 *  Leaves no ledger rows and carries no working unsubscribe link, so a test can
 *  never unsubscribe a real recipient. */
newsletter.post("/issues/:id/test-send", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
    .bind(id)
    .first<IssueRow>();
  if (!row) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<NewsletterTestSendBody>().catch(() => null);
  const raw = Array.isArray(body?.to) ? body.to : [];
  const to = [...new Set(raw.map((e) => normalizeEmail(String(e))).filter(isEmail))];
  if (to.length === 0) return c.json({ error: "invalid_body", message: "Add at least one valid address." }, 400);
  if (to.length > MAX_TEST_RECIPIENTS) {
    return c.json(
      { error: "too_many", message: `Test sends are limited to ${MAX_TEST_RECIPIENTS} addresses.` },
      400,
    );
  }

  const settings = await getNewsletterSettings(c.env);
  const content = parseContent(row.content_json);
  const snapshot = row.events_snapshot_json
    ? JSON.parse(row.events_snapshot_json)
    : await resolveEventsSnapshot(c.env, content, nowIso());

  const msg = issueEmailArgs({
    env: c.env,
    settings,
    issue: {
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      subject: row.subject,
      content,
    },
    snapshot,
    unsubscribeToken: null,
    isTest: true,
  });

  let sent = 0;
  for (const address of to) {
    const result = await sendEmailResult(c.env, { ...msg, to: address });
    if (result.ok) sent++;
  }

  c.var.audit.push({
    action: "newsletter.test_sent",
    entityKind: "newsletter_issue",
    entityId: id,
    detail: { count: to.length },
  });
  return c.json({ ok: true, sent, attempted: to.length });
});

/** POST /newsletter/issues/:id/send — publish and mail it. The response returns
 *  as soon as the send is staged; delivery continues in waitUntil and progress
 *  is read back from GET /newsletter/issues/:id. */
newsletter.post("/issues/:id/send", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const outcome = await startSend(c.env, id);
  if (!outcome.ok) {
    if (outcome.reason === "not_found") return c.json({ error: "not_found" }, 404);
    if (outcome.reason === "no_recipients") {
      return c.json(
        { error: "no_recipients", message: "Nobody is currently subscribed." },
        400,
      );
    }
    return c.json(
      { error: "not_draft", message: "This issue has already been sent." },
      409,
    );
  }

  c.executionCtx.waitUntil(runFanOut(c.env, id));
  c.var.audit.push({
    action: "newsletter.issue.sent",
    entityKind: "newsletter_issue",
    entityId: id,
    detail: { recipientTotal: outcome.recipientTotal },
  });
  return c.json({ status: "sending", recipientTotal: outcome.recipientTotal });
});

/** POST /newsletter/issues/:id/retry — re-attempt anything that didn't land. */
newsletter.post("/issues/:id/retry", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const claimed = await retryFailed(c.env, id);
  if (!claimed) {
    // Two ways to land here: nothing is outstanding, or a send is genuinely
    // still running (retryFailed only takes over a 'sending' that has gone
    // stale). The message covers both rather than asserting the wrong one.
    return c.json(
      {
        error: "nothing_to_retry",
        message: "There's nothing to retry — everyone has it, or a send is still running.",
      },
      409,
    );
  }
  c.executionCtx.waitUntil(runFanOut(c.env, id));
  c.var.audit.push({
    action: "newsletter.issue.retried",
    entityKind: "newsletter_issue",
    entityId: id,
  });
  return c.json({ status: "sending" });
});

// ── Settings ────────────────────────────────────────────────────────────────

newsletter.get("/settings", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  return c.json({ settings: await getNewsletterSettings(c.env) });
});

newsletter.put("/settings", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<unknown>().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);

  const current = await getNewsletterSettings(c.env);
  const next = coerceNewsletterSettings(body, current);
  await setNewsletterSettings(c.env, next);

  // Switching INTO digest mode starts the window now, so turning it on doesn't
  // mail an admin every subscriber who joined while it was off. Only on the
  // transition — re-saving the settings screen while already on "daily" must
  // not silently drop the subscribers accumulated since the last digest.
  if (next.newSubscriberNotify === "daily" && current.newSubscriberNotify !== "daily") {
    await startSubscriberDigestWindow(c.env);
  }

  c.var.audit.push({
    action: "newsletter.settings.updated",
    entityKind: "setting",
    entityId: "newsletter_settings",
  });
  if (next.newSubscriberNotify !== current.newSubscriberNotify) {
    // Its own row: "who turned on subscriber emails, and when" is a question
    // that gets asked, and a generic settings-updated entry can't answer it.
    c.var.audit.push({
      action: "notify.toggled",
      entityKind: "setting",
      entityId: "new_subscriber_notify",
      detail: { mode: next.newSubscriberNotify },
    });
  }
  return c.json({ settings: next });
});

// ── Subscribers ─────────────────────────────────────────────────────────────

/** GET /newsletter/subscribers — the standalone list plus the current audience
 *  size, which is what an admin actually wants to know before sending. */
newsletter.get("/subscribers", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const rows = await c.env.DB.prepare(
    "SELECT id, email, created_at, unsubscribed_at FROM newsletter_subscriber ORDER BY email",
  ).all<{ id: string; email: string; created_at: string; unsubscribed_at: string | null }>();

  const subscribers: NewsletterSubscriberDTO[] = rows.results.map((r) => ({
    id: r.id,
    email: r.email,
    subscribed: r.unsubscribed_at === null,
    createdAt: r.created_at,
  }));
  const audience = await resolveAudience(c.env);
  return c.json({ subscribers, audienceTotal: audience.length });
});

newsletter.post("/subscribers", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ email: string }>().catch(() => null);
  const email = normalizeEmail(String(body?.email ?? ""));
  if (!isEmail(email)) return c.json({ error: "invalid_body", message: "Enter a valid email address." }, 400);

  const id = ulid();
  // Re-adding a previously removed address resubscribes it rather than failing.
  await c.env.DB.prepare(
    `INSERT INTO newsletter_subscriber (id, email, created_at, unsubscribed_at)
     VALUES (?,?,?,NULL)
     ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL`,
  )
    .bind(id, email, nowIso())
    .run();

  c.var.audit.push({
    action: "newsletter.subscriber.added",
    entityKind: "newsletter_subscriber",
    entityId: id,
    detail: { email },
  });

  const row = await c.env.DB.prepare(
    "SELECT id, email, created_at, unsubscribed_at FROM newsletter_subscriber WHERE email = ?",
  )
    .bind(email)
    .first<{ id: string; email: string; created_at: string; unsubscribed_at: string | null }>();
  return c.json(
    {
      subscriber: {
        id: row!.id,
        email: row!.email,
        subscribed: row!.unsubscribed_at === null,
        createdAt: row!.created_at,
      },
    },
    201,
  );
});

/** POST /newsletter/subscribers/import — bulk-add a pasted or uploaded list.
 *
 *  Accepts either raw `text` (a pasted list or the contents of a .csv/.txt file)
 *  or an `emails` array; both are parsed with the same forgiving splitter. New
 *  addresses are added and previously-removed ones resubscribed, exactly like
 *  the single-add route — importing is just that operation done in bulk. */
newsletter.post("/subscribers/import", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json<{ text?: string; emails?: string[] }>().catch(() => null);
  const text =
    typeof body?.text === "string"
      ? body.text
      : Array.isArray(body?.emails)
        ? body.emails.join("\n")
        : "";
  if (!text.trim()) {
    return c.json({ error: "invalid_body", message: "Paste or upload a list of addresses." }, 400);
  }

  const parsed = parseSubscriberList(text);
  if (parsed.valid.length === 0) {
    return c.json(
      {
        error: "no_valid_emails",
        message: "No valid email addresses were found in that list.",
        invalid: parsed.invalid,
      },
      400,
    );
  }
  if (parsed.valid.length > MAX_IMPORT_SUBSCRIBERS) {
    return c.json(
      {
        error: "too_many",
        message: `That list has more than ${MAX_IMPORT_SUBSCRIBERS} addresses. Import it in smaller batches.`,
      },
      400,
    );
  }

  const { added, resubscribed, alreadyActive } = await importSubscribers(c.env, parsed.valid);

  c.var.audit.push({
    action: "newsletter.subscriber.imported",
    entityKind: "newsletter_subscriber",
    entityId: null,
    detail: {
      added,
      resubscribed,
      alreadyActive,
      duplicates: parsed.duplicates,
      invalid: parsed.invalid.length,
      total: parsed.valid.length,
    },
  });

  const result: NewsletterSubscriberImportResultDTO = {
    added,
    resubscribed,
    alreadyActive,
    duplicates: parsed.duplicates,
    invalid: parsed.invalid,
    total: parsed.valid.length,
  };
  return c.json({ result });
});

/** DELETE /newsletter/subscribers/:id — remove a standalone address. Sent-issue
 *  ledger rows reference this row, so it is marked unsubscribed rather than
 *  deleted; the delivery history stays intact. */
newsletter.delete("/subscribers/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const res = await c.env.DB.prepare(
    "UPDATE newsletter_subscriber SET unsubscribed_at = ? WHERE id = ? AND unsubscribed_at IS NULL",
  )
    .bind(nowIso(), id)
    .run();
  if (res.meta.changes === 0) return c.json({ error: "not_found" }, 404);

  c.var.audit.push({
    action: "newsletter.subscriber.removed",
    entityKind: "newsletter_subscriber",
    entityId: id,
  });
  return c.json({ ok: true });
});

// ── Media ───────────────────────────────────────────────────────────────────

/** POST /newsletter/media — upload an image. Body is the raw file.
 *
 *  Objects land in NEWSLETTER_MEDIA, a bucket separate from PHOTOS. Everything
 *  here is served by a public route so it can render in an inbox, and keeping
 *  private member photos in a different bucket means there is no key-prefix
 *  check standing between them and the internet. */
newsletter.post("/media", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const contentType = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
  const ext = IMAGE_TYPES[contentType];
  if (!ext) return c.json({ error: "unsupported_type" }, 415);

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty" }, 400);
  if (body.byteLength > MAX_IMAGE_BYTES) return c.json({ error: "too_large" }, 413);

  const key = `${ulid()}.${ext}`;
  await c.env.NEWSLETTER_MEDIA.put(key, body, { httpMetadata: { contentType } });

  // Absolute, unlike the relative /photos/:key URL: this one has to resolve from
  // inside an email client that has no notion of the app's origin.
  c.var.audit.push({
    action: "newsletter.media.uploaded",
    entityKind: "newsletter_media",
    entityId: key,
    detail: { contentType, bytes: body.byteLength },
  });

  const origin = new URL(c.req.url).origin;
  return c.json({ url: `${origin}/newsletter-media/${key}` }, 201);
});

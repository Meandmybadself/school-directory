// Flush buffered audit drafts after the handler runs. Routes push drafts via
// c.var.audit.push(...); this middleware persists them (chained) post-response.

import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../env.js";
import { writeAudit } from "../lib/audit.js";
import { notifySlackForAudit } from "../lib/slackNotify.js";

export const auditMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  await next();
  const drafts = c.var.audit;
  if (!drafts.length) return;
  const auth = c.var.auth;
  const meta = {
    // The real human is the actor; during masquerade that's the admin, and the
    // target being viewed is recorded in masquerading_as.
    actorUserId: auth?.realUserId ?? null,
    masqueradingAs: auth?.isMasquerading ? auth.userId : null,
    ip: c.var.ip,
    userAgent: c.var.userAgent,
  };
  // Write sequentially to preserve hash-chain order; don't block the response.
  c.executionCtx.waitUntil(
    (async () => {
      for (const d of drafts) {
        try {
          await writeAudit(c.env, d, meta);
        } catch (err) {
          console.error("[audit] failed to write", d.action, err);
        }
      }
    })(),
  );

  // Slack (invariant 22), on its own promise rather than appended to the loop
  // above: the two are independent effects of the same drafts, not a pipeline.
  // A Slack outage must not stop the chain from being written, and a chain that
  // exhausted its retry budget must still notify. It takes the whole batch
  // because one request's drafts are one event to a reader — and it curates
  // from `notify`, never `detail`.
  c.executionCtx.waitUntil(notifySlackForAudit(c.env, drafts, meta));
});

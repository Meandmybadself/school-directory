// Flush buffered audit drafts after the handler runs. Routes push drafts via
// c.var.audit.push(...); this middleware persists them (chained) post-response.

import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../env.js";
import { writeAudit } from "../lib/audit.js";

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
});

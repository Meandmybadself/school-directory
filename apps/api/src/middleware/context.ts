// Per-request context: capture IP/user-agent and initialize the audit buffer.

import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../env.js";

export const contextMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  c.set("audit", []);
  c.set(
    "ip",
    c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? null,
  );
  c.set("userAgent", c.req.header("user-agent") ?? null);
  await next();
});

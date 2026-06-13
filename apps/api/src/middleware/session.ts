// Session middleware: resolve the session cookie into an AuthContext.
// Long-lived (1yr) opaque sessions; `last_seen_at` bumped on use.

import { createMiddleware } from "hono/factory";
import type { AuthContext, HonoEnv } from "../env.js";
import { readActivePerson, readSessionId } from "../lib/cookies.js";
import { isExpired, nowIso } from "../lib/time.js";

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
  acting_admin_id: string | null;
  parent_session_id: string | null;
}
interface UserRow {
  id: string;
  email: string;
  is_system_admin: number;
}

/** Populates c.var.auth when a valid session exists. Does not reject. */
export const sessionMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  const sid = readSessionId(c);
  if (sid) {
    const session = await c.env.DB.prepare(
      "SELECT id, user_id, expires_at, revoked_at, acting_admin_id, parent_session_id FROM session WHERE id = ?",
    )
      .bind(sid)
      .first<SessionRow>();

    if (session && !session.revoked_at && !isExpired(session.expires_at)) {
      const user = await c.env.DB.prepare(
        "SELECT id, email, is_system_admin FROM user WHERE id = ? AND disabled_at IS NULL",
      )
        .bind(session.user_id)
        .first<UserRow>();

      if (user) {
        // Bump last_seen_at without blocking the response.
        c.executionCtx.waitUntil(
          c.env.DB.prepare("UPDATE session SET last_seen_at = ? WHERE id = ?")
            .bind(nowIso(), session.id)
            .run(),
        );

        const activePersonId = await resolveActivePerson(c, user.id);
        const auth: AuthContext = {
          userId: user.id,
          realUserId: session.acting_admin_id ?? user.id,
          email: user.email,
          isSystemAdmin: user.is_system_admin === 1,
          sessionId: session.id,
          activePersonId,
          isMasquerading: !!session.acting_admin_id,
        };
        c.set("auth", auth);
      }
    }
  }
  await next();
});

/** Active person from cookie if still controlled, else the user's first person. */
async function resolveActivePerson(
  c: Parameters<Parameters<typeof createMiddleware<HonoEnv>>[0]>[0],
  userId: string,
): Promise<string | null> {
  const cookiePid = readActivePerson(c);
  if (cookiePid) {
    const ok = await c.env.DB.prepare(
      "SELECT 1 AS ok FROM control WHERE user_id = ? AND person_id = ? LIMIT 1",
    )
      .bind(userId, cookiePid)
      .first<{ ok: number }>();
    if (ok) return cookiePid;
  }
  const first = await c.env.DB.prepare(
    "SELECT person_id FROM control WHERE user_id = ? ORDER BY since ASC LIMIT 1",
  )
    .bind(userId)
    .first<{ person_id: string }>();
  return first?.person_id ?? null;
}

/** Guard: 401 unless an AuthContext is present. Returns it for convenience. */
export function requireAuth(c: { var: { auth?: AuthContext } }): AuthContext {
  const auth = c.var.auth;
  if (!auth) {
    throw new UnauthorizedError();
  }
  return auth;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

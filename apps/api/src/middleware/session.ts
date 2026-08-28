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
  /** Joined from `user`. Null when the session points at no user at all. */
  email: string | null;
  is_system_admin: number | null;
  disabled_at: string | null;
}

/** Populates c.var.auth when a valid session exists. Does not reject.
 *
 *  Runs on EVERY request, so the query count here is the API's floor. Session
 *  and user resolve together in one join, and the active Person in one more —
 *  two round trips, where this used to take four. The disabled-actor check
 *  below stays its own statement on purpose: it is a security guard rather than
 *  a lookup, and it should read like one. */
export const sessionMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  const sid = readSessionId(c);
  if (sid) {
    const session = await c.env.DB.prepare(
      `SELECT s.id, s.user_id, s.expires_at, s.revoked_at, s.acting_admin_id, s.parent_session_id,
              u.email, u.is_system_admin, u.disabled_at
         FROM session s LEFT JOIN user u ON u.id = s.user_id
        WHERE s.id = ?`,
    )
      .bind(sid)
      .first<SessionRow>();

    if (session && !session.revoked_at && !isExpired(session.expires_at)) {
      // The join is a LEFT join, so "no such user" and "disabled user" both land
      // here as a null-ish row — the same two cases the separate lookup's
      // `WHERE … AND disabled_at IS NULL` used to fold together.
      const user =
        session.email !== null && !session.disabled_at
          ? { id: session.user_id, email: session.email, is_system_admin: session.is_system_admin ?? 0 }
          : null;

      // A masquerade is resolved against the TARGET's account, so the check
      // above says nothing about the admin driving it. Disabling an admin
      // deletes these sessions, but the door should refuse them regardless:
      // access for a disabled account must not depend on cleanup having run.
      const actorOk =
        !user || !session.acting_admin_id
          ? true
          : !!(await c.env.DB.prepare(
              "SELECT 1 AS ok FROM user WHERE id = ? AND disabled_at IS NULL",
            )
              .bind(session.acting_admin_id)
              .first<{ ok: number }>());

      if (user && actorOk) {
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

/** Active person from cookie if still controlled, else the user's first person.
 *
 *  Both cases in one statement: the ORDER BY floats the cookie's Person to the
 *  top when the viewer actually controls it, and falls through to the oldest
 *  grant when they don't. Selecting only from rows the user controls is what
 *  makes the cookie safe to trust — an unrecognised value simply can't win. */
async function resolveActivePerson(
  c: Parameters<Parameters<typeof createMiddleware<HonoEnv>>[0]>[0],
  userId: string,
): Promise<string | null> {
  const row = await c.env.DB.prepare(
    `SELECT person_id FROM control
      WHERE user_id = ?
      ORDER BY (person_id = ?) DESC, since ASC
      LIMIT 1`,
  )
    .bind(userId, readActivePerson(c) ?? "")
    .first<{ person_id: string }>();
  return row?.person_id ?? null;
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

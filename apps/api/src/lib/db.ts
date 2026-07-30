import type { Env } from "../env.js";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Normalized set of bootstrap-admin emails from BOOTSTRAP_ADMIN_EMAILS. */
export function bootstrapAdminEmails(env: Env): Set<string> {
  return new Set(
    (env.BOOTSTRAP_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isBootstrapAdmin(env: Env, email: string): boolean {
  return bootstrapAdminEmails(env).has(normalizeEmail(email));
}

/** Origins from ALLOWED_ORIGINS. One list serves two purposes with the same trust
 *  boundary: which origins may call the API with credentials (CORS), and which
 *  are valid magic-link return targets. An origin trusted to hold a session is
 *  equally trusted as a redirect destination, so there's no second env var. */
export function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The origin to send a member back to after a magic link, given the origin the
 *  sign-in was started from. Falls back to APP_URL for anything not
 *  allow-listed, so this can never become an open redirect. */
export function resolveReturnTo(env: Env, requested: string | null | undefined): string {
  return requested && allowedOrigins(env).includes(requested) ? requested : env.APP_URL;
}

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM setting WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(key, value)
    .run();
}

export async function isRegistrationOpen(env: Env): Promise<boolean> {
  return (await getSetting(env, "registration_open")) === "true";
}

export interface UserRow {
  id: string;
  email: string;
  is_system_admin: number;
  locale: string | null;
}

export async function findUserByEmail(env: Env, email: string): Promise<UserRow | null> {
  return env.DB.prepare(
    "SELECT id, email, is_system_admin, locale FROM user WHERE email = ?",
  )
    .bind(email)
    .first<UserRow>();
}

import type { Env } from "../env.js";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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

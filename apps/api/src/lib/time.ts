export const nowIso = (): string => new Date().toISOString();

export function isoPlus(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export const MINUTES = 60 * 1000;
export const DAYS = 24 * 60 * MINUTES;
export const YEAR = 365 * DAYS;
export const MAGIC_LINK_TTL = 15 * MINUTES;
export const MASQUERADE_TTL = 60 * MINUTES;
export const INVITE_TTL = 14 * DAYS;
export const SESSION_TTL = YEAR;

export function isExpired(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

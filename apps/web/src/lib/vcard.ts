// Build a downloadable vCard (.vcf) from a person's already-privacy-filtered
// profile. The directory resolves visibility server-side, so whatever contact
// items reach the client are exactly what this viewer is allowed to save — this
// module just reshapes them, it makes no trust decisions of its own.
//
// vCard 3.0 on purpose: it's the version iOS Contacts and Android import most
// reliably. Photos are deliberately omitted — member photos are served behind
// auth, and the phone's contacts app fetches a PHOTO URI with no session cookie,
// so it would 404; a clean card beats a broken avatar.
import type { ContactType } from "@sd/shared";

export interface VCardContact {
  type: ContactType;
  value: string;
  label: string | null;
}

export interface VCardInput {
  /** Display name, already last-name-rule-applied (e.g. "Dana R."). */
  fullName: string;
  firstName: string;
  /** Present only when the viewer controls the Person; otherwise the family
   *  name is withheld and N carries the given name alone. */
  lastName?: string | null;
  contacts: VCardContact[];
}

/** Escape a value for a vCard text field per RFC 6350 §3.4. */
function esc(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Map a human label to a vCard TEL/ADR TYPE. Falls back to CELL for phones and
 *  HOME for addresses when the label doesn't say otherwise. */
function telType(label: string | null): string {
  const l = (label ?? "").toLowerCase();
  if (l.includes("work") || l.includes("office")) return "WORK,VOICE";
  if (l.includes("home") || l.includes("house")) return "HOME,VOICE";
  return "CELL,VOICE";
}

function adrType(label: string | null): string {
  const l = (label ?? "").toLowerCase();
  if (l.includes("work") || l.includes("office")) return "WORK";
  return "HOME";
}

/** Recover the family name from the display name when it isn't provided
 *  explicitly. The profile view fetches a member's-eye DTO, which omits the raw
 *  `lastName` field — but `displayName` is already last-name-rule-applied for the
 *  viewer ("Dana Ruiz", "Dana R.", or just "Dana"), so whatever surname the
 *  viewer is allowed to see is exactly its trailing part after the given name.
 *  Deriving from it keeps the card honest: a full surname lands in N, a
 *  members-see-an-initial name yields the initial, a withheld one yields "". */
function deriveFamilyName(fullName: string, firstName: string): string {
  const full = fullName.trim();
  const first = firstName.trim();
  if (first && full.toLowerCase().startsWith(first.toLowerCase())) {
    return full.slice(first.length).trim();
  }
  return "";
}

/** Build the vCard text. Pure and deterministic (no timestamp), so it can be
 *  unit-tested. Lines are CRLF-joined as the spec requires. */
export function buildVCard(input: VCardInput): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];

  // N is structured: Family;Given;Additional;Prefix;Suffix. Prefer an explicit
  // lastName; otherwise recover it from the (already privacy-applied) display
  // name so a visible surname isn't dropped from the saved contact.
  const family = (input.lastName ?? "").trim() || deriveFamilyName(input.fullName, input.firstName);
  lines.push(`N:${esc(family)};${esc(input.firstName)};;;`);
  lines.push(`FN:${esc(input.fullName)}`);

  for (const c of input.contacts) {
    const value = c.value.trim();
    if (!value) continue;
    switch (c.type) {
      case "phone":
        lines.push(`TEL;TYPE=${telType(c.label)}:${esc(value)}`);
        break;
      case "email":
        lines.push(`EMAIL;TYPE=INTERNET:${esc(value)}`);
        break;
      case "address": {
        const type = adrType(c.label);
        // The directory stores an address as one free-form string; the common,
        // widely-parsed convention is to place it in the ADR street component
        // and repeat it as a display LABEL.
        lines.push(`ADR;TYPE=${type}:;;${esc(value)};;;;`);
        lines.push(`LABEL;TYPE=${type}:${esc(value)}`);
        break;
      }
      case "url":
        lines.push(`URL:${esc(value)}`);
        break;
    }
  }

  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

/** Filesystem-safe base name for the downloaded file. */
function safeFileName(name: string): string {
  const base = name.replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "-");
  return (base || "contact") + ".vcf";
}

/** Build the card and hand it to the browser as a download. iOS Safari opens
 *  the .vcf in Contacts ("Add Contact"); desktop browsers save the file. */
export function downloadVCard(input: VCardInput): void {
  const text = buildVCard(input);
  const blob = new Blob([text], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFileName(input.fullName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click's navigation has taken the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

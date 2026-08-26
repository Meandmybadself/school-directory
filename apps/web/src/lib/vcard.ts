// Build a downloadable vCard (.vcf) from a person's already-privacy-filtered
// profile. The directory resolves visibility server-side, so whatever contact
// items reach the client are exactly what this viewer is allowed to save — this
// module just reshapes them, it makes no trust decisions of its own.
//
// vCard 3.0 on purpose: it's the version iOS Contacts and Android import most
// reliably. The photo, when present, is EMBEDDED as base64 rather than linked by
// URL: the phone's contacts app fetches a PHOTO URI with no session cookie, so a
// link could break, whereas embedded bytes travel inside the file and need no
// network. The web app does the fetch in its own authenticated session (see
// fetchPhotoForVCard) and hands the encoded bytes here.
import type { ContactType } from "@sd/shared";

export interface VCardContact {
  type: ContactType;
  value: string;
  label: string | null;
}

/** A profile photo already fetched and base64-encoded, ready to embed. */
export interface VCardPhoto {
  /** Base64 (no data: prefix, no line breaks). */
  base64: string;
  /** Source MIME type, e.g. "image/jpeg". Maps to the vCard TYPE. */
  mime: string;
}

export interface VCardInput {
  /** Display name, already last-name-rule-applied (e.g. "Dana R."). */
  fullName: string;
  firstName: string;
  /** Present only when the viewer controls the Person; otherwise the family
   *  name is withheld and N carries the given name alone. */
  lastName?: string | null;
  contacts: VCardContact[];
  /** Embedded profile photo, or null/omitted for none. */
  photo?: VCardPhoto | null;
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

/** Map an image MIME type to the vCard PHOTO TYPE token, or null if we don't
 *  recognize it (in which case the photo is skipped rather than mislabeled). */
function photoType(mime: string): string | null {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "JPEG";
    case "image/png":
      return "PNG";
    case "image/gif":
      return "GIF";
    case "image/webp":
      return "WEBP";
    default:
      return null;
  }
}

/** Fold one logical line to 75-octet chunks per RFC 2426 §2.6: continuation
 *  lines begin with a single space. Base64 has no spaces of its own, so a strict
 *  parser unfolds it back to the exact payload. Applied only to the PHOTO line,
 *  the one line long enough to need it. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) {
    parts.push(" " + line.slice(i, i + 74));
  }
  return parts.join("\r\n");
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

  // Embedded photo (base64). Only emitted for a recognized image type; the line
  // is folded because a base64 image is far longer than 75 octets.
  if (input.photo?.base64) {
    const type = photoType(input.photo.mime);
    if (type) {
      lines.push(foldLine(`PHOTO;ENCODING=b;TYPE=${type}:${input.photo.base64}`));
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

/** Cap on the source image we'll embed. Base64 inflates ~33%, and a contact
 *  card shouldn't carry a multi-megabyte payload; above this the photo is simply
 *  skipped and the rest of the card still saves. */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Fetch a profile photo and base64-encode it for embedding. Runs in the web
 *  app's own authenticated, same-origin-credentialed context (the CORS allowlist
 *  covers this origin), which is exactly why the bytes can be captured here when
 *  the phone couldn't. Best-effort: any failure (network, oversized, unknown
 *  type) resolves to null so the card still downloads without a photo. */
export async function fetchPhotoForVCard(url: string): Promise<VCardPhoto | null> {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size === 0 || blob.size > MAX_PHOTO_BYTES) return null;
    const mime = blob.type || "image/jpeg";
    if (!photoType(mime)) return null;
    const base64 = await blobToBase64(blob);
    return base64 ? { base64, mime } : null;
  } catch {
    return null;
  }
}

/** Read a Blob as bare base64 (the data: URL's payload, prefix stripped). */
function blobToBase64(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : null);
    };
    reader.readAsDataURL(blob);
  });
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

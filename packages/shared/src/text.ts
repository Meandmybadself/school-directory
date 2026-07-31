// Small text helpers shared across the API and web client.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

function codePoint(n: number): string {
  try {
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

/** Convert (untrusted) HTML to readable plain text. Block/line-break tags become
 *  newlines, list items get bullets, all other tags are stripped, and HTML
 *  entities are decoded. Used to display ICS DESCRIPTION fields that contain
 *  HTML markup — we render the result as text (never as HTML), so feed content
 *  can't inject markup. Plain text passes through essentially unchanged. */
export function htmlToText(input: string): string {
  return input
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => codePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Newsletter slugs ────────────────────────────────────────────────────────

/** Title → URL segment. ASCII-folded, lowercase, hyphenated, length-capped.
 *  Non-Latin titles can reduce to nothing; callers fall back to the date alone,
 *  which is still a valid, readable slug. */
export function slugifyTitle(title: string): string {
  return title
    .normalize("NFKD")
    // Strip combining marks so "Año" → "Ano" rather than losing the letter.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** The public URL segment for an issue: a date the reader can parse plus the
 *  title. Deliberately human-readable and therefore enumerable — issues are
 *  public by design, and nothing member-private may go in one. */
export function issueSlug(title: string, nowIso: string): string {
  const date = nowIso.slice(0, 10);
  const tail = slugifyTitle(title);
  return tail ? `${date}-${tail}` : date;
}

/** The public URL segment for a volunteer sheet: the event's title followed by
 *  the occurrence's date, e.g. "fall-carnival-2026-10-17". Title-first rather
 *  than date-first (the inverse of `issueSlug`) because this link is pasted into
 *  a message asking people to sign up, where the event name is what identifies
 *  it — an archived newsletter is identified by when it went out.
 *
 *  Enumerable by design, on the same terms as an issue slug: the page it
 *  addresses publishes counts, never volunteer names. */
export function volunteerSheetSlug(title: string, occurrenceStartIso: string): string {
  const date = occurrenceStartIso.slice(0, 10);
  const head = slugifyTitle(title);
  return head ? `${head}-${date}` : date;
}

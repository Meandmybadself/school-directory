// Finding the links in an event's plain text.
//
// An event description is TEXT by the time this app renders it — an admin typed
// it into a textarea, or `htmlToText` flattened an imported feed's HTML — so a
// URL or a phone number in it used to be something a parent had to select and
// copy on a phone. This splits that text into runs the page can render as
// anchors, and it is deliberately the ONLY thing that decides an href: nothing
// is ever passed through as markup, and a run is only a link when this code
// built the href itself, from a scheme it chose.
//
// Three kinds, and the hrefs are narrow on purpose:
// · a URL is `http(s)://…` or a bare `www.…` (which gets `https://`). No other
//   scheme is recognised, so `javascript:` in a description stays text.
// · an email address becomes `mailto:`.
// · a phone number is North American — this is an American elementary school,
//   the same reasoning `CLOCK` gives — and becomes `tel:+1XXXXXXXXXX`, digits
//   only, so what is dialled is exactly the ten digits shown.

export type TextRun =
  | { kind: "text"; text: string }
  | { kind: "url" | "email" | "phone"; text: string; href: string };

const URL_SRC = String.raw`(?:https?:\/\/|www\.)[^\s<>"']+`;
const EMAIL_SRC = String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`;
/** `952-988-5000`, `(952) 988-5000`, `952.988.5000`, `+1 952 988 5000`. The
 *  separators between groups are optional so a bare ten digits still reads as
 *  a number, but the boundary checks in `linkify` keep it from biting a run of
 *  digits out of a longer one. */
const PHONE_SRC = String.raw`(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}`;

/** URL first, then email, then phone: the alternation takes the first that
 *  matches at a position, so a number inside a URL is consumed as the URL. */
const PATTERN = new RegExp(`(${URL_SRC})|(${EMAIL_SRC})|(${PHONE_SRC})`, "gi");

/** Characters a sentence puts after a link that are not part of it. */
const TRAILING = /[.,;:!?'"*]+$/;

/** Drop trailing punctuation, and a closing bracket the URL never opened —
 *  "(see https://example.org)" must not link the `)`. A Wikipedia-style
 *  `…/Foo_(bar)` keeps its own. */
function trimUrl(raw: string): string {
  let s = raw;
  for (;;) {
    const before = s;
    s = s.replace(TRAILING, "");
    for (const [open, close] of [["(", ")"], ["[", "]"]] as const) {
      if (s.endsWith(close) && count(s, close) > count(s, open)) s = s.slice(0, -1);
    }
    if (s === before) return s;
  }
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

function phoneHref(text: string): string | null {
  const digits = text.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  // NANP: area code and exchange never start with 0 or 1. Checking it keeps a
  // run like `0123456789` from dialling.
  if (national.length !== 10 || /^[01]/.test(national) || /^[01]/.test(national.slice(3))) return null;
  return `tel:+1${national}`;
}

/** A word character, or one that would make the match part of something longer
 *  (a path, a decimal, a hyphenated code). */
const JOINER = /[\w@/.+-]/;

export function linkify(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  const push = (s: string) => {
    if (!s) return;
    const prev = runs[runs.length - 1];
    if (prev?.kind === "text") prev.text += s;
    else runs.push({ kind: "text", text: s });
  };

  for (const m of text.matchAll(PATTERN)) {
    const start = m.index;
    let raw = m[0];
    let link: TextRun | null = null;

    if (m[1]) {
      raw = trimUrl(raw);
      // `www.` alone, or a scheme with nothing after it, is not an address.
      if (!raw.replace(/^(https?:\/\/|www\.)/i, "")) continue;
      const href = /^www\./i.test(raw) ? `https://${raw}` : raw;
      link = { kind: "url", text: raw, href };
    } else if (m[2]) {
      link = { kind: "email", text: raw, href: `mailto:${raw}` };
    } else if (m[3]) {
      const before = start > 0 ? text[start - 1]! : "";
      const after = text[start + raw.length] ?? "";
      const href = phoneHref(raw);
      // A number glued to more digits or to a path is a code, not a phone.
      if (!href || JOINER.test(before) || /[\w-]/.test(after)) continue;
      link = { kind: "phone", text: raw, href };
    }

    if (!link) continue;
    push(text.slice(last, start));
    runs.push(link);
    last = start + raw.length;
  }
  push(text.slice(last));
  return runs;
}

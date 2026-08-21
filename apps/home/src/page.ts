// The landing page itself, rendered per request in one of four languages.
//
// The hero is the design: the word "welcome" stacked in every language this
// community reads, with the current one in ink under an orange rule and the
// other three as links that reload the page in that language. It is the
// greeting and the language picker at once, which is the honest shape for a
// school whose families read English, Spanish, Chinese and Somali — a globe
// icon in a corner asks a Somali-speaking parent to hunt for their own
// language, and this hands it to them at 4rem.
//
// All copy comes from the shared dictionaries (CLAUDE.md invariant 6). The
// greeting stack is the one place that reads ACROSS dictionaries rather than
// within one, since it shows all four at once by design.

import {
  DEFAULT_TIME_ZONE,
  LOCALES,
  dictionaries,
  eventPath,
  interpolate,
  localeNames,
  type Locale,
  type PublicCalendarEventDTO,
  type Strings,
} from "@sd/shared";
import {
  BUS_EMAIL,
  DISTRICT_ADDRESS,
  DISTRICT_PHONES,
  OTHER_SCHOOLS,
  RESOURCES,
  SCHOOL_HOURS,
  SCHOOL_LABEL,
  SCHOOL_PHONES,
  hrefOf,
  type PhoneRow,
  type Resource,
} from "./district.js";
import type { Env } from "./env.js";
import { upcomingEvents } from "./events.js";
import { STYLES } from "./styles.js";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Sentinel interpolated in place of a value that has to be wrapped in markup,
 *  then split on — the trick `SiteFooter` uses, for the same reason: it keeps
 *  the value wherever the TRANSLATOR put it in the sentence instead of assuming
 *  every language orders it the way English does. A NUL can never appear in a
 *  dictionary string, so the split is unambiguous. */
const SLOT = "\u0000";

/** The two halves of a sentence, either side of the slot. */
function splitSlot(template: string, key: string): [string, string] {
  const [before = "", after = ""] = interpolate(template, { [key]: SLOT }).split(SLOT);
  return [before, after];
}

/** Interpolate a value into a sentence and wrap it in `<b>`, escaping both
 *  halves of the sentence and the value itself. */
function emphasize(template: string, value: string): string {
  const [before, after] = splitSlot(template, "feature");
  return `${escapeHtml(before)}<b>${escapeHtml(value)}</b>${escapeHtml(after)}`;
}

/** Same trick, but the slot becomes a link out — used to name whoever published
 *  a fact and hand the reader their site in the same breath. */
function linkSlot(template: string, key: string, label: string, href: string): string {
  const [before, after] = splitSlot(template, key);
  return `${escapeHtml(before)}<a href="${escapeHtml(href)}">${escapeHtml(
    label,
  )}</a>${escapeHtml(after)}`;
}

/** A link into one of the apps, carrying the reader's language with it.
 *
 *  `?lang=` is the deep-link parameter every SPA already honours: it applies
 *  the language, remembers it the way the picker would, and strips the
 *  parameter from the address bar. So a parent who picked Somali here lands in
 *  the directory in Somali without ever opening a setting. */
function appHref(base: string, path: string, locale: Locale): string {
  return `${base.replace(/\/$/, "")}${path}?lang=${locale}`;
}

/** Same-origin link that re-renders THIS page in another language. Unlike the
 *  SPAs, the parameter stays in the URL: there is no client here to remember a
 *  choice, and a stable per-language URL is what `hreflang` and a shared link
 *  both need. */
function langHref(locale: Locale): string {
  return `/?lang=${locale}`;
}

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="14" fill="#0068a8"/>' +
      '<path d="M22 17h21.4v7.6H30.4v7.1h11.4v7.3H30.4v7.4h13.4V54H22z" fill="#fff"/>' +
      "</svg>",
  );

/** Map pin for the hero's place-stamp. Inline because this Worker ships no
 *  asset of any kind, and `aria-hidden` because the place name beside it
 *  already says what it means in every language. */
const PIN =
  '<svg class="place-pin" width="11" height="11" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>' +
  '<circle cx="12" cy="10" r="3"/></svg>';

const FONTS =
  "https://fonts.googleapis.com/css2" +
  "?family=Hanken+Grotesk:wght@400;600;700;800" +
  "&family=Noto+Sans+SC:wght@400;700" +
  "&family=Spline+Sans+Mono:wght@400;600" +
  "&display=swap";

interface Tile {
  title: string;
  href: string;
  host: string;
  body: string;
  /** Pre-escaped: carries a `<b>` around the sub-feature's name. */
  more: string;
  membersOnly: boolean;
}

/** Async only because of the upcoming-events block, which is the one thing on
 *  this page that isn't a pure function of the URL and the Accept-Language
 *  header. Everything else renders whether or not that read succeeds. */
export async function renderHome(
  env: Env,
  locale: Locale,
  explicit: boolean,
): Promise<string> {
  const events = await upcomingEvents(env);
  const s: Strings = dictionaries[locale];
  const t = (key: keyof Strings, vars?: Record<string, string>): string =>
    interpolate(s[key], vars);

  const school = env.SCHOOL_NAME;
  const origin = env.SITE_ORIGIN.replace(/\/$/, "");
  const languages = LOCALES.map((l) => localeNames[l].native).join(" · ");
  const city = `${env.SCHOOL_CITY}, ${env.SCHOOL_REGION}`;

  const title = t("landingTitle", { school });
  const description = t("landingDescription", { school, city, languages });

  // The signature element. Fixed order (never "current language first"), so the
  // stack is a stable object a returning visitor recognizes rather than a list
  // that reshuffles under them.
  const greeting = LOCALES.map((l, i) => {
    const word = escapeHtml(dictionaries[l].landingWelcome);
    const inner =
      l === locale
        ? `<strong lang="${l}" aria-current="true">${word}</strong>`
        : `<a lang="${l}" href="${langHref(l)}" hreflang="${l}" aria-label="${escapeHtml(
            interpolate(dictionaries[l].landingReadIn, {
              language: localeNames[l].native,
            }),
          )}">${word}</a>`;
    return `<li style="--i:${i}">${inner}</li>`;
  }).join("");

  const tiles: Tile[] = [
    {
      title: t("navDir"),
      href: appHref(env.DIRECTORY_URL, "/", locale),
      host: hostOf(env.DIRECTORY_URL),
      body: t("landingDirBody"),
      more: emphasize(s.landingDirMore, s.neighbors),
      membersOnly: true,
    },
    {
      title: t("calendarTitle"),
      href: appHref(env.CALENDAR_URL, "/", locale),
      host: hostOf(env.CALENDAR_URL),
      body: t("landingCalBody"),
      more: emphasize(s.landingCalMore, s.volunteersTitle),
      membersOnly: false,
    },
    {
      title: t("landingNewsTitle"),
      href: appHref(env.NEWSLETTER_URL, "/", locale),
      host: hostOf(env.NEWSLETTER_URL),
      body: t("landingNewsBody"),
      more: escapeHtml(t("landingNewsMore")),
      membersOnly: false,
    },
  ];

  const tileHtml = tiles
    .map(
      (tile) => `
        <a class="card tile" href="${escapeHtml(tile.href)}">
          <div class="tile-top">
            <h2>${escapeHtml(tile.title)}</h2>
            <span class="tag ${tile.membersOnly ? "tag-members" : "tag-open"}">${escapeHtml(
              tile.membersOnly ? t("landingMembersOnly") : t("landingOpenToAll"),
            )}</span>
          </div>
          <div class="host">${escapeHtml(tile.host)}</div>
          <p>${escapeHtml(tile.body)}</p>
          <div class="more">${tile.more}</div>
          <div class="go">${escapeHtml(
            t("landingOpen", { name: tile.title }),
          )} <span aria-hidden="true">&#8594;</span></div>
        </a>`,
    )
    .join("");

  const [feedBefore = "", feedAfter = ""] = t("footerFeedback", { email: SLOT }).split(SLOT);

  const body = `
    <header class="hd">
      <div class="wrap hd-in">
        <a class="mark" href="/?lang=${locale}">${escapeHtml(s.brand)}<i>.school</i></a>
        <div class="hd-out">
          <span class="lbl">${escapeHtml(t("landingSchoolSiteLabel"))}</span>
          <a href="${escapeHtml(env.SCHOOL_SITE_URL)}">${escapeHtml(t("landingSchoolSiteLink"))}</a>
        </div>
      </div>
    </header>

    <main>
      <section class="hero">
        <div class="wrap hero-in">
          <div>
            <p class="eyebrow place">${PIN}${escapeHtml(city)}</p>
            <ul class="greet">${greeting}</ul>
          </div>
          <div class="card hero-card">
            <p class="lead">${escapeHtml(t("landingLead", { school }))}</p>
            <div class="acts">
              <a class="btn btn-primary" href="${escapeHtml(
                appHref(env.DIRECTORY_URL, "/sign-in", locale),
              )}">${escapeHtml(t("landingCreateAccount"))}</a>
              <a class="btn btn-quiet" href="${escapeHtml(
                appHref(env.CALENDAR_URL, "/", locale),
              )}">${escapeHtml(t("landingSeeCalendar"))}</a>
            </div>
            <p class="note">${escapeHtml(t("landingNoPassword"))}</p>
          </div>
        </div>
      </section>

      <section class="sect">
        <div class="wrap">
          <p class="eyebrow">${escapeHtml(t("landingWhatsHere"))}</p>
          <div class="grid">${tileHtml}</div>
        </div>
      </section>

      ${renderEvents(env, locale, events)}
      ${renderHelp(env, locale)}

      <section class="join">
        <div class="wrap join-in">
          <div>
            <p class="eyebrow">${escapeHtml(school)}</p>
            <h2>${escapeHtml(t("landingJoinTitle"))}</h2>
            <p>${escapeHtml(t("landingJoinBody", { school }))}</p>
          </div>
          <div class="join-act">
            <a class="btn btn-light" href="${escapeHtml(
              appHref(env.DIRECTORY_URL, "/sign-in", locale),
            )}">${escapeHtml(t("landingCreateAccount"))}</a>
            <p class="note">${escapeHtml(t("landingNoPassword"))}</p>
          </div>
        </div>
      </section>
    </main>

    <footer class="ft">
      <div class="wrap ft-in">
        <div>${escapeHtml(t("landingLocatedIn", { school, city }))}</div>
        <div>${escapeHtml(t("footerBuiltBy", { school }))}</div>
        <div>${escapeHtml(feedBefore)}<a href="mailto:${escapeHtml(
          env.FEEDBACK_EMAIL,
        )}">${escapeHtml(env.FEEDBACK_EMAIL)}</a>${escapeHtml(feedAfter)}</div>
      </div>
    </footer>`;

  const alternates = [
    ...LOCALES.map(
      (l) =>
        `<link rel="alternate" hreflang="${l}" href="${escapeHtml(origin + langHref(l))}" />`,
    ),
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(origin)}/" />`,
  ].join("\n    ");

  return document({
    lang: locale,
    title,
    description,
    canonical: `${origin}${explicit ? langHref(locale) : "/"}`,
    head: `${alternates}\n    ${jsonLd(env, description)}`,
    body,
  });
}

/** Who published everything in the block above — named, and linked to their own
 *  site. None of it is the PTO's to change, and a parent chasing a detail
 *  should be one tap from the people who can answer. */
function source(s: Strings, env: Env, extra = ""): string {
  return `<p class="src">${linkSlot(
    s.landingDistrictSource,
    "district",
    env.DISTRICT_NAME,
    env.DISTRICT_URL,
  )}${extra ? ` <span class="dot">·</span> ${escapeHtml(extra)}` : ""}</p>`;
}

/** The next few things on the calendar.
 *
 *  Read live rather than transcribed, which is the whole point: a date copied
 *  onto this page is wrong the moment the school moves it, and this page has no
 *  editor. `upcomingEvents` degrades to an empty list on any failure and an
 *  empty list hides the block, so the front door never depends on the API being
 *  up — see `events.ts`.
 *
 *  Each row links to the event's own page on the calendar site, minted by the
 *  shared `eventPath` in the SCHOOL's timezone: this Worker has no reader
 *  timezone to use, and the lookup on the other side searches ±1 day, so the
 *  two ends can disagree about the boundary without breaking the link. */
function renderEvents(env: Env, locale: Locale, events: PublicCalendarEventDTO[]): string {
  if (events.length === 0) return "";
  const s = dictionaries[locale];
  const calendar = env.CALENDAR_URL.replace(/\/$/, "");

  const rows = events
    .map((e) => {
      const href = `${calendar}${eventPath(e, DEFAULT_TIME_ZONE)}?lang=${locale}`;
      const detail = e.location
        ? `<span class="ev-note">${escapeHtml(e.location)}</span>`
        : "";
      return `
            <li>
              <a class="ev" href="${escapeHtml(href)}">
                <span class="ev-when">
                  <time class="ev-date" datetime="${escapeHtml(e.start)}">${escapeHtml(
                    eventDay(locale, e),
                  )}</time>
                  <span class="ev-time">${escapeHtml(eventTime(locale, s, e))}</span>
                </span>
                <span class="ev-what">
                  <span class="ev-name">${escapeHtml(e.title)}</span>
                  ${detail}
                </span>
              </a>
            </li>`;
    })
    .join("");

  return `
      <section class="ev-sect">
        <div class="wrap ev-in">
          <div>
            <p class="eyebrow">${escapeHtml(s.calendarTitle)}</p>
            <h2>${escapeHtml(s.upcomingEvents)}</h2>
            <a class="ev-all" href="${escapeHtml(
              appHref(env.CALENDAR_URL, "/", locale),
            )}">${escapeHtml(s.seeAll)} <span aria-hidden="true">&#8594;</span></a>
          </div>
          <ol class="ev-list">${rows}</ol>
        </div>
      </section>`;
}

/** "Tue, Oct 6" in the school's timezone — the day the calendar itself files
 *  the event under, not the day it falls on wherever the reader happens to be. */
function eventDay(locale: Locale, e: PublicCalendarEventDTO): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: e.allDay ? "UTC" : DEFAULT_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(e.start));
}

/** The clock time, or the words "all day". An all-day event is stored at UTC
 *  midnight (see `eventDateSegment`), so rendering a time for it would be a
 *  lie in either direction. */
function eventTime(locale: Locale, s: Strings, e: PublicCalendarEventDTO): string {
  if (e.allDay) return s.allDay;
  const fmt = new Intl.DateTimeFormat(locale, {
    timeZone: DEFAULT_TIME_ZONE,
    hour: "numeric",
    minute: "numeric",
  });
  const start = new Date(e.start);
  const end = e.end ? new Date(e.end) : null;
  return end && end > start ? fmt.formatRange(start, end) : fmt.format(start);
}

/** Everything the district publishes that a family actually reaches for: the
 *  numbers to call and the pages to open.
 *
 *  Unlike the events above, none of it expires, so it is transcribed rather
 *  than fetched (`district.ts`). Three columns, because that is genuinely three
 *  different questions — who at this school, who at the district, and where to
 *  read the rest — plus every other school office folded behind a `<details>`
 *  for the families with an older sibling across town. */
function renderHelp(env: Env, locale: Locale): string {
  const s = dictionaries[locale];

  const ours = [
    `<div class="row">
                  <dt>${escapeHtml(s.landingFactHours)}</dt>
                  <dd class="hours">${escapeHtml(schoolHours(locale))}</dd>
                </div>`,
    ...SCHOOL_PHONES.map((p) => phoneRow(s, p)),
  ].join("");

  const district = DISTRICT_PHONES.map((p) => phoneRow(s, p)).join("");

  // The printed URL is a link too, not decoration — it is the half of the row
  // someone reads out over the phone or copies onto a fridge, and a URL that
  // looks like a link and isn't one is just a broken one. It goes out
  // `aria-hidden`/`tabindex="-1"` so a screen reader and the tab key get ONE
  // link per row rather than two to the same page; the name above it is that
  // link, and it says what the page is.
  const resources = RESOURCES.map(
    (r) => `
                <li>
                  <a class="res-name" href="${escapeHtml(r.href)}">${escapeHtml(
                    s[r.key],
                  )}</a>
                  <p class="res-note">${resourceNote(s, r)}</p>
                  <a class="res-url" href="${escapeHtml(
                    r.href,
                  )}" aria-hidden="true" tabindex="-1">${escapeHtml(r.label)}</a>
                </li>`,
  ).join("");

  const others = OTHER_SCHOOLS.map(
    (o) => `
                <div class="row">
                  <dt>${escapeHtml(o.name)}</dt>
                  <dd><a href="${escapeHtml(hrefOf(o))}">${escapeHtml(o.phone)}</a></dd>
                </div>`,
  ).join("");

  return `
      <section class="help">
        <div class="wrap">
          <p class="eyebrow">${escapeHtml(s.landingHelpEyebrow)}</p>
          <h2>${escapeHtml(s.landingHelpTitle)}</h2>

          <div class="help-grid">
            <div class="col">
              <h3>${escapeHtml(SCHOOL_LABEL)}</h3>
              <dl class="rows">${ours}</dl>
            </div>
            <div class="col">
              <h3>${escapeHtml(s.landingContactsDistrict)}</h3>
              <dl class="rows tight">${district}</dl>
            </div>
            <div class="col">
              <h3>${escapeHtml(s.landingResourcesTitle)}</h3>
              <ul class="res">${resources}</ul>
            </div>
          </div>

          <details class="others">
            <summary>${escapeHtml(s.landingContactsSchools)}</summary>
            <dl class="rows tight">${others}</dl>
          </details>

          ${source(s, env, DISTRICT_ADDRESS)}
        </div>
      </section>`;
}

function phoneRow(s: Strings, p: PhoneRow): string {
  const note = p.noteKey ? `<p class="rownote">${escapeHtml(s[p.noteKey])}</p>` : "";
  return `
                <div class="row">
                  <dt>${escapeHtml(s[p.key])}</dt>
                  <dd><a href="${escapeHtml(hrefOf(p))}">${escapeHtml(p.phone)}</a></dd>
                  ${note}
                </div>`;
}

/** One resource's line of detail. The bus one names an address the reader may
 *  want to write to, so its `{email}` slot becomes a real `mailto:`. */
function resourceNote(s: Strings, r: Resource): string {
  const note = s[r.noteKey];
  return note.includes("{email}")
    ? linkSlot(note, "email", BUS_EMAIL, `mailto:${BUS_EMAIL}`)
    : escapeHtml(note);
}

/** The bell times, in whichever clock convention the reader's language uses —
 *  "7:40 AM – 2:10 PM" in English, "07:40–14:10" in Chinese. */
function schoolHours(locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: DEFAULT_TIME_ZONE,
    hour: "numeric",
    minute: "numeric",
  }).formatRange(new Date(SCHOOL_HOURS.start), new Date(SCHOOL_HOURS.end));
}

/** Structured data naming the organization and where it is.
 *
 *  This is the only page in the project that asks to be indexed, so it is also
 *  the only place a search engine can learn that any of this is in Hopkins —
 *  which is what a parent typing "Eisenhower Hopkins" is looking for. The
 *  region goes out as a CODE here rather than the spelled-out name in the
 *  visible stamp, because that is what schema.org's `addressRegion` wants in
 *  the US.
 *
 *  Serialized with JSON.stringify and then escaped for `</script`, which is the
 *  one sequence that can end the block early; every value in it is
 *  configuration, but configuration is exactly what the escaping test feeds a
 *  `<script>` tag through. */
function jsonLd(env: Env, description: string): string {
  const origin = env.SITE_ORIGIN.replace(/\/$/, "");
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: env.SCHOOL_NAME,
    description,
    url: `${origin}/`,
    inLanguage: [...LOCALES],
    address: {
      "@type": "PostalAddress",
      addressLocality: env.SCHOOL_CITY,
      addressRegion: env.SCHOOL_REGION_CODE,
      addressCountry: "US",
    },
    areaServed: {
      "@type": "Place",
      name: `${env.SCHOOL_CITY}, ${env.SCHOOL_REGION}`,
    },
    email: env.FEEDBACK_EMAIL,
    sameAs: [env.SCHOOL_SITE_URL],
  };
  const json = JSON.stringify(data).replace(/<\//g, "<\\/");
  return `<script type="application/ld+json">${json}</script>`;
}

export function renderNotFound(env: Env, locale: Locale): string {
  const s = dictionaries[locale];
  const origin = env.SITE_ORIGIN.replace(/\/$/, "");
  return document({
    lang: locale,
    title: interpolate(s.landingTitle, { school: env.SCHOOL_NAME }),
    description: "",
    canonical: `${origin}/`,
    head: '<meta name="robots" content="noindex" />',
    body: `
    <main class="wrap gone">
      <h1>404</h1>
      <p>${escapeHtml(interpolate(s.landingLead, { school: env.SCHOOL_NAME }))}</p>
      <a class="btn btn-primary" href="${langHref(locale)}">${escapeHtml(s.landingWelcome)}</a>
    </main>`,
  });
}

interface DocumentInput {
  lang: Locale;
  title: string;
  description: string;
  canonical: string;
  /** Pre-escaped markup for the end of `<head>`. */
  head: string;
  /** Pre-escaped markup for `<body>`. */
  body: string;
}

function document(input: DocumentInput): string {
  const desc = input.description
    ? `<meta name="description" content="${escapeHtml(input.description)}" />
    <meta property="og:description" content="${escapeHtml(input.description)}" />`
    : "";
  return `<!doctype html>
<html lang="${input.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light" />
    <meta name="theme-color" content="#ffffff" />
    <title>${escapeHtml(input.title)}</title>
    ${desc}
    <link rel="canonical" href="${escapeHtml(input.canonical)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(input.title)}" />
    <meta property="og:url" content="${escapeHtml(input.canonical)}" />
    <meta property="og:locale" content="${input.lang}" />
    <meta name="twitter:card" content="summary" />
    <link rel="icon" href="${FAVICON}" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="${FONTS}" />
    ${input.head}
    <style>${STYLES}</style>
  </head>
  <body>
${input.body}
  </body>
</html>`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

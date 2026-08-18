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
  LOCALES,
  dictionaries,
  interpolate,
  localeNames,
  type Locale,
  type Strings,
} from "@sd/shared";
import type { Env } from "./env.js";
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

/** Interpolate a value into a sentence and wrap it in `<b>`, escaping both
 *  halves of the sentence and the value itself. */
function emphasize(template: string, value: string): string {
  const [before = "", after = ""] = interpolate(template, { feature: SLOT }).split(SLOT);
  return `${escapeHtml(before)}<b>${escapeHtml(value)}</b>${escapeHtml(after)}`;
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

export function renderHome(env: Env, locale: Locale, explicit: boolean): string {
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

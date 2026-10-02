// Machine translation for newsletter issues.
//
// A newsletter's body is MEMBER-ENTERED CONTENT, which invariant 6 says we never
// translate: the dictionaries in i18n.ts translate our own chrome, and there is
// nobody in this school who is going to hand-write a Somali edition of every
// issue. So the honest thing to offer a family that doesn't read English is not
// a translation we made, but a link to a machine translation they can get for
// free — clearly a machine's work, and clearly not the PTO's words.
//
// The service is Google's page-translation proxy: it fetches a PUBLIC url and
// re-serves it translated from `<host>.translate.goog`, with no API key, no
// account and no cost. That last property is what makes it the right shape here.
// A translation API would be a per-send bill, a secret to hold and a second
// rendering of an issue to keep in step with the email (invariant 9's whole
// complaint); the proxy renders the page we already publish.
//
// Two rules govern where these links may appear, and they are not style points:
//
//   1. ONLY on a sent issue's public archive page. The proxy has to fetch the
//      url from Google's own servers, so putting a url in one of these links
//      hands that url to a third party. Invariant 10 already says the archive
//      page is public and enumerable, so nothing crosses that boundary which
//      wasn't already on the open internet. A review-token url (invariant 15) is
//      the opposite: the token IS the authorization, it is revocable, and its
//      pages are `no-store` precisely so a cache can't outlive a revocation.
//      Sending one through a caching proxy would undo that in one click. Hence
//      `translateProxyUrl` refuses anything it can't see is a public origin, and
//      the callers pass "" for every token-reached and print surface.
//   2. Never inside the proxy. Google's fetcher forwards a page's query string
//      to the origin verbatim (it strips only its own `_x_tr_*` params — this is
//      measured, not assumed), so a `?lang=` link that redirects INTO the proxy
//      would, when clicked from within the proxy, ask the proxy to fetch a url
//      that redirects back into the proxy. That is why the two surfaces use two
//      link forms, below, rather than one.

import { LOCALES, type Locale } from "./types.js";
import { localeNames, LOCALE_PARAM } from "./i18n.js";

/** Our locale codes → the ones Google's proxy wants. Only `zh` differs: the
 *  proxy names the script, where our locale set names the language. */
export const PROXY_LANG: Record<Locale, string> = {
  en: "en",
  es: "es",
  zh: "zh-CN",
  so: "so",
};

/** `newsletter.eisenhower.school` → `newsletter-eisenhower-school.translate.goog`.
 *
 *  Google's scheme: dots become dashes, and a dash that was already there is
 *  doubled so the transform stays reversible. We have no hyphenated hostname
 *  today; the doubling is here so that adding one doesn't silently produce a
 *  url pointing at somebody else's site. */
function proxyHost(host: string): string {
  return `${host.replace(/-/g, "--").replace(/\./g, "-")}.translate.goog`;
}

/** Split an absolute https url into the pieces this file needs, or null.
 *
 *  Hand-parsed rather than with `URL` for the same reason `localeFromSearch` is:
 *  this package is imported by Workers and by browsers, and its tsconfig
 *  deliberately carries no DOM lib. The pattern is strict on purpose — anything
 *  it doesn't recognise becomes null, and null means "offer no link", which is
 *  the safe direction for a url we are about to hand to a third party. */
const ABSOLUTE_HTTPS = /^https:\/\/([a-z0-9.-]+)((?:\/[^?#]*)?)(\?[^#]*)?(#.*)?$/i;

/** The proxy url that renders `absoluteUrl` in `locale`, or null.
 *
 *  Null means "don't offer this link", and it is returned for three cases that
 *  all amount to the same thing — we cannot show that this url is publicly
 *  fetchable, so we must not hand it to a third party:
 *
 *    - the source language, which needs no proxy;
 *    - anything that isn't plain `https` on a bare hostname, which covers the
 *      `http://localhost:5175` of local dev, the relative `/n/:slug` the
 *      composer's preview passed before it was made absolute, and any url
 *      carrying a port or credentials;
 *    - a host with no dot in it, which no public site has.
 *
 *  `_x_tr_sl` names the language we are translating FROM and `_x_tr_hl` the
 *  language the proxy's own toolbar speaks — set to the target, so the reader's
 *  "show original" control is in a language they read. */
export function translateProxyUrl(
  absoluteUrl: string,
  locale: Locale,
  sourceLocale: Locale = "en",
): string | null {
  if (locale === sourceLocale) return null;

  const m = ABSOLUTE_HTTPS.exec(absoluteUrl.trim());
  if (!m) return null;

  const host = (m[1] ?? "").toLowerCase();
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".")) return null;

  const path = m[2] || "/";
  const query = m[3] ?? "";
  const hash = m[4] ?? "";

  const target = PROXY_LANG[locale];
  const params = `_x_tr_sl=${PROXY_LANG[sourceLocale]}&_x_tr_tl=${target}&_x_tr_hl=${target}`;
  const search = query === "" || query === "?" ? `?${params}` : `${query}&${params}`;

  return `https://${proxyHost(host)}${path}${search}${hash}`;
}

/** The `?lang=` form of the same link: our own url, on our own origin.
 *
 *  This is what goes in an EMAIL, and the indirection is the whole point. A sent
 *  issue is immutable and its links are permanent (invariant 10) — a url mailed
 *  today is still being clicked from an inbox in two years, and cannot be
 *  edited. Naming `translate.goog` directly in it would make Google's url scheme
 *  a thing this project can never change: if the proxy moves, or we decide the
 *  quality isn't good enough, every issue ever sent has a dead link in it.
 *  A `?lang=` url on our own origin keeps the destination ours to re-point, and
 *  it reuses the deep-link parameter every other surface in this project already
 *  honours rather than inventing a second one.
 *
 *  The redirect this resolves to lives in `apps/newsletter/functions/n/[slug].ts`,
 *  and note what it redirects TO: a proxy url carrying no `lang` of its own. That
 *  is what stops rule 2 above from biting, since the proxy's fetch of the origin
 *  then arrives clean. */
export function languageParamUrl(issueUrl: string, locale: Locale): string {
  const sep = issueUrl.includes("?") ? "&" : "?";
  return `${issueUrl}${sep}${LOCALE_PARAM}=${locale}`;
}

export interface NewsletterLanguageLink {
  locale: Locale;
  /** The language's OWN name — "Español", not "Spanish".
   *
   *  Deliberately the only text this feature emits, and the reason it needs no
   *  dictionary entry. A row of language names is legible to every reader in it;
   *  a label like "Read this in another language" is legible only to the readers
   *  who least need it, and inventing an English one would break invariant 6 on
   *  the one surface aimed at people who don't read English. */
  label: string;
  /** Absolute href, or "" for the language the issue is written in. */
  href: string;
  /** The source language: rendered as plain text, so a reader can see which one
   *  they are looking at. */
  isSource: boolean;
}

/** The bar, for one issue, in one of the two link forms.
 *
 *  `form: "param"` for the email (our origin, re-pointable — see above);
 *  `form: "proxy"` for the archive page, whose links name the proxy directly so
 *  that a reader on OUR origin goes straight to a translation. They only work
 *  from our origin, though: inside the proxy, Google rewrites every href on the
 *  page server-side, pinned to the language being shown — same-site ones to
 *  `translate.goog` in that language, every other one wrapped in
 *  `translate.google.com/website?tl=<that language>&u=…`, a `translate.goog`
 *  href included, which asks the proxy to proxy itself and fails with "Can't
 *  translate this page". (Measured: an earlier version of this comment said
 *  external hrefs were left alone, and the bar shipped broken on that belief.)
 *  No href we write survives that, so switching language from inside the proxy
 *  is `PROXY_LANGUAGE_SWITCH_JS`'s job, below.
 *
 *  Returns [] when no link can be built at all, which collapses the bar rather
 *  than rendering a row of dead text — local dev and the composer's preview both
 *  land here when they have no public url to offer. */
export function newsletterLanguageLinks(
  issueUrl: string,
  form: "param" | "proxy",
  sourceLocale: Locale = "en",
): NewsletterLanguageLink[] {
  if (!issueUrl) return [];

  const links: NewsletterLanguageLink[] = [];
  let translatable = 0;

  for (const locale of LOCALES) {
    if (locale === sourceLocale) {
      links.push({
        locale,
        label: localeNames[locale].native,
        href: "",
        isSource: true,
      });
      continue;
    }
    // Built even in "param" form: it is what proves the url is one the proxy
    // could serve, so a relative or localhost url drops out of both forms
    // identically instead of the email quietly offering links that 404.
    const proxied = translateProxyUrl(issueUrl, locale, sourceLocale);
    if (!proxied) continue;
    translatable += 1;
    links.push({
      locale,
      label: localeNames[locale].native,
      href: form === "proxy" ? proxied : languageParamUrl(issueUrl, locale),
      isSource: false,
    });
  }

  return translatable > 0 ? links : [];
}

/** The language bar's behaviour INSIDE the proxy, as the body of a function.
 *
 *  Google rewrites every href on a proxied page on its own servers (see
 *  `newsletterLanguageLinks`), so the bar's links arrive in the browser all
 *  pointing at the language already on screen, wrapped in a url the proxy
 *  cannot serve. Script is the one thing it passes through untouched, so this
 *  re-derives each link from where the reader actually IS: the same proxied url
 *  with `_x_tr_tl`/`_x_tr_hl` swapped, or — for the source language, which on
 *  our origin is plain text because the reader is holding it — the original
 *  page, recovered by reversing `proxyHost` and dropping the `_x_tr_*` params.
 *  It also moves `aria-current` to the language being shown. Every href it
 *  writes is ABSOLUTE: the proxy resolves a relative url against the ORIGINAL
 *  site, not the proxied one (measured — a relative `?_x_tr_tl=es` landed on
 *  our own origin, untranslated).
 *
 *  It reads `data-tr` (the proxy's code, `PROXY_LANG`) rather than `lang`, and
 *  navigates from a click handler as well as setting `href`, so that if Google's
 *  own script rewrites anchors after load the click still goes where it should.
 *  On our own origin it returns at the first line and the page's hrefs stand.
 *  Without JavaScript, the proxy's own toolbar still offers every language. */
export const PROXY_LANGUAGE_SWITCH_JS = `var S=".translate.goog",h=location.hostname;
if(h.slice(-S.length)!==S)return;
var q=new URLSearchParams(location.search),sl=q.get("_x_tr_sl")||"en",tl=q.get("_x_tr_tl")||sl;
var rest=new URLSearchParams();
q.forEach(function(v,k){if(k.indexOf("_x_tr_")!==0)rest.append(k,v)});
var src="https://"+h.slice(0,-S.length).replace(/--/g,"~").replace(/-/g,".").replace(/~/g,"-")+location.pathname+(rest.toString()?"?"+rest:"");
var els=document.querySelectorAll(".nl-lang [data-tr]");
for(var i=0;i<els.length;i++)(function(el){
var code=el.getAttribute("data-tr");
if(code===tl){el.removeAttribute("href");el.setAttribute("aria-current","true");return}
el.removeAttribute("aria-current");
var href=src;
if(code!==sl){var p=new URLSearchParams(q);p.set("_x_tr_tl",code);p.set("_x_tr_hl",code);href="https://"+h+location.pathname+"?"+p}
el.setAttribute("href",href);
el.addEventListener("click",function(e){e.preventDefault();location.assign(href)});
})(els[i]);`;

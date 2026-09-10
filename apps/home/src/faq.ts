// eisenhower.school/faq — the page that explains the site instead of being it,
// and /faq/print, the same thing as sheets of paper to hand out.
//
// Written for somebody who has not signed in and may never have seen any of
// this before: a parent handed the URL at back-to-school night. So it answers
// three questions in order — what is here, how do I get in, and who can see
// what — and it says the third one out loud, because "is my phone number about
// to be on the internet?" is the question that actually stops people joining.
//
// Two properties worth keeping:
//
//  - It makes NO subrequest. The landing page reads the upcoming events off
//    `/calendar-public/events`; this one reads nothing at all, so it is a pure
//    function of the URL, `Accept-Language` and the `sd_lang` cookie — the
//    shape invariant 28 praises in the PTO's public page. There is nothing here
//    that can go stale and nothing that can fail.
//  - Every word comes from the shared dictionaries (invariant 6), so it exists
//    in all four languages the moment `LOCALES` does. Its `?lang=` links point
//    back at THIS path rather than at `/`, so switching language keeps your
//    place.
//
// `/faq` is the fourth indexed surface in the project, after the landing page,
// the storefront and the PTO page, and it inherits their obligation exactly:
// nothing member-private may ever appear on it. Everything below is either
// dictionary copy or a hostname. `/faq/print` is NOT indexed — it is the same
// words in a shape meant for a printer, and two indexed copies of one text is
// how a site competes with itself.
//
// PRINTING IS THE WHOLE MECHANISM, per invariant 16: there is no PDF library
// here and there must not be one. `@media print` lives in the ordinary
// stylesheet, so Ctrl+P on `/faq?lang=so` already yields the Somali sheet;
// `/faq/print` exists only because handing out a stack means wanting all four
// languages from ONE print run, which no amount of print CSS on a single-
// language page can give you.

import {
  LOCALES,
  dictionaries,
  interpolate,
  localeNames,
  type Locale,
  type Strings,
} from "@sd/shared";
import type { Env } from "./env.js";
import {
  PIN,
  alternatesFor,
  appHref,
  document,
  escapeHtml,
  hostOf,
  langBar,
  langHref,
  siteFooter,
  siteHeader,
  splitSlot,
} from "./shell.js";

/** The paths these pages live at. Exported so the router, the sitemap and the
 *  `?lang=` links the pages print about themselves can never disagree. */
export const FAQ_PATH = "/faq";
export const FAQ_PRINT_PATH = "/faq/print";

interface Place {
  title: string;
  body: string;
  href: string;
  host: string;
  /** Which of the two audience tags this surface carries. */
  membersOnly: boolean;
}

/** Everything both renderings say, built once.
 *
 *  The screen page and the printed sheet are the same words in two shapes, and
 *  a second copy of them is a second place for the two to drift — the mistake
 *  invariant 9 spends a whole renderer avoiding for the newsletter. So the
 *  sections are built here and arranged by the callers.
 */
function sections(env: Env, locale: Locale) {
  const s: Strings = dictionaries[locale];
  const t = (key: keyof Strings, vars?: Record<string, string>): string =>
    interpolate(s[key], vars);
  const school = env.SCHOOL_NAME;
  const origin = env.SITE_ORIGIN.replace(/\/$/, "");

  // Same five surfaces the landing page lists, in the same order and with the
  // same two tags — except that volunteering, which is a feature of the
  // calendar rather than a site of its own, gets a row here because "can
  // anyone see who signed up?" is one of the questions this page exists to
  // answer. Its tag is the members-only one: the COUNT is public, claiming a
  // spot is not.
  const places: Place[] = [
    {
      title: t("navDir"),
      body: t("landingDirBody"),
      href: appHref(env.DIRECTORY_URL, "/", locale),
      host: hostOf(env.DIRECTORY_URL),
      membersOnly: true,
    },
    {
      title: t("calendarTitle"),
      body: t("landingCalBody"),
      href: appHref(env.CALENDAR_URL, "/", locale),
      host: hostOf(env.CALENDAR_URL),
      membersOnly: false,
    },
    {
      title: t("faqVolunteerTitle"),
      body: t("faqVolunteerBody"),
      href: appHref(env.CALENDAR_URL, "/", locale),
      host: hostOf(env.CALENDAR_URL),
      membersOnly: true,
    },
    {
      title: t("landingNewsTitle"),
      body: t("landingNewsBody"),
      href: appHref(env.NEWSLETTER_URL, "/", locale),
      host: hostOf(env.NEWSLETTER_URL),
      membersOnly: false,
    },
    {
      title: t("ptoTitle"),
      body: t("landingPtoBody"),
      href: appHref(env.PTO_URL, "/", locale),
      host: hostOf(env.PTO_URL),
      membersOnly: false,
    },
  ];

  const placesHtml = `<ul class="fq-places">${places
    .map(
      (p) => `
            <li>
              <div class="fq-top">
                <a class="fq-name" href="${escapeHtml(p.href)}">${escapeHtml(p.title)}</a>
                <span class="tag ${p.membersOnly ? "tag-members" : "tag-open"}">${escapeHtml(
                  p.membersOnly ? s.landingMembersOnly : s.landingOpenToAll,
                )}</span>
              </div>
              <p>${escapeHtml(p.body)}</p>
              <p class="host">${escapeHtml(p.host)}</p>
            </li>`,
    )
    .join("")}</ul>`;

  // The one numbered sequence on the page, because it is the one thing here
  // that genuinely happens in an order. Step one names the host and step two
  // the button, both interpolated so a translator can put them where their own
  // sentence wants them.
  const steps = [
    {
      title: escapeHtml(t("faqStep1Title", { host: hostOf(origin) })),
      body: boldSlot(s.faqStep1Body, "action", s.landingCreateAccount),
    },
    { title: escapeHtml(t("faqStep2Title")), body: escapeHtml(t("faqStep2Body")) },
    { title: escapeHtml(t("faqStep3Title")), body: escapeHtml(t("faqStep3Body")) },
  ];

  const stepsHtml = `<ol class="fq-steps">${steps
    .map(
      (step, i) => `
            <li>
              <div class="fq-step-n" aria-hidden="true">${i + 1}</div>
              <div>
                <p class="fq-step-t">${step.title}</p>
                <p class="fq-step-b">${step.body}</p>
              </div>
            </li>`,
    )
    .join("")}</ol>
          <p class="fq-aside">
            <b>${escapeHtml(t("faqFamilyTitle"))}</b> ${escapeHtml(t("faqFamilyBody"))}
          </p>`;

  // Members / Private / Shared, in the app's own words and the app's own three
  // colours. There is deliberately no fourth chip, and the paragraph under
  // them says so — the absence is the point, and an absence has to be stated
  // or nobody notices it.
  const chips: [string, string, string][] = [
    ["members", s.visMembers, t("visMembersDesc", { school })],
    ["private", s.visPrivate, t("visPrivateDesc")],
    ["shared", s.visShared, t("visSharedDesc")],
  ];
  const privacyHtml = `
          <h2>${escapeHtml(t("faqPrivacyTitle"))}</h2>
          <div class="fq-viss">${chips
            .map(
              ([kind, label, desc]) => `
              <div class="fq-vis">
                <span class="chip chip-${kind}">${escapeHtml(label)}</span>
                <p>${escapeHtml(desc)}</p>
              </div>`,
            )
            .join("")}</div>
          <p class="fq-nopublic">
            <b>${escapeHtml(t("faqNoPublicLead"))}</b>
            ${escapeHtml(t("faqNoPublicBody", { school }))}
          </p>`;

  const notes: [string, string][] = [
    [s.faqAddressTitle, s.faqAddressBody],
    [s.faqNeighborsTitle, s.faqNeighborsBody],
    [s.faqUnlistedTitle, s.faqUnlistedBody],
  ];
  const notesHtml = `<div class="fq-notes">${notes
    .map(
      ([h, b]) => `
              <div>
                <h3>${escapeHtml(h)}</h3>
                <p>${escapeHtml(b)}</p>
              </div>`,
    )
    .join("")}</div>`;

  return { s, t, school, origin, placesHtml, stepsHtml, privacyHtml, notesHtml };
}

export function renderFaq(env: Env, locale: Locale, explicit: boolean): string {
  const { s, t, school, origin, placesHtml, stepsHtml, privacyHtml, notesHtml } = sections(
    env,
    locale,
  );
  const city = `${env.SCHOOL_CITY}, ${env.SCHOOL_REGION}`;
  const languages = LOCALES.map((l) => localeNames[l].native).join(" · ");

  const body = `
    ${siteHeader(env, locale, s)}

    <main>
      <section class="fq-hero">
        <div class="wrap">
          <p class="eyebrow place">${PIN}${escapeHtml(city)}</p>
          <h1>${escapeHtml(t("faqTitle"))}</h1>
          <p class="fq-lead">${escapeHtml(t("faqLead", { school }))}</p>
          ${langBar(locale, FAQ_PATH, origin)}
        </div>
      </section>

      <section class="fq-sect">
        <div class="wrap">
          <p class="eyebrow">${escapeHtml(t("landingWhatsHere"))}</p>
          ${placesHtml}
        </div>
      </section>

      <section class="fq-sect">
        <div class="wrap fq-split">
          <div>
            <h2>${escapeHtml(t("faqGetInTitle"))}</h2>
            ${stepsHtml}
          </div>
          <div class="card fq-privacy">${privacyHtml}</div>
        </div>
      </section>

      <section class="fq-sect">
        <div class="wrap">
          <p class="eyebrow">${escapeHtml(t("faqKnowTitle"))}</p>
          ${notesHtml}
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

    ${siteFooter(env, locale, s)}`;

  return document({
    lang: locale,
    title: `${t("faqTitle")} — ${school}`,
    description: t("faqDescription", { school, city, languages }),
    // An explicit `?lang=` is its own document with its own canonical, exactly
    // as on the landing page — that is what makes the hreflang set coherent.
    canonical: `${origin}${explicit ? langHref(locale, FAQ_PATH) : FAQ_PATH}`,
    head: alternatesFor(origin, FAQ_PATH),
    body,
  });
}

/**
 * /faq/print — the handout.
 *
 * One sheet per language, page-broken, so a single print run produces the
 * whole stack. `?lang=` narrows it to one language for when you only need
 * more of the Somali.
 *
 * There is deliberately NO auto-firing print dialog, unlike the newsletter's
 * `/print` twin. That would be the first byte of JavaScript this Worker has
 * ever shipped, and "no client bundle" is a property of this hostname worth
 * more than one saved keystroke — the reader is already at a URL they typed in
 * order to print.
 *
 * Each sheet is standalone because a sheet is what a person walks away with:
 * it names the site, an address to write to, and the other languages it exists
 * in, so a Somali-speaking parent handed the English one can find theirs.
 */
export function renderFaqPrint(env: Env, only: Locale | null): string {
  const locales = only ? [only] : LOCALES;
  const sheets = locales.map((locale) => sheet(env, locale)).join("\n");

  return document({
    // The document's own language is the first sheet's; each sheet then carries
    // its own `lang`, which is what a screen reader and a hyphenation engine
    // actually need.
    lang: locales[0] ?? "en",
    title: `${dictionaries[locales[0] ?? "en"].faqTitle} — ${env.SCHOOL_NAME}`,
    description: "",
    canonical: `${env.SITE_ORIGIN.replace(/\/$/, "")}${FAQ_PRINT_PATH}`,
    // Not indexed: it is the same words as /faq in a shape meant for a printer,
    // and two indexed copies of one text is how a site competes with itself.
    head: '<meta name="robots" content="noindex" />',
    body: `<main class="pr">${sheets}</main>`,
  });
}

function sheet(env: Env, locale: Locale): string {
  const { s, t, school, origin, placesHtml, stepsHtml, privacyHtml, notesHtml } = sections(
    env,
    locale,
  );

  // The languages this exists in, each named in its own language and each with
  // the URL that reaches it. On screen the picker is a set of links; on paper a
  // link is useless, so the URL has to be written out — this line is how the
  // parent holding the wrong sheet finds the right one.
  const others = LOCALES.map((l) => {
    const name = escapeHtml(localeNames[l].native);
    const url = escapeHtml(`${hostOf(origin)}${langHref(l, FAQ_PATH)}`);
    return l === locale
      ? `<li><strong lang="${l}">${name}</strong></li>`
      : `<li lang="${l}">${name} <span class="pr-url">${url}</span></li>`;
  }).join("");

  return `
    <article class="pr-sheet" lang="${locale}">
      <header class="pr-head">
        <p class="pr-brand">${escapeHtml(school)}</p>
        <h1>${escapeHtml(t("faqTitle"))}</h1>
        <p class="pr-lead">${escapeHtml(t("faqLead", { school }))}</p>
      </header>

      <div class="pr-cols">
        <section class="pr-block">
          <h2>${escapeHtml(t("landingWhatsHere"))}</h2>
          ${placesHtml}
        </section>
        <section class="pr-block">
          <h2>${escapeHtml(t("faqGetInTitle"))}</h2>
          ${stepsHtml}
        </section>
      </div>

      <section class="pr-block pr-privacy">${privacyHtml}</section>

      <section class="pr-block">
        <h2>${escapeHtml(t("faqKnowTitle"))}</h2>
        ${notesHtml}
      </section>

      <footer class="pr-foot">
        <p class="pr-where">
          <strong>${escapeHtml(hostOf(origin))}</strong>
          <span aria-hidden="true"> · </span>
          <span class="pr-url">${escapeHtml(env.FEEDBACK_EMAIL)}</span>
        </p>
        <ul class="pr-langs">${others}</ul>
      </footer>
    </article>`;
}

/** Put a value into a translated sentence and bold it, escaping both halves.
 *  `emphasize` in the shell does this for the fixed key `feature`; this is the
 *  same trick with the key named, which is what the steps need. */
function boldSlot(template: string, key: string, value: string): string {
  const [before, after] = splitSlot(template, key);
  return `${escapeHtml(before)}<b>${escapeHtml(value)}</b>${escapeHtml(after)}`;
}

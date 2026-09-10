// eisenhower.school/faq — the page that explains the site instead of being it.
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
// It is the fourth indexed surface in the project, after the landing page, the
// storefront and the PTO page — and it inherits their obligation exactly:
// nothing member-private may ever appear on it. Everything below is either
// dictionary copy or a hostname.

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

/** The path this page lives at. Exported so the router and the sitemap can
 *  never disagree with the `?lang=` links the page prints about itself. */
export const FAQ_PATH = "/faq";

interface Place {
  title: string;
  body: string;
  href: string;
  host: string;
  /** Which of the two audience tags this surface carries. */
  membersOnly: boolean;
}

export function renderFaq(env: Env, locale: Locale, explicit: boolean): string {
  const s: Strings = dictionaries[locale];
  const t = (key: keyof Strings, vars?: Record<string, string>): string =>
    interpolate(s[key], vars);

  const school = env.SCHOOL_NAME;
  const origin = env.SITE_ORIGIN.replace(/\/$/, "");
  const city = `${env.SCHOOL_CITY}, ${env.SCHOOL_REGION}`;
  const languages = LOCALES.map((l) => localeNames[l].native).join(" · ");

  const title = `${t("faqTitle")} — ${school}`;
  const description = t("faqDescription", { school, city, languages });

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

  const placeHtml = places
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
    .join("");

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

  const stepHtml = steps
    .map(
      (step, i) => `
            <li style="--i:${i}">
              <div class="fq-step-n" aria-hidden="true">${i + 1}</div>
              <div>
                <p class="fq-step-t">${step.title}</p>
                <p class="fq-step-b">${step.body}</p>
              </div>
            </li>`,
    )
    .join("");

  // Members / Private / Shared, in the app's own words and the app's own three
  // colours. There is deliberately no fourth chip, and the paragraph under
  // them says so — the absence is the point, and an absence has to be stated
  // or nobody notices it.
  const chips: [string, string, string][] = [
    ["members", s.visMembers, t("visMembersDesc", { school })],
    ["private", s.visPrivate, t("visPrivateDesc")],
    ["shared", s.visShared, t("visSharedDesc")],
  ];
  const chipHtml = chips
    .map(
      ([kind, label, desc]) => `
              <div class="fq-vis">
                <span class="chip chip-${kind}">${escapeHtml(label)}</span>
                <p>${escapeHtml(desc)}</p>
              </div>`,
    )
    .join("");

  const notes: [string, string][] = [
    [s.faqAddressTitle, s.faqAddressBody],
    [s.faqNeighborsTitle, s.faqNeighborsBody],
    [s.faqUnlistedTitle, s.faqUnlistedBody],
  ];
  const noteHtml = notes
    .map(
      ([h, b]) => `
              <div>
                <h3>${escapeHtml(h)}</h3>
                <p>${escapeHtml(b)}</p>
              </div>`,
    )
    .join("");

  const body = `
    ${siteHeader(env, locale, s)}

    <main>
      <section class="fq-hero">
        <div class="wrap">
          <p class="eyebrow place">${PIN}${escapeHtml(city)}</p>
          <h1>${escapeHtml(t("faqTitle"))}</h1>
          <p class="fq-lead">${escapeHtml(t("faqLead", { school }))}</p>
          ${langBar(locale, FAQ_PATH)}
        </div>
      </section>

      <section class="fq-sect">
        <div class="wrap">
          <p class="eyebrow">${escapeHtml(t("landingWhatsHere"))}</p>
          <ul class="fq-places">${placeHtml}</ul>
        </div>
      </section>

      <section class="fq-sect">
        <div class="wrap fq-split">
          <div>
            <h2>${escapeHtml(t("faqGetInTitle"))}</h2>
            <ol class="fq-steps">${stepHtml}</ol>
            <p class="fq-aside">
              <b>${escapeHtml(t("faqFamilyTitle"))}</b> ${escapeHtml(t("faqFamilyBody"))}
            </p>
          </div>
          <div class="card fq-privacy">
            <h2>${escapeHtml(t("faqPrivacyTitle"))}</h2>
            <div class="fq-viss">${chipHtml}</div>
            <p class="fq-nopublic">
              <b>${escapeHtml(t("faqNoPublicLead"))}</b>
              ${escapeHtml(t("faqNoPublicBody", { school }))}
            </p>
          </div>
        </div>
      </section>

      <section class="fq-sect">
        <div class="wrap">
          <p class="eyebrow">${escapeHtml(t("faqKnowTitle"))}</p>
          <div class="fq-notes">${noteHtml}</div>
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
    title,
    description,
    // An explicit `?lang=` is its own document with its own canonical, exactly
    // as on the landing page — that is what makes the hreflang set coherent.
    canonical: `${origin}${explicit ? langHref(locale, FAQ_PATH) : FAQ_PATH}`,
    head: alternatesFor(origin, FAQ_PATH),
    body,
  });
}

/** Put a value into a translated sentence and bold it, escaping both halves.
 *  `emphasize` in the shell does this for the fixed key `feature`; this is the
 *  same trick with the key named, which is what the steps need. */
function boldSlot(template: string, key: string, value: string): string {
  const [before, after] = splitSlot(template, key);
  return `${escapeHtml(before)}<b>${escapeHtml(value)}</b>${escapeHtml(after)}`;
}

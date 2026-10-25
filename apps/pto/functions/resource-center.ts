// GET /resource-center — the Resource Center's own page.
//
// Split out of /how-to-help at the board's request so the page can be the URL
// on a flyer: a family handed "pto.eisenhower.school/resource-center" should
// land on the Resource Center and nothing else, with no scrolling past the
// volunteer list and the wishlists to find it. Everything about the Center
// lives ONLY here now: the landing page's "Ways to help" grid carries a card
// that links to this page, and /how-to-help's hero button does the same.
//
// The THIRD indexed page on this origin — in the sitemap's PUBLIC_PATHS, with
// hreflang alternates, translated into all four languages. Every string here
// is a dictionary key the how-to-help section already carries (invariant 6),
// so the page shipped with zero new translations; the facts — the assistance
// form, the FRC's phone, the Amazon list, GiveMN — come from `_lib/pto.ts`.
//
// Like the landing page, IT MAKES NO SUBREQUEST AT ALL (invariant 28's
// strongest answer): a pure function of the URL, Accept-Language and the
// `sd_lang` cookie. Nothing to degrade when the API blips — the property a
// page whose URL is on paper especially wants.
//
// The page speaks to a family that NEEDS the Resource Center before one that
// can give to it: the hero's primary button is the assistance form, and the
// "Need assistance?" note sits above the giving cards. The flyer reaches both
// kinds of reader; the one in a hard month should not have to read past four
// cards about donating.

import type { Locale, Strings } from "@sd/shared";
import { footer, header } from "./_lib/chrome.js";
import { LANG_PARAM, langCookie, resolveLocale } from "./_lib/locale.js";
import { escapeHtml, html, shell, translator } from "./_lib/page.js";
import {
  ASSISTANCE_FORM_URL,
  DONATE,
  FRC_PHONE,
  PTO_EMAIL,
  WISHLISTS,
  telHref,
} from "./_lib/pto.js";
import { PTO_CSS } from "./_lib/styles.js";

const SCHOOL = "Eisenhower PTO";
const PATH = "/resource-center";

type T = (key: keyof Strings, vars?: Record<string, string>) => string;

/** A card with no link — the same shape /how-to-help's resource cards have. */
function card(t: T, title: keyof Strings, body: keyof Strings): string {
  return `        <div class="pt-card">
          <h3>${escapeHtml(t(title))}</h3>
          <p>${escapeHtml(t(body))}</p>
        </div>`;
}

/** A card whose last line is the one link that actually does the thing. */
function linkCard(t: T, title: keyof Strings, body: keyof Strings, href: string, label: string): string {
  return `        <div class="pt-card">
          <h3>${escapeHtml(t(title))}</h3>
          <p>${escapeHtml(t(body))}</p>
          <p><a href="${escapeHtml(href)}">${escapeHtml(label)} →</a></p>
        </div>`;
}

export const onRequestGet: PagesFunction = ({ request }) => {
  const url = new URL(request.url);
  const { locale, explicit } = resolveLocale(url, request);
  const t = translator(locale, SCHOOL);

  const title = `${t("ptoHowResourceTitle")} — ${SCHOOL}`;
  const description = t("ptoHowResourceLead");

  const body = `    <div class="pt-wrap">
${header(t, SCHOOL, locale, PATH)}

      <section class="pt-hero">
        <h1 class="pt-h1">${escapeHtml(t("ptoHowResourceTitle"))}</h1>
        <p class="pt-lead">${escapeHtml(t("ptoHowResourceLead"))}</p>
        <div class="pt-cta">
          <a class="pt-btn" href="${escapeHtml(ASSISTANCE_FORM_URL)}">${escapeHtml(t("ptoHowResourceFormCta"))}</a>
          <a class="pt-btn pt-btn-ghost" href="#give">${escapeHtml(t("ptoHelpTitle"))}</a>
        </div>
      </section>

      <section class="pt-sec">
        <div class="pt-grid">
${card(t, "ptoHowResourceWhat", "ptoHowResourceWhatBody")}
${card(t, "ptoHowResourceWho", "ptoHowResourceWhoBody")}
        </div>
        <div class="pt-note">
          <b>${escapeHtml(t("ptoHowResourceNoteTitle"))}</b> ${escapeHtml(
            t("ptoHowResourceNoteBody"),
          )} <a href="${escapeHtml(ASSISTANCE_FORM_URL)}">${escapeHtml(t("ptoHowResourceFormCta"))} →</a> · <a href="${escapeHtml(telHref(FRC_PHONE))}">${escapeHtml(FRC_PHONE)}</a>
        </div>
      </section>

      <section class="pt-sec" id="give">
        <h2 class="pt-h2">${escapeHtml(t("ptoHelpTitle"))}</h2>
        <div class="pt-grid">
${linkCard(t, "ptoHowResourceGive", "ptoHowResourceGiveBody", DONATE.url, t("ptoDonateCta"))}
${linkCard(t, "ptoHelpWishlist", "ptoHowWishlistFrcBody", WISHLISTS[2]!.url, t("ptoHowWishlistOpen"))}
${linkCard(t, "ptoHowResourceVolunteer", "ptoHowResourceVolunteerBody", `mailto:${PTO_EMAIL}`, PTO_EMAIL)}
        </div>
        <!-- The rest of the ways to help — internal, so the href keeps ?lang=
             the way every link on this origin does. -->
        <p class="pt-sub" style="margin-top:16px">
          <a href="${escapeHtml(`/how-to-help?${LANG_PARAM}=${locale}`)}"><b>${escapeHtml(t("ptoHelpMoreCta"))} →</b></a>
        </p>
      </section>

${footer(t, PATH, locale)}
    </div>`;

  return html(
    shell({
      title,
      description,
      canonical: `${url.origin}${PATH}`,
      locale,
      css: PTO_CSS,
      alternatesFor: `${url.origin}${PATH}`,
      body,
    }),
    200,
    // Remembered only when they SAID so — see _lib/locale.ts.
    explicit ? langCookie(locale) : undefined,
  );
};

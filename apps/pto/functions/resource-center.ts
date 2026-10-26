// GET /resource-center — the Resource Center's own page.
//
// Split out of the "how to help" content at the board's request so the page
// can be the URL on a flyer: a family handed
// "pto.eisenhower.school/resource-center" should land on the Resource Center
// and nothing else, with no scrolling past the volunteer list and the
// wishlists to find it. Everything about the Center lives ONLY here: the
// landing page's "Ways to help" grid carries a card that links to this page.
//
// The SECOND indexed page on this origin — in the sitemap's PUBLIC_PATHS, with
// hreflang alternates, translated into all four languages. Every string here
// is a dictionary key the landing page's help sections already carry
// (invariant 6), so the page shipped with zero new translations; the facts —
// the assistance form, the FRC's phone, the Amazon list, GiveMN — come from
// `_lib/pto.ts`.
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
//
// ORDER IS THE BOARD'S (Melanie's change request, 2026-10-23): the featured
// need first — swapped roughly monthly by rewriting ptoResourceFeatured* in
// the dictionaries — then how to apply, then the donate group highlighted as
// one block, then the volunteer sign-up, with the general what/how cards
// moved to the bottom. TODO: the Resource Center logo goes at the top once
// Niki sends the PNG (promised Mon 2026-10-26).

import type { Locale, Strings } from "@sd/shared";
import { footer, header } from "./_lib/chrome.js";
import { LANG_PARAM, langCookie, resolveLocale } from "./_lib/locale.js";
import { escapeHtml, html, shell, translator } from "./_lib/page.js";
import {
  ASSISTANCE_FORM_URL,
  DONATE,
  FRC_PHONE,
  FRC_SIGNUP,
  SQUARE_STORE,
  WISHLISTS,
  telHref,
} from "./_lib/pto.js";
import { PTO_CSS } from "./_lib/styles.js";

const SCHOOL = "Eisenhower PTO";
const PATH = "/resource-center";

type T = (key: keyof Strings, vars?: Record<string, string>) => string;

/** A card with no link — the landing page's card shape, minus the link line. */
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
        <p class="pt-lead" style="max-width:none">${escapeHtml(t("ptoHowResourceLead"))}</p>
        <div class="pt-cta">
          <a class="pt-btn" href="${escapeHtml(ASSISTANCE_FORM_URL)}">${escapeHtml(t("ptoHowResourceFormCta"))}</a>
          <a class="pt-btn pt-btn-ghost" href="#give">${escapeHtml(t("ptoResourceDonateTitle"))}</a>
        </div>
      </section>

      <!-- The featured need, then how to apply directly beneath it — the
           reader in a hard month still never scrolls past a donate card. -->
      <section class="pt-sec" style="padding-top:34px">
        <div class="pt-feature">
          <div class="pt-eyebrow">${escapeHtml(t("ptoResourceFeaturedTag"))}</div>
          <h2>${escapeHtml(t("ptoResourceFeaturedTitle"))}</h2>
          <p>${escapeHtml(t("ptoResourceFeaturedBody"))}</p>
        </div>
        <div class="pt-note">
          <b>${escapeHtml(t("ptoHowResourceNoteTitle"))}</b> ${escapeHtml(
            t("ptoHowResourceNoteBody"),
          )} <a href="${escapeHtml(ASSISTANCE_FORM_URL)}">${escapeHtml(t("ptoHowResourceFormCta"))} →</a> · <a href="${escapeHtml(telHref(FRC_PHONE))}">${escapeHtml(FRC_PHONE)}</a>
        </div>
      </section>

      <!-- "Ways to donate, highlighted as a group" — the board's words; the
           blue .pt-donate panel is the highlight. Exactly the three asks from
           the change request: the wishlist (the CURRENT list — see WISHLISTS
           in _lib/pto.ts), gift cards (no URL to give, so the card's link
           dials the FRC), and direct dollars through the Square store. GiveMN
           moved down to the general cards: it stays on the page, but the
           highlighted group is the board's list and nothing else. -->
      <section class="pt-sec" id="give">
        <div class="pt-donate">
          <h2 class="pt-h2">${escapeHtml(t("ptoResourceDonateTitle"))}</h2>
          <div class="pt-grid" style="margin-top:18px">
${linkCard(t, "ptoHelpWishlist", "ptoHowWishlistFrcBody", WISHLISTS[2]!.url, t("ptoHowWishlistOpen"))}
${linkCard(t, "ptoResourceGiftCards", "ptoResourceGiftCardsBody", telHref(FRC_PHONE), FRC_PHONE)}
${linkCard(t, "ptoResourceSquare", "ptoResourceSquareBody", SQUARE_STORE.url, t("ptoResourceSquareCta"))}
          </div>
        </div>
        <!-- The rest of the ways to help — internal, so the href keeps ?lang=
             the way every link on this origin does. -->
        <p class="pt-sub" style="margin-top:16px">
          <a href="${escapeHtml(`/?${LANG_PARAM}=${locale}#help`)}"><b>${escapeHtml(t("ptoHelpMoreCta"))} →</b></a>
        </p>
      </section>

      <!-- The FRC's recurring shifts live on SignUpGenius by the board's
           explicit choice — the exception _lib/pto.ts's header documents. -->
      <section class="pt-sec">
        <h2 class="pt-h2">${escapeHtml(t("ptoHowResourceVolunteer"))}</h2>
        <p class="pt-sub">${escapeHtml(t("ptoHowResourceVolunteerBody"))}</p>
        <div class="pt-cta" style="margin-top:0">
          <a class="pt-btn" href="${escapeHtml(FRC_SIGNUP.url)}">${escapeHtml(t("ptoResourceSignupCta"))}</a>
        </div>
      </section>

      <!-- General Resource Center information, moved to the bottom at the
           board's request. "How to give" (GiveMN, cash, checks) rides here
           rather than in the highlighted group above. -->
      <section class="pt-sec">
        <div class="pt-grid">
${card(t, "ptoHowResourceWhat", "ptoHowResourceWhatBody")}
${card(t, "ptoHowResourceWho", "ptoHowResourceWhoBody")}
${linkCard(t, "ptoHowResourceGive", "ptoHowResourceGiveBody", DONATE.url, t("ptoDonateCta"))}
        </div>
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

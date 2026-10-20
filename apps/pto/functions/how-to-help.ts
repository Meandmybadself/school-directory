// GET /how-to-help — the deeper half of the landing page's "Ways to help":
// the Resource Center, the volunteer work, and the teacher wishlists.
//
// The landing page answers "what is the PTO?" and gives helping one section;
// this page is for the family who already wants to help and is asking HOW. It
// is the SECOND public page on this origin and follows every rule the first
// one set: server-rendered, indexed (so it is in the sitemap — see
// functions/sitemap.xml.ts), translated, and — invariant 28 — IT MAKES NO
// SUBREQUEST AT ALL. A pure function of the requested URL, the Accept-Language
// header and the `sd_lang` cookie.
//
// That rule shapes the volunteer section, so the shape is worth stating:
// "available volunteer opportunities" sounds like a live read, and it is — on
// the CALENDAR, whose public /volunteers screen lists every upcoming event
// with an open spot from the anonymous projections (invariants 12 and 13).
// This page names the recurring events a reader can watch for (data that never
// expires, from `_lib/pto.ts`) and links out to that screen for what is open
// right now. A copy of "what needs help" rendered here would be wrong within
// the week, and this page has no editor — the same reasoning that keeps dates
// off the landing page's year strip.
//
// The Resource Center section has one line aimed the other way — at a family
// that needs it rather than one that can give. It ends in the office's phone
// number, appended as a tel: link AFTER the translated sentence so the
// sentence reads complete without it in every language.

import type { Strings } from "@sd/shared";
import { CALENDAR_URL, appHref, footer, header } from "./_lib/chrome.js";
import { langCookie, resolveLocale } from "./_lib/locale.js";
import { escapeHtml, html, shell, translator } from "./_lib/page.js";
import { DONATE, ORG, VOLUNTEER_EVENTS, WISHLISTS, telHref } from "./_lib/pto.js";
import { PTO_CSS } from "./_lib/styles.js";

const SCHOOL = "Eisenhower PTO";
const PATH = "/how-to-help";

type T = (key: keyof Strings, vars?: Record<string, string>) => string;

/** A card with no link — the Resource Center's "what" and "how". */
function card(t: T, title: keyof Strings, body: keyof Strings): string {
  return `        <div class="pt-card">
          <h3>${escapeHtml(t(title))}</h3>
          <p>${escapeHtml(t(body))}</p>
        </div>`;
}

/** A card whose last line is the one link that actually does the thing — the
 *  same shape the landing page's help cards have. */
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

  const title = `${t("ptoHowTitle")} — ${SCHOOL}`;
  const description = t("ptoHowLead");

  // The recurring-events strip: the same tags the landing page's year strip
  // wears, so the two pages say "Field Day" in the same colour.
  const recurring = VOLUNTEER_EVENTS.map(
    (e) => `          <span class="pt-tag t-${escapeHtml(e.category)}">${escapeHtml(e.name)}</span>`,
  ).join("\n");

  // The two school-wide lists, paired with their copy by POSITION — WISHLISTS
  // is ordered (staff lounge, then art room) and the landing page's help
  // section already depends on that order the same way.
  const wishlistCards = [
    { title: "ptoHowWishlistLounge", body: "ptoHowWishlistLoungeBody", link: WISHLISTS[0]! },
    { title: "ptoHowWishlistArt", body: "ptoHowWishlistArtBody", link: WISHLISTS[1]! },
  ] as const;

  const body = `    <div class="pt-wrap">
${header(t, SCHOOL, locale, PATH)}

      <section class="pt-hero">
        <h1 class="pt-h1">${escapeHtml(t("ptoHowTitle"))}</h1>
        <p class="pt-lead">${escapeHtml(t("ptoHowLead"))}</p>
        <div class="pt-cta">
          <a class="pt-btn pt-btn-ghost" href="#resource-center">${escapeHtml(t("ptoHowResourceTitle"))}</a>
          <a class="pt-btn pt-btn-ghost" href="#volunteer">${escapeHtml(t("ptoHowVolunteerTitle"))}</a>
          <a class="pt-btn pt-btn-ghost" href="#wishlists">${escapeHtml(t("ptoHowWishlistTitle"))}</a>
        </div>
      </section>

      <section class="pt-sec" id="resource-center">
        <h2 class="pt-h2">${escapeHtml(t("ptoHowResourceTitle"))}</h2>
        <p class="pt-sub">${escapeHtml(t("ptoHowResourceLead"))}</p>
        <div class="pt-grid">
${card(t, "ptoHowResourceWhat", "ptoHowResourceWhatBody")}
${card(t, "ptoHowResourceWho", "ptoHowResourceWhoBody")}
${linkCard(t, "ptoHowResourceGive", "ptoHowResourceGiveBody", DONATE.url, t("ptoDonateCta"))}
        </div>
        <div class="pt-note">
          <b>${escapeHtml(t("ptoHowResourceNoteTitle"))}.</b> ${escapeHtml(
            t("ptoHowResourceNoteBody"),
          )} <a href="${escapeHtml(telHref(ORG.phone))}">${escapeHtml(ORG.phone)}</a>
        </div>
      </section>

      <section class="pt-sec" id="volunteer">
        <h2 class="pt-h2">${escapeHtml(t("ptoHowVolunteerTitle"))}</h2>
        <p class="pt-sub">${escapeHtml(t("ptoHowVolunteerLead"))}</p>
        <div class="pt-grid">
${linkCard(t, "ptoHelpVolunteer", "ptoHelpVolunteerBody", appHref(CALENDAR_URL, "/volunteers", locale), t("ptoHowVolunteerOpen"))}
${linkCard(t, "ptoHelpMeeting", "ptoHelpMeetingBody", appHref(CALENDAR_URL, "/", locale), t("calendarTitle"))}
        </div>
        <div class="pt-note">
          <b>${escapeHtml(t("ptoHowVolunteerRecurring"))}</b>
          <div class="pt-legend" style="margin:10px 0 0">
${recurring}
          </div>
        </div>
      </section>

      <section class="pt-sec" id="wishlists">
        <h2 class="pt-h2">${escapeHtml(t("ptoHowWishlistTitle"))}</h2>
        <p class="pt-sub">${escapeHtml(t("ptoHowWishlistLead"))}</p>
        <div class="pt-grid">
${wishlistCards
    .map((c) => linkCard(t, c.title, c.body, c.link.url, t("ptoHowWishlistOpen")))
    .join("\n")}
        </div>
        <div class="pt-note">
          <b>${escapeHtml(t("ptoHowWishlistNoteTitle"))}</b> ${escapeHtml(
            t("ptoHowWishlistNoteBody"),
          )}
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

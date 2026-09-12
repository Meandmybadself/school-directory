// GET / — the public page: what the PTO does, who runs it, the year, and how to
// help or give.
//
// This is the page a family is handed when they ask "what IS the PTO?", so it is
// server-rendered with full OG tags and no bundle, and it is INDEXED — see
// functions/_lib/page.ts on what that obliges.
//
// IT MAKES NO SUBREQUEST AT ALL. It is a pure function of the requested URL, the
// Accept-Language header and the `sd_lang` cookie — every word on it is either
// dictionary copy (invariant 6) or a proper noun from `_lib/pto.ts`. It briefly
// had an upcoming-events block reading the anonymous `/calendar-public/events`,
// the way apps/home still does, and dropping that leaves this page stronger than
// the rule invariant 28 asks of it: there is no read to get wrong, nothing to
// degrade when the API blips, and the calendar is one tap away in the nav for
// anyone who wants dates. The month strip below says WHAT happens and roughly
// when in the year, which is what a page with no editor can promise to keep true.
//
// Structure, and why in this order: a family arriving cold wants to know what
// this thing does before who runs it, and what it costs them before where to
// give. So — what it does, who runs it, the year, how to help, donate, where to
// find us.

import type { Locale, Strings } from "@sd/shared";
import { CALENDAR_URL, FEEDBACK_EMAIL, appHref, footer, header } from "./_lib/chrome.js";
import { langCookie, resolveLocale } from "./_lib/locale.js";
import { escapeHtml, html, jsonLd, shell, translator } from "./_lib/page.js";
import {
  CATEGORY_LABEL,
  DONATE,
  MEETING_PLACE,
  ORG,
  PROGRAMS,
  SEATS,
  SOCIAL,
  WISHLISTS,
  YEAR,
  YEAR_ROUND,
  cityStateZip,
  monthName,
  phoneE164,
  telHref,
} from "./_lib/pto.js";
import { PTO_CSS } from "./_lib/styles.js";

const SCHOOL = "Eisenhower PTO";

type T = (key: keyof Strings, vars?: Record<string, string>) => string;

/** A "what the PTO does" card. */
function pillar(t: T, title: keyof Strings, body: keyof Strings): string {
  return `        <div class="pt-card">
          <h3>${escapeHtml(t(title))}</h3>
          <p>${escapeHtml(t(body))}</p>
        </div>`;
}

/** A board seat. Deliberately no name and no photo: the roster turns over every
 *  October, and `roster.json` upstream leaves every holder null for that reason.
 *  The directory is where the current people are. */
function seatCard(t: T, title: keyof Strings, body: keyof Strings): string {
  return `        <div class="pt-card">
          <h3>${escapeHtml(t(title))}</h3>
          <p>${escapeHtml(t(body))}</p>
        </div>`;
}

/** One month of the year strip. Month names come from `Intl` in the reader's
 *  language; the event names beside them are proper nouns and do not. */
function monthRow(t: T, locale: Locale, month: number, events: { name: string; category: string }[]): string {
  const tags = events
    .map(
      (e) =>
        `<span class="pt-tag t-${escapeHtml(e.category)}">${escapeHtml(e.name)}</span>`,
    )
    .join("");
  return `        <div class="pt-month">
          <div class="m">${escapeHtml(monthName(month, locale))}</div>
          <div class="evs">${tags}</div>
        </div>`;
}

/** A "way to help" card, each with the one link that actually does the thing.
 *
 *  Three of these are rendered, not four: "Buy the shirt" is out while the shop
 *  is being built, alongside the header's store link and apps/home's store
 *  tile. Its copy (`ptoHelpShop`, `ptoHelpShopBody`) is translated and waiting,
 *  so restoring it is one line — see `_lib/chrome.ts`'s `header`. */
function helpCard(t: T, title: keyof Strings, body: keyof Strings, href: string, label: string): string {
  return `        <div class="pt-card">
          <h3>${escapeHtml(t(title))}</h3>
          <p>${escapeHtml(t(body))}</p>
          <p><a href="${escapeHtml(href)}">${escapeHtml(label)} →</a></p>
        </div>`;
}

/** The same facts the block under "Find us" prints, in the form a search engine
 *  reads them — this is one of only three surfaces in the project that ask to be
 *  indexed, and an organization's name, address and EIN is exactly what
 *  schema.org describes.
 *
 *  It restates nothing: every value comes from `ORG`, `SOCIAL` or the dictionary
 *  the visible block already renders, so the two copies cannot disagree. The
 *  address is emitted in PARTS, which is why `ORG` holds it that way.
 *
 *  `nonprofitStatus` is deliberately absent. It would assert a 501(c)(3)
 *  determination, which is a claim about the PTO's IRS status rather than a fact
 *  transcribed from its registration — the same line the visible copy holds.
 *  `NGO` says what is known; add the status when someone produces the letter. */
function orgData(t: T, origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "NGO",
    name: SCHOOL,
    legalName: ORG.legalName,
    url: `${origin}/`,
    description: t("ptoLead"),
    email: FEEDBACK_EMAIL,
    telephone: phoneE164(ORG.phone),
    taxID: ORG.ein,
    address: {
      "@type": "PostalAddress",
      streetAddress: ORG.street,
      addressLocality: ORG.locality,
      addressRegion: ORG.region,
      postalCode: ORG.postalCode,
      addressCountry: ORG.country,
    },
    sameAs: SOCIAL.map((l) => l.url),
  };
}

export const onRequestGet: PagesFunction = ({ request }) => {
  const url = new URL(request.url);
  const { locale, explicit } = resolveLocale(url, request);
  const t = translator(locale, SCHOOL);

  const title = `${t("ptoTitle")} — ${SCHOOL}`;
  const description = t("ptoLead");

  const body = `    <div class="pt-wrap">
${header(t, SCHOOL, locale, "/")}

      <section class="pt-hero">
        <div class="pt-eyebrow">${PROGRAMS.map((p) => escapeHtml(p)).join('<span class="sep">◆</span>')}</div>
        <h1 class="pt-h1">${escapeHtml(t("ptoTitle"))}</h1>
        <p class="pt-lead">${escapeHtml(t("ptoLead"))}</p>
        <div class="pt-cta">
          <a class="pt-btn" href="#donate">${escapeHtml(t("ptoDonateTitle"))}</a>
          <a class="pt-btn pt-btn-ghost" href="#help">${escapeHtml(t("ptoHelpTitle"))}</a>
        </div>
      </section>

      <section class="pt-sec">
        <h2 class="pt-h2">${escapeHtml(t("ptoWhatTitle"))}</h2>
        <p class="pt-sub">${escapeHtml(t("ptoWhatBody"))}</p>
        <div class="pt-grid">
${pillar(t, "ptoPillarFund", "ptoPillarFundBody")}
${pillar(t, "ptoPillarCommunity", "ptoPillarCommunityBody")}
${pillar(t, "ptoPillarCulture", "ptoPillarCultureBody")}
${pillar(t, "ptoPillarStaff", "ptoPillarStaffBody")}
        </div>
      </section>

      <section class="pt-sec">
        <h2 class="pt-h2">${escapeHtml(t("ptoBoardTitle"))}</h2>
        <p class="pt-sub">${escapeHtml(t("ptoBoardLead"))}</p>
        <div class="pt-grid">
${SEATS.map((s) => seatCard(t, s.title, s.body)).join("\n")}
        </div>
        <div class="pt-note">
          <b>${escapeHtml(t("ptoMeetingsTitle"))}.</b> ${escapeHtml(
            // The room is DATA, interpolated into the sentence rather than
            // baked into four translations of it — the rule the rest of this
            // page follows, and the reason it isn't printed on a line of its
            // own underneath.
            t("ptoMeetingsBody", { place: MEETING_PLACE }),
          )}
        </div>
      </section>

      <section class="pt-sec">
        <h2 class="pt-h2">${escapeHtml(t("ptoYearTitle"))}</h2>
        <p class="pt-sub">${escapeHtml(t("ptoYearLead"))}</p>
        <div class="pt-legend">
${(Object.keys(CATEGORY_LABEL) as Array<keyof typeof CATEGORY_LABEL>)
  .map(
    (c) =>
      `          <span class="pt-tag t-${c}">${escapeHtml(t(CATEGORY_LABEL[c]))}</span>`,
  )
  .join("\n")}
        </div>
        <div class="pt-year">
${YEAR.map((m) => monthRow(t, locale, m.month, m.events)).join("\n")}
        </div>
        <div class="pt-note">
          <b>${escapeHtml(t("ptoYearRound"))}</b> ${escapeHtml(YEAR_ROUND.join(" · "))}
        </div>
      </section>

      <section class="pt-sec" id="help">
        <h2 class="pt-h2">${escapeHtml(t("ptoHelpTitle"))}</h2>
        <p class="pt-sub">${escapeHtml(t("ptoHelpLead"))}</p>
        <div class="pt-grid">
${helpCard(t, "ptoHelpVolunteer", "ptoHelpVolunteerBody", appHref(CALENDAR_URL, "/", locale), t("calendarTitle"))}
${helpCard(t, "ptoHelpMeeting", "ptoHelpMeetingBody", appHref(CALENDAR_URL, "/", locale), t("ptoMeetingsTitle"))}
${helpCard(t, "ptoHelpWishlist", "ptoHelpWishlistBody", WISHLISTS[0]!.url, WISHLISTS[0]!.label)}
        </div>
        <p class="pt-sub" style="margin-top:16px">
          <a href="${escapeHtml(WISHLISTS[1]!.url)}">${escapeHtml(WISHLISTS[1]!.label)} →</a>
        </p>
      </section>

      <section class="pt-sec" id="donate">
        <div class="pt-donate">
          <h2 class="pt-h2">${escapeHtml(t("ptoDonateTitle"))}</h2>
          <p class="pt-sub" style="margin-bottom:18px">${escapeHtml(t("ptoDonateLead"))}</p>
          <a class="pt-btn" href="${escapeHtml(DONATE.url)}">${escapeHtml(t("ptoDonateCta"))}</a>
          <p class="pt-sub" style="margin:16px 0 0">${escapeHtml(t("ptoDonateNote"))}</p>
        </div>
      </section>

      <section class="pt-sec">
        <h2 class="pt-h2">${escapeHtml(t("ptoFindTitle"))}</h2>
        <p class="pt-sub">${escapeHtml(t("ptoFindLead"))}</p>
        <div class="pt-links">
${SOCIAL.map(
    (l) => `          <a class="pt-chip" href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`,
  ).join("\n")}
          <a class="pt-chip" href="${escapeHtml(appHref(CALENDAR_URL, "/", locale))}">${escapeHtml(t("calendarTitle"))}</a>
          <a class="pt-chip" href="mailto:${escapeHtml(FEEDBACK_EMAIL)}">${escapeHtml(FEEDBACK_EMAIL)}</a>
        </div>
        <!-- The nonprofit itself. Here rather than in the donate box on purpose:
             it answers "who legally is this?", which is a question about the
             organization and not about giving — and the two people who need it,
             someone writing a check and someone filing an employer's matching
             form, both arrive looking for an address. -->
        <div class="pt-org">
          <h3>${escapeHtml(t("ptoOrgTitle"))}</h3>
          <address>
            <b>${escapeHtml(ORG.legalName)}</b><br />
            ${escapeHtml(ORG.street)}<br />
            ${escapeHtml(cityStateZip())}<br />
            <a href="${escapeHtml(telHref(ORG.phone))}">${escapeHtml(ORG.phone)}</a>
          </address>
          <p class="ein">${escapeHtml(t("ptoOrgEin"))} <b>${escapeHtml(ORG.ein)}</b></p>
          <p class="note">${escapeHtml(t("ptoOrgNote"))}</p>
        </div>
      </section>

${footer(t, "/", locale)}
    </div>`;

  return html(
    shell({
      title,
      description,
      canonical: `${url.origin}/`,
      locale,
      css: PTO_CSS,
      alternatesFor: `${url.origin}/`,
      structuredData: jsonLd(orgData(t, url.origin)),
      body,
    }),
    200,
    // Remembered only when they SAID so. A detected language never becomes a
    // stored preference — see _lib/locale.ts.
    explicit ? langCookie(locale) : undefined,
  );
};

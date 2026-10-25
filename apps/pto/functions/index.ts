// GET / — the public page: what the PTO does, who runs it, the year, how to
// help or give — including, since /how-to-help folded into it, the live list
// of events that still need volunteers and the teacher wishlists.
//
// This is the page a family is handed when they ask "what IS the PTO?", so it is
// server-rendered with full OG tags and no bundle, and it is INDEXED — see
// functions/_lib/page.ts on what that obliges.
//
// IT MAKES ONE READ, for the volunteer block alone: "what still needs help" is
// a live fact a page with no editor cannot transcribe, so it comes from the
// ANONYMOUS calendar projections on the terms _lib/volunteers.ts spells out —
// counts, never names, and every failure mode hides the block, so an API blip
// degrades this page to the pure-function page it otherwise is. Everything
// else is a function of the requested URL, the Accept-Language header and the
// `sd_lang` cookie — dictionary copy (invariant 6) or a proper noun from
// `_lib/pto.ts`. (The read lived on /how-to-help until that page merged in
// here; /resource-center still reads nothing at all.)
//
// Structure, and why in this order: a family arriving cold wants to know what
// this thing does before who runs it, and what it costs them before where to
// give. So — what it does, who runs it, the year, how to help (what needs
// hands right now, then the standing ways in), the wishlists, donate, where
// to find us.

import {
  dictionaries,
  eventPath,
  formatClockRange,
  resolveTimeZone,
  type Locale,
  type PublicCalendarEventDTO,
  type Strings,
} from "@sd/shared";
import { CALENDAR_URL, appHref, footer, header } from "./_lib/chrome.js";
import { LANG_PARAM, langCookie, resolveLocale } from "./_lib/locale.js";
import { escapeHtml, html, jsonLd, shell, translator } from "./_lib/page.js";
import {
  CATEGORY_LABEL,
  DONATE,
  MEETING_PLACE,
  ORG,
  PROGRAMS,
  PTO_EMAIL,
  SEATS,
  SOCIAL,
  TEACHER_WISHLISTS,
  VOLUNTEER_EVENTS,
  WISHLISTS,
  YEAR,
  YEAR_ROUND,
  cityStateZip,
  monthName,
  phoneE164,
  telHref,
  type TeacherWishlist,
} from "./_lib/pto.js";
import { PTO_CSS } from "./_lib/styles.js";
import { openVolunteerEvents, type OpenSheetRow, type PagesEnv } from "./_lib/volunteers.js";

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

/** A card whose last line is the one link that actually does the thing.
 *
 *  "Buy the shirt" stays out while the shop is being built, alongside the
 *  header's store link and apps/home's store tile. Its copy (`ptoHelpShop`,
 *  `ptoHelpShopBody`) is translated and waiting, so restoring it is one line —
 *  see `_lib/chrome.ts`'s `header`. */
function helpCard(t: T, title: keyof Strings, body: keyof Strings, href: string, label: string): string {
  return `        <div class="pt-card">
          <h3>${escapeHtml(t(title))}</h3>
          <p>${escapeHtml(t(body))}</p>
          <p><a href="${escapeHtml(href)}">${escapeHtml(label)} →</a></p>
        </div>`;
}

/** "Sat, Nov 14" in the school's timezone — the day the calendar itself files
 *  the event under, not the day it falls on wherever the reader happens to be.
 *  All-day events are stored at UTC midnight and read back in UTC — both are
 *  apps/home's `eventDay`, for the same block one app over. */
function eventDay(locale: Locale, e: PublicCalendarEventDTO, tz: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: e.allDay ? "UTC" : tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(e.start));
}

/** The clock time, or the words "all day" — a time rendered for an event
 *  stored at UTC midnight would be a lie in either direction. */
function eventWhen(locale: Locale, e: PublicCalendarEventDTO, tz: string): string {
  if (e.allDay) return dictionaries[locale].allDay ?? dictionaries.en.allDay;
  return formatClockRange(e.start, e.end, locale, tz);
}

/** The live list: each row is the event's own page on the calendar, which is
 *  where the sheet, the shifts and the claim flow live. Counts only — the
 *  entire anonymous story about a position (invariant 13). */
function liveRows(t: T, locale: Locale, rows: OpenSheetRow[], tz: string): string {
  const items = rows
    .map(({ event: e, left }) => {
      const href = appHref(CALENDAR_URL, eventPath(e, tz), locale);
      return `          <a class="pt-month pt-vol" href="${escapeHtml(href)}">
            <div class="m">${escapeHtml(eventDay(locale, e, tz))}</div>
            <div class="evs">
              <span class="pt-vol-t">${escapeHtml(e.title)}</span>
              <span class="pt-vol-when">${escapeHtml(eventWhen(locale, e, tz))}</span>
              <span class="pt-tag pt-spots">${escapeHtml(t("volunteerSpotsLeft", { left: String(left) }))}</span>
            </div>
          </a>`;
    })
    .join("\n");
  return `        <div class="pt-live">
          <h3 class="pt-live-h">${escapeHtml(t("ptoHowVolunteerOpen"))}</h3>
          <p class="pt-sub" style="margin-bottom:12px">${escapeHtml(t("volunteersPageLead"))}</p>
          <div class="pt-year">
${items}
          </div>
        </div>`;
}

/** One classroom's row: the whole row is the link out to the teacher's list,
 *  the way a volunteer row is the link to its event. Everything a filter
 *  should match on — teacher and room — is the row's own text. */
function teacherRow(t: T, w: TeacherWishlist): string {
  return `          <a class="pt-month pt-tw" href="${escapeHtml(w.url)}">
            <div class="m">${escapeHtml(w.teacher)}</div>
            <div class="evs">
              <span class="pt-vol-when">${escapeHtml(w.room)}</span>
              <span class="pt-tw-open">${escapeHtml(t("ptoHowWishlistOpen"))} →</span>
            </div>
          </a>`;
}

/** The page's one script. It reveals the filter box (shipped `hidden`, so a
 *  reader without JS never sees a control that does nothing) and hides rows
 *  as you type. Matching is diacritic-insensitive — "senora" finds "Señora" —
 *  and display is set inline so no CSS has to know about hidden grid rows. */
const WISHLIST_FILTER_JS = `(function () {
  var q = document.getElementById("tw-q");
  var list = document.getElementById("tw-list");
  var none = document.getElementById("tw-none");
  if (!q || !list || !none) return;
  var norm = function (s) {
    return s.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
  };
  var rows = [].slice.call(list.children);
  q.hidden = false;
  q.addEventListener("input", function () {
    var v = norm(q.value.trim());
    var shown = 0;
    rows.forEach(function (r) {
      var hit = !v || norm(r.textContent).indexOf(v) !== -1;
      r.style.display = hit ? "" : "none";
      if (hit) shown++;
    });
    none.hidden = shown > 0;
  });
})();`;

/** The hero's jump links — the page got long when /how-to-help folded in, so
 *  the hero maps it: one chip per section below, in page order, each label the
 *  section's own heading, so the row costs no copy of its own. Donate and
 *  "Ways to help" appear here AND as the CTA buttons above — the buttons are
 *  emphasis, the row is the complete map. */
const ANCHORS: Array<[href: string, label: keyof Strings]> = [
  ["#what", "ptoWhatTitle"],
  ["#board", "ptoBoardTitle"],
  ["#year", "ptoYearTitle"],
  ["#help", "ptoHelpTitle"],
  ["#wishlists", "ptoHowWishlistTitle"],
  ["#donate", "ptoDonateTitle"],
  ["#find", "ptoFindTitle"],
];

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
    email: PTO_EMAIL,
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

export const onRequestGet: PagesFunction<PagesEnv> = async ({ request, env }) => {
  const url = new URL(request.url);
  const { locale, explicit } = resolveLocale(url, request);
  const t = translator(locale, SCHOOL);
  const tz = resolveTimeZone(env.SCHOOL_TIMEZONE);

  const title = `${t("ptoTitle")} — ${SCHOOL}`;
  const description = t("ptoLead");

  // `null` hides the block (the question could not be asked); `[]` renders the
  // honest "every spot is taken" line, because here the API DID answer.
  const open = await openVolunteerEvents(env);
  const liveBlock =
    open === null
      ? ""
      : open.length === 0
        ? `          <p class="pt-sub">${escapeHtml(t("volunteersPageNone"))}</p>`
        : liveRows(t, locale, open, tz);

  // The recurring-events strip: the same tags the year strip above it wears,
  // so the two sections say "Field Day" in the same colour.
  const recurring = VOLUNTEER_EVENTS.map(
    (e) => `            <span class="pt-tag t-${escapeHtml(e.category)}">${escapeHtml(e.name)}</span>`,
  ).join("\n");

  // The school-wide lists, paired with their copy by POSITION — WISHLISTS is
  // ordered (staff lounge, art room, then the Resource Center). The FRC card
  // stays in this grid on purpose — this section's job is every wishlist in
  // one place — even though /resource-center also carries that list.
  const wishlistCards = [
    { title: "ptoHowWishlistLounge", body: "ptoHowWishlistLoungeBody", link: WISHLISTS[0]! },
    { title: "ptoHowWishlistArt", body: "ptoHowWishlistArtBody", link: WISHLISTS[1]! },
    { title: "ptoHowResourceTitle", body: "ptoHowWishlistFrcBody", link: WISHLISTS[2]! },
  ] as const;

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
        <nav class="pt-anchors" aria-label="${escapeHtml(t("ptoOnThisPage"))}">
${ANCHORS.map(([href, label]) => `          <a class="pt-chip" href="${href}">${escapeHtml(t(label))}</a>`).join("\n")}
        </nav>
      </section>

      <section class="pt-sec" id="what">
        <h2 class="pt-h2">${escapeHtml(t("ptoWhatTitle"))}</h2>
        <p class="pt-sub">${escapeHtml(t("ptoWhatBody"))}</p>
        <div class="pt-grid">
${pillar(t, "ptoPillarFund", "ptoPillarFundBody")}
${pillar(t, "ptoPillarCommunity", "ptoPillarCommunityBody")}
${pillar(t, "ptoPillarCulture", "ptoPillarCultureBody")}
${pillar(t, "ptoPillarStaff", "ptoPillarStaffBody")}
        </div>
      </section>

      <section class="pt-sec" id="board">
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

      <section class="pt-sec" id="year">
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
        <!-- id="volunteer" survives from /how-to-help#volunteer: the redirect
             carries no fragment of its own, so an old link's fragment rides
             through and still lands here. -->
        <div id="volunteer">
${liveBlock}
          <!-- One link to the whole calendar; the live rows above already
               link each event. -->
          <p class="pt-sub" style="margin-top:16px">
            <a href="${escapeHtml(appHref(CALENDAR_URL, "/", locale))}"><b>${escapeHtml(t("calendarTitle"))} →</b></a>
          </p>
          <div class="pt-note">
            <b>${escapeHtml(t("ptoHowVolunteerRecurring"))}</b>
            <div class="pt-legend" style="margin:10px 0 0">
${recurring}
            </div>
          </div>
        </div>
        <div class="pt-grid">
${helpCard(t, "ptoHowResourceTitle", "ptoHowResourceLead", `/resource-center?${LANG_PARAM}=${locale}`, t("ptoHowResourceTitle"))}
${helpCard(
    t,
    "ptoHelpMeeting",
    "ptoHelpMeetingBody",
    // A pre-filled calendar search (the agenda keeps ?q= in the URL for exactly
    // this). The term matches the EVENT'S title, which is authored content and
    // never translated (invariant 6) — so it is English in every locale.
    `${appHref(CALENDAR_URL, "/", locale)}&q=${encodeURIComponent("General Meeting")}`,
    t("ptoMeetingsTitle"),
  )}
        </div>
      </section>

      <section class="pt-sec" id="wishlists">
        <h2 class="pt-h2">${escapeHtml(t("ptoHowWishlistTitle"))}</h2>
        <p class="pt-sub">${escapeHtml(t("ptoHowWishlistLead"))}</p>
        <div class="pt-grid">
${wishlistCards
    .map((c) => helpCard(t, c.title, c.body, c.link.url, t("ptoHowWishlistOpen")))
    .join("\n")}
        </div>
        <h3 class="pt-live-h" style="margin-top:34px">${escapeHtml(t("ptoHowWishlistClassTitle"))}</h3>
        <p class="pt-sub" style="margin-top:4px">${escapeHtml(t("ptoHowWishlistClassLead"))}</p>
        <input id="tw-q" class="pt-filter" type="search" hidden placeholder="${escapeHtml(
          t("ptoHowWishlistFilter"),
        )}" aria-label="${escapeHtml(t("ptoHowWishlistFilter"))}" />
        <div class="pt-year" id="tw-list">
${TEACHER_WISHLISTS.map((w) => teacherRow(t, w)).join("\n")}
        </div>
        <p class="pt-sub" id="tw-none" hidden style="margin:10px 0 0">${escapeHtml(
          t("ptoHowWishlistFilterNone"),
        )}</p>
        <script>${WISHLIST_FILTER_JS}</script>
        <div class="pt-note">
          <b>${escapeHtml(t("ptoHowWishlistNoteTitle"))}</b> ${escapeHtml(
            t("ptoHowWishlistNoteBody"),
          )}
        </div>
      </section>

      <section class="pt-sec" id="donate">
        <div class="pt-donate">
          <h2 class="pt-h2">${escapeHtml(t("ptoDonateTitle"))}</h2>
          <p class="pt-sub" style="margin-bottom:18px">${escapeHtml(t("ptoDonateLead"))}</p>
          <a class="pt-btn" href="${escapeHtml(DONATE.url)}">${escapeHtml(t("ptoDonateCta"))}</a>
          <p class="pt-sub" style="margin:16px 0 0">${escapeHtml(t("ptoDonateNote"))}</p>
        </div>
      </section>

      <section class="pt-sec" id="find">
        <h2 class="pt-h2">${escapeHtml(t("ptoFindTitle"))}</h2>
        <p class="pt-sub">${escapeHtml(t("ptoFindLead"))}</p>
        <div class="pt-links">
${SOCIAL.map(
    (l) => `          <a class="pt-chip" href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`,
  ).join("\n")}
          <a class="pt-chip" href="${escapeHtml(appHref(CALENDAR_URL, "/", locale))}">${escapeHtml(t("calendarTitle"))}</a>
          <a class="pt-chip" href="mailto:${escapeHtml(PTO_EMAIL)}">${escapeHtml(PTO_EMAIL)}</a>
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

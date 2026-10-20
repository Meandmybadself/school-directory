// GET /how-to-help — the deeper half of the landing page's "Ways to help":
// the Resource Center, the volunteer work, and the teacher wishlists.
//
// The landing page answers "what is the PTO?" and gives helping one section;
// this page is for the family who already wants to help and is asking HOW. It
// is the SECOND public page on this origin: server-rendered, indexed (so it is
// in the sitemap — see functions/sitemap.xml.ts), and translated.
//
// It is also the one Function on this origin that MAKES A READ — the decision
// ROUTING.md said would be re-made deliberately, made for the volunteer
// section: "available opportunities" is a live fact, so it is read from the
// anonymous calendar projections rather than transcribed (see
// _lib/volunteers.ts for exactly what that read is allowed to cost). Every
// failure mode hides the block; the landing page still reads nothing.
//
// Alongside the live list, the section names the recurring events a reader can
// watch for (data that never expires, from `_lib/pto.ts`) — the live list says
// what is open THIS week, the strip what keeps coming back every year.
//
// The Resource Center section has one line aimed the other way — at a family
// that needs it rather than one that can give. It ends in the office's phone
// number, appended as a tel: link AFTER the translated sentence so the
// sentence reads complete without it in every language.

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
import { langCookie, resolveLocale } from "./_lib/locale.js";
import { escapeHtml, html, shell, translator } from "./_lib/page.js";
import { DONATE, ORG, VOLUNTEER_EVENTS, WISHLISTS, telHref } from "./_lib/pto.js";
import { PTO_CSS } from "./_lib/styles.js";
import { openVolunteerEvents, type OpenSheetRow, type PagesEnv } from "./_lib/volunteers.js";

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

export const onRequestGet: PagesFunction<PagesEnv> = async ({ request, env }) => {
  const url = new URL(request.url);
  const { locale, explicit } = resolveLocale(url, request);
  const t = translator(locale, SCHOOL);
  const tz = resolveTimeZone(env.SCHOOL_TIMEZONE);

  const title = `${t("ptoHowTitle")} — ${SCHOOL}`;
  const description = t("ptoHowLead");

  // `null` hides the block (the question could not be asked); `[]` renders the
  // honest "every spot is taken" line, because here the API DID answer.
  const open = await openVolunteerEvents(env);
  const liveBlock =
    open === null
      ? ""
      : open.length === 0
        ? `        <p class="pt-sub">${escapeHtml(t("volunteersPageNone"))}</p>`
        : liveRows(t, locale, open, tz);

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
${liveBlock}
        <div class="pt-grid">
${linkCard(t, "ptoHelpVolunteer", "ptoHelpVolunteerBody", appHref(CALENDAR_URL, "/", locale), t("calendarTitle"))}
${linkCard(t, "ptoHelpMeeting", "ptoHelpMeetingBody", appHref(CALENDAR_URL, "/", locale), t("ptoMeetingsTitle"))}
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

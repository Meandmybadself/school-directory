// How a clock time is written, everywhere in this project.
//
// The rule is one sentence: a time is always 12-hour with AM/PM, in every app,
// for every reader, whatever their browser or OS is set to. That is a PRODUCT
// decision about an American elementary school — "pick up at 2:45 PM" is how
// the families and the office talk — and it is deliberately not left to
// `toLocaleTimeString`'s default, which is 24-hour for most of the world's
// locales and for an en-US machine whose owner ticked the 24-hour box. The
// school's day does not change shape because a parent's phone is set to
// en-GB, and a volunteer reading "13:30" on a sign-up sheet that says 1:30 PM
// everywhere else has been given two answers to one question.
//
// The LOCALE still does its job — it picks the separator, the numerals and
// what the day period is called ("PM", "p. m.") — so this is a narrower
// override than it looks, and it does not put English on a Spanish page. Only
// the hour CYCLE is pinned.
//
// Two things deliberately do not come through here:
//
//   · `<input type="time">`. Its `value` is defined by HTML as 24-hour
//     "HH:MM" regardless of locale, and the browser renders its own widget in
//     whatever form the platform uses. `toTimeInput` in the calendar's admin
//     screens is that serializer, not a formatter, and pointing it at this
//     would break the input rather than translate it.
//   · The zone-offset probes in `newsletterEvents.ts` and the API's
//     `lib/calendar.ts`, which set `hour12: false` / `hourCycle: "h23"` on
//     purpose: they are PARSING a wall clock out of `formatToParts`, not
//     showing it to anybody, and a 12-hour cycle there would silently halve
//     every afternoon.

/** The options every rendered clock time is built from. Spread into a wider
 *  `Intl.DateTimeFormatOptions` when a date is wanted alongside the time:
 *  `{ month: "short", day: "numeric", ...CLOCK }`. */
export const CLOCK = {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
} as const satisfies Intl.DateTimeFormatOptions;

/** One instant as a clock time — "1:30 PM".
 *
 *  `timeZone` is the caller's to decide and the choice is not cosmetic: an
 *  event's time is the school's wall clock, so anything showing one (the
 *  calendar app, the front door, a newsletter) passes the school's zone
 *  (timezone.ts). Omitted, it is the reader's own, which moves the event for
 *  anyone not where the school is.
 *
 *  `locale` may be omitted for the browser's own, which is what the admin
 *  screens want: they are English-only operator chrome and take no part in the
 *  app's i18n. */
export function formatClock(iso: string, locale?: string, timeZone?: string): string {
  return new Date(iso).toLocaleTimeString(locale, { ...CLOCK, ...(timeZone ? { timeZone } : {}) });
}

/** A start–end window, or just the start when there is no end. Uses
 *  `formatRange` so the engine may elide a shared day period — "1:30 – 4:00 PM"
 *  — which is what makes a shift read as one window rather than two times. */
export function formatClockRange(
  startIso: string,
  endIso: string | null,
  locale?: string,
  timeZone?: string,
): string {
  const fmt = new Intl.DateTimeFormat(locale, { ...CLOCK, ...(timeZone ? { timeZone } : {}) });
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  return end && end > start ? fmt.formatRange(start, end) : fmt.format(start);
}

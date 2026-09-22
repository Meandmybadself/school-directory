// One clock, everywhere: 12-hour with AM/PM, in every app, for every reader.
//
// This is a product rule about an American elementary school — "pick up at
// 2:45 PM" is how the office and the families talk — and the thing it is
// written against is that `toLocaleTimeString`'s default DOESN'T say that. It
// follows the reader: 24-hour for most of the world's locales, and 24-hour on
// an en-US machine whose owner ticked the box. The school's day does not change
// shape because a parent's phone is set differently, and a volunteer reading
// "13:30" on a sheet that says 1:30 PM everywhere else has two answers to one
// question. That is what shipped: the calendar's admin screen printed shift
// windows through `toTimeInput`, a serializer for `<input type="time">`, whose
// output is 24-hour by definition.
//
// Two halves, and the second is the one that lasts:
//
//  1. `CLOCK` really does pin the cycle in every locale we ship, including the
//     ones whose default is 24-hour. Behavioural — it formats and reads the
//     result — because "hour12: true is in the object" is not the claim.
//  2. NOTHING formats an hour any other way. A source scan across all six
//     apps and the shared package, in the style of platformNav.test.ts, since
//     the failure is always a NEW call site rather than a change to an old
//     one, and no route test will ever notice a stray `hour: "numeric"`.

import { describe, expect, it } from "vitest";
import { CLOCK, formatClock, formatClockRange, LOCALES } from "@sd/shared";

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      opts: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
}

const SOURCES: Record<string, string> = {
  ...import.meta.glob("../../*/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../../*/functions/**/*.ts", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../../../packages/shared/src/*.ts", { query: "?raw", import: "default", eager: true }),
};

/** A file may format an hour its own way only by saying why, on the line or
 *  just above it. The two legitimate reasons are both in the tree today: a
 *  wall-clock PROBE (`formatToParts` with h23, used to derive a zone offset —
 *  a 12-hour cycle there would silently halve every afternoon) and the
 *  `<input type="time">` serializer, whose value HTML defines as 24-hour. */
const EXEMPT = "CLOCK-EXEMPT:";

/** `hour:` inside what is plainly an Intl options object. */
const HOUR_OPTION = /\bhour:\s*["']/;

describe("CLOCK", () => {
  it("is 12-hour in every language we ship", () => {
    // 19:10 UTC is 2:10 PM in Hopkins — an afternoon, so a 24-hour cycle is
    // visible as "14" and cannot hide behind a morning hour.
    for (const locale of LOCALES) {
      const out = formatClock("2026-09-25T19:10:00.000Z", locale, "America/Chicago");
      expect(out).toContain("2:10");
      expect(out).not.toContain("14:10");
    }
    // Including the locale that would otherwise be 24-hour by default, which is
    // the case this rule exists for.
    expect(new Date("2026-09-25T19:10:00.000Z").toLocaleTimeString("zh", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Chicago",
    })).toContain("14:10");
  });

  it("renders a range as one window", () => {
    expect(formatClockRange("2026-09-25T18:30:00.000Z", "2026-09-25T22:00:00.000Z", "en", "America/Chicago"))
      .toMatch(/1:30.*5:00\s*PM/);
    // No end is just the start, not a dangling dash.
    expect(formatClockRange("2026-09-25T18:30:00.000Z", null, "en", "America/Chicago")).toBe("1:30 PM");
    // An end at or before the start is not a range either.
    expect(formatClockRange("2026-09-25T18:30:00.000Z", "2026-09-25T18:30:00.000Z", "en", "America/Chicago"))
      .toBe("1:30 PM");
  });

  it("carries hour12 rather than relying on a locale that happens to agree", () => {
    expect(CLOCK.hour12).toBe(true);
  });

  it("is the only way an hour is formatted, in any app", () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.includes("/test/") || path.endsWith(".test.ts") || path.endsWith(".test.tsx")) continue;
      if (path.includes("/clock.ts")) continue;
      const lines = source.split("\n");
      lines.forEach((line, i) => {
        if (!HOUR_OPTION.test(line)) return;
        // The reason may sit on the line, just above it, or on the block
        // comment heading the function — look back a few lines, the way a
        // reader would.
        const context = lines.slice(Math.max(0, i - 12), i + 2).join("\n");
        if (context.includes(EXEMPT)) return;
        offenders.push(`${path}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

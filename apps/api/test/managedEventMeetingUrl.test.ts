// An authored event's online meeting link (migration 0025).
//
// The link ends up as an <a href> on the PUBLIC event page and as a raw `URL:`
// line in the published feed, so the write is where two things are decided:
// only http(s) may pass (a `javascript:` link rendered as an anchor is a script
// on an anonymous page), and what is stored is what `new URL()` produced — a
// canonical address with no tab or line break in it, which is what lets the
// ICS writer emit it without escaping.
//
// Behavioural rather than textual: the fake D1 records every bind, so the
// assertions are on what reached the INSERT (or that nothing did), not on an
// error message.

import { describe, expect, it } from "vitest";
import { createManagedEvent, ManagedEventError } from "../src/lib/managedCalendar.js";
import type { Env } from "../src/env.js";

interface Capture {
  env: Env;
  /** `[sql, binds]` for every statement that ran, batched ones included. */
  ran: Array<[string, unknown[]]>;
}

function captureEnv(): Capture {
  const ran: Capture["ran"] = [];
  let stored: { meeting_url: string | null } = { meeting_url: null };
  const env = {
    DB: {
      prepare(text: string) {
        let binds: unknown[] = [];
        const stmt = {
          bind(...args: unknown[]) {
            binds = args;
            return stmt;
          },
          async first() {
            ran.push([text, binds]);
            if (text.includes("SELECT id FROM managed_calendar")) return { id: "01CAL" };
            if (text.includes("FROM managed_event e")) {
              return {
                id: "01EVT", calendar_id: "01CAL", title: "Board meeting", location: null,
                description: null, meeting_url: stored.meeting_url,
                starts_at: "2099-09-10T18:00:00.000Z", ends_at: null, all_day: 0,
                recur_freq: null, recur_interval: 1, recur_byday: null, recur_until: null,
                sequence: 0, created_by: "u1", created_at: "x", updated_at: "x",
                occurrence_count: 1, sheet_count: 0, signup_count: 0,
              };
            }
            return null;
          },
          async run() {
            ran.push([text, binds]);
            if (text.includes("INSERT INTO managed_event")) stored = { meeting_url: binds[5] as string | null };
            return { meta: { changes: 1 } };
          },
          _text: text,
          _binds: () => binds,
        };
        return stmt;
      },
      async batch(stmts: Array<{ _text: string; _binds: () => unknown[] }>) {
        for (const s of stmts) ran.push([s._text, s._binds()]);
        return stmts.map(() => ({ meta: { changes: 1 } }));
      },
    },
  } as unknown as Env;
  return { env, ran };
}

const input = { title: "Board meeting", start: "2099-09-10T18:00:00.000Z" };

function insertsOf(c: Capture) {
  const series = c.ran.find(([sql]) => sql.includes("INSERT INTO managed_event"));
  const occurrences = c.ran.filter(([sql]) => sql.includes("INSERT INTO calendar_event"));
  return { series, occurrences };
}

describe("managed event meeting link", () => {
  it("stores a canonical https link on the series AND on each materialized occurrence", async () => {
    const c = captureEnv();
    const event = await createManagedEvent(c.env, "01CAL", { ...input, meetingUrl: "  https://meet.google.com/abc-defg-hij " }, "u1");
    const { series, occurrences } = insertsOf(c);
    // Column order in the INSERT: id, calendar_id, title, location, description, meeting_url, …
    expect(series![1][5]).toBe("https://meet.google.com/abc-defg-hij");
    // The occurrence copy took the ICS round trip (URL: line → parseIcs) and
    // must still be the same link, or the agenda and the feed would disagree.
    expect(occurrences.length).toBe(1);
    expect(occurrences[0]![1]).toContain("https://meet.google.com/abc-defg-hij");
    expect(event?.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("treats an empty link as none", async () => {
    const c = captureEnv();
    const event = await createManagedEvent(c.env, "01CAL", { ...input, meetingUrl: "   " }, "u1");
    expect(insertsOf(c).series![1][5]).toBeNull();
    expect(event?.meetingUrl).toBeNull();
  });

  it("refuses anything that is not an http(s) URL, before writing anything", async () => {
    for (const bad of ["meet.google.com/abc", "javascript:alert(1)", "data:text/html,hi", "not a url", "ftp://x.example/y"]) {
      const c = captureEnv();
      await expect(createManagedEvent(c.env, "01CAL", { ...input, meetingUrl: bad }, "u1")).rejects.toBeInstanceOf(
        ManagedEventError,
      );
      expect(insertsOf(c).series).toBeUndefined();
      expect(insertsOf(c).occurrences).toEqual([]);
    }
  });

  it("strips the characters that would break a raw ICS line", async () => {
    // `new URL()` drops tabs and line breaks (WHATWG URL §4.4), which is what
    // makes emitting the value unescaped as `URL:` safe in icsWriter.ts.
    const c = captureEnv();
    await createManagedEvent(c.env, "01CAL", { ...input, meetingUrl: "https://zoom.us/j/1\r\n23?pwd=x\ty" }, "u1");
    const stored = insertsOf(c).series![1][5] as string;
    expect(stored).toBe("https://zoom.us/j/123?pwd=xy");
    expect(stored).not.toMatch(/[\r\n\t]/);
  });
});

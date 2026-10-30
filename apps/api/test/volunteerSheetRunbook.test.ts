// A volunteer sheet's runbook link (migration 0039) — the organizers' external
// document on how the event is run, typically a Google Doc.
//
// Two decisions live at the write and are pinned here, both borrowed from the
// managed event's meeting link (managedEventMeetingUrl.test.ts): only http(s)
// may pass, because the value is rendered as an <a href> on the event page and
// a `javascript:` link there is a script, not a document; and what is stored is
// what `new URL()` produced — a canonical address. The third decision, that the
// link never reaches an anonymous reader, is publicSheetOf's and is pinned in
// volunteersPublic.test.ts.
//
// Behavioural rather than textual: the fake D1 records every bind, so the
// assertions are on what reached the UPDATE (or that nothing did).

import { describe, expect, it } from "vitest";
import { updateSheet, VolunteerError } from "../src/lib/volunteers.js";
import type { Env } from "../src/env.js";

interface Capture {
  env: Env;
  /** `[sql, binds]` for every statement that ran. */
  ran: Array<[string, unknown[]]>;
  stored: () => string | null;
}

function captureEnv(initialRunbook: string | null = null): Capture {
  const ran: Capture["ran"] = [];
  let stored = initialRunbook;
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
            if (text.includes("FROM volunteer_sheet s")) {
              return {
                id: "01SHEET", managed_event_id: "01EVT",
                occurrence_start: "2099-10-17T22:00:00.000Z", slug: "fall-carnival",
                intro: null, runbook_url: stored,
                published_at: "2099-01-01T00:00:00.000Z", closes_at: null, created_at: "x",
                title: "Fall Carnival", location: null, description: null,
                event_starts_at: "2099-10-17T22:00:00.000Z", event_ends_at: null, all_day: 0,
              };
            }
            if (text.includes("FROM calendar_event")) return { ok: 1 };
            return null;
          },
          async all() {
            ran.push([text, binds]);
            return { results: [] };
          },
          async run() {
            ran.push([text, binds]);
            if (text.includes("UPDATE volunteer_sheet") && text.includes("runbook_url = ?")) {
              // `runbook_url = ?` is always the first SET a runbook write
              // produces here, so its value is the first bind.
              stored = binds[0] as string | null;
            }
            return { meta: { changes: 1 } };
          },
        };
        return stmt;
      },
    },
  } as unknown as Env;
  return { env, ran, stored: () => stored };
}

function updatesOf(c: Capture) {
  return c.ran.filter(([sql]) => sql.includes("UPDATE volunteer_sheet"));
}

describe("volunteer sheet runbook link", () => {
  it("stores the canonical https link and reads it back on the DTO", async () => {
    const c = captureEnv();
    const sheet = await updateSheet(c.env, "01SHEET", {
      runbookUrl: "  https://docs.google.com/document/d/abc123/edit ",
    });
    expect(c.stored()).toBe("https://docs.google.com/document/d/abc123/edit");
    expect(sheet?.runbookUrl).toBe("https://docs.google.com/document/d/abc123/edit");
  });

  it("treats an empty link as clearing it", async () => {
    const c = captureEnv("https://docs.google.com/document/d/old");
    const sheet = await updateSheet(c.env, "01SHEET", { runbookUrl: "   " });
    expect(c.stored()).toBeNull();
    expect(sheet?.runbookUrl).toBeNull();
  });

  it("refuses anything that is not an http(s) URL, before writing anything", async () => {
    for (const bad of ["docs.google.com/document/d/abc", "javascript:alert(1)", "data:text/html,hi", "not a url"]) {
      const c = captureEnv();
      await expect(updateSheet(c.env, "01SHEET", { runbookUrl: bad })).rejects.toBeInstanceOf(
        VolunteerError,
      );
      expect(updatesOf(c)).toEqual([]);
    }
  });

  it("leaves the column alone when the body doesn't mention it", async () => {
    const c = captureEnv("https://docs.google.com/document/d/keep");
    const sheet = await updateSheet(c.env, "01SHEET", { intro: "New intro" });
    const [update] = updatesOf(c);
    expect(update![0]).not.toContain("runbook_url");
    expect(sheet?.runbookUrl).toBe("https://docs.google.com/document/d/keep");
  });
});

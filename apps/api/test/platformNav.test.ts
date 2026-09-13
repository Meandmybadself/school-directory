// The platform switcher (packages/shared/src/nav.ts) is ONE list rendered by
// five copied shells and two server-rendered headers. The list can't drift —
// it is imported — but the things around it can, and this pins the two that
// matter:
//
//  1. Every icon the list names exists in every app's copied `Icon.tsx`. The
//     `IconName` union lives in each copy, so the shared module can only name
//     icons as strings; a copy that lost or renamed one would fail at runtime
//     in that app alone, with a blank slot where the icon was.
//  2. No app's own nav list carries a hardcoded English label. "Admin",
//     "Settings" and "Boards" were literals in three shells before this, which
//     is both an invariant 6 violation and exactly how the admin entry came to
//     be a shield in three apps and a gear in two.

import { describe, expect, it } from "vitest";
import { PLATFORM_APPS } from "@sd/shared";

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      opts: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
}

const ICONS: Record<string, string> = import.meta.glob("../../*/src/components/Icon.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

const SHELLS: Record<string, string> = import.meta.glob("../../*/src/components/AppShell.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

const APPS = ["web", "calendar", "newsletter", "pto", "store"];

describe("platform switcher", () => {
  it("lists the four apps, directory first and PTO last, none of them the store", () => {
    expect(PLATFORM_APPS.map((a) => a.key)).toEqual(["directory", "calendar", "newsletter", "pto"]);
  });

  it("names only icons every app's Icon.tsx copy defines", () => {
    const files = Object.keys(ICONS);
    for (const app of APPS) expect(files.some((f) => f.includes(`/${app}/`))).toBe(true);
    for (const [file, src] of Object.entries(ICONS)) {
      const union = src.slice(src.indexOf("export type IconName"), src.indexOf(";", src.indexOf("export type IconName")));
      for (const icon of [...PLATFORM_APPS.map((a) => a.icon), "grid", "check", "chevright"]) {
        expect(union, `${file} lacks "${icon}"`).toContain(`"${icon}"`);
      }
    }
  });

  it("has no hardcoded label in any app's own nav list", () => {
    const files = Object.keys(SHELLS);
    for (const app of APPS) expect(files.some((f) => f.includes(`/${app}/`))).toBe(true);
    for (const [file, src] of Object.entries(SHELLS)) {
      const body = src.slice(src.indexOf("export function navItems"), src.indexOf("export function isFullNavigation"));
      expect(body.length, `${file} has no navItems()`).toBeGreaterThan(0);
      // A nav tuple is [icon, key, label, path]; the label slot must be a t() call.
      const tuples = body.match(/\["[a-z0-9]+",\s*"[a-z]+",\s*[^,]+,/g) ?? [];
      expect(tuples.length, `${file} has no nav tuples`).toBeGreaterThan(0);
      for (const tuple of tuples) {
        const label = tuple.split(",")[2]!.trim();
        expect(label, `${file}: ${tuple}`).toMatch(/^t\(/);
      }
    }
  });
});

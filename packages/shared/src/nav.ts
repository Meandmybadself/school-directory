// The platform switcher: the one list of sibling apps every front end renders.
//
// Five SPAs and three server-rendered public pages each used to hand-write
// their own "the other sites" links — in a different order, with a different
// icon for the same app, and with the PTO missing from four of them. The chrome
// itself (the sidebar, the bottom bar, the app bar) is a deliberate COPY per
// app and may drift; the LIST is not allowed to, which is why it lives here
// beside the dictionaries rather than in any one app's `lib/api.ts`.
//
// What is deliberately not here: the ORIGINS. Those are build-time config
// (`VITE_*_URL`, falling back to localhost ports) and this package is also
// imported by the API Worker, which has no `import.meta.env`. Each app hands
// its own `PlatformOrigins` map to `platformAppHref`.

import type { Strings } from "./i18n.js";
import type { Locale } from "./types.js";

export type PlatformAppKey = "directory" | "calendar" | "newsletter" | "pto";

/** The icon each app is drawn with — the same one its own sidebar brand mark
 *  uses, so the switcher and the mark agree. Named here as strings because the
 *  `IconName` union lives in each app's copied `Icon.tsx`; all four exist in
 *  every copy, and `test/nav.test.ts` in apps/api checks that stays true. */
export type PlatformAppIcon = "school" | "calendar" | "mail" | "table";

export interface PlatformApp {
  key: PlatformAppKey;
  icon: PlatformAppIcon;
  /** Dictionary key for the label — never a literal (CLAUDE.md invariant 6). */
  label: keyof Strings;
  /** Where a SIGNED-IN member links in. Not always `/`: the newsletter's `/`
   *  is its public archive, and `/app` is what routes a member by role. The
   *  PTO's is `/` even so — the one page every member can open, where `/app`
   *  refuses anyone not on the board and the public page links the boards. */
  path: string;
  /** Where a SIGNED-OUT reader links in — the public calendar agenda and the
   *  server-rendered pages have those — so a stranger lands on the archive
   *  rather than a sign-in form. */
  publicPath: string;
}

/** In this order everywhere: the directory is the identity core the others grew
 *  on, and the PTO — the one that needs no account — closes the list. The store
 *  is deliberately absent while the shop is unannounced; see the comment in
 *  apps/home's `page.ts`, and restore it in ONE place when the time comes. */
export const PLATFORM_APPS: readonly PlatformApp[] = [
  { key: "directory", icon: "school", label: "navDir", path: "/", publicPath: "/" },
  { key: "calendar", icon: "calendar", label: "navCalendar", path: "/", publicPath: "/" },
  { key: "newsletter", icon: "mail", label: "navNewsletter", path: "/app", publicPath: "/" },
  { key: "pto", icon: "table", label: "navPto", path: "/", publicPath: "/" },
];

export type PlatformOrigins = Record<PlatformAppKey, string>;

/** The absolute URL a switcher entry navigates to. Carries `?lang=` so the
 *  reader's language travels with them — the handoff apps/home makes on every
 *  outbound link, and the one signal each SPA's `detectLocale` ranks first. */
export function platformAppHref(
  app: PlatformApp,
  origins: PlatformOrigins,
  locale: Locale,
  signedIn: boolean,
): string {
  const path = signedIn ? app.path : app.publicPath;
  return `${origins[app.key].replace(/\/$/, "")}${path}?lang=${locale}`;
}

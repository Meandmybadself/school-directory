// The app frame: .sd scope + centered column, optional banners + bottom nav.
// Mirrors the sibling apps' shells so all five sites read as one system; the nav
// item list is this app's own.
//
// This shell wraps the BUNDLE's screens only — the boards and the settings
// screen. The public page is server-rendered by a Pages Function and carries its
// own, much lighter chrome, because it has to work with no JavaScript and load
// fast for a stranger. See ROUTING.md.
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IconName } from "./Icon.js";
import { OfflineBanner, MasqBanner } from "./parts.js";
import { ChromeProvider, useChrome } from "./chrome.js";
import { AccountSheet, LanguageSheet } from "./Sheets.js";
import { useOnline } from "../lib/useOnline.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { CALENDAR_URL, DIRECTORY_URL, NEWSLETTER_URL } from "../lib/api.js";

/** Renders whichever app-bar sheet the chrome context has open, so every mobile
 *  ScreenHeader can reach the language picker and the account menu. */
function ChromeSheets() {
  const chrome = useChrome();
  if (!chrome) return null;
  return (
    <>
      {chrome.sheet === "language" && <LanguageSheet onClose={chrome.close} />}
      {chrome.sheet === "account" && <AccountSheet onClose={chrome.close} />}
    </>
  );
}

/** Persistent masquerade banner. The session is shared with the directory, so an
 *  admin who started masquerading there is still masquerading here.
 *
 *  Worth knowing what that means for this app specifically: a masqueraded
 *  session is NOT a system admin (`AuthContext.isSystemAdmin` is the target's),
 *  so an admin masquerading as an ordinary parent will correctly be refused the
 *  boards. That is the feature working, not a bug. */
export function MasqueradeBanner() {
  const { t } = useI18n();
  const { isMasquerading, displayName, stopMasquerade } = useSession();
  if (!isMasquerading) return null;
  return (
    <MasqBanner
      user={displayName || "user"}
      text={t("masqViewingAs")}
      back={t("masqReturn")}
      onBack={() => void stopMasquerade()}
    />
  );
}

export function AppShell({
  children,
  bottomNav,
  banner,
}: {
  children: ReactNode;
  bottomNav?: ReactNode;
  banner?: ReactNode;
}) {
  const online = useOnline();
  const { t, locale } = useI18n();
  return (
    <div className={`sd ${locale === "zh" ? "sd-zh" : ""}`}>
      <div className="sd-app">
        <ChromeProvider>
          <MasqueradeBanner />
          {!online && <OfflineBanner text={t("offlineBanner")} readOnly={t("offlineReadOnly")} />}
          {banner}
          {children}
          {bottomNav}
          <ChromeSheets />
        </ChromeProvider>
      </div>
    </div>
  );
}

export type NavKey = "boards" | "about" | "settings" | "calendar" | "directory" | "newsletter";

/** Nav items. Absolute paths point at a sibling app (a different origin), so
 *  they navigate the browser rather than the router. Kept in step with the
 *  desktop Sidebar in DesktopShell.tsx.
 *
 *  `/` is listed like a router path but is NOT one: this origin's `/` is the
 *  server-rendered public page, a Pages Function the bundle never claims.
 *  `isFullNavigation` below therefore treats it as a real navigation, the same
 *  as a cross-origin link — routing to it instead would fall through to the
 *  catch-all and bounce a board member back to `/app`. */
export function navItems(t: ReturnType<typeof useI18n>["t"], isSystemAdmin: boolean) {
  const items: [IconName, NavKey, string, string][] = [
    ["table", "boards", "Boards", "/boards"],
    ["info", "about", t("navPto"), "/"],
  ];
  if (isSystemAdmin) items.push(["gear", "settings", "Settings", "/settings"]);
  items.push(["calendar", "calendar", t("navCalendar"), CALENDAR_URL]);
  // `/app`, not the bare origin: the newsletter's `/` is its public reader
  // archive (Pages Functions) with no way into the app. `/app` routes by role.
  items.push(["mail", "newsletter", t("navNewsletter"), `${NEWSLETTER_URL}/app`]);
  items.push(["school", "directory", t("navDir"), DIRECTORY_URL]);
  return items;
}

/** Where a nav path goes. Absolute URLs leave the origin; `/` is the SSR public
 *  page and also needs a real navigation; everything else is a router route. */
export function isFullNavigation(path: string): boolean {
  return path.startsWith("http") || path === "/";
}

export function BottomNav({ active }: { active: NavKey }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { me } = useSession();
  const items = navItems(t, !!me?.user.isSystemAdmin);

  return (
    <nav className="sd-bottomnav">
      {items.map(([icon, key, label, path]) => {
        const on = key === active;
        const go = () => {
          if (isFullNavigation(path)) window.location.href = path;
          else navigate(path);
        };
        return (
          <button key={key} className={`sd-navitem${on ? " on" : ""}`} onClick={go}>
            <Icon name={icon} size={21} stroke={on ? 2.2 : 1.8} />
            <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 600 }}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// The app frame: .sd scope + centered column, optional banners + bottom nav.
// Mirrors the sibling apps' shells so all four sites read as one system; the nav
// item list is this app's own.
//
// Note that this shell wraps the BUNDLE's screens only — the cart, the order
// page's client half and the admin. The storefront itself is server-rendered by
// Pages Functions and carries its own, much lighter chrome, because it has to
// work with no JavaScript and load fast for a stranger. See ROUTING.md.
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IconName } from "./Icon.js";
import { OfflineBanner, MasqBanner } from "./parts.js";
import { ChromeProvider, useChrome } from "./chrome.js";
import { AccountSheet, LanguageSheet } from "./Sheets.js";
import { AppsSheet } from "./AppSwitcher.js";
import { useOnline } from "../lib/useOnline.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";

/** Renders whichever app-bar sheet the chrome context has open, so every mobile
 *  ScreenHeader can reach the language picker and the account menu. */
function ChromeSheets() {
  const chrome = useChrome();
  if (!chrome) return null;
  return (
    <>
      {chrome.sheet === "language" && <LanguageSheet onClose={chrome.close} />}
      {chrome.sheet === "account" && <AccountSheet onClose={chrome.close} />}
      {chrome.sheet === "apps" && <AppsSheet onClose={chrome.close} />}
    </>
  );
}

/** Persistent masquerade banner. The session is shared with the directory, so an
 *  admin who started masquerading there is still masquerading here. */
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

export type NavKey = "store" | "cart" | "admin";

/** This app's OWN screens. The sibling apps used to be here as absolute URLs;
 *  they are now in the platform switcher (AppSwitcher.tsx). One list, read by
 *  both the bottom bar and the desktop sidebar.
 *
 *  `/` is listed like a router path but is NOT one: this origin's `/` is the
 *  server-rendered storefront, a Pages Function the bundle never claims.
 *  `isFullNavigation` below therefore treats it as a real navigation — routing
 *  to it instead would fall through to the catch-all and bounce the shopper to
 *  the cart. */
export function navItems(t: ReturnType<typeof useI18n>["t"], isSystemAdmin: boolean) {
  const items: [IconName, NavKey, string, string][] = [
    ["home", "store", t("navStore"), "/"],
    ["plus", "cart", t("storeCart"), "/cart"],
  ];
  if (isSystemAdmin) items.push(["shield", "admin", t("navAdmin"), "/admin"]);
  return items;
}

/** Where a nav path goes. `/` is the SSR storefront and needs a real
 *  navigation; everything else is a router route in this bundle. */
export function isFullNavigation(path: string): boolean {
  return path === "/";
}

export function BottomNav({ active }: { active: NavKey }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const chrome = useChrome();
  const { me } = useSession();
  const items = navItems(t, !!me?.user.isSystemAdmin);

  return (
    <nav className="sd-bottomnav">
      {items.map(([icon, key, label, path]) => (
        <NavTab
          key={key}
          icon={icon}
          label={label}
          on={key === active}
          onClick={() => (isFullNavigation(path) ? (window.location.href = path) : navigate(path))}
        />
      ))}
      {/* The platform switcher — the four sibling apps — is a sheet, not four
          more tabs: the bar stays this app's own, and leaving the site is one
          explicit gesture rather than a tab that looks like every other tab and
          reloads the browser. See AppSwitcher.tsx. */}
      <NavTab icon="grid" label={t("navApps")} on={false} onClick={() => chrome?.open("apps")} />
    </nav>
  );
}

function NavTab({ icon, label, on, onClick }: { icon: IconName; label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`sd-navitem${on ? " on" : ""}`} onClick={onClick}>
      <Icon name={icon} size={21} stroke={on ? 2.2 : 1.8} />
      <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 600 }}>{label}</span>
    </button>
  );
}

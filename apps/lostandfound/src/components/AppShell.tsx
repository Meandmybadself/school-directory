// The app frame: .sd scope + centered column, optional banners + bottom nav.
// Mirrors the sibling apps' shells so all six sites read as one system; the nav
// item list is this app's own.
//
// Unlike the PTO's, this shell wraps EVERY screen, the public browse page
// included: there are no Pages Functions here (see ROUTING.md), so a stranger
// and a staff member see the same frame, minus the staff entries.
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
import { useAccess } from "../lib/access.js";

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
 *  admin who started masquerading there is still masquerading here.
 *
 *  Worth knowing what that means for this app specifically: a masqueraded
 *  session is NOT a system admin (`AuthContext.isSystemAdmin` is the target's),
 *  so an admin masquerading as an ordinary parent will correctly be refused the
 *  staff screens. That is the feature working, not a bug. */
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

export type NavKey = "browse" | "staff" | "settings";

/** This app's OWN screens, read by both the bottom bar and the desktop sidebar.
 *  The sibling apps are the platform switcher's job (AppSwitcher.tsx).
 *
 *  Browsing is everyone's; the staff entry appears only for an account the
 *  roster gate admits, and settings only for a system admin. Hiding them is a
 *  courtesy — the routes behind them are gated server side either way. */
export function navItems(t: ReturnType<typeof useI18n>["t"], isSystemAdmin: boolean, isStaff: boolean) {
  const items: [IconName, NavKey, string, string][] = [
    ["search", "browse", t("lfNavBrowse"), "/"],
  ];
  if (isStaff) items.push(["box", "staff", t("lfNavStaff"), "/staff"]);
  if (isSystemAdmin) items.push(["shield", "settings", t("navAdmin"), "/staff/settings"]);
  return items;
}

export function BottomNav({ active }: { active: NavKey }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const chrome = useChrome();
  const { me } = useSession();
  const { access } = useAccess();
  const items = navItems(t, !!me?.user.isSystemAdmin, !!access?.canUse);

  return (
    <nav className="sd-bottomnav">
      {items.map(([icon, key, label, path]) => (
        <NavTab
          key={key}
          icon={icon}
          label={label}
          on={key === active}
          onClick={() => navigate(path)}
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

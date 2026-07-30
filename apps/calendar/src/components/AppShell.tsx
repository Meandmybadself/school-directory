// The app frame: .sd scope + centered column, optional banners + bottom nav.
// Mirrors the directory app's shell so the two sites read as one system; the nav
// item list is this app's own (calendar + admin, plus a link back to directory).
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IconName } from "./Icon.js";
import { OfflineBanner, MasqBanner } from "./parts.js";
import { useOnline } from "../lib/useOnline.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { DIRECTORY_URL, NEWSLETTER_URL } from "../lib/api.js";

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
        <MasqueradeBanner />
        {!online && <OfflineBanner text={t("offlineBanner")} readOnly={t("offlineReadOnly")} />}
        {banner}
        {children}
        {bottomNav}
      </div>
    </div>
  );
}

export type NavKey = "calendar" | "admin" | "directory" | "newsletter";

/** Nav items. Absolute paths point at the directory app (a different origin), so
 *  they navigate the browser rather than the router. Kept in step with the
 *  desktop Sidebar in DesktopShell.tsx. */
export function navItems(t: ReturnType<typeof useI18n>["t"], isSystemAdmin: boolean) {
  const items: [IconName, NavKey, string, string][] = [
    ["calendar", "calendar", t("navCalendar"), "/"],
  ];
  if (isSystemAdmin) items.push(["shield", "admin", "Admin", "/admin"]);
  items.push(["mail", "newsletter", t("navNewsletter"), NEWSLETTER_URL]);
  items.push(["school", "directory", t("brandSub"), DIRECTORY_URL]);
  return items;
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
          if (path.startsWith("http")) window.location.href = path;
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

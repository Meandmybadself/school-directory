// The app frame: .sd scope + centered column, optional banners + bottom nav.
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IconName } from "./Icon.js";
import { OfflineBanner, MasqBanner } from "./parts.js";
import { useOnline } from "../lib/useOnline.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { CALENDAR_APP_URL, NEWSLETTER_APP_URL } from "../lib/api.js";

/** Persistent masquerade banner, shown app-wide whenever an admin is acting as another user. */
export function MasqueradeBanner() {
  const { t } = useI18n();
  const { isMasquerading, activePerson, me, stopMasquerade } = useSession();
  if (!isMasquerading) return null;
  const who = activePerson?.displayName ?? me?.user.email ?? "user";
  return <MasqBanner user={who} text={t("masqViewingAs")} back={t("masqReturn")} onBack={() => void stopMasquerade()} />;
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

type NavKey = "home" | "calendar" | "dir" | "groups" | "me" | "news" | "admin";

export function BottomNav({ active }: { active: NavKey }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { me, activePerson } = useSession();
  // The calendar lives on its own site now, so its entry is an absolute URL and
  // navigates the browser rather than the router. Kept in step with the desktop
  // Sidebar in DesktopShell.tsx, which duplicates this list.
  const items: [IconName, NavKey, string, string][] = [
    ["home", "home", t("navHome"), "/"],
    ["calendar", "calendar", t("navCalendar"), CALENDAR_APP_URL],
    ["search", "dir", t("navDir"), "/directory"],
    ["users3", "groups", t("navGroups"), "/groups"],
    ["eye", "me", t("yourProfile"), activePerson ? `/persons/${activePerson.id}` : "/"],
    // `/app`, not the bare origin — the newsletter's `/` is its public reader
    // archive and has no route into the app. `/app` routes by role.
    ["mail", "news", t("navNewsletter"), `${NEWSLETTER_APP_URL}/app`],
  ];
  // System admins get an Admin tab, mirroring the desktop sidebar.
  if (me?.user.isSystemAdmin) items.push(["shield", "admin", "Admin", "/admin"]);
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

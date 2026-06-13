// The app frame: .sd scope + centered column, optional banners + bottom nav.
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IconName } from "./Icon.js";
import { OfflineBanner, MasqBanner } from "./parts.js";
import { useOnline } from "../lib/useOnline.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";

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

type NavKey = "home" | "dir" | "groups" | "me";

export function BottomNav({ active }: { active: NavKey }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const items: [IconName, NavKey, string, string][] = [
    ["home", "home", t("navHome"), "/"],
    ["search", "dir", t("navDir"), "/directory"],
    ["users3", "groups", t("navGroups"), "/groups"],
    ["eye", "me", t("navMe"), "/you"],
  ];
  return (
    <nav className="sd-bottomnav">
      {items.map(([icon, key, label, path]) => {
        const on = key === active;
        return (
          <button key={key} className={`sd-navitem${on ? " on" : ""}`} onClick={() => navigate(path)}>
            <Icon name={icon} size={21} stroke={on ? 2.2 : 1.8} />
            <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 600 }}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

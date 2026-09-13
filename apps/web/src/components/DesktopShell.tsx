// Desktop layout: 244px sidebar nav + sticky header (search, globe, switcher).
// Ported from design_handoff/screens-desktop.jsx (DeskNav + DeskHeader).
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IconName } from "./Icon.js";
import { Avatar } from "./atoms.js";
import { PersonSwitcherSheet, LanguageSheet, LanguageButton } from "./Sheets.js";
import { MasqueradeBanner, isFullNavigation, navItems, type NavKey } from "./AppShell.js";
import { SiteFooter } from "./SiteFooter.js";
import { PlatformNav } from "./AppSwitcher.js";
import { capLabel, useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { roleCapabilities } from "@sd/shared";
import { mediaUrl } from "../lib/api.js";

function Sidebar({ active }: { active: NavKey }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { activePerson, me } = useSession();
  const items = navItems(t, !!me?.user.isSystemAdmin, activePerson?.id ?? null);

  return (
    <aside className="sd-desknav">
      <div style={{ padding: "0 8px 18px" }}>
        <div className="sd-row" style={{ gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--blue)", color: "var(--on-brand)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
            <Icon name="school" size={19} stroke={1.9} />
          </div>
          <div style={{ lineHeight: 1.05 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: "-.4px" }}>{t("brand")}</div>
            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: ".8px", textTransform: "uppercase", color: "var(--ink-3)" }}>{t("brandSub")}</div>
          </div>
        </div>
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {items.map(([icon, key, label, path]) => (
          <button
            key={key}
            className={`sd-desknav-item${key === active ? " on" : ""}`}
            onClick={() => (isFullNavigation(path) ? (window.location.href = path) : navigate(path))}
          >
            <Icon name={icon} size={20} stroke={key === active ? 2.1 : 1.8} />{label}
          </button>
        ))}
      </nav>
      <div style={{ flex: 1 }} />
      {/* The platform switcher, at the foot of the sidebar in every app so it is
          in the same place wherever a member is. See AppSwitcher.tsx. */}
      <PlatformNav />
    </aside>
  );
}

export function DesktopShell({
  active,
  title,
  breadcrumb,
  children,
}: {
  active: NavKey;
  title: string;
  breadcrumb?: ReactNode;
  children: ReactNode;
}) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { activePerson } = useSession();
  const [sheet, setSheet] = useState<"switcher" | "language" | null>(null);

  return (
    <div className={`sd sd-desktop ${locale === "zh" ? "sd-zh" : ""}`}>
      <Sidebar active={active} />
      <div className="sd-deskmain">
        <MasqueradeBanner />
        <header className="sd-deskhead">
          <h1 className="sd-h2" style={{ fontSize: 20, flex: "0 0 auto" }}>{title}</h1>
          <div style={{ flex: 1, maxWidth: 360, position: "relative" }}>
            <Icon name="search" size={17} style={{ position: "absolute", left: 13, top: 11, color: "var(--ink-3)" }} />
            <input
              className="sd-input"
              placeholder={`${t("navDir")}…`}
              onFocus={() => navigate("/directory")}
              style={{ height: 40, paddingLeft: 38, fontSize: 14, background: "var(--bg)", border: "1px solid var(--line)" }}
            />
          </div>
          <div style={{ flex: 1 }} />
          <LanguageButton onClick={() => setSheet("language")} />
          {activePerson && (
            <button className="sd-deskswitch" onClick={() => setSheet("switcher")}>
              <Avatar name={activePerson.displayName} size={32} img={mediaUrl(activePerson.photoUrl)} color="var(--blue)" />
              <div style={{ lineHeight: 1.1, textAlign: "left" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{activePerson.displayName}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600 }}>{roleCapabilities(activePerson.capabilities).map((c) => capLabel(t, c)).join(" · ")}</div>
              </div>
              <Icon name="chevdown" size={15} stroke={2.2} style={{ color: "var(--ink-3)" }} />
            </button>
          )}
        </header>
        <div className="sd-deskbody">
          {breadcrumb}
          {children}
          {/* Last child of the flex column, so its `margin-top: auto` pins it to
              the bottom of the viewport on a short page and simply follows the
              content on a long one. One seam covers every desktop screen. */}
          <SiteFooter />
        </div>
      </div>
      {sheet === "switcher" && <PersonSwitcherSheet onClose={() => setSheet(null)} />}
      {sheet === "language" && <LanguageSheet onClose={() => setSheet(null)} />}
    </div>
  );
}

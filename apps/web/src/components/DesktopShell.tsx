// Desktop layout: 244px sidebar nav + sticky header (search, globe, switcher).
// Ported from design_handoff/screens-desktop.jsx (DeskNav + DeskHeader).
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IconName } from "./Icon.js";
import { Avatar } from "./atoms.js";
import { IconBtn } from "./parts.js";
import { PersonSwitcherSheet, LanguageSheet } from "./Sheets.js";
import { MasqueradeBanner } from "./AppShell.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";

type NavKey = "home" | "dir" | "groups" | "profile" | "admin";

function capLabel(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1).replace("_", " ");
}

function Sidebar({ active }: { active: NavKey }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { activePerson, me } = useSession();
  const items: [IconName, NavKey, string, string][] = [
    ["home", "home", t("navHome"), "/"],
    ["search", "dir", t("navDir"), "/directory"],
    ["users3", "groups", t("navGroups"), "/groups"],
    ["eye", "profile", t("yourProfile"), activePerson ? `/persons/${activePerson.id}` : "/"],
  ];
  if (me?.user.isSystemAdmin) items.push(["shield", "admin", "Admin", "/admin"]);
  return (
    <aside className="sd-desknav">
      <div style={{ padding: "0 8px 18px" }}>
        <div className="sd-row" style={{ gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--blue)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
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
          <button key={key} className={`sd-desknav-item${key === active ? " on" : ""}`} onClick={() => navigate(path)}>
            <Icon name={icon} size={20} stroke={key === active ? 2.1 : 1.8} />{label}
          </button>
        ))}
      </nav>
      <div style={{ flex: 1 }} />
      <div style={{ padding: 12, borderRadius: 12, background: "var(--bg)", fontSize: 12.5, color: "var(--ink-3)" }}>
        <div className="sd-row" style={{ gap: 8 }}>
          <Icon name="school" size={16} />
          <span style={{ fontWeight: 700, color: "var(--ink-2)" }}>{t("brand")} School</span>
        </div>
        <div style={{ marginTop: 4 }}>{t("privateNote")}</div>
      </div>
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
          <IconBtn name="globe" label="Language" onClick={() => setSheet("language")} />
          {activePerson && (
            <button className="sd-deskswitch" onClick={() => setSheet("switcher")}>
              <Avatar name={activePerson.displayName} size={32} img={activePerson.photoUrl} color="var(--blue)" />
              <div style={{ lineHeight: 1.1, textAlign: "left" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{activePerson.displayName}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600 }}>{activePerson.capabilities.map(capLabel).join(" · ")}</div>
              </div>
              <Icon name="chevdown" size={15} stroke={2.2} style={{ color: "var(--ink-3)" }} />
            </button>
          )}
        </header>
        <div className="sd-deskbody">
          {breadcrumb}
          {children}
        </div>
      </div>
      {sheet === "switcher" && <PersonSwitcherSheet onClose={() => setSheet(null)} />}
      {sheet === "language" && <LanguageSheet onClose={() => setSheet(null)} />}
    </div>
  );
}

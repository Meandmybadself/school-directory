// The platform switcher: the four sibling apps, in the order @sd/shared fixes.
//
// Two renderings of ONE list. On desktop it is the section at the foot of the
// sidebar, in the same place in every app; on a phone it is the sheet the
// "Apps" tab opens, so the bottom bar stays this app's own and leaving the site
// is one explicit gesture rather than a tab that looks like every other tab
// and reloads the browser. The list, the order, the icons and the labels come
// from `PLATFORM_APPS`; only the origins are this app's (`PLATFORM_ORIGINS`).
//
// Copied into each app rather than imported, like the rest of the design
// system (see CLAUDE.md): the STYLING may drift, the list cannot.
import { PLATFORM_APPS, platformAppHref, type PlatformApp } from "@sd/shared";
import { Icon } from "./Icon.js";
import { SheetOver } from "./parts.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { CURRENT_APP, PLATFORM_ORIGINS } from "../lib/api.js";

/** Signed in or not decides the entry path — a member is routed by role, a
 *  stranger (this app may have public screens) lands on something public. */
function useHrefOf(): (app: PlatformApp) => string {
  const { locale } = useI18n();
  const { me } = useSession();
  return (app) => platformAppHref(app, PLATFORM_ORIGINS, locale, !!me);
}

/** Desktop: the sidebar's last section. The current app is marked, not linked —
 *  the app's own screens are the list above this one. */
export function PlatformNav() {
  const { t } = useI18n();
  const hrefOf = useHrefOf();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".8px", textTransform: "uppercase", color: "var(--ink-3)", padding: "0 11px 6px" }}>
        {t("navApps")}
      </div>
      {PLATFORM_APPS.map((app) => {
        const label = t(app.label);
        if (app.key === CURRENT_APP) {
          return (
            <div key={app.key} className="sd-desknav-item" aria-current="page" style={{ cursor: "default", color: "var(--ink)", fontWeight: 700 }}>
              <Icon name={app.icon} size={20} stroke={2.1} />
              {label}
              <Icon name="check" size={16} stroke={2.2} style={{ marginLeft: "auto", color: "var(--blue)" }} />
            </div>
          );
        }
        return (
          <a key={app.key} className="sd-desknav-item" href={hrefOf(app)} style={{ textDecoration: "none" }}>
            <Icon name={app.icon} size={20} stroke={1.8} />
            {label}
          </a>
        );
      })}
    </div>
  );
}

/** Mobile: the sheet behind the "Apps" tab. Same rows as the language sheet,
 *  so the two pickers on the bar read as siblings; the current app is shown
 *  selected and tapping it just closes the sheet. */
export function AppsSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const hrefOf = useHrefOf();
  const row = {
    gap: 12, padding: "13px 14px", borderRadius: 12, width: "100%", textAlign: "left" as const,
    font: "inherit", cursor: "pointer", color: "inherit", textDecoration: "none",
  };
  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 3 }}>{t("brand")}</h2>
      <p className="sd-meta" style={{ marginBottom: 14 }}>{t("navAppsLead")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {PLATFORM_APPS.map((app) => {
          const sel = app.key === CURRENT_APP;
          const inner = (
            <>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: sel ? "var(--blue)" : "var(--bg-2)", color: sel ? "var(--on-brand)" : "var(--ink-2)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
                <Icon name={app.icon} size={18} />
              </div>
              <div style={{ flex: 1, fontSize: 15, fontWeight: 700 }}>{t(app.label)}</div>
              {sel
                ? <Icon name="check" size={20} style={{ color: "var(--blue)" }} />
                : <Icon name="chevright" size={16} style={{ color: "var(--ink-3)" }} />}
            </>
          );
          const style = { ...row, border: "1px solid " + (sel ? "var(--blue)" : "var(--line)"), background: sel ? "var(--blue-tint)" : "var(--paper)" };
          return sel
            ? <button key={app.key} type="button" className="sd-row" onClick={onClose} style={style}>{inner}</button>
            : <a key={app.key} className="sd-row" href={hrefOf(app)} style={style}>{inner}</a>;
        })}
      </div>
    </SheetOver>
  );
}

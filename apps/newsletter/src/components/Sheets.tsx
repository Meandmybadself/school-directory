// Bottom sheets: language picker and the account menu.
import { localeNames, LOCALES, type Locale } from "@sd/shared";
import { Icon } from "./Icon.js";
import { SheetOver } from "./parts.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { api, DIRECTORY_URL } from "../lib/api.js";

/** Language trigger — shows the current language code (EN / ES / 中文) so it's
 *  obvious it's the language switcher and which language is active. */
export function LanguageButton({ onClick }: { onClick: () => void }) {
  const { locale, t } = useI18n();
  const label = locale === "zh" ? "中文" : locale.toUpperCase();
  return (
    <button
      onClick={onClick}
      aria-label={t("language")}
      title={t("language")}
      style={{
        height: 38, minWidth: 38, padding: "0 11px", borderRadius: 10,
        border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink-2)",
        fontWeight: 700, fontSize: 12.5, cursor: "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {label}
    </button>
  );
}

export function LanguageSheet({ onClose }: { onClose: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const { me } = useSession();
  const choose = async (l: Locale) => {
    setLocale(l);
    // Persist the choice on the account so it follows the member to the directory.
    if (me) await api.setLocale(l).catch(() => {});
    onClose();
  };
  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 3 }}>{t("language")}</h2>
      <p className="sd-meta" style={{ marginBottom: 14 }}>{t("languageNote")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {LOCALES.map((l) => {
          const sel = l === locale;
          return (
            <button
              key={l}
              type="button"
              className="sd-row"
              onClick={() => void choose(l)}
              style={{ gap: 12, padding: "13px 14px", borderRadius: 12, width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", border: "1px solid " + (sel ? "var(--blue)" : "var(--line)"), background: sel ? "var(--blue-tint)" : "var(--paper)" }}
            >
              <div style={{ width: 34, height: 34, borderRadius: 9, background: sel ? "var(--blue)" : "var(--bg-2)", color: sel ? "var(--on-brand)" : "var(--ink-2)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
                <Icon name="globe" size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{localeNames[l].native}</div>
                <div className="sd-meta">{localeNames[l].english}</div>
              </div>
              {sel && <Icon name="check" size={20} style={{ color: "var(--blue)" }} />}
            </button>
          );
        })}
      </div>
    </SheetOver>
  );
}

/** Account menu. The directory app has a Person switcher here; the newsletter is
 *  not Person-scoped either, so this offers the two things that do apply:
 *  jump to the directory, and sign out. */
export function AccountSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { me, displayName, signOut } = useSession();
  if (!me) return null;

  const row = {
    gap: 12, padding: "13px 14px", borderRadius: 12, width: "100%", textAlign: "left" as const,
    font: "inherit", cursor: "pointer", border: "1px solid var(--line)", background: "var(--paper)",
  };
  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 3 }}>{displayName}</h2>
      <p className="sd-meta" style={{ marginBottom: 14 }}>{me.user.email}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <a href={DIRECTORY_URL} className="sd-row" style={{ ...row, color: "inherit", textDecoration: "none" }}>
          <Icon name="school" size={18} style={{ color: "var(--blue)" }} />
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>{t("brand")}</span>
          <Icon name="chevright" size={16} style={{ marginLeft: "auto", color: "var(--ink-3)" }} />
        </a>
        <button type="button" className="sd-row" onClick={() => void signOut()} style={{ ...row, color: "var(--warn)" }}>
          <Icon name="lock" size={18} />
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>{t("signOut")}</span>
        </button>
      </div>
    </SheetOver>
  );
}

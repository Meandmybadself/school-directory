// Bottom sheets: active-Person switcher and language picker.
import { localeNames, LOCALES, type Locale } from "@sd/shared";
import { Icon } from "./Icon.js";
import { Avatar } from "./atoms.js";
import { SheetOver } from "./parts.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { api, mediaUrl } from "../lib/api.js";

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
        height: 38, minWidth: 38, padding: "0 10px", borderRadius: 10,
        border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink-2)",
        fontWeight: 700, fontSize: 12.5, cursor: "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
      }}
    >
      <Icon name="globe" size={15} />
      {label}
    </button>
  );
}

export function PersonSwitcherSheet({ onClose }: { onClose: () => void }) {
  const { me, switchPerson } = useSession();
  if (!me) return null;
  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 14 }}>Acting as</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {me.persons.map((p) => {
          const sel = p.id === me.activePersonId;
          return (
            <button
              key={p.id}
              type="button"
              className="sd-row"
              onClick={async () => {
                await switchPerson(p.id);
                onClose();
              }}
              style={{ gap: 12, padding: "12px 14px", borderRadius: 12, width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", border: "1px solid " + (sel ? "var(--blue)" : "var(--line)"), background: sel ? "var(--blue-tint)" : "var(--paper)" }}
            >
              <Avatar name={p.displayName} size={40} img={mediaUrl(p.photoUrl)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{p.displayName}</div>
                <div className="sd-meta">{p.capabilities.join(" · ") || "Member"}</div>
              </div>
              {sel && <Icon name="check" size={20} style={{ color: "var(--blue)" }} />}
            </button>
          );
        })}
      </div>
    </SheetOver>
  );
}

export function LanguageSheet({ onClose }: { onClose: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const { me } = useSession();
  const choose = async (l: Locale) => {
    setLocale(l);
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
              onClick={() => choose(l)}
              style={{ gap: 12, padding: "13px 14px", borderRadius: 12, width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", border: "1px solid " + (sel ? "var(--blue)" : "var(--line)"), background: sel ? "var(--blue-tint)" : "var(--paper)" }}
            >
              <div style={{ width: 34, height: 34, borderRadius: 9, background: sel ? "var(--blue)" : "var(--bg-2)", color: sel ? "#fff" : "var(--ink-2)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
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

// Bottom sheets: the account sheet (Person switcher + sign out) and the
// language picker.
import { useNavigate } from "react-router-dom";
import { localeNames, LOCALES, type Locale } from "@sd/shared";
import { Icon } from "./Icon.js";
import { Avatar } from "./atoms.js";
import { SheetOver } from "./parts.js";
import { capLabel, useI18n } from "../i18n/index.js";
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

/** The directory's account sheet. It is the Person switcher first — this app is
 *  the one that IS Person-scoped, so "who am I acting as" is the question the
 *  sheet exists to answer — with the account itself below it.
 *
 *  That second half is the distinction worth drawing here and nowhere else: the
 *  calendar and newsletter have one identity per session, where this list is
 *  full of Persons a member controls. Signing out ends the SESSION, not the
 *  acting-as choice, and the two are one tap apart in the same sheet — so the
 *  email says which account is about to end, and the row is separated from the
 *  switcher rather than reading as one more Person to become. */
export function PersonSwitcherSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { me, switchPerson, signOut } = useSession();
  if (!me) return null;
  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 14 }}>{t("actingAs")}</h2>
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
                <div className="sd-meta">{p.capabilities.map((c) => capLabel(t, c)).join(" · ") || t("member")}</div>
              </div>
              {sel && <Icon name="check" size={20} style={{ color: "var(--blue)" }} />}
            </button>
          );
        })}
        <button
          type="button"
          className="sd-row"
          onClick={() => {
            onClose();
            navigate("/persons/new");
          }}
          style={{ gap: 12, padding: "12px 14px", borderRadius: 12, width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", border: "1px dashed var(--line)", background: "var(--paper)", color: "var(--blue)" }}
        >
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--blue-tint)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
            <Icon name="plus" size={20} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{t("addPerson")}</div>
        </button>
      </div>

      <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 14 }}>
        <p className="sd-meta" style={{ marginBottom: 8 }}>{me.user.email}</p>
        <button
          type="button"
          className="sd-row"
          onClick={() => void signOut()}
          style={{
            gap: 12, padding: "13px 14px", borderRadius: 12, width: "100%", textAlign: "left",
            font: "inherit", cursor: "pointer", border: "1px solid var(--line)",
            background: "var(--paper)", color: "var(--warn)",
          }}
        >
          <Icon name="lock" size={18} />
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>{t("signOut")}</span>
        </button>
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

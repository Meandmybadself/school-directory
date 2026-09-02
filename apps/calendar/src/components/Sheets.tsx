// Bottom sheets: language picker, the account menu, and calendar subscription.
import { useState } from "react";
import { localeNames, LOCALES, type Locale } from "@sd/shared";
import { Icon } from "./Icon.js";
import { SheetOver } from "./parts.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { api, DIRECTORY_URL } from "../lib/api.js";
import { googleSubscribeUrl, webcalUrl } from "../lib/calendar.js";

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

/** Account menu. The directory app has a Person switcher here; the calendar is
 *  shared rather than Person-scoped, so this offers the two things that do apply:
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

/** Everything a family can do with one calendar — the chip carries a single
 *  button, and this is what it opens.
 *
 *  Subscribing offers three routes rather than one, because no single link
 *  works everywhere: `webcal:` covers Apple and Outlook, Google needs its own
 *  URL, and the raw link covers everything else (and is the only thing that
 *  works if no handler is registered). Offering only the first would silently
 *  fail for whoever is on Google, which at a school is a large share of the
 *  parents.
 *
 *  Downloading lives at the bottom, below a rule. It used to sit beside
 *  subscribe on the chip, where two adjacent icons implied two flavours of the
 *  same thing; they are opposites, and the one that goes stale is the one
 *  people picked by accident. */
export function SubscribeSheet({ name, url, onClose }: { name: string; url: string; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the link is shown in full below and stays selectable */
    }
  };

  const row = {
    gap: 12, padding: "13px 14px", borderRadius: 12, width: "100%", textAlign: "left" as const,
    font: "inherit", cursor: "pointer", border: "1px solid var(--line)", background: "var(--paper)",
  };

  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 3 }}>{t("subscribeIcs", { name })}</h2>
      <p className="sd-meta" style={{ marginBottom: 14 }}>{t("subscribeLead", { name })}</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <a
          href={webcalUrl(url)}
          className="sd-row"
          style={{ ...row, color: "inherit", textDecoration: "none" }}
          onClick={onClose}
        >
          <Icon name="calendar" size={18} style={{ color: "var(--blue)" }} />
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>{t("subscribeApple")}</span>
          <Icon name="chevright" size={16} style={{ marginLeft: "auto", color: "var(--ink-3)" }} />
        </a>

        <a
          href={googleSubscribeUrl(url)}
          target="_blank"
          rel="noopener noreferrer"
          className="sd-row"
          style={{ ...row, color: "inherit", textDecoration: "none" }}
          onClick={onClose}
        >
          <Icon name="globe" size={18} style={{ color: "var(--blue)" }} />
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>{t("subscribeGoogle")}</span>
          <Icon name="chevright" size={16} style={{ marginLeft: "auto", color: "var(--ink-3)" }} />
        </a>
      </div>

      <p className="sd-meta" style={{ margin: "16px 0 6px" }}>{t("subscribeOther")}</p>
      <button
        type="button"
        className="sd-row"
        onClick={() => void copy()}
        style={{ ...row, gap: 10 }}
      >
        <Icon name={copied ? "check" : "link"} size={16} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
        <span
          style={{
            fontSize: 12.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
          }}
        >
          {url}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--ink-3)", flex: "0 0 auto" }}>
          {copied ? t("subscribeCopied") : t("subscribeCopy")}
        </span>
      </button>

      <p className="sd-meta" style={{ marginTop: 14 }}>{t("subscribeNote")}</p>

      {/* Downloading is the odd one out here, so it is set below a rule and
          styled quieter than the three above rather than as a fourth peer.
          It answers a different question — "give me these dates now" — and
          the note is what stops someone reaching for it expecting the
          subscription behaviour the rest of this sheet promises. */}
      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0 14px" }} />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="sd-row"
        style={{ ...row, gap: 12, color: "inherit", textDecoration: "none", background: "transparent" }}
        onClick={onClose}
      >
        <Icon name="download" size={18} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14.5, fontWeight: 700 }}>
            {t("downloadIcs", { name })}
          </span>
          <span className="sd-meta" style={{ display: "block", marginTop: 2 }}>
            {t("downloadIcsNote")}
          </span>
        </span>
      </a>
    </SheetOver>
  );
}

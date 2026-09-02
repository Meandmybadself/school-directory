// The one member-facing screen: subscribe or unsubscribe yourself.
//
// Member-facing means it goes through @sd/shared's i18n dictionaries, unlike the
// admin screens above it, which stay English the way the calendar app's admin
// chrome does.

import { useEffect, useState } from "react";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader } from "../components/parts.js";
import { Icon } from "../components/Icon.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { useI18n } from "../i18n/index.js";
import { api, errorMessage } from "../lib/api.js";

export function Preferences() {
  const { t } = useI18n();
  const desktop = useIsDesktop();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .newsletterSubscription()
      .then((r) => setSubscribed(r.subscribed))
      .catch((err: unknown) => setError(errorMessage(err, "Couldn't load your preference.")));
  }, []);

  const toggle = async () => {
    if (subscribed === null) return;
    const next = !subscribed;
    setBusy(true);
    // Optimistic: a toggle that lags feels broken. Reverted below if the write
    // fails, so the control never lies about the stored state.
    setSubscribed(next);
    try {
      const r = await api.setNewsletterSubscription(next);
      setSubscribed(r.subscribed);
    } catch (err) {
      setSubscribed(!next);
      setError(errorMessage(err, "Couldn't save your preference."));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 520 }}>
      <div>
        <h1 className="sd-h1">{t("newsletterPrefsTitle")}</h1>
        <p className="sd-lead" style={{ marginTop: 8 }}>{t("newsletterPrefsLead")}</p>
      </div>

      {error && <p className="sd-lead" style={{ color: "var(--warn)", margin: 0 }}>{error}</p>}

      {subscribed === null && !error && <div className="sd-spinner" style={{ margin: "16px 0" }} />}

      {subscribed !== null && (
        <button
          type="button"
          className="sd-row"
          onClick={() => void toggle()}
          disabled={busy}
          style={{
            gap: 12, padding: "15px 16px", borderRadius: 12, width: "100%", textAlign: "left",
            font: "inherit", cursor: busy ? "default" : "pointer",
            border: `1px solid ${subscribed ? "var(--blue)" : "var(--line)"}`,
            background: subscribed ? "var(--blue-tint)" : "var(--paper)",
          }}
        >
          <div style={{
            width: 34, height: 34, borderRadius: 9, flex: "0 0 auto",
            background: subscribed ? "var(--blue)" : "var(--bg-2)",
            color: subscribed ? "var(--on-brand)" : "var(--ink-2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon name="mail" size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{t("newsletterSubscribeLabel")}</div>
            <div className="sd-meta">
              {subscribed ? t("newsletterSubscribed") : t("newsletterUnsubscribed")}
            </div>
          </div>
          {subscribed && <Icon name="check" size={20} style={{ color: "var(--blue)" }} />}
        </button>
      )}

      {/* A plain link, not a router route: the archive at `/` is server-rendered
          by a Pages Function, so navigating there has to leave the SPA. */}
      <a
        href="/"
        className="sd-row"
        style={{
          gap: 12, padding: "13px 16px", borderRadius: 12, textDecoration: "none",
          color: "inherit", border: "1px solid var(--line)", background: "var(--paper)",
        }}
      >
        <Icon name="file" size={18} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
        <span style={{ fontSize: 14.5, fontWeight: 700, flex: 1 }}>{t("newsletterArchive")}</span>
        <Icon name="chevright" size={16} style={{ color: "var(--ink-3)" }} />
      </a>
    </div>
  );

  if (desktop) {
    return <DesktopShell active="newsletter" title={t("newsletterPrefsTitle")}>{body}</DesktopShell>;
  }
  return (
    <AppShell bottomNav={<BottomNav active="newsletter" />}>
      <ScreenHeader title={t("newsletterPrefsTitle")} left="mail" />
      <div className="sd-scroll" style={{ padding: "14px 16px 24px", display: "flex", flexDirection: "column" }}>{body}<SiteFooter /></div>
    </AppShell>
  );
}

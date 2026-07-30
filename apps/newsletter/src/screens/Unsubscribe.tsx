// The unsubscribe confirmation, reached from a link in a sent email.
//
// Deliberately unauthenticated: making someone sign in to stop receiving mail is
// the exact pattern unsubscribe rules exist to prevent, and the person clicking
// may not have an account at all.
//
// The click itself doesn't unsubscribe anyone — this screen only READS whose
// address the token belongs to, and the removal happens on the button. Corporate
// mail scanners and link-preview crawlers follow GET links in email; if arriving
// here were enough, a spam filter could quietly opt out half the school.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Btn } from "../components/atoms.js";
import { Icon } from "../components/Icon.js";
import { useI18n } from "../i18n/index.js";
import { api, errorMessage } from "../lib/api.js";

export function Unsubscribe() {
  const { token = "" } = useParams();
  const { t } = useI18n();
  const [email, setEmail] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .unsubscribeTarget(token)
      .then((r) => setEmail(r.email))
      .catch((err: unknown) =>
        setError(errorMessage(err, "That unsubscribe link is no longer valid.")),
      );
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    try {
      await api.unsubscribe(token);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div
        className="sd-scroll"
        style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", gap: 18, padding: "24px 28px", textAlign: "center",
        }}
      >
        <div style={{
          width: 60, height: 60, borderRadius: 17, flex: "0 0 auto",
          background: done ? "var(--blue-tint)" : "var(--bg-2)",
          color: done ? "var(--blue)" : "var(--ink-2)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon name={done ? "check" : "mail"} size={28} stroke={1.9} />
        </div>

        {error && <p className="sd-lead" style={{ color: "var(--warn)", margin: 0 }}>{error}</p>}

        {!error && !done && (
          <>
            <div>
              <h1 className="sd-h1">{t("unsubscribeTitle")}</h1>
              <p className="sd-lead" style={{ marginTop: 9 }}>
                {email ? t("unsubscribeLead", { email }) : "…"}
              </p>
            </div>
            <Btn block onClick={() => void confirm()} disabled={busy || !email}>
              {t("unsubscribeConfirm")}
            </Btn>
          </>
        )}

        {done && (
          <div>
            <h1 className="sd-h1">{t("unsubscribeDone")}</h1>
            <p className="sd-lead" style={{ marginTop: 9 }}>{email}</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}

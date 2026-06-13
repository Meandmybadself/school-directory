// Sign in → check email. Magic-link callback is handled by the API, which
// redirects back to "/"; App then loads /me. The response to /auth/start is
// always identical (no account enumeration), so we always show "check email".
import { useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { Btn } from "../components/atoms.js";
import { AppShell } from "../components/AppShell.js";
import { api } from "../lib/api.js";
import { useI18n } from "../i18n/index.js";

function Brand({ center }: { center?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="sd-row" style={{ gap: 10, justifyContent: center ? "center" : "flex-start" }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--blue)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
        <Icon name="school" size={19} stroke={1.9} />
      </div>
      <div style={{ lineHeight: 1.05 }}>
        <div style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: "-.4px" }}>{t("brand")}</div>
        <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: ".8px", textTransform: "uppercase", color: "var(--ink-3)" }}>{t("brandSub")}</div>
      </div>
    </div>
  );
}

function Reassure({ children }: { children: ReactNode }) {
  return (
    <div className="sd-row" style={{ gap: 7, color: "var(--ink-3)", fontSize: 12.5, fontWeight: 600, justifyContent: "center", textAlign: "center", lineHeight: 1.4 }}>
      <Icon name="lock" size={14} stroke={2} style={{ flex: "0 0 auto" }} />
      <span>{children}</span>
    </div>
  );
}

export function SignIn() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const linkError = params.get("error") === "link";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return;
    setBusy(true);
    try {
      await api.authStart(email);
      navigate(`/check-email?email=${encodeURIComponent(email)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="sd-scroll" style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px 0" }}><Brand /></div>
        <form onSubmit={submit} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "24px 24px 0", gap: 18 }}>
          <div>
            <h1 className="sd-h1">{t("signInTitle")}</h1>
            <p className="sd-lead" style={{ marginTop: 10 }}>{t("signInLead")}</p>
            {linkError && (
              <p className="sd-lead" style={{ marginTop: 8, color: "var(--warn)", fontSize: 13.5 }}>
                That sign-in link was invalid or expired. Request a new one.
              </p>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="sd-label" htmlFor="email">{t("emailLabel")}</label>
              <input
                id="email"
                className="sd-input"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <Btn block icon="mail" type="submit" disabled={busy || !email.includes("@")}>{t("emailLink")}</Btn>
          </div>
        </form>
      </div>
    </AppShell>
  );
}

export function CheckEmail() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const email = params.get("email") ?? "";
  const [resent, setResent] = useState(false);

  const resend = async () => {
    if (email) await api.authStart(email);
    setResent(true);
  };

  return (
    <AppShell>
      <div className="sd-scroll" style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px 0" }}><Brand /></div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "24px 28px 0", gap: 16, textAlign: "center", alignItems: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: "var(--blue-tint)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="mail" size={30} stroke={1.8} />
          </div>
          <div>
            <h1 className="sd-h1">{t("checkEmailTitle")}</h1>
            <p className="sd-lead" style={{ marginTop: 9 }}>{t("checkEmailLead", { email })}</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", marginTop: 2 }}>
            <button className="sd-btn sd-btn-ghost" onClick={resend} disabled={resent}>
              {resent ? "Link resent" : t("resendLink")}
            </button>
            <button className="sd-btn sd-btn-ghost" onClick={() => navigate("/sign-in")}>{t("back")}</button>
          </div>
        </div>
        <div style={{ padding: "0 24px 26px" }}>
          <Reassure>{t("regClosedNote")}</Reassure>
        </div>
      </div>
    </AppShell>
  );
}

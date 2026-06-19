// Self-onboarding: a freshly-signed-in user with no directory Person yet creates
// one here (or, if they're a system admin, can skip straight to the console).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { Btn } from "../components/atoms.js";
import { AppShell } from "../components/AppShell.js";
import { Field } from "../components/parts.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { api } from "../lib/api.js";

export function CreateProfile() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { me, refresh } = useSession();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);

  // If a profile already exists (e.g. created in another tab), move along.
  useEffect(() => {
    if (me && me.persons.length > 0) navigate("/", { replace: true });
  }, [me, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) return;
    setBusy(true);
    try {
      await api.createPerson({ firstName: firstName.trim(), lastName: lastName.trim() || null });
      await refresh();
      navigate("/", { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="sd-scroll" style={{ display: "flex", flexDirection: "column" }}>
        <form onSubmit={submit} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "24px 24px 0", gap: 18, maxWidth: 460, width: "100%", margin: "0 auto" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--blue-tint)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="users3" size={28} />
            </div>
            <div>
              <h1 className="sd-h1">{t("setupTitle")}</h1>
              <p className="sd-lead" style={{ marginTop: 8 }}>{t("setupLead")}</p>
            </div>
          </div>
          <Field label={t("firstName")}>
            <input className="sd-input" value={firstName} autoFocus onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label={t("lastName")}>
            <input className="sd-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
          <Btn block icon="check" type="submit" disabled={busy || !firstName.trim()}>{t("createProfileBtn")}</Btn>
          {me?.user.isSystemAdmin && (
            <button type="button" className="sd-btn sd-btn-ghost" onClick={() => navigate("/admin")}>{t("skipToAdmin")}</button>
          )}
        </form>
      </div>
    </AppShell>
  );
}

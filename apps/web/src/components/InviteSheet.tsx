// Invite sheet — invite someone to become a co-manager of a person's profile.
// Sends through api.inviteController and shows an in-sheet success/error state.
import { useState } from "react";
import { Icon } from "./Icon.js";
import { Btn } from "./atoms.js";
import { SheetOver, Field } from "./parts.js";
import { useI18n } from "../i18n/index.js";
import { api, ApiError } from "../lib/api.js";

export function InviteSheet({
  personId,
  personName,
  onClose,
}: {
  personId: string;
  personName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);

  const canSend = !busy && email.includes("@");

  const send = async () => {
    setBusy(true);
    setError(false);
    try {
      await api.inviteController(personId, email);
      setSent(true);
    } catch (e) {
      if (e instanceof ApiError) setError(true);
      else throw e;
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <SheetOver onClose={onClose}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14, padding: "10px 0 4px" }}>
          <div style={{ width: 56, height: 56, borderRadius: 999, background: "var(--blue-tint)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="check" size={28} stroke={2.2} />
          </div>
          <p className="sd-lead">{t("inviteSent", { email })}</p>
          <Btn kind="secondary" block onClick={onClose}>{t("done")}</Btn>
        </div>
      </SheetOver>
    );
  }

  return (
    <SheetOver onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <h2 className="sd-h2">{t("inviteTitle", { name: personName })}</h2>
          <p className="sd-meta" style={{ marginTop: 4 }}>{t("inviteWhy", { name: personName })}</p>
        </div>

        <Field label={t("emailLabel")}>
          <input
            className="sd-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        {error && (
          <p className="sd-meta" style={{ color: "var(--warn)", lineHeight: 1.4 }}>
            Couldn't send the invitation. Check the email and try again.
          </p>
        )}

        <Btn block icon="mail" disabled={!canSend} onClick={() => void send()}>
          {t("inviteSend")}
        </Btn>
      </div>
    </SheetOver>
  );
}

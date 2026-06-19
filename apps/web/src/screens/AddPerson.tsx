// Add a person the signed-in User manages (child, partner, …). Creates a Person
// the User controls, optionally typed with capabilities and placed in one of the
// User's households so its shared address cascades. The User keeps acting as
// themselves; the new Person shows up in the switcher.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ASSIGNABLE_CAPABILITIES, type Capability, type MyHouseholdDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Btn } from "../components/atoms.js";
import { AppShell } from "../components/AppShell.js";
import { Field } from "../components/parts.js";
import { capLabel, useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { api } from "../lib/api.js";

export function AddPerson() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [caps, setCaps] = useState<Capability[]>([]);
  const [households, setHouseholds] = useState<MyHouseholdDTO[]>([]);
  const [householdId, setHouseholdId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.myHouseholds().then((r) => setHouseholds(r.households)).catch(() => setHouseholds([]));
  }, []);

  const toggleCap = (cap: Capability) =>
    setCaps((cur) => (cur.includes(cap) ? cur.filter((x) => x !== cap) : [...cur, cap]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) return;
    setBusy(true);
    try {
      const { id } = await api.createPerson({
        firstName: firstName.trim(),
        lastName: lastName.trim() || null,
        capabilities: caps,
        householdId: householdId || null,
      });
      await refresh();
      // Stay acting as ourselves; jump to the new Person's profile to continue.
      navigate(`/persons/${id}`, { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="sd-scroll" style={{ display: "flex", flexDirection: "column" }}>
        <form onSubmit={submit} style={{ flex: 1, display: "flex", flexDirection: "column", padding: "24px 24px 32px", gap: 18, maxWidth: 460, width: "100%", margin: "0 auto" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--blue-tint)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="users3" size={28} />
            </div>
            <div>
              <h1 className="sd-h1">{t("addPersonTitle")}</h1>
              <p className="sd-lead" style={{ marginTop: 8 }}>{t("addPersonLead")}</p>
            </div>
          </div>

          <Field label={t("firstName")}>
            <input className="sd-input" value={firstName} autoFocus onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label={t("lastName")}>
            <input className="sd-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>

          <Field label={t("personType")} hint={t("personTypeNote")}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {ASSIGNABLE_CAPABILITIES.map((cap) => {
                const on = caps.includes(cap);
                return (
                  <button
                    key={cap}
                    type="button"
                    onClick={() => toggleCap(cap)}
                    aria-pressed={on}
                    className="sd-tag"
                    style={{
                      cursor: "pointer", font: "inherit",
                      border: "1px solid " + (on ? "var(--blue)" : "var(--line)"),
                      background: on ? "var(--blue)" : "var(--paper)",
                      color: on ? "#fff" : "var(--ink-2)",
                    }}
                  >
                    {on && <Icon name="check" size={13} stroke={2.4} />}
                    {capLabel(t, cap)}
                  </button>
                );
              })}
            </div>
          </Field>

          {households.length > 0 && (
            <Field label={t("personHousehold")} hint={t("personHouseholdNote")}>
              <select className="sd-input" value={householdId} onChange={(e) => setHouseholdId(e.target.value)}>
                <option value="">{t("householdNone")}</option>
                {households.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </Field>
          )}

          <Btn block icon="plus" type="submit" disabled={busy || !firstName.trim()}>{t("addPersonBtn")}</Btn>
          <button type="button" className="sd-btn sd-btn-ghost" onClick={() => navigate(-1)}>{t("cancel")}</button>
        </form>
      </div>
    </AppShell>
  );
}

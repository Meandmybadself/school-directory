// Visibility sheet — pick Members / Private / Shared, and (for saved contact
// items) manage the People/Groups a private item is shared with. Grantee changes
// hit the shares API live; the Members/Private/Shared *level* is reported back to
// the editor via onChange and persisted on Save.
import { useEffect, useState } from "react";
import type { ShareGranteeDTO, ShareTargetDTO, Visibility } from "@sd/shared";
import { Icon } from "./Icon.js";
import { Avatar, Btn } from "./atoms.js";
import { SheetOver, OptionRow } from "./parts.js";
import { useI18n } from "../i18n/index.js";
import { api } from "../lib/api.js";

type Level = "members" | "private" | "shared";

export function VisibilitySheet({
  contactId,
  fieldLabel,
  visibility,
  onChange,
  onClose,
}: {
  contactId: string;
  fieldLabel: string;
  visibility: Visibility;
  /** Report the chosen level + resulting grantee count to the editor. */
  onChange: (visibility: Visibility, shareCount: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const canShare = !contactId.startsWith("tmp_");
  const [grantees, setGrantees] = useState<ShareGranteeDTO[]>([]);
  const [picker, setPicker] = useState(false);
  // Local view of the level so the radios respond instantly.
  const [level, setLevel] = useState<Level>(
    visibility === "service" ? "members" : "private",
  );

  const refresh = async () => {
    if (!canShare) return;
    const { grantees: g } = await api.listShares("contact_item", contactId);
    setGrantees(g);
    if (g.length > 0 && visibility !== "service") setLevel("shared");
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  const clearGrantees = async () => {
    for (const g of grantees) await api.deleteShare(g.id).catch(() => {});
    setGrantees([]);
  };

  const pickMembers = async () => {
    setLevel("members");
    await clearGrantees();
    onChange("service", 0);
  };
  const pickPrivate = async () => {
    setLevel("private");
    await clearGrantees();
    onChange("private", 0);
  };
  const pickShared = () => {
    setLevel("shared");
    onChange("private", grantees.length);
  };

  const addTarget = async (target: ShareTargetDTO) => {
    await api.createShare({
      subjectKind: "contact_item",
      subjectRef: contactId,
      targetKind: target.kind,
      targetId: target.id,
    });
    const { grantees: g } = await api.listShares("contact_item", contactId);
    setGrantees(g);
    setLevel("shared");
    onChange("private", g.length);
  };
  const removeGrantee = async (id: string) => {
    await api.deleteShare(id);
    const next = grantees.filter((g) => g.id !== id);
    setGrantees(next);
    onChange("private", next.length);
    if (next.length === 0) setLevel("private");
  };

  if (picker) {
    return <SharePicker existing={grantees} onAdd={addTarget} onClose={() => setPicker(false)} />;
  }

  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2">{t("whoCanSee", { field: fieldLabel.toLowerCase() })}</h2>
      <p className="sd-meta" style={{ marginBottom: 14, marginTop: 4 }}>Pick who can see this. You can change it anytime.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <OptionRow icon="members" tone="members" title={t("visMembers")} sub={t("visMembersDesc")} selected={level === "members"} onClick={() => void pickMembers()} />
        <OptionRow icon="lock" tone="private" title={t("visPrivate")} sub={t("visPrivateDesc")} selected={level === "private"} onClick={() => void pickPrivate()} />
        <div style={{ opacity: canShare ? 1 : 0.5 }}>
          <OptionRow
            icon="lock"
            tone="shared"
            title={t("visShared")}
            sub={canShare ? t("visSharedDesc") : `${t("visSharedDesc")} — save first`}
            selected={level === "shared"}
            onClick={canShare ? pickShared : undefined}
          />
        </div>
      </div>

      {level === "shared" && canShare && (
        <div style={{ marginTop: 14, border: "1px solid var(--orange-tint-2)", background: "var(--orange-tint)", borderRadius: 14, padding: 14 }}>
          <div className="sd-row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <span className="sd-eyebrow" style={{ color: "var(--orange-ink)" }}>{t("sharedWith")} · {grantees.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {grantees.map((g) => (
              <div key={g.id} className="sd-row" style={{ gap: 10 }}>
                {g.targetKind === "group" ? (
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: "var(--blue-tint)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}><Icon name="home" size={17} /></div>
                ) : (
                  <Avatar name={g.name} size={32} />
                )}
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{g.name}</span>
                <button aria-label="Remove" onClick={() => void removeGrantee(g.id)} style={{ background: "none", border: 0, color: "var(--orange-ink)", cursor: "pointer" }}><Icon name="x" size={16} /></button>
              </div>
            ))}
            {grantees.length === 0 && <div className="sd-meta">No one yet — add a person or group below.</div>}
          </div>
          <button className="sd-btn sd-btn-sm block" style={{ marginTop: 11, background: "#fff", color: "var(--orange-ink)", border: "1px solid var(--orange-tint-2)" }} onClick={() => setPicker(true)}>
            <Icon name="plus" size={16} />{t("addPeople")}
          </button>
        </div>
      )}

      <Btn block style={{ marginTop: 16 }} onClick={onClose}>{t("done")}</Btn>
    </SheetOver>
  );
}

function SharePicker({
  existing,
  onAdd,
  onClose,
}: {
  existing: ShareGranteeDTO[];
  onAdd: (t: ShareTargetDTO) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [targets, setTargets] = useState<ShareTargetDTO[]>([]);
  const sharedIds = new Set(existing.map((g) => `${g.targetKind}:${g.targetId}`));

  useEffect(() => {
    const id = setTimeout(() => {
      void api.shareTargets(q).then((r) => setTargets(r.targets)).catch(() => setTargets([]));
    }, 200);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 10 }}>{t("addPeople")}</h2>
      <input className="sd-input" placeholder={`${t("navDir")}…`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12, maxHeight: 340, overflowY: "auto" }}>
        {targets.map((tg) => {
          const already = sharedIds.has(`${tg.kind}:${tg.id}`);
          return (
            <button
              key={`${tg.kind}:${tg.id}`}
              type="button"
              className="sd-row"
              disabled={already}
              onClick={() => void onAdd(tg)}
              style={{ gap: 11, padding: "9px 8px", borderRadius: 10, border: 0, background: "transparent", width: "100%", textAlign: "left", font: "inherit", cursor: already ? "default" : "pointer", opacity: already ? 0.5 : 1 }}
            >
              {tg.kind === "group" ? (
                <div style={{ width: 34, height: 34, borderRadius: 9, background: tg.groupKind === "classroom" ? "var(--orange-tint)" : "var(--blue-tint)", color: tg.groupKind === "classroom" ? "var(--orange-700)" : "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
                  <Icon name={tg.groupKind === "classroom" ? "school" : "home"} size={17} />
                </div>
              ) : (
                <Avatar name={tg.name} size={34} />
              )}
              <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600 }}>{tg.name}</span>
              {already ? <Icon name="check" size={18} style={{ color: "var(--ok)" }} /> : <Icon name="plus" size={18} style={{ color: "var(--ink-3)" }} />}
            </button>
          );
        })}
        {targets.length === 0 && <div className="sd-meta" style={{ padding: "12px 0" }}>No matches.</div>}
      </div>
      <Btn block kind="secondary" style={{ marginTop: 14 }} onClick={onClose}>{t("done")}</Btn>
    </SheetOver>
  );
}

// "Your profile" snapshot card — shared by mobile + desktop Home.
import { useNavigate } from "react-router-dom";
import type { ControllablePersonDTO, PersonProfileDTO } from "@sd/shared";
import { Icon } from "./Icon.js";
import { Avatar, Btn } from "./atoms.js";
import { useI18n } from "../i18n/index.js";

function capLabel(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1).replace("_", " ");
}

function MiniStat({ state, n, label }: { state: "members" | "private" | "shared"; n: number; label: string }) {
  const cls = state === "members" ? "vis-members" : state === "shared" ? "vis-shared" : "vis-private";
  const icon = state === "members" ? "members" : "lock";
  return (
    <div className={`sd-vis ${cls}`} style={{ height: 28, cursor: "default", gap: 6 }}>
      <Icon name={icon} size={12} stroke={2} />
      <span style={{ fontWeight: 800 }}>{n}</span>
      <span style={{ fontWeight: 600, opacity: 0.8 }}>{label}</span>
    </div>
  );
}

export function ProfileSnapshot({
  person,
  profile,
}: {
  person: ControllablePersonDTO;
  profile: PersonProfileDTO | null;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const contacts = profile?.contacts ?? [];
  const membersN = contacts.filter((c) => c.visibility === "service").length;
  const sharedN = contacts.filter((c) => c.visibility === "private" && (c.shareCount ?? 0) > 0).length;
  const privateN = contacts.filter((c) => c.visibility === "private" && !(c.shareCount ?? 0)).length;
  const addressItem = contacts.find((c) => c.type === "address");
  const neighborOn = addressItem?.neighborDiscoverable ?? false;

  return (
    <div className="sd-card sd-card-pad">
      <div className="sd-row" style={{ gap: 12 }}>
        <Avatar name={person.displayName} size={46} img={person.photoUrl} color="var(--blue)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.2px" }}>{person.displayName}</div>
          <div className="sd-meta">{person.capabilities.map(capLabel).join(" · ")}</div>
        </div>
        <button className="sd-btn sd-btn-secondary sd-btn-sm" onClick={() => navigate(`/persons/${person.id}`)}>
          <Icon name="eye" size={15} />{t("preview")}
        </button>
      </div>
      <hr className="sd-divider" style={{ margin: "13px 0 12px" }} />
      <div className="sd-eyebrow" style={{ marginBottom: 9 }}>{t("whatYouShare")}</div>
      <div className="sd-row" style={{ gap: 7, flexWrap: "wrap" }}>
        <MiniStat state="members" n={membersN} label={t("membersN")} />
        <MiniStat state="private" n={privateN} label={t("privateN")} />
        <MiniStat state="shared" n={sharedN} label={t("sharedN")} />
      </div>
      {addressItem && (
        <div className="sd-row" style={{ gap: 9, marginTop: 13, padding: "11px 12px", background: "var(--orange-tint)", borderRadius: 11 }}>
          <Icon name="pin" size={17} style={{ color: "var(--orange-ink)", flex: "0 0 auto" }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--orange-ink)", flex: 1 }}>{t("shownAsNeighbor")}</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: "var(--orange-ink)" }}>{neighborOn ? t("on") : t("off")}</span>
          <div className={`sd-toggle${neighborOn ? " on" : ""}`} style={neighborOn ? { background: "var(--orange-700)" } : undefined} />
        </div>
      )}
      <Btn block kind="secondary" icon="pencil" style={{ marginTop: 13 }} onClick={() => navigate(`/persons/${person.id}/edit`)}>
        {t("editProfile")}
      </Btn>
    </div>
  );
}

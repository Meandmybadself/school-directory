// Home (Layout A): Neighbors grid → Your groups → Profile snapshot.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { NeighborsResponse, PersonProfileDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Avatar, Btn } from "../components/atoms.js";
import { AppBar, IconBtn, SectLabel, GroupTile, NeighborCard, CTACard } from "../components/parts.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { PersonSwitcherSheet, LanguageSheet } from "../components/Sheets.js";
import { useSession } from "../lib/session.js";
import { api } from "../lib/api.js";
import { useI18n } from "../i18n/index.js";

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

export function Home() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { me, activePerson } = useSession();
  const [profile, setProfile] = useState<PersonProfileDTO | null>(null);
  const [neighbors, setNeighbors] = useState<NeighborsResponse | null>(null);
  const [sheet, setSheet] = useState<"switcher" | "language" | null>(null);

  const activeId = activePerson?.id;
  useEffect(() => {
    if (!activeId) return;
    void api.person(activeId).then(setProfile).catch(() => setProfile(null));
    void api.neighbors().then(setNeighbors).catch(() => setNeighbors({ addCta: true }));
  }, [activeId]);

  if (!me || !activePerson) return null;

  const contacts = profile?.contacts ?? [];
  const membersN = contacts.filter((c) => c.visibility === "service").length;
  const sharedN = contacts.filter((c) => c.visibility === "private" && (c.shareCount ?? 0) > 0).length;
  const privateN = contacts.filter((c) => c.visibility === "private" && !(c.shareCount ?? 0)).length;
  const groups = profile?.groups ?? [];
  const hasNeighbors = neighbors && "neighbors" in neighbors && neighbors.neighbors.length > 0;
  const addressItem = contacts.find((c) => c.type === "address");
  const neighborOn = addressItem?.neighborDiscoverable ?? false;

  return (
    <AppShell bottomNav={<BottomNav active="home" />}>
      <AppBar
        name={activePerson.displayName}
        sub={activePerson.capabilities.map(cap).join(" · ")}
        color="var(--blue)"
        onSwitcher={() => setSheet("switcher")}
        trailing={
          <>
            <IconBtn name="globe" label="Language" onClick={() => setSheet("language")} />
            <IconBtn name="search" label="Search" onClick={() => navigate("/directory")} />
          </>
        }
      />
      <div className="sd-scroll">
        <div className="sd-body">
          {/* Neighbors */}
          <div>
            <SectLabel action={hasNeighbors ? <button className="sd-btn sd-btn-ghost sd-btn-sm" style={{ height: 24, padding: "0 4px" }}>{t("seeAll")}</button> : undefined}>
              {t("neighbors")}
            </SectLabel>
            {hasNeighbors ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 9 }}>
                {(neighbors as { neighbors: { name: string; approxDistance: string; connected: boolean }[] }).neighbors.map((n) => (
                  <NeighborCard
                    key={n.name}
                    name={n.name}
                    dist={n.approxDistance}
                    connected={n.connected}
                    connectText={t("connect")}
                    connectedText={t("connected")}
                    memberText={t("member")}
                  />
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 9 }}>
                <CTACard
                  icon="pin"
                  title={t("addAddressTitle")}
                  body={t("addAddressBody")}
                  action={<Btn block icon="plus" onClick={() => navigate(`/persons/${activePerson.id}/edit`)}>{t("addAddressBtn")}</Btn>}
                />
              </div>
            )}
          </div>

          {/* Your groups */}
          <div>
            <SectLabel>{t("groups")}</SectLabel>
            {groups.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 9 }}>
                {groups.map((g) => (
                  <GroupTile
                    key={g.id}
                    icon={g.kind === "classroom" ? "school" : "home"}
                    name={g.name}
                    sub={`${g.memberCount} ${t("members").toLowerCase()}`}
                    color={g.kind === "classroom" ? "var(--orange-700)" : "var(--blue)"}
                    tint={g.kind === "classroom" ? "var(--orange-tint)" : "var(--blue-tint)"}
                    onClick={() => navigate(`/groups/${g.id}`)}
                  />
                ))}
              </div>
            ) : (
              <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
                <div className="sd-row" style={{ gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 11, background: "var(--bg-2)", color: "var(--ink-3)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
                    <Icon name="users3" size={21} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>{t("noGroups")}</div>
                    <div className="sd-meta" style={{ marginTop: 2, lineHeight: 1.4 }}>{t("noGroupsBody")}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Profile snapshot */}
          <div className="sd-card sd-card-pad">
            <div className="sd-row" style={{ gap: 12 }}>
              <Avatar name={activePerson.displayName} size={46} img={activePerson.photoUrl} color="var(--blue)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.2px" }}>{activePerson.displayName}</div>
                <div className="sd-meta">{activePerson.capabilities.map(cap).join(" · ")}</div>
              </div>
              <button className="sd-btn sd-btn-secondary sd-btn-sm" onClick={() => navigate(`/persons/${activePerson.id}`)}>
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
            <Btn block kind="secondary" icon="pencil" style={{ marginTop: 13 }} onClick={() => navigate(`/persons/${activePerson.id}/edit`)}>
              {t("editProfile")}
            </Btn>
          </div>
        </div>
      </div>
      {sheet === "switcher" && <PersonSwitcherSheet onClose={() => setSheet(null)} />}
      {sheet === "language" && <LanguageSheet onClose={() => setSheet(null)} />}
    </AppShell>
  );
}

function cap(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1).replace("_", " ");
}

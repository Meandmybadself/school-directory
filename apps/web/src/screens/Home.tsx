// Home — Layout A. Mobile: app-bar + bottom nav. Desktop: sidebar shell with a
// 4-up Neighbors row and the groups list.
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { GroupSummaryDTO, NeighborsResponse, PersonProfileDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Btn } from "../components/atoms.js";
import { AppBar, IconBtn, SectLabel, GroupTile, NeighborCard, CTACard } from "../components/parts.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { PersonSwitcherSheet, LanguageSheet, LanguageButton } from "../components/Sheets.js";
import { useSession } from "../lib/session.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, mediaUrl } from "../lib/api.js";
import { capLabel, useI18n } from "../i18n/index.js";

export function Home() {
  const { me, activePerson } = useSession();
  const isDesktop = useIsDesktop();
  const [profile, setProfile] = useState<PersonProfileDTO | null>(null);
  const [neighbors, setNeighbors] = useState<NeighborsResponse | null>(null);

  const activeId = activePerson?.id;
  useEffect(() => {
    if (!activeId) return;
    void api.person(activeId).then(setProfile).catch(() => setProfile(null));
    void api.neighbors().then(setNeighbors).catch(() => setNeighbors({ addCta: true }));
  }, [activeId]);

  if (!me || !activePerson) return null;

  const groups = profile?.groups ?? [];
  const list = neighbors && "neighbors" in neighbors ? neighbors.neighbors : null;
  const hasNeighbors = !!list && list.length > 0;

  const shared = { activePerson, groups, list, hasNeighbors };
  return isDesktop ? <DesktopHome {...shared} /> : <MobileHome {...shared} />;
}

interface ViewProps {
  activePerson: NonNullable<ReturnType<typeof useSession>["activePerson"]>;
  groups: GroupSummaryDTO[];
  list: { id: string; name: string; approxDistance: string; kind: "person" | "household" }[] | null;
  hasNeighbors: boolean;
}

function useNeighborCards(list: ViewProps["list"]) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (list ?? []).map((n) => (
    <NeighborCard
      key={`${n.kind}:${n.id}`}
      name={n.name}
      dist={n.approxDistance}
      memberText={t("member")}
      onClick={() => navigate(n.kind === "household" ? `/groups/${n.id}` : `/persons/${n.id}`)}
    />
  ));
}

function GroupsContent({ groups, columns }: { groups: GroupSummaryDTO[]; columns: number }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  if (groups.length === 0) {
    return (
      <div className="sd-card sd-card-pad">
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
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: columns === 1 ? "1fr" : "1fr 1fr", gap: columns === 1 ? 9 : 12, marginTop: columns === 1 ? 0 : 0 }}>
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
  );
}

// ── Desktop ──────────────────────────────────────────────────────────────────

function DesktopHome({ activePerson, groups, hasNeighbors, list }: ViewProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const cards = useNeighborCards(list);
  return (
    <DesktopShell active="home" title={t("navHome")}>
      <div>
        <SectLabel action={hasNeighbors ? <button className="sd-btn sd-btn-ghost sd-btn-sm">{t("seeAll")}</button> : undefined}>
          {t("neighbors")}
        </SectLabel>
        {hasNeighbors ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginTop: 11 }}>{cards}</div>
            <p className="sd-meta" style={{ marginTop: 8, fontSize: 11 }}>{t("osmAttribution")}</p>
          </>
        ) : (
          <div style={{ marginTop: 11, maxWidth: 520 }}>
            <CTACard icon="pin" title={t("addAddressTitle")} body={t("addAddressBody")} action={<Btn block icon="plus" onClick={() => navigate(`/persons/${activePerson.id}/edit?add=address`)}>{t("addAddressBtn")}</Btn>} />
          </div>
        )}
      </div>
      <div>
        <SectLabel>{t("groups")}</SectLabel>
        <div style={{ marginTop: 11 }}>
          <GroupsContent groups={groups} columns={2} />
        </div>
      </div>
    </DesktopShell>
  );
}

// ── Mobile ─────────────────────────────────────────────────────────────────

function MobileHome({ activePerson, groups, hasNeighbors, list }: ViewProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const cards = useNeighborCards(list);
  const [sheet, setSheet] = useState<"switcher" | "language" | null>(null);

  let neighborsBlock: ReactNode;
  if (hasNeighbors) {
    neighborsBlock = (
      <>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 9 }}>{cards}</div>
        <p className="sd-meta" style={{ marginTop: 8, fontSize: 11 }}>{t("osmAttribution")}</p>
      </>
    );
  } else {
    neighborsBlock = (
      <div style={{ marginTop: 9 }}>
        <CTACard icon="pin" title={t("addAddressTitle")} body={t("addAddressBody")} action={<Btn block icon="plus" onClick={() => navigate(`/persons/${activePerson.id}/edit?add=address`)}>{t("addAddressBtn")}</Btn>} />
      </div>
    );
  }

  return (
    <AppShell bottomNav={<BottomNav active="home" />}>
      <AppBar
        name={activePerson.displayName}
        sub={activePerson.capabilities.map((c) => capLabel(t, c)).join(" · ")}
        color="var(--blue)"
        img={mediaUrl(activePerson.photoUrl)}
        onSwitcher={() => setSheet("switcher")}
        trailing={
          <>
            <LanguageButton onClick={() => setSheet("language")} />
            <IconBtn name="search" label="Search" onClick={() => navigate("/directory")} />
          </>
        }
      />
      <div className="sd-scroll">
        <div className="sd-body">
          <div>
            <SectLabel action={hasNeighbors ? <button className="sd-btn sd-btn-ghost sd-btn-sm" style={{ height: 24, padding: "0 4px" }}>{t("seeAll")}</button> : undefined}>
              {t("neighbors")}
            </SectLabel>
            {neighborsBlock}
          </div>
          <div>
            <SectLabel>{t("groups")}</SectLabel>
            <div style={{ marginTop: 9 }}>
              <GroupsContent groups={groups} columns={1} />
            </div>
          </div>
        </div>
      </div>
      {sheet === "switcher" && <PersonSwitcherSheet onClose={() => setSheet(null)} />}
      {sheet === "language" && <LanguageSheet onClose={() => setSheet(null)} />}
    </AppShell>
  );
}

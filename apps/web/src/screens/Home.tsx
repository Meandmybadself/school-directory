// Home — Layout A. Mobile: app-bar + bottom nav. Desktop: sidebar shell with a
// 4-up Neighbors row and the groups list.
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { CalendarEventDTO, GroupSummaryDTO, NeighborsResponse, PersonProfileDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Btn } from "../components/atoms.js";
import type { I18nT } from "../i18n/index.js";
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
  const [events, setEvents] = useState<CalendarEventDTO[] | null>(null);

  const activeId = activePerson?.id;
  useEffect(() => {
    if (!activeId) return;
    void api.person(activeId).then(setProfile).catch(() => setProfile(null));
    void api.neighbors().then(setNeighbors).catch(() => setNeighbors({ addCta: true }));
  }, [activeId]);

  // The calendar is shared (not per-Person), so fetch once.
  useEffect(() => {
    void api.calendarEvents({ limit: 5 }).then((r) => setEvents(r.events)).catch(() => setEvents([]));
  }, []);

  if (!me || !activePerson) return null;

  const groups = profile?.groups ?? [];
  const list = neighbors && "neighbors" in neighbors ? neighbors.neighbors : null;
  const hasNeighbors = !!list && list.length > 0;
  // The server says addCta only when the Person has NO address at all. An empty
  // `list` with no addCta means: has an address, just no neighbors nearby.
  const noAddress = !!neighbors && "addCta" in neighbors;

  const shared = { activePerson, groups, list, hasNeighbors, noAddress, events };
  return isDesktop ? <DesktopHome {...shared} /> : <MobileHome {...shared} />;
}

interface ViewProps {
  activePerson: NonNullable<ReturnType<typeof useSession>["activePerson"]>;
  groups: GroupSummaryDTO[];
  list: { id: string; name: string; approxDistance: string; kind: "person" | "household" }[] | null;
  hasNeighbors: boolean;
  /** True only when the Person has no address at all (show the add-address CTA). */
  noAddress: boolean;
  events: CalendarEventDTO[] | null;
}

/** Compact upcoming-events block for Home; hidden entirely when there's nothing.
 *  `half` constrains it to 50% width (desktop only). */
function EventsSection({ events, half }: { events: CalendarEventDTO[] | null; half?: boolean }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  if (!events || events.length === 0) return null;
  return (
    <div style={half ? { maxWidth: "50%" } : undefined}>
      <SectLabel action={<button className="sd-btn sd-btn-ghost sd-btn-sm" style={{ height: 24, padding: "0 4px" }} onClick={() => navigate("/calendar")}>{t("seeAll")}</button>}>
        {t("upcomingEvents")}
      </SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4, display: "flex", flexDirection: "column" }}>
        {events.map((e) => <HomeEventRow key={e.id} e={e} locale={locale} t={t} onClick={() => navigate("/calendar")} />)}
      </div>
    </div>
  );
}

function HomeEventRow({ e, locale, t, onClick }: { e: CalendarEventDTO; locale: string; t: I18nT; onClick: () => void }) {
  const d = new Date(e.start);
  const dateLabel = d.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  const timeLabel = e.allDay ? t("allDay") : d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  return (
    <button type="button" onClick={onClick} className="sd-crow" style={{ gap: 11, border: 0, background: "transparent", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", alignItems: "flex-start" }}>
      <span style={{ width: 4, alignSelf: "stretch", borderRadius: 4, background: e.source.color, flex: "0 0 auto", minHeight: 18 }} />
      <div className="sd-cmain" style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{e.title}</div>
        <div className="sd-meta">{dateLabel} · {timeLabel}{e.location ? ` · ${e.location}` : ""}</div>
      </div>
    </button>
  );
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

function DesktopHome({ activePerson, groups, hasNeighbors, noAddress, list, events }: ViewProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const cards = useNeighborCards(list);
  return (
    <DesktopShell active="home" title={t("navHome")}>
      <EventsSection events={events} half />
      <div>
        <SectLabel action={hasNeighbors ? <button className="sd-btn sd-btn-ghost sd-btn-sm">{t("seeAll")}</button> : undefined}>
          {t("neighbors")}
        </SectLabel>
        {hasNeighbors ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginTop: 11 }}>{cards}</div>
            <p className="sd-meta" style={{ marginTop: 8, fontSize: 11 }}>{t("osmAttribution")}</p>
          </>
        ) : noAddress ? (
          <div style={{ marginTop: 11, maxWidth: 520 }}>
            <CTACard icon="pin" title={t("addAddressTitle")} body={t("addAddressBody")} action={<Btn block icon="plus" onClick={() => navigate(`/persons/${activePerson.id}/edit?add=address`)}>{t("addAddressBtn")}</Btn>} />
          </div>
        ) : (
          <div className="sd-card sd-card-pad sd-meta" style={{ marginTop: 11, maxWidth: 520 }}>{t("noNeighbors")}</div>
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

function MobileHome({ activePerson, groups, hasNeighbors, noAddress, list, events }: ViewProps) {
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
  } else if (noAddress) {
    neighborsBlock = (
      <div style={{ marginTop: 9 }}>
        <CTACard icon="pin" title={t("addAddressTitle")} body={t("addAddressBody")} action={<Btn block icon="plus" onClick={() => navigate(`/persons/${activePerson.id}/edit?add=address`)}>{t("addAddressBtn")}</Btn>} />
      </div>
    );
  } else {
    neighborsBlock = (
      <div className="sd-card sd-card-pad sd-meta" style={{ marginTop: 9 }}>{t("noNeighbors")}</div>
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
          <EventsSection events={events} />
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

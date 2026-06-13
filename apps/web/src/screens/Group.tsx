// Group detail (Household / Classroom) — mobile + desktop layouts.
// Desktop Household mirrors design_handoff/screens-desktop.jsx (wide member card
// + 320px household-contact rail).
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ContactItemDTO, GroupDetailDTO } from "@sd/shared";
import { Icon, type IconName } from "../components/Icon.js";
import { Avatar, Btn, Tag, Vis, type VisState } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel, ContactRow, MemberRow, GroupTile } from "../components/parts.js";
import { useI18n } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { useSession } from "../lib/session.js";
import { api, ApiError } from "../lib/api.js";
import type { GroupSummaryDTO } from "@sd/shared";

const TYPE_ICON: Record<string, IconName> = { address: "pin", phone: "phone", email: "mail", url: "link" };

function visState(c: ContactItemDTO): VisState {
  if (c.visibility === "service") return "members";
  if ((c.shareCount ?? 0) > 0) return "shared";
  return "private";
}

export function GroupDetail() {
  const { id } = useParams();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const [g, setG] = useState<GroupDetailDTO | null>(null);
  const [error, setError] = useState<"forbidden" | "not_found" | null>(null);

  useEffect(() => {
    if (!id) return;
    void api
      .group(id)
      .then(setG)
      .catch((e) => setError(e instanceof ApiError && e.status === 403 ? "forbidden" : "not_found"));
  }, [id]);

  if (error) {
    const msg = error === "forbidden" ? "You're not a member of this group." : "Group not found.";
    return isDesktop ? (
      <DesktopShell active="groups" title="Groups"><Note text={msg} /></DesktopShell>
    ) : (
      <AppShell bottomNav={<BottomNav active="groups" />}><ScreenHeader title="" onLeft={() => navigate("/groups")} /><Note text={msg} /></AppShell>
    );
  }
  if (!g) return null;
  return isDesktop ? <DesktopGroup g={g} /> : <MobileGroup g={g} />;
}

function isHousehold(g: GroupDetailDTO) {
  return g.kind === "household";
}

// ── Groups index (the active Person's groups) ────────────────────────────────

export function GroupsIndex() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { activePerson } = useSession();
  const [groups, setGroups] = useState<GroupSummaryDTO[]>([]);

  useEffect(() => {
    if (!activePerson) return;
    void api.person(activePerson.id).then((p) => setGroups(p.groups)).catch(() => setGroups([]));
  }, [activePerson]);

  const tiles = (
    <div style={{ display: isDesktop ? "grid" : "flex", gridTemplateColumns: "1fr 1fr", flexDirection: "column", gap: isDesktop ? 12 : 9 }}>
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
      {groups.length === 0 && (
        <div className="sd-card sd-card-pad sd-meta">{t("noGroupsBody")}</div>
      )}
    </div>
  );

  if (isDesktop) {
    return (
      <DesktopShell active="groups" title={t("navGroups")}>
        {tiles}
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="groups" />}>
      <ScreenHeader title={t("navGroups")} onLeft={() => navigate("/")} />
      <div className="sd-scroll"><div className="sd-body">{tiles}</div></div>
    </AppShell>
  );
}

function MemberTags({ m }: { m: GroupDetailDTO["members"][number] }) {
  return (
    <>
      {m.isYou && <Tag tone="blue">You</Tag>}
      {m.isAdmin && (
        <Tag tone="line"><Icon name="shield" size={11} stroke={2} />Admin</Tag>
      )}
    </>
  );
}

function ContactCard({ g }: { g: GroupDetailDTO }) {
  const { t } = useI18n();
  if (g.contacts.length === 0) return null;
  return (
    <div className="sd-card sd-card-pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
      {g.contacts.map((c) => (
        <ContactRow
          key={c.id}
          icon={TYPE_ICON[c.type] ?? "info"}
          label={c.label || c.type}
          value={c.type === "address" && !c.value ? t("exactHidden") : c.value}
          vis={<Vis state={visState(c)} count={c.shareCount} withCaret={g.viewerIsAdmin} membersText={t("visMembers")} privateText={t("visPrivate")} sharedText={t("visShared")} />}
        />
      ))}
    </div>
  );
}

// ── Mobile ─────────────────────────────────────────────────────────────────

function MobileGroup({ g }: { g: GroupDetailDTO }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const hh = isHousehold(g);
  return (
    <AppShell bottomNav={<BottomNav active="groups" />}>
      <ScreenHeader
        title={hh ? t("household") : t("classroom")}
        onLeft={() => navigate("/groups")}
        right={g.viewerIsAdmin ? <button className={`sd-btn sd-btn-${hh ? "secondary" : "orange"} sd-btn-sm`}><Icon name={hh ? "gear" : "plus"} size={15} />{hh ? t("manage") : t("addMember")}</button> : undefined}
      />
      <div className="sd-scroll">
        {/* hero */}
        <div style={{ background: "var(--paper)", borderBottom: "1px solid var(--line)", padding: "16px 18px 18px" }}>
          <div className="sd-row" style={{ gap: 13 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: hh ? "var(--blue-tint)" : "var(--orange-tint)", color: hh ? "var(--blue)" : "var(--orange-700)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
              <Icon name={hh ? "home" : "school"} size={26} stroke={1.9} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sd-h2">{g.name}</div>
              <div className="sd-meta" style={{ marginTop: 2 }}>{g.memberCount} {t("members").toLowerCase()}</div>
            </div>
          </div>
          <div className="sd-row" style={{ gap: 6, marginTop: 12 }}>
            {g.viewerIsAdmin ? (
              <Tag tone={hh ? "blue" : "orange"} icon="shield">{hh ? t("youreAdmin") : t("teachThisClass")}</Tag>
            ) : (
              <Tag tone="line"><Icon name="eye" size={12} stroke={2} />{hh ? t("viewOnly") : t("classMember")}</Tag>
            )}
          </div>
        </div>

        <div className="sd-body" style={{ gap: 14 }}>
          {hh && g.contacts.length > 0 && (
            <div>
              <SectLabel>{t("householdContact")}</SectLabel>
              <div style={{ marginTop: 9 }}><ContactCard g={g} /></div>
            </div>
          )}

          <div>
            <SectLabel action={g.viewerIsAdmin ? <button className="sd-btn sd-btn-ghost sd-btn-sm" style={{ height: 24, padding: "0 4px", color: hh ? undefined : "var(--orange-700)" }}>{hh ? <><Icon name="plus" size={15} />{t("addMember")}</> : t("setTitles")}</button> : undefined}>
              {hh ? t("members") : t("roster")}
            </SectLabel>
            <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4 }}>
              {g.members.map((m) => (
                <MemberRow
                  key={m.personId}
                  name={m.displayName}
                  title={m.title ?? undefined}
                  tags={<MemberTags m={m} />}
                  onClick={() => navigate(`/persons/${m.personId}`)}
                  trailing={
                    g.viewerIsAdmin ? (
                      <button aria-label="More" style={{ width: 30, height: 30, borderRadius: 8, border: 0, background: "transparent", color: "var(--ink-3)", cursor: "pointer" }}><Icon name="dot3" size={18} /></button>
                    ) : (
                      <Icon name="chevright" size={17} style={{ color: "var(--ink-3)" }} />
                    )
                  }
                />
              ))}
            </div>
          </div>

          {g.viewerIsAdmin ? (
            hh ? (
              <Btn block kind="secondary" icon="pencil">{t("editGroupInfo")}</Btn>
            ) : (
              <div className="sd-row" style={{ gap: 9 }}>
                <Btn block kind="secondary" icon="users3" style={{ flex: 1 }}>{t("manageMembers")}</Btn>
                <Btn block kind="secondary" icon="bolt" style={{ flex: 1 }}>{t("messageAll")}</Btn>
              </div>
            )
          ) : (
            <div className="sd-row" style={{ gap: 8, padding: "11px 14px", background: "var(--bg-2)", borderRadius: 12, color: "var(--ink-2)", fontSize: 12.5, lineHeight: 1.4 }}>
              <Icon name="info" size={16} style={{ flex: "0 0 auto", marginTop: 1 }} />
              {hh ? t("adminManages", { name: adminName(g) }) : t("teacherRuns", { name: adminName(g) })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

// ── Desktop ──────────────────────────────────────────────────────────────────

function DesktopGroup({ g }: { g: GroupDetailDTO }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const hh = isHousehold(g);
  return (
    <DesktopShell
      active="groups"
      title={t("navGroups")}
      breadcrumb={
        <div className="sd-row" style={{ gap: 6, color: "var(--ink-3)", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
          <button onClick={() => navigate("/groups")} style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", font: "inherit" }}>{t("navGroups")}</button>
          <Icon name="chevright" size={14} />
          <span style={{ color: "var(--ink)" }}>{g.name}</span>
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: g.contacts.length ? "1fr 320px" : "1fr", gap: 22, alignItems: "start" }}>
        <div className="sd-card" style={{ overflow: "hidden" }}>
          <div className="sd-row" style={{ gap: 14, padding: "20px 22px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", rowGap: 12 }}>
            <div style={{ width: 54, height: 54, borderRadius: 14, background: hh ? "var(--blue-tint)" : "var(--orange-tint)", color: hh ? "var(--blue)" : "var(--orange-700)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
              <Icon name={hh ? "home" : "school"} size={27} stroke={1.9} />
            </div>
            <div style={{ flex: "1 1 180px", minWidth: 0 }}>
              <div className="sd-h2" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</div>
              <div className="sd-meta" style={{ marginTop: 2 }}>{g.memberCount} {t("members").toLowerCase()}</div>
            </div>
            {g.viewerIsAdmin ? (
              <Tag tone={hh ? "blue" : "orange"} icon="shield">{hh ? t("youreAdmin") : t("teachThisClass")}</Tag>
            ) : (
              <Tag tone="line"><Icon name="eye" size={12} stroke={2} />{hh ? t("viewOnly") : t("classMember")}</Tag>
            )}
            {g.viewerIsAdmin && (
              <button className="sd-btn sd-btn-secondary sd-btn-sm"><Icon name="plus" size={15} />{t("addMember")}</button>
            )}
          </div>
          <div style={{ padding: "6px 22px 14px" }}>
            <div className="sd-eyebrow" style={{ padding: "14px 0 4px" }}>{hh ? t("members") : t("roster")}</div>
            {g.members.map((m) => (
              <MemberRow
                key={m.personId}
                name={m.displayName}
                title={m.title ?? undefined}
                tags={<MemberTags m={m} />}
                onClick={() => navigate(`/persons/${m.personId}`)}
                trailing={
                  g.viewerIsAdmin ? (
                    <div className="sd-row" style={{ gap: 8 }}>
                      <button className="sd-btn sd-btn-ghost sd-btn-sm">{t("setTitle")}</button>
                      <button aria-label="More" style={{ width: 30, height: 30, borderRadius: 8, border: 0, background: "transparent", color: "var(--ink-3)", cursor: "pointer" }}><Icon name="dot3" size={18} /></button>
                    </div>
                  ) : (
                    <Icon name="chevright" size={17} style={{ color: "var(--ink-3)" }} />
                  )
                }
              />
            ))}
          </div>
        </div>

        {g.contacts.length > 0 && (
          <div className="sd-card sd-card-pad">
            <div className="sd-eyebrow" style={{ marginBottom: 4 }}>{hh ? t("householdContact") : t("contact")}</div>
            {hh && <p className="sd-meta" style={{ marginBottom: 12 }}>{t("cascadeNote")}</p>}
            {g.contacts.map((c) => (
              <ContactRow
                key={c.id}
                icon={TYPE_ICON[c.type] ?? "info"}
                label={c.label || c.type}
                value={c.type === "address" && !c.value ? t("exactHidden") : c.value}
                vis={<Vis state={visState(c)} count={c.shareCount} withCaret={g.viewerIsAdmin} membersText={t("visMembers")} privateText={t("visPrivate")} sharedText={t("visShared")} />}
              />
            ))}
            {g.viewerIsAdmin && <Btn block kind="secondary" icon="pencil" sm style={{ marginTop: 14 }}>{t("editGroupInfo")}</Btn>}
          </div>
        )}
      </div>
    </DesktopShell>
  );
}

function adminName(g: GroupDetailDTO): string {
  const admin = g.members.find((m) => m.isAdmin);
  return admin?.displayName ?? "An admin";
}

function Note({ text }: { text: string }) {
  const navigate = useNavigate();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 40, textAlign: "center" }}>
      <Icon name="info" size={32} style={{ color: "var(--ink-3)" }} />
      <p className="sd-lead">{text}</p>
      <Btn kind="secondary" icon="arrowleft" onClick={() => navigate("/")}>Home</Btn>
    </div>
  );
}

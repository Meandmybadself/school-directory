// Group detail (Household / Classroom) — mobile + desktop layouts.
// Desktop Household mirrors design_handoff/screens-desktop.jsx (wide member card
// + 320px household-contact rail).
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ContactItemDTO, GroupDetailDTO } from "@sd/shared";
import { Icon, type IconName } from "../components/Icon.js";
import { Avatar, Btn, Tag, type VisState } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel, ContactRow, ContactValue, ContactVis, MemberRow, GroupTile } from "../components/parts.js";
import { useI18n } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { useSession } from "../lib/session.js";
import { api, ApiError, mediaUrl } from "../lib/api.js";
import { AddMemberSheet, MemberSheet, EditContactsSheet, CreateGroupSheet, SetParentSheet } from "../components/GroupSheets.js";
import type { GroupMemberDTO, GroupSummaryDTO } from "@sd/shared";

const TYPE_ICON: Record<string, IconName> = { address: "pin", phone: "phone", email: "mail", url: "link" };

function visState(c: ContactItemDTO): VisState {
  if (c.visibility === "service") return "members";
  if ((c.shareCount ?? 0) > 0) return "shared";
  return "private";
}

export interface GroupActions {
  onAddMember: () => void;
  onMember: (m: GroupMemberDTO) => void;
  onEditContacts: () => void;
  /** Present only when the viewer may edit the hierarchy (system admin). */
  onSetParent?: () => void;
}

type Sheet =
  | { type: "addMember" }
  | { type: "member"; member: GroupMemberDTO }
  | { type: "editContacts" }
  | { type: "setParent" }
  | null;

export function GroupDetail() {
  const { id } = useParams();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const { me } = useSession();
  const [g, setG] = useState<GroupDetailDTO | null>(null);
  const [error, setError] = useState<"forbidden" | "not_found" | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);

  const reload = () => {
    if (!id) return;
    void api
      .group(id)
      .then(setG)
      .catch((e) => setError(e instanceof ApiError && e.status === 403 ? "forbidden" : "not_found"));
  };
  useEffect(reload, [id]);

  if (error) {
    const msg = error === "forbidden" ? "You're not a member of this group." : "Group not found.";
    return isDesktop ? (
      <DesktopShell active="groups" title="Groups"><Note text={msg} /></DesktopShell>
    ) : (
      <AppShell bottomNav={<BottomNav active="groups" />}><ScreenHeader title="" onLeft={() => navigate("/groups")} /><Note text={msg} /></AppShell>
    );
  }
  if (!g) return null;

  // Hierarchy editing is a school-structure concern: system admins only, and
  // households never nest.
  const canEditHierarchy = !!me?.user.isSystemAdmin && g.kind !== "household";
  const actions: GroupActions = {
    onAddMember: () => setSheet({ type: "addMember" }),
    onMember: (member) => setSheet({ type: "member", member }),
    onEditContacts: () => setSheet({ type: "editContacts" }),
    onSetParent: canEditHierarchy ? () => setSheet({ type: "setParent" }) : undefined,
  };
  const onChanged = () => reload();

  return (
    <>
      {isDesktop ? <DesktopGroup g={g} actions={actions} /> : <MobileGroup g={g} actions={actions} />}
      {/* Sheets render outside the screen's shell, so scope them to .sd for tokens. */}
      <div className="sd">
        {sheet?.type === "addMember" && <AddMemberSheet groupId={g.id} onClose={() => setSheet(null)} onChanged={onChanged} />}
        {sheet?.type === "member" && <MemberSheet groupId={g.id} member={sheet.member} onClose={() => setSheet(null)} onChanged={onChanged} />}
        {sheet?.type === "setParent" && <SetParentSheet groupId={g.id} currentParentId={g.parentId ?? null} onClose={() => setSheet(null)} onChanged={onChanged} />}
        {sheet?.type === "editContacts" && (
          <EditContactsSheet
            groupId={g.id}
            initial={g.contacts.map((c) => ({ id: c.id, type: c.type, label: c.label, value: c.value, visibility: c.visibility, neighborDiscoverable: c.neighborDiscoverable }))}
            onClose={() => setSheet(null)}
            onChanged={onChanged}
          />
        )}
      </div>
    </>
  );
}

function isHousehold(g: GroupDetailDTO) {
  return g.kind === "household";
}

function groupKindLabel(kind: GroupSummaryDTO["kind"], t: ReturnType<typeof useI18n>["t"]): string {
  if (kind === "household") return t("household");
  if (kind === "classroom") return t("classroom");
  return t("genericGroup");
}

/** Per-kind icon + accent colors so households, classrooms, and generic groups
 *  (School / Grades / clubs) each read distinctly. */
function kindAccent(kind: GroupSummaryDTO["kind"]): {
  icon: IconName;
  color: string;
  tint: string;
  tagTone: "blue" | "orange" | "line";
} {
  if (kind === "classroom") return { icon: "school", color: "var(--orange-700)", tint: "var(--orange-tint)", tagTone: "orange" };
  if (kind === "generic") return { icon: "users3", color: "var(--ink-2)", tint: "var(--slate-tint)", tagTone: "line" };
  return { icon: "home", color: "var(--blue)", tint: "var(--blue-tint)", tagTone: "blue" };
}

/** Breadcrumb of ancestor groups (root → … → parent), each a link. */
function Breadcrumb({ g }: { g: GroupDetailDTO }) {
  const navigate = useNavigate();
  if (!g.ancestors?.length) return null;
  return (
    <div className="sd-row" style={{ gap: 5, flexWrap: "wrap", fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>
      {g.ancestors.map((a) => (
        <Fragment key={a.id}>
          <button onClick={() => navigate(`/groups/${a.id}`)} style={{ background: "none", border: 0, color: "var(--blue)", cursor: "pointer", font: "inherit", padding: 0 }}>{a.name}</button>
          <Icon name="chevright" size={12} style={{ color: "var(--ink-3)" }} />
        </Fragment>
      ))}
      <span style={{ color: "var(--ink-3)" }}>{g.name}</span>
    </div>
  );
}

/** Immediate sub-groups as navigable tiles. */
function Subgroups({ g }: { g: GroupDetailDTO }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  if (!g.children?.length) return null;
  return (
    <div>
      <SectLabel>{t("subgroups")}</SectLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 9 }}>
        {g.children.map((c) => {
          const a = kindAccent(c.kind);
          return (
            <GroupTile
              key={c.id}
              icon={a.icon}
              name={c.name}
              sub={`${c.memberCount} ${t("members").toLowerCase()}`}
              color={a.color}
              tint={a.tint}
              onClick={() => navigate(`/groups/${c.id}`)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Groups index (the active Person's groups) ────────────────────────────────

const GROUPS_HELP_KEY = "sd.groupsHelpDismissed";

export function GroupsIndex() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { activePerson, me } = useSession();
  const [groups, setGroups] = useState<GroupSummaryDTO[]>([]);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const [allGroups, setAllGroups] = useState<GroupSummaryDTO[]>([]);
  const [helpDismissed, setHelpDismissed] = useState(() => localStorage.getItem(GROUPS_HELP_KEY) === "1");

  const dismissHelp = () => { setHelpDismissed(true); localStorage.setItem(GROUPS_HELP_KEY, "1"); };
  const showHelp = () => { setHelpDismissed(false); localStorage.removeItem(GROUPS_HELP_KEY); };

  useEffect(() => {
    if (!activePerson) return;
    void api.person(activePerson.id).then((p) => setGroups(p.groups)).catch(() => setGroups([]));
  }, [activePerson]);

  // The "All groups" table is driven by the search box (empty query = all).
  useEffect(() => {
    const handle = setTimeout(() => {
      void api.searchGroups(q).then((r) => setAllGroups(r.groups)).catch(() => setAllGroups([]));
    }, q ? 200 : 0);
    return () => clearTimeout(handle);
  }, [q]);

  const isSystemAdmin = !!me?.user.isSystemAdmin;
  // Classrooms: teachers or system admins. Generic groups (School/Grades/clubs):
  // system admins only. Households: anyone.
  const canCreateClassroom = !!activePerson?.capabilities.includes("teacher") || isSystemAdmin;
  const canCreateGeneric = isSystemAdmin;
  const newBtn = (
    <button className="sd-btn sd-btn-secondary sd-btn-sm" onClick={() => setCreating(true)}>
      <Icon name="plus" size={15} />{t("newGroup")}
    </button>
  );
  const createSheet = creating ? (
    <CreateGroupSheet
      canCreateClassroom={canCreateClassroom}
      canCreateGeneric={canCreateGeneric}
      onClose={() => setCreating(false)}
      onCreated={(id) => { setCreating(false); navigate(`/groups/${id}`); }}
    />
  ) : null;

  const tilesOf = (list: GroupSummaryDTO[], emptyMsg: string) => (
    <div style={{ display: isDesktop ? "grid" : "flex", gridTemplateColumns: "1fr 1fr", flexDirection: "column", gap: isDesktop ? 12 : 9 }}>
      {list.map((g) => {
        const a = kindAccent(g.kind);
        return (
          <GroupTile
            key={g.id}
            icon={a.icon}
            name={g.name}
            sub={`${g.memberCount} ${t("members").toLowerCase()}`}
            color={a.color}
            tint={a.tint}
            onClick={() => navigate(`/groups/${g.id}`)}
          />
        );
      })}
      {list.length === 0 && <div className="sd-card sd-card-pad sd-meta">{emptyMsg}</div>}
    </div>
  );

  const searchBar = (
    <div style={{ position: "relative" }}>
      <Icon name="search" size={17} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }} />
      <input
        className="sd-input"
        placeholder={t("searchGroups")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ paddingLeft: 38 }}
      />
    </div>
  );

  const allGroupsTable = (
    <div className="sd-card" style={{ overflow: "hidden" }}>
      <table className="sd-table">
        <thead>
          <tr>
            <th>{t("colName")}</th>
            <th>{t("colType")}</th>
            <th style={{ textAlign: "right" }}>{t("members")}</th>
          </tr>
        </thead>
        <tbody>
          {allGroups.map((g) => {
            const a = kindAccent(g.kind);
            return (
            <tr key={g.id} onClick={() => navigate(`/groups/${g.id}`)}>
              <td>
                <div className="sd-row" style={{ gap: 10, minWidth: 0 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, flex: "0 0 auto", background: a.tint, color: a.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name={a.icon} size={16} />
                  </div>
                  <span style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
                </div>
              </td>
              <td style={{ color: "var(--ink-2)", textTransform: "capitalize", whiteSpace: "nowrap" }}>{groupKindLabel(g.kind, t)}</td>
              <td style={{ textAlign: "right", color: "var(--ink-2)", whiteSpace: "nowrap" }}>{g.memberCount}</td>
            </tr>
            );
          })}
          {allGroups.length === 0 && (
            <tr><td colSpan={3} className="sd-meta" style={{ cursor: "default" }}>{t("groupsEmpty")}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const content = (
    <>
      {helpDismissed ? (
        <button className="sd-btn sd-btn-ghost sd-btn-sm" style={{ alignSelf: "flex-start", padding: "0 4px", height: 26 }} onClick={showHelp}>
          <Icon name="info" size={15} />{t("whatAreGroups")}
        </button>
      ) : (
        <div className="sd-card sd-card-pad" style={{ background: "var(--blue-tint)", borderColor: "var(--blue-tint-2)" }}>
          <div className="sd-row" style={{ gap: 11, alignItems: "flex-start" }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--paper)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
              <Icon name="users3" size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--blue-800)" }}>{t("aboutGroupsTitle")}</div>
              <div style={{ fontSize: 13, color: "var(--blue-800)", lineHeight: 1.5, marginTop: 3 }}>{t("aboutGroupsBody")}</div>
            </div>
            <button onClick={dismissHelp} aria-label="Dismiss" style={{ flex: "0 0 auto", background: "none", border: 0, color: "var(--blue-800)", cursor: "pointer", padding: 2, opacity: 0.7 }}>
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>
      )}
      {searchBar}
      <div>
        <SectLabel>{t("myGroups")}</SectLabel>
        <div style={{ marginTop: isDesktop ? 11 : 9 }}>{tilesOf(groups, t("noGroupsBody"))}</div>
      </div>
      <div>
        <SectLabel>{t("allGroups")}</SectLabel>
        <div style={{ marginTop: isDesktop ? 11 : 9 }}>{allGroupsTable}</div>
      </div>
    </>
  );

  if (isDesktop) {
    return (
      <DesktopShell active="groups" title={t("navGroups")}>
        <div style={{ maxWidth: 720 }}>
          <div className="sd-row" style={{ justifyContent: "flex-end", marginBottom: 14 }}>{newBtn}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>{content}</div>
        </div>
        {createSheet}
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="groups" />}>
      <ScreenHeader title={t("navGroups")} onLeft={() => navigate("/")} right={newBtn} />
      <div className="sd-scroll"><div className="sd-body" style={{ gap: 16 }}>{content}</div></div>
      {createSheet}
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
          value={<ContactValue type={c.type} value={c.value} t={t} />}
          vis={<ContactVis state={visState(c)} count={c.shareCount} withCaret={g.viewerIsAdmin} t={t} />}
        />
      ))}
    </div>
  );
}

// ── Mobile ─────────────────────────────────────────────────────────────────

function MobileGroup({ g, actions }: { g: GroupDetailDTO; actions: GroupActions }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const hh = isHousehold(g);
  const cls = g.kind === "classroom";
  const a = kindAccent(g.kind);
  return (
    <AppShell bottomNav={<BottomNav active="groups" />}>
      <ScreenHeader
        title={groupKindLabel(g.kind, t)}
        onLeft={() => navigate("/groups")}
        right={g.viewerIsAdmin ? <button className={`sd-btn sd-btn-${cls ? "orange" : "secondary"} sd-btn-sm`} onClick={actions.onAddMember}><Icon name="plus" size={15} />{t("addMember")}</button> : undefined}
      />
      <div className="sd-scroll">
        {/* hero */}
        <div style={{ background: "var(--paper)", borderBottom: "1px solid var(--line)", padding: "16px 18px 18px" }}>
          <Breadcrumb g={g} />
          <div className="sd-row" style={{ gap: 13 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: a.tint, color: a.color, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
              <Icon name={a.icon} size={26} stroke={1.9} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sd-h2">{g.name}</div>
              <div className="sd-meta" style={{ marginTop: 2 }}>{g.memberCount} {t("members").toLowerCase()}</div>
            </div>
          </div>
          <div className="sd-row" style={{ gap: 6, marginTop: 12 }}>
            {g.viewerIsAdmin ? (
              <Tag tone={a.tagTone} icon="shield">{cls ? t("teachThisClass") : t("youreAdmin")}</Tag>
            ) : (
              <Tag tone="line"><Icon name="eye" size={12} stroke={2} />{cls ? t("classMember") : t("viewOnly")}</Tag>
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
            <SectLabel action={g.viewerIsAdmin ? <button className="sd-btn sd-btn-ghost sd-btn-sm" style={{ height: 24, padding: "0 4px" }} onClick={actions.onAddMember}><Icon name="plus" size={15} />{t("addMember")}</button> : undefined}>
              {cls ? t("roster") : t("members")}
            </SectLabel>
            <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4 }}>
              {g.members.map((m) => (
                <MemberRow
                  key={m.personId}
                  name={m.displayName}
                  img={mediaUrl(m.photoUrl)}
                  title={m.title ?? undefined}
                  tags={<MemberTags m={m} />}
                  onClick={() => navigate(`/persons/${m.personId}`)}
                  trailing={
                    g.viewerIsAdmin ? (
                      <button aria-label={t("setTitle")} onClick={(e) => { e.stopPropagation(); actions.onMember(m); }} style={{ width: 30, height: 30, borderRadius: 8, border: 0, background: "transparent", color: "var(--ink-3)", cursor: "pointer" }}><Icon name="dot3" size={18} /></button>
                    ) : (
                      <Icon name="chevright" size={17} style={{ color: "var(--ink-3)" }} />
                    )
                  }
                />
              ))}
            </div>
          </div>

          <Subgroups g={g} />

          {actions.onSetParent && (
            <Btn block kind="secondary" icon="users3" onClick={actions.onSetParent}>{t("setParentGroup")}</Btn>
          )}

          {g.viewerIsAdmin ? (
            hh ? (
              <Btn block kind="secondary" icon="pencil" onClick={actions.onEditContacts}>{t("editGroupInfo")}</Btn>
            ) : (
              <div className="sd-row" style={{ gap: 9 }}>
                <Btn block kind="secondary" icon="users3" style={{ flex: 1 }} onClick={actions.onAddMember}>{t("manageMembers")}</Btn>
                <Btn block kind="secondary" icon="bolt" style={{ flex: 1 }} disabled>{t("messageAll")}</Btn>
              </div>
            )
          ) : (
            <div className="sd-row" style={{ gap: 8, padding: "11px 14px", background: "var(--bg-2)", borderRadius: 12, color: "var(--ink-2)", fontSize: 12.5, lineHeight: 1.4 }}>
              <Icon name="info" size={16} style={{ flex: "0 0 auto", marginTop: 1 }} />
              {hh ? t("adminManages", { name: adminName(g) }) : cls ? t("teacherRuns", { name: adminName(g) }) : t("genericManages", { name: adminName(g) })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

// ── Desktop ──────────────────────────────────────────────────────────────────

function DesktopGroup({ g, actions }: { g: GroupDetailDTO; actions: GroupActions }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const hh = isHousehold(g);
  const cls = g.kind === "classroom";
  const a = kindAccent(g.kind);
  const showRail = g.contacts.length > 0 || (hh && g.viewerIsAdmin);
  return (
    <DesktopShell
      active="groups"
      title={t("navGroups")}
      breadcrumb={
        <div className="sd-row" style={{ gap: 6, color: "var(--ink-3)", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", flexWrap: "wrap" }}>
          <button onClick={() => navigate("/groups")} style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", font: "inherit" }}>{t("navGroups")}</button>
          {(g.ancestors ?? []).map((anc) => (
            <Fragment key={anc.id}>
              <Icon name="chevright" size={14} />
              <button onClick={() => navigate(`/groups/${anc.id}`)} style={{ background: "none", border: 0, color: "var(--blue)", cursor: "pointer", font: "inherit" }}>{anc.name}</button>
            </Fragment>
          ))}
          <Icon name="chevright" size={14} />
          <span style={{ color: "var(--ink)" }}>{g.name}</span>
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: showRail ? "1fr 320px" : "1fr", gap: 22, alignItems: "start" }}>
        <div className="sd-card" style={{ overflow: "hidden" }}>
          <div className="sd-row" style={{ gap: 14, padding: "20px 22px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", rowGap: 12 }}>
            <div style={{ width: 54, height: 54, borderRadius: 14, background: a.tint, color: a.color, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
              <Icon name={a.icon} size={27} stroke={1.9} />
            </div>
            <div style={{ flex: "1 1 180px", minWidth: 0 }}>
              <div className="sd-h2" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</div>
              <div className="sd-meta" style={{ marginTop: 2 }}>{g.memberCount} {t("members").toLowerCase()}</div>
            </div>
            {g.viewerIsAdmin ? (
              <Tag tone={a.tagTone} icon="shield">{cls ? t("teachThisClass") : t("youreAdmin")}</Tag>
            ) : (
              <Tag tone="line"><Icon name="eye" size={12} stroke={2} />{cls ? t("classMember") : t("viewOnly")}</Tag>
            )}
            {g.viewerIsAdmin && (
              <button className="sd-btn sd-btn-secondary sd-btn-sm" onClick={actions.onAddMember}><Icon name="plus" size={15} />{t("addMember")}</button>
            )}
            {actions.onSetParent && (
              <button className="sd-btn sd-btn-secondary sd-btn-sm" onClick={actions.onSetParent}><Icon name="users3" size={15} />{t("setParentGroup")}</button>
            )}
          </div>
          <div style={{ padding: "6px 22px 14px" }}>
            <div className="sd-eyebrow" style={{ padding: "14px 0 4px" }}>{cls ? t("roster") : t("members")}</div>
            {g.members.map((m) => (
              <MemberRow
                key={m.personId}
                name={m.displayName}
                img={mediaUrl(m.photoUrl)}
                title={m.title ?? undefined}
                tags={<MemberTags m={m} />}
                onClick={() => navigate(`/persons/${m.personId}`)}
                trailing={
                  g.viewerIsAdmin ? (
                    <div className="sd-row" style={{ gap: 8 }}>
                      <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={(e) => { e.stopPropagation(); actions.onMember(m); }}>{t("setTitle")}</button>
                      <button aria-label={t("manage")} onClick={(e) => { e.stopPropagation(); actions.onMember(m); }} style={{ width: 30, height: 30, borderRadius: 8, border: 0, background: "transparent", color: "var(--ink-3)", cursor: "pointer" }}><Icon name="dot3" size={18} /></button>
                    </div>
                  ) : (
                    <Icon name="chevright" size={17} style={{ color: "var(--ink-3)" }} />
                  )
                }
              />
            ))}
          </div>
          {!!g.children?.length && (
            <div style={{ padding: "10px 22px 18px", borderTop: "1px solid var(--line)" }}>
              <Subgroups g={g} />
            </div>
          )}
        </div>

        {showRail && (
          <div className="sd-card sd-card-pad">
            <div className="sd-eyebrow" style={{ marginBottom: 4 }}>{hh ? t("householdContact") : t("contact")}</div>
            {hh && <p className="sd-meta" style={{ marginBottom: 12 }}>{t("cascadeNote")}</p>}
            {g.contacts.map((c) => (
              <ContactRow
                key={c.id}
                icon={TYPE_ICON[c.type] ?? "info"}
                label={c.label || c.type}
                value={<ContactValue type={c.type} value={c.value} t={t} />}
                vis={<ContactVis state={visState(c)} count={c.shareCount} withCaret={g.viewerIsAdmin} t={t} />}
              />
            ))}
            {g.contacts.length === 0 && <div className="sd-meta" style={{ padding: "4px 0 8px" }}>No shared contact info yet.</div>}
            {g.viewerIsAdmin && hh && <Btn block kind="secondary" icon="pencil" sm style={{ marginTop: 14 }} onClick={actions.onEditContacts}>{t("editGroupInfo")}</Btn>}
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

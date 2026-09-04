// Admin sheets for group management: add member, edit a member (title / admin /
// remove), and edit household-owned contact info.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ClassroomCandidateDTO, ContactType, GroupDetailDTO, GroupKind, GroupMemberDTO, GroupRefDTO, ShareTargetDTO, Visibility } from "@sd/shared";
import { Icon, type IconName } from "./Icon.js";
import { Avatar, Btn } from "./atoms.js";
import { SheetOver, OptionRow, ContactVis } from "./parts.js";
import { useI18n } from "../i18n/index.js";
import { api, ApiError, mediaUrl } from "../lib/api.js";
import { CONTACT_TYPE_ORDER, contactTypeName } from "../lib/contactTypes.js";

const TYPE_ICON: Record<ContactType, IconName> = { address: "pin", phone: "phone", email: "mail", url: "link" };

/** Classroom self-service: place (or remove) one of the viewer's OWN children.
 *
 *  Deliberately a separate sheet from `AddMemberSheet` rather than a mode of it.
 *  That one searches every Person in the school behind `requireGroupAdmin`; this
 *  one lists only your own children and needs no search at all, because the list
 *  is two or three rows long. Folding them together would have meant one sheet
 *  whose contents, gate and search behaviour all forked on who you are — and the
 *  server keeps them apart for the same reason (authority over a roster vs.
 *  authority over a person), so the UI matches the seam instead of blurring it.
 *
 *  Every eligibility rule is read off `viewerEnrollable`, never re-derived: the
 *  server decides who may be placed, and a client that guessed would eventually
 *  offer a button the API refuses. */
export function MyChildrenSheet({
  groupId,
  candidates,
  onClose,
  onChanged,
}: {
  groupId: string;
  candidates: ClassroomCandidateDTO[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const act = async (cand: ClassroomCandidateDTO) => {
    setBusy(cand.personId);
    setFailed(null);
    try {
      if (cand.isHere) await api.clearClassroom(cand.personId, groupId);
      else await api.setClassroom(cand.personId, groupId);
      onChanged();
    } catch {
      // The refusals this can hit are all server-side rules the list already
      // mirrors (a Person who runs a room, a capability revoked in another tab),
      // so there is nothing specific to say — surface that it didn't take and
      // let the reload show the truth.
      setFailed(cand.personId);
    } finally {
      setBusy(null);
    }
  };

  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 4 }}>{t("myChildren")}</h2>
      <div className="sd-meta" style={{ marginBottom: 12 }}>{t("classPlacementNote")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 340, overflowY: "auto" }}>
        {candidates.map((cand) => (
          <button
            key={cand.personId}
            type="button"
            className="sd-row"
            disabled={busy === cand.personId}
            onClick={() => void act(cand)}
            style={{ gap: 11, padding: "9px 8px", borderRadius: 10, border: 0, background: "transparent", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer" }}
          >
            <Avatar name={cand.displayName} size={34} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14.5, fontWeight: 600 }}>{cand.displayName}</span>
              <span className="sd-meta" style={{ display: "block" }}>
                {failed === cand.personId
                  ? t("classPlacementFailed")
                  : cand.isHere
                    ? t("inThisClass")
                    : cand.currentClassrooms.length > 0
                      // EVERY room they leave, not the first: the placement moves
                      // them out of all of them, and a message naming one while
                      // deleting two is the exact surprise this copy exists to
                      // prevent.
                      ? t("movesFrom", { name: cand.currentClassrooms.map((r) => r.name).join(", ") })
                      : t("notInAClass")}
              </span>
            </span>
            <Icon
              name={cand.isHere ? "minus" : "plus"}
              size={18}
              style={{ color: "var(--ink-3)", flex: "0 0 auto" }}
            />
          </button>
        ))}
        {candidates.length === 0 && (
          <div className="sd-meta" style={{ padding: "12px 0" }}>{t("noStudentsToPlace")}</div>
        )}
      </div>
      <Btn block kind="secondary" style={{ marginTop: 12 }} onClick={onClose}>{t("done")}</Btn>
    </SheetOver>
  );
}

export function AddMemberSheet({ groupId, onClose, onChanged }: { groupId: string; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [targets, setTargets] = useState<ShareTargetDTO[]>([]);
  const [adding, setAdding] = useState<string | null>(null);

  const load = () => {
    void api.groupCandidates(groupId, q).then((r) => setTargets(r.targets)).catch(() => setTargets([]));
  };
  useEffect(() => {
    const id = setTimeout(load, 200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, groupId]);

  const add = async (tg: ShareTargetDTO) => {
    setAdding(tg.id);
    try {
      await api.addGroupMember(groupId, { personId: tg.id });
      onChanged();
      load();
    } finally {
      setAdding(null);
    }
  };

  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 10 }}>{t("addMember")}</h2>
      <input className="sd-input" placeholder={`${t("navDir")}…`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12, maxHeight: 340, overflowY: "auto" }}>
        {targets.map((tg) => (
          <button
            key={tg.id}
            type="button"
            className="sd-row"
            disabled={adding === tg.id}
            onClick={() => void add(tg)}
            style={{ gap: 11, padding: "9px 8px", borderRadius: 10, border: 0, background: "transparent", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer" }}
          >
            <Avatar name={tg.name} size={34} />
            <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600 }}>{tg.name}</span>
            <Icon name="plus" size={18} style={{ color: "var(--ink-3)" }} />
          </button>
        ))}
        {targets.length === 0 && <div className="sd-meta" style={{ padding: "12px 0" }}>{t("noOneToAdd")}</div>}
      </div>
      <button
        type="button"
        className="sd-btn sd-btn-secondary block"
        style={{ marginTop: 12, borderStyle: "dashed" }}
        onClick={() => {
          onClose();
          navigate("/persons/new");
        }}
      >
        <Icon name="plus" size={17} />{t("addPerson")}
      </button>
      <Btn block kind="secondary" style={{ marginTop: 8 }} onClick={onClose}>{t("done")}</Btn>
    </SheetOver>
  );
}

export function MemberSheet({
  groupId,
  member,
  onClose,
  onChanged,
}: {
  groupId: string;
  member: GroupMemberDTO;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(member.title ?? "");
  const [isAdmin, setIsAdmin] = useState(member.isAdmin);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    try {
      await api.updateGroupMember(groupId, member.personId, { title: title.trim() || null, isAdmin });
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.removeGroupMember(groupId, member.personId);
      onChanged();
      onClose();
    } catch (e) {
      // 409 is the server refusing to drop a group's last admin.
      setError(e instanceof ApiError && e.status === 409 ? t("removeMemberLastAdmin") : t("removeMemberFailed"));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetOver onClose={onClose}>
      <div className="sd-row" style={{ gap: 12, marginBottom: 16 }}>
        <Avatar name={member.displayName} size={44} img={mediaUrl(member.photoUrl)} />
        <div><div className="sd-h2" style={{ fontSize: 18 }}>{member.displayName}</div></div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label className="sd-label" htmlFor="mtitle">{t("setTitle")}</label>
        <input id="mtitle" className="sd-input" value={title} placeholder="e.g. Parent, Teacher, Student" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <button
        type="button"
        className="sd-row"
        onClick={() => setIsAdmin((v) => !v)}
        style={{ gap: 10, marginTop: 14, padding: "11px 12px", background: "var(--bg-2)", borderRadius: 11, width: "100%", border: 0, font: "inherit", cursor: "pointer", textAlign: "left" }}
      >
        <Icon name="shield" size={17} style={{ color: "var(--ink-2)", flex: "0 0 auto" }} />
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{t("groupAdminRole")}</span>
        <span className={`sd-toggle${isAdmin ? " on" : ""}`} />
      </button>
      <Btn block style={{ marginTop: 16 }} onClick={() => void save()} disabled={busy}>{t("save")}</Btn>

      {/* Removal is a two-step, like deleting a group: the button arms a
          confirmation that says what leaving the group does and doesn't do. */}
      <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        {confirming ? (
          <>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>{t("removeMemberConfirm", { name: member.displayName })}</div>
            <div className="sd-meta" style={{ marginTop: 4, lineHeight: 1.45 }}>{t("removeMemberKeepsPerson")}</div>
            <div className="sd-row" style={{ gap: 9, marginTop: 12 }}>
              <Btn block kind="secondary" style={{ flex: 1 }} onClick={() => setConfirming(false)} disabled={busy}>
                {t("cancel")}
              </Btn>
              <button
                className="sd-btn block"
                style={{ flex: 1, background: "var(--warn)", color: "var(--on-brand)", borderColor: "var(--warn)" }}
                onClick={() => void remove()}
                disabled={busy}
              >
                {t("confirmRemove")}
              </button>
            </div>
          </>
        ) : (
          <button
            className="sd-btn sd-btn-ghost block"
            style={{ color: "var(--warn)" }}
            onClick={() => { setError(null); setConfirming(true); }}
            disabled={busy}
          >
            <Icon name="x" size={17} />{t("removeFromGroup")}
          </button>
        )}
      </div>
      {error && <div className="sd-meta" style={{ color: "var(--warn)", textAlign: "center", marginTop: 6 }}>{error}</div>}
    </SheetOver>
  );
}

// ── Create a group (household / classroom) ───────────────────────────────────

export function CreateGroupSheet({
  canCreateClassroom,
  canCreateGeneric,
  parentId,
  onClose,
  onCreated,
}: {
  canCreateClassroom: boolean;
  canCreateGeneric: boolean;
  /** When set, the new group is created as a sub-group of this group. Households
   *  are allowed here — they can sit under a group, they just can't hold one. */
  parentId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const isSub = !!parentId;
  const [kind, setKind] = useState<"household" | "classroom" | "generic">(isSub ? "generic" : "household");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // A chooser is only needed when more than one option is on offer.
  const canHousehold = true;
  const choose = [canHousehold, canCreateClassroom, canCreateGeneric].filter(Boolean).length > 1;

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { id } = await api.createGroup({ kind, name: name.trim(), ...(parentId ? { parentId } : {}) });
      onCreated(id);
    } finally {
      setBusy(false);
    }
  };

  const placeholder =
    kind === "classroom" ? "Ms. Ruiz · Grade 4" : kind === "generic" ? "Grade 4 · Chess Club · Eisenhower" : "Ruiz–Lee household";
  const heading = isSub ? t("createSubgroup") : choose ? t("createGroupChoose") : t("newHousehold");

  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: choose ? 14 : 10 }}>{heading}</h2>
      {choose && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 16 }}>
          {canHousehold && (
            <OptionRow icon="home" tone="members" title={t("household")} selected={kind === "household"} onClick={() => setKind("household")} />
          )}
          {canCreateClassroom && (
            <OptionRow icon="school" tone="shared" title={t("classroom")} selected={kind === "classroom"} onClick={() => setKind("classroom")} />
          )}
          {canCreateGeneric && (
            <OptionRow icon="users3" tone="private" title={t("genericGroup")} sub={t("genericGroupSub")} selected={kind === "generic"} onClick={() => setKind("generic")} />
          )}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label className="sd-label" htmlFor="gname">{t("groupName")}</label>
        <input
          id="gname"
          className="sd-input"
          value={name}
          autoFocus
          placeholder={placeholder}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Btn block icon="plus" style={{ marginTop: 16 }} onClick={() => void create()} disabled={busy || !name.trim()}>{t("create")}</Btn>
    </SheetOver>
  );
}

// ── Edit / delete a group ────────────────────────────────────────────────────

/** Rename a group, change its type, move it in the hierarchy, and — when the
 *  viewer is allowed — delete it. Delete is a two-step: the button arms a
 *  confirmation that spells out what goes away.
 *
 *  Re-parenting opens an inline picker rather than a second stacked sheet, so
 *  "where does this group live" stays part of editing it. */
export function EditGroupSheet({
  group,
  canReparent,
  canCreateClassroom,
  canCreateGeneric,
  onClose,
  onChanged,
  onDeleted,
}: {
  group: GroupDetailDTO;
  /** Hierarchy edits are a school-structure concern: system admins only. Applies
   *  to households too — they can be moved under a group (the candidate list
   *  never offers a household, since one can't be a parent). */
  canReparent: boolean;
  /** Which types this viewer may switch the group TO — the same authority that
   *  gates creating one. Authority over the type it already IS is `viewerCanDelete`,
   *  which is what the server checks on the other side. */
  canCreateClassroom: boolean;
  canCreateGeneric: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<"main" | "parent">("main");
  const [name, setName] = useState(group.name);
  const [kind, setKind] = useState<GroupKind>(group.kind);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A household never holds a sub-group, so that switch is off the table until
  // the children are moved out. The current type always stays selectable.
  const hasChildren = (group.children?.length ?? 0) > 0;
  const allKinds: { kind: GroupKind; icon: IconName; tone: "members" | "shared" | "private"; title: string; sub?: string; offered: boolean }[] = [
    { kind: "household", icon: "home", tone: "members", title: t("household"), offered: !hasChildren },
    { kind: "classroom", icon: "school", tone: "shared", title: t("classroom"), offered: canCreateClassroom },
    { kind: "generic", icon: "users3", tone: "private", title: t("genericGroup"), sub: t("genericGroupSub"), offered: canCreateGeneric },
  ];
  const kindOptions = allKinds.filter((o) => o.offered || o.kind === group.kind);
  const canRetype = !!group.viewerCanDelete && kindOptions.length > 1;

  // ancestors run root → … → immediate parent, so the last one is the parent.
  const parent = group.ancestors?.length ? group.ancestors[group.ancestors.length - 1] : null;

  const reparent = async (parentId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.setGroupParent(group.id, parentId);
      onChanged();
      setView("main");
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409 ? t("reparentRejected") : t("reparentFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const next = name.trim();
    const patch: { name?: string; kind?: GroupKind } = {};
    if (next && next !== group.name) patch.name = next;
    if (kind !== group.kind) patch.kind = kind;
    if (!patch.name && !patch.kind) return onClose();
    setBusy(true);
    setError(null);
    try {
      await api.updateGroup(group.id, patch);
      onChanged();
      onClose();
    } catch (e) {
      if (patch.kind) {
        setError(e instanceof ApiError && e.status === 409 ? t("changeTypeHasChildren") : t("changeTypeFailed"));
      } else {
        setError(t("renameGroupFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteGroup(group.id);
      onDeleted();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409
          ? t("deleteGroupHasChildren")
          : t("deleteGroupFailed"),
      );
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  if (view === "parent") {
    return (
      <SheetOver onClose={onClose}>
        <h2 className="sd-h2" style={{ marginBottom: 10 }}>{t("setParentGroup")}</h2>
        <ParentPicker
          groupId={group.id}
          currentParentId={group.parentId ?? null}
          busy={busy}
          onPick={(id) => void reparent(id)}
        />
        {error && <div className="sd-meta" style={{ color: "var(--warn)", textAlign: "center", marginTop: 10 }}>{error}</div>}
        <Btn block kind="secondary" style={{ marginTop: 14 }} onClick={() => { setError(null); setView("main"); }} disabled={busy}>
          {t("cancel")}
        </Btn>
      </SheetOver>
    );
  }

  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 12 }}>{t("editGroup")}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label className="sd-label" htmlFor="egname">{t("groupName")}</label>
        <input
          id="egname"
          className="sd-input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {canRetype && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 14 }}>
          <span className="sd-label">{t("groupType")}</span>
          {kindOptions.map((o) => (
            <OptionRow
              key={o.kind}
              icon={o.icon}
              tone={o.tone}
              title={o.title}
              sub={o.sub}
              selected={kind === o.kind}
              onClick={() => setKind(o.kind)}
            />
          ))}
          {kind !== group.kind && (
            <div className="sd-meta" style={{ lineHeight: 1.45 }}>{t("groupTypeChangeNote")}</div>
          )}
        </div>
      )}

      {canReparent && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
          <span className="sd-label">{t("parentGroup")}</span>
          <button
            type="button"
            className="sd-row"
            onClick={() => { setError(null); setView("parent"); }}
            disabled={busy}
            style={{ gap: 10, padding: "10px 12px", background: "var(--bg-2)", borderRadius: 11, width: "100%", border: 0, font: "inherit", cursor: "pointer", textAlign: "left" }}
          >
            <Icon name="users3" size={17} style={{ color: "var(--ink-2)", flex: "0 0 auto" }} />
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: parent ? undefined : "var(--ink-3)" }}>
              {parent ? parent.name : t("parentNone")}
            </span>
            <Icon name="chevright" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
          </button>
        </div>
      )}

      <Btn block icon="check" style={{ marginTop: 16 }} onClick={() => void save()} disabled={busy || !name.trim()}>
        {t("save")}
      </Btn>

      {group.viewerCanDelete && (
        <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          {confirming ? (
            <>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>{t("deleteGroupConfirm", { name: group.name })}</div>
              <div className="sd-meta" style={{ marginTop: 4, lineHeight: 1.45 }}>
                {t("deleteGroupKeepsPeople", { count: String(group.memberCount) })} {t("deleteGroupWarn")}
              </div>
              <div className="sd-row" style={{ gap: 9, marginTop: 12 }}>
                <Btn block kind="secondary" style={{ flex: 1 }} onClick={() => setConfirming(false)} disabled={busy}>
                  {t("cancel")}
                </Btn>
                <button
                  className="sd-btn block"
                  style={{ flex: 1, background: "var(--warn)", color: "var(--on-brand)", borderColor: "var(--warn)" }}
                  onClick={() => void remove()}
                  disabled={busy}
                >
                  {t("confirmDelete")}
                </button>
              </div>
            </>
          ) : (
            <button
              className="sd-btn sd-btn-ghost block"
              style={{ color: "var(--warn)" }}
              onClick={() => { setError(null); setConfirming(true); }}
              disabled={busy}
            >
              <Icon name="x" size={17} />{t("deleteGroup")}
            </button>
          )}
        </div>
      )}
      {error && <div className="sd-meta" style={{ color: "var(--warn)", textAlign: "center", marginTop: 10 }}>{error}</div>}
    </SheetOver>
  );
}

// ── Parent picker (used inside EditGroupSheet) ───────────────────────────────

/** Candidate list for "where should this group live". The server excludes the
 *  group itself and its own descendants, so the list can't offer a cycle. */
function ParentPicker({
  groupId,
  currentParentId,
  busy,
  onPick,
}: {
  groupId: string;
  currentParentId: string | null;
  busy: boolean;
  onPick: (parentId: string | null) => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<GroupRefDTO[]>([]);

  useEffect(() => {
    const id = setTimeout(() => {
      void api.groupParentCandidates(groupId, q).then((r) => setCandidates(r.candidates)).catch(() => setCandidates([]));
    }, 200);
    return () => clearTimeout(id);
  }, [q, groupId]);

  const rowStyle = { gap: 11, padding: "10px 8px", borderRadius: 10, border: 0, background: "transparent", width: "100%", textAlign: "left" as const, font: "inherit", cursor: "pointer" };
  const iconStyle = { width: 34, height: 34, borderRadius: 9, background: "var(--slate-tint)", color: "var(--ink-2)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" };

  return (
    <>
      <input className="sd-input" placeholder={`${t("navGroups")}…`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12, maxHeight: 340, overflowY: "auto" }}>
        <button type="button" className="sd-row" disabled={busy} onClick={() => onPick(null)} style={rowStyle}>
          <div style={iconStyle}><Icon name="x" size={16} /></div>
          <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600 }}>{t("parentNone")}</span>
          {!currentParentId && <Icon name="check" size={18} style={{ color: "var(--blue)" }} />}
        </button>
        {candidates.map((g) => (
          <button key={g.id} type="button" className="sd-row" disabled={busy} onClick={() => onPick(g.id)} style={rowStyle}>
            <div style={iconStyle}>
              <Icon name={g.kind === "classroom" ? "school" : g.kind === "household" ? "home" : "users3"} size={16} />
            </div>
            <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600 }}>{g.name}</span>
            {g.id === currentParentId && <Icon name="check" size={18} style={{ color: "var(--blue)" }} />}
          </button>
        ))}
        {candidates.length === 0 && <div className="sd-meta" style={{ padding: "12px 0" }}>{t("noEligibleGroups")}</div>}
      </div>
    </>
  );
}

// ── Household contact editor ─────────────────────────────────────────────────

interface EditC {
  id: string;
  type: ContactType;
  label: string | null;
  value: string;
  visibility: Visibility;
  neighborDiscoverable?: boolean;
  _new?: boolean;
  _dirty?: boolean;
}

export function EditContactsSheet({
  groupId,
  initial,
  onClose,
  onChanged,
}: {
  groupId: string;
  initial: { id: string; type: ContactType; label: string | null; value: string; visibility: Visibility; neighborDiscoverable?: boolean }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<EditC[]>(initial.map((c) => ({ ...c })));
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const update = (id: string, patch: Partial<EditC>) =>
    setItems((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch, _dirty: true } : c)));
  const addRow = () =>
    setItems((cs) => [...cs, { id: `tmp_${Math.random().toString(36).slice(2)}`, type: "phone", label: "", value: "", visibility: "service", _new: true, _dirty: true }]);

  const save = async () => {
    setBusy(true);
    try {
      for (const id of removed) await api.deleteGroupContact(groupId, id).catch(() => {});
      for (const c of items) {
        if (!c.value.trim()) continue;
        if (c._new) {
          await api.addGroupContact(groupId, { type: c.type, label: c.label, value: c.value, visibility: c.visibility, neighborDiscoverable: c.neighborDiscoverable });
        } else if (c._dirty) {
          await api.patchGroupContact(groupId, c.id, { label: c.label, value: c.value, visibility: c.visibility, neighborDiscoverable: c.neighborDiscoverable });
        }
      }
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 4 }}>{t("householdContact")}</h2>
      <p className="sd-meta" style={{ marginBottom: 14 }}>{t("cascadeNote")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "55vh", overflowY: "auto" }}>
        {items.map((c) => (
          <div key={c.id} className="sd-fieldcard">
            <div className="fr" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="sd-cicon"><Icon name={TYPE_ICON[c.type]} size={17} /></div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <select value={c.type} onChange={(e) => update(c.id, { type: e.target.value as ContactType })} className="sd-input" style={{ height: 32, fontSize: 13, padding: "0 8px", width: "auto" }}>
                  {CONTACT_TYPE_ORDER.map((tp) => <option key={tp} value={tp}>{contactTypeName(tp, t)}</option>)}
                </select>
                <input className="sd-input" value={c.value} placeholder="Value" onChange={(e) => update(c.id, { value: e.target.value })} style={{ height: 38 }} />
              </div>
              {/* Group contacts toggle Members/Private (no per-grantee shares here). */}
              <ContactVis
                state={c.visibility === "service" ? "members" : "private"}
                onClick={() => update(c.id, { visibility: c.visibility === "service" ? "private" : "service" })}
                t={t}
              />
              <button onClick={() => { if (!c._new) setRemoved((r) => [...r, c.id]); setItems((cs) => cs.filter((x) => x.id !== c.id)); }} aria-label="Remove" style={{ background: "none", border: 0, color: "var(--ink-3)", cursor: "pointer" }}>
                <Icon name="x" size={18} />
              </button>
            </div>
          </div>
        ))}
        <button className="sd-btn sd-btn-secondary block" style={{ borderStyle: "dashed" }} onClick={addRow}>
          <Icon name="plus" size={17} />{t("addContact")}
        </button>
      </div>
      <Btn block style={{ marginTop: 16 }} onClick={() => void save()} disabled={busy}>{t("save")}</Btn>
    </SheetOver>
  );
}

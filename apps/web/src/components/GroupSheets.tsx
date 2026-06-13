// Admin sheets for group management: add member, edit a member (title / admin /
// remove), and edit household-owned contact info.
import { useEffect, useState } from "react";
import type { ContactType, GroupMemberDTO, ShareTargetDTO, Visibility } from "@sd/shared";
import { Icon, type IconName } from "./Icon.js";
import { Avatar, Btn, Vis } from "./atoms.js";
import { SheetOver, OptionRow } from "./parts.js";
import { useI18n } from "../i18n/index.js";
import { api, ApiError, mediaUrl } from "../lib/api.js";

const TYPE_ICON: Record<ContactType, IconName> = { address: "pin", phone: "phone", email: "mail", url: "link" };

export function AddMemberSheet({ groupId, onClose, onChanged }: { groupId: string; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
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
        {targets.length === 0 && <div className="sd-meta" style={{ padding: "12px 0" }}>No one to add.</div>}
      </div>
      <Btn block kind="secondary" style={{ marginTop: 14 }} onClick={onClose}>{t("done")}</Btn>
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
      setError(e instanceof ApiError && e.status === 409 ? "Make someone else an admin first." : "Couldn't remove member.");
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
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>Group admin</span>
        <span className={`sd-toggle${isAdmin ? " on" : ""}`} />
      </button>
      <Btn block style={{ marginTop: 16 }} onClick={() => void save()} disabled={busy}>{t("save")}</Btn>
      <button className="sd-btn sd-btn-ghost block" style={{ marginTop: 4, color: "var(--warn)" }} onClick={() => void remove()} disabled={busy}>
        Remove from group
      </button>
      {error && <div className="sd-meta" style={{ color: "var(--warn)", textAlign: "center", marginTop: 6 }}>{error}</div>}
    </SheetOver>
  );
}

// ── Create a group (household / classroom) ───────────────────────────────────

export function CreateGroupSheet({
  canCreateClassroom,
  onClose,
  onCreated,
}: {
  canCreateClassroom: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<"household" | "classroom">("household");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { id } = await api.createGroup({ kind, name: name.trim() });
      onCreated(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: canCreateClassroom ? 14 : 10 }}>
        {canCreateClassroom ? t("createGroupChoose") : t("newHousehold")}
      </h2>
      {canCreateClassroom && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 16 }}>
          <OptionRow icon="home" tone="members" title={t("household")} selected={kind === "household"} onClick={() => setKind("household")} />
          <OptionRow icon="school" tone="shared" title={t("classroom")} selected={kind === "classroom"} onClick={() => setKind("classroom")} />
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label className="sd-label" htmlFor="gname">{t("groupName")}</label>
        <input
          id="gname"
          className="sd-input"
          value={name}
          autoFocus
          placeholder={kind === "classroom" ? "Ms. Ruiz · Grade 4" : "Ruiz–Lee household"}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Btn block icon="plus" style={{ marginTop: 16 }} onClick={() => void create()} disabled={busy || !name.trim()}>{t("create")}</Btn>
    </SheetOver>
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
  const TYPES: ContactType[] = ["address", "phone", "email", "url"];

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
                  {TYPES.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
                </select>
                <input className="sd-input" value={c.value} placeholder="Value" onChange={(e) => update(c.id, { value: e.target.value })} style={{ height: 38 }} />
              </div>
              {/* Group contacts toggle Members/Private (no per-grantee shares here). */}
              <Vis
                state={c.visibility === "service" ? "members" : "private"}
                membersText={t("visMembers")}
                privateText={t("visPrivate")}
                onClick={() => update(c.id, { visibility: c.visibility === "service" ? "private" : "service" })}
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

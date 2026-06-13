// Profile — view (as a member sees it) and edit (controllers only).
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  ContactItemDTO,
  ContactType,
  LastNameDisplay,
  PersonProfileDTO,
  Visibility,
} from "@sd/shared";
import { Icon, type IconName } from "../components/Icon.js";
import { Avatar, Btn, Tag, Vis, type VisState } from "../components/atoms.js";
import { AppShell } from "../components/AppShell.js";
import { ScreenHeader, SectLabel, ContactRow, Field, SheetOver, OptionRow } from "../components/parts.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { api } from "../lib/api.js";

const ICON_BY_TYPE: Record<ContactType, IconName> = {
  address: "pin",
  phone: "phone",
  email: "mail",
  url: "link",
};

function visState(c: ContactItemDTO): VisState {
  if (c.visibility === "service") return "members";
  if ((c.shareCount ?? 0) > 0) return "shared";
  return "private";
}

// ── View ────────────────────────────────────────────────────────────────────

export function ProfileView() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams();
  const { activePerson } = useSession();
  const [p, setP] = useState<PersonProfileDTO | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    void api.person(id).then(setP).catch(() => setNotFound(true));
  }, [id]);

  if (notFound) return <CenteredNote text="Profile not found." onBack={() => navigate(-1)} />;
  if (!p) return null;

  const isOwn = activePerson?.id === p.id;

  return (
    <AppShell
      banner={
        isOwn ? (
          <div className="sd-row" style={{ background: "var(--ink)", color: "#fff", padding: "8px 14px", gap: 9, fontSize: 12.5 }}>
            <Icon name="eye" size={16} style={{ flex: "0 0 auto" }} />
            <div style={{ flex: 1, lineHeight: 1.25 }}>
              <strong style={{ fontWeight: 700 }}>{t("previewingAsMember")}</strong>
              <div style={{ opacity: 0.7, fontSize: 11.5 }}>{t("whatOthersSee")}</div>
            </div>
            <button onClick={() => navigate("/")} style={{ fontWeight: 700, textDecoration: "underline", background: "none", border: 0, color: "#fff", cursor: "pointer", font: "inherit" }}>
              {t("exitPreview")}
            </button>
          </div>
        ) : undefined
      }
    >
      <ScreenHeader title="" onLeft={() => navigate(-1)} right={p.controlledByViewer ? <button className="sd-btn sd-btn-secondary sd-btn-sm" onClick={() => navigate(`/persons/${p.id}/edit`)}><Icon name="pencil" size={15} />{t("editProfile")}</button> : undefined} />
      <div className="sd-scroll">
        <div style={{ background: "var(--paper)", borderBottom: "1px solid var(--line)", padding: "20px 18px 18px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 11 }}>
          <Avatar name={p.displayName} size={84} img={p.photoUrl} color="var(--blue)" />
          <div>
            <div className="sd-h1" style={{ fontSize: 23 }}>{p.displayName}</div>
            <div className="sd-row" style={{ gap: 6, marginTop: 8, justifyContent: "center" }}>
              {p.capabilities.map((c) => (
                <Tag key={c} tone={c === "teacher" ? "orange" : "blue"} icon={c === "teacher" ? "school" : "users3"}>{capLabel(c, t)}</Tag>
              ))}
            </div>
          </div>
        </div>
        <div className="sd-body" style={{ gap: 12 }}>
          <div>
            <SectLabel>{t("contact")}</SectLabel>
            <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4 }}>
              {p.contacts.length === 0 && <div className="sd-meta" style={{ padding: "12px 0" }}>No shared contact info.</div>}
              {p.contacts.map((c) => (
                <ContactRow
                  key={c.id}
                  icon={ICON_BY_TYPE[c.type]}
                  label={c.label || typeLabel(c.type, t)}
                  value={c.type === "address" && !c.value ? t("exactHidden") : c.value}
                  sub={c.type === "address" && !c.value ? undefined : undefined}
                  vis={<Vis state={visState(c)} count={c.shareCount} withCaret={false} membersText={t("visMembers")} privateText={t("visPrivate")} sharedText={t("visShared")} />}
                />
              ))}
            </div>
          </div>
          {p.groups.length > 0 && (
            <div>
              <SectLabel>{t("groups")}</SectLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 9 }}>
                {p.groups.map((g) => (
                  <div key={g.id} className="sd-card" style={{ padding: 13, display: "flex", alignItems: "center", gap: 11 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: g.kind === "classroom" ? "var(--orange-tint)" : "var(--blue-tint)", color: g.kind === "classroom" ? "var(--orange-700)" : "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name={g.kind === "classroom" ? "school" : "home"} size={20} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700 }}>{g.name}</div>
                      <div className="sd-meta">{g.memberCount} {t("members").toLowerCase()}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!p.controlledByViewer && (
            <Btn block icon="plus" style={{ marginTop: 4 }}>{t("shareCta", { name: p.firstName })}</Btn>
          )}
        </div>
      </div>
    </AppShell>
  );
}

// ── Edit ──────────────────────────────────────────────────────────────────

interface EditContact extends ContactItemDTO {
  _new?: boolean;
  _dirty?: boolean;
}

export function ProfileEdit() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams();
  const { refresh } = useSession();
  const [p, setP] = useState<PersonProfileDTO | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [lnDisplay, setLnDisplay] = useState<LastNameDisplay>("full");
  const [contacts, setContacts] = useState<EditContact[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [visSheetFor, setVisSheetFor] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void api.person(id).then((prof) => {
      setP(prof);
      setFirstName(prof.firstName);
      setLastName(prof.lastName ?? "");
      setLnDisplay(prof.lastNameDisplay ?? "full");
      setContacts(prof.contacts.map((c) => ({ ...c })));
    });
  }, [id]);

  if (!p) return null;
  if (!p.controlledByViewer) {
    return <CenteredNote text="You can't edit this profile." onBack={() => navigate(-1)} />;
  }

  const updateContact = (cid: string, patch: Partial<EditContact>) =>
    setContacts((cs) => cs.map((c) => (c.id === cid ? { ...c, ...patch, _dirty: true } : c)));

  const addContact = () => {
    const tmpId = `tmp_${Math.random().toString(36).slice(2)}`;
    setContacts((cs) => [
      ...cs,
      { id: tmpId, type: "phone", label: "", value: "", visibility: "private", _new: true, _dirty: true },
    ]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.patchPerson(p.id, { firstName, lastName: lastName || null, lastNameDisplay: lnDisplay });
      for (const cid of removed) await api.deleteContact(cid).catch(() => {});
      for (const c of contacts) {
        if (!c.value.trim()) continue;
        if (c._new) {
          await api.addContact(p.id, {
            type: c.type,
            label: c.label,
            value: c.value,
            visibility: c.visibility,
            neighborDiscoverable: c.neighborDiscoverable,
          });
        } else if (c._dirty) {
          await api.patchContact(c.id, {
            label: c.label,
            value: c.value,
            visibility: c.visibility,
            neighborDiscoverable: c.neighborDiscoverable,
          });
        }
      }
      await refresh();
      navigate(`/persons/${p.id}`);
    } finally {
      setSaving(false);
    }
  };

  const sheetContact = contacts.find((c) => c.id === visSheetFor) ?? null;

  return (
    <AppShell>
      <ScreenHeader
        title={t("editProfile")}
        left="x"
        onLeft={() => navigate(-1)}
        right={<button className="sd-btn sd-btn-primary sd-btn-sm" onClick={save} disabled={saving}>{t("save")}</button>}
      />
      <div className="sd-scroll">
        <div className="sd-body" style={{ gap: 18 }}>
          {/* photo (upload wired in M2) */}
          <div className="sd-row" style={{ gap: 14 }}>
            <div style={{ position: "relative" }}>
              <Avatar name={`${firstName} ${lastName}`} size={66} img={p.photoUrl} color="var(--blue)" />
              <div style={{ position: "absolute", right: -2, bottom: -2, width: 26, height: 26, borderRadius: 999, background: "var(--paper)", border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-2)" }}>
                <Icon name="upload" size={14} />
              </div>
            </div>
            <div>
              <div className="sd-label" style={{ fontSize: 13 }}>{t("photo")}</div>
              <button className="sd-btn sd-btn-secondary sd-btn-sm" style={{ marginTop: 7 }} disabled><Icon name="upload" size={15} />{t("addPhoto")}</button>
            </div>
          </div>

          {/* first name — fixed, explained */}
          <Field
            label={t("firstName")}
            vis={<span className="sd-vis vis-members" style={{ cursor: "default" }}><Icon name="members" size={12} stroke={2} />{t("alwaysVisible")}</span>}
            hint={<span className="sd-row" style={{ gap: 7, color: "var(--ink-3)" }}><Icon name="info" size={14} style={{ flex: "0 0 auto", marginTop: 1 }} />{t("firstFixedWhy")}</span>}
          >
            <input className="sd-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>

          {/* last name + segmented control */}
          <div className="sd-fieldcard">
            <div className="fr" style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span className="sd-label">{t("lastName")}</span>
              <input className="sd-input" value={lastName} onChange={(e) => setLastName(e.target.value)} style={{ height: 44 }} />
            </div>
            <div className="fr" style={{ background: "var(--bg)" }}>
              <div className="sd-seg">
                {(["full", "initial", "hidden"] as LastNameDisplay[]).map((k) => (
                  <button key={k} className={k === lnDisplay ? "on" : ""} onClick={() => setLnDisplay(k)}>
                    {k === "full" ? t("lnFull") : k === "initial" ? t("lnInitial") : t("lnHide")}
                  </button>
                ))}
              </div>
              <div className="sd-row" style={{ gap: 7, marginTop: 9, justifyContent: "center", fontSize: 12.5, color: "var(--ink-2)" }}>
                <span style={{ fontWeight: 600 }}>{t("shownAs")}</span>
                <span style={{ fontWeight: 800, color: "var(--ink)" }}>{previewName(firstName, lastName, lnDisplay)}</span>
              </div>
            </div>
          </div>

          {/* contact items */}
          <div>
            <SectLabel>{t("contact")}</SectLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
              {contacts.map((c) => (
                <ContactEditCard
                  key={c.id}
                  c={c}
                  onChange={(patch) => updateContact(c.id, patch)}
                  onRemove={() => {
                    if (!c._new) setRemoved((r) => [...r, c.id]);
                    setContacts((cs) => cs.filter((x) => x.id !== c.id));
                  }}
                  onVis={() => setVisSheetFor(c.id)}
                />
              ))}
              <button className="sd-btn sd-btn-secondary block" style={{ borderStyle: "dashed" }} onClick={addContact}>
                <Icon name="plus" size={17} />{t("addContact")}
              </button>
            </div>
          </div>

          {/* who manages */}
          <div>
            <SectLabel>{t("whoManages")}</SectLabel>
            <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
              <div className="sd-row" style={{ gap: 10 }}>
                <Avatar name={`${firstName} ${lastName}`} size={36} color="var(--blue)" />
                <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700 }}>You</div></div>
                <Tag tone="line">{t("owner")}</Tag>
              </div>
              <button className="sd-btn sd-btn-ghost block" style={{ justifyContent: "flex-start", padding: 0, height: 38, marginTop: 6 }} onClick={() => navigate(`/persons/${p.id}/invite`)}>
                <Icon name="plus" size={17} />{t("inviteCoManager", { name: firstName })}
              </button>
            </div>
          </div>
        </div>
      </div>

      {sheetContact && (
        <VisibilitySheet
          c={sheetContact}
          onClose={() => setVisSheetFor(null)}
          onChange={(visibility) => {
            updateContact(sheetContact.id, { visibility });
            setVisSheetFor(null);
          }}
        />
      )}
    </AppShell>
  );
}

function ContactEditCard({
  c,
  onChange,
  onRemove,
  onVis,
}: {
  c: EditContact;
  onChange: (patch: Partial<EditContact>) => void;
  onRemove: () => void;
  onVis: () => void;
}) {
  const { t } = useI18n();
  const TYPES: ContactType[] = ["phone", "email", "url", "address"];
  return (
    <div className="sd-fieldcard">
      <div className="fr" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div className="sd-cicon"><Icon name={ICON_BY_TYPE[c.type]} size={17} /></div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <select
            value={c.type}
            onChange={(e) => onChange({ type: e.target.value as ContactType })}
            className="sd-input"
            style={{ height: 32, fontSize: 13, padding: "0 8px", width: "auto" }}
          >
            {TYPES.map((tp) => <option key={tp} value={tp}>{typeLabel(tp, t)}</option>)}
          </select>
          <input
            className="sd-input"
            value={c.value}
            placeholder={typeLabel(c.type, t)}
            onChange={(e) => onChange({ value: e.target.value })}
            style={{ height: 38 }}
          />
        </div>
        <Vis
          state={visState(c)}
          count={c.shareCount}
          membersText={t("visMembers")}
          privateText={t("visPrivate")}
          sharedText={t("visShared")}
          onClick={onVis}
        />
        <button onClick={onRemove} aria-label="Remove" style={{ background: "none", border: 0, color: "var(--ink-3)", cursor: "pointer" }}>
          <Icon name="x" size={18} />
        </button>
      </div>
      {c.type === "address" && (
        <div className="fr" style={{ background: "var(--orange-tint)", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <Icon name="pin" size={18} style={{ color: "var(--orange-ink)", flex: "0 0 auto", marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--orange-ink)" }}>{t("showAsNeighbor")}</div>
            <div style={{ fontSize: 11.5, color: "var(--orange-ink)", opacity: 0.85, lineHeight: 1.4, marginTop: 2 }}>{t("neighborWhy")}</div>
          </div>
          <button
            className={`sd-toggle${c.neighborDiscoverable ? " on" : ""}`}
            style={{ marginTop: 1, ...(c.neighborDiscoverable ? { background: "var(--orange-700)" } : {}) }}
            aria-pressed={c.neighborDiscoverable}
            onClick={() => onChange({ neighborDiscoverable: !c.neighborDiscoverable })}
          />
        </div>
      )}
    </div>
  );
}

function VisibilitySheet({
  c,
  onClose,
  onChange,
}: {
  c: ContactItemDTO;
  onClose: () => void;
  onChange: (v: Visibility) => void;
}) {
  const { t } = useI18n();
  const current = visState(c);
  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2">{t("whoCanSee", { field: (c.label || c.type).toLowerCase() })}</h2>
      <p className="sd-meta" style={{ marginBottom: 14, marginTop: 4 }}>Pick who can see this. You can change it anytime.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <OptionRow icon="members" tone="members" title={t("visMembers")} sub={t("visMembersDesc")} selected={current === "members"} onClick={() => onChange("service")} />
        <OptionRow icon="lock" tone="private" title={t("visPrivate")} sub={t("visPrivateDesc")} selected={current === "private"} onClick={() => onChange("private")} />
        <div style={{ opacity: 0.55 }}>
          <OptionRow icon="lock" tone="shared" title={t("visShared")} sub={`${t("visSharedDesc")} — coming soon`} selected={current === "shared"} />
        </div>
      </div>
      <Btn block style={{ marginTop: 16 }} onClick={onClose}>{t("done")}</Btn>
    </SheetOver>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function CenteredNote({ text, onBack }: { text: string; onBack: () => void }) {
  return (
    <AppShell>
      <div className="sd-scroll" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24, textAlign: "center" }}>
        <Icon name="info" size={32} style={{ color: "var(--ink-3)" }} />
        <p className="sd-lead">{text}</p>
        <Btn kind="secondary" icon="arrowleft" onClick={onBack}>Back</Btn>
      </div>
    </AppShell>
  );
}

function previewName(first: string, last: string, d: LastNameDisplay): string {
  if (!last) return first || "—";
  if (d === "full") return `${first} ${last}`;
  if (d === "initial") return `${first} ${last.charAt(0)}.`;
  return first;
}

function typeLabel(tp: ContactType, t: ReturnType<typeof useI18n>["t"]): string {
  switch (tp) {
    case "address": return t("homeLabel");
    case "phone": return t("mobile");
    case "email": return t("email");
    case "url": return t("website");
  }
}

function capLabel(c: string, _t: ReturnType<typeof useI18n>["t"]): string {
  return c.charAt(0).toUpperCase() + c.slice(1).replace("_", " ");
}

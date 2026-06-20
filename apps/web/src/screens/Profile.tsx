// Profile — view (as a member sees it) and edit (controllers only).
// Responsive: mobile uses the phone column; desktop uses the sidebar shell.
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  ContactItemDTO,
  ContactType,
  LastNameDisplay,
  PersonProfileDTO,
  Visibility,
} from "@sd/shared";
import { Icon, type IconName } from "../components/Icon.js";
import { Avatar, Btn, Tag, Vis, type VisState } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel, ContactRow, ContactValue, Field } from "../components/parts.js";
import { VisibilitySheet } from "../components/VisibilitySheet.js";
import { InviteSheet } from "../components/InviteSheet.js";
import { AddressMap } from "../components/AddressMap.js";
import { CONTACT_TYPE_ORDER, contactTypeName } from "../lib/contactTypes.js";
import { capLabel, useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, mediaUrl } from "../lib/api.js";

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
  const isDesktop = useIsDesktop();
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
  const editBtn = p.controlledByViewer ? (
    <button className="sd-btn sd-btn-secondary sd-btn-sm" onClick={() => navigate(`/persons/${p.id}/edit`)}>
      <Icon name="pencil" size={15} />{t("editProfile")}
    </button>
  ) : undefined;

  const hero = (
    <div style={{ background: "var(--paper)", borderBottom: "1px solid var(--line)", padding: "20px 18px 18px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 11, borderRadius: isDesktop ? "16px 16px 0 0" : undefined }}>
      <Avatar name={p.displayName} size={84} img={mediaUrl(p.photoUrl)} color="var(--blue)" />
      <div>
        <div className="sd-h1" style={{ fontSize: 23 }}>{p.displayName}</div>
        <div className="sd-row" style={{ gap: 6, marginTop: 8, justifyContent: "center" }}>
          {p.capabilities.map((c) => (
            <Tag key={c} tone={c === "teacher" ? "orange" : "blue"} icon={c === "teacher" ? "school" : "users3"}>{capLabel(t, c)}</Tag>
          ))}
        </div>
      </div>
    </div>
  );

  const body = (
    <>
      <div>
        <SectLabel>{t("contact")}</SectLabel>
        <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4 }}>
          {p.contacts.length === 0 && <div className="sd-meta" style={{ padding: "12px 0" }}>No shared contact info.</div>}
          {p.contacts.map((c) => (
            <Fragment key={c.id}>
              <ContactRow
                icon={ICON_BY_TYPE[c.type]}
                label={c.label || typeLabel(c.type, t)}
                value={<ContactValue type={c.type} value={c.value} t={t} />}
                vis={<Vis state={visState(c)} count={c.shareCount} withCaret={false} membersText={t("visMembers")} privateText={t("visPrivate")} sharedText={t("visShared")} />}
              />
              {c.type === "address" && c.hasLocation && <AddressMap contactId={c.id} address={c.value} />}
            </Fragment>
          ))}
        </div>
      </div>
      {p.groups.length > 0 && (
        <div>
          <SectLabel>{t("groups")}</SectLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 9 }}>
            {p.groups.map((g) => (
              <div key={g.id} className="sd-card" style={{ padding: 13, display: "flex", alignItems: "center", gap: 11, cursor: "pointer" }} onClick={() => navigate(`/groups/${g.id}`)}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: g.kind === "classroom" ? "var(--orange-tint)" : "var(--blue-tint)", color: g.kind === "classroom" ? "var(--orange-700)" : "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name={g.kind === "classroom" ? "school" : "home"} size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>{g.name}</div>
                  <div className="sd-meta">{g.memberCount} {t("members").toLowerCase()}</div>
                </div>
                <Icon name="chevright" size={18} style={{ color: "var(--ink-3)" }} />
              </div>
            ))}
          </div>
        </div>
      )}
      {!p.controlledByViewer && <Btn block icon="plus" style={{ marginTop: 4 }}>{t("shareCta", { name: p.firstName })}</Btn>}
    </>
  );

  // When previewing your own profile, the Edit button lives inside the notice
  // bar. (For a profile you control but aren't acting as, there's no bar, so the
  // button keeps its header/row placement below.)
  const previewNotice = isOwn ? (
    <div className="sd-row" style={{ background: "var(--ink)", color: "#fff", padding: "8px 14px", gap: 9, fontSize: 12.5, borderRadius: isDesktop ? 12 : 0, marginBottom: isDesktop ? 4 : 0 }}>
      <Icon name="eye" size={16} style={{ flex: "0 0 auto" }} />
      <div style={{ flex: 1, lineHeight: 1.25 }}>
        <strong style={{ fontWeight: 700 }}>{t("previewingAsMember")}</strong>
        <div style={{ opacity: 0.7, fontSize: 11.5 }}>{t("whatOthersSee")}</div>
      </div>
      {editBtn}
    </div>
  ) : null;

  if (isDesktop) {
    return (
      <DesktopShell active="profile" title={t("yourProfile")}>
        <div style={{ maxWidth: 760, width: "100%" }}>
          {previewNotice}
          {!isOwn && editBtn && <div className="sd-row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>{editBtn}</div>}
          <div className="sd-card" style={{ overflow: "hidden", padding: 0 }}>{hero}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>{body}</div>
        </div>
      </DesktopShell>
    );
  }

  return (
    <AppShell banner={previewNotice ?? undefined}>
      <ScreenHeader title="" onLeft={() => navigate(-1)} right={isOwn ? undefined : editBtn} />
      <div className="sd-scroll">
        {hero}
        <div className="sd-body" style={{ gap: 12 }}>{body}</div>
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
  const isDesktop = useIsDesktop();
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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [params] = useSearchParams();
  const deepLinkHandled = useRef(false);
  const contactsEndRef = useRef<HTMLDivElement>(null);

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

  // Deep link: /persons/:id/edit?add=address (or phone/email/url) pre-adds a
  // contact row and scrolls to it.
  useEffect(() => {
    if (!p || deepLinkHandled.current) return;
    const add = params.get("add");
    if (!add) return;
    deepLinkHandled.current = true;
    const valid: ContactType[] = ["address", "phone", "email", "url"];
    const type = (valid.includes(add as ContactType) ? add : "address") as ContactType;
    const tmpId = `tmp_${Math.random().toString(36).slice(2)}`;
    setContacts((cs) => [...cs, { id: tmpId, type, label: "", value: "", visibility: "private", _new: true, _dirty: true }]);
    setTimeout(() => contactsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 200);
  }, [p, params]);

  if (!p) return null;
  if (!p.controlledByViewer) return <CenteredNote text="You can't edit this profile." onBack={() => navigate(-1)} />;

  const updateContact = (cid: string, patch: Partial<EditContact>) =>
    setContacts((cs) => cs.map((c) => (c.id === cid ? { ...c, ...patch, _dirty: true } : c)));

  const addContact = () => {
    const tmpId = `tmp_${Math.random().toString(36).slice(2)}`;
    setContacts((cs) => [...cs, { id: tmpId, type: "phone", label: "", value: "", visibility: "private", _new: true, _dirty: true }]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.patchPerson(p.id, { firstName, lastName: lastName || null, lastNameDisplay: lnDisplay });
      for (const cid of removed) await api.deleteContact(cid).catch(() => {});
      for (const c of contacts) {
        if (!c.value.trim()) continue;
        if (c._new) {
          await api.addContact(p.id, { type: c.type, label: c.label, value: c.value, visibility: c.visibility, neighborDiscoverable: c.neighborDiscoverable });
        } else if (c._dirty) {
          await api.patchContact(c.id, { label: c.label, value: c.value, visibility: c.visibility, neighborDiscoverable: c.neighborDiscoverable });
        }
      }
      await refresh();
      navigate(`/persons/${p.id}`);
    } finally {
      setSaving(false);
    }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
      setPhotoError("Use a JPG, PNG, WebP, or GIF image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError("Image must be under 5 MB.");
      return;
    }
    setUploading(true);
    try {
      const { photoUrl } = await api.uploadPhoto(p.id, file);
      setP((prev) => (prev ? { ...prev, photoUrl } : prev));
      await refresh(); // update the avatar in the switcher / home / directory
    } catch {
      setPhotoError("Upload failed. Try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const sheetContact = contacts.find((c) => c.id === visSheetFor) ?? null;
  const saveBtn = <button className="sd-btn sd-btn-primary sd-btn-sm" onClick={() => void save()} disabled={saving}>{t("save")}</button>;

  const form = (
    <>
      {/* photo */}
      <div className="sd-row" style={{ gap: 14 }}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label={t("addPhoto")}
          style={{ position: "relative", border: 0, background: "none", padding: 0, cursor: "pointer", opacity: uploading ? 0.6 : 1 }}
        >
          <Avatar name={`${firstName} ${lastName}`} size={66} img={mediaUrl(p.photoUrl)} color="var(--blue)" />
          <div style={{ position: "absolute", right: -2, bottom: -2, width: 26, height: 26, borderRadius: 999, background: "var(--paper)", border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-2)" }}>
            <Icon name="upload" size={14} />
          </div>
        </button>
        <div>
          <div className="sd-label" style={{ fontSize: 13 }}>{t("photo")}</div>
          <button className="sd-btn sd-btn-secondary sd-btn-sm" style={{ marginTop: 7 }} disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={15} />{uploading ? "Uploading…" : t("addPhoto")}
          </button>
          {photoError && <div className="sd-meta" style={{ color: "var(--warn)", marginTop: 5 }}>{photoError}</div>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          style={{ display: "none" }}
          onChange={(e) => void onPhoto(e.target.files?.[0])}
        />
      </div>

      <Field
        label={t("firstName")}
        vis={<span className="sd-vis vis-members" style={{ cursor: "default" }}><Icon name="members" size={12} stroke={2} />{t("alwaysVisible")}</span>}
        hint={<span className="sd-row" style={{ gap: 7, color: "var(--ink-3)" }}><Icon name="info" size={14} style={{ flex: "0 0 auto", marginTop: 1 }} />{t("firstFixedWhy")}</span>}
      >
        <input className="sd-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
      </Field>

      <div className="sd-fieldcard">
        <div className="fr" style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span className="sd-label">{t("lastName")}</span>
          <input className="sd-input" value={lastName} onChange={(e) => setLastName(e.target.value)} style={{ height: 44 }} />
        </div>
        <div className="fr" style={{ background: "var(--bg)" }}>
          <div className="sd-seg">
            {(["full", "initial"] as LastNameDisplay[]).map((k) => (
              <button key={k} className={k === lnDisplay ? "on" : ""} onClick={() => setLnDisplay(k)}>
                {k === "full" ? t("lnFull") : t("lnInitial")}
              </button>
            ))}
          </div>
          <div className="sd-row" style={{ gap: 7, marginTop: 9, justifyContent: "center", fontSize: 12.5, color: "var(--ink-2)" }}>
            <span style={{ fontWeight: 600 }}>{t("shownAs")}</span>
            <span style={{ fontWeight: 800, color: "var(--ink)" }}>{previewName(firstName, lastName, lnDisplay)}</span>
          </div>
        </div>
      </div>

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
          <div ref={contactsEndRef} />
        </div>
      </div>

      <div>
        <SectLabel>{t("whoManages")}</SectLabel>
        <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
          <div className="sd-row" style={{ gap: 10 }}>
            <Avatar name={`${firstName} ${lastName}`} size={36} color="var(--blue)" />
            <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700 }}>You</div></div>
            <Tag tone="line">{t("owner")}</Tag>
          </div>
          <button className="sd-btn sd-btn-ghost block" style={{ justifyContent: "flex-start", padding: 0, height: 38, marginTop: 6 }} onClick={() => setInviteOpen(true)}>
            <Icon name="plus" size={17} />{t("inviteCoManager", { name: firstName })}
          </button>
        </div>
      </div>

      {/* Always-reachable Save at the bottom of the form (the header Save can be
          scrolled out of view, especially after the add-contact deep link). */}
      <div className="sd-row" style={{ gap: 9, marginTop: 4 }}>
        <Btn kind="secondary" onClick={() => navigate(-1)} disabled={saving} style={{ flex: "0 0 auto" }}>{t("cancel")}</Btn>
        <Btn block icon="check" onClick={() => void save()} disabled={saving} style={{ flex: 1 }}>{t("save")}</Btn>
      </div>
    </>
  );

  const sheet = (
    <>
      {sheetContact && (
        <VisibilitySheet
          contactId={sheetContact.id}
          fieldLabel={sheetContact.label || sheetContact.type}
          visibility={sheetContact.visibility}
          onClose={() => setVisSheetFor(null)}
          onChange={(visibility, shareCount) => updateContact(sheetContact.id, { visibility, shareCount })}
        />
      )}
      {inviteOpen && (
        <InviteSheet
          personId={p.id}
          personName={firstName}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </>
  );

  if (isDesktop) {
    return (
      <DesktopShell active="profile" title={t("editProfile")}>
        <div style={{ maxWidth: 640, width: "100%" }}>
          <div className="sd-row" style={{ justifyContent: "flex-end", gap: 8, marginBottom: 14 }}>
            <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={() => navigate(-1)}>{t("cancel")}</button>
            {saveBtn}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>{form}</div>
        </div>
        {sheet}
      </DesktopShell>
    );
  }

  return (
    <AppShell>
      <ScreenHeader title={t("editProfile")} left="x" onLeft={() => navigate(-1)} right={saveBtn} />
      <div className="sd-scroll">
        <div className="sd-body" style={{ gap: 18 }}>{form}</div>
      </div>
      {sheet}
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
  return (
    <div className="sd-fieldcard">
      <div className="fr" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div className="sd-cicon"><Icon name={ICON_BY_TYPE[c.type]} size={17} /></div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <select value={c.type} onChange={(e) => onChange({ type: e.target.value as ContactType })} className="sd-input" style={{ height: 32, fontSize: 13, padding: "0 8px", width: "auto" }}>
            {CONTACT_TYPE_ORDER.map((tp) => <option key={tp} value={tp}>{contactTypeName(tp, t)}</option>)}
          </select>
          <input className="sd-input" value={c.value} placeholder={typeLabel(c.type, t)} onChange={(e) => onChange({ value: e.target.value })} style={{ height: 38 }} />
        </div>
        <Vis state={visState(c)} count={c.shareCount} membersText={t("visMembers")} privateText={t("visPrivate")} sharedText={t("visShared")} onClick={onVis} />
        <button onClick={onRemove} aria-label="Remove" style={{ background: "none", border: 0, color: "var(--ink-3)", cursor: "pointer" }}><Icon name="x" size={18} /></button>
      </div>
      {c.type === "address" && (
        <div className="fr" style={{ background: "var(--orange-tint)", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <Icon name="pin" size={18} style={{ color: "var(--orange-ink)", flex: "0 0 auto", marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--orange-ink)" }}>{t("showAsNeighbor")}</div>
            <div style={{ fontSize: 11.5, color: "var(--orange-ink)", opacity: 0.85, lineHeight: 1.4, marginTop: 2 }}>{t("neighborWhy")}</div>
          </div>
          <button className={`sd-toggle${c.neighborDiscoverable ? " on" : ""}`} style={{ marginTop: 1, ...(c.neighborDiscoverable ? { background: "var(--orange-700)" } : {}) }} aria-pressed={c.neighborDiscoverable} onClick={() => onChange({ neighborDiscoverable: !c.neighborDiscoverable })} />
        </div>
      )}
      {c.type === "address" && c.hasLocation && (
        <div className="fr"><AddressMap contactId={c.id} address={c.value} width="100%" /></div>
      )}
    </div>
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
  return d === "full" ? `${first} ${last}` : `${first} ${last.charAt(0)}.`;
}

function typeLabel(tp: ContactType, t: ReturnType<typeof useI18n>["t"]): string {
  switch (tp) {
    case "address": return t("homeLabel");
    case "phone": return t("mobile");
    case "email": return t("email");
    case "url": return t("website");
  }
}

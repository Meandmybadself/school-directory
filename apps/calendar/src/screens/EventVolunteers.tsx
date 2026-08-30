// Volunteer signups for one authored event — the admin side.
//
// A sheet is per-DATE, not per-event (CLAUDE.md invariant 8: a recurring event
// has no single durable occurrence), so this screen is two steps: pick which
// date to open signups for, then define the positions on it. A one-off event
// still goes through the same picker; it just has one date to pick.
//
// Admin chrome is intentionally English-only (operator tooling), matching
// CalendarEvents.tsx. The member- and public-facing sheet — rendered on the
// event's own page at /e/:date/:slug — is fully translated; that's the page
// families actually read.
import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { eventPath, type ManagedOccurrenceDTO, type VolunteerSheetDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Avatar, Btn, Tag } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel, Field } from "../components/parts.js";
import { ErrorText, iconBtnStyle } from "../components/adminUi.js";
import { useSession } from "../lib/session.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, errorMessage } from "../lib/api.js";

/** The link to hand out. A sheet no longer has a page of its own — it is read on
 *  its event's page — so this is normally the event's URL, which is also what a
 *  family sees when they reach the sheet from the calendar.
 *
 *  An ORPHANED sheet is the exception, and it is the reason this is a function
 *  and not an interpolation. Its date is no longer on the calendar (the banner
 *  above says so), which means the event path addresses nothing and a reader
 *  following it would be told the event doesn't exist. The slug still resolves,
 *  because a slug is the durable handle — so hand out /v/:slug there, which
 *  forwards to the same page carrying the slug the fallback needs.
 *
 *  Built from this app's own origin, and only ever shown for a PUBLISHED sheet:
 *  until then the event withholds the slug and its page shows no signup block.
 *
 *  The date segment is minted in the ADMIN's timezone, like every other link
 *  this app builds; the lookup searches a ±1 day window, so a reader in another
 *  zone still resolves it. See packages/shared/src/eventPath.ts. */
function sheetUrl(sheet: VolunteerSheetDTO): string {
  const path = sheet.orphaned ? `/v/${sheet.slug}` : eventPath(sheet.event);
  return `${window.location.origin}${path}`;
}

function fmtOccurrence(o: ManagedOccurrenceDTO): string {
  return new Date(o.start).toLocaleString(undefined, {
    ...(o.allDay ? { timeZone: "UTC" } : {}),
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(o.allDay ? {} : { hour: "numeric", minute: "2-digit" }),
  });
}

/** "HH:MM" in local time, for the shift inputs. Positions store instants; the
 *  form works in the wall-clock time an admin is actually thinking about. */
function toTimeInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Combine a "HH:MM" with the sheet's own date, read locally. A shift is always
 *  on the day of the event, so the date never needs its own input. */
function fromTimeInput(time: string, occurrenceStart: string): string | null {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = new Date(occurrenceStart);
  d.setHours(h!, m!, 0, 0);
  return d.toISOString();
}

interface PositionForm {
  title: string;
  description: string;
  slots: string;
  startTime: string;
  endTime: string;
}

const emptyPosition: PositionForm = { title: "", description: "", slots: "1", startTime: "", endTime: "" };

function PositionEditor({ initial, busy, onSubmit, onCancel }: {
  initial: PositionForm;
  busy: boolean;
  onSubmit: (f: PositionForm) => Promise<void>;
  onCancel: () => void;
}) {
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof PositionForm>(k: K, v: PositionForm[K]) => setF((c) => ({ ...c, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) {
      setError("Give the position a title.");
      return;
    }
    setError(null);
    try {
      await onSubmit(f);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that position."));
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 10 }}>
      <Field label="Position">
        <input className="sd-input" placeholder="Snack table" value={f.title} onChange={(e) => set("title", e.target.value)} autoFocus />
      </Field>
      <Field label="Details" hint="Optional — what the job involves, what to bring.">
        <textarea className="sd-input" rows={2} style={{ height: "auto", resize: "vertical" }} value={f.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <Field label="People needed">
        <input className="sd-input" type="number" min={1} max={200} value={f.slots} onChange={(e) => set("slots", e.target.value)} style={{ width: 100 }} />
      </Field>
      <div className="sd-row" style={{ gap: 8, alignItems: "flex-end" }}>
        <Field label="Shift starts" hint="Optional.">
          <input className="sd-input" type="time" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} />
        </Field>
        <Field label="Shift ends" hint="Optional.">
          <input className="sd-input" type="time" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} />
        </Field>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="sd-row" style={{ gap: 8 }}>
        <Btn type="submit" icon="check" disabled={busy} style={{ flex: 1 }}>Save position</Btn>
        <Btn type="button" kind="secondary" onClick={onCancel} disabled={busy}>Cancel</Btn>
      </div>
    </form>
  );
}

/** One position with its roster. Admins see every name — this is the operator's
 *  view of who is coming, which is the whole reason to keep signups in-app. */
function PositionRow({ position, busy, onEdit, onRemove, onRelease }: {
  position: VolunteerSheetDTO["positions"][number];
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onRelease: (signupId: string) => void;
}) {
  const full = position.filled >= position.slots;
  return (
    <div className="sd-crow" style={{ alignItems: "flex-start", gap: 10, flexDirection: "column" }}>
      <div className="sd-row" style={{ gap: 10, width: "100%", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sd-row" style={{ gap: 7, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{position.title}</span>
            <Tag tone={full ? "line" : "orange"}>{position.filled} of {position.slots}</Tag>
          </div>
          {(position.startsAt || position.endsAt) && (
            <div className="sd-meta">
              {toTimeInput(position.startsAt) || "—"} – {toTimeInput(position.endsAt) || "—"}
            </div>
          )}
          {position.description && <div className="sd-meta">{position.description}</div>}
        </div>
        <button aria-label={`Edit ${position.title}`} onClick={onEdit} style={iconBtnStyle}>
          <Icon name="pencil" size={16} />
        </button>
        <button aria-label={`Remove ${position.title}`} onClick={onRemove} style={iconBtnStyle}>
          <Icon name="x" size={18} />
        </button>
      </div>
      {position.signups.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", paddingLeft: 2 }}>
          {position.signups.map((s) => (
            <div key={s.id} className="sd-row" style={{ gap: 8, minWidth: 0 }}>
              <Avatar name={s.displayName} size={22} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.displayName}</span>
              {s.note && <span className="sd-meta" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.note}</span>}
              <button
                aria-label={`Remove ${s.displayName}`}
                title="Remove this signup"
                onClick={() => onRelease(s.id)}
                disabled={busy}
                style={{ ...iconBtnStyle, marginLeft: "auto", flex: "0 0 auto" }}
              >
                <Icon name="x" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EventVolunteers() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { me, loading: sessionLoading } = useSession();

  const [occurrences, setOccurrences] = useState<ManagedOccurrenceDTO[] | null>(null);
  const [sheet, setSheet] = useState<VolunteerSheetDTO | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; form: PositionForm } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadOccurrences = useCallback(async () => {
    const r = await api.eventOccurrences(id).catch(() => ({ occurrences: [] as ManagedOccurrenceDTO[] }));
    setOccurrences(r.occurrences);
    return r.occurrences;
  }, [id]);

  useEffect(() => {
    void (async () => {
      const list = await loadOccurrences();
      // Land on the sheet that already exists, if there's exactly one — the
      // common case is a one-off event whose sheet you came here to edit.
      const withSheets = list.filter((o) => o.sheet);
      if (withSheets.length === 1) {
        const r = await api.adminVolunteerSheet(withSheets[0]!.sheet!.id).catch(() => null);
        if (r) setSheet(r.sheet);
      }
    })();
  }, [loadOccurrences]);

  const openSheet = async (sheetId: string) => {
    setError(null);
    const r = await api.adminVolunteerSheet(sheetId).catch(() => null);
    if (r) setSheet(r.sheet);
  };

  const create = async (occurrenceStart: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.addVolunteerSheet(id, { occurrenceStart });
      setSheet(r.sheet);
      void loadOccurrences();
    } catch (err) {
      setError(errorMessage(err, "Couldn't open signups for that date."));
    } finally {
      setBusy(false);
    }
  };

  const savePosition = async (f: PositionForm) => {
    if (!sheet) return;
    const body = {
      title: f.title.trim(),
      description: f.description.trim() || null,
      slots: Number(f.slots) || 1,
      startsAt: fromTimeInput(f.startTime, sheet.event.start),
      endsAt: fromTimeInput(f.endTime, sheet.event.start),
    };
    setBusy(true);
    try {
      const r = editing?.id
        ? await api.updateVolunteerPosition(editing.id, body)
        : await api.addVolunteerPosition(sheet.id, body);
      setSheet(r.sheet);
      setEditing(null);
      void loadOccurrences();
    } finally {
      setBusy(false);
    }
  };

  const removePosition = async (positionId: string) => {
    setBusy(true);
    try {
      const r = await api.deleteVolunteerPosition(positionId);
      setSheet(r.sheet);
      void loadOccurrences();
    } catch {
      setError("Couldn't remove that position.");
    } finally {
      setBusy(false);
    }
  };

  const releaseSignup = async (signupId: string) => {
    if (!sheet) return;
    setBusy(true);
    try {
      // The member route, used by an admin: it accepts a system admin removing
      // anyone's signup, so there is one code path for giving a spot back.
      await api.releaseVolunteerSpot(signupId);
      await openSheet(sheet.id);
    } catch {
      setError("Couldn't remove that signup.");
    } finally {
      setBusy(false);
    }
  };

  const togglePublished = async () => {
    if (!sheet) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.updateVolunteerSheet(sheet.id, { published: !sheet.published });
      setSheet(r.sheet);
      void loadOccurrences();
    } catch (err) {
      setError(errorMessage(err, "Couldn't change that."));
    } finally {
      setBusy(false);
    }
  };

  const removeSheet = async () => {
    if (!sheet) return;
    setBusy(true);
    try {
      await api.deleteVolunteerSheet(sheet.id);
      setSheet(null);
      void loadOccurrences();
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!sheet) return;
    try {
      await navigator.clipboard.writeText(sheetUrl(sheet));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the link is still selectable */
    }
  };

  if (!sessionLoading && me && !me.user.isSystemAdmin) return <Navigate to="/" replace />;

  const datePicker = (
    <>
      <SectLabel>Dates</SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
        {occurrences === null && <div className="sd-meta">Loading dates…</div>}
        {occurrences?.length === 0 && (
          <div className="sd-meta" style={{ padding: "8px 0" }}>
            This event has no dates on the calendar yet.
          </div>
        )}
        {(occurrences ?? []).map((o) => (
          <div key={o.start} className="sd-crow" style={{ alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sd-row" style={{ gap: 7, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{fmtOccurrence(o)}</span>
                {o.sheet && (
                  <Tag tone={o.sheet.published ? "blue" : "line"}>
                    {o.sheet.published ? "Published" : "Draft"} · {o.sheet.positionCount} positions
                  </Tag>
                )}
              </div>
            </div>
            {o.sheet ? (
              <Btn sm kind={sheet?.id === o.sheet.id ? "secondary" : "primary"} onClick={() => void openSheet(o.sheet!.id)}>
                {sheet?.id === o.sheet.id ? "Open" : "Manage"}
              </Btn>
            ) : (
              <Btn sm kind="secondary" icon="plus" disabled={busy} onClick={() => void create(o.start)}>
                Add signups
              </Btn>
            )}
          </div>
        ))}
      </div>
    </>
  );

  const sheetPanel = sheet && (
    <>
      <SectLabel
        action={
          !editing && (
            <Btn sm icon="plus" onClick={() => setEditing({ id: null, form: emptyPosition })}>Add position</Btn>
          )
        }
      >
        {fmtOccurrence({ start: sheet.event.start, end: sheet.event.end, allDay: sheet.event.allDay, sheet: null })}
      </SectLabel>

      <div className="sd-card sd-card-pad" style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 10 }}>
        {sheet.orphaned && (
          // The series was edited after this sheet was created, so the date it
          // names is no longer on the calendar. The signups are intact; the
          // sheet just isn't reachable from the agenda.
          <ErrorText>
            This date is no longer on the calendar — the event was edited after signups opened.
            The positions and signups below are intact; move them to a current date or delete the sheet.
          </ErrorText>
        )}

        <div className="sd-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Tag tone={sheet.published ? "blue" : "line"}>{sheet.published ? "Published" : "Draft"}</Tag>
          <Btn sm kind={sheet.published ? "secondary" : "primary"} disabled={busy} onClick={() => void togglePublished()}>
            {sheet.published ? "Unpublish" : "Publish"}
          </Btn>
          <button aria-label="Delete this sheet" title="Delete this sheet" onClick={() => void removeSheet()} style={{ ...iconBtnStyle, marginLeft: "auto" }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Only a published sheet has a page worth handing out — an unpublished
            one 404s for everyone but an admin. */}
        {sheet.published && (
          <div className="sd-row" style={{ gap: 6 }}>
            <a href={sheetUrl(sheet)} target="_blank" rel="noopener noreferrer" className="sd-meta sd-link" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
              {sheetUrl(sheet)}
            </a>
            <button aria-label="Copy signup link" onClick={() => void copyLink()} style={{ ...iconBtnStyle, flex: "0 0 auto" }}>
              <Icon name={copied ? "check" : "link"} size={15} />
            </button>
          </div>
        )}
        <div className="sd-meta">
          Anyone with this link can see the positions and how many spots are filled. Names are shown to
          signed-in members only, and signing up requires an account.
        </div>

        {error && <ErrorText>{error}</ErrorText>}
      </div>

      <div className="sd-card sd-card-pad" style={{ marginTop: 12 }}>
        {sheet.positions.length === 0 && !editing && (
          <div className="sd-meta" style={{ padding: "8px 0" }}>
            No positions yet. Add one — "Snack table, 4 people, 5–7pm".
          </div>
        )}
        {sheet.positions.map((p) => (
          <PositionRow
            key={p.id}
            position={p}
            busy={busy}
            onEdit={() =>
              setEditing({
                id: p.id,
                form: {
                  title: p.title,
                  description: p.description ?? "",
                  slots: String(p.slots),
                  startTime: toTimeInput(p.startsAt),
                  endTime: toTimeInput(p.endsAt),
                },
              })
            }
            onRemove={() => void removePosition(p.id)}
            onRelease={(signupId) => void releaseSignup(signupId)}
          />
        ))}
        {editing && (
          <PositionEditor
            key={editing.id ?? "new"}
            initial={editing.form}
            busy={busy}
            onSubmit={savePosition}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
    </>
  );

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>{datePicker}</div>
      {sheet && <div>{sheetPanel}</div>}
      {!sheet && error && <ErrorText>{error}</ErrorText>}
    </div>
  );

  if (isDesktop) {
    return (
      <DesktopShell active="admin" title="Volunteer signups">
        <div style={{ maxWidth: 760, width: "100%" }}>
          <button
            onClick={() => navigate(-1)}
            className="sd-row"
            style={{ gap: 5, marginBottom: 12, background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--blue-700)", font: "inherit", fontSize: 13, fontWeight: 700 }}
          >
            <Icon name="arrowleft" size={16} stroke={2.2} />Back to events
          </button>
          {body}
        </div>
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="admin" />}>
      <ScreenHeader title="Volunteer signups" onLeft={() => navigate(-1)} />
      <div className="sd-scroll">
        <div className="sd-body">{body}</div>
      </div>
    </AppShell>
  );
}

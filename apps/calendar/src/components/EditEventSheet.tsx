// The admin edit form for one authored event, as a bottom sheet.
//
// Reached by `seriesId` — the durable handle on the authored series, never the
// occurrence's render id, which is re-minted every time the agenda is
// materialized (invariant 8). That is also why the form is fetched here rather
// than assembled from the row that opened it: an agenda row (or an event page)
// carries an EXPANDED occurrence, while what is editable is the series behind
// it, recurrence and all.
//
// Editing therefore edits the whole series; this system has no per-occurrence
// override, so a repeating event says so before an admin saves rather than
// after. Admin chrome is English-only by convention — it only renders for a
// system admin, and the server enforces that independently.
//
// Lives here rather than in a screen because two of them open it: the event page
// at /e/:date/:slug (where an admin lands from the agenda) and admin screens.
import { useEffect, useState } from "react";
import type { ManagedEventDTO } from "@sd/shared";
import { Btn } from "./atoms.js";
import { SheetOver } from "./parts.js";
import { ConfirmDelete, ErrorText, dangerBtnStyle, describeEvent, eventDeleteLines } from "./adminUi.js";
import { EventEditor } from "./EventEditor.js";
import { api, errorMessage } from "../lib/api.js";
import { formFromEvent, toInput, type EventForm } from "../lib/eventForm.js";

export function EditEventSheet({ seriesId, onClose, onSaved, onDeleted }: {
  seriesId: string;
  onClose: () => void;
  /** Handed the SAVED series. The caller needs it: a title or date change moves
   *  the event's page URL, which is built from exactly those fields. */
  onSaved: (event: ManagedEventDTO) => void;
  /** Called once the series is gone. Deleting is offered here because this sheet
   *  is where an admin already is when they decide an event shouldn't happen —
   *  reached from the event's own page, which the delete then invalidates, so
   *  the caller has to decide where to send them. Omit it and no delete is
   *  offered. */
  onDeleted?: () => void;
}) {
  const [event, setEvent] = useState<ManagedEventDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void api
      .managedEvent(seriesId)
      .then((r) => live && setEvent(r.event))
      // A 404 here is the ordinary race: the series was deleted (or the page
      // went stale) between it loading and this sheet opening.
      .catch((err) => live && setLoadError(errorMessage(err, "That event is no longer available.")));
    return () => {
      live = false;
    };
  }, [seriesId]);

  // Errors from the save itself are the form's to show — EventEditor catches
  // whatever onSubmit throws and renders it inline, next to the fields.
  const save = async (form: EventForm) => {
    setBusy(true);
    try {
      const r = await api.updateManagedEvent(seriesId, toInput(form));
      onSaved(r.event);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setDeleteError(null);
    try {
      await api.deleteManagedEvent(seriesId);
      onDeleted?.();
    } catch (err) {
      // Including the ordinary race: somebody else deleted it first. Either way
      // the event is gone, but say so rather than closing on silence.
      setDeleteError(errorMessage(err, "Couldn't delete that event."));
    } finally {
      setBusy(false);
    }
  };

  // The confirmation replaces the form inside this same sheet rather than
  // opening a second overlay on top of it.
  if (event && confirming) {
    return (
      <SheetOver onClose={busy ? undefined : () => setConfirming(false)}>
        <ConfirmDelete
          heading={`Delete "${event.title}"?`}
          lines={eventDeleteLines(event)}
          confirmLabel="Delete event"
          busy={busy}
          error={deleteError}
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      </SheetOver>
    );
  }

  return (
    <SheetOver onClose={busy ? undefined : onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 6 }}>Edit event</h2>
      {!event && !loadError && <div className="sd-meta">Loading event…</div>}
      {loadError && (
        <>
          <ErrorText>{loadError}</ErrorText>
          <Btn block kind="secondary" style={{ marginTop: 14 }} onClick={onClose}>Close</Btn>
        </>
      )}
      {event && (
        <>
          <div className="sd-meta">{describeEvent(event)}</div>
          {event.recurrence && (
            <div className="sd-meta" style={{ marginTop: 6, color: "var(--ink-2)", lineHeight: 1.45 }}>
              This event repeats. Saving applies to all {event.occurrenceCount} of its dates —
              there is no per-date override.
            </div>
          )}
          <EventEditor
            initial={formFromEvent(event)}
            busy={busy}
            onSubmit={save}
            onCancel={onClose}
            revealOnMount={false}
          />
          {onDeleted && (
            <Btn
              block
              kind="secondary"
              icon="x"
              disabled={busy}
              onClick={() => {
                setDeleteError(null);
                setConfirming(true);
              }}
              style={{ ...dangerBtnStyle, marginTop: 12 }}
            >
              Delete event
            </Btn>
          )}
        </>
      )}
    </SheetOver>
  );
}

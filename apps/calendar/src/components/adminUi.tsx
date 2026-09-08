// Small pieces shared by the two admin screens (the calendar list, and one
// calendar's event page). Admin chrome is intentionally English-only here
// (operator tooling), matching the directory app's convention — member-facing
// copy still goes through i18n.
import { useState, type ReactNode } from "react";
import type { CalendarSourceDTO, ManagedCalendarRemovalImpactDTO, ManagedEventDTO } from "@sd/shared";
import { Btn } from "./atoms.js";
import { Icon } from "./Icon.js";

export const DEFAULT_COLOR = "#0068A8";

export const colorInputStyle = {
  width: 42, height: 38, padding: 0, border: "1px solid var(--line)", borderRadius: 8,
  background: "none", cursor: "pointer",
} as const;

export const iconBtnStyle = {
  background: "none", border: 0, color: "var(--ink-3)", cursor: "pointer",
} as const;

/** A destructive button. There is no `danger` Btn kind in the copied design
 *  system, and adding one would have to be decided for three apps (see
 *  CLAUDE.md on the copied tokens); a secondary button wearing --warn is the
 *  same colour the error text already uses and stays local to admin chrome. */
export const dangerBtnStyle = {
  color: "var(--warn)", borderColor: "var(--warn)",
} as const;

export function ErrorText({ children }: { children: ReactNode }) {
  return <div className="sd-meta" style={{ color: "var(--warn)" }}>{children}</div>;
}

export function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

/** A human summary of an event's schedule. All-day values are stored at midnight
 *  UTC, so they're formatted in UTC — reading them locally would show the
 *  previous day for anyone west of it. */
export function describeEvent(e: ManagedEventDTO): string {
  const start = new Date(e.start);
  const date = e.allDay
    ? start.toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
    : start.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (!e.recurrence) return e.allDay ? `${date} · all day` : date;

  const { freq, interval = 1, byDay, until } = e.recurrence;
  const every = interval > 1 ? `every ${interval} ${freq === "daily" ? "days" : freq === "weekly" ? "weeks" : "months"}` : freq;
  const days = freq === "weekly" && byDay?.length ? ` on ${byDay.join(", ")}` : "";
  // UNTIL is stored to match its event's kind: midnight UTC for an all-day
  // series, the local END of the chosen day for a timed one (so a late-evening
  // occurrence still falls inside it). Reading a timed UNTIL in UTC therefore
  // reports the following day — picking "Aug 29" rendered as "until Aug 30".
  const untilLabel = new Date(until).toLocaleDateString(undefined, {
    ...(e.allDay ? { timeZone: "UTC" } : {}),
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${date} · ${every}${days} until ${untilLabel}`;
}

/** The published .ics URL with a copy button — what an admin hands to someone
 *  who wants to subscribe from Google or Apple Calendar. */
/** What one occurrence row on the volunteer-signups screen can offer.
 *
 *  The third case is the one worth naming. When a row's sheet is ALREADY the one
 *  loaded in the panel below, there is nothing left to do to it — and the screen
 *  used to render a button reading "Open" whose handler re-fetched that same
 *  sheet and set the same state. Clicking it produced no visible change, which
 *  reads as a broken control rather than as "you are already here". The labels
 *  were also inverted against their meaning: the row you could act on said
 *  "Manage", and the row you could not said "Open".
 *
 *  So the actionable row now says "Open" — the verb for what it does — and the
 *  current row states its state instead of offering a no-op. */
export type OccurrenceAction = "create" | "open" | "editing";

export function occurrenceAction(
  rowSheetId: string | null | undefined,
  openSheetId: string | null | undefined,
): OccurrenceAction {
  if (!rowSheetId) return "create";
  return rowSheetId === openSheetId ? "editing" : "open";
}

export function IcsLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the link is still selectable */
    }
  };
  return (
    <div className="sd-row" style={{ gap: 6, marginTop: 4 }}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="sd-meta sd-link"
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
      >
        {url}
      </a>
      <button aria-label="Copy feed URL" onClick={() => void copy()} style={{ ...iconBtnStyle, flex: "0 0 auto" }}>
        <Icon name={copied ? "check" : "link"} size={15} />
      </button>
    </div>
  );
}

/** The "are you sure" for a destructive admin action.
 *
 *  Body only, no overlay: the three callers each already have somewhere to put
 *  it. The event and calendar lists wrap it in a SheetOver of their own; the
 *  edit sheet swaps it in for the form rather than stacking a second overlay on
 *  top of itself.
 *
 *  `lines` is the caller's, because only the caller knows the collateral — how
 *  many dates a series expanded to, how many people had claimed a volunteer
 *  spot. Naming it here is the entire point of the step: a delete is one
 *  statement in D1 with nothing to undo it, so the number of sign-ups about to
 *  be discarded has to be read BEFORE, not regretted after.
 *
 *  Which is why `loading` exists and is not folded into `busy`: an event's
 *  caller has its counts already, a calendar's has to fetch them, and until
 *  they arrive there is nothing to agree TO. The button is held rather than
 *  hidden, and it keeps saying "Delete" — `busy`'s "Deleting…" would claim a
 *  delete had started when nothing has been asked for yet.
 *
 *  `undoNote` is the last line, always, so the three confirmations answer "can
 *  I get this back?" in the same place. It defaults to the answer two of them
 *  give; an imported feed overrides it because for that one the honest answer
 *  is different, and stating it here rather than among `lines` keeps a softer
 *  sentence from sitting next to a "can't be undone" that contradicts it. */
export function ConfirmDelete({
  heading,
  lines,
  confirmLabel = "Delete",
  busy,
  loading = false,
  undoNote = "This can't be undone.",
  error,
  onConfirm,
  onCancel,
}: {
  heading: string;
  lines: string[];
  confirmLabel?: string;
  busy: boolean;
  loading?: boolean;
  undoNote?: string;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 className="sd-h2" style={{ margin: 0 }}>{heading}</h2>
      {lines.map((line) => (
        <div key={line} className="sd-meta" style={{ lineHeight: 1.45 }}>{line}</div>
      ))}
      <div className="sd-meta" style={{ lineHeight: 1.45 }}>{undoNote}</div>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="sd-row" style={{ gap: 8, marginTop: 4 }}>
        <Btn kind="secondary" icon="x" disabled={busy || loading} onClick={onConfirm} style={{ ...dangerBtnStyle, flex: 1 }}>
          {busy ? "Deleting…" : confirmLabel}
        </Btn>
        <Btn kind="secondary" disabled={busy} onClick={onCancel}>Keep it</Btn>
      </div>
    </div>
  );
}

/** The collateral lines for deleting one authored series, in the words the
 *  admin needs: the dates go, and so does anyone who had signed up. Shared by
 *  the event list and the edit sheet so the two never disagree about what a
 *  delete does. */
export function eventDeleteLines(e: ManagedEventDTO): string[] {
  const lines = [describeEvent(e)];
  if (e.recurrence) {
    lines.push(`All ${e.occurrenceCount} dates in this series come off the calendar.`);
  }
  const volunteers = volunteerDeleteLine(e.sheetCount, e.signupCount);
  if (volunteers) lines.push(volunteers);
  return lines;
}

/** The volunteer half of a delete confirmation. Shared by the event and the
 *  calendar so the same loss is never described two different ways — and so
 *  the sentence that names sign-ups can only be edited in one place. */
function volunteerDeleteLine(sheets: number, signups: number): string | null {
  if (signups > 0) {
    return (
      `${signups} volunteer sign-up${signups === 1 ? "" : "s"} ` +
      `on ${sheets} sheet${sheets === 1 ? "" : "s"} will be deleted with it, ` +
      `and the people who claimed those spots are not told.`
    );
  }
  if (sheets > 0) {
    return (
      `${sheets} volunteer sheet${sheets === 1 ? "" : "s"} will be deleted with it. ` +
      `Nobody has claimed a spot yet.`
    );
  }
  return null;
}

/** The collateral for deleting a whole calendar.
 *
 *  It says more than the event's version because the row it is opened from
 *  shows less: an event's admin can see the event, where a calendar's row is a
 *  name and a count with everything underneath it out of sight. The feed line
 *  is the loss with no equivalent one level down — a calendar publishes its own
 *  .ics, and anyone subscribed to it in Google or Apple Calendar loses those
 *  events silently, with nothing to tell them why. */
export function calendarDeleteLines(i: ManagedCalendarRemovalImpactDTO): string[] {
  const lines: string[] = [];
  if (i.events === 0) {
    lines.push("Nothing is on this calendar yet.");
  } else {
    lines.push(
      `${i.events} event${i.events === 1 ? "" : "s"} ` +
        `(${i.occurrences} date${i.occurrences === 1 ? "" : "s"} on the agenda) ` +
        `will be deleted with it.`,
    );
    lines.push(
      "Its published .ics feed stops resolving, so anyone subscribed to it just " +
        "stops seeing these events.",
    );
  }
  const volunteers = volunteerDeleteLine(i.sheets, i.signups);
  if (volunteers) lines.push(volunteers);
  return lines;
}

/** The collateral for removing an imported ICS feed.
 *
 *  Deliberately the shortest of the three, because the loss genuinely is: no
 *  volunteer sheet can hang off an imported event (invariant 8 leaves it no
 *  durable handle to key on), and nothing here was authored here. What does not
 *  come back on its own is the URL — a Google or Outlook subscribe link can be
 *  a long trip through someone else's settings to find again — so the note
 *  names it while it is still on screen above.
 *
 *  `eventCount` is read off the row the list already loaded rather than
 *  re-counted, which is right where the calendar's is not: an imported feed's
 *  events are a cache the next cron refills, so a number a few minutes old
 *  misstates nothing anyone can lose. */
export function sourceDeleteLines(s: CalendarSourceDTO): string[] {
  const lines = [
    s.eventCount === 0
      ? "It has no events on the agenda right now."
      : `Its ${s.eventCount} event${s.eventCount === 1 ? "" : "s"} come off the agenda.`,
  ];
  lines.push("The feed URL isn't kept — copy it first if you might want it back.");
  return lines;
}

/** The one confirmation whose answer to "can I undo this?" is not no. */
export const SOURCE_UNDO_NOTE =
  "Nothing authored here is lost: re-adding the feed re-imports its events on the next fetch.";

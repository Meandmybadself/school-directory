// Small pieces shared by the two admin screens (the calendar list, and one
// calendar's event page). Admin chrome is intentionally English-only here
// (operator tooling), matching the directory app's convention — member-facing
// copy still goes through i18n.
import { useState, type ReactNode } from "react";
import type { ManagedEventDTO } from "@sd/shared";
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
 *  Body only, no overlay: the two callers each already have somewhere to put it.
 *  The event list wraps it in a SheetOver of its own; the edit sheet swaps it in
 *  for the form rather than stacking a second overlay on top of itself.
 *
 *  `lines` is the caller's, because only the caller knows the collateral — how
 *  many dates a series expanded to, how many people had claimed a volunteer
 *  spot. Naming it here is the entire point of the step: a delete is one
 *  statement in D1 with nothing to undo it, so the number of sign-ups about to
 *  be discarded has to be read BEFORE, not regretted after. */
export function ConfirmDelete({
  heading,
  lines,
  confirmLabel = "Delete",
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  heading: string;
  lines: string[];
  confirmLabel?: string;
  busy: boolean;
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
      <div className="sd-meta" style={{ lineHeight: 1.45 }}>This can't be undone.</div>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="sd-row" style={{ gap: 8, marginTop: 4 }}>
        <Btn kind="secondary" icon="x" disabled={busy} onClick={onConfirm} style={{ ...dangerBtnStyle, flex: 1 }}>
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
  if (e.signupCount > 0) {
    lines.push(
      `${e.signupCount} volunteer sign-up${e.signupCount === 1 ? "" : "s"} ` +
        `on ${e.sheetCount} sheet${e.sheetCount === 1 ? "" : "s"} will be deleted with it, ` +
        `and the people who claimed those spots are not told.`,
    );
  } else if (e.sheetCount > 0) {
    lines.push(
      `${e.sheetCount} volunteer sheet${e.sheetCount === 1 ? "" : "s"} will be deleted with it. ` +
        `Nobody has claimed a spot yet.`,
    );
  }
  return lines;
}

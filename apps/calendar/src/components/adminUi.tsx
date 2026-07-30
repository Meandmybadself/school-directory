// Small pieces shared by the two admin screens (the calendar list, and one
// calendar's event page). Admin chrome is intentionally English-only here
// (operator tooling), matching the directory app's convention — member-facing
// copy still goes through i18n.
import { useState, type ReactNode } from "react";
import type { ManagedEventDTO } from "@sd/shared";
import { Icon } from "./Icon.js";

export const DEFAULT_COLOR = "#0068A8";

export const colorInputStyle = {
  width: 42, height: 38, padding: 0, border: "1px solid var(--line)", borderRadius: 8,
  background: "none", cursor: "pointer",
} as const;

export const iconBtnStyle = {
  background: "none", border: 0, color: "var(--ink-3)", cursor: "pointer",
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
  const untilLabel = new Date(until).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
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

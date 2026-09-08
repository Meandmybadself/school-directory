// The board index: every event and initiative the PTO is running, plus the last
// ones it ran.
//
// Board chrome is English-only, matching the calendar's and the newsletter's
// admin screens — this is a tool for the eight people on the board, and its copy
// changes with the feature rather than with the audience. The public page and
// the NoAccess card are the translated surfaces in this app.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PtoBoardDTO, PtoEventOptionDTO } from "@sd/shared";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { Btn, Tag } from "../components/atoms.js";
import { Icon } from "../components/Icon.js";
import { ScreenHeader, SectLabel } from "../components/parts.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { api, errorMessage, CALENDAR_URL } from "../lib/api.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";

function whenLabel(iso: string | null, allDay: boolean): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      // All-day events are stored at midnight UTC and have to be read that way,
      // or anyone west of it sees the previous day — the same correction
      // `describeEvent` makes in the calendar app.
      ...(allDay ? { timeZone: "UTC" } : {}),
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

function BoardTile({ board, onOpen }: { board: PtoBoardDTO; onOpen: () => void }) {
  const when = board.event ? whenLabel(board.event.start, board.event.allDay) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="sd-card sd-card-pad"
      style={{
        textAlign: "left",
        font: "inherit",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        opacity: board.archived ? 0.62 : 1,
      }}
    >
      <div className="sd-row" style={{ gap: 8, alignItems: "baseline" }}>
        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.3px", flex: 1 }}>
          {board.title}
        </span>
        {board.archived && <Tag tone="line">Archived</Tag>}
      </div>
      {board.summary && <div className="sd-meta">{board.summary}</div>}
      <div className="sd-row" style={{ gap: 8, marginTop: 2 }}>
        <span className="sd-meta">
          {board.cardCount} {board.cardCount === 1 ? "card" : "cards"}
        </span>
        {board.event && (
          <span className="sd-meta" style={{ color: "var(--blue-700)", fontWeight: 700 }}>
            <Icon name="calendar" size={12} stroke={2} /> {board.event.title}
            {when ? ` · ${when}` : ""}
          </span>
        )}
      </div>
    </button>
  );
}

/** New-board form. The event link is optional and picked from MANAGED events
 *  only — an imported ICS event has no durable id to hang anything off
 *  (invariant 8), which is why `GET /pto/events` offers nothing else. */
function NewBoard({ events, onCreated }: { events: PtoEventOptionDTO[]; onCreated: (slug: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { board } = await api.createBoard({
        title: title.trim(),
        summary: summary.trim() || null,
        managedEventId: eventId || null,
      });
      onCreated(board.slug);
    } catch (err) {
      setError(errorMessage(err, "Couldn't create that board."));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Btn icon="plus" kind="secondary" onClick={() => setOpen(true)}>
        New board
      </Btn>
    );
  }

  return (
    <form onSubmit={submit} className="sd-card sd-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input
        className="sd-input"
        placeholder="Board name, e.g. Read-A-Thon 2026"
        value={title}
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        className="sd-input"
        placeholder="One line about it (optional)"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
      />
      <select className="sd-input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
        <option value="">No calendar event</option>
        {events.map((e) => (
          <option key={e.seriesId} value={e.seriesId}>
            {e.title} · {new Date(e.start).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </option>
        ))}
      </select>
      <div className="sd-row" style={{ gap: 8 }}>
        <Btn type="submit" icon="check" disabled={busy || !title.trim()} style={{ flex: 1 }}>
          Create
        </Btn>
        <Btn type="button" kind="secondary" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Btn>
      </div>
      {error && <div className="sd-meta" style={{ color: "var(--warn)" }}>{error}</div>}
    </form>
  );
}

function Body() {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<PtoBoardDTO[] | null>(null);
  const [events, setEvents] = useState<PtoEventOptionDTO[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, e] = await Promise.all([api.boards(showArchived), api.events()]);
      setBoards(b.boards);
      setEvents(e.events);
    } catch (err) {
      setError(errorMessage(err, "Couldn't load the boards."));
      setBoards([]);
    }
  }, [showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = (boards ?? []).filter((b) => !b.archived);
  const archived = (boards ?? []).filter((b) => b.archived);

  return (
    <div style={{ padding: "16px 16px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      {error && <div className="sd-meta" style={{ color: "var(--warn)" }}>{error}</div>}

      <NewBoard events={events} onCreated={(slug) => navigate(`/b/${slug}`)} />

      {boards === null ? (
        <div className="sd-meta">Loading…</div>
      ) : active.length === 0 ? (
        <div className="sd-card sd-card-pad">
          <div style={{ fontWeight: 700 }}>No boards yet</div>
          <p className="sd-meta" style={{ marginTop: 6 }}>
            A board is one event or one initiative — "Read-A-Thon 2026", "Playground fund". It starts
            with three columns and you take it from there.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
          {active.map((b) => (
            <BoardTile key={b.id} board={b} onOpen={() => navigate(`/b/${b.slug}`)} />
          ))}
        </div>
      )}

      <SectLabel
        action={
          <button
            type="button"
            className="sd-link"
            style={{ background: "none", border: 0, font: "inherit", cursor: "pointer" }}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Hide" : "Show"}
          </button>
        }
      >
        Archived
      </SectLabel>
      {showArchived &&
        (archived.length === 0 ? (
          <div className="sd-meta">Nothing archived.</div>
        ) : (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
            {archived.map((b) => (
              <BoardTile key={b.id} board={b} onOpen={() => navigate(`/b/${b.slug}`)} />
            ))}
          </div>
        ))}

      <p className="sd-meta" style={{ marginTop: 8 }}>
        Dates come from the calendar, never from a board —{" "}
        <a className="sd-link" href={CALENDAR_URL}>
          calendar.eisenhower.school
        </a>
      </p>
    </div>
  );
}

export function Boards() {
  const isDesktop = useIsDesktop();
  if (isDesktop) {
    return (
      <DesktopShell active="boards" title="Boards">
        <Body />
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="boards" />}>
      <ScreenHeader title="Boards" left="arrowleft" onLeft={() => (window.location.href = "/")} />
      {/* `.sd-app` is exactly 100dvh, so a screen's scrolling content has to sit
          in a `.sd-scroll` child — that element carries the `min-height: 0`
          that lets it shrink. Content placed directly in AppShell is clipped.
          See CLAUDE.md, "Conventions". */}
      <div className="sd-scroll">
        <Body />
        <SiteFooter />
      </div>
    </AppShell>
  );
}

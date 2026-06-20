// Shared calendar — an agenda list of upcoming events aggregated from the
// admin-configured ICS feeds, grouped by day. Times render in the viewer's
// local timezone. Per-calendar show/hide is remembered in localStorage; tapping
// an event opens its detail (location + description).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { htmlToText, type CalendarEventDTO, type CalendarFeedDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Btn } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel, SheetOver } from "../components/parts.js";
import { useI18n } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api } from "../lib/api.js";

const HIDDEN_KEY = "sd_cal_hidden";

function loadHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** Group events into day buckets keyed by local start-of-day. Sorts defensively
 *  so grouping is correct regardless of server ordering. */
function groupByDay(events: CalendarEventDTO[]): { key: number; date: Date; events: CalendarEventDTO[] }[] {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const groups: { key: number; date: Date; events: CalendarEventDTO[] }[] = [];
  let current: { key: number; date: Date; events: CalendarEventDTO[] } | null = null;
  for (const e of sorted) {
    const d = new Date(e.start);
    const key = startOfDay(d);
    if (!current || current.key !== key) {
      current = { key, date: d, events: [] };
      groups.push(current);
    }
    current.events.push(e);
  }
  return groups;
}

function timeOf(e: CalendarEventDTO, locale: string, t: ReturnType<typeof useI18n>["t"]): string {
  return e.allDay ? t("allDay") : new Date(e.start).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

function EventRow({ e, locale, onOpen }: { e: CalendarEventDTO; locale: string; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onOpen} className="sd-crow" style={{ gap: 11, border: 0, background: "transparent", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", alignItems: "flex-start" }}>
      <div style={{ width: 64, flex: "0 0 auto", fontSize: 12.5, fontWeight: 700, color: "var(--ink-2)", paddingTop: 1 }}>{timeOf(e, locale, t)}</div>
      <span style={{ width: 4, alignSelf: "stretch", borderRadius: 4, background: e.source.color, flex: "0 0 auto", minHeight: 18 }} />
      <div className="sd-cmain" style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.3 }}>{e.title}</div>
        <div className="sd-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 2 }}>
          {e.location && <span className="sd-meta">{e.location}</span>}
          <span className="sd-meta" style={{ color: e.source.color, fontWeight: 600 }}>{e.source.name}</span>
        </div>
      </div>
      <Icon name="chevright" size={16} style={{ color: "var(--ink-3)", flex: "0 0 auto", marginTop: 3 }} />
    </button>
  );
}

/** Show/hide chips for each feed; toggling persists to localStorage. */
function FilterBar({ feeds, hidden, onToggle }: { feeds: CalendarFeedDTO[]; hidden: Set<string>; onToggle: (id: string) => void }) {
  const { t } = useI18n();
  if (feeds.length < 2) return null;
  return (
    <div>
      <SectLabel>{t("calendars")}</SectLabel>
      <div className="sd-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 9 }}>
        {feeds.map((f) => {
          const on = !hidden.has(f.id);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onToggle(f.id)}
              aria-pressed={on}
              className="sd-tag"
              style={{ cursor: "pointer", font: "inherit", gap: 6, border: "1px solid var(--line)", background: "var(--paper)", color: on ? "var(--ink)" : "var(--ink-3)", opacity: on ? 1 : 0.6 }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 3, background: on ? f.color : "var(--line-2)", flex: "0 0 auto" }} />
              {f.name}
              <Icon name={on ? "eye" : "minus"} size={12} stroke={2} style={{ opacity: 0.6 }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function googleMapsUrl(q: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function EventDetailSheet({ e, locale, onClose }: { e: CalendarEventDTO; locale: string; onClose: () => void }) {
  const { t } = useI18n();
  const start = new Date(e.start);
  const end = e.end ? new Date(e.end) : null;
  const dateStr = start.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" });
  let timeStr: string;
  if (e.allDay) {
    timeStr = t("allDay");
  } else {
    const s = start.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
    const en = end ? end.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) : null;
    timeStr = en ? `${s} – ${en}` : s;
  }
  return (
    <SheetOver onClose={onClose}>
      <div className="sd-row" style={{ gap: 8, marginBottom: 4 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: e.source.color, flex: "0 0 auto" }} />
        <span className="sd-meta" style={{ color: e.source.color, fontWeight: 700 }}>{e.source.name}</span>
      </div>
      <h2 className="sd-h2" style={{ marginBottom: 10 }}>{e.title}</h2>
      <div className="sd-row" style={{ gap: 9, marginBottom: e.location ? 8 : 14 }}>
        <Icon name="calendar" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
        <div style={{ fontSize: 14 }}>{dateStr}<span style={{ color: "var(--ink-3)" }}> · {timeStr}</span></div>
      </div>
      {e.location && (
        <div className="sd-row" style={{ gap: 9, marginBottom: 14 }}>
          <Icon name="pin" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
          <a href={googleMapsUrl(e.location)} target="_blank" rel="noopener noreferrer" className="sd-link" style={{ fontSize: 14 }}>{e.location}</a>
        </div>
      )}
      {e.description && (
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", borderTop: "1px solid var(--line)", paddingTop: 12 }}>{htmlToText(e.description)}</div>
      )}
      <Btn block kind="secondary" style={{ marginTop: 16 }} onClick={onClose}>{t("done")}</Btn>
    </SheetOver>
  );
}

export function Calendar() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [events, setEvents] = useState<CalendarEventDTO[] | null>(null);
  const [feeds, setFeeds] = useState<CalendarFeedDTO[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(loadHidden);
  const [selected, setSelected] = useState<CalendarEventDTO | null>(null);

  useEffect(() => {
    void api.calendarEvents({ limit: 200 }).then((r) => setEvents(r.events)).catch(() => setEvents([]));
    void api.calendarFeeds().then((r) => setFeeds(r.sources)).catch(() => setFeeds([]));
  }, []);

  const toggle = (id: string) => {
    setHidden((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore quota/availability errors */
      }
      return next;
    });
  };

  // Show an event if any of its calendars is visible (it may be on several).
  const visible = useMemo(() => (events ?? []).filter((e) => e.sourceIds.some((id) => !hidden.has(id))), [events, hidden]);
  const groups = groupByDay(visible);

  const body = (
    <>
      <FilterBar feeds={feeds} hidden={hidden} onToggle={toggle} />
      {events === null && (
        <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "28px 16px" }}>…</div>
      )}
      {events && visible.length === 0 && (
        <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "28px 16px" }}>{t("noEvents")}</div>
      )}
      {groups.map((g) => (
        <div key={g.key}>
          <SectLabel>{g.date.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" })}</SectLabel>
          <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4, display: "flex", flexDirection: "column" }}>
            {g.events.map((e) => <EventRow key={e.id} e={e} locale={locale} onOpen={() => setSelected(e)} />)}
          </div>
        </div>
      ))}
    </>
  );

  const sheet = selected && (
    <div className="sd">
      <EventDetailSheet e={selected} locale={locale} onClose={() => setSelected(null)} />
    </div>
  );

  if (isDesktop) {
    return (
      <DesktopShell active="calendar" title={t("calendarTitle")}>
        <div style={{ maxWidth: 760, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>{body}</div>
        {sheet}
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="calendar" />}>
      <ScreenHeader title={t("calendarTitle")} onLeft={() => navigate("/")} />
      <div className="sd-scroll">
        <div className="sd-body" style={{ gap: 16 }}>{body}</div>
      </div>
      {sheet}
    </AppShell>
  );
}

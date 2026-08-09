// The calendar — an agenda list of upcoming events grouped by day, aggregated
// from imported ICS feeds and calendars authored here. Times render in the
// viewer's local timezone. Per-calendar show/hide is remembered in localStorage;
// tapping an event opens its detail (location + description).
//
// Ported from the directory app's /calendar screen, which this replaces. The
// localStorage key is intentionally the same so a member's hidden-calendar
// choices are not reset by the move (each origin keeps its own copy, but the
// shape matches, and reusing the name keeps the two readable as one feature).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { htmlToText, type PublicCalendarEventDTO, type PublicCalendarFeedDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Btn } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel, SheetOver } from "../components/parts.js";
import { SubscribeSheet } from "../components/Sheets.js";
import { useI18n } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { showsDescription, showsAllDayLabel, showsTitle, eventDayKey, formatEventDay } from "../lib/calendar.js";

const HIDDEN_KEY = "sd_cal_hidden";

/** The two actions hanging off a calendar chip. Shared so subscribe and
 *  download keep matching each other as the chip is restyled — they read as one
 *  segmented control, and one drifting is immediately visible. */
const feedActionStyle = {
  display: "inline-flex", alignItems: "center", padding: "5px 9px",
  color: "var(--ink-3)", border: 0, borderLeft: "1px solid var(--line)",
} as const;

function loadHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

interface DayGroup {
  key: string;
  /** The event whose day label represents the group — needed because an all-day
   *  event's label must be read in UTC and a timed one's locally. */
  head: PublicCalendarEventDTO;
  events: PublicCalendarEventDTO[];
}

/** Group events into day buckets. Keys come from `eventDayKey`, which reads
 *  all-day events in UTC so they don't slide to the previous day. Sorts
 *  defensively so grouping is correct regardless of server ordering. */
function groupByDay(events: PublicCalendarEventDTO[]): DayGroup[] {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;
  for (const e of sorted) {
    const key = eventDayKey(e);
    if (!current || current.key !== key) {
      current = { key, head: e, events: [] };
      groups.push(current);
    }
    current.events.push(e);
  }
  return groups;
}

function timeOf(e: PublicCalendarEventDTO, locale: string, t: ReturnType<typeof useI18n>["t"]): string {
  return e.allDay ? t("allDay") : new Date(e.start).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

function EventRow({ e, locale, onOpen }: { e: PublicCalendarEventDTO; locale: string; onOpen: () => void }) {
  const { t } = useI18n();
  const showTime = e.allDay ? showsAllDayLabel(e) : true;
  const showTitle = showsTitle(e);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ display: "flex", gap: 9, alignItems: "flex-start", border: "1px solid var(--line)", borderRadius: 10, background: "var(--paper)", padding: "10px 12px", textAlign: "left", font: "inherit", cursor: "pointer", minWidth: 0 }}
    >
      <span style={{ width: 4, alignSelf: "stretch", borderRadius: 4, background: e.source.color, flex: "0 0 auto", minHeight: 18 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        {showTime && <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-2)" }}>{timeOf(e, locale, t)}</div>}
        {showTitle && <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.3, marginTop: showTime ? 1 : 0 }}>{e.title}</div>}
        {showsDescription(e) && (
          <div style={{ fontSize: 13, lineHeight: 1.45, color: "var(--ink-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 3, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 3, overflow: "hidden" }}>{htmlToText(e.description!)}</div>
        )}
        <div className="sd-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 2 }}>
          {e.location && <span className="sd-meta">{e.location}</span>}
          <span className="sd-meta" style={{ color: e.source.color, fontWeight: 600 }}>{e.source.name}</span>
          {/* Visible without opening the event, so someone scanning the agenda
              can see where help is wanted. */}
          {e.volunteerSlug && (
            <span className="sd-meta" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--orange-700, #a06a00)", fontWeight: 700 }}>
              <Icon name="members" size={12} stroke={2} />
              {t("volunteersNeeded")}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/** Per-calendar controls: a show/hide toggle (≥2 calendars) and an ICS link.
 *  Every calendar has one — a calendar authored here publishes /ics/:id.ics, and
 *  an imported feed is served back from our own mirror of it rather than by
 *  handing out the admin's upstream URL. Either way the link is on this API's
 *  origin; see PublicCalendarFeedDTO. */
function FilterBar({ feeds, hidden, onToggle }: { feeds: PublicCalendarFeedDTO[]; hidden: Set<string>; onToggle: (id: string) => void }) {
  const { t } = useI18n();
  const [subscribing, setSubscribing] = useState<PublicCalendarFeedDTO | null>(null);
  if (feeds.length === 0) return null;
  const canFilter = feeds.length >= 2;
  return (
    <div>
      <SectLabel>{t("calendars")}</SectLabel>
      <div className="sd-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 9 }}>
        {feeds.map((f) => {
          const on = !hidden.has(f.id);
          const pad = { display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", fontSize: 11.5, fontWeight: 600 } as const;
          return (
            <div
              key={f.id}
              className="sd-row"
              style={{ gap: 0, border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden", background: "var(--paper)", opacity: canFilter && !on ? 0.55 : 1 }}
            >
              {canFilter ? (
                <button type="button" onClick={() => onToggle(f.id)} aria-pressed={on} style={{ ...pad, border: 0, background: "transparent", font: "inherit", cursor: "pointer", color: on ? "var(--ink)" : "var(--ink-3)" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: on ? f.color : "var(--line-2)", flex: "0 0 auto" }} />
                  {f.name}
                  <Icon name={on ? "eye" : "minus"} size={12} stroke={2} style={{ opacity: 0.6 }} />
                </button>
              ) : (
                <span style={pad}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: f.color, flex: "0 0 auto" }} />
                  {f.name}
                </span>
              )}
              {/* Subscribe sits before download deliberately: keeping up with
                  the school is what a family actually wants, and a downloaded
                  .ics is a snapshot that silently goes stale. */}
              <button
                type="button"
                onClick={() => setSubscribing(f)}
                title={t("subscribeIcs", { name: f.name })}
                aria-label={t("subscribeIcs", { name: f.name })}
                style={{ ...feedActionStyle, background: "transparent", font: "inherit", cursor: "pointer" }}
              >
                <Icon name="plus" size={14} />
              </button>
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                title={t("downloadIcs", { name: f.name })}
                aria-label={t("downloadIcs", { name: f.name })}
                style={feedActionStyle}
              >
                <Icon name="download" size={14} />
              </a>
            </div>
          );
        })}
      </div>
      {subscribing && (
        <SubscribeSheet
          name={subscribing.name}
          url={subscribing.url}
          onClose={() => setSubscribing(null)}
        />
      )}
    </div>
  );
}

function googleMapsUrl(q: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function EventDetailSheet({ e, locale, onClose, onVolunteers }: {
  e: PublicCalendarEventDTO;
  locale: string;
  onClose: () => void;
  onVolunteers: (slug: string) => void;
}) {
  const { t } = useI18n();
  const start = new Date(e.start);
  const end = e.end ? new Date(e.end) : null;
  const dateStr = formatEventDay(e, locale, { weekday: "long", month: "long", day: "numeric" });
  const showTime = e.allDay ? showsAllDayLabel(e) : true;
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
      {showsTitle(e) && <h2 className="sd-h2" style={{ marginBottom: 10 }}>{e.title}</h2>}
      <div className="sd-row" style={{ gap: 9, marginBottom: e.location ? 8 : 14 }}>
        <Icon name="calendar" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
        <div style={{ fontSize: 14 }}>{dateStr}{showTime && <span style={{ color: "var(--ink-3)" }}> · {timeStr}</span>}</div>
      </div>
      {e.location && (
        <div className="sd-row" style={{ gap: 9, marginBottom: 14 }}>
          <Icon name="pin" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
          <a href={googleMapsUrl(e.location)} target="_blank" rel="noopener noreferrer" className="sd-link" style={{ fontSize: 14 }}>{e.location}</a>
        </div>
      )}
      {showsDescription(e) && (
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", borderTop: "1px solid var(--line)", paddingTop: 12 }}>{htmlToText(e.description!)}</div>
      )}
      {/* Only present when this occurrence has a PUBLISHED volunteer sheet — the
          server joins it in, so a draft never surfaces here. The slug is an
          opaque public handle, not the durable (seriesId, recurrenceId) pair;
          see PublicCalendarEventDTO. */}
      {e.volunteerSlug && (
        <Btn block icon="members" style={{ marginTop: 16 }} onClick={() => onVolunteers(e.volunteerSlug!)}>
          {t("volunteersNeeded")}
        </Btn>
      )}
      <Btn block kind="secondary" style={{ marginTop: e.volunteerSlug ? 8 : 16 }} onClick={onClose}>{t("done")}</Btn>
    </SheetOver>
  );
}

export function Calendar() {
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  // Only for the sign-in affordance — the agenda itself renders identically
  // whether or not anyone is signed in.
  const { me, loading } = useSession();
  const navigate = useNavigate();
  const [events, setEvents] = useState<PublicCalendarEventDTO[] | null>(null);
  const [feeds, setFeeds] = useState<PublicCalendarFeedDTO[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(loadHidden);
  const [selected, setSelected] = useState<PublicCalendarEventDTO | null>(null);

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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16, alignItems: "start" }}>
        {groups.map((g) => (
          <div key={g.key}>
            <SectLabel>{formatEventDay(g.head, locale, { weekday: "long", month: "long", day: "numeric" })}</SectLabel>
            <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 8 }}>
              {g.events.map((e) => <EventRow key={e.id} e={e} locale={locale} onOpen={() => setSelected(e)} />)}
            </div>
          </div>
        ))}
      </div>
    </>
  );

  const sheet = selected && (
    <div className="sd">
      <EventDetailSheet
        e={selected}
        locale={locale}
        onClose={() => setSelected(null)}
        onVolunteers={(slug) => navigate(`/v/${slug}`)}
      />
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
      {/* Mobile has no account menu, so the header's right slot is the only
          way back in for a signed-out visitor reading the public agenda. */}
      <ScreenHeader
        title={t("calendarTitle")}
        left="calendar"
        right={
          !me && !loading ? (
            <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={() => navigate("/sign-in")}>
              {t("signInCta")}
            </button>
          ) : undefined
        }
      />
      <div className="sd-scroll">
        <div className="sd-body" style={{ gap: 16 }}>{body}</div>
      </div>
      {sheet}
    </AppShell>
  );
}

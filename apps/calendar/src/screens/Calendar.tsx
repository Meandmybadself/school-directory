// The calendar — an agenda list of upcoming events grouped by day, aggregated
// from imported ICS feeds and calendars authored here. Times render in the
// viewer's local timezone. Per-calendar show/hide is remembered in localStorage;
// tapping an event opens its own page at /e/:date/:slug (screens/Event.tsx),
// which is where the description, the .ics download, the signup sheet and the
// admin edit form all live — this screen is the index, not the detail view.
//
// Ported from the directory app's /calendar screen, which this replaces. The
// localStorage key is intentionally the same so a member's hidden-calendar
// choices are not reset by the move (each origin keeps its own copy, but the
// shape matches, and reusing the name keeps the two readable as one feature).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { eventPath, htmlToText, type PublicCalendarEventDTO, type PublicCalendarFeedDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel } from "../components/parts.js";
import { SubscribeSheet } from "../components/Sheets.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { useI18n } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import {
  showsDescription,
  showsAllDayLabel,
  showsTitle,
  eventDayKey,
  eventSearchText,
  formatEventDay,
  matchesSearch,
  searchTerms,
} from "../lib/calendar.js";

const HIDDEN_KEY = "sd_cal_hidden";

/** The agenda's day heading format. Shared by the day groups and the search
 *  index, so the two agree on what a given day is called — and matched by the
 *  event page, so a reader who taps through sees the same day name. */
const DAY_LABEL: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" };

/** What the agenda renders: the ANONYMOUS shape, for everyone.
 *
 *  There is no member re-read here any more. The one thing the members-only
 *  route added was `seriesId`, the durable handle behind an admin's edit form
 *  (invariant 8) — and that form now lives on the event's own page, which asks
 *  for it there. So this screen has no reason to want a field an anonymous
 *  reader can't have, and being written entirely against PublicCalendarEventDTO
 *  is what keeps it that way.
 */

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
              {/* One action per chip. Downloading lives inside the sheet this
                  opens, rather than beside it: the two look alike but do
                  opposite things — one keeps up with the school, the other
                  takes a copy that silently goes stale — and a row of near
                  identical icons is where that difference gets lost. */}
              <button
                type="button"
                onClick={() => setSubscribing(f)}
                title={t("subscribeIcs", { name: f.name })}
                aria-label={t("subscribeIcs", { name: f.name })}
                style={{
                  display: "inline-flex", alignItems: "center", padding: "5px 9px",
                  color: "var(--ink-3)", border: 0, borderLeft: "1px solid var(--line)",
                  background: "transparent", font: "inherit", cursor: "pointer",
                }}
              >
                <Icon name="plus" size={14} />
              </button>
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

/** As-you-type search over the loaded agenda.
 *
 *  Not `type="search"`: WebKit draws its own clear button for that, which would
 *  sit next to ours. The clear button is explicit because the alternative on a
 *  phone is selecting the text by hand to get back to the full agenda. */
function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <div style={{ position: "relative" }}>
      <Icon name="search" size={17} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }} />
      <input
        className="sd-input"
        placeholder={t("searchEvents")}
        aria-label={t("searchEvents")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ paddingLeft: 38, paddingRight: value ? 38 : undefined }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("clearSearch")}
          style={{
            position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
            width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
            border: 0, borderRadius: 8, background: "transparent", color: "var(--ink-3)", cursor: "pointer",
          }}
        >
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}

export function Calendar() {
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  // The agenda renders identically whether or not anyone is signed in; the
  // session only drives the sign-in affordance in the mobile header.
  const { me, loading } = useSession();
  const navigate = useNavigate();
  const [events, setEvents] = useState<PublicCalendarEventDTO[] | null>(null);
  const [feeds, setFeeds] = useState<PublicCalendarFeedDTO[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(loadHidden);
  const [q, setQ] = useState("");

  // One read, the anonymous one, for everybody — no waiting on /me before the
  // agenda appears, which is what a link pasted into a text message needs.
  useEffect(() => {
    void api
      .calendarEvents({ limit: 200 })
      .then((r) => setEvents(r.events))
      .catch(() => setEvents((cur) => cur ?? []));
  }, []);

  useEffect(() => {
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

  // Search runs against a text index built once per agenda (and per locale, for
  // the day labels), so a keystroke only re-runs the substring test. The whole
  // window is already in memory — there is nothing to fetch and nothing to
  // debounce, which is what makes it feel instant.
  const indexed = useMemo(
    () =>
      (events ?? []).map((e) => ({
        e,
        // Both spellings of the day, so "September 25" and "9/25" both find it.
        hay: eventSearchText(
          e,
          `${formatEventDay(e, locale, DAY_LABEL)} ${formatEventDay(e, locale, { year: "numeric", month: "numeric", day: "numeric" })}`,
        ),
      })),
    [events, locale],
  );
  const terms = useMemo(() => searchTerms(q), [q]);

  // Show an event if any of its calendars is visible (it may be on several).
  const visible = useMemo(
    () =>
      indexed
        .filter(({ e }) => e.sourceIds.some((id) => !hidden.has(id)))
        .filter(({ hay }) => matchesSearch(hay, terms))
        .map(({ e }) => e),
    [indexed, hidden, terms],
  );
  const groups = groupByDay(visible);

  const body = (
    <>
      <SearchBar value={q} onChange={setQ} />
      <FilterBar feeds={feeds} hidden={hidden} onToggle={toggle} />
      {events === null && (
        <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "28px 16px" }}>…</div>
      )}
      {events && visible.length === 0 && (
        <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "28px 16px" }}>
          {terms.length > 0 ? t("noEventsMatch") : t("noEvents")}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16, alignItems: "start" }}>
        {groups.map((g) => (
          <div key={g.key}>
            <SectLabel>{formatEventDay(g.head, locale, DAY_LABEL)}</SectLabel>
            <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Out to the event's own URL rather than into a modal, so what a
                  reader is looking at is something they can share, bookmark or
                  reopen. The path is built from the event's content identity —
                  see @sd/shared's eventPath — in the READER'S timezone, which is
                  the same zone the day heading above was formatted in. */}
              {g.events.map((e) => (
                <EventRow key={e.id} e={e} locale={locale} onOpen={() => navigate(eventPath(e))} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );

  if (isDesktop) {
    return (
      <DesktopShell active="calendar" title={t("calendarTitle")}>
        <div style={{ maxWidth: 760, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>{body}</div>
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
        <div className="sd-body" style={{ gap: 16 }}>{body}<SiteFooter /></div>
      </div>
    </AppShell>
  );
}

// One event's own page — the dedicated URL at /e/:date/:slug.
//
// Ungated, like the agenda at `/` and the volunteer sheet at /v/:slug: an event
// link's whole job is to open from a text message. It reads
// /calendar-public/events/:date/:slug when signed out, and re-reads the
// members-only twin ONLY for a system admin, which is the one thing that adds —
// `seriesId`, the durable handle the edit form opens. Same two-step the agenda
// does, and for the same reason: a shared link must not wait on /me.
//
// The path is a CONTENT identity, not an id — see packages/shared/src/eventPath.ts
// for why an event can't be addressed any other way, and what that costs. The
// consequence to know here is that this page exists for an imported ICS event
// just as much as for one authored in this app; only the admin and volunteer
// affordances are managed-only, and both are absent by construction (an imported
// event has no `seriesId` and can carry no sheet).
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  eventPath,
  eventTitleSlug,
  htmlToText,
  type CalendarEventDTO,
  type PublicCalendarEventDTO,
  type VolunteerSheetDTO,
} from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Btn } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel } from "../components/parts.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { EditEventSheet } from "../components/EditEventSheet.js";
import { VolunteerPositions, type AnySheet } from "../components/VolunteerPositions.js";
import { useI18n } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { API_BASE, api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { rememberReturnPath } from "../lib/returnPath.js";
import { showsDescription, showsAllDayLabel, showsTitle, formatEventDay } from "../lib/calendar.js";

/** The day heading format, matching the agenda's so the page a reader opens is
 *  labelled the same way as the row they tapped. */
const DAY_LABEL: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" };

/** What this page renders. The public shape plus, for a system admin only,
 *  `seriesId` from the members-only re-read — exactly the widening the agenda
 *  allows itself, and no more. See api.memberCalendarEvent. */
type PageEvent = PublicCalendarEventDTO & Partial<Pick<CalendarEventDTO, "seriesId">>;

function googleMapsUrl(q: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** "4:00 – 8:00 PM", or the all-day label. */
function timeRange(e: PageEvent, locale: string, allDayLabel: string): string {
  if (e.allDay) return allDayLabel;
  const start = new Date(e.start).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const end = e.end ? new Date(e.end).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) : null;
  return end ? `${start} – ${end}` : start;
}

export function Event() {
  const { date = "", slug = "" } = useParams();
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const { me, loading: sessionLoading } = useSession();

  const [event, setEvent] = useState<PageEvent | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [sheet, setSheet] = useState<AnySheet | null>(null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const isAdmin = !!me?.user.isSystemAdmin;

  const loadEvent = useCallback(async () => {
    try {
      const r = isAdmin ? await api.memberCalendarEvent(date, slug) : await api.calendarEvent(date, slug);
      setEvent(r.event);
      setState("ready");
    } catch {
      // Keep whatever is on screen if the admin re-read fails: that copy is the
      // perfectly good public one, only missing the edit handle.
      setState((cur) => (cur === "ready" ? cur : "missing"));
    }
  }, [date, slug, isAdmin]);

  useEffect(() => {
    void loadEvent();
  }, [loadEvent]);

  // The signup sheet, once the event says there is one. Two endpoints, picked by
  // whether there's a session — counts for everyone, names for members. The
  // session has to have RESOLVED first, or a signed-in reader gets the nameless
  // copy; see components/VolunteerPositions.tsx.
  const volunteerSlug = event?.volunteerSlug ?? null;
  const loadSheet = useCallback(async () => {
    if (!volunteerSlug || sessionLoading) return;
    try {
      const r = me ? await api.volunteerSheet(volunteerSlug) : await api.publicVolunteerSheet(volunteerSlug);
      setSheet(r.sheet);
    } catch {
      // A sheet unpublished between the agenda being read and this page opening
      // just means no signup block; the event itself is still worth showing.
      setSheet(null);
    }
  }, [volunteerSlug, me, sessionLoading]);

  useEffect(() => {
    void loadSheet();
  }, [loadSheet]);

  const goSignIn = () => {
    // Remember this page so the magic link lands back here — the link itself can
    // only carry an origin. See lib/returnPath.ts.
    rememberReturnPath(`/e/${date}/${slug}`);
    navigate("/sign-in");
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the address bar still has the link */
    }
  };

  const body = state === "loading" ? (
    <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "28px 16px" }}>…</div>
  ) : state === "missing" || !event ? (
    <div className="sd-card sd-card-pad" style={{ textAlign: "center", padding: "28px 16px" }}>
      <div className="sd-h2" style={{ marginBottom: 6 }}>{t("eventNotFound")}</div>
      <div className="sd-meta">{t("eventNotFoundBody")}</div>
      <Btn kind="secondary" style={{ marginTop: 14 }} onClick={() => navigate("/")}>{t("calendarTitle")}</Btn>
    </div>
  ) : (
    <>
      <div className="sd-card sd-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="sd-row" style={{ gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: event.source.color, flex: "0 0 auto" }} />
          <span className="sd-meta" style={{ color: event.source.color, fontWeight: 700 }}>{event.source.name}</span>
        </div>
        {showsTitle(event) && <h1 className="sd-h2" style={{ margin: 0 }}>{event.title}</h1>}
        <div className="sd-row" style={{ gap: 9 }}>
          <Icon name="calendar" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
          <div style={{ fontSize: 14 }}>
            {formatEventDay(event, locale, DAY_LABEL)}
            {(!event.allDay || showsAllDayLabel(event)) && (
              <span style={{ color: "var(--ink-3)" }}> · {timeRange(event, locale, t("allDay"))}</span>
            )}
          </div>
        </div>
        {event.location && (
          <div className="sd-row" style={{ gap: 9 }}>
            <Icon name="pin" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
            <a href={googleMapsUrl(event.location)} target="_blank" rel="noopener noreferrer" className="sd-link" style={{ fontSize: 14 }}>
              {event.location}
            </a>
          </div>
        )}
        {showsDescription(event) && (
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            {htmlToText(event.description!)}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* A COPY of this one occurrence, not a subscription — hence the same
            caveat the per-calendar download carries. Someone who wants the
            school year to keep itself up to date subscribes to the calendar
            instead, from the agenda's filter bar. A plain link rather than a
            fetch: handing the browser a text/calendar URL is what makes the
            phone offer to add it. */}
        <a
          className="sd-btn sd-btn-secondary"
          href={`${API_BASE}/ics/event/${encodeURIComponent(date)}/${encodeURIComponent(slug)}.ics`}
        >
          <Icon name="download" size={16} />
          {t("addToCalendar")}
        </a>
        <div className="sd-meta" style={{ lineHeight: 1.45 }}>{t("downloadIcsNote")}</div>
        <Btn kind="secondary" icon="link" onClick={() => void copyLink()}>
          {copied ? t("subscribeCopied") : t("subscribeCopy")}
        </Btn>
        {/* Admin-only, and only for an event authored here — an imported ICS
            event has no series in this app to edit. English rather than
            translated, like the rest of the operator tooling. */}
        {isAdmin && event.seriesId && (
          <Btn kind="secondary" icon="pencil" onClick={() => setEditing(true)}>Edit event</Btn>
        )}
      </div>

      {/* Present only when this occurrence has a PUBLISHED sheet — the server
          joins it in, so a draft never surfaces here. Counts for everyone, names
          for members; the split is enforced by which endpoint loadSheet asked. */}
      {sheet && (
        <div>
          <SectLabel>{t("volunteersNeeded")}</SectLabel>
          {sheet.intro && (
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 9 }}>
              {sheet.intro}
            </div>
          )}
          {sheet.closed && (
            <div className="sd-row" style={{ gap: 7, color: "var(--ink-3)", marginTop: 9 }}>
              <Icon name="lock" size={15} style={{ flex: "0 0 auto" }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t("volunteerSignupsClosed")}</span>
            </div>
          )}
          <VolunteerPositions
            sheet={sheet}
            onSheet={(s: VolunteerSheetDTO) => setSheet(s)}
            onReload={() => void loadSheet()}
            onSignIn={goSignIn}
          />
        </div>
      )}
    </>
  );

  const editSheet = editing && event?.seriesId && (
    <EditEventSheet
      seriesId={event.seriesId}
      onClose={() => setEditing(false)}
      onSaved={(saved) => {
        setEditing(false);
        // Saving re-expands the series into fresh calendar_event rows, AND may
        // have moved this page: the path is a content identity (title + day), so
        // a retitle or a date change makes the URL in the address bar address
        // nothing. Go to where the event now lives rather than re-reading a path
        // that would 404.
        //
        // For a repeating series the reader is on ONE of its dates and the edit
        // form can't move a single occurrence, so the day they are looking at is
        // still the right one and only the slug can have changed. A one-off
        // event is simply wherever it now starts.
        const next = saved.recurrence
          ? `/e/${date}/${encodeURIComponent(eventTitleSlug(saved.title))}`
          : eventPath(saved);
        if (next === `${window.location.pathname}`) void loadEvent();
        else navigate(next, { replace: true });
      }}
    />
  );

  if (isDesktop) {
    return (
      <DesktopShell active="calendar" title={t("eventTitle")}>
        <div style={{ maxWidth: 760, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>{body}</div>
        {editSheet}
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="calendar" />}>
      <ScreenHeader
        title={t("eventTitle")}
        onLeft={() => navigate("/")}
        right={
          !me && !sessionLoading ? (
            <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={goSignIn}>{t("signInCta")}</button>
          ) : undefined
        }
      />
      <div className="sd-scroll">
        <div className="sd-body" style={{ gap: 16 }}>{body}<SiteFooter /></div>
      </div>
      {editSheet}
    </AppShell>
  );
}

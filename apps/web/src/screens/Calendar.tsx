// Shared calendar — an agenda list of upcoming events aggregated from the
// admin-configured ICS feeds, grouped by day. Times render in the viewer's
// local timezone (effectively the school's, for a local community).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CalendarEventDTO } from "@sd/shared";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel } from "../components/parts.js";
import { useI18n } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api } from "../lib/api.js";

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

function EventRow({ e, locale }: { e: CalendarEventDTO; locale: string }) {
  const { t } = useI18n();
  const time = e.allDay
    ? t("allDay")
    : new Date(e.start).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  return (
    <div className="sd-crow" style={{ alignItems: "flex-start" }}>
      <div style={{ width: 64, flex: "0 0 auto", fontSize: 12.5, fontWeight: 700, color: "var(--ink-2)", paddingTop: 1 }}>{time}</div>
      <span style={{ width: 4, alignSelf: "stretch", borderRadius: 4, background: e.source.color, flex: "0 0 auto", minHeight: 18 }} />
      <div className="sd-cmain" style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.3 }}>{e.title}</div>
        <div className="sd-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 2 }}>
          {e.location && <span className="sd-meta">{e.location}</span>}
          <span className="sd-meta" style={{ color: e.source.color, fontWeight: 600 }}>{e.source.name}</span>
        </div>
      </div>
    </div>
  );
}

export function Calendar() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [events, setEvents] = useState<CalendarEventDTO[] | null>(null);

  useEffect(() => {
    void api.calendarEvents({ limit: 200 }).then((r) => setEvents(r.events)).catch(() => setEvents([]));
  }, []);

  const groups = groupByDay(events ?? []);
  const body = (
    <>
      {events === null && (
        <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "28px 16px" }}>…</div>
      )}
      {events && events.length === 0 && (
        <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "28px 16px" }}>{t("noEvents")}</div>
      )}
      {groups.map((g) => (
        <div key={g.key}>
          <SectLabel>{g.date.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" })}</SectLabel>
          <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4, display: "flex", flexDirection: "column" }}>
            {g.events.map((e) => <EventRow key={e.id} e={e} locale={locale} />)}
          </div>
        </div>
      ))}
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
      <ScreenHeader title={t("calendarTitle")} onLeft={() => navigate("/")} />
      <div className="sd-scroll">
        <div className="sd-body" style={{ gap: 16 }}>{body}</div>
      </div>
    </AppShell>
  );
}

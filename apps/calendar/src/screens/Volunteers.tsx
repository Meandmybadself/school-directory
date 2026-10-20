// The volunteers index — every upcoming event that still needs help, in one
// place, so a family looking for a way to pitch in doesn't have to scan the
// whole agenda for the orange "volunteers needed" chips.
//
// Ungated like the agenda and the event page: it is assembled entirely from the
// two ANONYMOUS reads that already exist — /calendar-public/events (which names
// a published sheet by `volunteerSlug`, invariant 12) and
// /volunteers-public/sheets/:slug (positions and filled COUNTS, never names —
// invariant 13). No new API surface and no member re-read: counts are the whole
// story this screen tells, for members and strangers alike, and the event page
// is where names, claims and the sign-in affordance live.
//
// The sheet reads fan out one request per listed sheet. That is deliberate: at
// a school's scale a window holds a handful of open sheets, and reusing the
// public per-sheet route means nothing new had to clear invariant 13's bar.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  eventPath,
  formatClock,
  type PublicCalendarEventDTO,
  type PublicVolunteerSheetDTO,
} from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader } from "../components/parts.js";
import { Tag } from "../components/atoms.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { useI18n } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { SCHOOL_TIME_ZONE } from "../lib/timezone.js";
import { formatEventDay } from "../lib/calendar.js";

/** Same shape as the agenda's day headings, so a reader who taps through sees
 *  the same day name on the event page. */
const DAY_LABEL: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" };

interface NeedyRow {
  e: PublicCalendarEventDTO;
  sheet: PublicVolunteerSheetDTO;
  /** Open spots summed across positions — what makes the row a row. */
  left: number;
}

/** Events in the public window whose sheet still accepts claims and still has
 *  an open spot. A sheet that 404s (unpublished since the agenda was read, or a
 *  transient failure) drops its row rather than failing the list — this screen
 *  is an index, and the event page is the authority. */
async function loadNeedy(): Promise<NeedyRow[]> {
  const { events } = await api.calendarEvents({ limit: 200 });
  // One row per sheet. A slug can only repeat if syndication duplicated its
  // occurrence, in which case the rows describe the same sheet — keep the first.
  const bySlug = new Map<string, PublicCalendarEventDTO>();
  for (const e of events) {
    if (e.volunteerSlug && !bySlug.has(e.volunteerSlug)) bySlug.set(e.volunteerSlug, e);
  }
  const rows = await Promise.all(
    [...bySlug.entries()].map(async ([slug, e]): Promise<NeedyRow | null> => {
      try {
        const { sheet } = await api.publicVolunteerSheet(slug);
        const left = sheet.positions.reduce((n, p) => n + Math.max(0, p.slots - p.filled), 0);
        return { e, sheet, left };
      } catch {
        return null;
      }
    }),
  );
  return rows
    .filter((r): r is NeedyRow => r !== null && !r.sheet.closed && r.left > 0)
    .sort((a, b) => a.e.start.localeCompare(b.e.start));
}

function EventNeedRow({ r, locale, onOpen }: { r: NeedyRow; locale: string; onOpen: () => void }) {
  const { t } = useI18n();
  const { e, sheet } = r;
  const open = sheet.positions.filter((p) => p.filled < p.slots);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ display: "flex", gap: 9, alignItems: "flex-start", border: "1px solid var(--line)", borderRadius: 10, background: "var(--paper)", padding: "10px 12px", textAlign: "left", font: "inherit", cursor: "pointer", minWidth: 0 }}
    >
      <span style={{ width: 4, alignSelf: "stretch", borderRadius: 4, background: e.source.color, flex: "0 0 auto", minHeight: 18 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-2)" }}>
          {formatEventDay(e, locale, DAY_LABEL)}
          {!e.allDay && <> · {formatClock(e.start, locale, SCHOOL_TIME_ZONE)}</>}
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.3, marginTop: 1 }}>{e.title}</div>
        <div className="sd-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 2 }}>
          {e.location && <span className="sd-meta">{e.location}</span>}
          <span className="sd-meta" style={{ color: e.source.color, fontWeight: 600 }}>{e.source.name}</span>
        </div>
        {/* The jobs that still want someone — counts only, which is the entire
            anonymous story about a position (invariant 13). */}
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
          {open.map((p) => (
            <div key={p.id} className="sd-row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0 }}>{p.title}</span>
              <Tag tone="orange">{t("volunteerSpotsLeft", { left: p.slots - p.filled })}</Tag>
            </div>
          ))}
        </div>
      </div>
      <Icon name="chevright" size={16} stroke={2} style={{ color: "var(--ink-3)", flex: "0 0 auto", alignSelf: "center" }} />
    </button>
  );
}

export function Volunteers() {
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  // Like the agenda: the session only drives the sign-in affordance in the
  // mobile header — the list itself renders identically for everyone.
  const { me, loading } = useSession();
  const navigate = useNavigate();
  const [rows, setRows] = useState<NeedyRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadNeedy()
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const body = (
    <>
      <p className="sd-lead" style={{ fontSize: 13.5, margin: 0 }}>{t("volunteersPageLead")}</p>
      {rows === null && (
        <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "28px 16px" }}>…</div>
      )}
      {rows && rows.length === 0 && (
        <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "28px 16px" }}>
          {t("volunteersPageNone")}
        </div>
      )}
      {rows && rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Out to the event's own page, like the agenda: that is the one
              rendering of an event, and where the sheet and the claim flow live. */}
          {rows.map((r) => (
            <EventNeedRow key={r.sheet.slug} r={r} locale={locale} onOpen={() => navigate(eventPath(r.e, SCHOOL_TIME_ZONE))} />
          ))}
        </div>
      )}
    </>
  );

  if (isDesktop) {
    return (
      <DesktopShell active="volunteers" title={t("volunteersNeeded")}>
        <div style={{ maxWidth: 560, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>{body}</div>
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="volunteers" />}>
      <ScreenHeader
        title={t("volunteersNeeded")}
        left="members"
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

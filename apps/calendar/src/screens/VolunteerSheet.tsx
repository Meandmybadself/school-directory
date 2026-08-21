// One event's volunteer sheet — the public page at /v/:slug.
//
// Ungated, like the agenda at `/`, and it reads ONE OF TWO endpoints depending
// on whether there's a session:
//
//   signed out → /volunteers-public/sheets/:slug — positions and filled counts
//   signed in  → /volunteers/sheets/:slug        — the same plus who took each spot
//
// That split is the product decision: a volunteer's name is member-only
// (CLAUDE.md invariant 1) while the sheet itself has to open from a text message
// with no account. It is enforced on the server; this screen simply asks for
// what it is entitled to.
//
// The positions and the claim flow live in components/VolunteerPositions.tsx,
// because the event page at /e/:date/:slug renders the same sheet inline. This
// page is the sheet's OWN url and predates that one; it stays because links to
// it are already circulating, and because a sheet is a thing you send someone
// directly ("we still need help Saturday") rather than by way of the event.
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { eventPath } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Btn } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel } from "../components/parts.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { VolunteerPositions, type AnySheet } from "../components/VolunteerPositions.js";
import { useI18n } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { rememberReturnPath } from "../lib/returnPath.js";

function formatDay(iso: string, allDay: boolean, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(allDay ? { timeZone: "UTC" } : {}),
  });
}

function formatTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

export function VolunteerSheet() {
  const { slug = "" } = useParams();
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const { me, loading: sessionLoading } = useSession();

  const [sheet, setSheet] = useState<AnySheet | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  const load = useCallback(async () => {
    // Wait for the session to resolve: asking the member endpoint before we know
    // there's a cookie would 401 and fall back to a nameless page for someone
    // who is in fact signed in.
    if (sessionLoading) return;
    try {
      const r = me ? await api.volunteerSheet(slug) : await api.publicVolunteerSheet(slug);
      setSheet(r.sheet);
      setState("ready");
    } catch {
      setState("missing");
    }
  }, [slug, me, sessionLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  const goSignIn = () => {
    // Remember this page so the magic link lands back here — the link itself can
    // only carry an origin. See lib/returnPath.ts.
    rememberReturnPath(`/v/${slug}`);
    navigate("/sign-in");
  };

  const closed = sheet?.closed ?? false;

  const body = state === "loading" || sessionLoading ? (
    <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "28px 16px" }}>…</div>
  ) : state === "missing" || !sheet ? (
    <div className="sd-card sd-card-pad" style={{ textAlign: "center", padding: "28px 16px" }}>
      <div className="sd-h2" style={{ marginBottom: 6 }}>{t("volunteerNotFound")}</div>
      <div className="sd-meta">{t("volunteerNotFoundBody")}</div>
      <Btn kind="secondary" style={{ marginTop: 14 }} onClick={() => navigate("/")}>{t("calendarTitle")}</Btn>
    </div>
  ) : (
    <>
      <div className="sd-card sd-card-pad" style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <h1 className="sd-h2" style={{ margin: 0 }}>{sheet.event.title}</h1>
        <div className="sd-row" style={{ gap: 9 }}>
          <Icon name="calendar" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
          <span style={{ fontSize: 14 }}>
            {formatDay(sheet.event.start, sheet.event.allDay, locale)}
            {!sheet.event.allDay && <span style={{ color: "var(--ink-3)" }}> · {formatTime(sheet.event.start, locale)}</span>}
          </span>
        </div>
        {sheet.event.location && (
          <div className="sd-row" style={{ gap: 9 }}>
            <Icon name="pin" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
            <span style={{ fontSize: 14 }}>{sheet.event.location}</span>
          </div>
        )}
        {sheet.intro && (
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            {sheet.intro}
          </div>
        )}
        {closed && (
          <div className="sd-row" style={{ gap: 7, color: "var(--ink-3)" }}>
            <Icon name="lock" size={15} style={{ flex: "0 0 auto" }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t("volunteerSignupsClosed")}</span>
          </div>
        )}
        {/* Out to the event's own page, which is the fuller story — the
            description, the calendar it's on, and a way to add it to yours.
            Built from the same content identity every event link is; see
            @sd/shared's eventPath. */}
        <Btn kind="secondary" icon="calendar" onClick={() => navigate(eventPath(sheet.event))}>
          {t("eventDetails")}
        </Btn>
      </div>

      <div>
        <SectLabel>{t("volunteersNeeded")}</SectLabel>
        <VolunteerPositions
          sheet={sheet}
          onSheet={setSheet}
          onReload={() => void load()}
          onSignIn={goSignIn}
        />
      </div>
    </>
  );

  if (isDesktop) {
    return (
      <DesktopShell active="calendar" title={t("volunteersTitle")}>
        <div style={{ maxWidth: 760, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>{body}</div>
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="calendar" />}>
      <ScreenHeader
        title={t("volunteersTitle")}
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
    </AppShell>
  );
}

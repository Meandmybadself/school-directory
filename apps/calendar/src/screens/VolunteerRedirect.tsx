// A volunteer sheet's own URL — an ENTRANCE to the event page, not a page.
//
// /v/:slug and /e/:date/:slug had grown into two renderings of one thing: the
// same title, day, location, intro and the same positions block, differing only
// in that the event page also carried the description, the calendar the event
// sits on, a link to copy and the admin affordances. The sheet's page is the one
// that lost the overlap — a sheet is part of an event, not a peer of it.
//
// The URL stays forever regardless, for two reasons. It is what is already
// circulating in text messages and on paper. And it is the only DURABLE handle
// on a sheet: an event page's path is a content identity that a retitle or a
// date change invalidates (packages/shared/src/eventPath.ts), while a slug is
// minted once and never moves.
//
// So this resolves the sheet, then forwards to the event carrying the slug in
// `?sheet=` — which is what lets the destination render a sheet the event alone
// would not surface: a DRAFT (the server withholds `volunteerSlug` until it is
// published) or one whose occurrence no longer resolves, because the series was
// edited or the date has aged out of `calendar_event`. See screens/Event.tsx.
//
// It reads the same two endpoints the sheet page always did — the anonymous one
// when signed out, the member one when signed in. That is not a leftover: the
// member endpoint is what resolves a draft for an admin, and a 404 HERE is what
// tells a reader their link is dead, rather than forwarding them to an event
// page that would have to explain a sheet it knows nothing about.
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { eventPath } from "@sd/shared";
import { Btn } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader } from "../components/parts.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { useI18n } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";

export function VolunteerRedirect() {
  const { slug = "" } = useParams();
  const { t } = useI18n();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const { me, loading: sessionLoading } = useSession();

  const [state, setState] = useState<"loading" | "missing">("loading");

  useEffect(() => {
    // Wait for the session to resolve: asking the member endpoint before we know
    // there's a cookie would 401, and an admin opening a draft's link would be
    // told it doesn't exist.
    if (sessionLoading) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = me ? await api.volunteerSheet(slug) : await api.publicVolunteerSheet(slug);
        if (cancelled) return;
        // `replace` so Back returns to wherever the link was opened from rather
        // than bouncing through here again.
        navigate(`${eventPath(r.sheet.event)}?sheet=${encodeURIComponent(slug)}`, { replace: true });
      } catch {
        if (!cancelled) setState("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, me, sessionLoading, navigate]);

  const body = state === "loading" || sessionLoading ? (
    <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "28px 16px" }}>…</div>
  ) : (
    <div className="sd-card sd-card-pad" style={{ textAlign: "center", padding: "28px 16px" }}>
      <div className="sd-h2" style={{ marginBottom: 6 }}>{t("volunteerNotFound")}</div>
      <div className="sd-meta">{t("volunteerNotFoundBody")}</div>
      <Btn kind="secondary" style={{ marginTop: 14 }} onClick={() => navigate("/")}>{t("calendarTitle")}</Btn>
    </div>
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
      <ScreenHeader title={t("volunteersTitle")} onLeft={() => navigate("/")} />
      <div className="sd-scroll">
        <div className="sd-body" style={{ gap: 16 }}>{body}<SiteFooter /></div>
      </div>
    </AppShell>
  );
}

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
// what it is entitled to. The narrower PublicVolunteerSheetDTO in the signed-out
// branch is what stops a future edit from rendering names that aren't there.
//
// Writes always require a session — there is no anonymous claim path — so the
// signed-out branch's only affordance is "sign in to volunteer".
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  ControllablePersonDTO,
  PublicVolunteerSheetDTO,
  VolunteerPositionDTO,
  VolunteerSheetDTO,
} from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Avatar, Btn, Tag } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel, Field, SheetOver } from "../components/parts.js";
import { useI18n, type I18nT } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, ApiError } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { rememberReturnPath } from "../lib/returnPath.js";

/** What both branches render from. The public shape is the smaller of the two,
 *  so it is the common denominator: a member sheet is this plus `signups` on
 *  each position, which the UI treats as optional throughout. */
type AnySheet = PublicVolunteerSheetDTO | VolunteerSheetDTO;

/** Signups exist only on the member shape. Reading them through this helper
 *  rather than a cast keeps "there are no names here" a type-level fact on the
 *  anonymous branch instead of an empty array someone might later fill. */
function signupsOf(p: VolunteerPositionDTO | AnySheet["positions"][number]): VolunteerPositionDTO["signups"] {
  return "signups" in p ? p.signups : [];
}

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

/** "5:00 – 7:00 PM" for a position's optional shift window. */
function shiftLabel(startsAt: string | null, endsAt: string | null, locale: string): string | null {
  if (!startsAt && !endsAt) return null;
  if (startsAt && endsAt) return `${formatTime(startsAt, locale)} – ${formatTime(endsAt, locale)}`;
  return formatTime((startsAt ?? endsAt)!, locale);
}

/** Filled/needed, as a bar plus a count. Both audiences see this; it is the
 *  entire signed-out story about a position. */
function Progress({ filled, slots, t }: { filled: number; slots: number; t: I18nT }) {
  const pct = slots > 0 ? Math.min(100, Math.round((filled / slots) * 100)) : 0;
  const full = filled >= slots;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <div className="sd-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: full ? "var(--ink-3)" : "var(--ink-2)" }}>
          {t("volunteerSpotsFilled", { filled, slots })}
        </span>
        {full ? (
          <Tag tone="line" icon="check">{t("volunteerFull")}</Tag>
        ) : (
          <Tag tone="orange">{t("volunteerSpotsLeft", { left: slots - filled })}</Tag>
        )}
      </div>
      <div style={{ height: 6, borderRadius: 4, background: "var(--line-2)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: full ? "var(--blue)" : "var(--orange)" }} />
      </div>
    </div>
  );
}

function PositionCard({
  position,
  locale,
  canWrite,
  busy,
  onTake,
  onWithdraw,
  onSignIn,
}: {
  position: AnySheet["positions"][number];
  locale: string;
  /** False when signed out, or when the sheet is closed. */
  canWrite: boolean;
  busy: boolean;
  onTake: () => void;
  onWithdraw: (signupId: string) => void;
  onSignIn: () => void;
}) {
  const { t } = useI18n();
  const signups = signupsOf(position);
  const full = position.filled >= position.slots;
  const mine = signups.find((s) => s.isYou);
  const shift = shiftLabel(position.startsAt, position.endsAt, locale);

  return (
    <div className="sd-card sd-card-pad" style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{position.title}</div>
        {shift && (
          <div className="sd-row" style={{ gap: 6, marginTop: 4 }}>
            <Icon name="calendar" size={14} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
            <span className="sd-meta">{shift}</span>
          </div>
        )}
        {position.description && (
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 6 }}>
            {position.description}
          </div>
        )}
      </div>

      <Progress filled={position.filled} slots={position.slots} t={t} />

      {/* The roster. Absent by construction when signed out — the anonymous
          endpoint never sends it — so the prompt below is the honest thing to
          show rather than an empty list that reads as "nobody signed up". */}
      {signups.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          {signups.map((s) => (
            <div key={s.id} className="sd-row" style={{ gap: 8, minWidth: 0 }}>
              <Avatar name={s.displayName} size={26} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.displayName}
                </div>
                {s.note && <div className="sd-meta" style={{ lineHeight: 1.4 }}>{s.note}</div>}
              </div>
              {s.isYou && canWrite && (
                <button
                  type="button"
                  onClick={() => onWithdraw(s.id)}
                  disabled={busy}
                  className="sd-btn sd-btn-ghost sd-btn-sm"
                  style={{ flex: "0 0 auto" }}
                >
                  {t("volunteerWithdraw")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canWrite ? (
        !mine && (
          <Btn block kind={full ? "secondary" : "primary"} icon="plus" disabled={busy || full} onClick={onTake}>
            {t("takeASpot")}
          </Btn>
        )
      ) : (
        <Btn block kind="secondary" icon="lock" onClick={onSignIn}>
          {t("signInToVolunteer")}
        </Btn>
      )}
    </div>
  );
}

/** Who is this spot for? Sourced from the Persons the signed-in User controls,
 *  which is the same list the directory's Person switcher uses — so a parent
 *  signs up a child by picking them, and nobody can sign up a stranger. */
function ClaimSheet({
  persons,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  persons: ControllablePersonDTO[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (personId: string, note: string) => void;
}) {
  const { t } = useI18n();
  const [personId, setPersonId] = useState(persons[0]?.id ?? "");
  const [note, setNote] = useState("");

  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 14 }}>{t("takeASpot")}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label={t("volunteerWhoFor")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {persons.map((p) => {
              const on = p.id === personId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPersonId(p.id)}
                  aria-pressed={on}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", textAlign: "left",
                    border: `1px solid ${on ? "var(--blue)" : "var(--line)"}`, borderRadius: 10,
                    background: on ? "var(--blue-50, #eef6fc)" : "var(--paper)", font: "inherit", cursor: "pointer",
                  }}
                >
                  <Avatar name={p.displayName} img={p.photoUrl} size={30} />
                  <span style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0 }}>{p.displayName}</span>
                  {on && <Icon name="check" size={17} style={{ color: "var(--blue)" }} />}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={t("volunteerNote")}>
          <input
            className="sd-input"
            value={note}
            maxLength={500}
            placeholder={t("volunteerNotePlaceholder")}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {error && <div className="sd-meta" style={{ color: "var(--danger, #b3261e)" }}>{error}</div>}

        <div className="sd-row" style={{ gap: 8 }}>
          <Btn block kind="secondary" onClick={onClose}>{t("cancel")}</Btn>
          <Btn block disabled={busy || !personId} onClick={() => onSubmit(personId, note)}>{t("takeASpot")}</Btn>
        </div>
      </div>
    </SheetOver>
  );
}

export function VolunteerSheet() {
  const { slug = "" } = useParams();
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const { me, loading: sessionLoading } = useSession();

  const [sheet, setSheet] = useState<AnySheet | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [claiming, setClaiming] = useState<string | null>(null); // position id
  const [busy, setBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

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

  const claim = async (positionId: string, personId: string, note: string) => {
    setBusy(true);
    setClaimError(null);
    try {
      const r = await api.claimVolunteerSpot(positionId, personId, note.trim() || null);
      setSheet(r.sheet);
      setClaiming(null);
    } catch (err) {
      // 409 carries which of the three ways it failed, so the message can say
      // what actually happened instead of "something went wrong".
      const reason = err instanceof ApiError && err.status === 409
        ? (err.body as { error?: string }).error
        : null;
      setClaimError(
        reason === "duplicate" ? t("volunteerAlready")
        : reason === "full" ? t("volunteerTookLastSpot")
        : reason === "closed" ? t("volunteerSignupsClosed")
        : t("volunteerError"),
      );
      if (reason === "full" || reason === "closed") void load(); // re-read the truth
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (signupId: string) => {
    setBusy(true);
    try {
      const r = await api.releaseVolunteerSpot(signupId);
      setSheet(r.sheet);
    } catch {
      void load();
    } finally {
      setBusy(false);
    }
  };

  const closed = sheet?.closed ?? false;
  const canWrite = !!me && !closed;
  const persons = me?.persons ?? [];

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
      </div>

      <div>
        <SectLabel>{t("volunteersNeeded")}</SectLabel>
        {sheet.positions.length === 0 ? (
          <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "22px 16px", marginTop: 9 }}>
            {t("volunteerNoPositions")}
          </div>
        ) : (
          <div style={{ marginTop: 9, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, alignItems: "start" }}>
            {sheet.positions.map((p) => (
              <PositionCard
                key={p.id}
                position={p}
                locale={locale}
                canWrite={canWrite}
                busy={busy}
                onTake={() => { setClaimError(null); setClaiming(p.id); }}
                onWithdraw={withdraw}
                onSignIn={goSignIn}
              />
            ))}
          </div>
        )}
        {/* Said once, under the list, rather than on every card. */}
        {!me && sheet.positions.length > 0 && (
          <div className="sd-meta" style={{ marginTop: 10, textAlign: "center" }}>{t("volunteerNamesMembersOnly")}</div>
        )}
      </div>
    </>
  );

  const claimSheet = claiming && (
    <div className="sd">
      <ClaimSheet
        persons={persons}
        busy={busy}
        error={claimError}
        onClose={() => setClaiming(null)}
        onSubmit={(personId, note) => void claim(claiming, personId, note)}
      />
    </div>
  );

  if (isDesktop) {
    return (
      <DesktopShell active="calendar" title={t("volunteersTitle")}>
        <div style={{ maxWidth: 760, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>{body}</div>
        {claimSheet}
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
        <div className="sd-body" style={{ gap: 16 }}>{body}</div>
      </div>
      {claimSheet}
    </AppShell>
  );
}

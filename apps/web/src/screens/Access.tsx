// The one screen a family sees while the directory is closed to them
// (migration 0029, invariant 32).
//
// It is the application AND the waiting room AND the answer to a decline,
// because those are three states of one thing and splitting them across screens
// would make the back button decide which sentence you get.
//
// The copy carries the weight here. A gate that says "no" to a parent who did
// nothing wrong is how a directory loses the families it exists for, so this
// says what is happening, why it is happening, what they can still do in the
// meantime — and, in the declined case, that they can fix it and ask again. The
// word "denied" appears nowhere.
//
// It shows the claim as three sentences rather than one disabled button,
// because "Ask for access" greyed out with no reason is the same dead end in a
// friendlier font. Each unmet condition links to the screen that fixes it.

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AccessClaimStatusDTO, ControllablePersonDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Btn, Tag } from "../components/atoms.js";
import { AppShell } from "../components/AppShell.js";
import { ScreenHeader, SectLabel } from "../components/parts.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { api } from "../lib/api.js";

/** One condition, with the way to satisfy it. A met one is a quiet check; an
 *  unmet one is a link, because telling someone what is missing without
 *  offering the door to it is half an answer. */
function Condition({
  met,
  label,
  to,
  action,
}: {
  met: boolean;
  label: string;
  to?: string;
  action?: () => void;
}) {
  const body = (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Icon
        name={met ? "check" : "plus"}
        size={16}
        style={{ color: met ? "var(--blue)" : "var(--ink-3)", flex: "none" }}
      />
      <span style={{ textDecoration: met ? "none" : "underline", color: met ? "var(--ink-2)" : "var(--blue-700)" }}>
        {label}
      </span>
    </span>
  );
  if (met) return <li style={{ listStyle: "none", padding: "6px 0" }}>{body}</li>;
  return (
    <li style={{ listStyle: "none", padding: "6px 0" }}>
      {to ? (
        <Link to={to} style={{ textDecoration: "none" }}>{body}</Link>
      ) : (
        <button type="button" onClick={action} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}>
          {body}
        </button>
      )}
    </li>
  );
}

export function Access() {
  const { t } = useI18n();
  const { me, refresh } = useSession();
  const [claim, setClaim] = useState<AccessClaimStatusDTO | null>(me?.accessClaim ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [placing, setPlacing] = useState<string | null>(null);

  const state = me?.directoryAccess ?? "incomplete";
  const students = (me?.persons ?? []).filter((p) => p.capabilities.includes("student"));

  useEffect(() => {
    setClaim(me?.accessClaim ?? null);
  }, [me]);

  // Only while the form is on screen: a pending or approved account has no use
  // for the room list, and this is the one route that serves it to them.
  useEffect(() => {
    if (state === "pending" || state === "approved") return;
    void api.classroomOptions().then((r) => setRooms(r.classrooms)).catch(() => setRooms([]));
  }, [state]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestDirectoryAccess(note.trim() || undefined);
      // The server re-derives completeness rather than trusting the button, so
      // a 400 here is reachable — a declined family who since deleted a child,
      // or whose classroom placement went away. Without this the promise
      // rejected unhandled, the spinner cleared and the screen said nothing.
      if (r.accessClaim) setClaim(r.accessClaim);
      await refresh();
    } catch {
      setError(t("accessSubmitFailed"));
    } finally {
      setBusy(false);
    }
  }, [note, refresh, t]);

  const place = useCallback(
    async (personId: string, groupId: string) => {
      if (!groupId) return;
      setPlacing(personId);
      try {
        await api.setClassroom(personId, groupId);
        await refresh();
      } finally {
        setPlacing(null);
      }
    },
    [refresh],
  );

  // ── Pending: nothing to do but wait, so nothing to fill in ────────────────
  if (state === "pending") {
    return (
      <AppShell>
        <div className="sd-scroll">
          <ScreenHeader title={t("accessPendingTitle")} />
          <div className="sd-card sd-card-pad" style={{ margin: "0 16px", lineHeight: 1.5 }}>
            <p style={{ margin: 0 }}>{t("accessPendingBody")}</p>
          </div>
          <div className="sd-meta" style={{ margin: "14px 16px", lineHeight: 1.5 }}>
            {t("accessMeanwhile")}
          </div>
        </div>
      </AppShell>
    );
  }

  // ── Incomplete and DECLINED share the form ────────────────────────────────
  //
  // They have to. `accessDeclinedBody` tells the family to fix what is wrong
  // and ask again, and a screen that says that over a lone button is a dead
  // end wearing a friendly sentence — the decline is almost always a wrong
  // room or a misspelled name, which is precisely what the form below edits.
  const declined = state === "declined";
  const complete = claim?.complete === true;
  // Whether the parent route is finished decides whether the staff alternative
  // is worth showing — a family who has named a placed child does not need to
  // be offered a second way in.
  const parentRouteDone = claim?.hasStudent === true && claim.studentPlaced === true;
  return (
    <AppShell>
      <div className="sd-scroll">
        <ScreenHeader title={declined ? t("accessDeclinedTitle") : t("accessFormTitle")} />
        <div className="sd-card sd-card-pad" style={{ margin: "0 16px", lineHeight: 1.5 }}>
          <p style={{ margin: 0 }}>{declined ? t("accessDeclinedBody") : t("accessFormLead")}</p>
        </div>

        <div style={{ margin: "16px 16px 0" }}>
          <ul style={{ margin: 0, padding: 0 }}>
            <Condition
              met={claim?.selfNamed === true}
              label={t("accessNeedName")}
              to={me?.persons[0] ? `/persons/${me.persons[0].id}/edit` : "/welcome"}
            />
            <Condition
              met={claim?.hasStudent === true}
              label={t("accessNeedStudent")}
              to="/persons/new"
            />
            <Condition met={claim?.studentPlaced === true} label={t("accessNeedClassroom")} />
          </ul>

          {/* The other route, and it has to be VISIBLE rather than inferred.
              A teacher, the office and the nurse have no child to name; the
              first version of this form left them with two conditions they
              could never satisfy and a button that never enabled. Shown
              whenever the parent route is unfinished, so somebody who has no
              child sees the way through on the same screen rather than
              guessing that a capability on their profile would do it. */}
          {!parentRouteDone && (
            <div style={{ marginTop: 14 }}>
              <SectLabel>{t("accessOrStaff")}</SectLabel>
              <ul style={{ margin: "4px 0 0", padding: 0 }}>
                <Condition
                  met={claim?.isStaff === true}
                  label={t("accessNeedStaff")}
                  to={me?.persons[0] ? `/persons/${me.persons[0].id}/edit` : "/welcome"}
                />
              </ul>
            </div>
          )}
        </div>

        {/* The classroom picker sits inline rather than behind a link: it is the
            one condition with no screen of its own for a pending account, since
            a classroom's own page is on the other side of this gate. */}
        {(declined || (claim?.hasStudent && !claim.studentPlaced)) && rooms.length > 0 && (
          <div style={{ margin: "8px 16px 0" }}>
            <SectLabel>{t("accessNeedClassroom")}</SectLabel>
            {students.map((s: ControllablePersonDTO) => (
              <label key={s.id} style={{ display: "block", marginTop: 10 }}>
                <span className="sd-meta">{s.displayName}</span>
                <select
                  className="sd-input"
                  defaultValue=""
                  disabled={placing === s.id}
                  onChange={(e) => void place(s.id, e.target.value)}
                  style={{ width: "100%", marginTop: 4 }}
                >
                  <option value="">—</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}

        <div style={{ margin: "16px 16px 0" }}>
          <label>
            <span className="sd-meta">{t("accessNoteLabel")}</span>
            <textarea
              className="sd-input"
              rows={3}
              value={note}
              maxLength={500}
              placeholder={t("accessNotePlaceholder")}
              onChange={(e) => setNote(e.target.value)}
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
        </div>

        <div style={{ margin: "14px 16px 24px" }}>
          <Btn kind="primary" icon="check" disabled={!complete || busy} onClick={() => void submit()}>
            {t("accessSubmit")}
          </Btn>
          {error && (
            <div className="sd-meta" style={{ marginTop: 10, color: "var(--warn)" }}>{error}</div>
          )}
          <div className="sd-meta" style={{ marginTop: 12, lineHeight: 1.5 }}>
            {t("accessMeanwhile")}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/** The route guard. A UI convenience and nothing more: every gated route
 *  re-resolves the same answer server-side through `requireApproved`, so a
 *  client holding a stale copy gets a 403 rather than data. */
export function RequireApproved({ children }: { children: React.ReactNode }) {
  const { me } = useSession();
  if (me && me.directoryAccess !== "approved") return <Access />;
  return <>{children}</>;
}

/** The one-line nudge Home shows an account that has not asked yet. */
export function AccessNudge() {
  const { t } = useI18n();
  const { me } = useSession();
  if (!me || me.directoryAccess === "approved") return null;
  return (
    <Link to="/access" style={{ textDecoration: "none", display: "block", margin: "0 16px 12px" }}>
      <div className="sd-card sd-card-pad" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon name="lock" size={18} style={{ color: "var(--orange)", flex: "none" }} />
        <span style={{ lineHeight: 1.4, flex: 1 }}>
          {me.directoryAccess === "pending"
            ? t("accessPendingTitle")
            : me.directoryAccess === "declined"
              ? t("accessDeclinedTitle")
              : t("accessFormTitle")}
        </span>
        {me.directoryAccess === "pending" && <Tag tone="line">{t("accessSubmitted")}</Tag>}
      </div>
    </Link>
  );
}

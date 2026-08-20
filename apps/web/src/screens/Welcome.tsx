// The welcome wizard: name yourself, then add the rest of your household.
//
// This screen exists because of a specific complaint — people joining did not
// realize they could add their children and partner, so households arrived in
// the directory one person wide. The capability was always there (POST
// /me/persons, reachable from /persons/new), just buried behind the person
// switcher and a group you did not have yet. The fix is to ask once, at the
// only moment we know the member is willing to fill things in.
//
// Three things about the design are load-bearing:
//
//   The step is derived from server truth, not stored. `me.persons.length`
//   decides whether you see step one, so a reload mid-wizard resumes rather
//   than restarting, and a member who already has a profile who arrives here
//   from Home's CTA lands straight on the family step.
//
//   The household is founded lazily, on the first add. A dropped connection
//   between founding it and creating the person leaves a household containing
//   only its creator, which is not a broken state: it is exactly what you get
//   by making a household from the Groups tab and stopping. `ensureHousehold`
//   awaits a read of /me/households that finds and reuses it, so nothing is
//   created twice.
//
//   Nothing about that reuse may live in React state. Two adds in quick
//   succession would both read a `setState` that had not landed yet and found a
//   household each; and reading whatever the mount-time lookup happened to have
//   returned races it outright. Both caches are refs, written synchronously,
//   and `ensureHousehold` awaits the lookup rather than sampling it. A shared
//   `saving` flag across BOTH mini-forms serializes the adds on top of that.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Capability, MyHouseholdDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Btn } from "../components/atoms.js";
import { AppShell } from "../components/AppShell.js";
import { Field } from "../components/parts.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { api } from "../lib/api.js";
import { householdNameFor, markOnboardingSkipped } from "../lib/onboarding.js";

type Step = "name" | "family" | "done";
type Relation = "child" | "partner";

/** What the labelled button already told us. "Add a child" and "Add my partner"
 *  are the whole point of asking separately, so throwing the answer away and
 *  filing everyone untyped would waste the one signal the step collects. Both
 *  stay editable afterwards on the person's own profile. */
const CAPABILITY_FOR: Record<Relation, Capability> = {
  child: "student",
  partner: "parent",
};

interface Added {
  id: string;
  name: string;
  relation: Relation;
}

interface Self {
  firstName: string;
  lastName: string | null;
}

export function Welcome() {
  const { me, activePerson } = useSession();
  // Derived once. `RequireAuth` guarantees `me` here, and the wizard should not
  // yank someone back to step one just because a refresh landed mid-session.
  const resuming = !!me && me.persons.length > 0;
  const [step, setStep] = useState<Step>(() => (resuming ? "family" : "name"));
  // Null until known. Step one fills it in from what was just typed; arriving
  // straight at the family step fills it in from the profile — see below.
  const [self, setSelf] = useState<Self | null>(null);
  const [added, setAdded] = useState<Added[]>([]);

  // Home's two new buttons both land here on someone who already has a profile,
  // so the wizard never runs step one for them and has no surname of its own to
  // work from. Left unread, the household would be named "Dana's household"
  // rather than "The Ruiz family", and children would stop inheriting the
  // surname — on the very path those buttons create. `lastName` is present on
  // the profile of a Person you control, which the active Person always is.
  useEffect(() => {
    if (self !== null || !activePerson) return;
    let alive = true;
    void api
      .person(activePerson.id)
      .then((p) => {
        if (alive) setSelf({ firstName: p.firstName, lastName: p.lastName ?? null });
      })
      .catch(() => {
        // Fall back to the name we already have rather than blocking the step.
        if (alive) setSelf({ firstName: activePerson.firstName, lastName: null });
      });
    return () => {
      alive = false;
    };
  }, [self, activePerson]);

  if (step === "name") {
    return (
      <NameStep
        onDone={(firstName, lastName) => {
          setSelf({ firstName, lastName });
          setStep("family");
        }}
      />
    );
  }
  if (step === "family") {
    // Only reachable before `self` resolves when resuming, and only for the
    // moment the profile read takes.
    if (self === null) {
      return (
        <AppShell>
          <div className="sd-scroll" style={{ display: "grid", placeItems: "center" }}>
            <div className="sd-spinner" />
          </div>
        </AppShell>
      );
    }
    return (
      <FamilyStep
        self={self}
        added={added}
        onAdded={(a) => setAdded((cur) => [...cur, a])}
        onContinue={() => setStep("done")}
      />
    );
  }
  return <DoneStep />;
}

// ── Step 1: who are you ─────────────────────────────────────────────────────

/** The original CreateProfile form, unchanged in substance — same fields, same
 *  copy, same admin shortcut. It only stops navigating to Home at the end. */
function NameStep({
  onDone,
}: {
  onDone: (firstName: string, lastName: string | null) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { me, refresh } = useSession();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) return;
    setBusy(true);
    setFailed(false);
    try {
      const last = lastName.trim() || null;
      await api.createPerson({ firstName: firstName.trim(), lastName: last });
      // Before advancing: the next step's writes need this person to exist and
      // to be resolvable as the active one.
      await refresh();
      onDone(firstName.trim(), last);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="sd-scroll" style={{ display: "flex", flexDirection: "column" }}>
        <form onSubmit={submit} style={FORM_STYLE}>
          <StepHeader icon="users3" title={t("setupTitle")} lead={t("setupLead")} />
          <Field label={t("firstName")}>
            <input className="sd-input" value={firstName} autoFocus onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label={t("lastName")}>
            <input className="sd-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
          {failed && <ErrorLine>{t("welcomeNameError")}</ErrorLine>}
          <Btn block icon="check" type="submit" disabled={busy || !firstName.trim()}>
            {t("createProfileBtn")}
          </Btn>
          {me?.user.isSystemAdmin && (
            <button type="button" className="sd-btn sd-btn-ghost" onClick={() => navigate("/admin")}>
              {t("skipToAdmin")}
            </button>
          )}
        </form>
      </div>
    </AppShell>
  );
}

// ── Step 2: who else is in your home ────────────────────────────────────────

function FamilyStep({
  self,
  added,
  onAdded,
  onContinue,
}: {
  self: Self;
  added: Added[];
  onAdded: (a: Added) => void;
  onContinue: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [open, setOpen] = useState<Relation | null>(null);
  // Refs, not state, for both of these. A `setState` is not visible until the
  // next render, so two adds in quick succession would both see "no household
  // yet" and found one each. A ref is written synchronously, so the second add
  // sees the first one's result.
  const householdRef = useRef<string | null>(null);
  const lookupRef = useRef<Promise<void> | null>(null);
  // Shared across both mini-forms on purpose — see the file header.
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  /** Resume: an earlier, interrupted pass may already have founded the
   *  household, and reusing it is what keeps a dropped connection from leaving
   *  two behind. Started on mount to hide the latency, but `ensureHousehold`
   *  AWAITS it rather than reading whatever has landed — submitting the first
   *  add before this resolves is otherwise exactly how you get the duplicate
   *  this read exists to prevent. */
  const findExistingHousehold = (): Promise<void> => {
    if (lookupRef.current === null) {
      lookupRef.current = api
        .myHouseholds()
        .then((r: { households: MyHouseholdDTO[] }) => {
          if (householdRef.current === null && r.households.length > 0) {
            householdRef.current = r.households[0]!.id;
          }
        })
        .catch(() => {
          /* Nothing to reuse; the first add founds one. */
        });
    }
    return lookupRef.current;
  };

  useEffect(() => {
    void findExistingHousehold();
    // Once per mount; the ref makes a repeat call a no-op anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureHousehold = async (): Promise<string> => {
    await findExistingHousehold();
    if (householdRef.current) return householdRef.current;
    const { id } = await api.createGroup({
      kind: "household",
      name: householdNameFor(self.firstName, self.lastName, t),
    });
    householdRef.current = id;
    return id;
  };

  const add = async (relation: Relation, firstName: string, lastName: string, email: string) => {
    setSaving(true);
    setFailed(null);
    try {
      const groupId = await ensureHousehold();
      const { id } = await api.createPerson({
        firstName: firstName.trim(),
        // Most families share a surname, and re-typing it for each child is the
        // kind of friction that makes people stop halfway.
        lastName: lastName.trim() || self.lastName,
        capabilities: [CAPABILITY_FOR[relation]],
        householdId: groupId,
      });
      const name = `${firstName.trim()} ${lastName.trim() || self.lastName || ""}`.trim();

      // The invite is best-effort and deliberately cannot fail the add: the
      // person is already real and in the household, so a bounced invitation is
      // a thing to retry later, not a reason to unwind anything.
      if (relation === "partner" && email.trim()) {
        try {
          await api.inviteController(id, email.trim());
        } catch {
          setFailed(t("welcomeInviteFailed", { name }));
        }
      }

      onAdded({ id, name, relation });
      setOpen(null);
      await refresh();
    } catch {
      setFailed(t("welcomeAddError"));
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    markOnboardingSkipped();
    navigate("/", { replace: true });
  };

  return (
    <AppShell>
      <div className="sd-scroll" style={{ display: "flex", flexDirection: "column" }}>
        <div style={FORM_STYLE}>
          <StepHeader icon="members" title={t("welcomeFamilyTitle")} lead={t("welcomeFamilyLead")} />

          {added.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="sd-eyebrow">{t("welcomeAddedLabel", { count: String(added.length) })}</div>
              {added.map((a) => (
                <div key={a.id} className="sd-card sd-card-pad sd-row" style={{ gap: 10, padding: "10px 12px" }}>
                  <Icon name="check" size={16} stroke={2.4} style={{ color: "var(--ok)", flex: "0 0 auto" }} />
                  <span style={{ fontWeight: 600, fontSize: 14.5 }}>{a.name}</span>
                </div>
              ))}
            </div>
          )}

          {failed && <ErrorLine>{failed}</ErrorLine>}

          {open === null ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Btn kind="secondary" block icon="plus" onClick={() => setOpen("child")}>
                {t("welcomeAddChild")}
              </Btn>
              <Btn kind="secondary" block icon="plus" onClick={() => setOpen("partner")}>
                {t("welcomeAddPartner")}
              </Btn>
            </div>
          ) : (
            <MemberForm
              relation={open}
              saving={saving}
              onCancel={() => setOpen(null)}
              onSubmit={(f, l, e) => void add(open, f, l, e)}
            />
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {added.length > 0 ? (
              <Btn block icon="check" onClick={onContinue}>{t("welcomeContinue")}</Btn>
            ) : (
              <button type="button" className="sd-btn sd-btn-ghost" onClick={skip}>
                {t("welcomeSkip")}
              </button>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/** One family member. Only the partner form asks for an email, because only a
 *  partner is someone who should end up managing their own profile. */
function MemberForm({
  relation,
  saving,
  onCancel,
  onSubmit,
}: {
  relation: Relation;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (firstName: string, lastName: string, email: string) => void;
}) {
  const { t } = useI18n();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");

  return (
    <div className="sd-card sd-card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="sd-h2" style={{ fontSize: 16 }}>
        {relation === "child" ? t("welcomeChildHeading") : t("welcomePartnerHeading")}
      </div>
      <Field label={t("firstName")}>
        <input className="sd-input" value={firstName} autoFocus onChange={(e) => setFirstName(e.target.value)} />
      </Field>
      <Field label={t("lastName")}>
        <input className="sd-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </Field>
      {relation === "partner" && (
        <Field label={t("welcomePartnerEmail")} hint={t("welcomePartnerEmailNote")}>
          <input
            className="sd-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Btn
          block
          icon="plus"
          disabled={saving || !firstName.trim()}
          onClick={() => onSubmit(firstName, lastName, email)}
        >
          {t("welcomeAddSubmit")}
        </Btn>
        <button type="button" className="sd-btn sd-btn-ghost" onClick={onCancel} disabled={saving}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

// ── Step 3: done ────────────────────────────────────────────────────────────

function DoneStep() {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <AppShell>
      <div className="sd-scroll" style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ ...FORM_STYLE, justifyContent: "center", flex: 1 }}>
          <StepHeader icon="check" title={t("welcomeDoneTitle")} lead={t("welcomeDoneLead")} />
          <Btn block icon="chevright" onClick={() => navigate("/", { replace: true })}>
            {t("welcomeDoneCta")}
          </Btn>
        </div>
      </div>
    </AppShell>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: "24px 24px 32px",
  gap: 18,
  maxWidth: 460,
  width: "100%",
  margin: "0 auto",
};

/** The house convention for "here's a new form, here's why" — the same 56px
 *  tinted badge CreateProfile and AddPerson already use. */
function StepHeader({ icon, title, lead }: { icon: "users3" | "members" | "check"; title: string; lead: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--blue-tint)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={28} />
      </div>
      <div>
        <h1 className="sd-h1">{title}</h1>
        <p className="sd-lead" style={{ marginTop: 8 }}>{lead}</p>
      </div>
    </div>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="sd-meta" style={{ color: "var(--warn)", lineHeight: 1.4, margin: 0 }}>
      {children}
    </p>
  );
}

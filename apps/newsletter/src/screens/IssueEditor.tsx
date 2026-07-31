// Compose one issue: metadata, the TipTap body, a live email preview, and the
// send controls.
//
// Two things worth knowing before reading:
//
//   The draft autosaves. Send reads the issue from the database, not from this
//   component's state, so an unsaved edit would silently not go out. Rather than
//   make the author remember a Save button, edits flush on a short debounce and
//   Send force-flushes first.
//
//   A sent issue is read-only, here and on the server. The editor renders in
//   view-only mode and the preview switches to the frozen event snapshot, so
//   what you see afterwards is what people actually received.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { NewsletterIssueDTO, NewsletterNode, NewsletterSettingsDTO } from "@sd/shared";
import { issueSlug } from "@sd/shared";
import { AppShell } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, Field, SheetOver } from "../components/parts.js";
import { Btn } from "../components/atoms.js";
import { Icon } from "../components/Icon.js";
import { Editor } from "../components/editor/Editor.js";
import { PreviewPane } from "../components/PreviewPane.js";
import { StatusChip } from "./Issues.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { ApiError, api, errorMessage } from "../lib/api.js";

const AUTOSAVE_MS = 1200;
const POLL_MS = 2000;

interface Draft {
  title: string;
  subtitle: string;
  subject: string;
  slug: string;
  content: NewsletterNode;
}

function SendSheet({
  issue,
  onClose,
  onConfirm,
  busy,
}: {
  issue: NewsletterIssueDTO;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 4 }}>Send this issue?</h2>
      <p className="sd-lead" style={{ fontSize: 14, marginBottom: 14 }}>
        “{issue.title}” goes out to everyone subscribed, and its web page becomes
        public at <code>/n/{issue.slug}</code>. Neither can be undone.
      </p>
      <div className="nlx-warn" style={{ marginBottom: 16 }}>
        <Icon name="info" size={16} stroke={2} style={{ flex: "0 0 auto", marginTop: 1 }} />
        <span>
          The web page is public — anyone with the link can read it, and the URL is
          guessable by design. Don't include anything that shouldn't leave the school
          community.
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Btn block onClick={onConfirm} disabled={busy}>
          {busy ? "Sending…" : "Send now"}
        </Btn>
        <button className="sd-btn sd-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </SheetOver>
  );
}

function TestSendSheet({
  onClose,
  onSend,
}: {
  onClose: () => void;
  onSend: (addresses: string[]) => Promise<string>;
}) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const submit = async () => {
    const addresses = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (addresses.length === 0) return;
    setBusy(true);
    setResult(await onSend(addresses));
    setBusy(false);
  };

  return (
    <SheetOver onClose={onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 4 }}>Send a test</h2>
      <p className="sd-lead" style={{ fontSize: 14, marginBottom: 14 }}>
        Up to 10 addresses, separated by commas. Test copies are subject-prefixed
        and their unsubscribe link is inert, so a test can't remove anyone.
      </p>
      <Field label="Send to">
        <textarea
          className="sd-input"
          rows={3}
          value={raw}
          placeholder="you@example.com, principal@example.com"
          onChange={(e) => setRaw(e.target.value)}
        />
      </Field>
      {result && <p className="sd-meta" style={{ marginTop: 10 }}>{result}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        <Btn block icon="mail" onClick={() => void submit()} disabled={busy || !raw.trim()}>
          {busy ? "Sending…" : "Send test"}
        </Btn>
        <button className="sd-btn sd-btn-ghost" onClick={onClose}>Close</button>
      </div>
    </SheetOver>
  );
}

function SendProgress({ issue }: { issue: NewsletterIssueDTO }) {
  const counts = issue.recipientCounts;
  if (!counts) return null;
  const total = counts.pending + counts.sent + counts.failed;
  const done = counts.sent + counts.failed;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="sd-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 9 }}>
      <div className="sd-row" style={{ justifyContent: "space-between" }}>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>
          {issue.status === "sending" ? "Sending…" : "Delivery"}
        </span>
        <span className="sd-meta">{done} of {total}</span>
      </div>
      <div className="nlx-progress"><span style={{ width: `${pct}%` }} /></div>
      {counts.failed > 0 && (
        <p className="sd-meta" style={{ color: "var(--warn)" }}>
          {counts.failed} {counts.failed === 1 ? "address" : "addresses"} failed.
        </p>
      )}
    </div>
  );
}

export function IssueEditor() {
  const { id = "" } = useParams();
  const desktop = useIsDesktop();
  const navigate = useNavigate();

  const [issue, setIssue] = useState<NewsletterIssueDTO | null>(null);
  const [settings, setSettings] = useState<NewsletterSettingsDTO | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [sheet, setSheet] = useState<"send" | "test" | null>(null);
  const [sending, setSending] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef<Draft | null>(null);
  /** The save currently on the wire, if any. `pendingDraft` is cleared when a
   *  request is ISSUED, not when it lands, so it alone can't answer "is
   *  everything saved?" — Send would see nothing pending and race the PATCH
   *  that carries the author's last edit. */
  const inFlight = useRef<Promise<boolean> | null>(null);
  const readOnly = issue !== null && issue.status !== "draft";

  useEffect(() => {
    Promise.all([api.issue(id), api.settings()])
      .then(([i, s]) => {
        setIssue(i.issue);
        setSettings(s.settings);
        setDraft({
          title: i.issue.title,
          subtitle: i.issue.subtitle ?? "",
          subject: i.issue.subject,
          slug: i.issue.slug,
          content: i.issue.content,
        });
      })
      .catch((err: unknown) => setError(errorMessage(err, "Couldn't load this issue.")));
  }, [id]);

  // Poll while the fan-out runs so the progress bar and final counts settle
  // without the admin reloading.
  useEffect(() => {
    if (issue?.status !== "sending") return;
    const handle = setInterval(() => {
      void api.issue(id).then((r) => setIssue(r.issue)).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(handle);
  }, [issue?.status, id]);

  /** Persist any pending edit and wait for anything already in flight.
   *
   *  Saves are serialized through `inFlight` rather than fired concurrently: two
   *  overlapping PATCHes can land out of order, letting an older body overwrite
   *  newer content. */
  const flush = useCallback(async (): Promise<boolean> => {
    const previous = inFlight.current;
    if (previous) await previous;

    const next = pendingDraft.current;
    if (!next) return true;
    pendingDraft.current = null;
    setSaveState("saving");

    const run = (async () => {
      try {
        const { issue: saved } = await api.updateIssue(id, {
          title: next.title.trim() || "Untitled newsletter",
          subtitle: next.subtitle.trim() || null,
          subject: next.subject.trim() || next.title.trim(),
          slug: next.slug.trim() || undefined,
          content: next.content,
        });
        // The server may have adjusted the slug (uniqueness); reflect that back.
        setIssue(saved);
        setDraft((d) => (d ? { ...d, slug: saved.slug } : d));
        setSaveState("saved");
        return true;
      } catch (err) {
        // A 409 here means the issue was sent while this save was in flight, so
        // the edit is moot — reporting "couldn't save" on top of a successful
        // send would just be alarming and wrong.
        if (err instanceof ApiError && err.status === 409) return true;
        setSaveState("error");
        setError(errorMessage(err, "Couldn't save your changes."));
        return false;
      } finally {
        inFlight.current = null;
      }
    })();

    inFlight.current = run;
    return run;
  }, [id]);

  const edit = useCallback(
    (patch: Partial<Draft>) => {
      setDraft((current) => {
        if (!current) return current;
        const next = { ...current, ...patch };
        pendingDraft.current = next;
        return next;
      });
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    },
    [flush],
  );

  // Flush on unmount so navigating away mid-debounce doesn't drop the last edit.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    void flush();
  }, [flush]);

  const send = async () => {
    setSending(true);
    if (timer.current) clearTimeout(timer.current);
    // Send reads from the database, so anything still in the debounce window has
    // to land first or it simply wouldn't go out.
    if (!(await flush())) {
      setSending(false);
      return;
    }
    try {
      await api.sendIssue(id);
      const { issue: updated } = await api.issue(id);
      setIssue(updated);
      setSheet(null);
    } catch (err) {
      setError(errorMessage(err, "Couldn't send this issue."));
    } finally {
      setSending(false);
    }
  };

  const testSend = async (addresses: string[]): Promise<string> => {
    if (timer.current) clearTimeout(timer.current);
    if (!(await flush())) return "Save failed — the test wasn't sent.";
    try {
      const r = await api.testSend(id, addresses);
      return `Sent ${r.sent} of ${r.attempted}.`;
    } catch (err) {
      return errorMessage(err, "The test couldn't be sent.");
    }
  };

  const retry = async () => {
    try {
      await api.retryIssue(id);
      const { issue: updated } = await api.issue(id);
      setIssue(updated);
    } catch (err) {
      setError(errorMessage(err, "Nothing to retry."));
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete this draft? This can't be undone.")) return;
    try {
      await api.deleteIssue(id);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Couldn't delete this draft."));
    }
  };

  if (error && !issue) {
    return (
      <AppShell>
        <div className="sd-scroll" style={{ padding: 24 }}>
          <p className="sd-lead" style={{ color: "var(--warn)" }}>{error}</p>
        </div>
      </AppShell>
    );
  }
  if (!issue || !draft || !settings) {
    return (
      <AppShell>
        <div className="sd-scroll" style={{ display: "grid", placeItems: "center" }}>
          <div className="sd-spinner" />
        </div>
      </AppShell>
    );
  }

  const saveLabel =
    saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : saveState === "saved" ? "Saved" : "";

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <p className="sd-lead" style={{ color: "var(--warn)", margin: 0 }}>{error}</p>}

      <div className="sd-row" style={{ gap: 10, flexWrap: "wrap" }}>
        <StatusChip status={issue.status} />
        {!readOnly && <span className="sd-meta">{saveLabel}</span>}
        <div style={{ flex: 1 }} />
        {!readOnly && (
          <>
            <button className="sd-btn sd-btn-ghost" onClick={() => setSheet("test")}>Send test</button>
            <Btn icon="mail" onClick={() => setSheet("send")}>Send…</Btn>
          </>
        )}
        {issue.status === "sent" && (issue.recipientCounts?.failed ?? 0) > 0 && (
          <button className="sd-btn sd-btn-ghost" onClick={() => void retry()}>Retry failed</button>
        )}
      </div>

      {issue.status !== "draft" && <SendProgress issue={issue} />}

      {readOnly && (
        <div className="nlx-warn">
          <Icon name="lock" size={16} stroke={2} style={{ flex: "0 0 auto", marginTop: 1 }} />
          <span>
            This issue has been sent, so it can no longer be edited — its public page
            has to keep matching what landed in people's inboxes.
          </span>
        </div>
      )}

      <div className="nlx-formgrid">
        <Field label="Title" hint="Shown as the headline, in the archive, and as the default subject.">
          <input className="sd-input" value={draft.title} readOnly={readOnly}
            onChange={(e) => edit({ title: e.target.value })} />
        </Field>
        <div className="nlx-formrow">
          <Field label="Subtitle" hint="Optional.">
            <input className="sd-input" value={draft.subtitle} readOnly={readOnly}
              onChange={(e) => edit({ subtitle: e.target.value })} />
          </Field>
          <Field label="Email subject" hint="Defaults to the title.">
            <input className="sd-input" value={draft.subject} readOnly={readOnly}
              onChange={(e) => edit({ subject: e.target.value })} />
          </Field>
        </div>
        <Field label="Web address" hint={`Public page: /n/${draft.slug}`}>
          {/* Dated from the issue's own createdAt, not today: re-deriving the
              slug for a draft started last week shouldn't silently move it to
              today's date. Same helper the server uses at create time, so the
              button previews exactly what it would have minted. The server
              still uniquifies on save (-2, -3, …) and flush() reflects that
              back, so a collision here isn't the author's problem. */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="sd-input" style={{ flex: 1, minWidth: 0 }} value={draft.slug} readOnly={readOnly}
              onChange={(e) => edit({ slug: e.target.value })} />
            {!readOnly && (
              <button
                type="button"
                className="sd-btn sd-btn-ghost sd-btn-sm"
                style={{ flex: "0 0 auto" }}
                onClick={() => edit({ slug: issueSlug(draft.title, issue.createdAt) })}
              >
                Generate
              </button>
            )}
          </div>
        </Field>
      </div>

      <div className="nlx-layout">
        <div>
          <Editor
            content={issue.content}
            editable={!readOnly}
            accentColor={settings.accentColor}
            timeZone={settings.timeZone}
            onChange={(content) => edit({ content })}
          />
        </div>
        <div className="nlx-preview-col">
          <p className="sd-eyebrow" style={{ marginBottom: 7 }}>Email preview</p>
          <PreviewPane
            doc={draft.content}
            settings={settings}
            title={draft.title}
            subtitle={draft.subtitle || null}
            slug={draft.slug}
            frozenEvents={issue.eventsSnapshot}
          />
        </div>
      </div>

      {!readOnly && (
        <div>
          <button className="sd-btn sd-btn-ghost" style={{ color: "var(--warn)" }} onClick={() => void remove()}>
            Delete draft
          </button>
        </div>
      )}

      {sheet === "send" && (
        <SendSheet issue={issue} busy={sending} onClose={() => setSheet(null)} onConfirm={() => void send()} />
      )}
      {sheet === "test" && <TestSendSheet onClose={() => setSheet(null)} onSend={testSend} />}
    </div>
  );

  if (desktop) {
    return (
      <DesktopShell active="newsletter" title={draft.title || "Untitled newsletter"}>
        <button className="sd-btn sd-btn-ghost sd-btn-sm nlx-backlink" onClick={() => navigate("/admin")}>
          <Icon name="arrowleft" size={15} /> All issues
        </button>
        {body}
      </DesktopShell>
    );
  }
  return (
    <AppShell>
      <ScreenHeader title="Edit issue" onLeft={() => navigate("/admin")} />
      <div className="sd-scroll" style={{ padding: "14px 16px 28px" }}>{body}</div>
    </AppShell>
  );
}

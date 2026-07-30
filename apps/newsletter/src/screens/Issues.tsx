// Admin home: every issue, newest first, plus a "New issue" action.
// English-only, like the calendar app's admin screens — this is staff tooling,
// not member-facing chrome.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { NewsletterIssueSummaryDTO } from "@sd/shared";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader } from "../components/parts.js";
import { Btn } from "../components/atoms.js";
import { Icon } from "../components/Icon.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, errorMessage } from "../lib/api.js";

export function StatusChip({ status }: { status: NewsletterIssueSummaryDTO["status"] }) {
  const label = status === "sending" ? "Sending" : status === "sent" ? "Sent" : "Draft";
  return <span className={`nlx-status ${status}`}>{label}</span>;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function IssueList({
  issues,
  loading,
  error,
  onNew,
  creating,
}: {
  issues: NewsletterIssueSummaryDTO[];
  loading: boolean;
  error: string | null;
  onNew: () => void;
  creating: boolean;
}) {
  const navigate = useNavigate();

  if (loading) return <div className="sd-spinner" style={{ margin: "48px auto" }} />;
  if (error) return <p className="sd-lead" style={{ color: "var(--warn)" }}>{error}</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="sd-row" style={{ justifyContent: "space-between", gap: 12 }}>
        <p className="sd-meta" style={{ margin: 0 }}>
          {issues.length === 0 ? "No issues yet." : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}
        </p>
        <Btn icon="plus" onClick={onNew} disabled={creating}>New issue</Btn>
      </div>

      {issues.length === 0 && (
        <div className="sd-card" style={{ padding: 32, textAlign: "center" }}>
          <p className="sd-lead" style={{ margin: 0 }}>
            Start your first newsletter. Drafts stay private until you send them.
          </p>
        </div>
      )}

      {issues.map((issue) => (
        <button
          key={issue.id}
          className="sd-card"
          onClick={() => navigate(`/admin/issues/${issue.id}`)}
          style={{
            display: "flex", alignItems: "center", gap: 14, padding: "14px 16px",
            textAlign: "left", font: "inherit", cursor: "pointer", width: "100%",
            border: "1px solid var(--line)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-.2px" }}>{issue.title}</div>
            <div className="sd-meta" style={{ marginTop: 3 }}>
              {issue.sentAt
                ? `Sent ${fmtDate(issue.sentAt)} to ${issue.recipientTotal} ${issue.recipientTotal === 1 ? "person" : "people"}`
                : `Edited ${fmtDate(issue.updatedAt)}`}
            </div>
          </div>
          <StatusChip status={issue.status} />
          <Icon name="chevright" size={17} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
        </button>
      ))}
    </div>
  );
}

export function Issues() {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const [issues, setIssues] = useState<NewsletterIssueSummaryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api
      .issues()
      .then((r) => setIssues(r.issues))
      .catch((err: unknown) => setError(errorMessage(err, "Couldn't load issues.")))
      .finally(() => setLoading(false));
  }, []);

  const create = async () => {
    setCreating(true);
    try {
      // Created immediately rather than after a title prompt: the editor needs an
      // id to attach uploads and event blocks to, and an abandoned untitled draft
      // is easy to delete.
      const { issue } = await api.createIssue({
        title: "Untitled newsletter",
        content: { type: "doc", content: [{ type: "paragraph" }] },
      });
      navigate(`/admin/issues/${issue.id}`);
    } catch (err) {
      setError(errorMessage(err, "Couldn't create the issue."));
      setCreating(false);
    }
  };

  const body = (
    <IssueList issues={issues} loading={loading} error={error} onNew={() => void create()} creating={creating} />
  );

  if (desktop) {
    return (
      <DesktopShell active="newsletter" title="Newsletter">
        {body}
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="newsletter" />}>
      <ScreenHeader title="Newsletter" left="mail" />
      <div className="sd-scroll" style={{ padding: "14px 16px 20px" }}>{body}</div>
    </AppShell>
  );
}

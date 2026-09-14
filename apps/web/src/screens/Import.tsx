// Admin CSV bulk import: pick a file → map columns → dry-run → commit.
import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { BULK_IMPORT_FIELDS, type BulkImportField, type BulkImportResult, type BulkImportRow, type Visibility } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Btn } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel } from "../components/parts.js";
import { useSession } from "../lib/session.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { parseCsv } from "../lib/csv.js";
import { api } from "../lib/api.js";

const REQUIRED: BulkImportField[] = ["firstName"];
const FIELD_LABEL: Record<BulkImportField, string> = {
  firstName: "First name *",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  group: "Group",
  title: "Title",
  capabilities: "Capabilities",
};
const SYNONYMS: Record<BulkImportField, string[]> = {
  firstName: ["first", "firstname", "first name", "given"],
  lastName: ["last", "lastname", "last name", "surname", "family"],
  email: ["email", "e-mail", "mail"],
  phone: ["phone", "phone number", "telephone", "tel", "mobile", "cell", "cell phone"],
  group: ["group", "class", "classroom", "household", "room"],
  title: ["title", "role"],
  capabilities: ["capabilities", "capability", "caps", "roles", "type"],
};

function autoMap(headers: string[]): Record<BulkImportField, number> {
  const map = {} as Record<BulkImportField, number>;
  for (const f of BULK_IMPORT_FIELDS) {
    map[f] = headers.findIndex((h) => SYNONYMS[f].includes(h.trim().toLowerCase()));
  }
  return map;
}

export function Import() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { me } = useSession();
  const [headers, setHeaders] = useState<string[]>([]);
  const [allRows, setAllRows] = useState<string[][]>([]);
  // Indices into allRows the admin has struck out of THIS import. A removed
  // row is remembered rather than spliced away so it can be put back without
  // re-picking the file.
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const rows = useMemo(() => allRows.filter((_, i) => !removed.has(i)), [allRows, removed]);
  const [mapping, setMapping] = useState<Record<BulkImportField, number>>({} as Record<BulkImportField, number>);
  const [result, setResult] = useState<(BulkImportResult & { committed?: boolean; emailed?: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [sendInvites, setSendInvites] = useState(false);
  // Account handling and contact visibility — see BulkImportOptions in @sd/shared
  // for what each one means and why the defaults are the cautious ones.
  const [createAccounts, setCreateAccounts] = useState(false);
  const [contactVisibility, setContactVisibility] = useState<Visibility>("private");
  const [emailAsContact, setEmailAsContact] = useState(false);
  // Applied to every row whose own capabilities cell is empty, so a roster with
  // no such column (a staff list, say) can be tagged in one go.
  const [defaultCaps, setDefaultCaps] = useState("");

  if (me && !me.user.isSystemAdmin) return <Navigate to="/" replace />;

  const onFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    setHeaders(parsed.headers);
    setAllRows(parsed.rows);
    setRemoved(new Set());
    setMapping(autoMap(parsed.headers));
    setResult(null);
    setFileName(file.name);
  };

  const toImportRow = useMemo(() => {
    const cell = (r: string[], idx: number) => (idx >= 0 ? (r[idx] ?? "").trim() : "");
    return (r: string[]): BulkImportRow => ({
      firstName: cell(r, mapping.firstName ?? -1),
      lastName: cell(r, mapping.lastName ?? -1) || undefined,
      email: cell(r, mapping.email ?? -1) || undefined,
      phone: cell(r, mapping.phone ?? -1) || undefined,
      group: cell(r, mapping.group ?? -1) || undefined,
      title: cell(r, mapping.title ?? -1) || undefined,
      capabilities: cell(r, mapping.capabilities ?? -1) || defaultCaps.trim() || undefined,
    });
  }, [mapping, defaultCaps]);
  const importRows = useMemo<BulkImportRow[]>(() => rows.map(toImportRow), [rows, toImportRow]);

  const mappedOk = (mapping.firstName ?? -1) >= 0;

  const removeRow = (idx: number) => {
    setRemoved((r) => new Set(r).add(idx));
    setResult(null);
  };
  const restoreAll = () => {
    setRemoved(new Set());
    setResult(null);
  };

  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      // No invites exist in account mode, so there is nothing to mail.
      const mail = sendInvites && !createAccounts;
      const r = await api.bulkImport(importRows, dryRun, {
        sendInvites: mail,
        createAccounts,
        contactVisibility,
        emailAsContact,
      });
      setResult({ ...r, committed: !dryRun, emailed: !dryRun && mail });
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      <SectLabel>Upload a CSV</SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="sd-meta" style={{ lineHeight: 1.5 }}>
          Columns: first name, last name, email, phone, group, title, capabilities. Rows with an email get a
          pending invite, or a ready-to-use account if you choose that below. Re-running the same file makes
          no duplicate changes.
        </p>
        <label className="sd-btn sd-btn-secondary" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
          <Icon name="upload" size={16} />{fileName || "Choose CSV file"}
          <input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
        </label>
      </div>

      {headers.length > 0 && (
        <>
          <div style={{ marginTop: 18 }}>
            <SectLabel>Map columns</SectLabel>
            <div className="sd-card sd-card-pad" style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 10 }}>
              {BULK_IMPORT_FIELDS.map((f) => (
                <div key={f} className="sd-row" style={{ gap: 10 }}>
                  <span className="sd-label" style={{ flex: "0 0 110px" }}>{FIELD_LABEL[f]}</span>
                  <select
                    className="sd-input"
                    style={{ height: 38, flex: 1 }}
                    value={mapping[f] ?? -1}
                    onChange={(e) => setMapping((m) => ({ ...m, [f]: Number(e.target.value) }))}
                  >
                    <option value={-1}>—</option>
                    {headers.map((h, idx) => <option key={idx} value={idx}>{h || `Column ${idx + 1}`}</option>)}
                  </select>
                </div>
              ))}
              {!mappedOk && <div className="sd-meta" style={{ color: "var(--warn)" }}>Map a column to First name to continue.</div>}
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div className="sd-row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <SectLabel>Rows to import ({rows.length}{removed.size > 0 ? ` of ${allRows.length}` : ""})</SectLabel>
              {removed.size > 0 && (
                <button
                  type="button"
                  onClick={restoreAll}
                  className="sd-meta"
                  style={{ background: "none", border: 0, padding: 0, color: "var(--blue)", cursor: "pointer", fontWeight: 600 }}
                >
                  Restore {removed.size} removed
                </button>
              )}
            </div>
            <p className="sd-meta" style={{ margin: "6px 0 0", lineHeight: 1.5 }}>
              Remove anyone who shouldn't be added. Only the rows listed here are imported.
            </p>
            <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4, maxHeight: 420, overflowY: "auto" }}>
              {allRows.map((raw, idx) => {
                if (removed.has(idx)) return null;
                const r = toImportRow(raw);
                return (
                  <div key={idx} className="sd-crow" style={{ alignItems: "center" }}>
                    <div className="sd-cmain">
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}</div>
                      <div className="sd-meta">{[r.email, r.phone && `· ${r.phone}`, r.group && `· ${r.group}`, r.title && `· ${r.title}`, r.capabilities && `· ${r.capabilities}`].filter(Boolean).join(" ")}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      aria-label={`Remove ${[r.firstName, r.lastName].filter(Boolean).join(" ") || "row"}`}
                      title="Don't import this row"
                      style={{ background: "none", border: 0, color: "var(--ink-3)", cursor: "pointer", padding: 6 }}
                    >
                      <Icon name="x" size={18} />
                    </button>
                  </div>
                );
              })}
              {rows.length === 0 && <div className="sd-meta" style={{ padding: "8px 0" }}>Every row has been removed — nothing to import.</div>}
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <SectLabel>Options</SectLabel>
            <div className="sd-card sd-card-pad" style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="sd-row" style={{ gap: 10 }}>
                <span className="sd-label" style={{ flex: "0 0 110px" }}>Capabilities</span>
                <input
                  className="sd-input"
                  style={{ height: 38, flex: 1 }}
                  placeholder="e.g. teacher — applied to rows with none"
                  value={defaultCaps}
                  onChange={(e) => setDefaultCaps(e.target.value)}
                />
              </div>
              <div className="sd-row" style={{ gap: 10 }}>
                <span className="sd-label" style={{ flex: "0 0 110px" }}>Phone &amp; email</span>
                <select
                  className="sd-input"
                  style={{ height: 38, flex: 1 }}
                  value={contactVisibility}
                  onChange={(e) => setContactVisibility(e.target.value === "service" ? "service" : "private")}
                >
                  <option value="private">Private — only the person can see them</option>
                  <option value="service">Members — everyone signed in can see them</option>
                </select>
              </div>
              <label className="sd-row" style={{ gap: 8, cursor: "pointer", alignItems: "center" }}>
                <input type="checkbox" checked={emailAsContact} onChange={(e) => setEmailAsContact(e.target.checked)} />
                <span className="sd-meta">The email column is each person's own address — show it on their profile. (Leave off when it is a parent's address on a child's row.)</span>
              </label>
              <label className="sd-row" style={{ gap: 8, cursor: "pointer", alignItems: "center" }}>
                <input type="checkbox" checked={createAccounts} onChange={(e) => setCreateAccounts(e.target.checked)} />
                <span className="sd-meta">Create a sign-in account for each email instead of an invite. Nothing is sent; they sign in with "Email me a link" and find their profile waiting.</span>
              </label>
              {!createAccounts && (
                <label className="sd-row" style={{ gap: 8, cursor: "pointer", alignItems: "center" }}>
                  <input type="checkbox" checked={sendInvites} onChange={(e) => setSendInvites(e.target.checked)} />
                  <span className="sd-meta">Email a sign-in link to people who have an email address.</span>
                </label>
              )}
            </div>
          </div>

          <div className="sd-row" style={{ gap: 9, marginTop: 12 }}>
            <Btn kind="secondary" icon="eye" disabled={!mappedOk || busy || rows.length === 0} onClick={() => void run(true)}>Dry run</Btn>
            <Btn icon="upload" disabled={!mappedOk || busy || rows.length === 0} onClick={() => void run(false)}>Import</Btn>
          </div>
        </>
      )}

      {result && (
        <div className="sd-card sd-card-pad" style={{ marginTop: 16, background: result.committed ? "var(--blue-tint)" : "var(--bg-2)", borderColor: result.committed ? "var(--blue-tint-2)" : "var(--line)" }}>
          <div className="sd-row" style={{ gap: 8, marginBottom: 8 }}>
            <Icon name={result.committed ? "check" : "eye"} size={18} style={{ color: result.committed ? "var(--ok)" : "var(--ink-2)" }} />
            <strong style={{ fontSize: 14.5 }}>{result.committed ? "Imported" : "Dry run — nothing saved"}</strong>
          </div>
          <div className="sd-meta" style={{ lineHeight: 1.7 }}>
            Rows processed: {result.rowsProcessed}<br />
            People created: {result.personsCreated} · matched: {result.personsMatched}<br />
            Groups created: {result.groupsCreated} · memberships: {result.membershipsCreated}<br />
            {result.accountsCreated > 0 && <>Accounts created (not emailed): {result.accountsCreated}<br /></>}
            {result.emailed
              ? `Invite emails sent: ${result.invitesQueued}`
              : `Invites created${result.committed ? " (not emailed)" : ""}: ${result.invitesQueued}`}
          </div>
          {result.errors.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="sd-label" style={{ color: "var(--warn)" }}>Errors ({result.errors.length})</div>
              {result.errors.slice(0, 8).map((e, i) => {
                // `row` counts the rows SUBMITTED, which after removals is not
                // the CSV's line number — so name the person as well.
                const who = e.row > 0 ? [importRows[e.row - 1]?.firstName, importRows[e.row - 1]?.lastName].filter(Boolean).join(" ") : "";
                return (
                  <div key={i} className="sd-meta" style={{ color: "var(--warn)" }}>Row {e.row}{who ? ` (${who})` : ""}: {e.message}</div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );

  if (isDesktop) {
    return <DesktopShell active="admin" title="Bulk import"><div style={{ maxWidth: 680 }}>{body}</div></DesktopShell>;
  }
  return (
    <AppShell bottomNav={<BottomNav active="me" />}>
      <ScreenHeader title="Bulk import" onLeft={() => navigate("/admin")} />
      <div className="sd-scroll"><div className="sd-body">{body}</div></div>
    </AppShell>
  );
}

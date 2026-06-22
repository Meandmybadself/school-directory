// Admin CSV bulk import: pick a file → map columns → dry-run → commit.
import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { BULK_IMPORT_FIELDS, type BulkImportField, type BulkImportResult, type BulkImportRow } from "@sd/shared";
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
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<BulkImportField, number>>({} as Record<BulkImportField, number>);
  const [result, setResult] = useState<(BulkImportResult & { committed?: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");

  if (me && !me.user.isSystemAdmin) return <Navigate to="/" replace />;

  const onFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setMapping(autoMap(parsed.headers));
    setResult(null);
    setFileName(file.name);
  };

  const importRows = useMemo<BulkImportRow[]>(() => {
    const cell = (r: string[], idx: number) => (idx >= 0 ? (r[idx] ?? "").trim() : "");
    return rows.map((r) => ({
      firstName: cell(r, mapping.firstName ?? -1),
      lastName: cell(r, mapping.lastName ?? -1) || undefined,
      email: cell(r, mapping.email ?? -1) || undefined,
      phone: cell(r, mapping.phone ?? -1) || undefined,
      group: cell(r, mapping.group ?? -1) || undefined,
      title: cell(r, mapping.title ?? -1) || undefined,
      capabilities: cell(r, mapping.capabilities ?? -1) || undefined,
    }));
  }, [rows, mapping]);

  const mappedOk = (mapping.firstName ?? -1) >= 0;

  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await api.bulkImport(importRows, dryRun);
      setResult({ ...r, committed: !dryRun });
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      <SectLabel>Upload a CSV</SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="sd-meta" style={{ lineHeight: 1.5 }}>
          Columns: first name, last name, email, phone, group, title, capabilities. Email rows queue an invite.
          Re-running the same file makes no duplicate changes.
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
            <SectLabel>Preview ({rows.length} rows)</SectLabel>
            <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4 }}>
              {importRows.slice(0, 5).map((r, i) => (
                <div key={i} className="sd-crow" style={{ alignItems: "center" }}>
                  <div className="sd-cmain">
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}</div>
                    <div className="sd-meta">{[r.email, r.phone && `· ${r.phone}`, r.group && `· ${r.group}`, r.title && `· ${r.title}`, r.capabilities && `· ${r.capabilities}`].filter(Boolean).join(" ")}</div>
                  </div>
                </div>
              ))}
              {rows.length > 5 && <div className="sd-meta" style={{ padding: "8px 0 4px" }}>+{rows.length - 5} more</div>}
            </div>
          </div>

          <div className="sd-row" style={{ gap: 9, marginTop: 16 }}>
            <Btn kind="secondary" icon="eye" disabled={!mappedOk || busy} onClick={() => void run(true)}>Dry run</Btn>
            <Btn icon="upload" disabled={!mappedOk || busy} onClick={() => void run(false)}>Import</Btn>
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
            Invites queued: {result.invitesQueued}
          </div>
          {result.errors.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="sd-label" style={{ color: "var(--warn)" }}>Errors ({result.errors.length})</div>
              {result.errors.slice(0, 8).map((e, i) => (
                <div key={i} className="sd-meta" style={{ color: "var(--warn)" }}>Row {e.row}: {e.message}</div>
              ))}
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

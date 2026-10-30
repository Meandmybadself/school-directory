// The member half of adding found items: any signed-in account, not just the
// staff roster (the server enforces that split — routes/lostFound.ts).
//
// A deliberately simpler cousin of the staff Upload screen, and TRANSLATED,
// unlike it: any family may land here. Photos are staged (resized and stripped
// of EXIF in lib/lf.ts), can be rotated in the tray, and are then sent a few at
// a time. That is the whole flow — no status polling, no AI chatter, no edit
// links: a member's item always goes to the office's review queue, whatever the
// model reads off it, so the honest answer after an upload is simply "sent, the
// office will review it".
//
// Each photo is still two requests (full photo creates the item, thumbnail
// starts the vision model), both raw JPEG bodies — see lib/api.ts.
import { useEffect, useRef, useState } from "react";
import { Screen } from "../components/Screen.js";
import { Icon } from "../components/Icon.js";
import { Btn } from "../components/atoms.js";
import { ApiError, api } from "../lib/api.js";
import { useI18n } from "../i18n/index.js";
import { resizePhoto, rotatePhoto, type Turn } from "../lib/lf.js";

const UPLOAD_CONCURRENCY = 3;

/** A photo in the tray, resized and waiting for "Submit". */
interface Staged {
  key: string;
  name: string;
  preview: string;
  photo: Blob;
  thumb: Blob;
}

type Phase = "waiting" | "uploading" | "done" | "error";

/** A photo that has been submitted. */
interface Row {
  key: string;
  name: string;
  preview: string;
  phase: Phase;
  error: string;
}

let nextKey = 0;

export function Submit() {
  const { t } = useI18n();
  const [location, setLocation] = useState("");
  const [staged, setStaged] = useState<Staged[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [prepError, setPrepError] = useState("");
  const [rotating, setRotating] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const uploading = rows.some((r) => r.phase === "waiting" || r.phase === "uploading");

  // Leaving mid-upload loses whatever hasn't been sent yet, so say so.
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  /** Resize each chosen photo into the tray, one at a time to spare the phone. */
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    if (input.current) input.current.value = "";
    setPrepError("");
    setPreparing((n) => n + list.length);
    for (const file of list) {
      try {
        const { photo, thumb } = await resizePhoto(file);
        setStaged((s) => [
          ...s,
          { key: `s${nextKey++}`, name: file.name, preview: URL.createObjectURL(thumb), photo, thumb },
        ]);
      } catch {
        setPrepError(t("lfSubmitReadError", { name: file.name }));
      } finally {
        setPreparing((n) => n - 1);
      }
    }
  };

  const unstage = (key: string) =>
    setStaged((s) => {
      const gone = s.find((x) => x.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return s.filter((x) => x.key !== key);
    });

  /** Turn a staged photo a quarter. Both images are re-made from the full-size
   *  one, so the thumbnail the AI reads turns with it. */
  const rotate = async (key: string, turn: Turn) => {
    const item = staged.find((x) => x.key === key);
    if (!item || rotating.includes(key)) return;
    setRotating((r) => [...r, key]);
    try {
      const { photo, thumb } = await rotatePhoto(item.photo, turn);
      const preview = URL.createObjectURL(thumb);
      setStaged((s) => s.map((x) => (x.key === key ? { ...x, photo, thumb, preview } : x)));
      URL.revokeObjectURL(item.preview);
    } catch {
      setPrepError(t("lfSubmitRotateError", { name: item.name }));
    } finally {
      setRotating((r) => r.filter((k) => k !== key));
    }
  };

  const uploadOne = async (item: Staged, where: string): Promise<"ok" | "failed" | "limited"> => {
    update(item.key, { phase: "uploading" });
    try {
      const created = await api.uploadPhoto(item.photo, where);
      // The thumbnail landing is what starts the vision model (routes/lostFound.ts).
      await api.uploadThumb(created.id, item.thumb);
      update(item.key, { phase: "done" });
      return "ok";
    } catch (err) {
      // The daily cap is the one refusal worth its own words (it is about the
      // caller's own account, so the server says so plainly; we translate it).
      const limited = err instanceof ApiError && err.status === 429;
      update(item.key, { phase: "error", error: limited ? t("lfSubmitLimit") : t("lfSubmitFailed") });
      return limited ? "limited" : "failed";
    }
  };

  /** Every staged photo, UPLOAD_CONCURRENCY at a time — until the daily cap
   *  answers. The cap refuses every further upload today, so sending the rest
   *  of the batch would only repeat the same refusal down the queue; instead
   *  the untried photos go back to the tray (nothing re-staged, re-rotated or
   *  lost) and the limit is said once, up by the form. */
  const submit = async () => {
    const batch = staged;
    if (!batch.length) return;
    const where = location.trim();
    setStaged([]);
    setRows((rs) => [
      ...batch.map((s) => ({ key: s.key, name: s.name, preview: s.preview, phase: "waiting" as Phase, error: "" })),
      ...rs,
    ]);
    let next = 0;
    let limited = false;
    const worker = async () => {
      while (!limited && next < batch.length) {
        if ((await uploadOne(batch[next++]!, where)) === "limited") limited = true;
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, batch.length) }, worker));
    if (limited) {
      const untried = batch.slice(next);
      if (untried.length) {
        const keys = new Set(untried.map((s) => s.key));
        setRows((rs) => rs.filter((r) => !keys.has(r.key)));
        setStaged((s) => [...untried, ...s]);
      }
      setPrepError(t("lfSubmitLimit"));
    }
  };

  const phaseText: Record<Phase, (r: Row) => string> = {
    waiting: () => t("lfSubmitWaiting"),
    uploading: () => t("lfSubmitUploading"),
    done: () => `✓ ${t("lfSubmitDone")}`,
    error: (r) => r.error,
  };

  return (
    <Screen active="submit" title={t("lfSubmitTitle")} back="/">
      <div className="lf-page lf-narrow">
        <p className="sd-lead" style={{ margin: 0 }}>{t("lfSubmitLead")}</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="sd-label" htmlFor="lf-location">{t("lfSubmitLocation")}</label>
          <input
            id="lf-location"
            className="sd-input"
            value={location}
            maxLength={120}
            placeholder={t("lfSubmitPlaceholder")}
            onChange={(e) => setLocation(e.target.value)}
          />
          <span className="sd-meta">{t("lfSubmitLocationHint")}</span>
        </div>

        <label className="lf-drop">
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
            onChange={(e) => void onFiles(e.target.files)}
          />
          <Icon name="upload" size={28} />
          <strong style={{ fontSize: 17 }}>{staged.length ? t("lfSubmitAddMore") : t("lfSubmitChoose")}</strong>
          <span className="sd-meta">{t("lfSubmitChooseHint")}</span>
        </label>
        <div className="lf-notice">{t("lfSubmitNotice")}</div>
        {prepError && <div className="lf-notice warn" role="alert">{prepError}</div>}

        {(staged.length > 0 || preparing > 0) && (
          <section className="sd-card sd-card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="lf-tray" aria-label={t("lfSubmitChoose")}>
              {staged.map((s) => (
                <div key={s.key} className="lf-tray-item">
                  <img src={s.preview} alt={s.name} />
                  <button type="button" aria-label={`× ${s.name}`} onClick={() => unstage(s.key)}>
                    ×
                  </button>
                  <button
                    type="button"
                    className="lf-tray-rotate"
                    aria-label={`↻ ${s.name}`}
                    title="↻"
                    disabled={rotating.includes(s.key)}
                    onClick={() => void rotate(s.key, "cw")}
                  >
                    ↻
                  </button>
                </div>
              ))}
              {Array.from({ length: preparing }, (_, i) => (
                <div key={`p${i}`} className="lf-tray-item lf-tray-pending">
                  <div className="sd-spinner" />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Btn disabled={!staged.length || preparing > 0 || rotating.length > 0} onClick={() => void submit()}>
                {staged.length === 1 ? t("lfSubmitOne") : t("lfSubmitMany", { n: staged.length })}
              </Btn>
              <Btn kind="ghost" disabled={!staged.length} onClick={() => staged.forEach((s) => unstage(s.key))}>
                {t("lfSubmitClear")}
              </Btn>
              {preparing > 0 && <span className="sd-meta">{t("lfSubmitPreparing", { n: preparing })}</span>}
            </div>
          </section>
        )}

        <div className="lf-queue">
          {rows.map((r) => (
            <div key={r.key} className="lf-queue-row">
              <img src={r.preview} alt="" />
              <div style={{ minWidth: 0 }}>
                <div className="sd-meta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.name}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: r.phase === "error" ? "var(--orange-ink)" : r.phase === "done" ? "var(--ok)" : "var(--ink)",
                  }}
                >
                  {phaseText[r.phase](r)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}

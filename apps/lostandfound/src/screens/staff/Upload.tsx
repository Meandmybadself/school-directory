// Snap and upload found items, one per photo.
//
// Each photo is resized in the browser (lib/lf.ts — which also strips EXIF,
// GPS included) and sent in two requests: the full-size photo creates the item,
// then the thumbnail lands and starts the vision model. Two requests because
// both are raw JPEG bodies, not multipart — see lib/api.ts — and one body can
// carry one image.
//
// Uploads run one at a time. A phone on school Wi-Fi does better with a queue
// than with ten parallel uploads, and the model's per-minute limit does too.
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { LfStaffItemDTO } from "@sd/shared";
import { Screen } from "../../components/Screen.js";
import { Icon } from "../../components/Icon.js";
import { api, errorMessage } from "../../lib/api.js";
import { resizePhoto } from "../../lib/lf.js";

const LOCATION_KEY = "lf_last_location";

function readLocation(): string {
  try {
    return localStorage.getItem(LOCATION_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveLocation(value: string): void {
  try {
    localStorage.setItem(LOCATION_KEY, value);
  } catch {
    /* private mode — the field simply starts empty next time */
  }
}

interface Row {
  key: string;
  name: string;
  preview: string | null;
  status: string;
  tone: "" | "warn" | "ok";
  itemId: string | null;
}

const POLL_MS = 3000;
const POLL_TRIES = 20;

export function Upload() {
  const [location, setLocation] = useState(readLocation);
  const [rows, setRows] = useState<Row[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const watch = async (key: string, id: string) => {
    for (let i = 0; i < POLL_TRIES; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      let item: LfStaffItemDTO;
      try {
        item = await api.staffItem(id);
      } catch {
        continue;
      }
      if (item.tagStatus === "tagged") {
        return item.heldAt
          ? update(key, { status: "Held for review: writing detected", tone: "warn" })
          : update(key, { status: `✓ Live: ${item.title}`, tone: "ok" });
      }
      if (item.tagStatus === "failed") {
        return update(key, {
          status: "Held for review: the AI couldn't describe it. Open it to check and fill it in.",
          tone: "warn",
        });
      }
    }
    update(key, { status: "Still describing — check the dashboard in a minute." });
  };

  const uploadOne = async (file: File, where: string) => {
    const key = `${file.name}-${file.size}-${Math.random()}`;
    setRows((rs) => [{ key, name: file.name, preview: null, status: "Preparing…", tone: "", itemId: null }, ...rs]);
    try {
      const { photo, thumb } = await resizePhoto(file);
      update(key, { preview: URL.createObjectURL(thumb), status: "Uploading…" });
      const item = await api.uploadPhoto(photo, where);
      update(key, { itemId: item.id });
      await api.uploadThumb(item.id, thumb);
      update(key, { status: "The AI is describing it…" });
      void watch(key, item.id);
    } catch (err) {
      const unreadable = err instanceof DOMException || (err instanceof Error && /decode|encode|canvas/.test(err.message));
      update(key, {
        status: unreadable
          ? "This browser can't read that photo. Try taking it with the camera instead."
          : errorMessage(err, "Upload failed. Check the connection and try again."),
        tone: "warn",
      });
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    if (input.current) input.current.value = "";
    const where = location.trim();
    for (const file of list) await uploadOne(file, where);
  };

  return (
    <Screen active="staff" title="Add found items" back="/staff">
      <div className="lf-page lf-narrow">
        <p className="sd-lead" style={{ margin: 0 }}>
          One item per photo, on a plain background if you can, and with no children in the frame. The AI writes the
          description and tags; you can fix anything afterwards.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="sd-label" htmlFor="lf-location">Where were they found? (optional)</label>
          <input
            id="lf-location"
            className="sd-input"
            value={location}
            maxLength={120}
            placeholder="e.g. Gym, playground, cafeteria"
            onChange={(e) => setLocation(e.target.value)}
            onBlur={() => saveLocation(location.trim())}
          />
          <span className="sd-meta">Applies to every photo you add now.</span>
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
          <strong style={{ fontSize: 17 }}>Take or choose photos</strong>
          <span className="sd-meta">You can pick several at once.</span>
        </label>
        <div className="lf-notice">
          Turn names and labels away from the camera — items with writing are held for review before they appear
          publicly.
        </div>

        <div className="lf-queue" aria-live="polite">
          {rows.map((r) => (
            <div key={r.key} className="lf-queue-row">
              {r.preview ? <img src={r.preview} alt="" /> : <div style={{ width: 56, height: 56 }} />}
              <div style={{ minWidth: 0 }}>
                <div className="sd-meta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.name}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: r.tone === "warn" ? "var(--orange-ink)" : r.tone === "ok" ? "var(--ok)" : "var(--ink)",
                  }}
                >
                  {r.status}
                </div>
              </div>
              {r.itemId && (
                <Link className="sd-btn sd-btn-ghost sd-btn-sm" to={`/staff/item/${r.itemId}`}>
                  {r.tone === "warn" ? "Review" : "Edit"}
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}

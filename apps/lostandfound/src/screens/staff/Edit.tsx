// Edit one item: fix what the AI wrote, hide it, mark it returned, delete it.
//
// Saving marks the item tagged on the server, so an AI pass still running for
// it discards its own result rather than overwriting these edits. This screen
// keeps the matching promise on its side: while the AI is working it polls, and
// re-renders with the AI's answer only if nobody has started typing.
//
// "Writing on it" is staff-only by design (invariant 33): it is usually a
// child's name, and it never leaves through the public projection. The PHOTO
// is public, though, so an item the AI read writing on stays held until a
// person has looked at it and pressed Publish.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LF_CATEGORIES, LF_COLORS, type LfItemPatch, type LfStaffItemDetailDTO } from "@sd/shared";
import { Screen } from "../../components/Screen.js";
import { Swatch } from "../../components/items.js";
import { Btn } from "../../components/atoms.js";
import { useI18n } from "../../i18n/index.js";
import { api, errorMessage, type LfItemAction } from "../../lib/api.js";
import { formatDay, formatDayTime } from "../../lib/lf.js";

function patchOf(item: LfStaffItemDetailDTO): LfItemPatch {
  return {
    title: item.title,
    description: item.description,
    category: item.category || "Other",
    colors: item.colors,
    brand: item.brand,
    material: item.material,
    visibleText: item.visibleText,
    tags: item.tags,
    location: item.location,
  };
}

export function Edit() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { locale } = useI18n();
  const [item, setItem] = useState<LfStaffItemDetailDTO | null>(null);
  const [form, setForm] = useState<LfItemPatch | null>(null);
  const [tagsText, setTagsText] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; warn: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);

  const adopt = useCallback((fresh: LfStaffItemDetailDTO) => {
    setItem(fresh);
    setForm(patchOf(fresh));
    setTagsText(fresh.tags.join(", "));
    dirty.current = false;
  }, []);

  const reload = useCallback(
    () =>
      api
        .staffItem(id)
        .then(adopt)
        .catch((err) => setLoadError(errorMessage(err, "Couldn't load this item."))),
    [id, adopt],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // While the AI works, poll; take its answer only if the form is untouched.
  const pending = item?.tagStatus === "pending";
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(async () => {
      const fresh = await api.staffItem(id).catch(() => null);
      if (!fresh || fresh.tagStatus === "pending") return;
      clearInterval(timer);
      if (dirty.current) {
        setItem((prev) => (prev ? { ...prev, tagStatus: fresh.tagStatus } : prev));
        setNote({ text: "The AI finished. Saving keeps your edits instead of its suggestions.", warn: false });
      } else {
        adopt(fresh);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [pending, id, adopt]);

  const set = <K extends keyof LfItemPatch>(key: K, value: LfItemPatch[K]) => {
    dirty.current = true;
    setForm((f) => (f ? { ...f, [key]: value } : f));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setNote(null);
    try {
      const tags = tagsText.split(",").map((s) => s.trim()).filter(Boolean);
      await api.saveItem(id, { ...form, tags });
      await reload();
      setNote({ text: "Saved.", warn: false });
    } catch (err) {
      setNote({ text: errorMessage(err, "Couldn't save. Is the title filled in?"), warn: true });
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: LfItemAction, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setNote(null);
    try {
      await api.itemAction(id, action);
      await reload();
    } catch (err) {
      setNote({ text: errorMessage(err, "That didn't work. Try again."), warn: true });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete this item and its photo for good?")) return;
    setBusy(true);
    try {
      await api.deleteItem(id);
      navigate("/staff");
    } catch (err) {
      setNote({ text: errorMessage(err, "Couldn't delete it."), warn: true });
      setBusy(false);
    }
  };

  return (
    <Screen active="staff" title="Edit item" back="/staff">
      <div className="lf-page">
        <Link className="sd-link" to="/staff" style={{ fontSize: 14 }}>
          ← Dashboard
        </Link>
        {loadError && <div className="lf-notice warn" role="alert">{loadError}</div>}
        {item && form && (
          <div className="lf-detail">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <img className="lf-photo" src={item.photoUrl} alt={item.title || "Found item"} />
              <p className="sd-meta" style={{ margin: 0 }}>
                Found {formatDay(item.foundAt, locale)}
                {item.createdByEmail && ` · added by ${item.createdByEmail}`}
                {item.returnedAt && ` · returned ${formatDay(item.returnedAt, locale)}`}
              </p>
              {item.status === "found" && !item.hiddenAt && !item.heldAt && (
                <Link className="sd-link" to={`/item/${item.id}`} style={{ fontSize: 14 }}>
                  View the public page
                </Link>
              )}
              {item.claims.length > 0 && (
                <section className="sd-card sd-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <h2 className="sd-h2">Claims</h2>
                  {item.claims.map((c) => (
                    <div key={c.id}>
                      <b>{c.name}</b> · {c.contact}
                      {c.message && <div style={{ overflowWrap: "anywhere" }}>“{c.message}”</div>}
                      <div className="sd-meta">
                        {formatDayTime(c.createdAt, locale)}
                        {c.resolution && ` · ${c.resolution}`}
                      </div>
                    </div>
                  ))}
                </section>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {pending && <div className="lf-notice">The AI is still describing this item. This page updates when it's done.</div>}
              {item.tagStatus === "failed" && (
                <div className="lf-notice warn">
                  The AI couldn't describe this item{item.tagError ? ` (${item.tagError})` : ""}. Fill it in yourself, or re-run it.
                </div>
              )}
              {item.donateDue && (
                <div className="lf-notice warn">Unclaimed for a long time — it's probably time to donate it.</div>
              )}
              {item.heldAt && item.status === "found" && (
                <div className="lf-notice warn" role="status" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <b>Held for review — not on the public site yet.</b>
                  <span>
                    {item.visibleText
                      ? `The AI read writing on this item: “${item.visibleText}”. If the photo shows a child's name, retake it with the label turned away (delete this item and upload again), then publish.`
                      : item.tagStatus === "pending"
                        ? "Waiting for the AI to check the photo…"
                        : item.tagStatus === "failed"
                          ? "The AI couldn't check this photo. Look for any names before publishing."
                          : "Check the photo for any names before publishing."}
                  </span>
                  <Btn disabled={busy || pending} onClick={() => void act("publish")} style={{ alignSelf: "flex-start" }}>
                    Publish
                  </Btn>
                </div>
              )}
              {item.hiddenAt && <div className="lf-notice">Hidden from the public page.</div>}
              {item.status === "returned" && <div className="lf-notice">Returned to its owner.</div>}
              {note && (
                <div className={`lf-notice${note.warn ? " warn" : ""}`} role={note.warn ? "alert" : "status"}>
                  {note.text}
                </div>
              )}

              <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <TextField id="title" label="Title" value={form.title} max={120} onChange={(v) => set("title", v)} required />
                <label className="sd-label" htmlFor="lf-description">Description</label>
                <textarea
                  id="lf-description"
                  className="sd-input"
                  rows={3}
                  maxLength={1000}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
                <label className="sd-label" htmlFor="lf-category">Category</label>
                <select
                  id="lf-category"
                  className="sd-input"
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                >
                  {LF_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="sd-label" style={{ marginBottom: 6 }}>Colors</legend>
                  <div className="lf-filters">
                    {LF_COLORS.map((c) => {
                      const on = form.colors.includes(c);
                      return (
                        <label key={c} className="lf-chip" aria-pressed={on}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              set("colors", on ? form.colors.filter((x) => x !== c) : [...form.colors, c])
                            }
                          />
                          <Swatch color={c} />
                          {c}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <TextField id="brand" label="Brand" value={form.brand} max={80} onChange={(v) => set("brand", v)} />
                <TextField id="material" label="Material" value={form.material} max={80} onChange={(v) => set("material", v)} />
                <TextField
                  id="visible-text"
                  label="Writing on it (staff only — never shown publicly)"
                  value={form.visibleText}
                  max={300}
                  onChange={(v) => set("visibleText", v)}
                />
                <TextField
                  id="tags"
                  label="Search keywords (comma separated)"
                  value={tagsText}
                  max={1000}
                  onChange={(v) => {
                    dirty.current = true;
                    setTagsText(v);
                  }}
                />
                <TextField id="location" label="Where it was found" value={form.location} max={120} onChange={(v) => set("location", v)} />
                <div className="lf-actions">
                  <Btn type="submit" disabled={busy}>Save</Btn>
                </div>
              </form>

              <div className="lf-actions" style={{ marginTop: 8 }}>
                {item.status === "found" ? (
                  <Btn kind="secondary" disabled={busy} onClick={() => void act("return")}>Mark returned</Btn>
                ) : (
                  <Btn kind="secondary" disabled={busy} onClick={() => void act("restore")}>Put back in lost &amp; found</Btn>
                )}
                {item.hiddenAt ? (
                  <Btn kind="ghost" disabled={busy} onClick={() => void act("unhide")}>Show publicly</Btn>
                ) : (
                  <Btn kind="ghost" disabled={busy} onClick={() => void act("hide")}>Hide from public</Btn>
                )}
                <Btn
                  kind="ghost"
                  disabled={busy || pending}
                  onClick={() => void act("retag", "Replace the description and tags with a fresh AI pass?")}
                >
                  Re-run AI
                </Btn>
                <Btn kind="ghost" disabled={busy} onClick={() => void remove()} style={{ color: "var(--warn)" }}>
                  Delete
                </Btn>
              </div>
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}

function TextField({
  id,
  label,
  value,
  max,
  onChange,
  required,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <>
      <label className="sd-label" htmlFor={`lf-${id}`}>{label}</label>
      <input
        id={`lf-${id}`}
        className="sd-input"
        value={value}
        maxLength={max}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </>
  );
}

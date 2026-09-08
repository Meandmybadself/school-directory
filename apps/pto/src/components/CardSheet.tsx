// One card, opened. Title, description, due date, labels, assignees, comments,
// and the two ways out (move column, delete).
//
// English-only, like the rest of the board — authoring chrome, the same call the
// calendar's and newsletter's admin screens make.
//
// EVERY WRITE RETURNS THE WHOLE BOARD, and this component hands that straight to
// its parent rather than patching a local copy. That is deliberate: a board is
// shared, `position` is last-write-wins by design (migration 0024), and the
// server's copy is the only one that knows what somebody else just did. Patching
// locally would make this screen quietly diverge from the board behind it.
import { useEffect, useState } from "react";
import type { PtoBoardDetailDTO, PtoCardDTO, PtoCommentDTO, PtoPersonDTO } from "@sd/shared";
import { Btn } from "./atoms.js";
import { Icon } from "./Icon.js";
import { SheetOver } from "./parts.js";
import { api, errorMessage } from "../lib/api.js";

/** `due_at` is stored as an ISO instant; `<input type="datetime-local">` wants
 *  wall-clock text with no zone. Convert through the LOCAL offset so a due date
 *  set at 5pm reads as 5pm to the person who set it. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function Comments({ cardId }: { cardId: string }) {
  const [comments, setComments] = useState<PtoCommentDTO[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void api
      .comments(cardId)
      .then((r) => live && setComments(r.comments))
      .catch(() => live && setComments([]));
    return () => {
      live = false;
    };
  }, [cardId]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    try {
      setComments((await api.addComment(cardId, draft.trim())).comments);
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p className="sd-eyebrow">Discussion</p>
      {comments === null ? (
        <div className="sd-meta">Loading…</div>
      ) : (
        comments.map((c) => (
          <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div className="sd-row" style={{ gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{c.authorName}</span>
              <span className="sd-meta" style={{ flex: 1 }}>
                {new Date(c.createdAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              {c.isYou && (
                <button
                  type="button"
                  aria-label="Delete comment"
                  style={{ background: "none", border: 0, color: "var(--ink-3)", cursor: "pointer" }}
                  onClick={() =>
                    void api.deleteComment(c.id).then((r) => setComments(r.comments))
                  }
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{c.body}</div>
          </div>
        ))
      )}
      <form onSubmit={send} className="sd-row" style={{ gap: 8 }}>
        <input
          className="sd-input"
          placeholder="Add a note…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ flex: 1 }}
        />
        <Btn type="submit" sm disabled={busy || !draft.trim()}>
          Post
        </Btn>
      </form>
    </div>
  );
}

export function CardSheet({
  board,
  card,
  roster,
  onBoard,
  onClose,
}: {
  board: PtoBoardDetailDTO;
  card: PtoCardDTO;
  roster: PtoPersonDTO[];
  onBoard: (board: PtoBoardDetailDTO) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [due, setDue] = useState(toLocalInput(card.dueAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const assigned = new Set(card.assignees.map((a) => a.id).filter((id): id is string => !!id));

  const run = async (fn: () => Promise<{ board: PtoBoardDetailDTO }>) => {
    setBusy(true);
    setError(null);
    try {
      onBoard((await fn()).board);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that."));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(() =>
      api.patchCard(card.id, {
        title: title.trim() || card.title,
        description: description.trim() || null,
        dueAt: fromLocalInput(due),
      }),
    );

  const toggleLabel = (labelId: string) => {
    const next = card.labelIds.includes(labelId)
      ? card.labelIds.filter((id) => id !== labelId)
      : [...card.labelIds, labelId];
    void run(() => api.patchCard(card.id, { labelIds: next }));
  };

  const toggleAssignee = (personId: string) => {
    const next = assigned.has(personId)
      ? [...assigned].filter((id) => id !== personId)
      : [...assigned, personId];
    void run(() => api.setAssignees(card.id, next));
  };

  return (
    <SheetOver onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <input
          className="sd-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() !== card.title && void save()}
          style={{ fontSize: 16, fontWeight: 700 }}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="sd-label">Notes</span>
          <textarea
            className="sd-input"
            rows={4}
            value={description}
            placeholder="What needs doing, who's been asked, what's blocking it…"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => (description.trim() || null) !== card.description && void save()}
            style={{ resize: "vertical", lineHeight: 1.5 }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="sd-label">Due</span>
          <input
            className="sd-input"
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            onBlur={() => fromLocalInput(due) !== card.dueAt && void save()}
          />
        </div>

        {board.labels.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="sd-label">Labels</span>
            <div className="sd-row" style={{ gap: 6, flexWrap: "wrap" }}>
              {board.labels.map((l) => {
                const on = card.labelIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => toggleLabel(l.id)}
                    className={`pb-label ${l.color}`}
                    style={{
                      border: on ? "2px solid currentColor" : "2px solid transparent",
                      cursor: "pointer",
                      font: "inherit",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="sd-label">Who's doing it</span>
          {roster.length === 0 ? (
            <p className="sd-meta">
              Nobody to assign yet — a system admin has to name the PTO board group in Settings, and
              its roster is what fills this list.
            </p>
          ) : (
            <div className="sd-row" style={{ gap: 6, flexWrap: "wrap" }}>
              {roster.map((p) => {
                const on = assigned.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleAssignee(p.id)}
                    className="pb-assignee"
                    style={{
                      cursor: "pointer",
                      border: on ? "1px solid var(--blue)" : "1px solid transparent",
                      background: on ? "var(--blue-tint)" : "var(--bg-2)",
                      color: on ? "var(--blue-700)" : "var(--ink-2)",
                      fontSize: 12,
                      padding: "4px 10px",
                    }}
                  >
                    {on && <Icon name="check" size={12} stroke={2.4} />}
                    {p.displayName}
                  </button>
                );
              })}
            </div>
          )}
          {/* An assignee the enumeration gate withheld from this viewer
              (invariant 21). Shown so the card doesn't read as unclaimed, and
              not removable here — you can't take off a chip you can't identify.
              A viewer who CAN see them (a system admin, or their Controller)
              still can. */}
          {card.assignees.some((a) => a.id === null) && (
            <p className="sd-meta">
              {card.assignees.filter((a) => a.id === null).length} assignee(s) on this card are not
              listed in the directory for you.
            </p>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="sd-label">Column</span>
          <select
            className="sd-input"
            value={card.listId}
            onChange={(e) => void run(() => api.moveCard(card.id, { listId: e.target.value }))}
          >
            {board.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
          {/* The keyboard/no-pointer path to what dragging does. Not an
              afterthought: a board that can only be reorganised by dragging is a
              board a screen-reader user cannot use at all. */}
          <span className="sd-meta">Or drag the card between columns.</span>
        </div>

        <Comments cardId={card.id} />

        {error && <div className="sd-meta" style={{ color: "var(--warn)" }}>{error}</div>}

        <div className="sd-row" style={{ gap: 8 }}>
          <Btn kind="secondary" onClick={onClose} disabled={busy} style={{ flex: 1 }}>
            Done
          </Btn>
          {confirmDelete ? (
            <Btn
              kind="secondary"
              style={{ color: "var(--warn)", borderColor: "var(--warn)" }}
              disabled={busy}
              onClick={() =>
                void run(() => api.deleteCard(card.id)).then(onClose)
              }
            >
              Really delete
            </Btn>
          ) : (
            <Btn kind="ghost" onClick={() => setConfirmDelete(true)} disabled={busy}>
              Delete
            </Btn>
          )}
        </div>
      </div>
    </SheetOver>
  );
}

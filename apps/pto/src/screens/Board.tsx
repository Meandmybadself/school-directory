// One board: a horizontal strip of columns with cards in them.
//
// DRAG AND DROP IS THE HTML5 API, with no library. Two reasons, and the second
// is the one that matters: a drag library would be the first runtime dependency
// in this project that isn't React or the router, added for one screen; and the
// thing being dragged is small and the drop targets are large, which is exactly
// the case the native API handles well. What the native API does NOT give is a
// keyboard path, so the card sheet carries a column `<select>` that does the
// same write — see CardSheet.tsx.
//
// The drop indicator is computed from the pointer against each card's midpoint
// and rendered as a LINE rather than by opening a gap. A gap reflows the column
// under the cursor, which makes the target move as you approach it.
//
// TWO THINGS ABOUT THE DRAGGED CARD, both learned the hard way.
//
// It stays RENDERED while it is being dragged, faded by `.pb-card.dragging`,
// rather than being filtered out of its column. Filtering it out was the first
// spelling and it was wrong twice over: the column's count is `list.cards.length`
// and would then disagree with what the column actually showed, and — worse — an
// abandoned drag left the card invisible in BOTH columns until the next reload,
// because nothing had told the source column to put it back. A card that is
// merely faded cannot go missing.
//
// And the drop target is named by the id of the card to land BEFORE, never by a
// numeric index. An index has to be interpreted against some particular array,
// and the two arrays in play here — what is rendered (includes the dragged card)
// and what the position is computed from (excludes it) — are off by one from each
// other exactly when the drag is within its own column. Naming the neighbour
// makes that impossible to get wrong, and it is the same reason the API takes
// `afterCardId`/`beforeCardId` rather than a position.
//
// EVERY MUTATION RE-RENDERS FROM THE SERVER'S PAYLOAD. `/pto/*` writes return
// the whole board, and this screen throws away its local copy each time. That is
// the right trade here: `position` is last-write-wins by design (migration
// 0024), so the server is the only party that knows what somebody else just did,
// and an optimistic local update would show a card in a place it isn't.
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { PtoBoardDetailDTO, PtoCardDTO, PtoListDTO, PtoPersonDTO } from "@sd/shared";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { CardSheet } from "../components/CardSheet.js";
import { Btn, Tag } from "../components/atoms.js";
import { Icon } from "../components/Icon.js";
import { ScreenHeader } from "../components/parts.js";
import { api, errorMessage, CALENDAR_URL } from "../lib/api.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";

/** Where a dragged card would land: a column, and the card it should land
 *  BEFORE — `null` meaning "at the end of that column". Never an index; see the
 *  header. */
interface DropHint {
  listId: string;
  beforeCardId: string | null;
}

function dueClass(iso: string | null): string {
  if (!iso) return "due";
  return new Date(iso).getTime() < Date.now() ? "due overdue" : "due";
}

function dueLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function CardTile({
  card,
  labels,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  card: PtoCardDTO;
  labels: PtoBoardDetailDTO["labels"];
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const mine = labels.filter((l) => card.labelIds.includes(l.id));
  return (
    <div
      className={`pb-card${dragging ? " dragging" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {mine.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {mine.map((l) => (
            <span key={l.id} className={`pb-label ${l.color}`}>
              {l.name}
            </span>
          ))}
        </div>
      )}
      <div className="pb-card-title">{card.title}</div>
      {(card.assignees.length > 0 || card.dueAt || card.commentCount > 0) && (
        <div className="pb-card-meta">
          {card.dueAt && <span className={dueClass(card.dueAt)}>{dueLabel(card.dueAt)}</span>}
          {card.assignees.map((a, i) => (
            <span key={a.id ?? `withheld-${i}`} className={`pb-assignee${a.id ? "" : " withheld"}`}>
              {a.displayName}
            </span>
          ))}
          {card.commentCount > 0 && (
            <span>
              <Icon name="mail" size={11} stroke={2} /> {card.commentCount}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Column({
  list,
  board,
  draggingId,
  hint,
  onHint,
  onDrop,
  onOpenCard,
  onDragStart,
  onDragEnd,
  onAddCard,
  onRename,
  onDelete,
}: {
  list: PtoListDTO;
  board: PtoBoardDetailDTO;
  draggingId: string | null;
  hint: DropHint | null;
  onHint: (hint: DropHint | null) => void;
  onDrop: () => void;
  onOpenCard: (card: PtoCardDTO) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onAddCard: (listId: string, title: string) => void;
  onRename: (listId: string, title: string) => void;
  onDelete: (listId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState(list.title);

  useEffect(() => setTitle(list.title), [list.title]);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    // The dragged card is skipped when choosing a neighbour — pointing at the
    // card you are holding means "leave it here", not "insert before yourself".
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-card-id]")).filter(
      (el) => el.dataset.cardId !== draggingId,
    );
    let beforeCardId: string | null = null;
    for (const el of cards) {
      const box = el.getBoundingClientRect();
      if (e.clientY < box.top + box.height / 2) {
        beforeCardId = el.dataset.cardId ?? null;
        break;
      }
    }
    onHint({ listId: list.id, beforeCardId });
  };

  const submitCard = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    onAddCard(list.id, draft.trim());
    setDraft("");
    setAdding(false);
  };

  return (
    <section className="pb-col">
      <div className="pb-col-head">
        <input
          className="pb-col-title"
          value={title}
          aria-label="Column name"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title.trim() !== list.title && onRename(list.id, title.trim())}
        />
        <span className="pb-col-count">{list.cards.length}</span>
        <button
          type="button"
          aria-label={`Delete column ${list.title}`}
          title="Delete this column and its cards"
          style={{ background: "none", border: 0, color: "var(--ink-3)", cursor: "pointer" }}
          onClick={() => onDelete(list.id)}
        >
          <Icon name="x" size={14} />
        </button>
      </div>

      <div className="pb-cards" onDragOver={onDragOver} onDrop={onDrop} onDragLeave={() => onHint(null)}>
        {list.cards.map((c) => (
          <div key={c.id} data-card-id={c.id}>
            {hint?.listId === list.id && hint.beforeCardId === c.id && <div className="pb-drop" />}
            <CardTile
              card={c}
              labels={board.labels}
              dragging={draggingId === c.id}
              onOpen={() => onOpenCard(c)}
              onDragStart={() => onDragStart(c.id)}
              onDragEnd={onDragEnd}
            />
          </div>
        ))}
        {hint?.listId === list.id && hint.beforeCardId === null && <div className="pb-drop" />}
      </div>

      {adding ? (
        <form onSubmit={submitCard} style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            className="sd-input"
            autoFocus
            placeholder="What needs doing?"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => !draft.trim() && setAdding(false)}
          />
          <Btn type="submit" sm disabled={!draft.trim()}>
            Add
          </Btn>
        </form>
      ) : (
        <button type="button" className="pb-addcard" onClick={() => setAdding(true)}>
          + Add a card
        </button>
      )}
    </section>
  );
}

function BoardHeader({
  board,
  onBoard,
  onGone,
}: {
  board: PtoBoardDetailDTO;
  onBoard: (b: PtoBoardDetailDTO) => void;
  onGone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [impact, setImpact] = useState<{ cards: number; comments: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // Counted BEFORE the delete, because none of it is countable afterwards and
  // none of it is recoverable — the obligation invariants 13 and 25 both state.
  const askDelete = async () => {
    setConfirming(true);
    try {
      setImpact((await api.boardImpact(board.id)).impact);
    } catch {
      setImpact(null);
    }
  };

  const when = board.event?.start
    ? new Date(board.event.start).toLocaleDateString(undefined, {
        ...(board.event.allDay ? { timeZone: "UTC" } : {}),
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div style={{ padding: "12px 16px 4px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="sd-row" style={{ gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <h1 className="sd-h2" style={{ margin: 0 }}>
          {board.title}
        </h1>
        {board.archived && <Tag tone="line">Archived</Tag>}
        <div style={{ flex: 1 }} />
        <Btn
          sm
          kind="ghost"
          onClick={() => void api.patchBoard(board.id, { archived: !board.archived }).then((r) => onBoard(r.board))}
        >
          {board.archived ? "Unarchive" : "Archive"}
        </Btn>
        <Btn sm kind="ghost" onClick={() => void askDelete()}>
          Delete
        </Btn>
      </div>

      {board.summary && <p className="sd-meta">{board.summary}</p>}

      {board.event && (
        <p className="sd-meta">
          <Icon name="calendar" size={12} stroke={2} />{" "}
          {board.event.path ? (
            <a className="sd-link" href={`${CALENDAR_URL}${board.event.path}`}>
              {board.event.title}
            </a>
          ) : (
            board.event.title
          )}
          {when ? ` · ${when}` : ""}
        </p>
      )}

      {confirming && (
        <div className="sd-card sd-card-pad" style={{ borderColor: "var(--warn)" }}>
          <div style={{ fontWeight: 700 }}>Delete “{board.title}”?</div>
          <p className="sd-meta" style={{ marginTop: 6 }}>
            {impact
              ? `This removes ${impact.cards} card(s) and ${impact.comments} comment(s). It cannot be undone — archiving keeps the board and hides it.`
              : "This cannot be undone. Archiving keeps the board and hides it."}
          </p>
          <div className="sd-row" style={{ gap: 8, marginTop: 10 }}>
            <Btn
              kind="secondary"
              style={{ color: "var(--warn)", borderColor: "var(--warn)" }}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void api.deleteBoard(board.id).then(onGone);
              }}
            >
              Delete permanently
            </Btn>
            <Btn kind="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function Body({ slug, onTitle }: { slug: string; onTitle: (title: string) => void }) {
  const navigate = useNavigate();
  const [board, setBoard] = useState<PtoBoardDetailDTO | null>(null);
  const [roster, setRoster] = useState<PtoPersonDTO[]>([]);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hint, setHint] = useState<DropHint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, r] = await Promise.all([api.board(slug), api.roster()]);
      setBoard(b.board);
      setRoster(r.people);
    } catch (err) {
      setNotFound(true);
      setError(errorMessage(err, "Couldn't load that board."));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // The shell's heading is rendered by `Board` below, which sits ABOVE the fetch
  // — so the board's name is handed up rather than passed down. The alternative
  // was lifting the whole load into `Board` and making this presentational,
  // which is a bigger change than one string is worth; the sibling apps' admin
  // screens show a section name here for exactly that reason. A board is the
  // one screen where the name IS the page.
  useEffect(() => {
    if (board) onTitle(board.title);
  }, [board, onTitle]);

  const run = async (fn: () => Promise<{ board: PtoBoardDetailDTO }>) => {
    setError(null);
    try {
      setBoard((await fn()).board);
    } catch (err) {
      setError(errorMessage(err, "That didn't save."));
    }
  };

  const drop = () => {
    const dragged = draggingId;
    const target = hint;
    setDraggingId(null);
    setHint(null);
    if (!dragged || !target || !board) return;

    const list = board.lists.find((l) => l.id === target.listId);
    if (!list) return;
    const without = list.cards.filter((c) => c.id !== dragged);
    const index =
      target.beforeCardId === null
        ? without.length
        : without.findIndex((c) => c.id === target.beforeCardId);
    // -1 means the neighbour we were told to land before is no longer in this
    // column — somebody else moved it while this drag was in the air. Dropping
    // "somewhere reasonable" would put the card where nobody asked; doing
    // nothing leaves it where it is, and the next render shows why.
    if (index < 0) return;

    // Neighbours, not an index, on the wire too: the server computes the
    // midpoint itself, so two clients working from slightly stale copies of the
    // column can't disagree about what "index 3" meant.
    void run(() =>
      api.moveCard(dragged, {
        listId: target.listId,
        afterCardId: without[index - 1]?.id ?? null,
        beforeCardId: without[index]?.id ?? null,
      }),
    );
  };

  if (notFound && !board) {
    return (
      <div style={{ padding: 24 }}>
        <div className="sd-h2">Board not found</div>
        <p className="sd-lead" style={{ marginTop: 8 }}>
          {error ?? "It may have been deleted."}
        </p>
        <Btn onClick={() => navigate("/boards")} style={{ marginTop: 14 }}>
          All boards
        </Btn>
      </div>
    );
  }
  if (!board) return <div style={{ padding: 24 }} className="sd-meta">Loading…</div>;

  const openCard =
    openCardId !== null
      ? board.lists.flatMap((l) => l.cards).find((c) => c.id === openCardId) ?? null
      : null;

  return (
    <>
      <BoardHeader board={board} onBoard={setBoard} onGone={() => navigate("/boards")} />
      {error && (
        <div className="sd-meta" style={{ color: "var(--warn)", padding: "0 16px 6px" }}>
          {error}
        </div>
      )}
      <div className="pb-strip">
        {board.lists.map((l) => (
          <Column
            key={l.id}
            list={l}
            board={board}
            draggingId={draggingId}
            hint={hint}
            onHint={setHint}
            onDrop={drop}
            onOpenCard={(c) => setOpenCardId(c.id)}
            onDragStart={setDraggingId}
            onDragEnd={() => {
              setDraggingId(null);
              setHint(null);
            }}
            onAddCard={(listId, title) => void run(() => api.createCard(board.id, { listId, title }))}
            onRename={(listId, title) => void run(() => api.renameList(listId, title))}
            onDelete={(listId) => void run(() => api.deleteList(listId))}
          />
        ))}
        <button
          type="button"
          className="pb-addcol"
          onClick={() => {
            const title = window.prompt("Name the column");
            if (title?.trim()) void run(() => api.createList(board.id, title.trim()));
          }}
        >
          + Add a column
        </button>
      </div>

      {openCard && (
        <CardSheet
          board={board}
          card={openCard}
          roster={roster}
          onBoard={setBoard}
          onClose={() => setOpenCardId(null)}
        />
      )}
    </>
  );
}

export function Board() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [title, setTitle] = useState("Board");
  // Stable, so the effect in `Body` that reports the name doesn't re-run on
  // every render of this one.
  const onTitle = useCallback((t: string) => setTitle(t), []);

  if (isDesktop) {
    return (
      <DesktopShell active="boards" title={title}>
        <Body slug={slug} onTitle={onTitle} />
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="boards" />}>
      <ScreenHeader title={title} left="arrowleft" onLeft={() => navigate("/boards")} />
      {/* `.sd-app` is exactly 100dvh, so the scrolling content has to sit in a
          `.sd-scroll` child — see CLAUDE.md, "Conventions". The board adds a
          SECOND axis inside that, and `.pb-strip` is the only element allowed to
          scroll horizontally: the page body must never, or the bottom nav would
          slide off with it. */}
      <div className="sd-scroll">
        <Body slug={slug} onTitle={onTitle} />
      </div>
    </AppShell>
  );
}

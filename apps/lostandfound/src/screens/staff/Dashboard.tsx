// The staff home: claims waiting on a person first, then the items.
//
// English-only, like the PTO boards and the calendar's admin: it is working
// chrome for the handful of people who run the lost and found. The navigation
// around it is translated, because that is shared with the public screens.
//
// Claimants' names and contacts appear here and nowhere else. They came from a
// public form, so they are shown as plain text and links, never as markup.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { LfClaimDTO, LfStaffItemDTO } from "@sd/shared";
import { Screen } from "../../components/Screen.js";
import { ItemCard } from "../../components/items.js";
import { Btn, Tag } from "../../components/atoms.js";
import { useI18n } from "../../i18n/index.js";
import { api, errorMessage } from "../../lib/api.js";
import { formatDayTime } from "../../lib/lf.js";

type Tab = "review" | "waiting" | "attention" | "hidden" | "returned";

/** Review comes first: every new item starts held, and the ones the AI found
 *  writing on stay held until someone looks at the photo — with claims, that is
 *  the daily job. "Waiting for owners" (`status=found`) means live publicly. */
const TABS: { key: Tab; label: string; filter: Parameters<typeof api.staffItems>[0] }[] = [
  { key: "review", label: "Needs review", filter: { view: "review" } },
  { key: "waiting", label: "Live — waiting for owners", filter: { status: "found" } },
  { key: "attention", label: "Needs attention", filter: { view: "attention" } },
  { key: "hidden", label: "Hidden", filter: { view: "hidden" } },
  { key: "returned", label: "Returned", filter: { status: "returned" } },
];

/** A contact as a link when it plainly is one. Anything else stays text. */
function ContactLink({ contact }: { contact: string }) {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
    return <a className="sd-link" href={`mailto:${contact}`}>{contact}</a>;
  }
  if (/^[\d\s()+.-]{7,}$/.test(contact)) {
    return <a className="sd-link" href={`tel:${contact.replace(/[^\d+]/g, "")}`}>{contact}</a>;
  }
  return <span>{contact}</span>;
}

export function Dashboard() {
  const { locale } = useI18n();
  const [claims, setClaims] = useState<LfClaimDTO[] | null>(null);
  const [tab, setTab] = useState<Tab>("review");
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [items, setItems] = useState<LfStaffItemDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNote, setRetryNote] = useState<string | null>(null);

  const loadClaims = () =>
    api
      .claims()
      .then((r) => setClaims(r.claims))
      .catch((err) => setError(errorMessage(err, "Couldn't load claims.")));

  const loadItems = (which: Tab) => {
    setItems(null);
    return api
      .staffItems(TABS.find((x) => x.key === which)!.filter)
      .then((r) => {
        setItems(r.items);
        if (which === "review") setReviewCount(r.items.length);
      })
      .catch((err) => setError(errorMessage(err, "Couldn't load items.")));
  };

  // The review count rides on the tab label whichever tab is open.
  const loadReviewCount = () =>
    api
      .staffItems({ view: "review" })
      .then((r) => setReviewCount(r.items.length))
      .catch(() => {});

  useEffect(() => {
    void loadClaims();
    void loadReviewCount();
  }, []);
  useEffect(() => {
    void loadItems(tab);
  }, [tab]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await Promise.all([loadClaims(), loadItems(tab), loadReviewCount()]);
    } catch (err) {
      setError(errorMessage(err, "That didn't work. Try again."));
    }
  };

  const retry = async () => {
    setRetryNote("Retrying…");
    try {
      const { retried } = await api.retagFailed();
      setRetryNote(retried ? `Retried ${retried}.` : "Nothing to retry.");
      await loadItems(tab);
    } catch (err) {
      setRetryNote(errorMessage(err, "Couldn't retry."));
    }
  };

  return (
    <Screen active="staff" title="Lost & found staff">
      <div className="lf-page">
        <div className="lf-actions">
          <Link className="sd-btn sd-btn-primary" to="/staff/upload">
            Add found items
          </Link>
        </div>

        {error && <div className="lf-notice warn" role="alert">{error}</div>}

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 className="sd-h2">Claims</h2>
          {claims === null ? (
            <div className="sd-meta">Loading…</div>
          ) : claims.length === 0 ? (
            <div className="sd-meta">No open claims.</div>
          ) : (
            claims.map((c) => (
              <div key={c.id} className="sd-card sd-card-pad lf-claim">
                <Link to={`/staff/item/${c.itemId}`}>
                  <img src={c.thumbUrl} alt={c.itemTitle || "Found item"} />
                </Link>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <div>
                    <b>{c.name}</b> says{" "}
                    <Link className="sd-link" to={`/staff/item/${c.itemId}`}>
                      {c.itemTitle || "this item"}
                    </Link>{" "}
                    is theirs
                  </div>
                  <ContactLink contact={c.contact} />
                  {c.message && <div style={{ overflowWrap: "anywhere" }}>“{c.message}”</div>}
                  <div className="sd-meta">{formatDayTime(c.createdAt, locale)}</div>
                  <div className="lf-actions" style={{ marginTop: 4 }}>
                    <Btn sm onClick={() => void act(() => api.itemAction(c.itemId, "return"))}>
                      Mark returned
                    </Btn>
                    <Btn sm kind="ghost" onClick={() => void act(() => api.dismissClaim(c.id))}>
                      Dismiss
                    </Btn>
                  </div>
                </div>
              </div>
            ))
          )}
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          <h2 className="sd-h2">Items</h2>
          <div className="lf-filters" role="tablist">
            {TABS.map((x) => (
              <button
                key={x.key}
                type="button"
                role="tab"
                aria-selected={tab === x.key}
                aria-pressed={tab === x.key}
                className="lf-chip"
                onClick={() => setTab(x.key)}
              >
                {x.label}
                {x.key === "review" && reviewCount ? ` (${reviewCount})` : ""}
              </button>
            ))}
            {tab === "attention" && (
              <Btn sm kind="ghost" onClick={() => void retry()}>
                Retry AI on failed items
              </Btn>
            )}
            {retryNote && <span className="sd-meta">{retryNote}</span>}
          </div>

          {items === null ? (
            <div className="sd-meta">Loading…</div>
          ) : (
            <div className="lf-grid">
              {items.length === 0 && <div className="lf-empty">Nothing here.</div>}
              {items.map((item) => (
                <ItemCard
                  key={item.id}
                  to={`/staff/item/${item.id}`}
                  item={{ ...item, untitled: !item.title }}
                  extra={<Badges item={item} />}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </Screen>
  );
}

function Badges({ item }: { item: LfStaffItemDTO }) {
  const badges: React.ReactNode[] = [];
  if (item.openClaims > 0)
    badges.push(<Tag key="c" tone="blue">{item.openClaims} claim{item.openClaims === 1 ? "" : "s"}</Tag>);
  if (item.tagStatus === "pending") badges.push(<Tag key="p" tone="line">AI working</Tag>);
  if (item.tagStatus === "failed") badges.push(<Tag key="f" tone="orange">AI failed</Tag>);
  if (item.donateDue) badges.push(<Tag key="d" tone="orange">Time to donate</Tag>);
  if (item.heldAt) badges.push(<Tag key="r" tone="orange">Held — check photo</Tag>);
  if (item.hiddenAt) badges.push(<Tag key="h" tone="line">Hidden</Tag>);
  if (!badges.length) return null;
  return <div className="lf-tags">{badges}</div>;
}

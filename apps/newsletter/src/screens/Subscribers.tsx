// The standalone subscriber list — addresses with no directory account (staff,
// grandparents, room parents).
//
// Members are NOT listed here: they're subscribed by virtue of having an active
// account and can opt themselves out from the preferences screen. What the admin
// needs to see instead is the combined audience size, which is what actually
// determines how many emails a send produces.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { NewsletterSubscriberDTO } from "@sd/shared";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, Field } from "../components/parts.js";
import { Btn } from "../components/atoms.js";
import { Icon } from "../components/Icon.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, errorMessage } from "../lib/api.js";

export function Subscribers() {
  const desktop = useIsDesktop();
  const navigate = useNavigate();

  const [subscribers, setSubscribers] = useState<NewsletterSubscriberDTO[]>([]);
  const [audienceTotal, setAudienceTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .subscribers()
      .then((r) => {
        setSubscribers(r.subscribers);
        setAudienceTotal(r.audienceTotal);
      })
      .catch((err: unknown) => setError(errorMessage(err, "Couldn't load subscribers.")))
      .finally(() => setLoading(false));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.addSubscriber(email.trim());
      setEmail("");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Couldn't add that address."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (subscriber: NewsletterSubscriberDTO) => {
    if (!window.confirm(`Stop sending the newsletter to ${subscriber.email}?`)) return;
    try {
      await api.removeSubscriber(subscriber.id);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Couldn't remove that address."));
    }
  };

  const active = subscribers.filter((s) => s.subscribed);
  const removed = subscribers.filter((s) => !s.subscribed);

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {error && <p className="sd-lead" style={{ color: "var(--warn)", margin: 0 }}>{error}</p>}

      <div className="sd-card" style={{ padding: "14px 16px" }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.6px" }}>{audienceTotal}</div>
        <p className="sd-meta" style={{ margin: "2px 0 0" }}>
          people will receive the next issue — active members who haven't opted out,
          plus the addresses below.
        </p>
      </div>

      <div className="nlx-formgrid">
        <Field label="Add an address" hint="For people without a directory account.">
          <div className="sd-row" style={{ gap: 8 }}>
            <input
              className="sd-input"
              type="email"
              value={email}
              placeholder="grandparent@example.com"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
            />
            <Btn icon="plus" onClick={() => void add()} disabled={busy || !email.trim()}>Add</Btn>
          </div>
        </Field>
      </div>

      {loading && <div className="sd-spinner" style={{ margin: "24px auto" }} />}

      {!loading && active.length === 0 && (
        <p className="sd-meta">No standalone addresses yet.</p>
      )}

      {active.map((s) => (
        <div key={s.id} className="sd-row" style={{ gap: 10, padding: "10px 2px", borderBottom: "1px solid var(--line)" }}>
          <Icon name="mail" size={16} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
          <span style={{ fontSize: 14.5, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{s.email}</span>
          <button
            className="nlx-mini danger"
            onClick={() => void remove(s)}
            aria-label={`Remove ${s.email}`}
          >
            Remove
          </button>
        </div>
      ))}

      {removed.length > 0 && (
        <details>
          <summary className="sd-meta" style={{ cursor: "pointer" }}>
            {removed.length} unsubscribed
          </summary>
          <div style={{ marginTop: 8 }}>
            {removed.map((s) => (
              <div key={s.id} className="sd-meta" style={{ padding: "5px 2px", overflowWrap: "anywhere" }}>
                {s.email}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );

  if (desktop) {
    return <DesktopShell active="admin" title="Subscribers">{body}</DesktopShell>;
  }
  return (
    <AppShell bottomNav={<BottomNav active="admin" />}>
      <ScreenHeader title="Subscribers" onLeft={() => navigate("/admin/settings")} />
      <div className="sd-scroll" style={{ padding: "14px 16px 24px" }}>{body}</div>
    </AppShell>
  );
}

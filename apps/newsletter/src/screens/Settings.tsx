// Newsletter configuration: who it comes from, what the footer says, how it
// looks, and what a new events block defaults to. One JSON blob behind the
// existing `setting` table, so this is a plain load/edit/save form.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { NewsletterSettingsDTO } from "@sd/shared";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, Field, SectLabel } from "../components/parts.js";
import { Btn } from "../components/atoms.js";
import { Icon } from "../components/Icon.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { useCalendarFeeds } from "../lib/useCalendarFeeds.js";
import { api, errorMessage } from "../lib/api.js";

const LOOKAHEAD_CHOICES = [7, 14, 30, 60];

export function Settings() {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const feeds = useCalendarFeeds();
  const logoInput = useRef<HTMLInputElement>(null);

  const [settings, setSettings] = useState<NewsletterSettingsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then((r) => setSettings(r.settings))
      .catch((err: unknown) => setError(errorMessage(err, "Couldn't load settings.")));
  }, []);

  const edit = (patch: Partial<NewsletterSettingsDTO>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setNote(null);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api.saveSettings(settings);
      // The server coerces each field; showing what it stored is more honest
      // than showing what was typed.
      setSettings(r.settings);
      setNote("Settings saved.");
    } catch (err) {
      setError(errorMessage(err, "Couldn't save settings."));
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File) => {
    try {
      const { url } = await api.uploadMedia(file);
      edit({ logoUrl: url });
    } catch (err) {
      setError(errorMessage(err, "That logo couldn't be uploaded."));
    }
  };

  if (!settings) {
    return (
      <AppShell>
        <div className="sd-scroll" style={{ display: "grid", placeItems: "center" }}>
          {error ? <p className="sd-lead" style={{ color: "var(--warn)" }}>{error}</p> : <div className="sd-spinner" />}
        </div>
      </AppShell>
    );
  }

  const toggleCalendar = (calendarId: string) => {
    const ids = settings.defaultCalendarIds;
    edit({
      defaultCalendarIds: ids.includes(calendarId)
        ? ids.filter((c) => c !== calendarId)
        : [...ids, calendarId],
    });
  };

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {error && <p className="sd-lead" style={{ color: "var(--warn)", margin: 0 }}>{error}</p>}

      <section className="nlx-formgrid">
        <SectLabel>Sender</SectLabel>
        <div className="nlx-formrow">
          <Field label="From name">
            <input className="sd-input" value={settings.senderName}
              onChange={(e) => edit({ senderName: e.target.value })} />
          </Field>
          <Field
            label="From address"
            hint="Must be a sender Resend has verified for this domain. Leave blank to use the instance default."
          >
            <input className="sd-input" type="email" value={settings.senderEmail}
              placeholder="newsletter@example.school"
              onChange={(e) => edit({ senderEmail: e.target.value })} />
          </Field>
        </div>
        <Field label="Reply-to" hint="Optional. Where replies go, if not the From address.">
          <input className="sd-input" type="email" value={settings.replyTo ?? ""}
            onChange={(e) => edit({ replyTo: e.target.value || null })} />
        </Field>
      </section>

      <section className="nlx-formgrid">
        <SectLabel>Footer</SectLabel>
        <Field label="Footer text">
          <textarea className="sd-input" rows={2} value={settings.footerText}
            onChange={(e) => edit({ footerText: e.target.value })} />
        </Field>
        <Field label="Mailing address" hint="Bulk email is expected to carry a physical address.">
          <textarea className="sd-input" rows={2} value={settings.mailingAddress}
            onChange={(e) => edit({ mailingAddress: e.target.value })} />
        </Field>
        <Field label="Unsubscribe wording" hint="Appears just before the unsubscribe link.">
          <input className="sd-input" value={settings.unsubscribeWording}
            onChange={(e) => edit({ unsubscribeWording: e.target.value })} />
        </Field>
      </section>

      <section className="nlx-formgrid">
        <SectLabel>Branding</SectLabel>
        <Field label="Newsletter title" hint="The masthead, shown above every issue.">
          <input className="sd-input" value={settings.newsletterTitle}
            onChange={(e) => edit({ newsletterTitle: e.target.value })} />
        </Field>
        <div className="nlx-formrow">
          <Field label="Accent color" hint="Hex, e.g. #0068A8.">
            <div className="sd-row" style={{ gap: 8 }}>
              <input type="color" value={settings.accentColor} aria-label="Accent color"
                style={{ width: 44, height: 40, padding: 2, border: "1px solid var(--line)", borderRadius: 9, background: "var(--paper)" }}
                onChange={(e) => edit({ accentColor: e.target.value.toUpperCase() })} />
              <input className="sd-input" value={settings.accentColor}
                onChange={(e) => edit({ accentColor: e.target.value })} />
            </div>
          </Field>
          <Field label="Logo" hint="Optional. Replaces the title text in the masthead.">
            <div className="sd-row" style={{ gap: 8, flexWrap: "wrap" }}>
              {settings.logoUrl && (
                <img src={settings.logoUrl} alt="" style={{ height: 40, borderRadius: 6 }} />
              )}
              <button className="sd-btn sd-btn-ghost" onClick={() => logoInput.current?.click()}>
                <Icon name="upload" size={16} /> {settings.logoUrl ? "Replace" : "Upload"}
              </button>
              {settings.logoUrl && (
                <button className="sd-btn sd-btn-ghost" onClick={() => edit({ logoUrl: null })}>Remove</button>
              )}
              <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadLogo(file);
                }} />
            </div>
          </Field>
        </div>
      </section>

      <section className="nlx-formgrid">
        <SectLabel>Event defaults</SectLabel>
        <p className="sd-meta" style={{ margin: 0 }}>
          Pre-fills each new “upcoming events” block. Individual blocks can still
          override both.
        </p>
        <Field label="Default window">
          <div className="nlx-chips">
            {LOOKAHEAD_CHOICES.map((d) => (
              <button key={d} type="button"
                className={`nlx-chip${d === settings.defaultLookaheadDays ? " on" : ""}`}
                onClick={() => edit({ defaultLookaheadDays: d })}>
                {d} days
              </button>
            ))}
          </div>
        </Field>
        <Field label="Default calendars" hint="None selected means every calendar.">
          <div className="nlx-chips">
            <button type="button"
              className={`nlx-chip${settings.defaultCalendarIds.length === 0 ? " on" : ""}`}
              onClick={() => edit({ defaultCalendarIds: [] })}>
              All
            </button>
            {feeds.map((f) => (
              <button key={f.id} type="button"
                className={`nlx-chip${settings.defaultCalendarIds.includes(f.id) ? " on" : ""}`}
                onClick={() => toggleCalendar(f.id)}>
                <span className="nlx-dot" style={{ background: f.color }} />
                {f.name}
              </button>
            ))}
          </div>
        </Field>
      </section>

      <div className="sd-row" style={{ gap: 12 }}>
        <Btn icon="check" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Btn>
        {note && <span className="sd-meta">{note}</span>}
        <div style={{ flex: 1 }} />
        <button className="sd-btn sd-btn-ghost" onClick={() => navigate("/admin/subscribers")}>
          <Icon name="users3" size={16} /> Subscribers
        </button>
      </div>
    </div>
  );

  if (desktop) {
    return <DesktopShell active="admin" title="Newsletter settings">{body}</DesktopShell>;
  }
  return (
    <AppShell bottomNav={<BottomNav active="admin" />}>
      <ScreenHeader title="Settings" onLeft={() => navigate("/admin")} />
      <div className="sd-scroll" style={{ padding: "14px 16px 24px" }}>{body}</div>
    </AppShell>
  );
}

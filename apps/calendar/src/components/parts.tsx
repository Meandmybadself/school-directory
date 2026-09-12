// Composites shared by the calendar screens — the subset of apps/web's
// parts.tsx that isn't tied to the directory's Person/Contact domain, copied so
// the two apps can drift independently.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon.js";
import { useChrome } from "./chrome.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";

export function IconBtn({
  name,
  badge,
  tone,
  onClick,
  label,
}: {
  name: IconName;
  badge?: boolean;
  tone?: "blue";
  onClick?: () => void;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label || name}
      style={{
        width: 38, height: 38, borderRadius: 10, border: "1px solid var(--line)", background: "var(--paper)",
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative",
        color: tone === "blue" ? "var(--blue-700)" : "var(--ink-2)",
      }}
    >
      <Icon name={name} size={19} />
      {badge && <span style={{ position: "absolute", top: 7, right: 7, width: 7, height: 7, borderRadius: 4, background: "var(--orange)", boxShadow: "0 0 0 2px var(--paper)" }} />}
    </button>
  );
}

export function ScreenHeader({
  title,
  left = "arrowleft",
  right,
  onLeft,
}: {
  title: string;
  left?: IconName;
  right?: ReactNode;
  onLeft?: () => void;
}) {
  return (
    <div className="sd-appbar" style={{ justifyContent: "space-between", padding: "10px 12px" }}>
      <button onClick={onLeft} aria-label="Back" style={{ width: 36, height: 36, borderRadius: 9, border: 0, background: "transparent", color: "var(--ink-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        <Icon name={left} size={21} />
      </button>
      <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.2px", whiteSpace: "nowrap" }}>{title}</span>
      <div className="sd-row" style={{ gap: 6, display: "flex", justifyContent: "flex-end", flex: "0 0 auto" }}>
        {right}
        <HeaderActions />
      </div>
    </div>
  );
}

/** The language + account controls shown on the right of every mobile app bar.
 *  Wired to the chrome context that AppShell owns, so the language picker and the
 *  account menu are reachable from every mobile screen. Renders nothing outside a
 *  ChromeProvider (e.g. the desktop shell). */
function HeaderActions() {
  const { t, locale } = useI18n();
  const { me } = useSession();
  const chrome = useChrome();
  if (!chrome) return null;
  const langLabel = locale === "zh" ? "中文" : locale.toUpperCase();
  return (
    <>
      <button
        onClick={() => chrome.open("language")}
        aria-label={t("language")}
        title={t("language")}
        style={{ height: 34, minWidth: 34, padding: "0 9px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink-2)", fontWeight: 700, fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      >
        {langLabel}
      </button>
      {/* The account sheet is empty without a session (the calendar's agenda is
       *  public), so it's shown only to signed-in members. The language picker
       *  works signed-out too. */}
      {me && (
        <button
          onClick={() => chrome.open("account")}
          aria-label={t("yourProfile")}
          title={t("yourProfile")}
          style={{ width: 34, height: 34, borderRadius: 9, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          <Icon name="eye" size={18} />
        </button>
      )}
    </>
  );
}

export function SectLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="sd-sectlabel">
      <p className="sd-eyebrow">{children}</p>
      {action}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="sd-label" style={{ whiteSpace: "nowrap" }}>{label}</span>
      {children}
      {hint && <div className="sd-meta" style={{ lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

const SHEET_HOST_ID = "sd-sheet-host";

/** The element every sheet is portalled into, created on first use and reused.
 *  It copies the app root's scope classes because the design tokens live on
 *  `.sd` (and the Chinese type rules on `.sd-zh`): outside that scope every
 *  `var(--…)` inside a sheet computes to nothing and it renders unstyled.
 *  The `:not()` is so this never reads the classes back off the host itself. */
function sheetHost(): HTMLElement {
  let host = document.getElementById(SHEET_HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = SHEET_HOST_ID;
    document.body.appendChild(host);
  }
  host.className = document.querySelector(`.sd:not(#${SHEET_HOST_ID})`)?.className ?? "sd";
  return host;
}

/** A bottom sheet is rendered on <body>, NOT where it is called from, and that
 *  portal is load-bearing rather than tidiness. Screens put their content in
 *  `.sd-scroll`, and on iOS Safari a `position: fixed` descendant of that
 *  scroller is laid out and CLIPPED against the scroller instead of the
 *  viewport — so the scrim stopped short of the app bar, and a sheet tall
 *  enough to reach the bottom of the column had its last row cut off behind the
 *  bottom nav. The volunteer sign-up sheet is the one that hurt: the button
 *  that takes the spot was the row underneath. Desktop engines honour the
 *  z-index and were fine, which is why this only ever showed up on a phone.
 *  Rendering outside every ancestor is what makes `inset: 0` mean the viewport
 *  again on all of them. */
export function SheetOver({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  const host = useMemo(() => sheetHost(), []);
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "center" }}>
      <div className="sd-scrim" onClick={onClose} />
      <div className="sd-sheet" style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, bottom: 0, maxHeight: "92%", overflowY: "auto" }}>
        <div className="sd-grabber" />
        {/* Two padding declarations, deliberately: the sheet sits at the very
            bottom of the viewport, over the home indicator on a notched phone.
            An engine that can't parse `env()` drops the second and keeps the
            22px of the first — the same split `.sd-bottomnav` makes. */}
        <div style={{ padding: "4px 18px 22px", paddingBottom: "calc(22px + env(safe-area-inset-bottom, 0px))" }}>{children}</div>
      </div>
    </div>,
    host,
  );
}

export function OfflineBanner({ text = "Offline — showing your saved copy", readOnly = "Read-only" }: { text?: string; readOnly?: string }) {
  return (
    <div className="sd-banner banner-offline">
      <Icon name="wifioff" size={16} />{text}
      <span style={{ marginLeft: "auto", opacity: 0.7, fontWeight: 600 }}>{readOnly}</span>
    </div>
  );
}

export function MasqBanner({ user, text = "Viewing as", back = "Return to admin", onBack }: { user: string; text?: string; back?: string; onBack?: () => void }) {
  return (
    <div className="sd-banner banner-masq">
      <Icon name="shield" size={16} />{text} <strong style={{ fontWeight: 800 }}>{user}</strong>
      <button onClick={onBack} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "underline", background: "none", border: 0, color: "inherit", font: "inherit", fontWeight: 700, cursor: "pointer" }}>
        {back}<Icon name="chevright" size={14} />
      </button>
    </div>
  );
}

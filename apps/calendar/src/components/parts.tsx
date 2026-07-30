// Composites shared by the calendar screens — the subset of apps/web's
// parts.tsx that isn't tied to the directory's Person/Contact domain, copied so
// the two apps can drift independently.
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.js";

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
      {badge && <span style={{ position: "absolute", top: 7, right: 7, width: 7, height: 7, borderRadius: 4, background: "var(--orange)", boxShadow: "0 0 0 2px #fff" }} />}
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
      <div style={{ minWidth: 36, display: "flex", justifyContent: "flex-end" }}>{right}</div>
    </div>
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

export function SheetOver({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "center" }}>
      <div className="sd-scrim" onClick={onClose} />
      <div className="sd-sheet" style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, bottom: 0, maxHeight: "92%", overflowY: "auto" }}>
        <div className="sd-grabber" />
        <div style={{ padding: "4px 18px 22px" }}>{children}</div>
      </div>
    </div>
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

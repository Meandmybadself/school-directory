// Composites — ported from design_handoff/parts.jsx, wired for interactivity.
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon.js";
import { Avatar } from "./atoms.js";

export function SwitcherPill({
  name,
  sub,
  color,
  onClick,
}: {
  name: string;
  sub?: string;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <button
      className="sd-row"
      onClick={onClick}
      style={{ gap: 10, flex: 1, minWidth: 0, cursor: "pointer", background: "none", border: 0, padding: 0, textAlign: "left", font: "inherit" }}
    >
      <Avatar name={name} size={38} color={color} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="sd-row" style={{ gap: 5 }}>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
          <Icon name="chevdown" size={15} stroke={2.2} style={{ color: "var(--ink-3)", flex: "0 0 auto" }} />
        </div>
        {sub && (
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 600, marginTop: -1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
        )}
      </div>
    </button>
  );
}

export function AppBar({
  name,
  sub,
  color,
  trailing,
  onSwitcher,
}: {
  name: string;
  sub?: string;
  color?: string;
  trailing?: ReactNode;
  onSwitcher?: () => void;
}) {
  return (
    <div className="sd-appbar">
      <SwitcherPill name={name} sub={sub} color={color} onClick={onSwitcher} />
      <div className="sd-row" style={{ gap: 4, flex: "0 0 auto" }}>{trailing}</div>
    </div>
  );
}

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

export function ContactRow({
  icon,
  label,
  value,
  vis,
  sub,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  vis?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="sd-crow">
      <div className="sd-cicon"><Icon name={icon} size={17} /></div>
      <div className="sd-cmain">
        <div className="sd-clabel">{label}</div>
        <div className="sd-cval">{value}</div>
        {sub && <div className="sd-meta" style={{ marginTop: 2 }}>{sub}</div>}
      </div>
      {vis && <div style={{ flex: "0 0 auto", marginTop: 2 }}>{vis}</div>}
    </div>
  );
}

export function MemberRow({
  name,
  color,
  title,
  tags,
  trailing,
  img,
  onClick,
}: {
  name: string;
  color?: string;
  title?: ReactNode;
  tags?: ReactNode;
  trailing?: ReactNode;
  img?: string | null;
  onClick?: () => void;
}) {
  return (
    <div className="sd-mrow" onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      <Avatar name={name} size={40} color={color} img={img} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sd-row" style={{ gap: 7, flexWrap: "wrap", rowGap: 3 }}>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.2px", whiteSpace: "nowrap" }}>{name}</span>
          {tags}
        </div>
        {title && <div className="sd-meta" style={{ marginTop: 2 }}>{title}</div>}
      </div>
      {trailing && <div style={{ flex: "0 0 auto" }}>{trailing}</div>}
    </div>
  );
}

export function CTACard({
  icon = "pin",
  title,
  body,
  action,
  tone = "blue",
}: {
  icon?: IconName;
  title: string;
  body: string;
  action?: ReactNode;
  tone?: "blue" | "orange";
}) {
  const tint = tone === "orange" ? "var(--orange-tint)" : "var(--blue-tint)";
  const ink = tone === "orange" ? "var(--orange-700)" : "var(--blue)";
  return (
    <div className="sd-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, borderStyle: "dashed", borderColor: "var(--line-2)" }}>
      <div className="sd-row" style={{ gap: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: tint, color: ink, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
          <Icon name={icon} size={22} />
        </div>
        <div>
          <div className="sd-h2" style={{ fontSize: 16.5 }}>{title}</div>
          <div className="sd-lead" style={{ fontSize: 13.5, marginTop: 2 }}>{body}</div>
        </div>
      </div>
      {action}
    </div>
  );
}

export function GroupTile({
  icon,
  name,
  sub,
  color = "var(--blue)",
  tint = "var(--blue-tint)",
  onClick,
}: {
  icon: IconName;
  name: string;
  sub?: string;
  color?: string;
  tint?: string;
  onClick?: () => void;
}) {
  return (
    <div className="sd-card" style={{ padding: 13, display: "flex", alignItems: "center", gap: 11, cursor: "pointer" }} onClick={onClick}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: tint, color, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
        <Icon name={icon} size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: "-.2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        {sub && <div className="sd-meta" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
      </div>
      <Icon name="chevright" size={18} style={{ color: "var(--ink-3)" }} />
    </div>
  );
}

export function NeighborCard({
  name,
  dist,
  connected,
  connectText = "Connect",
  connectedText = "Connected",
  memberText = "Member",
}: {
  name: string;
  dist: string;
  connected?: boolean;
  connectText?: string;
  connectedText?: string;
  memberText?: string;
}) {
  return (
    <div className="sd-card sd-card-pad" style={{ padding: 13, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div className="sd-row" style={{ justifyContent: "space-between" }}>
        <Avatar name={name} size={42} />
        <span className="sd-tag" style={{ background: "var(--blue-tint)", color: "var(--blue-800)" }}>
          <Icon name="pin" size={11} stroke={2} />{dist}
        </span>
      </div>
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: "-.2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        <div className="sd-meta" style={{ marginTop: 1 }}>{memberText}</div>
      </div>
      {connected ? (
        <button className="sd-btn sd-btn-secondary sd-btn-sm block" style={{ color: "var(--ok)" }}><Icon name="check" size={15} />{connectedText}</button>
      ) : (
        <button className="sd-btn sd-btn-secondary sd-btn-sm block"><Icon name="plus" size={15} />{connectText}</button>
      )}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
  vis,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  vis?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="sd-row" style={{ justifyContent: "space-between", gap: 10 }}>
        <span className="sd-label" style={{ whiteSpace: "nowrap" }}>{label}</span>
        {vis}
      </div>
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

export function OptionRow({
  icon,
  title,
  sub,
  selected,
  tone,
  onClick,
}: {
  icon?: IconName;
  title: string;
  sub?: string;
  selected?: boolean;
  tone?: "members" | "private" | "shared";
  onClick?: () => void;
}) {
  const tint = tone === "members" ? "var(--blue-tint)" : tone === "shared" ? "var(--orange-tint)" : "var(--slate-tint)";
  const ink = tone === "members" ? "var(--blue-800)" : tone === "shared" ? "var(--orange-ink)" : "var(--ink-2)";
  return (
    <button
      className="sd-row"
      onClick={onClick}
      type="button"
      style={{ gap: 12, padding: "12px", borderRadius: 12, width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", border: "1px solid " + (selected ? "var(--blue)" : "var(--line)"), background: selected ? "var(--blue-tint)" : "var(--paper)", boxShadow: selected ? "0 0 0 3px var(--blue-tint)" : "none" }}
    >
      {icon && (
        <div style={{ width: 34, height: 34, borderRadius: 9, background: tint, color: ink, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
          <Icon name={icon} size={17} stroke={2} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700 }}>{title}</div>
        {sub && <div className="sd-meta" style={{ marginTop: 1, lineHeight: 1.35 }}>{sub}</div>}
      </div>
      <div style={{ width: 21, height: 21, borderRadius: 999, border: "2px solid " + (selected ? "var(--blue)" : "var(--line-2)"), flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {selected && <span style={{ width: 11, height: 11, borderRadius: 999, background: "var(--blue)" }} />}
      </div>
    </button>
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

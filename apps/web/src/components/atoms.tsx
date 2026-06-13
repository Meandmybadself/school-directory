// Atoms — Avatar, Vis chip, Btn, Tag. Ported from design_handoff/ds.jsx.
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon.js";

const AV_COLORS = [
  "#0068A8", "#2f8f6b", "#c4632a", "#7257b8", "#b8456b",
  "#1f7a8c", "#a67c00", "#4a6fb5", "#8a5a2b", "#5a7a3a",
];

export function avColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < (seed || "").length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length]!;
}

export function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function Avatar({
  name,
  size = 40,
  ring,
  img,
  color,
  textColor,
}: {
  name: string;
  size?: number;
  ring?: number;
  img?: string | null;
  color?: string;
  textColor?: string;
}) {
  const st: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.38),
    color: textColor || "#fff",
    background: img ? undefined : color || avColor(name),
    boxShadow: ring ? `0 0 0 2px #fff, 0 0 0 ${ring}px ${color || avColor(name)}` : undefined,
    backgroundImage: img ? `url(${img})` : undefined,
  };
  return (
    <div className="sd-av" style={st}>
      {img ? "" : initials(name)}
    </div>
  );
}

export type VisState = "members" | "private" | "shared";

export function Vis({
  state = "members",
  count,
  label,
  withCaret = true,
  membersText = "Members",
  privateText = "Private",
  sharedText = "Shared",
  onClick,
}: {
  state?: VisState;
  count?: number;
  label?: string;
  withCaret?: boolean;
  membersText?: string;
  privateText?: string;
  sharedText?: string;
  onClick?: () => void;
}) {
  const map = {
    members: { cls: "vis-members", icon: "members" as IconName, txt: membersText },
    private: { cls: "vis-private", icon: "lock" as IconName, txt: privateText },
    shared: {
      cls: "vis-shared",
      icon: "lock" as IconName,
      txt: sharedText + (count != null ? ` · ${count}` : ""),
    },
  };
  const m = map[state];
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      className={`sd-vis ${m.cls}`}
      onClick={onClick}
      style={onClick ? undefined : { cursor: "default" }}
      type={onClick ? "button" : undefined}
    >
      <Icon name={m.icon} size={12} stroke={2} />
      {label || m.txt}
      {withCaret && <Icon name="chevdown" size={11} stroke={2.2} style={{ opacity: 0.5, marginLeft: 1 }} />}
    </Tag>
  );
}

export function Btn({
  children,
  kind = "primary",
  sm,
  block,
  icon,
  iconRight,
  style,
  disabled,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  kind?: "primary" | "secondary" | "ghost" | "orange";
  sm?: boolean;
  block?: boolean;
  icon?: IconName;
  iconRight?: IconName;
  style?: CSSProperties;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  const cls = `sd-btn sd-btn-${kind}${sm ? " sd-btn-sm" : ""}${block ? " block" : ""}`;
  const isz = sm ? 16 : 18;
  return (
    <button className={cls} style={style} disabled={disabled} onClick={onClick} type={type}>
      {icon && <Icon name={icon} size={isz} />}
      {children}
      {iconRight && <Icon name={iconRight} size={isz} />}
    </button>
  );
}

export function Tag({
  children,
  tone = "",
  icon,
}: {
  children: ReactNode;
  tone?: "" | "blue" | "orange" | "line";
  icon?: IconName;
}) {
  return (
    <span className={`sd-tag ${tone}`}>
      {icon && <Icon name={icon} size={12} stroke={2} />}
      {children}
    </span>
  );
}

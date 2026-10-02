// The pieces both halves of the app draw items with: a colour swatch and a
// grid card. The public grid and the staff dashboard use the same card, so a
// staff member sees an item the way a family will.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n/index.js";
import { SWATCHES, colorLabel, foundAgo } from "../lib/lf.js";

export function Swatch({ color }: { color: string }) {
  const { t } = useI18n();
  const label = colorLabel(t, color);
  return (
    <span
      className="lf-swatch"
      role="img"
      aria-label={label}
      title={label}
      style={{ background: SWATCHES[color] ?? "#ccc" }}
    />
  );
}

export interface CardItem {
  id: string;
  title: string;
  colors: string[];
  foundAt: string;
  thumbUrl: string;
  /** No description yet — the model is still working, or gave up. */
  untitled: boolean;
}

export function ItemCard({ item, to, extra }: { item: CardItem; to: string; extra?: ReactNode }) {
  const { t } = useI18n();
  const title = item.untitled ? t("lfDescribing") : item.title;
  return (
    <Link className="lf-card" to={to}>
      {/* Alt is the item's title: the photo IS the item, and the title is the
          best words there are for it. An undescribed one says so. */}
      <img src={item.thumbUrl} alt={title} loading="lazy" />
      <div className="lf-card-body">
        <div className="lf-card-title">{title}</div>
        <div className="lf-card-meta">
          {item.colors.map((c) => (
            <Swatch key={c} color={c} />
          ))}
          <span style={{ marginLeft: item.colors.length ? 4 : 0 }}>{foundAgo(t, item.foundAt)}</span>
        </div>
        {extra}
      </div>
    </Link>
  );
}

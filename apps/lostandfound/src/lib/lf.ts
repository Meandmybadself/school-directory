// Display helpers for found items: the translated names of the fixed
// vocabularies, colour swatches, "found N days ago", and the photo resizer the
// upload screen uses.
import {
  LF_CATEGORIES,
  LF_COLORS,
  formatClock,
  isoToZonedDate,
  resolveTimeZone,
  type Locale,
  type Strings,
} from "@sd/shared";
import type { I18nT } from "../i18n/index.js";

/** The school's zone. "Found today" means today AT SCHOOL, not wherever the
 *  reader's phone thinks it is — the school-timezone rule CLAUDE.md's
 *  Conventions keep for every timed thing in this project. */
export const SCHOOL_TZ = resolveTimeZone(import.meta.env.VITE_SCHOOL_TIMEZONE);

/** Stored values stay English (they are what the model is told to choose and
 *  what the filters match); these are the words a reader sees. */
const CATEGORY_KEYS: Record<(typeof LF_CATEGORIES)[number], keyof Strings> = {
  "Water bottle": "lfCatWaterBottle",
  "Lunch box": "lfCatLunchBox",
  "Jacket or coat": "lfCatJacket",
  "Sweatshirt or hoodie": "lfCatSweatshirt",
  "Clothing (other)": "lfCatClothing",
  "Hat, gloves, or scarf": "lfCatWinterWear",
  "Shoes or boots": "lfCatShoes",
  "Backpack or bag": "lfCatBag",
  Electronics: "lfCatElectronics",
  Glasses: "lfCatGlasses",
  "Jewelry or accessory": "lfCatJewelry",
  Toy: "lfCatToy",
  "Book or school supplies": "lfCatSchoolSupplies",
  "Sports equipment": "lfCatSports",
  Other: "lfCatOther",
};

const COLOR_KEYS: Record<(typeof LF_COLORS)[number], keyof Strings> = {
  black: "lfColorBlack",
  white: "lfColorWhite",
  gray: "lfColorGray",
  silver: "lfColorSilver",
  red: "lfColorRed",
  pink: "lfColorPink",
  orange: "lfColorOrange",
  yellow: "lfColorYellow",
  gold: "lfColorGold",
  green: "lfColorGreen",
  blue: "lfColorBlue",
  navy: "lfColorNavy",
  purple: "lfColorPurple",
  brown: "lfColorBrown",
  tan: "lfColorTan",
  multicolor: "lfColorMulticolor",
};

export function categoryLabel(t: I18nT, category: string): string {
  const key = CATEGORY_KEYS[category as keyof typeof CATEGORY_KEYS];
  return key ? t(key) : category;
}

export function colorLabel(t: I18nT, color: string): string {
  const key = COLOR_KEYS[color as keyof typeof COLOR_KEYS];
  return key ? t(key) : color;
}

/** Swatch fills. Literal colours on purpose: they describe the ITEM, so a red
 *  jacket's swatch is red in dark mode too. Unknown values fall back to grey. */
export const SWATCHES: Record<string, string> = {
  black: "#1f1f1f",
  white: "#ffffff",
  gray: "#9a9a9a",
  silver: "linear-gradient(135deg,#e6e6e6,#a9a9a9)",
  red: "#d93636",
  pink: "#f28bb8",
  orange: "#f08a24",
  yellow: "#f5cf2c",
  gold: "linear-gradient(135deg,#f7dd7c,#c99a2e)",
  green: "#3a9d5d",
  blue: "#3b7ddd",
  navy: "#1f2f5c",
  purple: "#8a56c9",
  brown: "#7a5232",
  tan: "#d2b48c",
  multicolor: "conic-gradient(#d93636,#f5cf2c,#3a9d5d,#3b7ddd,#8a56c9,#d93636)",
};

/** Whole days between two school-calendar dates. */
function schoolDaysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${isoToZonedDate(fromIso, SCHOOL_TZ)}T00:00:00Z`);
  const b = Date.parse(`${isoToZonedDate(toIso, SCHOOL_TZ)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function foundAgo(t: I18nT, foundAt: string): string {
  const days = schoolDaysBetween(foundAt, new Date().toISOString());
  if (days <= 0) return t("lfFoundToday");
  if (days === 1) return t("lfFoundYesterday");
  return t("lfFoundDaysAgo", { n: days });
}

/** "Fri, Oct 2", read in the school's zone. */
export function formatDay(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: SCHOOL_TZ,
  });
}

/** "Fri, Oct 2 · 2:10 PM" — the time through CLOCK, as every clock time here is. */
export function formatDayTime(iso: string, locale: Locale): string {
  return `${formatDay(iso, locale)} · ${formatClock(iso, locale, SCHOOL_TZ)}`;
}

// ── Photo resizing ───────────────────────────────────────────────────────────
//
// Done in the browser, before upload: it keeps uploads quick on school Wi-Fi,
// keeps the API Worker's CPU inside the free plan, and re-encoding through a
// canvas drops the EXIF block — GPS position included — which a phone photo
// otherwise carries straight onto a public page.

export const PHOTO_MAX = 1600;
/** Also the image the vision model looks at. */
export const THUMB_MAX = 640;

function toJpeg(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("canvas unavailable"));
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality),
  );
}

/** The full-size photo and the thumbnail, both JPEG, both EXIF-free. */
export async function resizePhoto(file: File): Promise<{ photo: Blob; thumb: Blob }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const [photo, thumb] = await Promise.all([toJpeg(bitmap, PHOTO_MAX, 0.85), toJpeg(bitmap, THUMB_MAX, 0.8)]);
    return { photo, thumb };
  } finally {
    bitmap.close();
  }
}

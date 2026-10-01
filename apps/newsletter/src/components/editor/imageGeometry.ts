// Pure geometry for the image editor (ImageEditor.tsx), kept apart so it can be
// tested without a canvas. Every rect is in the pixel space of the ROTATED
// image — the crop is chosen on what the author sees, after rotation.

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };
export type Rotation = 0 | 90 | 180 | 270;

/** Smallest crop edge, in source pixels. Below this a handle is hard to grab
 *  and the result is not an image anyone meant to put in a newsletter. */
export const MIN_EDGE = 16;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Size of the image once rotated: a quarter turn swaps the axes. */
export function rotatedSize(w: number, h: number, rot: Rotation): { w: number; h: number } {
  return rot % 180 === 0 ? { w, h } : { w: h, h: w };
}

/** The largest rect of `aspect` (w/h) that fits, centred. `null` is the whole image. */
export function largestCentered(W: number, H: number, aspect: number | null): Rect {
  if (!aspect) return { x: 0, y: 0, w: W, h: H };
  let w = W;
  let h = W / aspect;
  if (h > H) {
    h = H;
    w = H * aspect;
  }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/** Carry a crop through a quarter turn of an image that was W×H BEFORE it.
 *  `dir` 1 is clockwise. The same region of the picture stays selected. */
export function rotateRect(r: Rect, W: number, H: number, dir: 1 | -1): Rect {
  return dir === 1
    ? { x: H - r.y - r.h, y: r.x, w: r.h, h: r.w }
    : { x: r.y, y: W - r.x - r.w, w: r.h, h: r.w };
}

/** Translate a rect by a pointer delta, kept inside the image. */
export function moveRect(r: Rect, dx: number, dy: number, W: number, H: number): Rect {
  return { ...r, x: clamp(r.x + dx, 0, W - r.w), y: clamp(r.y + dy, 0, H - r.h) };
}

/** The rect spanned by a fixed `anchor` corner and the pointer, optionally held
 *  to `aspect`, never leaving the image and never smaller than MIN_EDGE. This
 *  one function serves both dragging a corner handle (the anchor is the
 *  opposite corner) and drawing a fresh crop (the anchor is where the drag began). */
export function rectFromCorners(
  anchor: Point,
  pointer: Point,
  aspect: number | null,
  W: number,
  H: number,
): Rect {
  const p = { x: clamp(pointer.x, 0, W), y: clamp(pointer.y, 0, H) };
  const dx = p.x >= anchor.x ? 1 : -1;
  const dy = p.y >= anchor.y ? 1 : -1;
  // Room between the anchor and the image edge in the direction of the drag.
  const roomW = dx > 0 ? W - anchor.x : anchor.x;
  const roomH = dy > 0 ? H - anchor.y : anchor.y;

  let w = Math.max(Math.abs(p.x - anchor.x), MIN_EDGE);
  let h = Math.max(Math.abs(p.y - anchor.y), MIN_EDGE);
  if (aspect) {
    // Follow whichever axis the pointer has pulled further, then shrink back
    // inside the image along both.
    if (w / h > aspect) h = w / aspect;
    else w = h * aspect;
    if (w > roomW) {
      w = roomW;
      h = w / aspect;
    }
    if (h > roomH) {
      h = roomH;
      w = h * aspect;
    }
  } else {
    w = Math.min(w, roomW);
    h = Math.min(h, roomH);
  }
  return { x: dx > 0 ? anchor.x : anchor.x - w, y: dy > 0 ? anchor.y : anchor.y - h, w, h };
}

/** Output dimensions for a crop scaled to `width`, never enlarged. */
export function outputSize(crop: Rect, width: number): { w: number; h: number } {
  const w = Math.max(1, Math.round(Math.min(width, crop.w)));
  return { w, h: Math.max(1, Math.round((w * crop.h) / crop.w)) };
}

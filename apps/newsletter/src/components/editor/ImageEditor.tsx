// Crop, rotate and resize an image in the browser, before it is uploaded.
//
// The edit is BAKED INTO THE PIXELS on a canvas, and what reaches
// NEWSLETTER_MEDIA is the result. That is the design, not a shortcut: the
// alternative — crop and rotation stored as attributes on the image node — would
// need a renderer case in newsletterRender.ts (invariant 9) and CSS transforms
// that Outlook and Gmail don't honour. A baked image renders identically in the
// email, the preview and the archive because it is just an image.
//
// Two side effects worth knowing. Re-encoding through a canvas drops EXIF, which
// on a phone photo includes the GPS position it was taken at — for pictures of
// children going to a public archive, that is a feature. And the browser applies
// the EXIF orientation when it decodes, so a sideways phone photo comes out the
// right way up before the author has touched anything.
//
// Animated GIFs never come here: a canvas holds one frame, so editing one would
// silently flatten it. The toolbar uploads them as they are.

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { SheetOver } from "../parts.js";
import { Btn } from "../atoms.js";
import { Icon } from "../Icon.js";
import { errorMessage } from "../../lib/api.js";
import {
  largestCentered,
  moveRect,
  outputSize,
  rectFromCorners,
  rotateRect,
  rotatedSize,
  type Point,
  type Rect,
  type Rotation,
} from "./imageGeometry.js";

/** The email body is 600px wide; twice that stays sharp on a high-density
 *  screen, and anything larger is bytes every recipient downloads for nothing. */
const DEFAULT_WIDTH = 1200;
const MIN_WIDTH = 100;
/** The preview canvas never needs more than this on its long edge; drawing a
 *  12-megapixel photo at full size on every rotation would stall a phone. */
const PREVIEW_EDGE = 1000;

const ASPECTS: { label: string; value: number | null }[] = [
  { label: "Free", value: null },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
];

type Corner = "nw" | "ne" | "sw" | "se";
type Drag =
  | { mode: "move"; start: Point; rect: Rect }
  | { mode: "corner" | "new"; anchor: Point; start: Point; moved: boolean };

function loadImage(source: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    // An image already in the issue is on the API's origin. /newsletter-media
    // answers with `access-control-allow-origin: *`, and asking for it with
    // CORS is what keeps the canvas readable rather than tainted.
    if (typeof source === "string") img.crossOrigin = "anonymous";
    img.onload = () => {
      if (typeof source !== "string") URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (typeof source !== "string") URL.revokeObjectURL(url);
      reject(new Error("image_load_failed"));
    };
    img.src = url;
  });
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return [c, ctx];
}

/** The full-resolution image, turned. Everything downstream crops from this. */
function rotate(img: HTMLImageElement, rot: Rotation): HTMLCanvasElement {
  const { w, h } = rotatedSize(img.naturalWidth, img.naturalHeight, rot);
  const [c, ctx] = canvasOf(w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return c;
}

/** Crop and scale to the output, halving in steps on the way down: a single
 *  drawImage from 4000px to 1200px samples too sparsely and comes out jagged. */
function renderOutput(src: HTMLCanvasElement, crop: Rect, width: number): HTMLCanvasElement {
  const out = outputSize(crop, width);
  let cur: CanvasImageSource = src;
  let sx = Math.round(crop.x);
  let sy = Math.round(crop.y);
  let sw = Math.round(crop.w);
  let sh = Math.round(crop.h);
  while (sw / 2 >= out.w) {
    const [c, ctx] = canvasOf(Math.round(sw / 2), Math.round(sh / 2));
    ctx.drawImage(cur, sx, sy, sw, sh, 0, 0, c.width, c.height);
    cur = c;
    sx = 0;
    sy = 0;
    sw = c.width;
    sh = c.height;
  }
  const [c, ctx] = canvasOf(out.w, out.h);
  ctx.drawImage(cur, sx, sy, sw, sh, 0, 0, out.w, out.h);
  return c;
}

/** Keep a JPEG a JPEG (a photo as PNG is several times the size) and a WebP a
 *  WebP; everything else — PNG, and a still GIF — becomes PNG. Safari can't
 *  encode WebP and hands back PNG instead, which is why the caller reads the
 *  blob's own type rather than trusting this one. */
function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  const outType = type === "image/jpeg" || type === "image/webp" ? type : "image/png";
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode_failed"))), outType, 0.9);
  });
}

export function ImageEditor({
  source,
  type,
  onSave,
  onClose,
}: {
  /** A freshly picked file, or the URL of an image already in the issue. */
  source: Blob | string;
  /** The source's MIME type, which decides the output format. */
  type: string;
  /** Upload the edited image and put it in the document. Rejecting keeps the
   *  sheet open with the error shown, so the author's edit isn't lost. */
  onSave: (blob: Blob) => Promise<void>;
  onClose: () => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  // Until the author moves the width themselves, it tracks the crop: a smaller
  // crop should not be upscaled back to 1200px, nor a larger one capped early.
  const [widthTouched, setWidthTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const view = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    let live = true;
    loadImage(source).then(
      (i) => {
        if (!live) return;
        setImg(i);
        setCrop(largestCentered(i.naturalWidth, i.naturalHeight, null));
      },
      () => live && setLoadError(true),
    );
    return () => {
      live = false;
    };
  }, [source]);

  // The full-resolution source, turned. Derived during render rather than in an
  // effect so it can never disagree with `crop`, which the turn handler carries
  // into the new orientation in the same update that changes `rotation`.
  const rotated = useMemo(() => (img ? rotate(img, rotation) : null), [img, rotation]);

  // Draw the preview: the rotated image, scaled down to something a screen needs.
  useEffect(() => {
    const c = view.current;
    if (!c || !rotated) return;
    const scale = Math.min(1, PREVIEW_EDGE / Math.max(rotated.width, rotated.height));
    c.width = Math.round(rotated.width * scale);
    c.height = Math.round(rotated.height * scale);
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(rotated, 0, 0, c.width, c.height);
  }, [rotated]);

  const W = rotated?.width ?? 1;
  const H = rotated?.height ?? 1;
  const maxWidth = crop ? Math.max(MIN_WIDTH, Math.round(crop.w)) : DEFAULT_WIDTH;
  const effectiveWidth = widthTouched ? Math.min(width, maxWidth) : Math.min(DEFAULT_WIDTH, maxWidth);
  const out = crop ? outputSize(crop, effectiveWidth) : null;

  const turn = (dir: 1 | -1) => {
    if (!rotated) return;
    const next = ((((rotation + dir * 90) % 360) + 360) % 360) as Rotation;
    const nextSize = rotatedSize(W, H, 90);
    // A locked ratio is re-fitted rather than turned: turning a 16:9 crop gives
    // a 9:16 one, which is not the ratio the button says is selected.
    setCrop((c) =>
      aspect || !c ? largestCentered(nextSize.w, nextSize.h, aspect) : rotateRect(c, W, H, dir),
    );
    setRotation(next);
  };

  const chooseAspect = (a: number | null) => {
    setAspect(a);
    if (a && rotated) setCrop(largestCentered(W, H, a));
  };

  const reset = () => {
    if (!img) return;
    setRotation(0);
    setAspect(null);
    setCrop(largestCentered(img.naturalWidth, img.naturalHeight, null));
    setWidthTouched(false);
    setWidth(DEFAULT_WIDTH);
  };

  /** Pointer position in rotated-image pixels. Not clamped — a move drag reads
   *  deltas, and the geometry helpers clamp what they produce. */
  const toImage = (e: ReactPointerEvent): Point => {
    const r = view.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!crop || busy) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toImage(e);
    const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-handle]")?.dataset.handle;
    if (handle === "move") {
      drag.current = { mode: "move", start: p, rect: crop };
    } else if (handle) {
      const c = handle as Corner;
      const anchor = {
        x: c.endsWith("w") ? crop.x + crop.w : crop.x,
        y: c.startsWith("n") ? crop.y + crop.h : crop.y,
      };
      drag.current = { mode: "corner", anchor, start: p, moved: false };
    } else {
      // Drawing a new crop on the image. It only replaces the current one once
      // the pointer has actually travelled, so a stray tap doesn't collapse the
      // crop to a 16px square.
      drag.current = { mode: "new", anchor: p, start: p, moved: false };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toImage(e);
    if (d.mode === "move") {
      setCrop(moveRect(d.rect, p.x - d.start.x, p.y - d.start.y, W, H));
      return;
    }
    if (!d.moved) {
      const r = view.current!.getBoundingClientRect();
      const travelled = (Math.hypot(p.x - d.start.x, p.y - d.start.y) / W) * r.width;
      if (d.mode === "new" && travelled < 4) return;
      d.moved = true;
    }
    setCrop(rectFromCorners(d.anchor, p, aspect, W, H));
  };

  const endDrag = () => {
    drag.current = null;
  };

  const save = async () => {
    if (!rotated || !crop) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await encode(renderOutput(rotated, crop, effectiveWidth), type);
      await onSave(blob);
    } catch (err) {
      setError(errorMessage(err, "That image couldn't be saved. Try a smaller width."));
      setBusy(false);
    }
  };

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <SheetOver onClose={busy ? undefined : onClose}>
      <h2 className="sd-h2" style={{ marginBottom: 12 }}>Edit image</h2>

      {loadError ? (
        <p className="sd-meta" style={{ marginBottom: 14 }}>That image couldn't be opened for editing.</p>
      ) : (
        <div className="nlx-imged-stage">
          {!rotated && <div className="nlx-imged-loading">Loading…</div>}
          <div
            className="nlx-imged-frame"
            style={{ display: rotated ? undefined : "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <canvas ref={view} className="nlx-imged-canvas" />
            {crop && (
              // The dimming is its own clipped layer so the crop box beside it
              // can stay unclipped: a handle on the image's edge hangs half
              // outside it and would otherwise be cut in two.
              <div className="nlx-imged-clip">
                <div
                  className="nlx-imged-shade"
                  style={{ left: pct(crop.x, W), top: pct(crop.y, H), width: pct(crop.w, W), height: pct(crop.h, H) }}
                />
              </div>
            )}
            {crop && (
              <div
                className="nlx-imged-crop"
                data-handle="move"
                style={{ left: pct(crop.x, W), top: pct(crop.y, H), width: pct(crop.w, W), height: pct(crop.h, H) }}
              >
                {(["nw", "ne", "sw", "se"] as const).map((c) => (
                  <span key={c} className={`nlx-imged-handle ${c}`} data-handle={c} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!loadError && (
        <>
          <div className="nlx-imged-row">
            <button type="button" className="nlx-tool" title="Rotate left" aria-label="Rotate left"
              disabled={!rotated || busy} onClick={() => turn(-1)}>
              <Icon name="rotl" size={18} stroke={2} />
            </button>
            <button type="button" className="nlx-tool" title="Rotate right" aria-label="Rotate right"
              disabled={!rotated || busy} onClick={() => turn(1)}>
              <Icon name="rotr" size={18} stroke={2} />
            </button>
            <div className="sd-seg" style={{ flex: 1 }} role="group" aria-label="Crop shape">
              {ASPECTS.map((a) => (
                <button key={a.label} type="button" className={aspect === a.value ? "on" : ""}
                  disabled={!rotated || busy} onClick={() => chooseAspect(a.value)}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <label className="nlx-imged-width">
            <span>Width</span>
            <input
              type="range"
              min={Math.min(MIN_WIDTH, maxWidth)}
              max={maxWidth}
              step={10}
              value={effectiveWidth}
              disabled={!rotated || busy}
              onChange={(e) => {
                setWidthTouched(true);
                setWidth(Number(e.target.value));
              }}
            />
            <span className="sd-meta nlx-imged-dims">{out ? `${out.w} × ${out.h}` : "—"}</span>
          </label>
          <p className="sd-meta" style={{ margin: "2px 0 14px" }}>
            Drag the corners to crop, or drag across the picture to draw a new crop. The email is 600px wide,
            so 1200 stays sharp on any screen.
          </p>
        </>
      )}

      {error && <p className="nlx-imged-error" role="alert">{error}</p>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!loadError && (
          <Btn kind="ghost" disabled={!rotated || busy} onClick={reset}>Reset</Btn>
        )}
        <span style={{ flex: 1 }} />
        <Btn kind="secondary" disabled={busy} onClick={onClose}>Cancel</Btn>
        {!loadError && (
          <Btn icon="check" disabled={!rotated || busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Use image"}
          </Btn>
        )}
      </div>
    </SheetOver>
  );
}

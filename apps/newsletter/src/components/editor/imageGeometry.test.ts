import { describe, expect, it } from "vitest";
import {
  largestCentered,
  MIN_EDGE,
  moveRect,
  outputSize,
  rectFromCorners,
  rotateRect,
  rotatedSize,
} from "./imageGeometry.js";

describe("image editor geometry", () => {
  it("swaps axes on a quarter turn only", () => {
    expect(rotatedSize(400, 300, 0)).toEqual({ w: 400, h: 300 });
    expect(rotatedSize(400, 300, 90)).toEqual({ w: 300, h: 400 });
    expect(rotatedSize(400, 300, 180)).toEqual({ w: 400, h: 300 });
    expect(rotatedSize(400, 300, 270)).toEqual({ w: 300, h: 400 });
  });

  it("fits the largest centred rect of a ratio", () => {
    expect(largestCentered(400, 300, null)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(largestCentered(400, 300, 1)).toEqual({ x: 50, y: 0, w: 300, h: 300 });
    expect(largestCentered(400, 300, 16 / 9)).toEqual({ x: 0, y: 37.5, w: 400, h: 225 });
  });

  it("keeps the same region selected through a turn, and back again", () => {
    // The top-left 100×50 of a 400×300 image.
    const r = { x: 0, y: 0, w: 100, h: 50 };
    // Clockwise, the top-left corner goes to the top-right of a 300×400 image.
    const cw = rotateRect(r, 400, 300, 1);
    expect(cw).toEqual({ x: 250, y: 0, w: 50, h: 100 });
    expect(rotateRect(cw, 300, 400, -1)).toEqual(r);
    // Four clockwise turns are the identity.
    let x = r;
    let [W, H] = [400, 300];
    for (let i = 0; i < 4; i++) {
      x = rotateRect(x, W, H, 1);
      [W, H] = [H, W];
    }
    expect(x).toEqual(r);
  });

  it("moves a crop without letting it leave the image", () => {
    const r = { x: 10, y: 10, w: 100, h: 100 };
    expect(moveRect(r, 50, 20, 400, 300)).toEqual({ x: 60, y: 30, w: 100, h: 100 });
    expect(moveRect(r, 1000, 1000, 400, 300)).toEqual({ x: 300, y: 200, w: 100, h: 100 });
    expect(moveRect(r, -1000, -1000, 400, 300)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it("spans anchor to pointer in any direction, clamped to the image", () => {
    expect(rectFromCorners({ x: 100, y: 100 }, { x: 200, y: 150 }, null, 400, 300))
      .toEqual({ x: 100, y: 100, w: 100, h: 50 });
    expect(rectFromCorners({ x: 100, y: 100 }, { x: 50, y: 20 }, null, 400, 300))
      .toEqual({ x: 50, y: 20, w: 50, h: 80 });
    expect(rectFromCorners({ x: 100, y: 100 }, { x: 900, y: 900 }, null, 400, 300))
      .toEqual({ x: 100, y: 100, w: 300, h: 200 });
  });

  it("never shrinks below the minimum edge", () => {
    const r = rectFromCorners({ x: 100, y: 100 }, { x: 101, y: 101 }, null, 400, 300);
    expect(r.w).toBe(MIN_EDGE);
    expect(r.h).toBe(MIN_EDGE);
  });

  it("holds a locked ratio and stays inside the image", () => {
    const r = rectFromCorners({ x: 0, y: 0 }, { x: 400, y: 10 }, 1, 400, 300);
    // Pulled 400 wide, but only 300 of height exists, so the square is 300.
    expect(r).toEqual({ x: 0, y: 0, w: 300, h: 300 });
    const r2 = rectFromCorners({ x: 400, y: 300 }, { x: 300, y: 290 }, 2, 400, 300);
    expect(r2.w / r2.h).toBeCloseTo(2);
    expect(r2.x + r2.w).toBe(400);
    expect(r2.y + r2.h).toBe(300);
  });

  it("scales output to the width asked for, never enlarging", () => {
    const crop = { x: 0, y: 0, w: 3000, h: 2000 };
    expect(outputSize(crop, 1200)).toEqual({ w: 1200, h: 800 });
    expect(outputSize({ x: 0, y: 0, w: 640, h: 480 }, 1200)).toEqual({ w: 640, h: 480 });
  });
});

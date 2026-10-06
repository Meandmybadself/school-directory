import { describe, expect, it } from "vitest";
import { jpegOrientation, orientTransform, withOrientation } from "./orient.js";

// A JPEG's framing only: SOI, an APP0 (JFIF) segment, then EOI. The parser
// never looks past the markers, so no image data is needed.
const JFIF = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xd9,
]);

describe("jpegOrientation", () => {
  it("reads every value withOrientation writes", () => {
    for (let o = 1; o <= 8; o++) expect(jpegOrientation(withOrientation(JFIF, o))).toBe(o);
  });

  it("finds the tag behind an APP0 segment, little-endian", () => {
    const le = [
      0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
      0x01, 0x00,
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ];
    const bytes = new Uint8Array([...JFIF.subarray(0, 20), ...le, 0xff, 0xd9]);
    expect(jpegOrientation(bytes)).toBe(8);
  });

  it("answers 1 for no tag, a truncated file and a PNG", () => {
    expect(jpegOrientation(JFIF)).toBe(1);
    expect(jpegOrientation(withOrientation(JFIF, 6).subarray(0, 20))).toBe(1);
    expect(jpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
  });

  it("refuses an out-of-range value rather than guessing", () => {
    expect(jpegOrientation(withOrientation(JFIF, 9))).toBe(1);
  });
});

describe("orientTransform", () => {
  const apply = (m: number[], x: number, y: number) => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];

  it("keeps the stored image on the canvas for every orientation", () => {
    for (let o = 1; o <= 8; o++) {
      const { width, height, m } = orientTransform(o, 40, 30);
      expect(width * height).toBe(1200);
      for (const [x, y] of [[0, 0], [40, 0], [0, 30], [40, 30]] as const) {
        const [cx, cy] = apply(m, x, y);
        expect(cx).toBeGreaterThanOrEqual(0);
        expect(cx).toBeLessThanOrEqual(width);
        expect(cy).toBeGreaterThanOrEqual(0);
        expect(cy).toBeLessThanOrEqual(height);
      }
    }
  });

  it("turns a phone's portrait (6) clockwise: the stored top-left lands top-right", () => {
    const { width, height, m } = orientTransform(6, 40, 30);
    expect([width, height]).toEqual([30, 40]);
    expect(apply(m, 0, 0)).toEqual([30, 0]);
    expect(apply(m, 0, 30)).toEqual([0, 0]);
  });

  it("turns 8 anticlockwise and 3 half way", () => {
    expect(apply(orientTransform(8, 40, 30).m, 0, 0)).toEqual([0, 40]);
    expect(apply(orientTransform(3, 40, 30).m, 0, 0)).toEqual([40, 30]);
  });
});

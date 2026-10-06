// EXIF orientation, read by hand.
//
// A phone does not rotate the pixels of a portrait photo: it stores them the
// way the sensor saw them, landscape, and writes an Orientation tag (EXIF
// 0x0112) saying how to turn them for display. The resizer in lf.ts redraws
// every photo through a canvas, which drops that tag along with the GPS — so
// unless the turn is applied BEFORE the redraw, the item goes online on its
// side and the vision model describes it on its side too.
//
// `createImageBitmap(file, { imageOrientation: "from-image" })` is meant to do
// exactly that and does not everywhere: the option's values changed in the
// spec ("none" used to mean "apply it"), older engines reject "from-image"
// outright, and Safari has decoded a Blob both ways across releases. So lf.ts
// asks the browser, asks this file what the tag says, and checks with a probe
// (`decoderApplies`) whether the browser's answer already includes the turn.
// Only when it doesn't is the transform below applied by hand — never both,
// which would turn a portrait photo upside down.

/** The Orientation tag of a JPEG, 1–8; 1 (as stored) for anything else. */
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) return 1;
    const marker = bytes[p + 1]!;
    // Fill bytes before a marker are legal.
    if (marker === 0xff) {
      p++;
      continue;
    }
    // Start of scan: the metadata segments are all behind us.
    if (marker === 0xda || marker === 0xd9) return 1;
    const len = (bytes[p + 2]! << 8) | bytes[p + 3]!;
    if (len < 2) return 1;
    const start = p + 4;
    const end = p + 2 + len;
    if (end > bytes.length) return 1;
    if (marker === 0xe1 && isExifHeader(bytes, start)) {
      const o = tiffOrientation(bytes.subarray(start + 6, end));
      if (o) return o;
    }
    p = end;
  }
  return 1;
}

function isExifHeader(b: Uint8Array, at: number): boolean {
  // "Exif\0\0"
  return (
    at + 6 <= b.length &&
    b[at] === 0x45 &&
    b[at + 1] === 0x78 &&
    b[at + 2] === 0x69 &&
    b[at + 3] === 0x66 &&
    b[at + 4] === 0 &&
    b[at + 5] === 0
  );
}

function tiffOrientation(t: Uint8Array): number | null {
  if (t.length < 8) return null;
  const little = t[0] === 0x49 && t[1] === 0x49; // "II"
  const big = t[0] === 0x4d && t[1] === 0x4d; // "MM"
  if (!little && !big) return null;
  const u16 = (o: number) => (little ? t[o]! | (t[o + 1]! << 8) : (t[o]! << 8) | t[o + 1]!);
  const u32 = (o: number) =>
    little
      ? (t[o]! | (t[o + 1]! << 8) | (t[o + 2]! << 16) | (t[o + 3]! << 24)) >>> 0
      : ((t[o]! << 24) | (t[o + 1]! << 16) | (t[o + 2]! << 8) | t[o + 3]!) >>> 0;
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > t.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) return null;
    // Orientation, type SHORT: the value sits in the first two value bytes.
    if (u16(e) === 0x0112 && u16(e + 2) === 3) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** A copy of a JPEG with an APP1 segment carrying only `orientation`, placed
 *  straight after SOI. Used to build the probe; the tests use it too. */
export function withOrientation(jpeg: Uint8Array, orientation: number): Uint8Array<ArrayBuffer> {
  const app1 = [
    0xff, 0xe1, 0x00, 0x22,                         // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,             // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF, IFD0 at 8
    0x00, 0x01,                                     // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // Orientation, SHORT, count 1
    0x00, orientation & 0xff, 0x00, 0x00,           // the value
    0x00, 0x00, 0x00, 0x00,                         // no next IFD
  ];
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(jpeg.subarray(2), 2 + app1.length);
  return out;
}

/** Where a stored `w`×`h` image lands once turned: the canvas size to draw it
 *  on, and the `setTransform` that puts it there upright. */
export function orientTransform(
  orientation: number,
  w: number,
  h: number,
): { width: number; height: number; m: [number, number, number, number, number, number] } {
  switch (orientation) {
    case 2: return { width: w, height: h, m: [-1, 0, 0, 1, w, 0] }; // mirrored
    case 3: return { width: w, height: h, m: [-1, 0, 0, -1, w, h] }; // 180°
    case 4: return { width: w, height: h, m: [1, 0, 0, -1, 0, h] }; // flipped
    case 5: return { width: h, height: w, m: [0, 1, 1, 0, 0, 0] }; // transposed
    case 6: return { width: h, height: w, m: [0, 1, -1, 0, h, 0] }; // 90° clockwise
    case 7: return { width: h, height: w, m: [0, -1, -1, 0, h, w] }; // transversed
    case 8: return { width: h, height: w, m: [0, -1, 1, 0, 0, w] }; // 90° anticlockwise
    default: return { width: w, height: h, m: [1, 0, 0, 1, 0, 0] };
  }
}

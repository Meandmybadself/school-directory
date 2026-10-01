// A QR code pointing at a sent issue's public page, for the printed newsletter.
//
// Paper is where a newsletter loses its links: a printed copy on a fridge or a
// classroom door has every event title and sign-up flattened to ink (the print
// stylesheet strips their colour on purpose). One code back to the live page
// restores all of them at once, and the live page is the one that keeps up.
//
// What it may encode is the same question invariant 15 answers for the
// translation bar, and it gets the same kind of answer — a refusal by
// construction rather than by care. A printed page is the most widely
// redistributed copy of an issue there is, so a review-token url in this code
// would hand a live, revocable capability to everyone who photocopies it, with
// no way to recall the paper. `publishedIssueQrSvg` therefore renders ONLY an
// absolute `/n/:slug` url — the one surface invariant 10 already makes public
// and permanent — and returns "" for anything else, including `/preview/…`.

import { encode } from "uqr";

/** `http(s)://host/n/<slug>` and nothing else: no query, no fragment, no
 *  deeper path. http is allowed so `wrangler pages dev` can show it. */
const PUBLISHED_ISSUE_URL = /^https?:\/\/[^/?#\s]+\/n\/[^/?#\s]+$/;

export function isPublishedIssueUrl(url: string): boolean {
  return PUBLISHED_ISSUE_URL.test(url);
}

/** An inline SVG QR code for a sent issue's `/n/:slug` url, or "" when the url
 *  isn't one. Drawn as ONE path rather than a rect per module, so a typical
 *  code is ~2 kB instead of ~30 kB of markup. Black on white regardless of the
 *  reader's theme: it is only ever shown on paper. */
export function publishedIssueQrSvg(url: string): string {
  if (!isPublishedIssueUrl(url)) return "";
  // `M` rather than the default `L`: a printed code gets folded, smudged and
  // photographed at an angle, and these urls are short enough to afford it.
  const { size, data } = encode(url, { ecc: "M", border: 0 });
  let d = "";
  for (let y = 0; y < size; y++) {
    const row = data[y]!;
    for (let x = 0; x < size; x++) {
      if (!row[x]) continue;
      // Run-length each row so a dark stretch is one rectangle, not many.
      let run = 1;
      while (x + run < size && row[x + run]) run++;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  // Four modules of quiet zone, which the spec requires and scanners rely on;
  // drawn as viewBox padding so the white is part of the image on any paper.
  const q = 4;
  const box = size + q * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-q} ${-q} ${box} ${box}" shape-rendering="crispEdges" role="img" aria-label="QR code linking to this issue online"><rect x="${-q}" y="${-q}" width="${box}" height="${box}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
}

// How many pages would this issue print as? Answered by the only thing here
// that has a layout engine: the browser the composer is already running in.
//
// The page HTML (the same renderNewsletterIssuePageHtml output the print view
// uses) is loaded into a hidden iframe sized to the printed page's CONTENT
// width, styled with NEWSLETTER_WEB_CSS plus NEWSLETTER_PRINT_RULES applied
// unwrapped — the same rules `@media print` applies, so the measured layout is
// the printed layout by construction (the shared package exports them
// separately for exactly this). Height ÷ one page's content height = pages.
//
// It is an ESTIMATE, and the honest error is fragmentation: print pagination
// honours break-inside/break-after by pushing content down, which a continuous
// measurement cannot see, so PAGE_SAFETY keeps the target shy of the physical
// boundary. Images and QR codes are measured for real — they are in the iframe
// and the wait below holds the measurement until they have arrived.

import { NEWSLETTER_PRINT_PAGE, NEWSLETTER_PRINT_RULES, NEWSLETTER_WEB_CSS } from "@sd/shared";
import { useEffect, useRef, useState } from "react";

/** The product goal: an issue should print on at most this many pages. */
export const TARGET_PRINT_PAGES = 2;

/** CSS resolves 1in to exactly 96px, screen hardware notwithstanding. */
const PX_PER_IN = 96;

/** Keep the target this far inside the physical boundary, for the pagination
 *  slack the continuous measurement can't see (see the header). */
const PAGE_SAFETY = 0.05;

/** Ask the model for this much more than the measurement needs: language models
 *  reliably undershoot a reduction target, and an answer that lands under the
 *  budget costs nothing where one that lands just over costs a second model
 *  call from a 20-a-day budget. */
const OVERSHOOT = 1.4;

/** What the composer may ask the assistant for, in percent. The server clamps
 *  to its own [5, 70] regardless (lib/newsletterAssist.ts); this floor just
 *  keeps a hair's-breadth overflow from spending a model call on a 6% trim a
 *  human would do faster by hand. */
const REDUCE_FLOOR = 10;
const REDUCE_CEILING = 60;

/** Longest the measurement waits on the draft's images before measuring what
 *  has arrived — IssuePrint.tsx's reasoning, on a tighter clock since this
 *  re-runs as the author types. */
const IMAGE_WAIT_MS = 5_000;

/** How long after the page HTML settles a measurement fires. The HTML already
 *  changes once per keystroke; this keeps the iframe from re-laying-out the
 *  whole issue at typing speed. */
const MEASURE_DEBOUNCE_MS = 700;

/** The blocks the assistant is allowed to reword — the layout-side twin of
 *  `collectTextSlots` on the server. `.nl-quote` contains `.nl-p` children, so
 *  the measurement walks matches and skips one inside another. */
const PROSE_SELECTOR = ".nl-p,.nl-h1,.nl-h2,.nl-h3,.nl-ul,.nl-ol,.nl-quote";

export interface PrintEstimate {
  /** Fractional — 2.6 means "runs well into a third sheet". */
  pages: number;
  /** Under TARGET_PRINT_PAGES with the safety margin. */
  fits: boolean;
  /** Percent of the draft's prose to ask the assistant to cut (overshoot
   *  already applied), or null — it fits, or nothing rewordable is on the page
   *  (an issue that is all images cannot be tightened into fitting). */
  suggestedReduce: number | null;
}

function wrapDocument(pageHtml: string): string {
  // The print rules appended UNWRAPPED, after the full stylesheet, so they win
  // by order — the same precedence printing gives them.
  return `<!doctype html><html><head><meta charset="utf-8"><style>${NEWSLETTER_WEB_CSS}\n${NEWSLETTER_PRINT_RULES}</style></head><body>${pageHtml}</body></html>`;
}

function proseHeightPx(doc: Document): number {
  let px = 0;
  for (const el of doc.querySelectorAll(PROSE_SELECTOR)) {
    if (el.parentElement?.closest(PROSE_SELECTOR)) continue;
    // Rect height excludes margins. Deliberate: a block's bottom margin
    // survives any reword (the model may not remove blocks), so counting it as
    // cuttable would understate the ask.
    px += el.getBoundingClientRect().height;
  }
  return px;
}

function measure(doc: Document): PrintEstimate {
  const pageHeight = NEWSLETTER_PRINT_PAGE.contentHeightIn * PX_PER_IN;
  const total = doc.documentElement.scrollHeight;
  const pages = total / pageHeight;
  const budget = TARGET_PRINT_PAGES * pageHeight * (1 - PAGE_SAFETY);
  const overflow = total - budget;
  if (overflow <= 0) return { pages, fits: true, suggestedReduce: null };
  const prose = proseHeightPx(doc);
  const suggestedReduce =
    prose <= 0
      ? null
      : Math.min(REDUCE_CEILING, Math.max(REDUCE_FLOOR, Math.round((overflow / prose) * 100 * OVERSHOOT)));
  return { pages, fits: false, suggestedReduce };
}

/** Resolves once every image in the document has loaded or failed, or after
 *  IMAGE_WAIT_MS — a broken image must not hold the estimate forever. */
function settleImages(doc: Document): Promise<void> {
  const pending = Array.from(doc.querySelectorAll("img"))
    .filter((img) => !img.complete)
    .map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    );
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, IMAGE_WAIT_MS));
  return Promise.race([Promise.all(pending).then(() => undefined), timeout]);
}

/**
 * Measure how the given issue-page HTML would print. Null in, null out — and
 * null while the first measurement is still settling.
 *
 * The iframe is created once per hook instance, parked off-screen, and reused
 * for every re-measure; `sandbox="allow-same-origin"` keeps it readable from
 * here while refusing to run a script (there is none in this HTML — issueUrl
 * is "" so no language-bar script is emitted — but the refusal shouldn't rest
 * on remembering that).
 */
export function usePrintEstimate(pageHtml: string | null): PrintEstimate | null {
  const [estimate, setEstimate] = useState<PrintEstimate | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);

  useEffect(
    () => () => {
      frame.current?.remove();
      frame.current = null;
    },
    [],
  );

  useEffect(() => {
    if (pageHtml === null) {
      setEstimate(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      let iframe = frame.current;
      if (!iframe) {
        iframe = document.createElement("iframe");
        iframe.setAttribute("sandbox", "allow-same-origin");
        iframe.setAttribute("aria-hidden", "true");
        iframe.tabIndex = -1;
        iframe.style.cssText = `position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;border:0;width:${NEWSLETTER_PRINT_PAGE.contentWidthIn * PX_PER_IN}px;height:100px`;
        document.body.appendChild(iframe);
        frame.current = iframe;
      }
      const onLoad = () => {
        const doc = iframe.contentDocument;
        if (!doc || !alive) return;
        void settleImages(doc).then(() => {
          if (!alive) return;
          // One frame for the browser to lay out what just arrived —
          // IssuePrint.tsx's Safari lesson, same fix.
          requestAnimationFrame(() => {
            const d = frame.current?.contentDocument;
            if (alive && d) setEstimate(measure(d));
          });
        });
      };
      iframe.addEventListener("load", onLoad, { once: true });
      iframe.srcdoc = wrapDocument(pageHtml);
    }, MEASURE_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [pageHtml]);

  return estimate;
}

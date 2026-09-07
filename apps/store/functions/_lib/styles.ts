// The storefront's stylesheet, inlined into every server-rendered page.
//
// Local to this app rather than in @sd/shared: unlike NEWSLETTER_WEB_CSS, which
// has to keep an archive page looking like the email it mirrors (invariant 9),
// nothing else renders these pages, so there is nothing for this to stay in step
// with. It is a small, deliberately hand-written subset of tokens.css rather
// than that file verbatim — these pages ship no bundle and no shell, and pulling
// in 875 lines of app chrome to render a grid of t-shirts would undo the reason
// they are server-rendered at all.
//
// It follows the same dark-mode rule as everything else in this project
// (CLAUDE.md, "Conventions"): `prefers-color-scheme` only, no toggle, nothing
// persisted, and every colour a token so no rule outside the @media block knows
// which theme is on. `--on-brand` exists here for the same reason it does
// there — `--blue` cannot both read as text and carry white text as a button
// fill.

export const STORE_CSS = `
:root {
  --paper: #fff;
  --bg: #f7f7f5;
  --ink: #14171a;
  --ink-2: #3d454d;
  --ink-3: #6b747d;
  --line: #e4e6e3;
  --blue: #0068A8;
  --blue-700: #005286;
  --blue-tint: #eaf4fa;
  --orange: #FAAB1C;
  --on-brand: #fff;
  --warn: #b3341f;
  --r-card: 14px;
  --r-ctrl: 10px;
  --ff: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #1c1f24;
    --bg: #16181c;
    --ink: #eef1f4;
    --ink-2: #c2c9d0;
    --ink-3: #949ca4;
    --line: #2c3138;
    --blue: #4aa8dd;
    /* Inverts: a foreground on a tint, so "darker" in light means "lighter"
       here. Getting this backwards makes a label vanish into its own chip. */
    --blue-700: #8fcdf0;
    --blue-tint: #12303f;
    --orange: #f2b23f;
    /* Near-black, not white: white on the lifted --blue measures 2.7:1. */
    --on-brand: #10141a;
    --warn: #ef8b76;
  }
}
* { box-sizing: border-box; }
html { color-scheme: light dark; }
body {
  margin: 0;
  font-family: var(--ff);
  background: var(--bg);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
img { max-width: 100%; display: block; }
a { color: var(--blue-700); }
.st-wrap { max-width: 1040px; margin: 0 auto; padding: 0 20px 56px; }
.st-head {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 16px 0; border-bottom: 1px solid var(--line); margin-bottom: 28px;
}
.st-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; }
.st-mark {
  width: 34px; height: 34px; border-radius: 10px; background: var(--blue); color: var(--on-brand);
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 15px;
}
.st-brand-name { font-size: 15.5px; font-weight: 800; letter-spacing: -.4px; line-height: 1.05; }
.st-brand-sub {
  font-size: 8px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; color: var(--ink-3);
}
.st-navlinks { margin-left: auto; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.st-navlinks a { font-size: 13.5px; font-weight: 600; text-decoration: none; }
.st-h1 { font-size: 27px; font-weight: 800; letter-spacing: -.6px; margin: 0 0 6px; }
.st-lead { color: var(--ink-2); font-size: 15px; line-height: 1.5; margin: 0 0 24px; max-width: 56ch; }
.st-grid {
  display: grid; gap: 20px;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}
.st-card {
  background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-card);
  overflow: hidden; text-decoration: none; color: inherit; display: flex; flex-direction: column;
}
.st-card img { aspect-ratio: 1 / 1; object-fit: cover; background: var(--bg); width: 100%; }
.st-card-body { padding: 12px 14px 14px; }
.st-card-title { font-weight: 700; font-size: 15px; line-height: 1.3; }
.st-card-price { color: var(--ink-3); font-size: 13.5px; font-weight: 600; margin-top: 3px; }
.st-detail { display: grid; gap: 28px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 760px) { .st-detail { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 40px; } }
.st-detail img { border-radius: var(--r-card); border: 1px solid var(--line); }
.st-price { font-size: 22px; font-weight: 800; margin: 4px 0 16px; }
.st-desc { color: var(--ink-2); font-size: 15px; line-height: 1.55; white-space: pre-wrap; }
.st-label { font-size: 11.5px; font-weight: 700; letter-spacing: .3px; text-transform: uppercase; color: var(--ink-3); display: block; margin-bottom: 6px; }
.st-select, .st-input {
  width: 100%; padding: 10px 12px; border-radius: var(--r-ctrl); border: 1px solid var(--line);
  background: var(--paper); color: var(--ink); font: inherit; font-size: 15px;
}
.st-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 11px 18px; border-radius: var(--r-ctrl); border: 1px solid transparent;
  background: var(--blue); color: var(--on-brand); font: inherit; font-weight: 700; font-size: 15px;
  cursor: pointer; text-decoration: none; margin-top: 16px; width: 100%;
}
.st-empty {
  background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-card);
  padding: 32px 20px; text-align: center; color: var(--ink-2);
}
.st-status { background: var(--blue-tint); border-radius: var(--r-card); padding: 16px 18px; margin-bottom: 20px; }
.st-status h2 { margin: 0; font-size: 17px; }
.st-lines { width: 100%; border-collapse: collapse; font-size: 14.5px; }
.st-lines td { padding: 7px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
.st-lines td:last-child { text-align: right; white-space: nowrap; }
.st-lines tr:last-child td { border-bottom: 0; font-weight: 800; }
.st-foot {
  border-top: 1px solid var(--line); margin-top: 44px; padding-top: 18px;
  color: var(--ink-3); font-size: 12.5px; line-height: 1.7;
}
.st-langs { margin-top: 10px; display: flex; gap: 12px; flex-wrap: wrap; }
`;

// The public PTO page's stylesheet, inlined into the one document it renders.
//
// Local to this app for the reason apps/store's is: nothing else renders this
// page, so there is nothing for it to stay in step with. It is a hand-written
// subset of `tokens.css` rather than that file verbatim — this page ships no
// bundle, and pulling in 836 lines of app chrome to render a page of prose would
// undo the reason it is server-rendered at all.
//
// The palette IS the project's, though, and that is the whole point of the
// brief: a family arriving here from the calendar or the directory should not
// feel they have left. Same `--blue`, same `--orange`, same radii, same
// `prefers-color-scheme`-only dark mode with no toggle and nothing persisted
// (CLAUDE.md, "Conventions"), and the same `--on-brand` rule — `--blue` cannot
// both read as text on a dark card and carry white text as a button fill.
//
// The six category colours are the one thing here that is new. They follow the
// same inversion discipline as `--blue-700`: each is a FOREGROUND on a tint, so
// "darker than the base" in light means "lighter" in dark, and getting that
// backwards makes a tag's label vanish into its own tag.

export const PTO_CSS = `
:root {
  --paper: #fff;
  --bg: #f7f7f5;
  --bg-2: #eef0ee;
  --ink: #14171a;
  --ink-2: #3d454d;
  --ink-3: #6b747d;
  --line: #e4e6e3;
  --blue: #0068A8;
  --blue-700: #005286;
  --blue-tint: #eaf4fa;
  --orange: #FAAB1C;
  --orange-tint: #fdf1da;
  --orange-ink: #8a5a06;
  --on-brand: #fff;
  --r-card: 14px;
  --r-ctrl: 10px;
  --ff: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;

  --cat-fund-fg: #1d6b4a; --cat-fund-bg: #e4f0e9;
  --cat-comm-fg: #2b5f97; --cat-comm-bg: #e6edf6;
  --cat-cult-fg: #973c48; --cat-cult-bg: #f6e6e7;
  --cat-appr-fg: #8a5a06; --cat-appr-bg: #fdf1da;
  --cat-enri-fg: #1f7684; --cat-enri-bg: #e2eff1;
  --cat-govn-fg: #515965; --cat-govn-bg: #eaecef;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #1c1f24;
    --bg: #16181c;
    --bg-2: #23272d;
    --ink: #eef1f4;
    --ink-2: #c2c9d0;
    --ink-3: #949ca4;
    --line: #2c3138;
    --blue: #4aa8dd;
    /* Inverts — a foreground on a tint. See the header. */
    --blue-700: #8fcdf0;
    --blue-tint: #12303f;
    --orange: #f2b23f;
    --orange-tint: #3a2c11;
    --orange-ink: #e6b45e;
    /* Near-black, not white: white on the lifted --blue measures 2.7:1. */
    --on-brand: #10141a;

    --cat-fund-fg: #7cc7a2; --cat-fund-bg: #16302a;
    --cat-comm-fg: #8fb4e6; --cat-comm-bg: #182534;
    --cat-cult-fg: #e39aa2; --cat-cult-bg: #321e21;
    --cat-appr-fg: #e0aa64; --cat-appr-bg: #2f2416;
    --cat-enri-fg: #6ec3d1; --cat-enri-bg: #142d31;
    --cat-govn-fg: #a9b1bf; --cat-govn-bg: #242832;
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
.pt-wrap { max-width: 1040px; margin: 0 auto; padding: 0 20px 64px; }

/* header + footer, shared with every sibling app's SSR chrome */
.pt-head {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 16px 0; border-bottom: 1px solid var(--line);
}
.pt-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; }
.pt-mark {
  width: 34px; height: 34px; border-radius: 10px; background: var(--blue); color: var(--on-brand);
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 15px;
}
.pt-brand-name { font-size: 15.5px; font-weight: 800; letter-spacing: -.4px; line-height: 1.05; }
.pt-brand-sub {
  font-size: 8px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; color: var(--ink-3);
}
.pt-navlinks { margin-left: auto; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.pt-navlinks a { font-size: 13.5px; font-weight: 600; text-decoration: none; }
/* The language switcher rides in the header on phones (the footer one is a long
   scroll away); hidden on wider screens, where the footer switcher serves. The
   .pt-head prefix wins over .pt-langs's own display regardless of source order. */
.pt-head .pt-head-langs { display: none; flex-basis: 100%; margin-top: 2px; }
@media (max-width: 640px) { .pt-head .pt-head-langs { display: flex; } }

/* hero */
.pt-hero { padding: 46px 0 8px; }
.pt-eyebrow {
  font-size: 11.5px; font-weight: 700; letter-spacing: .9px; text-transform: uppercase;
  color: var(--ink-3); display: flex; gap: 9px; flex-wrap: wrap; align-items: center;
}
.pt-eyebrow .sep { color: var(--orange); }
.pt-h1 {
  font-size: clamp(30px, 6vw, 46px); font-weight: 800; letter-spacing: -1.2px;
  line-height: 1.05; margin: 16px 0 0; text-wrap: balance;
}
.pt-lead {
  color: var(--ink-2); font-size: clamp(16px, 2.1vw, 18px); line-height: 1.55;
  margin: 16px 0 0; max-width: 62ch;
}
.pt-cta { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px; }

/* sections */
.pt-sec { padding-top: 54px; }
.pt-h2 { font-size: clamp(20px, 3vw, 25px); font-weight: 800; letter-spacing: -.5px; margin: 0; }
.pt-sub { color: var(--ink-2); font-size: 15px; line-height: 1.55; margin: 8px 0 22px; max-width: 62ch; }
.pt-body { color: var(--ink-2); font-size: 15.5px; line-height: 1.6; max-width: 62ch; }

.pt-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(238px, 1fr)); }
.pt-card {
  background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-card);
  padding: 16px 17px;
}
.pt-card h3 { margin: 0; font-size: 15.5px; font-weight: 800; letter-spacing: -.2px; }
.pt-card p { margin: 8px 0 0; color: var(--ink-2); font-size: 13.5px; line-height: 1.55; }
.pt-card a { font-weight: 700; text-decoration: none; }

/* the year strip */
.pt-legend { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.pt-tag {
  display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 650;
  padding: 3px 9px; border-radius: 7px; line-height: 1.4;
}
.pt-tag::before { content: ""; width: 6px; height: 6px; border-radius: 2px; background: currentColor; }
.t-fundraiser { color: var(--cat-fund-fg); background: var(--cat-fund-bg); }
.t-community { color: var(--cat-comm-fg); background: var(--cat-comm-bg); }
.t-cultural { color: var(--cat-cult-fg); background: var(--cat-cult-bg); }
.t-appreciation { color: var(--cat-appr-fg); background: var(--cat-appr-bg); }
.t-enrichment { color: var(--cat-enri-fg); background: var(--cat-enri-bg); }
.t-governance { color: var(--cat-govn-fg); background: var(--cat-govn-bg); }

.pt-year {
  background: var(--paper); border: 1px solid var(--line);
  border-radius: var(--r-card); overflow: hidden;
}
.pt-month {
  display: grid; grid-template-columns: 116px minmax(0, 1fr); gap: 16px;
  padding: 13px 18px; border-bottom: 1px solid var(--line);
}
.pt-month:last-child { border-bottom: 0; }
.pt-month .m { font-size: 14.5px; font-weight: 800; letter-spacing: -.2px; text-transform: capitalize; }
.pt-month .evs { display: flex; flex-wrap: wrap; gap: 7px; align-self: center; }
@media (max-width: 560px) { .pt-month { grid-template-columns: 1fr; gap: 8px; } }

.pt-note {
  margin-top: 16px; padding: 14px 16px; border-left: 3px solid var(--orange);
  background: var(--orange-tint); border-radius: 0 var(--r-ctrl) var(--r-ctrl) 0;
  color: var(--ink-2); font-size: 13.5px; line-height: 1.6;
}
.pt-note b { color: var(--ink); }

/* donate */
.pt-donate {
  background: var(--blue-tint); border: 1px solid var(--line);
  border-radius: var(--r-card); padding: 26px 24px;
}
.pt-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 11px 20px; border-radius: var(--r-ctrl); border: 1px solid transparent;
  background: var(--blue); color: var(--on-brand); font: inherit; font-weight: 700; font-size: 15px;
  text-decoration: none;
}
.pt-btn-ghost { background: var(--paper); color: var(--ink); border-color: var(--line); }

.pt-links { display: flex; flex-wrap: wrap; gap: 10px; }
.pt-chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px;
  border-radius: 999px; border: 1px solid var(--line); background: var(--paper);
  font-size: 13.5px; font-weight: 650; text-decoration: none; color: var(--ink);
}

/* the nonprofit's own details, under the chips in "Find us" */
.pt-org {
  margin-top: 18px; max-width: 62ch;
  background: var(--paper); border: 1px solid var(--line);
  border-radius: var(--r-card); padding: 16px 17px;
}
.pt-org h3 { margin: 0 0 10px; font-size: 15.5px; font-weight: 800; letter-spacing: -.2px; }
/* <address> is the right element and italics are not the right look. */
.pt-org address { font-style: normal; font-size: 14px; line-height: 1.6; color: var(--ink-2); }
.pt-org address b { color: var(--ink); }
.pt-org address a { font-weight: 650; text-decoration: none; }
.pt-org .ein {
  margin: 12px 0 0; display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline;
  font-size: 13.5px; color: var(--ink-3);
}
/* Tabular figures: a tax ID is a number to copy, not prose to read. */
.pt-org .ein b { color: var(--ink); font-variant-numeric: tabular-nums; letter-spacing: .3px; }
.pt-org .note { margin: 12px 0 0; color: var(--ink-2); font-size: 13.5px; line-height: 1.55; }

.pt-foot {
  border-top: 1px solid var(--line); margin-top: 52px; padding-top: 18px;
  color: var(--ink-3); font-size: 12.5px; line-height: 1.7;
}
.pt-langs { margin-top: 10px; display: flex; gap: 12px; flex-wrap: wrap; }
`;

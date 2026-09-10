// The page's stylesheet, inlined into the document.
//
// It is a deliberate cousin of `apps/web/src/styles/tokens.css` rather than a
// copy of it: same palette, same radii, same faces, but the type is set for a
// page someone reads once rather than an app they use every day. The tokens are
// re-declared here because this Worker ships no CSS file and no `.sd` scope —
// keep the hex values in step with the apps if they ever change.

export const STYLES = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
:root{
  --blue:#0068a8; --blue-700:#00568c; --blue-800:#063f63;
  --blue-tint:#e6f1f9; --blue-tint-2:#d2e6f4;
  --orange:#faab1c; --orange-600:#f2a010;
  --ink:#19232e; --ink-2:#56636f; --ink-3:#8693a0;
  --line:#e7eaed; --line-2:#dde2e6;
  --paper:#fff; --bg:#f3f5f7; --bg-2:#eef1f4;
  --ff:"Hanken Grotesk","Noto Sans SC",system-ui,sans-serif;
  --ff-mono:"Spline Sans Mono",ui-monospace,monospace;
  /* Native controls, scrollbars and the canvas behind the page follow the
     system theme; without this a dark page keeps a white scrollbar. */
  color-scheme:light dark;
}

/* Dark mode: system-driven, matching the three apps — no toggle and nothing
   stored. This page has no client bundle, so a toggle would need one, and a
   control that can disagree with the OS is a support question forever.
   blue-700 and blue-800 INVERT rather than darken: they are foregrounds on
   light surfaces here, so on dark they must run lighter or they vanish into
   the card. The closing .join band is the exception and is pinned to literals
   above, being dark on purpose in either theme. */
@media (prefers-color-scheme:dark){
  :root{
    --blue:#4ea6dd; --blue-700:#84c6ee; --blue-800:#addcf8;
    --blue-tint:#152f45; --blue-tint-2:#1d4160;
    --orange:#f3ad2d; --orange-600:#ffbe4d;
    --ink:#e8eef4; --ink-2:#aab8c4; --ink-3:#8494a1;
    --line:#2c3946; --line-2:#3a4855;
    --paper:#19222c; --bg:#0f151b; --bg-2:#222d38;
  }
}
body{
  margin:0;background:var(--bg);color:var(--ink);
  font-family:var(--ff);line-height:1.5;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
a{color:inherit}
img{max-width:100%}
.wrap{width:100%;max-width:1080px;margin:0 auto;padding:0 22px}
.eyebrow{
  font-family:var(--ff-mono);font-size:11px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);margin:0 0 18px;
}

/* ── Header ──────────────────────────────────────────────────────────────── */
.hd{background:var(--paper);border-bottom:1px solid var(--line)}
/* The min-height, not the padding, is what sets this bar's height — the mark
   and the way-out link only come to ~27px between them. Both come down
   together, or trimming the padding does nothing you can see. */
.hd-in{
  display:flex;align-items:center;justify-content:space-between;
  gap:18px;min-height:50px;padding-top:6px;padding-bottom:6px;
}
.mark{font-size:18px;font-weight:800;letter-spacing:-.035em;text-decoration:none;white-space:nowrap}
.mark i{font-style:normal;font-weight:600;color:var(--ink-3)}
.hd-out{font-size:12.5px;line-height:1.45;color:var(--ink-3);text-align:right}
.hd-out a{color:var(--blue-700);font-weight:600;text-decoration:none;border-bottom:1px solid var(--blue-tint-2)}
.hd-out a:hover{border-bottom-color:var(--blue)}
@media(max-width:719px){.hd-out .lbl{display:none}}

/* The place-stamp above the greeting. Same mono eyebrow as every other section
   label, tinted blue and pulled tight to the stack so it reads as a dateline on
   the greeting rather than as a heading for the whole hero. */
.place{display:inline-flex;align-items:center;gap:6px;color:var(--blue-700);margin-bottom:12px}
.place-pin{flex:0 0 auto;margin-top:-1px}

/* ── Hero: the greeting stack IS the language picker ─────────────────────── */
.hero{padding:54px 0 58px}
.hero-in{display:grid;gap:42px;align-items:center}
@media(min-width:920px){.hero{padding:84px 0 78px}.hero-in{grid-template-columns:1.02fr .98fr;gap:60px}}

.greet{display:flex;flex-direction:column;align-items:flex-start;gap:1px;margin:0;padding:0;list-style:none}
.greet a,.greet strong{
  display:inline-block;
  font-size:clamp(2.45rem,7.4vw,4.5rem);
  font-weight:800;letter-spacing:-.045em;line-height:1.06;
  color:var(--ink-2);text-decoration:underline;
  text-underline-offset:.12em;text-decoration-thickness:2px;
  text-decoration-color:var(--line-2);
  transition:color .14s,text-decoration-color .14s;
}
.greet strong{color:var(--ink);text-decoration-color:var(--orange);text-decoration-thickness:.085em}
.greet a:hover,.greet a:focus-visible{color:var(--blue);text-decoration-color:var(--blue)}
.greet [lang=zh]{line-height:1.22;letter-spacing:-.01em}
@keyframes rise{from{opacity:0;transform:translateY(13px)}to{opacity:1;transform:none}}
.greet li{animation:rise .55s cubic-bezier(.2,.75,.25,1) both;animation-delay:calc(var(--i) * 70ms)}

.card{
  background:var(--paper);border:1px solid var(--line);border-radius:16px;
  box-shadow:0 1px 3px rgba(20,30,40,.06),0 8px 26px rgba(20,30,40,.07);
}
.hero-card{padding:26px}
.lead{font-size:17px;line-height:1.55;color:var(--ink-2);margin:0 0 20px}
.acts{display:flex;flex-wrap:wrap;gap:10px}
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  height:48px;padding:0 20px;border-radius:11px;
  font-family:inherit;font-size:15.5px;font-weight:700;
  text-decoration:none;border:1px solid transparent;white-space:nowrap;
  transition:background .14s,border-color .14s;
}
.btn-primary{background:var(--orange);color:#3a2700}
.btn-primary:hover{background:var(--orange-600)}
.btn-quiet{background:var(--paper);color:var(--ink);border-color:var(--line-2)}
.btn-quiet:hover{border-color:var(--ink-3)}
/* Lives inside .join, so it is on that permanently-dark band and keeps the
   light-theme pairing in both themes. */
.btn-light{background:#fff;color:#063f63}
.btn-light:hover{background:#e6f1f9}
.note{margin:15px 0 0;font-size:12.5px;line-height:1.55;color:var(--ink-3)}

/* ── What's here: one tile per app, labelled with who may open it ────────── */
.sect{padding:4px 0 74px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(272px,1fr))}
.tile{
  display:flex;flex-direction:column;padding:22px;text-decoration:none;
  transition:transform .16s,box-shadow .16s,border-color .16s;
}
.tile:hover{
  transform:translateY(-2px);border-color:var(--blue-tint-2);
  box-shadow:0 2px 6px rgba(20,30,40,.06),0 14px 34px rgba(20,30,40,.09);
}
.tile-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.tile h2{margin:0;font-size:20px;font-weight:800;letter-spacing:-.025em;line-height:1.2}
.tag{
  font-family:var(--ff-mono);font-size:10px;font-weight:600;
  letter-spacing:.1em;text-transform:uppercase;
  padding:4px 8px;border-radius:6px;white-space:nowrap;
}
.tag-members{background:var(--blue-tint);color:var(--blue-800)}
.tag-open{background:var(--bg-2);color:var(--ink-2)}
.host{font-family:var(--ff-mono);font-size:11.5px;color:var(--ink-3);margin:7px 0 13px;word-break:break-all}
.tile p{margin:0;font-size:14.5px;line-height:1.55;color:var(--ink-2)}
.more{
  margin-top:14px;padding-top:13px;border-top:1px solid var(--line);
  font-size:13.5px;line-height:1.5;color:var(--ink-2);
}
.more b{color:var(--ink);font-weight:700}
.go{
  margin-top:auto;padding-top:18px;
  font-size:14px;font-weight:700;color:var(--blue-700);
  display:inline-flex;align-items:center;gap:7px;
}
.go span{transition:transform .16s}
.tile:hover .go span{transform:translateX(3px)}

/* ── What is next: the one block read live off the calendar ─────────────── */
.ev-sect{padding:0 0 74px}
.ev-in{display:grid;gap:24px}
@media(min-width:880px){.ev-in{grid-template-columns:.78fr 1.22fr;gap:52px;align-items:start}}
.ev-sect h2,.help h2{
  margin:0 0 12px;font-size:clamp(1.55rem,3.4vw,2.05rem);
  font-weight:800;letter-spacing:-.032em;line-height:1.14;
}
.ev-all{
  display:inline-flex;align-items:center;gap:7px;margin-top:4px;
  font-size:14px;font-weight:700;color:var(--blue-700);text-decoration:none;
}
.ev-all span{transition:transform .16s}
.ev-all:hover span{transform:translateX(3px)}

.ev-list{
  list-style:none;margin:0;padding:0;overflow:hidden;
  background:var(--paper);border:1px solid var(--line);border-radius:16px;
  box-shadow:0 1px 3px rgba(20,30,40,.06),0 8px 26px rgba(20,30,40,.07);
}
.ev-list li+li{border-top:1px solid var(--line)}
.ev{
  display:grid;gap:3px 22px;padding:15px 20px;
  color:inherit;text-decoration:none;transition:background .14s;
}
.ev:hover{background:var(--bg-2)}
/* The next thing to happen is the row most readers came for. */
.ev-list li:first-child .ev{box-shadow:inset 3px 0 0 var(--orange)}
@media(min-width:520px){.ev{grid-template-columns:9.5rem 1fr;align-items:baseline;padding:16px 22px}}
.ev-when{
  display:flex;flex-wrap:wrap;gap:2px 9px;
  font-family:var(--ff-mono);font-size:12px;letter-spacing:.01em;
}
@media(min-width:520px){.ev-when{display:block}}
.ev-date{font-weight:600;color:var(--blue-700);white-space:nowrap}
.ev-time{color:var(--ink-3);white-space:nowrap}
.ev-name{display:block;font-size:15.5px;font-weight:700;letter-spacing:-.012em;line-height:1.3}
.ev-note{display:block;margin-top:3px;font-size:13.5px;line-height:1.5;color:var(--ink-2)}

/* ── Who to call, where to look: the district's own information ──────────── */
.help{padding:0 0 78px}
.help h2{margin-bottom:26px}
.help-grid{display:grid;gap:26px 40px;align-items:start}
@media(min-width:760px){.help-grid{grid-template-columns:1fr 1fr}}
@media(min-width:1000px){.help-grid{grid-template-columns:1fr 1fr 1.15fr;gap:44px}}
.col h3{
  margin:0 0 14px;padding-bottom:9px;border-bottom:1px solid var(--line-2);
  font-size:11px;font-family:var(--ff-mono);font-weight:600;
  letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);
}

/* A phone list. Label left, number right, with room for a note underneath —
   which is why each row is its own grid rather than a bare dt/dd pair. */
.rows{margin:0}
.row{display:grid;grid-template-columns:1fr auto;gap:2px 14px;padding:9px 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
.rows.tight .row{padding:7px 0}
.row dt{font-size:14px;line-height:1.4;color:var(--ink)}
.row dd{margin:0;text-align:right;white-space:nowrap}
.row dd,.row dd a,.hours{font-family:var(--ff-mono);font-size:13px;font-variant-numeric:tabular-nums}
.row dd a{color:var(--blue-700);text-decoration:none;border-bottom:1px solid var(--blue-tint-2)}
.row dd a:hover{border-bottom-color:var(--blue)}
.hours{color:var(--ink);font-weight:600}
.rownote{grid-column:1/-1;margin:3px 0 0;font-size:12.5px;line-height:1.5;color:var(--ink-3)}

/* Where to look: name, why, then the bare URL the mailing prints. */
.res{list-style:none;margin:0;padding:0}
.res li{padding:11px 0;border-bottom:1px solid var(--line)}
.res li:last-child{border-bottom:0}
.res-name{font-size:14.5px;font-weight:700;letter-spacing:-.01em;color:var(--ink);text-decoration:none}
.res-name:hover{color:var(--blue-700)}
.res-note{margin:3px 0 0;font-size:13px;line-height:1.5;color:var(--ink-2)}
.res-note a{color:var(--blue-700);font-weight:600;overflow-wrap:anywhere}
.res-url{
  display:block;margin-top:5px;font-family:var(--ff-mono);font-size:11.5px;
  color:var(--ink-3);text-decoration:none;overflow-wrap:anywhere;
  transition:color .14s;
}
.res li:hover .res-url,.res-url:hover{color:var(--blue-700)}

/* ── Close: the one dark band, and the one thing it asks for ─────────────── */
/* Literal, not var(--blue-800): this band is dark BY DESIGN in either theme,
   where the token inverts (it is text on light everywhere else). Riding on it
   would turn the one dark band pale the moment the reader's OS went dark. */
.join{background:#063f63;color:#fff}
.join-in{padding-block:62px;display:grid;gap:28px;align-items:center}
@media(min-width:880px){.join-in{grid-template-columns:1.15fr .85fr;gap:52px;padding-block:76px}}
.join .eyebrow{color:rgba(255,255,255,.5)}
.join h2{margin:0 0 13px;font-size:clamp(1.85rem,4.2vw,2.65rem);font-weight:800;letter-spacing:-.035em;line-height:1.08}
.join p{margin:0;font-size:16px;line-height:1.6;color:rgba(255,255,255,.78);max-width:58ch}
.join-act .note{color:rgba(255,255,255,.6)}
@media(min-width:880px){.join-act{text-align:right}}

/* ── Footer ──────────────────────────────────────────────────────────────── */
.ft{background:var(--paper);border-top:1px solid var(--line)}
.ft-in{padding-block:28px 40px;font-size:12.5px;line-height:1.75;color:var(--ink-3);text-align:center}
.ft a{color:var(--blue-700);font-weight:600;text-decoration:none}
.ft a:hover{text-decoration:underline}

/* ── Not found ───────────────────────────────────────────────────────────── */
.gone{padding-block:96px 120px}
.gone h1{margin:0 0 10px;font-size:clamp(2rem,6vw,3rem);font-weight:800;letter-spacing:-.04em}
.gone p{margin:0 0 22px;font-size:16px;color:var(--ink-2)}

/* ── /faq: the page that explains the site ──────────────────────────────── */
/* Deliberately NOT a second landing page. The front door's hero is a 4.5rem
   greeting stack that doubles as the language picker; here the reader already
   chose to come, so the hero is a heading and the picker shrinks to a row of
   language names. Everything else — tags, cards, the dark closing band, the
   footer — is the landing page's, imported rather than restyled. */
.fq-hero{padding:44px 0 30px}
@media(min-width:920px){.fq-hero{padding:62px 0 38px}}
.fq-hero h1{
  margin:0 0 16px;max-width:15ch;
  font-size:clamp(2.1rem,5.6vw,3.4rem);font-weight:800;
  letter-spacing:-.04em;line-height:1.06;text-wrap:balance;
}
.fq-lead{margin:0;max-width:60ch;font-size:17px;line-height:1.6;color:var(--ink-2)}

/* The compact language picker. Names, each in its own language, no label —
   an English label is legible only to the readers who least need it. */
.langbar{
  display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 16px;
  list-style:none;margin:26px 0 0;padding:0;
  font-size:15px;
}
.langbar a,.langbar strong{
  text-decoration:underline;text-underline-offset:.22em;
  text-decoration-thickness:1.5px;
}
.langbar a{color:var(--ink-3);text-decoration-color:var(--line-2);font-weight:600}
.langbar a:hover,.langbar a:focus-visible{color:var(--blue);text-decoration-color:var(--blue)}
.langbar strong{color:var(--ink);text-decoration-color:var(--orange);text-decoration-thickness:2.5px}

.fq-sect{padding:0 0 52px}
.fq-sect h2{
  margin:0 0 18px;font-size:clamp(1.35rem,3vw,1.7rem);
  font-weight:800;letter-spacing:-.03em;line-height:1.15;text-wrap:balance;
}

/* What's here. A list, not the landing page's tile grid: this reader is being
   told what the places ARE, not asked to pick one. */
.fq-places{list-style:none;margin:0;padding:0;display:grid;gap:0}
.fq-places li{padding:16px 0;border-top:1px solid var(--line)}
.fq-places li:first-child{border-top:0;padding-top:0}
.fq-top{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.fq-name{
  font-size:17px;font-weight:800;letter-spacing:-.022em;
  color:var(--ink);text-decoration:none;
  border-bottom:1px solid var(--blue-tint-2);
}
.fq-name:hover{color:var(--blue-700);border-bottom-color:var(--blue)}
.fq-places p{margin:6px 0 0;font-size:14.5px;line-height:1.55;color:var(--ink-2);max-width:62ch}
.fq-places .host{margin:6px 0 0}

.fq-split{display:grid;gap:38px;align-items:start}
@media(min-width:920px){.fq-split{grid-template-columns:1fr 1fr;gap:48px}}

/* How to get in — the one numbered sequence on the page. */
.fq-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:16px}
.fq-steps li{display:grid;grid-template-columns:28px 1fr;gap:14px;align-items:start}
.fq-step-n{
  width:26px;height:26px;border-radius:999px;
  background:var(--blue);color:#fff;
  font-family:var(--ff-mono);font-size:12.5px;font-weight:600;
  display:flex;align-items:center;justify-content:center;
}
.fq-step-t{margin:0;font-size:16px;font-weight:700;letter-spacing:-.015em;line-height:1.3}
.fq-step-b{margin:3px 0 0;font-size:14px;line-height:1.55;color:var(--ink-2)}
.fq-step-b b{color:var(--ink);font-weight:700}

.fq-aside{
  margin:22px 0 0;padding:14px 16px;
  border-left:3px solid var(--orange);border-radius:0 10px 10px 0;
  background:var(--bg-2);
  font-size:14px;line-height:1.6;color:var(--ink-2);
}
.fq-aside b{color:var(--ink);font-weight:700}

/* Who sees what — the one thing on this page lifted onto a card, because it is
   the question that actually decides whether somebody joins. */
.fq-privacy{padding:26px}
.fq-privacy h2{margin-bottom:20px}
.fq-viss{display:flex;flex-direction:column;gap:15px}
.fq-vis{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.fq-vis p{margin:0;font-size:14px;line-height:1.5;color:var(--ink-2)}
/* The app's own three chip states, and deliberately no fourth. */
.chip{font-size:12.5px;font-weight:700;padding:4px 12px;border-radius:999px}
.chip-members{background:var(--blue-tint);color:var(--blue-800)}
.chip-private{background:var(--bg-2);color:var(--ink-2)}
.chip-shared{background:#fdf0d8;color:#8a5500}
@media(prefers-color-scheme:dark){.chip-shared{background:#3a2a0b;color:#f6cb7c}}
.fq-nopublic{
  margin:20px 0 0;padding-top:17px;border-top:1px solid var(--line);
  font-size:14px;line-height:1.62;color:var(--ink-2);
}
.fq-nopublic b{color:var(--ink);font-weight:700}

/* Good to know. */
.fq-notes{display:grid;gap:22px 36px}
@media(min-width:720px){.fq-notes{grid-template-columns:repeat(3,1fr)}}
.fq-notes h3{margin:0 0 5px;font-size:15px;font-weight:700;letter-spacing:-.015em;line-height:1.3}
.fq-notes p{margin:0;font-size:13.8px;line-height:1.58;color:var(--ink-2)}

/* A quiet way back to the front door's own explanation of itself. */
.fq-link{
  display:inline-flex;align-items:center;gap:7px;margin-top:14px;
  font-size:14px;font-weight:700;color:var(--blue-700);text-decoration:none;
}
.fq-link span{transition:transform .16s}
.fq-link:hover span{transform:translateX(3px)}

/* ── /faq/print: the handout ─────────────────────────────────────────────── */
/* On screen this is a plain stack of sheets so you can check what you are about
   to print; the rules that matter are in the @media print block below. */
.pr{max-width:900px;margin:0 auto;padding:26px 22px 60px}
.pr-sheet{
  background:var(--paper);border:1px solid var(--line);border-radius:14px;
  padding:32px;margin-bottom:26px;
}
.pr-head{margin-bottom:20px}
.pr-brand{
  margin:0 0 8px;font-family:var(--ff-mono);font-size:10.5px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);
}
.pr-sheet h1{
  margin:0 0 10px;font-size:29px;font-weight:800;
  letter-spacing:-.035em;line-height:1.08;text-wrap:balance;
}
.pr-lead{margin:0;font-size:14px;line-height:1.55;color:var(--ink-2);max-width:70ch}
.pr-cols{display:grid;gap:26px}
@media(min-width:720px){.pr-cols{grid-template-columns:1.08fr .92fr;gap:32px}}
.pr-block{margin-top:22px}
.pr-cols .pr-block{margin-top:0}
.pr-block h2{
  margin:0 0 12px;padding-bottom:7px;border-bottom:1px solid var(--line-2);
  font-family:var(--ff-mono);font-size:10.5px;font-weight:600;
  letter-spacing:.13em;text-transform:uppercase;color:var(--ink-3);
}
.pr-privacy .fq-viss{display:grid;gap:12px}
@media(min-width:720px){.pr-privacy .fq-viss{grid-template-columns:repeat(3,1fr)}}
.pr-foot{
  margin-top:24px;padding-top:14px;border-top:1px solid var(--line-2);
  display:flex;flex-wrap:wrap;gap:8px 24px;justify-content:space-between;align-items:baseline;
}
.pr-where{margin:0;font-size:13px;color:var(--ink-2)}
.pr-url{font-family:var(--ff-mono);font-size:11.5px;color:var(--ink-3)}
.pr-langs{
  display:flex;flex-wrap:wrap;gap:4px 18px;list-style:none;margin:0;padding:0;
  font-size:12.5px;color:var(--ink-2);
}
.pr-langs strong{color:var(--ink)}

/* ── Print ───────────────────────────────────────────────────────────────── */
/* Printing IS the export here (invariant 16): there is no PDF renderer in this
   project and there must not be one. Two rules make that safe.

   FIRST, this block RESTATES the light values rather than inheriting them. The
   dark block above is a token re-declaration keyed on the reader's OS, so a
   parent whose laptop is in dark mode would otherwise print near-white text
   onto white paper. Order is precedence, so this must stay BELOW that block —
   the same trap "NEWSLETTER_WEB_CSS" documents for the same reason.

   SECOND, nothing on paper is clickable, so every link that carries meaning has
   to write its address out. ".host" already prints the hostname of each app,
   and "data-url" does it for the language picker. */
@media print{
  :root{
    --blue:#005a92; --blue-700:#005a92; --blue-800:#003f66;
    --blue-tint:#eaf2f8; --blue-tint-2:#dbe8f2;
    --orange:#b07c10; --orange-600:#b07c10;
    --ink:#000; --ink-2:#333; --ink-3:#555;
    --line:#ccc; --line-2:#bbb;
    --paper:#fff; --bg:#fff; --bg-2:#f0f2f4;
  }
  @page{margin:12mm}
  body{background:#fff;color:#000;font-size:10pt;line-height:1.45}
  /* Chrome and Safari drop background fills by default, which would turn every
     tag and chip into unreadable dark-on-dark or invisible text. */
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}

  /* Site chrome is navigation, and navigation does not survive the printer. */
  .hd,.ft,.join,.langbar,.fq-link,.ev-sect,.help{display:none}

  .wrap{max-width:none;padding:0}
  a{text-decoration:none}

  /* ── One sheet per language ── */
  .pr{max-width:none;padding:0}
  .pr-sheet{
    border:0;border-radius:0;padding:0;margin:0;
    break-after:page;page-break-after:always;
  }
  .pr-sheet:last-child{break-after:auto;page-break-after:auto}
  .pr-sheet h1{font-size:20pt;margin-bottom:6px}
  .pr-lead{font-size:9.6pt;line-height:1.42}
  .pr-head{margin-bottom:13px}
  .pr-cols{grid-template-columns:1.08fr .92fr;gap:20px}
  .pr-block{margin-top:14px}
  .pr-block h2{font-size:8pt;margin-bottom:7px;padding-bottom:4px}
  .pr-foot{margin-top:14px;padding-top:8px}
  .pr-where{font-size:9pt}
  .pr-url{font-size:8pt}
  .pr-langs{font-size:8.5pt;gap:2px 14px}

  /* Blocks that must not be split across two pieces of paper. */
  .pr-block,.pr-foot,.fq-places li,.fq-steps li,.fq-vis,.fq-notes>div,.fq-aside{
    break-inside:avoid;page-break-inside:avoid;
  }

  /* ── Shared section chrome, tightened for ink ── */
  .fq-places li{padding:7px 0}
  .fq-places .fq-name{font-size:11pt;border-bottom:0}
  .fq-places p{font-size:9pt;line-height:1.4;margin-top:3px;max-width:none}
  .host{font-size:7.6pt;margin:3px 0 0}
  .tag{font-size:7pt;padding:2px 6px}
  .fq-steps{gap:9px}
  .fq-steps li{grid-template-columns:20px 1fr;gap:9px}
  .fq-step-n{width:19px;height:19px;font-size:9pt}
  .fq-step-t{font-size:10pt}
  .fq-step-b{font-size:9pt;line-height:1.4;margin-top:1px}
  .fq-aside{margin-top:12px;padding:8px 11px;font-size:8.8pt;line-height:1.45;border-radius:0 6px 6px 0}
  .fq-privacy,.pr-privacy{padding:0;border:0;box-shadow:none}
  .fq-viss{gap:10px}
  .fq-vis p{font-size:8.8pt;line-height:1.4}
  .chip{font-size:8.5pt;padding:2px 9px}
  .fq-nopublic{margin-top:11px;padding-top:8px;font-size:9pt;line-height:1.45}
  .fq-notes{grid-template-columns:repeat(3,1fr);gap:14px}
  .fq-notes h3{font-size:9.5pt}
  .fq-notes p{font-size:8.8pt;line-height:1.42}

  /* ── /faq printed on its own: one language, one sheet ── */
  .fq-hero{padding:0 0 12px}
  .fq-hero h1{font-size:20pt;max-width:none;margin-bottom:7px}
  .fq-lead{font-size:9.6pt;line-height:1.42;max-width:none}
  .fq-sect{padding:0 0 14px}
  .fq-sect h2,.eyebrow{
    font-size:8pt;margin:0 0 7px;
    font-family:var(--ff-mono);font-weight:600;letter-spacing:.13em;
    text-transform:uppercase;color:var(--ink-3);
  }
  .fq-split{grid-template-columns:1.08fr .92fr;gap:20px}
  .place-pin{display:none}
}

/* ── Quality floor ───────────────────────────────────────────────────────── */
a:focus-visible,.btn:focus-visible{outline:2px solid var(--blue);outline-offset:3px;border-radius:4px}
.join a:focus-visible{outline-color:var(--orange)}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none !important;transition:none !important}
  .tile:hover{transform:none}
}
`;

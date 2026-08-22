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
.btn-light{background:#fff;color:var(--blue-800)}
.btn-light:hover{background:var(--blue-tint)}
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
.join{background:var(--blue-800);color:#fff}
.join-in{padding:62px 0;display:grid;gap:28px;align-items:center}
@media(min-width:880px){.join-in{grid-template-columns:1.15fr .85fr;gap:52px;padding:76px 0}}
.join .eyebrow{color:rgba(255,255,255,.5)}
.join h2{margin:0 0 13px;font-size:clamp(1.85rem,4.2vw,2.65rem);font-weight:800;letter-spacing:-.035em;line-height:1.08}
.join p{margin:0;font-size:16px;line-height:1.6;color:rgba(255,255,255,.78);max-width:58ch}
.join-act .note{color:rgba(255,255,255,.6)}
@media(min-width:880px){.join-act{text-align:right}}

/* ── Footer ──────────────────────────────────────────────────────────────── */
.ft{background:var(--paper);border-top:1px solid var(--line)}
.ft-in{padding:28px 0 40px;font-size:12.5px;line-height:1.75;color:var(--ink-3);text-align:center}
.ft a{color:var(--blue-700);font-weight:600;text-decoration:none}
.ft a:hover{text-decoration:underline}

/* ── Not found ───────────────────────────────────────────────────────────── */
.gone{padding:96px 0 120px}
.gone h1{margin:0 0 10px;font-size:clamp(2rem,6vw,3rem);font-weight:800;letter-spacing:-.04em}
.gone p{margin:0 0 22px;font-size:16px;color:var(--ink-2)}

/* ── Quality floor ───────────────────────────────────────────────────────── */
a:focus-visible,.btn:focus-visible{outline:2px solid var(--blue);outline-offset:3px;border-radius:4px}
.join a:focus-visible{outline-color:var(--orange)}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none !important;transition:none !important}
  .tile:hover{transform:none}
}
`;

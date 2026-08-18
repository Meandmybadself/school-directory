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
.hd-in{
  display:flex;align-items:center;justify-content:space-between;
  gap:18px;min-height:62px;padding-top:11px;padding-bottom:11px;
}
.mark{font-size:18px;font-weight:800;letter-spacing:-.035em;text-decoration:none;white-space:nowrap}
.mark i{font-style:normal;font-weight:600;color:var(--ink-3)}
.hd-out{font-size:12.5px;line-height:1.45;color:var(--ink-3);text-align:right}
.hd-out a{color:var(--blue-700);font-weight:600;text-decoration:none;border-bottom:1px solid var(--blue-tint-2)}
.hd-out a:hover{border-bottom-color:var(--blue)}
@media(max-width:719px){.hd-out .lbl{display:none}}

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

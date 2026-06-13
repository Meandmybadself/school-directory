// ds.jsx — School Directory design system: tokens, icons, atoms.
// Loaded first. Exports atoms to window for the screen files.

/* ── Design tokens + component CSS (scoped under .sd) ───────────── */
(function injectDS() {
  if (document.getElementById('sd-styles')) return;
  const css = `
  .sd{
    --blue:#0068A8; --blue-700:#00568c; --blue-800:#063f63;
    --blue-tint:#e6f1f9; --blue-tint-2:#d2e6f4;
    --orange:#faab1c; --orange-700:#cf7e00; --orange-ink:#8a5500;
    --orange-tint:#fdf0d8; --orange-tint-2:#fbe4b8;

    --ink:#19232e; --ink-2:#56636f; --ink-3:#8693a0;
    --line:#e7eaed; --line-2:#dde2e6;
    --paper:#ffffff; --bg:#f3f5f7; --bg-2:#eef1f4;
    --slate-tint:#eef1f4;

    --ok:#1f8a5b; --warn:#b5562f;

    --r-card:16px; --r-ctrl:11px; --r-sm:8px;
    --sh-1:0 1px 2px rgba(20,30,40,.05);
    --sh-2:0 1px 3px rgba(20,30,40,.06), 0 6px 18px rgba(20,30,40,.06);
    --sh-pop:0 8px 30px rgba(20,30,40,.16), 0 0 0 1px rgba(20,30,40,.04);

    --ff:"Hanken Grotesk","Noto Sans SC",system-ui,sans-serif;
    --ff-serif:"Source Serif 4",Georgia,serif;
    --ff-mono:"Spline Sans Mono",ui-monospace,monospace;

    font-family:var(--ff); color:var(--ink); box-sizing:border-box;
    -webkit-font-smoothing:antialiased; line-height:1.45;
  }
  .sd *,.sd *::before,.sd *::after{box-sizing:border-box;}
  .sd ::selection{background:var(--blue-tint-2);}

  /* phone frame */
  .sd-phone{width:360px;background:var(--bg);position:relative;overflow:hidden;display:flex;flex-direction:column;}
  .sd-status{height:30px;flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;
    padding:0 20px 0 22px;font-size:13px;font-weight:600;color:var(--ink);letter-spacing:.2px;}
  .sd-status .r{display:flex;align-items:center;gap:6px;}
  .sd-statusbars{display:flex;align-items:center;gap:5px;}

  /* app bar */
  .sd-appbar{flex:0 0 auto;background:var(--paper);border-bottom:1px solid var(--line);
    padding:9px 14px;display:flex;align-items:center;gap:10px;}
  .sd-scroll{flex:1 1 auto;overflow:hidden;}
  .sd-body{padding:16px 16px 26px;display:flex;flex-direction:column;gap:14px;}

  /* type */
  .sd-h1{font-size:25px;font-weight:700;letter-spacing:-.5px;line-height:1.14;margin:0;}
  .sd-h2{font-size:19px;font-weight:700;letter-spacing:-.3px;line-height:1.2;margin:0;}
  .sd-eyebrow{font-size:11.5px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:var(--ink-3);margin:0;}
  .sd-lead{font-size:15px;color:var(--ink-2);line-height:1.5;margin:0;}
  .sd-meta{font-size:12.5px;color:var(--ink-3);margin:0;}
  .sd-label{font-size:12px;font-weight:600;letter-spacing:.2px;color:var(--ink-2);margin:0;}
  .sd-mono{font-family:var(--ff-mono);}

  /* card */
  .sd-card{background:var(--paper);border:1px solid var(--line);border-radius:var(--r-card);box-shadow:var(--sh-1);}
  .sd-card-pad{padding:16px;}
  .sd-sectlabel{display:flex;align-items:center;justify-content:space-between;margin:2px 2px 0;}

  /* buttons */
  .sd-btn{font-family:inherit;font-size:15px;font-weight:600;border-radius:var(--r-ctrl);border:1px solid transparent;
    padding:0 16px;height:46px;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;
    line-height:1;white-space:nowrap;transition:filter .15s, background .15s;}
  .sd-btn.block{width:100%;}
  .sd-btn-primary{background:var(--blue);color:#fff;box-shadow:0 1px 0 rgba(0,0,0,.04);}
  .sd-btn-secondary{background:var(--paper);color:var(--ink);border-color:var(--line-2);}
  .sd-btn-ghost{background:transparent;color:var(--blue-700);}
  .sd-btn-sm{height:36px;font-size:13.5px;padding:0 13px;border-radius:9px;gap:6px;}
  .sd-btn-orange{background:var(--orange);color:#3a2700;}

  /* avatar */
  .sd-av{flex:0 0 auto;border-radius:50%;display:flex;align-items:center;justify-content:center;
    font-weight:700;color:#fff;letter-spacing:.3px;overflow:hidden;background-size:cover;background-position:center;}

  /* visibility chip */
  .sd-vis{display:inline-flex;align-items:center;gap:5px;height:25px;padding:0 9px 0 8px;border-radius:999px;
    font-size:12px;font-weight:600;line-height:1;cursor:pointer;white-space:nowrap;border:1px solid transparent;}
  .sd-vis svg{flex:0 0 auto;}
  .sd-vis .cw{opacity:.55;width:9px;height:9px;margin-left:1px;}
  .vis-members{background:var(--blue-tint);color:var(--blue-800);border-color:var(--blue-tint-2);}
  .vis-private{background:var(--slate-tint);color:var(--ink-2);border-color:var(--line-2);}
  .vis-shared{background:var(--orange-tint);color:var(--orange-ink);border-color:var(--orange-tint-2);}

  /* small tag / capability pill */
  .sd-tag{display:inline-flex;align-items:center;gap:4px;height:21px;padding:0 8px;border-radius:6px;
    font-size:11.5px;font-weight:600;background:var(--bg-2);color:var(--ink-2);white-space:nowrap;}
  .sd-tag.blue{background:var(--blue-tint);color:var(--blue-800);}
  .sd-tag.orange{background:var(--orange-tint);color:var(--orange-ink);}
  .sd-tag.line{background:transparent;border:1px solid var(--line-2);color:var(--ink-2);}

  /* contact row */
  .sd-crow{display:flex;align-items:flex-start;gap:11px;padding:12px 0;border-top:1px solid var(--line);}
  .sd-crow:first-child{border-top:0;}
  .sd-cicon{flex:0 0 auto;width:34px;height:34px;border-radius:9px;background:var(--bg-2);color:var(--ink-2);
    display:flex;align-items:center;justify-content:center;margin-top:1px;}
  .sd-cmain{flex:1 1 auto;min-width:0;}
  .sd-cval{font-size:14.5px;font-weight:600;color:var(--ink);word-break:break-word;}
  .sd-clabel{font-size:11.5px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;color:var(--ink-3);margin-bottom:1px;}

  /* member/list row */
  .sd-mrow{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--line);}
  .sd-mrow:first-child{border-top:0;}

  /* input */
  .sd-input{width:100%;height:48px;border:1px solid var(--line-2);border-radius:var(--r-ctrl);background:var(--paper);
    padding:0 14px;font-family:inherit;font-size:16px;color:var(--ink);outline:none;}
  .sd-input::placeholder{color:var(--ink-3);}
  .sd-input:focus{border-color:var(--blue);box-shadow:0 0 0 3px var(--blue-tint);}
  .sd-input.focus{border-color:var(--blue);box-shadow:0 0 0 3px var(--blue-tint);}

  /* toggle */
  .sd-toggle{width:42px;height:25px;border-radius:999px;background:var(--line-2);position:relative;flex:0 0 auto;transition:background .15s;}
  .sd-toggle.on{background:var(--blue);}
  .sd-toggle::after{content:"";position:absolute;top:2px;left:2px;width:21px;height:21px;border-radius:50%;background:#fff;
    box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s;}
  .sd-toggle.on::after{transform:translateX(17px);}

  /* segmented */
  .sd-seg{display:flex;background:var(--bg-2);border-radius:10px;padding:3px;gap:2px;}
  .sd-seg button{flex:1;border:0;background:transparent;font-family:inherit;font-size:12.5px;font-weight:600;
    color:var(--ink-2);height:30px;border-radius:7px;cursor:pointer;}
  .sd-seg button.on{background:var(--paper);color:var(--ink);box-shadow:var(--sh-1);}

  /* banner */
  .sd-banner{display:flex;align-items:center;gap:9px;padding:8px 14px;font-size:13px;font-weight:600;}
  .banner-offline{background:#33414f;color:#eaf0f5;}
  .banner-masq{background:var(--orange);color:#3a2700;}

  /* sheet */
  .sd-sheet{background:var(--paper);border-radius:20px 20px 0 0;box-shadow:0 -8px 40px rgba(20,30,40,.16);}
  .sd-grabber{width:38px;height:4px;border-radius:2px;background:var(--line-2);margin:10px auto 4px;}
  .sd-scrim{position:absolute;inset:0;background:rgba(16,26,36,.42);}

  /* misc */
  .sd-divider{height:1px;background:var(--line);border:0;margin:0;}
  .sd-link{color:var(--blue-700);font-weight:600;text-decoration:none;}
  .sd-row{display:flex;align-items:center;}
  .sd-dot{width:3px;height:3px;border-radius:50%;background:var(--ink-3);display:inline-block;flex:0 0 auto;}
  .sd-fieldcard{border:1px solid var(--line);border-radius:14px;overflow:hidden;}
  .sd-fieldcard > .fr{padding:12px 14px;border-top:1px solid var(--line);}
  .sd-fieldcard > .fr:first-child{border-top:0;}
  `;
  const s = document.createElement('style');
  s.id = 'sd-styles';
  s.textContent = css;
  document.head.appendChild(s);
})();

/* ── Icons (simple line set, 1.7 stroke, currentColor) ─────────── */
function Icon({ name, size = 18, stroke = 1.7, style }) {
  const p = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round',
    style,
  };
  const paths = {
    lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
    members: <><circle cx="9" cy="9" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 7.5a3 3 0 0 1 0 6M15.5 19a5.5 5.5 0 0 0-1.8-4.1" /></>,
    pencil: <><path d="M14 5.5l4.5 4.5M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z" /></>,
    eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    check: <><path d="M5 12.5l4.5 4.5L19 7" /></>,
    chevdown: <><path d="M6 9l6 6 6-6" /></>,
    chevright: <><path d="M9 6l6 6-6 6" /></>,
    chevleft: <><path d="M15 6l-6 6 6 6" /></>,
    home: <><path d="M4 11l8-6 8 6" /><path d="M6 10v9h12v-9" /></>,
    school: <><path d="M3 8l9-4 9 4-9 4-9-4z" /><path d="M7 10.5V15c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.5" /><path d="M21 8v5" /></>,
    phone: <><path d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A15 15 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z" /></>,
    mail: <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M4 7l8 5.5L20 7" /></>,
    link: <><path d="M10 14a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7L11 7.3" /><path d="M14 10a4 4 0 0 0-5.7 0L6 12.3a4 4 0 0 0 5.7 5.7L13 16.7" /></>,
    pin: <><path d="M12 21s7-5.6 7-11a7 7 0 0 0-14 0c0 5.4 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></>,
    x: <><path d="M6 6l12 12M18 6L6 18" /></>,
    wifioff: <><path d="M3 3l18 18" /><path d="M5 12.5a11 11 0 0 1 4-2.6M2 8.8A16 16 0 0 1 7 6M16.5 10A11 11 0 0 1 19 12.5M22 8.8a16 16 0 0 0-6.5-3.4M9 16a5 5 0 0 1 5.6-.9" /><path d="M12 20h.01" /></>,
    shield: <><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /></>,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>,
    arrowleft: <><path d="M19 12H5M11 6l-6 6 6 6" /></>,
    bolt: <><path d="M13 3L5 14h6l-1 7 8-11h-6z" /></>,
    upload: <><path d="M12 16V5M8 9l4-4 4 4" /><path d="M5 16v2a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18v-2" /></>,
    globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" /></>,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M21 12h-2.5M5.5 12H3M18 6l-1.8 1.8M7.8 16.2 6 18M18 18l-1.8-1.8M7.8 7.8 6 6" /></>,
    users3: <><circle cx="8" cy="9.5" r="2.6" /><path d="M3 18a5 5 0 0 1 10 0" /><circle cx="16.5" cy="8" r="2.2" /><path d="M14 18a5 5 0 0 1 7-4.5" /></>,
    file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
    table: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 10h17M9 10v9M3.5 14.5h17" /></>,
    swap: <><path d="M7 4L4 7l3 3" /><path d="M4 7h11a4 4 0 0 1 0 8" /><path d="M17 20l3-3-3-3" /><path d="M20 17H9" /></>,
    dot3: <><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
    star: <><path d="M12 4l2.3 4.7 5.2.8-3.7 3.6.9 5.1L12 15.8 7.3 18.2l.9-5.1L4.5 9.5l5.2-.8z" /></>,
    minus: <><path d="M5 12h14" /></>,
    info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>,
  };
  return <svg {...p}>{paths[name] || null}</svg>;
}

/* ── Avatar (deterministic colored initials) ───────────────────── */
const SD_AV_COLORS = [
  '#0068A8', '#2f8f6b', '#c4632a', '#7257b8', '#b8456b',
  '#1f7a8c', '#a67c00', '#4a6fb5', '#8a5a2b', '#5a7a3a',
];
function avColor(seed) {
  let h = 0;
  for (let i = 0; i < (seed || '').length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return SD_AV_COLORS[h % SD_AV_COLORS.length];
}
function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function Avatar({ name, size = 40, ring, img, color, textColor }) {
  const fs = Math.round(size * 0.38);
  const st = {
    width: size, height: size, fontSize: fs, color: textColor || '#fff',
    background: img ? `#ccd no-repeat center/cover` : (color || avColor(name)),
    boxShadow: ring ? `0 0 0 2px #fff, 0 0 0 ${ring}px ${color || avColor(name)}` : undefined,
  };
  if (img) st.backgroundImage = `url(${img})`;
  return <div className="sd-av" style={st}>{img ? '' : initials(name)}</div>;
}

/* ── Visibility chip ───────────────────────────────────────────── */
// state: 'members' | 'private' | 'shared'  (shared shows count)
function Vis({ state = 'members', count, label, withCaret = true, t }) {
  const T = t || {};
  const map = {
    members: { cls: 'vis-members', icon: 'members', txt: T.members || 'Members' },
    private: { cls: 'vis-private', icon: 'lock', txt: T.private || 'Private' },
    shared: { cls: 'vis-shared', icon: 'lock', txt: (T.shared || 'Shared') + (count != null ? ' · ' + count : '') },
  };
  const m = map[state] || map.members;
  return (
    <span className={'sd-vis ' + m.cls}>
      <Icon name={m.icon} size={12} stroke={2} />
      {label || m.txt}
      {withCaret && <Icon name="chevdown" size={11} stroke={2.2} style={{ opacity: 0.5, marginLeft: 1 }} />}
    </span>
  );
}

/* ── Button ────────────────────────────────────────────────────── */
function Btn({ children, kind = 'primary', sm, block, icon, iconRight, style }) {
  const cls = `sd-btn sd-btn-${kind}${sm ? ' sd-btn-sm' : ''}${block ? ' block' : ''}`;
  const isz = sm ? 16 : 18;
  return (
    <button className={cls} style={style}>
      {icon && <Icon name={icon} size={isz} />}
      {children}
      {iconRight && <Icon name={iconRight} size={isz} />}
    </button>
  );
}

/* ── Tag / capability pill ─────────────────────────────────────── */
function Tag({ children, tone = '', icon }) {
  return <span className={'sd-tag ' + tone}>{icon && <Icon name={icon} size={12} stroke={2} />}{children}</span>;
}

Object.assign(window, { Icon, Avatar, Vis, Btn, Tag, avColor, initials });

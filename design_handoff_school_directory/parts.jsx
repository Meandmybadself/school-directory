// parts.jsx — composite components built from the ds atoms.

/* Phone status bar */
function StatusBar({ dark, time = '9:41' }) {
  const col = dark ? '#fff' : 'var(--ink)';
  return (
    <div className="sd-status" style={{ color: col }}>
      <span>{time}</span>
      <span className="r">
        <span className="sd-statusbars">
          {[7, 10, 13, 16].map((h, i) => (
            <span key={i} style={{ width: 3, height: h, borderRadius: 1, background: col, opacity: i === 3 ? 0.35 : 1, display: 'inline-block' }} />
          ))}
        </span>
        <svg width="17" height="12" viewBox="0 0 17 12" fill="none"><path d="M1 4.5a8 8 0 0 1 15 0" stroke={col} strokeWidth="1.4" strokeLinecap="round" /><path d="M4 7a4.5 4.5 0 0 1 9 0" stroke={col} strokeWidth="1.4" strokeLinecap="round" opacity="0.85" /><circle cx="8.5" cy="10" r="1.3" fill={col} /></svg>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <span style={{ width: 22, height: 11, borderRadius: 3, border: `1.3px solid ${col}`, opacity: 0.5, position: 'relative', display: 'inline-block' }}>
            <span style={{ position: 'absolute', inset: 1.5, width: '72%', background: col, borderRadius: 1 }} />
          </span>
          <span style={{ width: 1.5, height: 4, background: col, opacity: 0.5, borderRadius: 1 }} />
        </span>
      </span>
    </div>
  );
}

/* Phone wrapper — fills the artboard */
function Phone({ children, bg = 'var(--bg)', dark, time, banner, theme }) {
  return (
    <div className={'sd sd-phone' + (theme ? ' ' + theme : '')} style={{ background: bg, height: '100%' }}>
      <StatusBar dark={dark} time={time} />
      {banner}
      {children}
    </div>
  );
}

/* Active-Person switcher pill (collapsed, sits in app bar) */
function SwitcherPill({ name, caps, color, expandIcon = true, sub }) {
  return (
    <div className="sd-row" style={{ gap: 10, flex: 1, minWidth: 0, cursor: 'pointer' }}>
      <Avatar name={name} size={38} color={color} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="sd-row" style={{ gap: 5 }}>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
          {expandIcon && <Icon name="chevdown" size={15} stroke={2.2} style={{ color: 'var(--ink-3)', flex: '0 0 auto' }} />}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 600, marginTop: -1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub || (caps || []).join(' · ')}
        </div>
      </div>
    </div>
  );
}

/* App bar with switcher + trailing actions */
function AppBar({ person, color, trailing }) {
  return (
    <div className="sd-appbar">
      <SwitcherPill name={person.name} caps={person.caps} color={color} sub={person.sub} />
      <div className="sd-row" style={{ gap: 4, flex: '0 0 auto' }}>{trailing}</div>
    </div>
  );
}
function IconBtn({ name, badge, tone }) {
  return (
    <button style={{
      width: 38, height: 38, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--paper)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative',
      color: tone === 'blue' ? 'var(--blue-700)' : 'var(--ink-2)',
    }}>
      <Icon name={name} size={19} />
      {badge && <span style={{ position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: 4, background: 'var(--orange)', boxShadow: '0 0 0 2px #fff' }} />}
    </button>
  );
}

/* Section label row above a card */
function SectLabel({ children, action }) {
  return (
    <div className="sd-sectlabel">
      <p className="sd-eyebrow">{children}</p>
      {action}
    </div>
  );
}

/* Contact item row */
function ContactRow({ icon, label, value, vis, sub }) {
  return (
    <div className="sd-crow">
      <div className="sd-cicon"><Icon name={icon} size={17} /></div>
      <div className="sd-cmain">
        <div className="sd-clabel">{label}</div>
        <div className="sd-cval">{value}</div>
        {sub && <div className="sd-meta" style={{ marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ flex: '0 0 auto', marginTop: 2 }}>{vis}</div>
    </div>
  );
}

/* Member / roster row */
function MemberRow({ name, color, title, tags, trailing, sub, img }) {
  return (
    <div className="sd-mrow">
      <Avatar name={name} size={40} color={color} img={img} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sd-row" style={{ gap: 7, flexWrap: 'wrap', rowGap: 3 }}>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.2px', whiteSpace: 'nowrap' }}>{name}</span>
          {tags}
        </div>
        {(title || sub) && <div className="sd-meta" style={{ marginTop: 2 }}>{title}{sub}</div>}
      </div>
      {trailing && <div style={{ flex: '0 0 auto' }}>{trailing}</div>}
    </div>
  );
}

/* Neighbor card */
function NeighborCard({ name, color, dist, connected, t = {} }) {
  return (
    <div className="sd-card sd-card-pad" style={{ padding: 13, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div className="sd-row" style={{ justifyContent: 'space-between' }}>
        <Avatar name={name} size={42} color={color} />
        <span className="sd-tag" style={{ background: 'var(--blue-tint)', color: 'var(--blue-800)' }}>
          <Icon name="pin" size={11} stroke={2} />{dist}
        </span>
      </div>
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        <div className="sd-meta" style={{ marginTop: 1 }}>{t.member || 'Member'}</div>
      </div>
      {connected
        ? <button className="sd-btn sd-btn-secondary sd-btn-sm block" style={{ color: 'var(--ok)' }}><Icon name="check" size={15} />{t.connected || 'Connected'}</button>
        : <button className="sd-btn sd-btn-secondary sd-btn-sm block"><Icon name="plus" size={15} />{t.connect || 'Connect'}</button>}
    </div>
  );
}

/* Primary CTA card (empty states) */
function CTACard({ icon = 'pin', title, body, action, tone = 'blue' }) {
  const tint = tone === 'orange' ? 'var(--orange-tint)' : 'var(--blue-tint)';
  const ink = tone === 'orange' ? 'var(--orange-700)' : 'var(--blue)';
  return (
    <div className="sd-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, borderStyle: 'dashed', borderColor: 'var(--line-2)' }}>
      <div className="sd-row" style={{ gap: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: tint, color: ink, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
          <Icon name={icon} size={22} />
        </div>
        <div>
          <div className="sd-h2" style={{ fontSize: 16.5 }}>{title}</div>
          <div className="sd-lead" style={{ fontSize: 13.5, marginTop: 2 }}>{body}</div>
        </div>
      </div>
      {action}
    </div>
  );
}

/* Group entry tile */
function GroupTile({ icon, name, sub, color = 'var(--blue)', tint = 'var(--blue-tint)' }) {
  return (
    <div className="sd-card" style={{ padding: 13, display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer' }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: tint, color, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
        <Icon name={icon} size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        <div className="sd-meta" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      </div>
      <Icon name="chevright" size={18} style={{ color: 'var(--ink-3)' }} />
    </div>
  );
}

/* Global banners */
function OfflineBanner({ text = 'Offline — showing your saved copy' }) {
  return <div className="sd-banner banner-offline"><Icon name="wifioff" size={16} />{text}<span style={{ marginLeft: 'auto', opacity: 0.7, fontWeight: 600 }}>Read-only</span></div>;
}
function MasqBanner({ user = 'Dana Ruiz', text = 'Viewing as', back = 'Return to admin' }) {
  return (
    <div className="sd-banner banner-masq">
      <Icon name="shield" size={16} />{text} <strong style={{ fontWeight: 800 }}>{user}</strong>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'underline' }}>{back}<Icon name="chevright" size={14} /></span>
    </div>
  );
}

/* Field block for edit mode */
function Field({ label, children, hint, vis }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="sd-row" style={{ justifyContent: 'space-between', gap: 10 }}>
        <span className="sd-label" style={{ whiteSpace: 'nowrap' }}>{label}</span>
        {vis}
      </div>
      {children}
      {hint && <div className="sd-meta" style={{ lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

/* Bottom-sheet shell layered over a dimmed screen (for the privacy sheet etc.) */
function SheetOver({ children, height }) {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div className="sd-scrim" />
      <div className="sd-sheet" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '92%' }}>
        <div className="sd-grabber" />
        <div style={{ padding: '4px 18px 22px' }}>{children}</div>
      </div>
    </div>
  );
}

/* Radio / check option row inside sheets */
function OptionRow({ icon, title, sub, selected, tone }) {
  const tint = tone === 'members' ? 'var(--blue-tint)' : tone === 'shared' ? 'var(--orange-tint)' : 'var(--slate-tint)';
  const ink = tone === 'members' ? 'var(--blue-800)' : tone === 'shared' ? 'var(--orange-ink)' : 'var(--ink-2)';
  return (
    <div className="sd-row" style={{ gap: 12, padding: '12px 12px', borderRadius: 12, border: '1px solid ' + (selected ? 'var(--blue)' : 'var(--line)'), background: selected ? 'var(--blue-tint)' : 'var(--paper)', boxShadow: selected ? '0 0 0 3px var(--blue-tint)' : 'none' }}>
      {icon && <div style={{ width: 34, height: 34, borderRadius: 9, background: tint, color: ink, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}><Icon name={icon} size={17} stroke={2} /></div>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700 }}>{title}</div>
        {sub && <div className="sd-meta" style={{ marginTop: 1, lineHeight: 1.35 }}>{sub}</div>}
      </div>
      <div style={{ width: 21, height: 21, borderRadius: 999, border: '2px solid ' + (selected ? 'var(--blue)' : 'var(--line-2)'), flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {selected && <span style={{ width: 11, height: 11, borderRadius: 999, background: 'var(--blue)' }} />}
      </div>
    </div>
  );
}

Object.assign(window, {
  StatusBar, Phone, SwitcherPill, AppBar, IconBtn, SectLabel, ContactRow, MemberRow,
  NeighborCard, CTACard, GroupTile, OfflineBanner, MasqBanner, Field, SheetOver, OptionRow,
});

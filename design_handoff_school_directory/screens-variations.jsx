// screens-variations.jsx — Home explorations: layout + overall visual style.

/* Warm / serif theme overrides (applied via .warm on the phone) */
(function injectWarm() {
  if (document.getElementById('sd-warm-styles')) return;
  const s = document.createElement('style');
  s.id = 'sd-warm-styles';
  s.textContent = `
  .sd.warm{ --bg:#f6f1e9; --paper:#fffdf9; --line:#ece3d5; --line-2:#e2d6c4;
    --bg-2:#f0e8da; --slate-tint:#efe7d9; --ink:#241f18; --ink-2:#6b6052; --ink-3:#9a8d7b;
    --blue:#1f6a8c; --blue-700:#185773; --blue-800:#123f54; --blue-tint:#e4eef2; --blue-tint-2:#cfe1e9;
    --r-card:18px; --r-ctrl:13px; }
  .warm .sd-h1,.warm .sd-h2{ font-family:var(--ff-serif); letter-spacing:-.2px; font-weight:600; }
  .warm .sd-eyebrow{ font-family:var(--ff-serif); font-style:italic; text-transform:none; letter-spacing:0; font-size:14px; font-weight:600; color:var(--ink-2); }
  .warm .sd-card{ box-shadow:0 1px 2px rgba(60,40,20,.05); }
  `;
  document.head.appendChild(s);
})();

function HomeStyleWarm() { return <HomeScreen theme="warm" />; }

/* Layout B — list-first: switcher hero + neighbors as full-width rows */
function NeighborListRow({ name, dist, connected }) {
  return (
    <div className="sd-row" style={{ gap: 12, padding: '11px 0', borderTop: '1px solid var(--line)' }}>
      <Avatar name={name} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.2px' }}>{name}</div>
        <div className="sd-row" style={{ gap: 6, marginTop: 3 }}>
          <span className="sd-tag" style={{ background: 'var(--blue-tint)', color: 'var(--blue-800)' }}><Icon name="pin" size={11} stroke={2} />{dist}</span>
          <span className="sd-meta">Member</span>
        </div>
      </div>
      {connected
        ? <span className="sd-row" style={{ gap: 5, color: 'var(--ok)', fontSize: 13, fontWeight: 700 }}><Icon name="check" size={16} />Connected</span>
        : <button className="sd-btn sd-btn-secondary sd-btn-sm"><Icon name="plus" size={15} />Connect</button>}
    </div>
  );
}

function HomeLayoutB() {
  return (
    <Phone>
      <div className="sd-appbar" style={{ justifyContent: 'space-between' }}>
        <Brand size="md" />
        <div className="sd-row" style={{ gap: 4 }}><IconBtn name="globe" /><IconBtn name="search" badge /></div>
      </div>
      <div className="sd-scroll" style={{ overflow: 'hidden' }}>
        <div className="sd-body">
          {/* switcher hero */}
          <div className="sd-card" style={{ padding: 16, background: 'var(--blue)', borderColor: 'var(--blue)', color: '#fff' }}>
            <div className="sd-row" style={{ gap: 13 }}>
              <Avatar name="Dana Ruiz" size={50} color="#fff" textColor="var(--blue)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', opacity: 0.7 }}>Acting as</div>
                <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-.3px' }}>Dana Ruiz</div>
                <div style={{ fontSize: 12.5, opacity: 0.85, fontWeight: 600 }}>Parent · Teacher</div>
              </div>
              <button style={{ width: 40, height: 40, borderRadius: 11, border: 0, background: 'rgba(255,255,255,.18)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon name="swap" size={20} /></button>
            </div>
            <div className="sd-row" style={{ gap: 8, marginTop: 13 }}>
              <div className="sd-row" style={{ gap: 6, flex: 1, background: 'rgba(255,255,255,.14)', borderRadius: 10, padding: '9px 11px' }}>
                <Avatar name="Charlie Lee" size={24} color="rgba(255,255,255,.28)" textColor="#fff" /><span style={{ fontSize: 13, fontWeight: 600 }}>Charlie</span>
              </div>
              <div className="sd-row" style={{ gap: 6, flex: 1, background: 'rgba(255,255,255,.14)', borderRadius: 10, padding: '9px 11px' }}>
                <Avatar name="Allie Ruiz" size={24} color="rgba(255,255,255,.28)" textColor="#fff" /><span style={{ fontSize: 13, fontWeight: 600 }}>Allie</span>
              </div>
            </div>
          </div>

          {/* neighbors as list */}
          <div className="sd-card sd-card-pad" style={{ paddingTop: 6, paddingBottom: 8 }}>
            <div className="sd-sectlabel" style={{ padding: '10px 0 2px' }}>
              <p className="sd-eyebrow">Neighbors</p>
              <button className="sd-btn sd-btn-ghost sd-btn-sm" style={{ height: 24, padding: '0 4px' }}>Map</button>
            </div>
            {NEIGHBORS.map((n) => <NeighborListRow key={n.name} {...n} />)}
          </div>

          {/* groups chips */}
          <div>
            <SectLabel>Your groups</SectLabel>
            <div className="sd-row" style={{ gap: 9, marginTop: 9 }}>
              <div className="sd-card" style={{ flex: 1, padding: '13px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--blue-tint)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="home" size={18} /></div>
                <div><div style={{ fontSize: 13.5, fontWeight: 700 }}>Household</div><div className="sd-meta">4 members</div></div>
              </div>
              <div className="sd-card" style={{ flex: 1, padding: '13px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--orange-tint)', color: 'var(--orange-700)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="school" size={18} /></div>
                <div><div style={{ fontSize: 13.5, fontWeight: 700 }}>Grade 4</div><div className="sd-meta">Room 12</div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <BottomNav t={HOME_EN} />
    </Phone>
  );
}

Object.assign(window, { HomeStyleWarm, HomeLayoutB, NeighborListRow });

/* Offline — global read-only state with disabled editable controls */
function OfflineState() {
  const dim = { opacity: 0.55, pointerEvents: 'none' };
  return (
    <Phone banner={<OfflineBanner />}>
      <ScreenHeader title="Edit profile" left="x" right={<button className="sd-btn sd-btn-sm" style={{ background: 'var(--bg-2)', color: 'var(--ink-3)' }}>Save</button>} />
      <div className="sd-scroll" style={{ overflow: 'hidden' }}>
        <div className="sd-body" style={{ gap: 16 }}>
          <div className="sd-row" style={{ gap: 9, padding: '11px 13px', background: '#eef1f4', borderRadius: 12, color: 'var(--ink-2)', fontSize: 12.5, lineHeight: 1.4 }}>
            <Icon name="wifioff" size={17} style={{ flex: '0 0 auto', marginTop: 1 }} />
            <span>You're offline, so the directory is read‑only. Your saved copy is shown. <strong style={{ color: 'var(--ink)' }}>Reconnect to make changes.</strong></span>
          </div>
          <div style={dim}>
            <Field label="First name" vis={<span className="sd-vis vis-members"><Icon name="members" size={12} stroke={2} />Always visible</span>}>
              <input className="sd-input" defaultValue="Dana" disabled />
            </Field>
          </div>
          <div style={dim}>
            <SectLabel>Contact</SectLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
              <ContactItemEdit icon="phone" label="Mobile" value="(415) 555‑0148" vis={<Vis state="members" t={PROFILE_EN} />} />
              <ContactItemEdit icon="mail" label="Email" value="dana.ruiz@eisenhower.edu" vis={<Vis state="members" t={PROFILE_EN} />} />
              <button className="sd-btn sd-btn-secondary block" style={{ borderStyle: 'dashed', color: 'var(--ink-3)' }}><Icon name="plus" size={17} />Add contact item</button>
            </div>
          </div>
        </div>
      </div>
    </Phone>
  );
}

/* Admin masquerade — persistent banner while viewing as another user */
function MasqState() {
  return (
    <Phone banner={<MasqBanner user="Dana Ruiz" />}>
      <AppBar person={{ name: 'Dana Ruiz', sub: 'Parent · Teacher' }} color="var(--blue)" trailing={<><IconBtn name="globe" /><IconBtn name="search" /></>} />
      <div className="sd-scroll" style={{ overflow: 'hidden' }}>
        <div className="sd-body">
          <div className="sd-row" style={{ gap: 9, padding: '11px 13px', background: 'var(--orange-tint)', borderRadius: 12, color: 'var(--orange-ink)', fontSize: 12.5, lineHeight: 1.4 }}>
            <Icon name="shield" size={17} style={{ flex: '0 0 auto', marginTop: 1 }} />
            <span>You're seeing exactly what Dana sees. Actions you take are recorded in the audit log.</span>
          </div>
          <div>
            <SectLabel>Neighbors</SectLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 9 }}>
              {NEIGHBORS.slice(0, 2).map((n) => <NeighborCard key={n.name} {...n} />)}
            </div>
          </div>
          <ProfileSnapshot t={HOME_EN} />
        </div>
      </div>
    </Phone>
  );
}

Object.assign(window, { OfflineState, MasqState });

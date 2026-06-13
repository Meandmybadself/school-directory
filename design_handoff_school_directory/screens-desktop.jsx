// screens-desktop.jsx — Desktop Home + Household (wide layout).

function DeskNav({ active }) {
  const items = [['home', 'home', 'Home'], ['search', 'dir', 'Directory'], ['users3', 'groups', 'Groups'], ['eye', 'profile', 'Your profile']];
  return (
    <aside style={{ width: 244, flex: '0 0 auto', background: 'var(--paper)', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', padding: '20px 14px' }}>
      <div style={{ padding: '0 8px 18px' }}><Brand /></div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {items.map(([icon, key, label]) => {
          const on = key === active;
          return (
            <div key={key} className="sd-row" style={{ gap: 11, padding: '10px 11px', borderRadius: 10, cursor: 'pointer', background: on ? 'var(--blue-tint)' : 'transparent', color: on ? 'var(--blue-800)' : 'var(--ink-2)', fontWeight: on ? 700 : 600, fontSize: 14.5 }}>
              <Icon name={icon} size={20} stroke={on ? 2.1 : 1.8} />{label}
            </div>
          );
        })}
      </nav>
      <div style={{ flex: 1 }} />
      <div style={{ padding: '12px', borderRadius: 12, background: 'var(--bg)', fontSize: 12.5, color: 'var(--ink-3)' }}>
        <div className="sd-row" style={{ gap: 8 }}><Icon name="school" size={16} /><span style={{ fontWeight: 700, color: 'var(--ink-2)' }}>Eisenhower School</span></div>
        <div style={{ marginTop: 4 }}>318 members · private to your school</div>
      </div>
    </aside>
  );
}

function DeskHeader({ title }) {
  return (
    <header style={{ flex: '0 0 auto', background: 'var(--paper)', borderBottom: '1px solid var(--line)', padding: '13px 26px', display: 'flex', alignItems: 'center', gap: 16 }}>
      <h1 className="sd-h2" style={{ fontSize: 20, flex: '0 0 auto' }}>{title}</h1>
      <div style={{ flex: 1, maxWidth: 360, position: 'relative' }}>
        <Icon name="search" size={17} style={{ position: 'absolute', left: 13, top: 11, color: 'var(--ink-3)' }} />
        <input className="sd-input" placeholder="Search members and groups" style={{ height: 40, paddingLeft: 38, fontSize: 14, background: 'var(--bg)', border: '1px solid var(--line)' }} />
      </div>
      <div style={{ flex: 1 }} />
      <IconBtn name="globe" />
      {/* prominent active-Person switcher, top-right */}
      <div className="sd-row" style={{ gap: 10, padding: '5px 12px 5px 6px', borderRadius: 999, border: '1px solid var(--line-2)', cursor: 'pointer' }}>
        <Avatar name="Dana Ruiz" size={32} color="var(--blue)" />
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>Dana Ruiz</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600 }}>Parent · Teacher</div>
        </div>
        <Icon name="chevdown" size={15} stroke={2.2} style={{ color: 'var(--ink-3)' }} />
      </div>
    </header>
  );
}

function DesktopHome() {
  return (
    <div className="sd" style={{ display: 'flex', height: '100%', background: 'var(--bg)' }}>
      <DeskNav active="home" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <DeskHeader title="Home" />
        <div style={{ flex: 1, overflow: 'hidden', padding: '24px 26px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div>
            <SectLabel action={<button className="sd-btn sd-btn-ghost sd-btn-sm">See all</button>}>Neighbors</SectLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginTop: 11 }}>
              {NEIGHBORS.map((n) => <NeighborCard key={n.name} {...n} />)}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 22, alignItems: 'start' }}>
            <div>
              <SectLabel>Your groups</SectLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 11 }}>
                <GroupTile icon="home" name="Ruiz–Lee household" sub="4 members" />
                <GroupTile icon="school" name="Ms. Ruiz · Grade 4" sub="23 students · Room 12" color="var(--orange-700)" tint="var(--orange-tint)" />
              </div>
            </div>
            <ProfileSnapshot t={HOME_EN} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopHousehold() {
  return (
    <div className="sd" style={{ display: 'flex', height: '100%', background: 'var(--bg)' }}>
      <DeskNav active="groups" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <DeskHeader title="Groups" />
        <div style={{ flex: 1, overflow: 'hidden', padding: '24px 26px' }}>
          <div className="sd-row" style={{ gap: 6, color: 'var(--ink-3)', fontSize: 13, fontWeight: 600, marginBottom: 16, whiteSpace: 'nowrap' }}>
            <span>Groups</span><Icon name="chevright" size={14} /><span style={{ color: 'var(--ink)' }}>Ruiz–Lee household</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 22, alignItems: 'start' }}>
            <div className="sd-card" style={{ overflow: 'hidden' }}>
              <div className="sd-row" style={{ gap: 14, padding: '20px 22px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', rowGap: 12 }}>
                <div style={{ width: 54, height: 54, borderRadius: 14, background: 'var(--blue-tint)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}><Icon name="home" size={27} stroke={1.9} /></div>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <div className="sd-h2" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Ruiz–Lee household</div>
                  <div className="sd-meta" style={{ marginTop: 2 }}>4 members</div>
                </div>
                <Tag tone="blue" icon="shield">You're an admin</Tag>
                <button className="sd-btn sd-btn-secondary sd-btn-sm"><Icon name="plus" size={15} />Add member</button>
              </div>
              <div style={{ padding: '6px 22px 14px' }}>
                <div className="sd-eyebrow" style={{ padding: '14px 0 4px' }}>Members</div>
                {HOUSEHOLD.map((m) => (
                  <MemberRow key={m.name} name={m.name} title={m.title}
                    tags={<>{m.you && <Tag tone="blue">You</Tag>}{m.admin && <Tag tone="line"><Icon name="shield" size={11} stroke={2} />Admin</Tag>}</>}
                    trailing={<div className="sd-row" style={{ gap: 8 }}><button className="sd-btn sd-btn-ghost sd-btn-sm">Set title</button><button style={{ width: 30, height: 30, borderRadius: 8, border: 0, background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer' }}><Icon name="dot3" size={18} /></button></div>} />
                ))}
              </div>
            </div>
            <div className="sd-card sd-card-pad">
              <div className="sd-eyebrow" style={{ marginBottom: 4 }}>Household contact</div>
              <p className="sd-meta" style={{ marginBottom: 12 }}>Cascades to everyone in the household.</p>
              <ContactRow icon="pin" label="Shared address" value="128 Linden Ave" vis={<Vis state="members" t={PROFILE_EN} />} />
              <ContactRow icon="phone" label="Home phone" value="(415) 555‑0148" vis={<Vis state="shared" count={1} t={PROFILE_EN} />} />
              <Btn block kind="secondary" icon="pencil" sm style={{ marginTop: 14 }}>Edit household info</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DeskNav, DeskHeader, DesktopHome, DesktopHousehold });

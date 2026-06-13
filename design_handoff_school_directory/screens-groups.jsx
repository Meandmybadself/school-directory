// screens-groups.jsx — Household + Classroom group details (admin & read-only).

function GroupHero({ icon, tint, color, name, sub, tags }) {
  return (
    <div style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)', padding: '16px 18px 18px' }}>
      <div className="sd-row" style={{ gap: 13 }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: tint, color, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
          <Icon name={icon} size={26} stroke={1.9} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sd-h2">{name}</div>
          <div className="sd-meta" style={{ marginTop: 2 }}>{sub}</div>
        </div>
      </div>
      {tags && <div className="sd-row" style={{ gap: 6, marginTop: 12 }}>{tags}</div>}
    </div>
  );
}

const HOUSEHOLD = [
  { name: 'Marcus Lee', title: 'Parent', admin: true },
  { name: 'Dana R.', title: 'Parent', you: true },
  { name: 'Charlie Lee', title: 'Student · Grade 4' },
  { name: 'Allie R.', title: 'Student · Grade 1' },
];

/* 5.6 Household — admin and read-only */
function HouseholdScreen({ admin = true }) {
  return (
    <Phone>
      <ScreenHeader title="Household" right={admin ? <button className="sd-btn sd-btn-secondary sd-btn-sm"><Icon name="gear" size={15} />Manage</button> : null} />
      <div className="sd-scroll" style={{ overflow: 'hidden' }}>
        <GroupHero icon="home" tint="var(--blue-tint)" color="var(--blue)" name="Ruiz–Lee household" sub="4 members"
          tags={admin ? <Tag tone="blue" icon="shield">You're an admin</Tag> : <Tag tone="line"><Icon name="eye" size={12} stroke={2} />Member · view only</Tag>} />
        <div className="sd-body" style={{ gap: 14 }}>
          {/* shared household contact */}
          <div>
            <SectLabel>Household contact</SectLabel>
            <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4 }}>
              <ContactRow icon="pin" label="Shared address" value="128 Linden Ave" sub="Cascades to everyone in the household"
                vis={<Vis state="members" withCaret={admin} t={PROFILE_EN} />} />
              <ContactRow icon="phone" label="Home phone" value="(415) 555‑0148"
                vis={<Vis state="shared" count={1} withCaret={admin} t={PROFILE_EN} />} />
            </div>
          </div>

          {/* members */}
          <div>
            <SectLabel action={admin ? <button className="sd-btn sd-btn-ghost sd-btn-sm" style={{ height: 24, padding: '0 4px' }}><Icon name="plus" size={15} />Add</button> : null}>Members</SectLabel>
            <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4 }}>
              {HOUSEHOLD.map((m) => (
                <MemberRow key={m.name} name={m.name} title={m.title}
                  tags={<>{m.you && <Tag tone="blue">You</Tag>}{m.admin && <Tag tone="line"><Icon name="shield" size={11} stroke={2} />Admin</Tag>}</>}
                  trailing={admin ? <button style={{ width: 30, height: 30, borderRadius: 8, border: 0, background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer' }}><Icon name="dot3" size={18} /></button> : null} />
              ))}
            </div>
          </div>

          {admin
            ? <Btn block kind="secondary" icon="pencil">Edit household info</Btn>
            : <div className="sd-row" style={{ gap: 8, padding: '11px 14px', background: 'var(--bg-2)', borderRadius: 12, color: 'var(--ink-2)', fontSize: 12.5, lineHeight: 1.4 }}>
                <Icon name="info" size={16} style={{ flex: '0 0 auto', marginTop: 1 }} />Marcus Lee manages this household. Ask an admin to make changes.
              </div>}
        </div>
      </div>
    </Phone>
  );
}

const ROSTER = [
  { name: 'Dana Ruiz', title: 'Teacher', lead: true },
  { name: 'Sam Donovan', title: 'Assistant' },
  { name: 'Charlie Lee', title: 'Student' },
  { name: 'Sara Okafor', title: 'Student' },
  { name: 'Theo Vance', title: 'Student' },
  { name: 'Priya Nadeem', title: 'Student' },
];

/* 5.7 Classroom — teacher and member */
function ClassroomScreen({ teacher = true }) {
  return (
    <Phone>
      <ScreenHeader title="Classroom" right={teacher ? <button className="sd-btn sd-btn-orange sd-btn-sm"><Icon name="plus" size={15} />Add</button> : null} />
      <div className="sd-scroll" style={{ overflow: 'hidden' }}>
        <GroupHero icon="school" tint="var(--orange-tint)" color="var(--orange-700)" name="Ms. Ruiz · Grade 4" sub="Room 12 · 23 students"
          tags={teacher ? <Tag tone="orange" icon="shield">You teach this class</Tag> : <Tag tone="line"><Icon name="eye" size={12} stroke={2} />Class member</Tag>} />
        <div className="sd-body" style={{ gap: 14 }}>
          <div>
            <SectLabel action={teacher ? <button className="sd-btn sd-btn-ghost sd-btn-sm" style={{ height: 24, padding: '0 4px', color: 'var(--orange-700)' }}>Set titles</button> : null}>Roster</SectLabel>
            <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4 }}>
              {ROSTER.map((m) => (
                <MemberRow key={m.name} name={m.name}
                  title={m.title}
                  tags={m.lead ? <Tag tone="orange">You</Tag> : null}
                  trailing={teacher
                    ? <button style={{ width: 30, height: 30, borderRadius: 8, border: 0, background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer' }}><Icon name="dot3" size={18} /></button>
                    : <Icon name="chevright" size={17} style={{ color: 'var(--ink-3)' }} />} />
              ))}
              <div className="sd-row" style={{ padding: '11px 0 4px', borderTop: '1px solid var(--line)', color: 'var(--ink-3)', fontSize: 13, fontWeight: 600, justifyContent: 'center', gap: 6 }}>
                <div style={{ display: 'flex' }}>
                  {['A', 'B', 'C'].map((x, i) => <div key={x} style={{ width: 22, height: 22, borderRadius: 999, background: avColor(x + i), border: '2px solid #fff', marginLeft: i ? -8 : 0, color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{x}</div>)}
                </div>
                +17 more students
              </div>
            </div>
          </div>

          {teacher
            ? <div className="sd-row" style={{ gap: 9 }}>
                <Btn block kind="secondary" icon="users3" style={{ flex: 1 }}>Manage members</Btn>
                <Btn block kind="secondary" icon="bolt" style={{ flex: 1 }}>Message all</Btn>
              </div>
            : <div className="sd-row" style={{ gap: 8, padding: '11px 14px', background: 'var(--bg-2)', borderRadius: 12, color: 'var(--ink-2)', fontSize: 12.5, lineHeight: 1.4 }}>
                <Icon name="info" size={16} style={{ flex: '0 0 auto', marginTop: 1 }} />Ms. Ruiz runs this classroom. You can see classmates who share with members.
              </div>}
        </div>
      </div>
    </Phone>
  );
}

Object.assign(window, { GroupHero, HouseholdScreen, ClassroomScreen, HOUSEHOLD, ROSTER });

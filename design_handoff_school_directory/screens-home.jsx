// screens-home.jsx — Home (populated + cold start), parametrized by strings (t)
// so the i18n section can reuse it for ES / ZH.

const HOME_EN = {
  switcherSub: 'Parent · Teacher',
  neighbors: 'Neighbors', seeAll: 'See all', near: 'nearby',
  groups: 'Your groups', household: 'Household', classroom: 'Classroom',
  hMembers: '4 members', cStudents: '23 students · Room 12',
  yourProfile: 'Your profile', preview: 'Preview', edit: 'Edit profile',
  connect: 'Connect', connected: 'Connected', member: 'Member',
  householdName: 'Ruiz–Lee household', className: 'Ms. Ruiz · Grade 4',
  sharing: 'What you share', sharingNote: 'across your profile',
  membersN: 'Members', privateN: 'Private', sharedN: 'Shared',
  asNeighbor: 'Shown as a neighbor', on: 'On',
  addTitle: 'Add your address to see neighbors',
  addBody: "We'll show nearby members and a rough distance — never your exact address.",
  addBtn: 'Add address',
  noGroups: "You're not in any groups yet",
  noGroupsBody: 'Your household and classrooms appear here once the office or a teacher adds you.',
  finishTitle: 'Finish your profile',
  finishBody: 'Add a phone or photo so your groups can reach you.',
  finishBtn: 'Continue setup',
  welcome: 'Welcome to Eisenhower',
  navHome: 'Home', navDir: 'Directory', navGroups: 'Groups', navMe: 'You',
};

const NEIGHBORS = [
  { name: 'Sara Okafor', dist: '~0.4 mi' },
  { name: 'James Whitfield', dist: '~0.8 mi', connected: true },
  { name: 'Lena Brandt', dist: '~1.3 mi' },
  { name: 'Tomás Rivera', dist: '~1.6 mi' },
];

function BottomNav({ t, active = 'home' }) {
  const items = [['home', 'home', t.navHome], ['search', 'dir', t.navDir], ['users3', 'groups', t.navGroups], ['eye', 'me', t.navMe]];
  return (
    <div style={{ flex: '0 0 auto', background: 'var(--paper)', borderTop: '1px solid var(--line)', display: 'flex', padding: '7px 8px 9px' }}>
      {items.map(([icon, key, label]) => {
        const on = key === active;
        return (
          <div key={key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: on ? 'var(--blue)' : 'var(--ink-3)' }}>
            <Icon name={icon} size={21} stroke={on ? 2.2 : 1.8} />
            <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 600 }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function MiniStat({ state, n, label }) {
  const cls = state === 'members' ? 'vis-members' : state === 'shared' ? 'vis-shared' : 'vis-private';
  const icon = state === 'members' ? 'members' : 'lock';
  return (
    <div className={'sd-vis ' + cls} style={{ height: 28, cursor: 'default', gap: 6 }}>
      <Icon name={icon} size={12} stroke={2} />
      <span style={{ fontWeight: 800 }}>{n}</span>
      <span style={{ fontWeight: 600, opacity: 0.8 }}>{label}</span>
    </div>
  );
}

function ProfileSnapshot({ t }) {
  return (
    <div className="sd-card sd-card-pad">
      <div className="sd-row" style={{ gap: 12 }}>
        <Avatar name="Dana Ruiz" size={46} color="var(--blue)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.2px' }}>Dana Ruiz</div>
          <div className="sd-meta">{t.switcherSub}</div>
        </div>
        <button className="sd-btn sd-btn-secondary sd-btn-sm"><Icon name="eye" size={15} />{t.preview}</button>
      </div>
      <hr className="sd-divider" style={{ margin: '13px 0 12px' }} />
      <div className="sd-eyebrow" style={{ marginBottom: 9 }}>{t.sharing}</div>
      <div className="sd-row" style={{ gap: 7, flexWrap: 'wrap' }}>
        <MiniStat state="members" n={4} label={t.membersN} />
        <MiniStat state="private" n={2} label={t.privateN} />
        <MiniStat state="shared" n={1} label={t.sharedN} />
      </div>
      <div className="sd-row" style={{ gap: 9, marginTop: 13, padding: '11px 12px', background: 'var(--orange-tint)', borderRadius: 11 }}>
        <Icon name="pin" size={17} style={{ color: 'var(--orange-ink)', flex: '0 0 auto' }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--orange-ink)', flex: 1 }}>{t.asNeighbor}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--orange-ink)' }}>{t.on}</span>
        <div className="sd-toggle on" style={{ background: 'var(--orange-700)' }} />
      </div>
    </div>
  );
}

/* Canonical Home — populated. lang controls font for CJK. */
function HomeScreen({ t = HOME_EN, theme }) {
  return (
    <Phone theme={theme}>
      <AppBar person={{ name: 'Dana Ruiz', sub: t.switcherSub }} color="var(--blue)"
        trailing={<><IconBtn name="globe" /><IconBtn name="search" badge /></>} />
      <div className="sd-scroll" style={{ overflow: 'hidden' }}>
        <div className="sd-body">
          <div>
            <SectLabel action={<button className="sd-btn sd-btn-ghost sd-btn-sm" style={{ height: 24, padding: '0 4px' }}>{t.seeAll}</button>}>{t.neighbors}</SectLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 9 }}>
              {NEIGHBORS.map((n) => <NeighborCard key={n.name} {...n} t={t} />)}
            </div>
          </div>

          <div>
            <SectLabel>{t.groups}</SectLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 9 }}>
              <GroupTile icon="home" name={t.householdName} sub={t.hMembers} />
              <GroupTile icon="school" name={t.className} sub={t.cStudents} color="var(--orange-700)" tint="var(--orange-tint)" />
            </div>
          </div>

          <ProfileSnapshot t={t} />
        </div>
      </div>
      <BottomNav t={t} />
    </Phone>
  );
}

/* Cold start — new user, no address, no groups */
function HomeColdStart({ t = HOME_EN }) {
  return (
    <Phone>
      <AppBar person={{ name: 'Dana Ruiz', sub: 'Parent' }} color="var(--blue)"
        trailing={<><IconBtn name="globe" /><IconBtn name="search" /></>} />
      <div className="sd-scroll" style={{ overflow: 'hidden' }}>
        <div className="sd-body">
          <div style={{ padding: '2px 2px 0' }}>
            <h1 className="sd-h1" style={{ fontSize: 21 }}>{t.welcome}</h1>
            <p className="sd-lead" style={{ fontSize: 13.5, marginTop: 5 }}>Two quick steps and your community fills in.</p>
          </div>

          <div>
            <SectLabel>{t.neighbors}</SectLabel>
            <div style={{ marginTop: 9 }}>
              <CTACard icon="pin" title={t.addTitle} body={t.addBody}
                action={<Btn block icon="plus">{t.addBtn}</Btn>} />
            </div>
          </div>

          <div>
            <SectLabel>{t.groups}</SectLabel>
            <div style={{ marginTop: 9 }} className="sd-card sd-card-pad">
              <div className="sd-row" style={{ gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--bg-2)', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                  <Icon name="users3" size={21} />
                </div>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>{t.noGroups}</div>
                  <div className="sd-meta" style={{ marginTop: 2, lineHeight: 1.4 }}>{t.noGroupsBody}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="sd-card sd-card-pad" style={{ background: 'var(--blue-tint)', borderColor: 'var(--blue-tint-2)' }}>
            <div className="sd-row" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{t.finishTitle}</div>
                <div style={{ fontSize: 13, color: 'var(--blue-800)', marginTop: 2, lineHeight: 1.4 }}>{t.finishBody}</div>
              </div>
            </div>
            <div className="sd-row" style={{ gap: 8, marginTop: 12 }}>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#fff', overflow: 'hidden' }}>
                <div style={{ width: '40%', height: '100%', background: 'var(--blue)' }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue-800)' }}>2 of 5</span>
            </div>
            <Btn block kind="primary" style={{ marginTop: 12 }} iconRight="chevright">{t.finishBtn}</Btn>
          </div>
        </div>
      </div>
      <BottomNav t={t} />
    </Phone>
  );
}

Object.assign(window, { HOME_EN, NEIGHBORS, BottomNav, MiniStat, ProfileSnapshot, HomeScreen, HomeColdStart });

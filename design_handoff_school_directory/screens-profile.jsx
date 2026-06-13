// screens-profile.jsx — Profile view + edit, visibility sheet. Parametrized by t.

const PROFILE_EN = {
  edit: 'Edit profile', save: 'Save', done: 'Done', cancel: 'Cancel',
  previewing: 'Previewing as a member', whatOthers: 'This is what other members see',
  exit: 'Exit preview', parent: 'Parent', teacher: 'Teacher',
  contact: 'Contact', groups: 'Groups', connectCta: 'Share your info with Dana',
  home: 'Home', mobile: 'Mobile', email: 'Email', website: 'Website',
  nearVal: 'Near Linden & 4th · ~1.1 mi', exactHidden: 'Exact address hidden',
  householdName: 'Ruiz–Lee household', className: 'Ms. Ruiz · Grade 4', teacherTitle: 'Teacher', hMembers: '4 members',
  firstName: 'First name', lastName: 'Last name',
  firstFixed: 'Always visible',
  firstFixedWhy: 'People need a name to recognize you. You choose everything else.',
  lnFull: 'Full', lnInitial: 'Initial', lnHide: 'Hide', shownAs: 'Shown as',
  photo: 'Profile photo', addPhoto: 'Add photo',
  addContact: 'Add contact item', neighbor: 'Show me as a neighbor',
  neighborWhy: 'Shows only your name and rough distance to nearby members — never your address.',
  coManagers: 'Who manages this profile', invite: 'Invite someone to help manage Dana',
  sheetTitle: 'Who can see your mobile?', sharedWith: 'Shared with', addPeople: 'Add people or groups',
  manage: 'Manage', members: 'Members', private: 'Private', shared: 'Shared',
  membersDesc: 'Anyone signed in to Eisenhower', privateDesc: 'Only you, until you share',
  sharedDesc: 'Private, plus the people and groups you pick',
};

function ScreenHeader({ title, left = 'arrowleft', right, onDark }) {
  return (
    <div className="sd-appbar" style={{ justifyContent: 'space-between', padding: '10px 12px' }}>
      <button style={{ width: 36, height: 36, borderRadius: 9, border: 0, background: 'transparent', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        <Icon name={left} size={21} />
      </button>
      <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.2px', whiteSpace: 'nowrap' }}>{title}</span>
      <div style={{ minWidth: 36, display: 'flex', justifyContent: 'flex-end' }}>{right}</div>
    </div>
  );
}

/* 5.4 Profile — view (as another member sees it) */
function ProfileView({ t = PROFILE_EN }) {
  return (
    <Phone banner={
      <div className="sd-row" style={{ background: 'var(--ink)', color: '#fff', padding: '8px 14px', gap: 9, fontSize: 12.5 }}>
        <Icon name="eye" size={16} style={{ flex: '0 0 auto' }} />
        <div style={{ flex: 1, lineHeight: 1.25 }}><strong style={{ fontWeight: 700 }}>{t.previewing}</strong><div style={{ opacity: 0.7, fontSize: 11.5 }}>{t.whatOthers}</div></div>
        <span style={{ fontWeight: 700, textDecoration: 'underline', whiteSpace: 'nowrap' }}>{t.exit}</span>
      </div>
    }>
      <div className="sd-scroll" style={{ overflow: 'hidden' }}>
        <div style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)', padding: '20px 18px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 11 }}>
          <Avatar name="Dana Ruiz" size={84} color="var(--blue)" />
          <div>
            <div className="sd-h1" style={{ fontSize: 23 }}>Dana R.</div>
            <div className="sd-row" style={{ gap: 6, marginTop: 8, justifyContent: 'center' }}>
              <Tag tone="blue" icon="users3">{t.parent}</Tag>
              <Tag tone="orange" icon="school">{t.teacher}</Tag>
            </div>
          </div>
        </div>
        <div className="sd-body" style={{ gap: 12 }}>
          <div>
            <SectLabel>{t.contact}</SectLabel>
            <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4 }}>
              <ContactRow icon="mail" label={t.email} value="dana.ruiz@eisenhower.edu" vis={<Vis state="members" withCaret={false} t={t} />} />
              <ContactRow icon="phone" label={t.mobile} value="(415) 555‑0148" vis={<Vis state="members" withCaret={false} t={t} />} />
              <ContactRow icon="pin" label={t.home} value={t.nearVal} sub={t.exactHidden} vis={<Vis state="shared" count={2} withCaret={false} t={t} />} />
            </div>
          </div>
          <div>
            <SectLabel>{t.groups}</SectLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 9 }}>
              <GroupTile icon="home" name={t.householdName} sub={t.hMembers} />
              <GroupTile icon="school" name={t.className} sub={t.teacherTitle} color="var(--orange-700)" tint="var(--orange-tint)" />
            </div>
          </div>
          <Btn block icon="plus" style={{ marginTop: 4 }}>{t.connectCta}</Btn>
        </div>
      </div>
    </Phone>
  );
}

/* Last-name sub control */
function LastNameControl({ t }) {
  const opts = [['lnFull', 'Ruiz'], ['lnInitial', 'R.'], ['lnHide', '—']];
  const active = 'lnInitial';
  return (
    <div className="sd-fieldcard">
      <div className="fr" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span className="sd-label">{t.lastName}</span>
        <input className="sd-input" defaultValue="Ruiz" style={{ height: 44 }} />
      </div>
      <div className="fr" style={{ background: 'var(--bg)' }}>
        <div className="sd-seg">
          {opts.map(([k]) => <button key={k} className={k === active ? 'on' : ''}>{t[k]}</button>)}
        </div>
        <div className="sd-row" style={{ gap: 7, marginTop: 9, justifyContent: 'center', fontSize: 12.5, color: 'var(--ink-2)' }}>
          <span style={{ fontWeight: 600 }}>{t.shownAs}</span>
          <span style={{ fontWeight: 800, color: 'var(--ink)' }}>Dana R.</span>
        </div>
      </div>
    </div>
  );
}

/* 5.4 Profile — edit */
function ProfileEdit({ t = PROFILE_EN }) {
  return (
    <Phone>
      <ScreenHeader title={t.edit} left="x" right={<button className="sd-btn sd-btn-primary sd-btn-sm">{t.save}</button>} />
      <div className="sd-scroll" style={{ overflow: 'hidden' }}>
        <div className="sd-body" style={{ gap: 18 }}>
          {/* photo */}
          <div className="sd-row" style={{ gap: 14 }}>
            <div style={{ position: 'relative' }}>
              <Avatar name="Dana Ruiz" size={66} color="var(--blue)" />
              <div style={{ position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 999, background: 'var(--paper)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-2)' }}><Icon name="upload" size={14} /></div>
            </div>
            <div>
              <div className="sd-label" style={{ fontSize: 13 }}>{t.photo}</div>
              <button className="sd-btn sd-btn-secondary sd-btn-sm" style={{ marginTop: 7 }}><Icon name="upload" size={15} />{t.addPhoto}</button>
            </div>
          </div>

          {/* first name — fixed, explained */}
          <Field label={t.firstName}
            vis={<span className="sd-vis vis-members" style={{ cursor: 'default' }}><Icon name="members" size={12} stroke={2} />{t.firstFixed}</span>}>
            <input className="sd-input" defaultValue="Dana" />
            <div className="sd-row" style={{ gap: 7, color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.4, marginTop: 2 }}>
              <Icon name="info" size={14} style={{ flex: '0 0 auto', marginTop: 1 }} />{t.firstFixedWhy}
            </div>
          </Field>

          {/* last name with sub-control */}
          <LastNameControl t={t} />

          {/* contact items */}
          <div>
            <SectLabel>{t.contact}</SectLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
              {/* address + neighbor opt-in */}
              <div className="sd-fieldcard">
                <div className="fr" style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div className="sd-cicon" style={{ marginTop: 0 }}><Icon name="pin" size={17} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="sd-clabel">{t.home} · {t.address || 'Address'}</div>
                    <div className="sd-cval">128 Linden Ave</div>
                  </div>
                  <Vis state="shared" count={2} t={t} />
                </div>
                <div className="fr" style={{ background: 'var(--orange-tint)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <Icon name="pin" size={18} style={{ color: 'var(--orange-ink)', flex: '0 0 auto', marginTop: 1 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--orange-ink)' }}>{t.neighbor}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--orange-ink)', opacity: 0.85, lineHeight: 1.4, marginTop: 2 }}>{t.neighborWhy}</div>
                  </div>
                  <div className="sd-toggle on" style={{ background: 'var(--orange-700)', marginTop: 1 }} />
                </div>
              </div>

              <ContactItemEdit icon="phone" label={t.mobile} value="(415) 555‑0148" vis={<Vis state="members" t={t} />} />
              <ContactItemEdit icon="mail" label={t.email} value="dana.ruiz@eisenhower.edu" vis={<Vis state="members" t={t} />} />
              <ContactItemEdit icon="link" label={t.website} value="danaruiz.studio" vis={<Vis state="private" t={t} />} />

              <button className="sd-btn sd-btn-secondary block" style={{ borderStyle: 'dashed' }}><Icon name="plus" size={17} />{t.addContact}</button>
            </div>
          </div>

          {/* co-managers */}
          <div>
            <SectLabel>{t.coManagers}</SectLabel>
            <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
              <div className="sd-row" style={{ gap: 10 }}>
                <Avatar name="Dana Ruiz" size={36} color="var(--blue)" />
                <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700 }}>You</div></div>
                <Tag tone="line">Owner</Tag>
              </div>
              <button className="sd-btn sd-btn-ghost block" style={{ justifyContent: 'flex-start', padding: 0, height: 38, marginTop: 6 }}><Icon name="plus" size={17} />{t.invite}</button>
            </div>
          </div>
        </div>
      </div>
    </Phone>
  );
}

function ContactItemEdit({ icon, label, value, vis }) {
  return (
    <div className="sd-fieldcard">
      <div className="fr" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="sd-cicon"><Icon name={icon} size={17} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sd-clabel">{label}</div>
          <div className="sd-cval">{value}</div>
        </div>
        {vis}
      </div>
    </div>
  );
}

/* 5.4 / 4 — visibility sheet (the chip expanded) */
function VisibilitySheet({ t = PROFILE_EN }) {
  return (
    <Phone>
      <div style={{ filter: 'none', opacity: 0.5, pointerEvents: 'none' }}>
        <AppBar person={{ name: 'Dana Ruiz', sub: 'Parent · Teacher' }} color="var(--blue)" trailing={<IconBtn name="search" />} />
        <div className="sd-body"><div className="sd-card" style={{ height: 130 }} /><div className="sd-card" style={{ height: 180 }} /></div>
      </div>
      <SheetOver>
        <div className="sd-row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 className="sd-h2">{t.sheetTitle}</h2>
        </div>
        <p className="sd-meta" style={{ marginBottom: 14 }}>Pick who can see this. You can change it anytime.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <OptionRow icon="members" tone="members" title={t.members} sub={t.membersDesc} />
          <OptionRow icon="lock" tone="private" title={t.private} sub={t.privateDesc} />
          <OptionRow icon="lock" tone="shared" title={t.shared} sub={t.sharedDesc} selected />
        </div>

        {/* shared-with manager (shown because Shared is selected) */}
        <div style={{ marginTop: 14, border: '1px solid var(--orange-tint-2)', background: 'var(--orange-tint)', borderRadius: 14, padding: 14 }}>
          <div className="sd-row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="sd-eyebrow" style={{ color: 'var(--orange-ink)' }}>{t.sharedWith} · 2</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--orange-ink)' }}>{t.manage}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="sd-row" style={{ gap: 10 }}><Avatar name="Marcus Lee" size={32} /><span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Marcus Lee</span><Icon name="x" size={16} style={{ color: 'var(--orange-ink)' }} /></div>
            <div className="sd-row" style={{ gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--blue-tint)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="home" size={17} /></div>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Ruiz–Lee household</span><Icon name="x" size={16} style={{ color: 'var(--orange-ink)' }} />
            </div>
          </div>
          <button className="sd-btn sd-btn-sm block" style={{ marginTop: 11, background: '#fff', color: 'var(--orange-ink)', border: '1px solid var(--orange-tint-2)' }}><Icon name="plus" size={16} />{t.addPeople}</button>
        </div>

        <Btn block style={{ marginTop: 16 }}>{t.done}</Btn>
      </SheetOver>
    </Phone>
  );
}

Object.assign(window, { PROFILE_EN, ScreenHeader, ProfileView, LastNameControl, ProfileEdit, ContactItemEdit, VisibilitySheet });

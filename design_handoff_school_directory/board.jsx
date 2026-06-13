// board.jsx — assembles the design canvas. (Temporary: onboarding + home only,
// for an early visual checkpoint. Remaining sections added next.)

function Swatch({ c, name, hex, dark }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ height: 52, borderRadius: 10, background: c, border: '1px solid rgba(0,0,0,.06)' }} />
      <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.2 }}>{name}</div>
      <div className="sd-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{hex}</div>
    </div>
  );
}

function FoundationCard() {
  return (
    <div className="sd" style={{ padding: 26, width: '100%', background: '#fff' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div>
          <p className="sd-eyebrow">Color</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 14, marginTop: 12 }}>
            <Swatch c="var(--blue)" name="Blue / Trust" hex="#0068A8" />
            <Swatch c="var(--orange)" name="Orange / Active" hex="#FAAB1C" />
            <Swatch c="var(--ink)" name="Ink" hex="#19232E" />
            <Swatch c="var(--bg)" name="Canvas" hex="#F3F5F7" />
            <Swatch c="#ffffff" name="Paper" hex="#FFFFFF" />
          </div>
        </div>
        <div>
          <p className="sd-eyebrow">Type — Hanken Grotesk</p>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.5px' }}>See who's around you</div>
            <div style={{ fontSize: 15, color: 'var(--ink-2)', marginTop: 4 }}>Calm, legible, and built to stretch across English, Spanish, and Chinese.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VisibilityCard() {
  return (
    <div className="sd" style={{ padding: 26, width: '100%', background: '#fff' }}>
      <p className="sd-eyebrow">The visibility chip — one control, used everywhere</p>
      <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
        <Vis state="members" />
        <Vis state="private" />
        <Vis state="shared" count={3} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 16 }}>
        {[['members', 'Members', 'Anyone signed in to Eisenhower'], ['private', 'Private', 'Only you, until you share'], ['shared', 'Shared', 'Private + chosen people or groups']].map(([s, t, d]) => (
          <div key={s} style={{ padding: 14, borderRadius: 12, border: '1px solid var(--line)' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{t}</div>
            <div className="sd-meta" style={{ marginTop: 3, lineHeight: 1.4 }}>{d}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 18, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <Avatar name="Dana Ruiz" size={40} /><Avatar name="Marcus Lee" size={40} /><Avatar name="Sara Okafor" size={40} /><Avatar name="Priya N" size={40} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn sm>Primary</Btn><Btn sm kind="secondary">Secondary</Btn><Btn sm kind="orange" icon="plus">Action</Btn>
        </div>
      </div>
    </div>
  );
}

/* ── Static board layout (no infinite canvas — reliable in any viewport) ── */
function Frame({ label, w, h, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: '0 0 auto' }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#475059', letterSpacing: '.1px', paddingLeft: 2, maxWidth: w }}>{label}</div>
      <div style={{ width: w, height: h, background: '#fff', borderRadius: 6, overflow: 'hidden', boxShadow: '0 1px 2px rgba(20,30,40,.06), 0 10px 28px rgba(20,30,40,.10)', border: '1px solid rgba(20,30,40,.06)' }}>
        {children}
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ borderLeft: '3px solid #0068A8', paddingLeft: 13 }}>
        <h2 style={{ margin: 0, fontSize: 21, fontWeight: 800, letterSpacing: '-.4px', color: '#19232e' }}>{title}</h2>
        <p style={{ margin: '3px 0 0', fontSize: 14, color: '#6a7682', maxWidth: 620, lineHeight: 1.4 }}>{subtitle}</p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 30, alignItems: 'flex-start' }}>
        {children}
      </div>
    </section>
  );
}

function Board() {
  return (
    <div className="sd" style={{ minHeight: '100vh', background: '#e9ecee', padding: '0 0 80px' }}>
      {/* header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #dfe3e6', padding: '22px 40px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: '#0068A8', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
          <Icon name="school" size={24} stroke={1.9} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-.4px', color: '#19232e' }}>Eisenhower School Directory</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13.5, color: '#6a7682' }}>Hi-fi design board · privacy-first · mobile-first · EN / ES / 中文</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="sd-vis vis-members" style={{ cursor: 'default', height: 27 }}><Icon name="members" size={12} stroke={2} />Members</span>
          <span className="sd-vis vis-private" style={{ cursor: 'default', height: 27 }}><Icon name="lock" size={12} stroke={2} />Private</span>
          <span className="sd-vis vis-shared" style={{ cursor: 'default', height: 27 }}><Icon name="lock" size={12} stroke={2} />Shared</span>
        </div>
      </header>

      <div style={{ padding: '34px 40px', display: 'flex', flexDirection: 'column', gap: 48, maxWidth: 1320, margin: '0 auto' }}>
        <Section title="Foundations" subtitle="The small system every screen is built from.">
          <Frame label="Color & type" w={460} h={336}><FoundationCard /></Frame>
          <Frame label="Visibility affordance" w={460} h={336}><VisibilityCard /></Frame>
        </Section>

        <Section title="Sign in & onboarding" subtitle="The front door — spare and reassuring.">
          <Frame label="Sign in" w={360} h={712}><SignIn /></Frame>
          <Frame label="Check your email" w={360} h={712}><CheckEmail /></Frame>
          <Frame label="Signing you in" w={360} h={712}><SigningIn /></Frame>
          <Frame label="Registration closed" w={360} h={712}><RegClosed /></Frame>
          <Frame label="Invitation" w={360} h={712}><Invitation /></Frame>
        </Section>

        <Section title="Home" subtitle="The most important screen — who's around me, what I share.">
          <Frame label="Populated" w={360} h={992}><HomeScreen /></Frame>
          <Frame label="Cold start — no address, no groups" w={360} h={900}><HomeColdStart /></Frame>
        </Section>

        <Section title="Home — directions" subtitle="Variations to mix & match: layout and overall visual style.">
          <Frame label="A · Neighbors grid (default)" w={360} h={992}><HomeScreen /></Frame>
          <Frame label="B · List-first + switcher hero" w={360} h={840}><HomeLayoutB /></Frame>
          <Frame label="Style · Warm / serif" w={360} h={1000}><HomeStyleWarm /></Frame>
        </Section>

        <Section title="Profile" subtitle="View, edit, and the visibility sheet — with last-name & address rules.">
          <Frame label="View — as a member sees you" w={360} h={850}><ProfileView /></Frame>
          <Frame label="Edit — names, contacts, neighbor opt-in" w={360} h={1212}><ProfileEdit /></Frame>
          <Frame label="Visibility sheet (the chip, expanded)" w={360} h={812}><VisibilitySheet /></Frame>
        </Section>

        <Section title="Groups" subtitle="Households cascade contact info; classrooms are run by teachers.">
          <Frame label="Household — admin" w={360} h={838}><HouseholdScreen admin /></Frame>
          <Frame label="Household — member (read-only)" w={360} h={842}><HouseholdScreen admin={false} /></Frame>
          <Frame label="Classroom — teacher" w={360} h={812}><ClassroomScreen teacher /></Frame>
          <Frame label="Classroom — member" w={360} h={812}><ClassroomScreen teacher={false} /></Frame>
        </Section>

        <Section title="Internationalization" subtitle="Home & Profile proven in English, Spanish, and Chinese — the layout stretches.">
          <Frame label="Home · English" w={360} h={1028}><HomeScreen t={HOME_EN} /></Frame>
          <Frame label="Home · Español" w={360} h={1028}><HomeScreen t={HOME_ES} /></Frame>
          <Frame label="Home · 中文" w={360} h={1028}><LangWrap lang="zh"><HomeScreen t={HOME_ZH} /></LangWrap></Frame>
          <Frame label="Language control" w={360} h={812}><LanguageSheet /></Frame>
          <Frame label="Profile · English" w={360} h={870}><ProfileView t={PROFILE_EN} /></Frame>
          <Frame label="Profile · Español" w={360} h={870}><ProfileView t={PROFILE_ES} /></Frame>
          <Frame label="Profile · 中文" w={360} h={870}><LangWrap lang="zh"><ProfileView t={PROFILE_ZH} /></LangWrap></Frame>
        </Section>

        <Section title="Desktop" subtitle="Home & Household at desk width — same system, more room.">
          <Frame label="Home — desktop" w={1180} h={760}><DesktopHome /></Frame>
          <Frame label="Household — desktop" w={1180} h={760}><DesktopHousehold /></Frame>
        </Section>

        <Section title="Cross-cutting states" subtitle="Offline read-only and admin masquerade — global banners.">
          <Frame label="Offline — read-only" w={360} h={812}><OfflineState /></Frame>
          <Frame label="Admin — viewing as a member" w={360} h={812}><MasqState /></Frame>
        </Section>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Board />);

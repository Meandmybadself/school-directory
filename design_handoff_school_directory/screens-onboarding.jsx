// screens-onboarding.jsx — Sign in, magic-link states, invitation.

function Brand({ size = 'md', center }) {
  const s = size === 'lg' ? { box: 46, r: 13, icon: 26, name: 19 } : { box: 34, r: 10, icon: 19, name: 15.5 };
  return (
    <div className="sd-row" style={{ gap: 10, justifyContent: center ? 'center' : 'flex-start' }}>
      <div style={{ width: s.box, height: s.box, borderRadius: s.r, background: 'var(--blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
        <Icon name="school" size={s.icon} stroke={1.9} />
      </div>
      <div style={{ lineHeight: 1.05 }}>
        <div style={{ fontSize: s.name, fontWeight: 800, letterSpacing: '-.4px' }}>Eisenhower</div>
        <div style={{ fontSize: s.name * 0.52, fontWeight: 700, letterSpacing: '.8px', textTransform: 'uppercase', color: 'var(--ink-3)' }}>School Directory</div>
      </div>
    </div>
  );
}

function Reassure({ children }) {
  return (
    <div className="sd-row" style={{ gap: 7, color: 'var(--ink-3)', fontSize: 12.5, fontWeight: 600, justifyContent: 'center', textAlign: 'center', lineHeight: 1.4 }}>
      <Icon name="lock" size={14} stroke={2} style={{ flex: '0 0 auto' }} />
      <span>{children}</span>
    </div>
  );
}

/* 5.1 Sign in */
function SignIn() {
  return (
    <Phone>
      <div className="sd-scroll" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px 0' }}><Brand /></div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 24px', gap: 18, marginTop: -20 }}>
          <div>
            <h1 className="sd-h1">Sign in to the<br />directory</h1>
            <p className="sd-lead" style={{ marginTop: 10 }}>Enter your email and we'll send you a link to sign in. No password to remember.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="sd-label">Email</span>
              <input className="sd-input focus" defaultValue="dana@eisenhower.edu" />
            </div>
            <Btn block icon="mail">Email me a link</Btn>
          </div>
        </div>
        <div style={{ padding: '0 24px 26px' }}>
          <Reassure>Private to the Eisenhower community. Nothing here is public.</Reassure>
        </div>
      </div>
    </Phone>
  );
}

/* 5.2 Check email */
function CheckEmail() {
  return (
    <Phone>
      <div className="sd-scroll" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px 0' }}><Brand /></div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 28px', gap: 16, textAlign: 'center', alignItems: 'center', marginTop: -16 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--blue-tint)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="mail" size={30} stroke={1.8} />
          </div>
          <div>
            <h1 className="sd-h1">Check your email</h1>
            <p className="sd-lead" style={{ marginTop: 9 }}>We sent a sign-in link to <strong style={{ color: 'var(--ink)' }}>dana@eisenhower.edu</strong>. It expires in 15 minutes.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginTop: 2 }}>
            <Btn block kind="secondary" icon="mail">Open email app</Btn>
            <button className="sd-btn sd-btn-ghost">Resend link</button>
          </div>
        </div>
        <div style={{ padding: '0 24px 26px' }}>
          <Reassure>Didn't get it? Check spam, or use a different email.</Reassure>
        </div>
      </div>
    </Phone>
  );
}

/* 5.2 Signing you in (post-click) */
function SigningIn() {
  return (
    <Phone>
      <div className="sd-scroll" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
        <div style={{ position: 'relative', width: 54, height: 54 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '4px solid var(--blue-tint)' }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '4px solid transparent', borderTopColor: 'var(--blue)', transform: 'rotate(60deg)' }} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div className="sd-h2">Signing you in…</div>
          <div className="sd-lead" style={{ fontSize: 13.5, marginTop: 4 }}>One moment while we open the directory.</div>
        </div>
        <div style={{ position: 'absolute', bottom: 30 }}><Brand /></div>
      </div>
    </Phone>
  );
}

/* 5.1 Registration closed / privacy-preserving confirmation */
function RegClosed() {
  return (
    <Phone>
      <div className="sd-scroll" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px 0' }}><Brand /></div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 28px', gap: 16, textAlign: 'center', alignItems: 'center', marginTop: -16 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--slate-tint)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={30} stroke={2} />
          </div>
          <div>
            <h1 className="sd-h1">Thanks — check<br />your email</h1>
            <p className="sd-lead" style={{ marginTop: 9 }}>If this email belongs to a Eisenhower member, a sign-in link is on its way.</p>
          </div>
          <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 9, textAlign: 'left' }}>
            <Icon name="info" size={17} style={{ color: 'var(--ink-3)', flex: '0 0 auto', marginTop: 1 }} />
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>For everyone's privacy, we don't confirm whether an account exists. New sign-ups are managed by the school office.</span>
          </div>
        </div>
        <div style={{ padding: '0 24px 26px' }}>
          <button className="sd-btn sd-btn-ghost block">Back to sign in</button>
        </div>
      </div>
    </Phone>
  );
}

/* 5.2 Invitation */
function Invitation() {
  return (
    <Phone>
      <div className="sd-scroll" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px 0' }}><Brand /></div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 22px', gap: 16, marginTop: -10 }}>
          <div className="sd-row" style={{ gap: 10 }}>
            <Avatar name="Marcus Lee" size={34} />
            <span style={{ fontSize: 13.5, color: 'var(--ink-2)', fontWeight: 600 }}><strong style={{ color: 'var(--ink)' }}>Marcus Lee</strong> invited you</span>
          </div>
          <h1 className="sd-h1">You've been invited to Eisenhower School Directory</h1>
          <div className="sd-card" style={{ padding: 15 }}>
            <div className="sd-eyebrow" style={{ marginBottom: 11 }}>You'll help manage</div>
            <div className="sd-row" style={{ gap: 12 }}>
              <Avatar name="Charlie Lee" size={46} />
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.2px' }}>Charlie Lee</div>
                <div className="sd-row" style={{ gap: 6, marginTop: 4 }}>
                  <Tag tone="blue" icon="users3">Student</Tag>
                  <Tag tone="line">Grade 4</Tag>
                </div>
              </div>
            </div>
            <hr className="sd-divider" style={{ margin: '13px 0' }} />
            <div className="sd-row" style={{ gap: 8, color: 'var(--ink-2)', fontSize: 12.5, lineHeight: 1.45 }}>
              <Icon name="users3" size={16} style={{ flex: '0 0 auto', marginTop: 1 }} />
              <span>As a co-manager you can edit Charlie's profile and what they share. Marcus keeps access too.</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Btn block icon="check">Accept invitation</Btn>
            <button className="sd-btn sd-btn-ghost">Not now</button>
          </div>
        </div>
        <div style={{ padding: '0 24px 22px' }}>
          <Reassure>Accepting connects your email to Charlie. You can leave anytime.</Reassure>
        </div>
      </div>
    </Phone>
  );
}

Object.assign(window, { Brand, Reassure, SignIn, CheckEmail, SigningIn, RegClosed, Invitation });

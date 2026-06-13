// screens-i18n.jsx — Home + Profile in English, Spanish, Chinese, plus the
// language control. Reuses HomeScreen / ProfileView with translated strings.

const HOME_ES = {
  ...HOME_EN,
  switcherSub: 'Madre · Profesora',
  neighbors: 'Vecinos', seeAll: 'Ver todos',
  groups: 'Tus grupos',
  householdName: 'Familia Ruiz–Lee', className: 'Sra. Ruiz · 4.º grado',
  hMembers: '4 miembros', cStudents: '23 estudiantes · Aula 12',
  connect: 'Conectar', connected: 'Conectado', member: 'Miembro',
  sharing: 'Lo que compartes',
  membersN: 'Miembros', privateN: 'Privado', sharedN: 'Compartido',
  asNeighbor: 'Visible como vecina', on: 'Activo', preview: 'Vista previa',
  members: 'Miembros', private: 'Privado', shared: 'Compartido',
  navHome: 'Inicio', navDir: 'Directorio', navGroups: 'Grupos', navMe: 'Tú',
};

const HOME_ZH = {
  ...HOME_EN,
  switcherSub: '家长 · 老师',
  neighbors: '邻居', seeAll: '查看全部',
  groups: '你的群组',
  householdName: 'Ruiz–Lee 家庭', className: 'Ruiz 老师 · 四年级',
  hMembers: '4 名成员', cStudents: '23 名学生 · 12 教室',
  connect: '连接', connected: '已连接', member: '成员',
  sharing: '你分享的内容',
  membersN: '成员', privateN: '私密', sharedN: '已分享',
  asNeighbor: '显示为邻居', on: '开', preview: '预览',
  members: '成员', private: '私密', shared: '已分享',
  navHome: '主页', navDir: '目录', navGroups: '群组', navMe: '我',
};

const PROFILE_ES = {
  ...PROFILE_EN,
  previewing: 'Vista de un miembro', whatOthers: 'Esto es lo que ven otros miembros', exit: 'Salir',
  parent: 'Madre', teacher: 'Profesora',
  contact: 'Contacto', groups: 'Grupos', connectCta: 'Comparte tu información con Dana',
  home: 'Casa', mobile: 'Móvil', email: 'Correo', website: 'Sitio web',
  nearVal: 'Cerca de Linden y 4.ª · ~1,1 mi', exactHidden: 'Dirección exacta oculta',
  householdName: 'Familia Ruiz–Lee', className: 'Sra. Ruiz · 4.º grado', teacherTitle: 'Profesora', hMembers: '4 miembros',
  members: 'Miembros', private: 'Privado', shared: 'Compartido',
};

const PROFILE_ZH = {
  ...PROFILE_EN,
  previewing: '以成员身份预览', whatOthers: '这是其他成员看到的内容', exit: '退出',
  parent: '家长', teacher: '老师',
  contact: '联系方式', groups: '群组', connectCta: '与 Dana 分享你的信息',
  home: '住址', mobile: '手机', email: '邮箱', website: '网站',
  nearVal: '邻近 Linden 与 4th · 约 1.1 英里', exactHidden: '已隐藏具体地址',
  householdName: 'Ruiz–Lee 家庭', className: 'Ruiz 老师 · 四年级', teacherTitle: '老师', hMembers: '4 名成员',
  members: '成员', private: '私密', shared: '已分享',
};

// CJK comfort: looser line-height for Chinese frames.
(function injectZH() {
  if (document.getElementById('sd-zh-styles')) return;
  const s = document.createElement('style');
  s.id = 'sd-zh-styles';
  s.textContent = '.sd-zh{line-height:1.65;letter-spacing:.01em;}.sd-zh .sd-meta,.sd-zh .sd-clabel{line-height:1.5;}';
  document.head.appendChild(s);
})();

function LangWrap({ lang, children }) {
  return <div lang={lang} className={lang === 'zh' ? 'sd-zh' : ''} style={{ height: '100%' }}>{children}</div>;
}

/* The language control — where it lives (a sheet from the globe button) */
function LanguageSheet() {
  const langs = [['English', 'English', true], ['Español', 'Spanish', false], ['中文', 'Chinese (Simplified)', false]];
  return (
    <Phone>
      <div style={{ opacity: 0.5, pointerEvents: 'none' }}>
        <AppBar person={{ name: 'Dana Ruiz', sub: 'Parent · Teacher' }} color="var(--blue)" trailing={<><IconBtn name="globe" tone="blue" /><IconBtn name="search" /></>} />
        <div className="sd-body"><div className="sd-card" style={{ height: 120 }} /><div className="sd-card" style={{ height: 150 }} /></div>
      </div>
      <SheetOver>
        <h2 className="sd-h2" style={{ marginBottom: 3 }}>Language</h2>
        <p className="sd-meta" style={{ marginBottom: 14 }}>Changes the directory for you only.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {langs.map(([native, en, sel]) => (
            <div key={en} className="sd-row" style={{ gap: 12, padding: '13px 14px', borderRadius: 12, border: '1px solid ' + (sel ? 'var(--blue)' : 'var(--line)'), background: sel ? 'var(--blue-tint)' : 'var(--paper)' }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: sel ? 'var(--blue)' : 'var(--bg-2)', color: sel ? '#fff' : 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}><Icon name="globe" size={18} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{native}</div>
                <div className="sd-meta">{en}</div>
              </div>
              {sel && <Icon name="check" size={20} style={{ color: 'var(--blue)' }} />}
            </div>
          ))}
        </div>
        <Btn block style={{ marginTop: 16 }}>Done</Btn>
      </SheetOver>
    </Phone>
  );
}

Object.assign(window, { HOME_ES, HOME_ZH, PROFILE_ES, PROFILE_ZH, LangWrap, LanguageSheet });

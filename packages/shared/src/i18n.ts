// UI string dictionaries (chrome only — member-entered content is never translated).
// Keys mirror the strings objects in the design handoff (HOME_*, PROFILE_*).
// Use `{name}` placeholders; interpolate with `t(key, { name })` in the client.

import type { Locale } from "./types.js";

export interface Strings {
  // brand / generic
  brand: string;
  brandSub: string;
  done: string;
  save: string;
  cancel: string;
  back: string;

  // onboarding
  signInTitle: string;
  signInLead: string;
  emailLabel: string;
  emailLink: string;
  privateNote: string;
  checkEmailTitle: string;
  checkEmailLead: string; // uses {email}
  openEmailApp: string;
  resendLink: string;
  signingIn: string;
  signingInSub: string;
  regClosedTitle: string;
  regClosedLead: string;
  regClosedNote: string;

  // nav
  navHome: string;
  navDir: string;
  navGroups: string;
  navMe: string;
  searchMembers: string;
  searchGroups: string;
  myGroups: string;
  allGroups: string;
  aboutGroupsTitle: string;
  aboutGroupsBody: string;
  colName: string;
  colType: string;
  groupsResults: string;
  groupsEmpty: string;
  directoryEmpty: string;
  loadMore: string;
  showingOf: string; // uses {shown} {total}

  // home
  neighbors: string;
  seeAll: string;
  groups: string;
  member: string;
  connect: string;
  connected: string;
  yourProfile: string;
  preview: string;
  whatYouShare: string;
  membersN: string;
  privateN: string;
  sharedN: string;
  shownAsNeighbor: string;
  on: string;
  off: string;
  welcome: string; // uses {school}
  addAddressTitle: string;
  addAddressBody: string;
  addAddressBtn: string;
  osmAttribution: string;
  noGroups: string;
  noGroupsBody: string;
  finishTitle: string;
  finishBody: string;
  finishBtn: string;

  // profile
  editProfile: string;
  previewingAsMember: string;
  whatOthersSee: string;
  exitPreview: string;
  contact: string;
  shareCta: string; // uses {name}
  homeLabel: string;
  mobile: string;
  email: string;
  website: string;
  exactHidden: string;
  firstName: string;
  lastName: string;
  setupTitle: string;
  setupLead: string;
  createProfileBtn: string;
  skipToAdmin: string;
  alwaysVisible: string;
  firstFixedWhy: string;
  lnFull: string;
  lnInitial: string;
  shownAs: string;
  photo: string;
  addPhoto: string;
  addContact: string;
  showAsNeighbor: string;
  neighborWhy: string;
  whoManages: string;
  inviteCoManager: string; // uses {name}
  owner: string;
  inviteTitle: string; // uses {name}
  inviteWhy: string; // uses {name}
  inviteSend: string;
  inviteSent: string; // uses {email}

  // visibility
  visMembers: string;
  visPrivate: string;
  visShared: string;
  visMembersDesc: string;
  visPrivateDesc: string;
  visSharedDesc: string;
  whoCanSee: string; // uses {field}
  sharedWith: string;
  addPeople: string;

  // groups
  household: string;
  classroom: string;
  roster: string;
  members: string;
  manage: string;
  youreAdmin: string;
  viewOnly: string;
  classMember: string;
  teachThisClass: string;
  addMember: string;
  setTitle: string;
  setTitles: string;
  editGroupInfo: string;
  householdContact: string;
  cascadeNote: string;
  manageMembers: string;
  messageAll: string;
  adminManages: string; // uses {name}
  teacherRuns: string; // uses {name}
  newGroup: string;
  newHousehold: string;
  newClassroom: string;
  groupName: string;
  create: string;
  createGroupChoose: string;

  // language
  language: string;
  languageNote: string;

  // cross-cutting states
  offlineBanner: string;
  offlineReadOnly: string;
  offlineNote: string;
  masqViewingAs: string; // uses {name}
  masqReturn: string;
  signOut: string;
}

const en: Strings = {
  brand: "Eisenhower",
  brandSub: "School Directory",
  done: "Done",
  save: "Save",
  cancel: "Cancel",
  back: "Back to sign in",

  signInTitle: "Sign in to the directory",
  signInLead:
    "Enter your email and we'll send you a link to sign in. No password to remember.",
  emailLabel: "Email",
  emailLink: "Email me a link",
  privateNote: "Private to the {school} community. Nothing here is public.",
  checkEmailTitle: "Check your email",
  checkEmailLead:
    "We sent a sign-in link to {email}. It expires in 15 minutes.",
  openEmailApp: "Open email app",
  resendLink: "Resend link",
  signingIn: "Signing you in…",
  signingInSub: "One moment while we open the directory.",
  regClosedTitle: "Thanks — check your email",
  regClosedLead:
    "If this email belongs to a {school} member, a sign-in link is on its way.",
  regClosedNote:
    "For everyone's privacy, we don't confirm whether an account exists. New sign-ups are managed by the school office.",

  navHome: "Home",
  navDir: "Directory",
  navGroups: "Groups",
  navMe: "You",
  searchMembers: "Search members",
  searchGroups: "Search groups",
  myGroups: "Your groups",
  allGroups: "All groups",
  aboutGroupsTitle: "What's a group?",
  aboutGroupsBody:
    "Groups organize the community. A Household is your family; a Classroom is a teacher's class. Schools can also use groups for a Grade, the whole School, or clubs and committees. A person can belong to several groups at once.",
  colName: "Name",
  colType: "Type",
  groupsResults: "Results",
  groupsEmpty: "No groups match your search.",
  directoryEmpty: "No members match your search.",
  loadMore: "Load more",
  showingOf: "Showing {shown} of {total}",

  neighbors: "Neighbors",
  seeAll: "See all",
  groups: "Your groups",
  member: "Member",
  connect: "Connect",
  connected: "Connected",
  yourProfile: "Your profile",
  preview: "Preview",
  whatYouShare: "What you share",
  membersN: "Members",
  privateN: "Private",
  sharedN: "Shared",
  shownAsNeighbor: "Shown as a neighbor",
  on: "On",
  off: "Off",
  welcome: "Welcome to {school}",
  addAddressTitle: "Add your address to see neighbors",
  addAddressBody:
    "We'll show nearby members and a rough distance — never your exact address.",
  addAddressBtn: "Add address",
  osmAttribution: "Distances © OpenStreetMap contributors",
  noGroups: "You're not in any groups yet",
  noGroupsBody:
    "Your household and classrooms appear here once the office or a teacher adds you.",
  finishTitle: "Finish your profile",
  finishBody: "Add a phone or photo so your groups can reach you.",
  finishBtn: "Continue setup",

  editProfile: "Edit profile",
  previewingAsMember: "Previewing as a member",
  whatOthersSee: "This is what other members see",
  exitPreview: "Exit preview",
  contact: "Contact",
  shareCta: "Share your info with {name}",
  homeLabel: "Home Address",
  mobile: "Mobile",
  email: "Email",
  website: "Website",
  exactHidden: "Exact address hidden",
  firstName: "First name",
  lastName: "Last name",
  setupTitle: "Set up your profile",
  setupLead: "Add your name so your community can recognize you in the directory.",
  createProfileBtn: "Create my profile",
  skipToAdmin: "Skip to admin console",
  alwaysVisible: "Always visible",
  firstFixedWhy:
    "People need a name to recognize you. You choose everything else.",
  lnFull: "Full",
  lnInitial: "Initial",
  shownAs: "Shown as",
  photo: "Profile photo",
  addPhoto: "Add photo",
  addContact: "Add contact item",
  showAsNeighbor: "Show me as a neighbor",
  neighborWhy:
    "Shows only your name and rough distance to nearby members — never your address.",
  whoManages: "Who manages this profile",
  inviteCoManager: "Invite someone to help manage {name}",
  owner: "Owner",
  inviteTitle: "Invite someone to help manage {name}",
  inviteWhy:
    "They'll become a co-manager and can edit {name}'s profile. You keep access too.",
  inviteSend: "Send invitation",
  inviteSent: "Invitation sent to {email}.",

  visMembers: "Members",
  visPrivate: "Private",
  visShared: "Shared",
  visMembersDesc: "Anyone signed in to {school}",
  visPrivateDesc: "Only you, until you share",
  visSharedDesc: "Private, plus the people and groups you pick",
  whoCanSee: "Who can see your {field}?",
  sharedWith: "Shared with",
  addPeople: "Add people or groups",

  household: "Household",
  classroom: "Classroom",
  roster: "Roster",
  members: "Members",
  manage: "Manage",
  youreAdmin: "You're an admin",
  viewOnly: "Member · view only",
  classMember: "Class member",
  teachThisClass: "You teach this class",
  addMember: "Add member",
  setTitle: "Set title",
  setTitles: "Set titles",
  editGroupInfo: "Edit info",
  householdContact: "Household contact",
  cascadeNote: "Cascades to everyone in the household.",
  manageMembers: "Manage members",
  messageAll: "Message all",
  adminManages: "{name} manages this household. Ask an admin to make changes.",
  teacherRuns: "{name} runs this classroom. You can see classmates who share with members.",
  newGroup: "New",
  newHousehold: "New household",
  newClassroom: "New classroom",
  groupName: "Name",
  create: "Create",
  createGroupChoose: "What would you like to create?",

  language: "Language",
  languageNote: "Changes the directory for you only.",

  offlineBanner: "Offline — showing your saved copy",
  offlineReadOnly: "Read-only",
  offlineNote:
    "You're offline, so the directory is read-only. Your saved copy is shown. Reconnect to make changes.",
  masqViewingAs: "Viewing as",
  masqReturn: "Return to admin",
  signOut: "Sign out",
};

const es: Strings = {
  ...en,
  done: "Listo",
  save: "Guardar",
  cancel: "Cancelar",
  back: "Volver a iniciar sesión",

  signInTitle: "Inicia sesión en el directorio",
  signInLead:
    "Escribe tu correo y te enviaremos un enlace para entrar. Sin contraseña que recordar.",
  emailLabel: "Correo",
  emailLink: "Enviarme un enlace",
  privateNote: "Privado para la comunidad de {school}. Nada aquí es público.",
  checkEmailTitle: "Revisa tu correo",
  checkEmailLead:
    "Enviamos un enlace de acceso a {email}. Caduca en 15 minutos.",
  openEmailApp: "Abrir el correo",
  resendLink: "Reenviar enlace",
  signingIn: "Iniciando sesión…",
  signingInSub: "Un momento mientras abrimos el directorio.",
  regClosedTitle: "Gracias — revisa tu correo",
  regClosedLead:
    "Si este correo pertenece a un miembro de {school}, el enlace va en camino.",
  regClosedNote:
    "Por la privacidad de todos, no confirmamos si existe una cuenta. La oficina gestiona los nuevos registros.",

  navHome: "Inicio",
  navDir: "Directorio",
  navGroups: "Grupos",
  navMe: "Tú",
  searchMembers: "Buscar miembros",
  searchGroups: "Buscar grupos",
  myGroups: "Tus grupos",
  allGroups: "Todos los grupos",
  aboutGroupsTitle: "¿Qué es un grupo?",
  aboutGroupsBody:
    "Los grupos organizan la comunidad. Una Familia es tu hogar; un Aula es la clase de un docente. Las escuelas también pueden usar grupos para un Grado, toda la Escuela, o clubes y comités. Una persona puede pertenecer a varios grupos a la vez.",
  colName: "Nombre",
  colType: "Tipo",
  groupsResults: "Resultados",
  groupsEmpty: "Ningún grupo coincide con tu búsqueda.",
  directoryEmpty: "Ningún miembro coincide con tu búsqueda.",
  loadMore: "Cargar más",
  showingOf: "Mostrando {shown} de {total}",

  neighbors: "Vecinos",
  seeAll: "Ver todos",
  groups: "Tus grupos",
  member: "Miembro",
  connect: "Conectar",
  connected: "Conectado",
  preview: "Vista previa",
  whatYouShare: "Lo que compartes",
  membersN: "Miembros",
  privateN: "Privado",
  sharedN: "Compartido",
  shownAsNeighbor: "Visible como vecino",
  on: "Activo",
  off: "Inactivo",
  welcome: "Bienvenido a {school}",

  editProfile: "Editar perfil",
  previewingAsMember: "Vista de un miembro",
  whatOthersSee: "Esto es lo que ven otros miembros",
  exitPreview: "Salir",
  contact: "Contacto",
  shareCta: "Comparte tu información con {name}",
  homeLabel: "Dirección de casa",
  mobile: "Móvil",
  email: "Correo",
  website: "Sitio web",
  exactHidden: "Dirección exacta oculta",

  visMembers: "Miembros",
  visPrivate: "Privado",
  visShared: "Compartido",

  household: "Familia",
  classroom: "Aula",
  members: "Miembros",
  manage: "Gestionar",

  language: "Idioma",
  languageNote: "Cambia el directorio solo para ti.",

  offlineBanner: "Sin conexión — mostrando tu copia guardada",
  offlineReadOnly: "Solo lectura",
  offlineNote:
    "Estás sin conexión, así que el directorio es de solo lectura. Se muestra tu copia guardada. Reconéctate para hacer cambios.",
  masqViewingAs: "Viendo como",
  masqReturn: "Volver a admin",
  signOut: "Cerrar sesión",
};

const zh: Strings = {
  ...en,
  done: "完成",
  save: "保存",
  cancel: "取消",
  back: "返回登录",

  signInTitle: "登录目录",
  signInLead: "输入你的邮箱，我们会发送登录链接。无需记住密码。",
  emailLabel: "邮箱",
  emailLink: "给我发送链接",
  privateNote: "仅限 {school} 社区可见，这里没有任何内容是公开的。",
  checkEmailTitle: "查看你的邮箱",
  checkEmailLead: "我们已将登录链接发送至 {email}，15 分钟内有效。",
  openEmailApp: "打开邮箱应用",
  resendLink: "重新发送链接",
  signingIn: "正在登录…",
  signingInSub: "正在为你打开目录，请稍候。",
  regClosedTitle: "谢谢 — 请查看你的邮箱",
  regClosedLead: "如果该邮箱属于 {school} 成员，登录链接正在发送中。",
  regClosedNote:
    "为保护每个人的隐私，我们不会确认账户是否存在。新注册由学校办公室管理。",

  navHome: "主页",
  navDir: "目录",
  navGroups: "群组",
  navMe: "我",
  searchMembers: "搜索成员",
  searchGroups: "搜索群组",
  myGroups: "你的群组",
  allGroups: "所有群组",
  aboutGroupsTitle: "什么是群组？",
  aboutGroupsBody:
    "群组用于组织社区。家庭即你的家人；班级是某位老师的课堂。学校还可以为年级、整所学校或社团和委员会创建群组。一个人可以同时属于多个群组。",
  colName: "名称",
  colType: "类型",
  groupsResults: "结果",
  groupsEmpty: "没有匹配的群组。",
  directoryEmpty: "没有匹配的成员。",
  loadMore: "加载更多",
  showingOf: "显示 {shown} / {total}",

  neighbors: "邻居",
  seeAll: "查看全部",
  groups: "你的群组",
  member: "成员",
  connect: "连接",
  connected: "已连接",
  preview: "预览",
  whatYouShare: "你分享的内容",
  membersN: "成员",
  privateN: "私密",
  sharedN: "已分享",
  shownAsNeighbor: "显示为邻居",
  on: "开",
  off: "关",
  welcome: "欢迎来到 {school}",

  editProfile: "编辑资料",
  previewingAsMember: "以成员身份预览",
  whatOthersSee: "这是其他成员看到的内容",
  exitPreview: "退出",
  contact: "联系方式",
  shareCta: "与 {name} 分享你的信息",
  homeLabel: "家庭住址",
  mobile: "手机",
  email: "邮箱",
  website: "网站",
  exactHidden: "已隐藏具体地址",

  visMembers: "成员",
  visPrivate: "私密",
  visShared: "已分享",

  household: "家庭",
  classroom: "班级",
  members: "成员",
  manage: "管理",

  language: "语言",
  languageNote: "仅更改你自己的目录显示。",

  offlineBanner: "离线 — 显示你保存的副本",
  offlineReadOnly: "只读",
  offlineNote: "你目前处于离线状态，目录为只读。正在显示你保存的副本。重新连接后即可进行更改。",
  masqViewingAs: "正在查看",
  masqReturn: "返回管理员",
  signOut: "退出登录",
};

export const dictionaries: Record<Locale, Strings> = { en, es, zh };

export const localeNames: Record<Locale, { native: string; english: string }> = {
  en: { native: "English", english: "English" },
  es: { native: "Español", english: "Spanish" },
  zh: { native: "中文", english: "Chinese (Simplified)" },
};

/** Interpolate `{placeholder}` tokens in a string. */
export function interpolate(
  template: string,
  vars: Record<string, string | number> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

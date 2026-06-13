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
  alwaysVisible: string;
  firstFixedWhy: string;
  lnFull: string;
  lnInitial: string;
  lnHide: string;
  shownAs: string;
  photo: string;
  addPhoto: string;
  addContact: string;
  showAsNeighbor: string;
  neighborWhy: string;
  whoManages: string;
  inviteCoManager: string; // uses {name}
  owner: string;

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

  // language
  language: string;
  languageNote: string;
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
  homeLabel: "Home",
  mobile: "Mobile",
  email: "Email",
  website: "Website",
  exactHidden: "Exact address hidden",
  firstName: "First name",
  lastName: "Last name",
  alwaysVisible: "Always visible",
  firstFixedWhy:
    "People need a name to recognize you. You choose everything else.",
  lnFull: "Full",
  lnInitial: "Initial",
  lnHide: "Hide",
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

  language: "Language",
  languageNote: "Changes the directory for you only.",
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
  homeLabel: "Casa",
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
  homeLabel: "住址",
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

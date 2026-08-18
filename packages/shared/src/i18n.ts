// UI string dictionaries (chrome only — member-entered content is never translated).
// Keys mirror the strings objects in the design handoff (HOME_*, PROFILE_*).
// Use `{name}` placeholders; interpolate with `t(key, { name })` in the client.

import { LOCALES, type Capability, type Locale } from "./types.js";

export interface Strings {
  // brand / generic
  brand: string;
  brandSub: string;
  /** Brand subtitle for the calendar app (apps/calendar), which shares `brand`. */
  brandSubCalendar: string;
  done: string;
  save: string;
  cancel: string;
  back: string;

  // onboarding
  signInTitle: string;
  /** Nav/header CTA for a signed-out visitor on a public screen. */
  signInCta: string;
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
  whatAreGroups: string;
  colName: string;
  colType: string;
  groupsResults: string;
  groupsEmpty: string;
  directoryEmpty: string;
  loadMore: string;
  showingOf: string; // uses {shown} {total}

  // calendar
  navCalendar: string;
  calendarTitle: string;
  upcomingEvents: string;
  noEvents: string;
  searchEvents: string;
  clearSearch: string;
  noEventsMatch: string;
  allDay: string;
  calendars: string;
  downloadIcs: string; // uses {name}
  downloadIcsNote: string;
  subscribeIcs: string; // uses {name}
  subscribeLead: string; // uses {name}
  subscribeApple: string;
  subscribeGoogle: string;
  subscribeOther: string;
  subscribeCopy: string;
  subscribeCopied: string;
  subscribeNote: string;

  // newsletter (member- and public-facing only; the authoring UI is admin
  // tooling and stays English, as the calendar's admin screens do)
  brandSubNewsletter: string;
  navNewsletter: string;
  newsletterArchive: string;
  newsletterPrefsTitle: string;
  newsletterPrefsLead: string;
  newsletterSubscribeLabel: string;
  newsletterSubscribed: string;
  newsletterUnsubscribed: string;
  unsubscribeTitle: string;
  unsubscribeLead: string; // uses {email}
  unsubscribeConfirm: string;
  unsubscribeDone: string;
  latestIssue: string;

  // volunteer signups (member- and public-facing only; the authoring UI is admin
  // tooling and stays English, as the calendar's other admin screens do)
  volunteersTitle: string;
  volunteersNeeded: string;
  volunteerSpotsFilled: string; // uses {filled} {slots}
  volunteerSpotsLeft: string; // uses {left}
  volunteerFull: string;
  takeASpot: string;
  signInToVolunteer: string;
  volunteerWithdraw: string;
  volunteerWhoFor: string;
  volunteerNote: string;
  volunteerNotePlaceholder: string;
  volunteerSignupsClosed: string;
  volunteerNoPositions: string;
  volunteerNamesMembersOnly: string;
  volunteerAlready: string;
  volunteerTookLastSpot: string;
  volunteerError: string;
  volunteerNotFound: string;
  volunteerNotFoundBody: string;

  // home
  neighbors: string;
  noNeighbors: string;
  noNeighborsBody: string;
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
  hiddenFromMembers: string; // uses {count}
  exitPreview: string;
  contact: string;
  fromGroup: string; // uses {name}
  shareCta: string; // uses {name}
  homeLabel: string;
  mobile: string;
  email: string;
  website: string;
  typeAddress: string;
  typePhone: string;
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
  genericGroup: string;
  genericGroupSub: string;
  genericManages: string; // uses {name}
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
  createSubgroup: string;
  subgroups: string;
  parentGroup: string;
  setParentGroup: string;
  parentNone: string;
  noEligibleGroups: string;
  editGroup: string;
  renameGroup: string;
  deleteGroup: string;
  deleteGroupConfirm: string; // uses {name}
  deleteGroupWarn: string; // uses {count}
  deleteGroupKeepsPeople: string;
  deleteGroupHasChildren: string;
  deleteGroupFailed: string;
  renameGroupFailed: string;
  groupType: string;
  groupTypeChangeNote: string;
  changeTypeFailed: string;
  changeTypeHasChildren: string;
  reparentFailed: string;
  reparentRejected: string;
  confirmDelete: string;

  // capabilities (Capability enum labels)
  capParent: string;
  capTeacher: string;
  capStaff: string;
  capStudent: string;
  capHouseholdAdmin: string;

  // person switcher
  actingAs: string;
  addPerson: string;

  // create / add a person
  addPersonTitle: string;
  addPersonLead: string;
  addPersonBtn: string;
  personType: string;
  personTypeNote: string;
  personHousehold: string;
  personHouseholdNote: string;
  householdNone: string;

  // language
  language: string;
  languageNote: string;

  // site footer
  footerBuiltBy: string; // uses {school}
  footerFeedback: string; // uses {email}

  // landing page (apps/home — the public front door at eisenhower.school).
  // That page is server-rendered by a Worker with no client bundle, so these
  // are read straight out of `dictionaries` rather than through a provider.
  /** The greeting, in THIS language. Unlike every other string here, all four
   *  locales' copies are rendered at once — the landing page's hero is the
   *  stack of greetings, and it doubles as the language picker. */
  landingWelcome: string;
  landingTitle: string; // uses {school}
  landingDescription: string; // uses {school} {languages}
  landingLead: string; // uses {school}
  landingReadIn: string; // uses {language}
  landingCreateAccount: string;
  landingNoPassword: string;
  landingSeeCalendar: string;
  landingWhatsHere: string;
  landingMembersOnly: string;
  landingOpenToAll: string;
  landingOpen: string; // uses {name}
  landingDirBody: string;
  landingDirMore: string; // uses {feature}
  landingCalBody: string;
  landingCalMore: string; // uses {feature}
  landingNewsTitle: string;
  landingNewsBody: string;
  landingNewsMore: string;
  landingJoinTitle: string;
  landingJoinBody: string; // uses {school}
  landingSchoolSiteLabel: string;
  landingSchoolSiteLink: string;

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
  brandSub: "PTO Directory",
  brandSubCalendar: "PTO Calendar",
  done: "Done",
  save: "Save",
  cancel: "Cancel",
  back: "Back to sign in",

  signInTitle: "Sign in to the directory",
  signInCta: "Sign in",
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
  whatAreGroups: "What are groups?",
  colName: "Name",
  colType: "Type",
  groupsResults: "Results",
  groupsEmpty: "No groups match your search.",
  directoryEmpty: "No members match your search.",
  loadMore: "Load more",
  showingOf: "Showing {shown} of {total}",

  navCalendar: "Calendars",
  calendarTitle: "Calendar",
  upcomingEvents: "Upcoming events",
  noEvents: "No upcoming events",
  searchEvents: "Search events",
  clearSearch: "Clear search",
  noEventsMatch: "No events match your search.",
  allDay: "All day",
  calendars: "Calendars",
  downloadIcs: "Download {name} (.ics)",
  downloadIcsNote:
    "A one-time copy of today's dates. It won't update when the school's plans change.",
  subscribeIcs: "Subscribe to {name}",
  subscribeLead:
    "Add {name} to the calendar app you already use. New and changed events arrive on their own — you won't need to come back here.",
  subscribeApple: "Apple Calendar or Outlook",
  subscribeGoogle: "Google Calendar",
  subscribeOther: "Or paste this link into any calendar app",
  subscribeCopy: "Copy link",
  subscribeCopied: "Copied",
  subscribeNote:
    "Calendar apps check for updates on their own schedule, so a change can take a few hours to show up.",

  brandSubNewsletter: "PTO Newsletter",
  navNewsletter: "Newsletters",
  newsletterArchive: "Past issues",
  newsletterPrefsTitle: "Newsletter",
  newsletterPrefsLead: "Choose whether the school newsletter is sent to your email address.",
  newsletterSubscribeLabel: "Email me the newsletter",
  newsletterSubscribed: "You're subscribed.",
  newsletterUnsubscribed: "You won't receive the newsletter.",
  unsubscribeTitle: "Unsubscribe",
  unsubscribeLead: "Stop sending the newsletter to {email}?",
  unsubscribeConfirm: "Yes, unsubscribe me",
  unsubscribeDone: "You've been unsubscribed.",
  latestIssue: "Latest newsletter",

  volunteersTitle: "Volunteers",
  volunteersNeeded: "Volunteers needed",
  volunteerSpotsFilled: "{filled} of {slots} filled",
  volunteerSpotsLeft: "{left} still needed",
  volunteerFull: "All filled",
  takeASpot: "Take a spot",
  signInToVolunteer: "Sign in to volunteer",
  volunteerWithdraw: "Give up spot",
  volunteerWhoFor: "Who is signing up?",
  volunteerNote: "Note (optional)",
  volunteerNotePlaceholder: "Anything the organizer should know",
  volunteerSignupsClosed: "Signups are closed.",
  volunteerNoPositions: "No positions have been posted yet.",
  volunteerNamesMembersOnly: "Sign in to see who has signed up.",
  volunteerAlready: "Already signed up for this.",
  volunteerTookLastSpot: "Someone just took the last spot.",
  volunteerError: "That didn't work. Please try again.",
  volunteerNotFound: "Signup sheet not found",
  volunteerNotFoundBody: "This link may have expired, or signups were taken down.",

  neighbors: "Neighbors",
  noNeighbors: "No neighbors nearby yet.",
  noNeighborsBody:
    "Neighbors appear once other members within 2 miles turn on “Show me as a neighbor” for their address. Your own household isn't listed here.",
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
  hiddenFromMembers: "{count} hidden from members",
  exitPreview: "Exit preview",
  contact: "Contact",
  fromGroup: "via {name}",
  shareCta: "Share your info with {name}",
  homeLabel: "Home Address",
  mobile: "Mobile",
  email: "Email",
  website: "Website",
  typeAddress: "Address",
  typePhone: "Phone",
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
  genericGroup: "Group",
  genericGroupSub: "School, grade, club, or committee",
  genericManages: "{name} manages this group.",
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
  createSubgroup: "Create sub-group",
  subgroups: "Sub-groups",
  parentGroup: "Parent group",
  setParentGroup: "Set parent group",
  parentNone: "No parent (top level)",
  noEligibleGroups: "No eligible groups.",
  editGroup: "Edit group",
  renameGroup: "Rename",
  deleteGroup: "Delete group",
  deleteGroupConfirm: "Delete “{name}”?",
  deleteGroupWarn: "This can't be undone.",
  deleteGroupKeepsPeople: "The {count} people in it stay in the directory — only the group and the contact info it shares are removed.",
  deleteGroupHasChildren: "Move or delete its sub-groups first.",
  deleteGroupFailed: "Couldn't delete this group.",
  renameGroupFailed: "Couldn't rename this group.",
  groupType: "Type",
  groupTypeChangeNote: "The type decides what the group does. Only a household shares an address with its members and appears in neighbor discovery, and only a household's admins get the household-admin badge.",
  changeTypeFailed: "Couldn't change this group's type.",
  changeTypeHasChildren: "A household can't hold sub-groups — move them out first.",
  reparentFailed: "Couldn't move this group.",
  reparentRejected: "That group can't be the parent — pick another.",
  confirmDelete: "Yes, delete",

  capParent: "Parent",
  capTeacher: "Teacher",
  capStaff: "Staff",
  capStudent: "Student",
  capHouseholdAdmin: "Household admin",

  actingAs: "Acting as",
  addPerson: "Add a person",

  addPersonTitle: "Add a person",
  addPersonLead: "Add a child, partner, or someone else you manage. You'll be able to act as them to edit their profile.",
  addPersonBtn: "Add person",
  personType: "Type",
  personTypeNote: "Optional. You can change this later.",
  personHousehold: "Household",
  personHouseholdNote: "Optional. Adds them to a household so its shared address applies.",
  householdNone: "No household",

  language: "Language",
  languageNote: "Changes the directory for you only.",

  footerBuiltBy: "Site built by the {school}.",
  footerFeedback: "Feedback? Email {email}",

  landingWelcome: "Welcome",
  landingTitle: "{school} — directory, calendar and newsletter",
  landingDescription:
    "The directory, calendar, newsletter and volunteer sign-ups for {school} families. Available in {languages}.",
  landingLead:
    "Everything the {school} keeps for families, in one place — a directory of who's who, the school calendar, and the newsletter. One account opens all three.",
  landingReadIn: "Read this page in {language}",
  landingCreateAccount: "Create your account",
  landingNoPassword: "No password to remember — we email you a sign-in link.",
  landingSeeCalendar: "See the calendar",
  landingWhatsHere: "What's here",
  landingMembersOnly: "Members only",
  landingOpenToAll: "Open to everyone",
  landingOpen: "Open {name}",
  landingDirBody:
    "Look up a classmate's family, a teacher, or whoever runs the thing you signed up for. Every detail you add starts private, and you decide field by field who can see it.",
  landingDirMore:
    "{feature}: opt in and see which member families live near you — a name and a rough distance, never an address.",
  landingCalBody:
    "Concerts, conferences, picnics, no-school days. Subscribe once and the school year keeps itself up to date in the calendar app you already use.",
  landingCalMore: "{feature}: claim a spot at an event straight from its page.",
  landingNewsTitle: "Newsletter",
  landingNewsBody:
    "PTO news in your inbox every few weeks — what's coming up, what got done, and what still needs hands.",
  landingNewsMore:
    "Anyone can subscribe, and every past issue is on the web. No account needed.",
  landingJoinTitle: "Join the directory",
  landingJoinBody:
    "It takes a couple of minutes. Nothing here is ever public — the directory is closed to everyone outside the {school} community, and you choose what the rest of it sees.",
  landingSchoolSiteLabel: "Looking for the school itself?",
  landingSchoolSiteLink: "Eisenhower Elementary website",

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
  brandSub: "Directorio de la PTO",
  brandSubCalendar: "Calendario de la PTO",
  done: "Listo",
  save: "Guardar",
  cancel: "Cancelar",
  back: "Volver a iniciar sesión",

  signInTitle: "Inicia sesión en el directorio",
  signInCta: "Iniciar sesión",
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
  whatAreGroups: "¿Qué son los grupos?",
  colName: "Nombre",
  colType: "Tipo",
  groupsResults: "Resultados",
  groupsEmpty: "Ningún grupo coincide con tu búsqueda.",
  directoryEmpty: "Ningún miembro coincide con tu búsqueda.",
  loadMore: "Cargar más",
  showingOf: "Mostrando {shown} de {total}",

  navCalendar: "Calendarios",
  calendarTitle: "Calendario",
  upcomingEvents: "Próximos eventos",
  noEvents: "No hay eventos próximos",
  searchEvents: "Buscar eventos",
  clearSearch: "Borrar la búsqueda",
  noEventsMatch: "Ningún evento coincide con tu búsqueda.",
  allDay: "Todo el día",
  calendars: "Calendarios",
  downloadIcs: "Descargar {name} (.ics)",
  downloadIcsNote:
    "Una copia única de las fechas de hoy. No se actualizará cuando cambien los planes de la escuela.",
  subscribeIcs: "Suscribirse a {name}",
  subscribeLead:
    "Agrega {name} a la aplicación de calendario que ya usas. Los eventos nuevos y los cambios llegan solos: no tendrás que volver aquí.",
  subscribeApple: "Apple Calendar u Outlook",
  subscribeGoogle: "Google Calendar",
  subscribeOther: "O pega este enlace en cualquier aplicación de calendario",
  subscribeCopy: "Copiar enlace",
  subscribeCopied: "Copiado",
  subscribeNote:
    "Las aplicaciones de calendario buscan actualizaciones por su cuenta, así que un cambio puede tardar unas horas en aparecer.",

  brandSubNewsletter: "Boletín de la PTO",
  navNewsletter: "Boletines",
  newsletterArchive: "Números anteriores",
  newsletterPrefsTitle: "Boletín",
  newsletterPrefsLead: "Elija si desea recibir el boletín escolar en su correo electrónico.",
  newsletterSubscribeLabel: "Enviarme el boletín por correo",
  newsletterSubscribed: "Está suscrito.",
  newsletterUnsubscribed: "No recibirá el boletín.",
  unsubscribeTitle: "Cancelar la suscripción",
  unsubscribeLead: "¿Dejar de enviar el boletín a {email}?",
  unsubscribeConfirm: "Sí, cancelar mi suscripción",
  unsubscribeDone: "Se ha cancelado su suscripción.",
  latestIssue: "Último boletín",

  volunteersTitle: "Voluntarios",
  volunteersNeeded: "Se necesitan voluntarios",
  volunteerSpotsFilled: "{filled} de {slots} cubiertos",
  volunteerSpotsLeft: "Faltan {left}",
  volunteerFull: "Completo",
  takeASpot: "Apuntarme",
  signInToVolunteer: "Inicia sesión para ser voluntario",
  volunteerWithdraw: "Ceder mi lugar",
  volunteerWhoFor: "¿Quién se apunta?",
  volunteerNote: "Nota (opcional)",
  volunteerNotePlaceholder: "Algo que deba saber quien organiza",
  volunteerSignupsClosed: "Las inscripciones están cerradas.",
  volunteerNoPositions: "Todavía no se han publicado puestos.",
  volunteerNamesMembersOnly: "Inicia sesión para ver quién se ha apuntado.",
  volunteerAlready: "Ya está apuntado en este puesto.",
  volunteerTookLastSpot: "Alguien acaba de tomar el último lugar.",
  volunteerError: "No se pudo completar. Inténtalo de nuevo.",
  volunteerNotFound: "No se encontró la hoja de inscripción",
  volunteerNotFoundBody: "Puede que el enlace haya caducado o que se hayan retirado las inscripciones.",

  neighbors: "Vecinos",
  noNeighbors: "Aún no hay vecinos cerca.",
  noNeighborsBody:
    "Los vecinos aparecen cuando otros miembros a menos de 2 millas activan la opción para mostrarse como vecinos en su dirección. Tu propia Familia no aparece aquí.",
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
  hiddenFromMembers: "{count} oculto(s) para los miembros",
  exitPreview: "Salir",
  contact: "Contacto",
  fromGroup: "vía {name}",
  shareCta: "Comparte tu información con {name}",
  typeAddress: "Dirección",
  typePhone: "Teléfono",
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
  genericGroup: "Grupo",
  genericGroupSub: "Escuela, grado, club o comité",
  genericManages: "{name} gestiona este grupo.",
  createSubgroup: "Crear subgrupo",
  subgroups: "Subgrupos",
  parentGroup: "Grupo principal",
  setParentGroup: "Establecer grupo principal",
  parentNone: "Sin grupo principal (nivel superior)",
  noEligibleGroups: "No hay grupos elegibles.",
  editGroup: "Editar grupo",
  renameGroup: "Cambiar nombre",
  deleteGroup: "Eliminar grupo",
  deleteGroupConfirm: "¿Eliminar «{name}»?",
  deleteGroupWarn: "Esta acción no se puede deshacer.",
  deleteGroupKeepsPeople: "Las {count} personas del grupo permanecen en el directorio: solo se elimina el grupo y la información de contacto que comparte.",
  deleteGroupHasChildren: "Primero mueve o elimina sus subgrupos.",
  deleteGroupFailed: "No se pudo eliminar este grupo.",
  renameGroupFailed: "No se pudo cambiar el nombre de este grupo.",
  groupType: "Tipo",
  groupTypeChangeNote: "El tipo define lo que hace el grupo. Solo una familia comparte una dirección con sus miembros y aparece en la búsqueda de vecinos, y solo los administradores de una familia reciben la insignia de administrador familiar.",
  changeTypeFailed: "No se pudo cambiar el tipo de este grupo.",
  changeTypeHasChildren: "Una familia no puede contener subgrupos: muévelos primero.",
  reparentFailed: "No se pudo mover este grupo.",
  reparentRejected: "Ese grupo no puede ser el principal: elige otro.",
  confirmDelete: "Sí, eliminar",
  members: "Miembros",
  manage: "Gestionar",

  capParent: "Padre/Madre",
  capTeacher: "Docente",
  capStaff: "Personal",
  capStudent: "Estudiante",
  capHouseholdAdmin: "Administrador del hogar",

  actingAs: "Actuando como",
  addPerson: "Agregar una persona",

  addPersonTitle: "Agregar una persona",
  addPersonLead: "Agrega a un hijo, pareja u otra persona que gestiones. Podrás actuar como ella para editar su perfil.",
  addPersonBtn: "Agregar persona",
  personType: "Tipo",
  personTypeNote: "Opcional. Puedes cambiarlo más tarde.",
  personHousehold: "Familia",
  personHouseholdNote: "Opcional. La agrega a una familia para aplicar su dirección compartida.",
  householdNone: "Sin familia",

  language: "Idioma",
  languageNote: "Cambia el directorio solo para ti.",

  footerBuiltBy: "Sitio creado por {school}.",
  footerFeedback: "¿Comentarios? Escribe a {email}",

  landingWelcome: "Bienvenidos",
  landingTitle: "{school} — directorio, calendario y boletín",
  landingDescription:
    "El directorio, el calendario, el boletín y las inscripciones de voluntarios para las familias de {school}. Disponible en {languages}.",
  landingLead:
    "Todo lo que {school} reúne para las familias, en un solo lugar: un directorio de quién es quién, el calendario escolar y el boletín. Una sola cuenta abre los tres.",
  landingReadIn: "Leer esta página en {language}",
  landingCreateAccount: "Crea tu cuenta",
  landingNoPassword: "Sin contraseña que recordar: te enviamos un enlace por correo.",
  landingSeeCalendar: "Ver el calendario",
  landingWhatsHere: "Qué hay aquí",
  landingMembersOnly: "Solo para miembros",
  landingOpenToAll: "Abierto a todos",
  landingOpen: "Abrir {name}",
  landingDirBody:
    "Busca a la familia de un compañero de clase, a un maestro o a quien organiza la actividad en la que te apuntaste. Cada dato que agregas empieza como privado, y tú decides campo por campo quién puede verlo.",
  landingDirMore:
    "{feature}: actívalo y verás qué familias miembros viven cerca de ti: un nombre y una distancia aproximada, nunca una dirección.",
  landingCalBody:
    "Conciertos, conferencias, días de campo, días sin clases. Suscríbete una vez y el año escolar se mantiene al día en la aplicación de calendario que ya usas.",
  landingCalMore: "{feature}: apúntate a un evento desde su propia página.",
  landingNewsTitle: "Boletín",
  landingNewsBody:
    "Noticias de la PTO en tu correo cada pocas semanas: lo que viene, lo que ya se hizo y dónde hacen falta manos.",
  landingNewsMore:
    "Cualquiera puede suscribirse, y todos los números anteriores están en la web. No hace falta cuenta.",
  landingJoinTitle: "Únete al directorio",
  landingJoinBody:
    "Toma un par de minutos. Nada de esto es público: el directorio está cerrado a cualquiera fuera de la comunidad de {school}, y tú eliges qué ve el resto.",
  landingSchoolSiteLabel: "¿Buscas la escuela?",
  landingSchoolSiteLink: "Sitio web de Eisenhower Elementary",

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
  brandSub: "PTO 名录",
  brandSubCalendar: "PTO 日历",
  done: "完成",
  save: "保存",
  cancel: "取消",
  back: "返回登录",

  signInTitle: "登录目录",
  signInCta: "登录",
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
  whatAreGroups: "什么是群组？",
  colName: "名称",
  colType: "类型",
  groupsResults: "结果",
  groupsEmpty: "没有匹配的群组。",
  directoryEmpty: "没有匹配的成员。",
  loadMore: "加载更多",
  showingOf: "显示 {shown} / {total}",

  navCalendar: "日历",
  calendarTitle: "日历",
  upcomingEvents: "近期活动",
  noEvents: "暂无近期活动",
  searchEvents: "搜索活动",
  clearSearch: "清除搜索",
  noEventsMatch: "没有符合搜索条件的活动。",
  allDay: "全天",
  calendars: "日历",
  downloadIcs: "下载 {name}（.ics）",
  downloadIcsNote: "当前日期的一次性副本。学校安排变动时不会自动更新。",
  subscribeIcs: "订阅{name}",
  subscribeLead: "把{name}添加到你常用的日历应用。新活动和改动会自动同步，你不必再回到这里查看。",
  subscribeApple: "Apple 日历或 Outlook",
  subscribeGoogle: "Google 日历",
  subscribeOther: "或把此链接粘贴到任意日历应用",
  subscribeCopy: "复制链接",
  subscribeCopied: "已复制",
  subscribeNote: "日历应用会按自己的时间检查更新，因此改动可能需要几小时才会显示。",

  brandSubNewsletter: "PTO 通讯",
  navNewsletter: "通讯",
  newsletterArchive: "往期通讯",
  newsletterPrefsTitle: "通讯",
  newsletterPrefsLead: "选择是否将学校通讯发送到您的电子邮箱。",
  newsletterSubscribeLabel: "通过电子邮件接收通讯",
  newsletterSubscribed: "您已订阅。",
  newsletterUnsubscribed: "您将不会收到通讯。",
  unsubscribeTitle: "退订",
  unsubscribeLead: "停止向 {email} 发送通讯？",
  unsubscribeConfirm: "是的，为我退订",
  unsubscribeDone: "您已退订。",
  latestIssue: "最新通讯",

  volunteersTitle: "志愿者",
  volunteersNeeded: "招募志愿者",
  volunteerSpotsFilled: "已报名 {filled}/{slots}",
  volunteerSpotsLeft: "还需 {left} 人",
  volunteerFull: "已满",
  takeASpot: "我要报名",
  signInToVolunteer: "登录后即可报名",
  volunteerWithdraw: "取消报名",
  volunteerWhoFor: "为谁报名？",
  volunteerNote: "备注（可选）",
  volunteerNotePlaceholder: "有什么需要组织者知道的",
  volunteerSignupsClosed: "报名已截止。",
  volunteerNoPositions: "尚未发布任何岗位。",
  volunteerNamesMembersOnly: "登录后可查看报名名单。",
  volunteerAlready: "该岗位已报名。",
  volunteerTookLastSpot: "最后一个名额刚被别人报走了。",
  volunteerError: "操作未成功，请重试。",
  volunteerNotFound: "未找到报名表",
  volunteerNotFoundBody: "链接可能已失效，或报名已被撤下。",

  neighbors: "邻居",
  noNeighbors: "附近暂无邻居。",
  noNeighborsBody:
    "当 2 英里内的其他成员为自己的地址开启邻居显示后，他们就会出现在这里。你自己家庭的成员不会列出。",
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
  hiddenFromMembers: "{count} 项对成员隐藏",
  exitPreview: "退出",
  contact: "联系方式",
  fromGroup: "来自 {name}",
  shareCta: "与 {name} 分享你的信息",
  typeAddress: "地址",
  typePhone: "电话",
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
  genericGroup: "群组",
  genericGroupSub: "学校、年级、社团或委员会",
  genericManages: "{name} 管理此群组。",
  createSubgroup: "创建子群组",
  subgroups: "子群组",
  parentGroup: "上级群组",
  setParentGroup: "设置上级群组",
  parentNone: "无上级（顶层）",
  noEligibleGroups: "没有符合条件的群组。",
  editGroup: "编辑群组",
  renameGroup: "重命名",
  deleteGroup: "删除群组",
  deleteGroupConfirm: "确定删除“{name}”？",
  deleteGroupWarn: "此操作无法撤销。",
  deleteGroupKeepsPeople: "群组中的 {count} 人仍保留在通讯录中——只会删除该群组及其共享的联系信息。",
  deleteGroupHasChildren: "请先移动或删除其子群组。",
  deleteGroupFailed: "无法删除此群组。",
  renameGroupFailed: "无法重命名此群组。",
  groupType: "类型",
  groupTypeChangeNote: "类型决定群组的作用。只有家庭会与成员共享地址并出现在邻居发现中，也只有家庭的管理员才会获得家庭管理员标识。",
  changeTypeFailed: "无法更改此群组的类型。",
  changeTypeHasChildren: "家庭不能包含子群组，请先将其移出。",
  reparentFailed: "无法移动此群组。",
  reparentRejected: "该群组不能作为上级，请选择其他群组。",
  confirmDelete: "确认删除",
  members: "成员",
  manage: "管理",

  capParent: "家长",
  capTeacher: "老师",
  capStaff: "教职员",
  capStudent: "学生",
  capHouseholdAdmin: "家庭管理员",

  actingAs: "当前身份",
  addPerson: "添加成员",

  addPersonTitle: "添加成员",
  addPersonLead: "添加孩子、配偶或其他由你管理的人。你可以切换为该成员来编辑其资料。",
  addPersonBtn: "添加成员",
  personType: "类型",
  personTypeNote: "可选。之后可以更改。",
  personHousehold: "家庭",
  personHouseholdNote: "可选。将其加入某个家庭，以共享该家庭的地址。",
  householdNone: "无家庭",

  language: "语言",
  languageNote: "仅更改你自己的目录显示。",

  footerBuiltBy: "本网站由{school}制作。",
  footerFeedback: "有意见或建议？请发送邮件至 {email}",

  landingWelcome: "欢迎",
  landingTitle: "{school} — 名录、日历与通讯",
  landingDescription:
    "{school} 为家庭提供的名录、日历、通讯和志愿者报名。提供 {languages} 版本。",
  landingLead:
    "{school} 为家庭准备的一切都在这里：一份「谁是谁」的名录、学校日历，以及通讯。一个账户，三处通用。",
  landingReadIn: "用{language}阅读本页",
  landingCreateAccount: "创建账户",
  landingNoPassword: "无需记住密码，我们会把登录链接发到你的邮箱。",
  landingSeeCalendar: "查看日历",
  landingWhatsHere: "这里有什么",
  landingMembersOnly: "仅限成员",
  landingOpenToAll: "对所有人开放",
  landingOpen: "打开{name}",
  landingDirBody:
    "查找同学的家庭、老师，或某项活动的负责人。你填写的每一项资料默认都是私密的，并且可以逐项决定谁能看到。",
  landingDirMore:
    "{feature}：开启后即可看到住在附近的成员家庭——只显示姓名和大致距离，绝不显示地址。",
  landingCalBody:
    "音乐会、家长会、野餐、不上课的日子。订阅一次，整个学年都会自动同步到你惯用的日历应用里。",
  landingCalMore: "{feature}：直接在活动页面上报名。",
  landingNewsTitle: "通讯",
  landingNewsBody:
    "每隔几周，PTO 的消息就会送到你的邮箱：即将开始的事、已经完成的事，以及还需要人手的事。",
  landingNewsMore: "任何人都可以订阅，往期通讯也都在网上，无需账户。",
  landingJoinTitle: "加入名录",
  landingJoinBody:
    "只需几分钟。这里没有任何内容是公开的——名录不对 {school} 社区以外的任何人开放，其余内容由你决定谁能看到。",
  landingSchoolSiteLabel: "在找学校官网？",
  landingSchoolSiteLink: "Eisenhower Elementary 官网",

  offlineBanner: "离线 — 显示你保存的副本",
  offlineReadOnly: "只读",
  offlineNote: "你目前处于离线状态，目录为只读。正在显示你保存的副本。重新连接后即可进行更改。",
  masqViewingAs: "正在查看",
  masqReturn: "返回管理员",
  signOut: "退出登录",
};

const so: Strings = {
  brand: "Eisenhower",
  brandSub: "Tusmada PTO",
  brandSubCalendar: "Kalandarka PTO",
  done: "Diyaar",
  save: "Kaydi",
  cancel: "Jooji",
  back: "Ku noqo galitaanka",

  signInTitle: "Gal tusmada",
  signInCta: "Gal",
  signInLead:
    "Geli iimaylkaaga, waxaanan kuu soo dirnaa link aad ku gasho. Furaha sirta lama xasuusan doono.",
  emailLabel: "Iimayl",
  emailLink: "Link iigu soo dir iimaylka",
  privateNote: "Waa gaar u ah bulshada {school}. Waxba halkan kuma jiraan wax dadweynuhu arki karo.",
  checkEmailTitle: "Fiiri iimaylkaaga",
  checkEmailLead:
    "Waxaan link galitaan u dirnay {email}. Wuxuu dhacayaa 15 daqiiqo gudahood.",
  openEmailApp: "Fur barnaamijka iimaylka",
  resendLink: "Dib u dir link-ga",
  signingIn: "Waa lagu gelinayaa\u2026",
  signingInSub: "Daqiiqad, tusmada ayaa furmaysa.",
  regClosedTitle: "Mahadsanid \u2014 fiiri iimaylkaaga",
  regClosedLead:
    "Haddii iimaylkani uu leeyahay xubin ka tirsan {school}, link galitaan ayaa soo socda.",
  regClosedNote:
    "Asturnaanta qof walba awgeed, ma xaqiijinno in akoon jiro iyo in kale. Diiwaangelinta cusub waxaa maamula xafiiska dugsiga.",

  navHome: "Bogga hore",
  navDir: "Tusmada",
  navGroups: "Kooxaha",
  navMe: "Adiga",
  searchMembers: "Raadi xubno",
  searchGroups: "Raadi kooxo",
  myGroups: "Kooxahaaga",
  allGroups: "Dhammaan kooxaha",
  aboutGroupsTitle: "Waa maxay koox?",
  aboutGroupsBody:
    "Kooxuhu waxay habeeyaan bulshada. Qoysku waa reerkaaga; Fasalku waa fasalka macallin. Dugsiyadu waxay sidoo kale kooxaha u isticmaali karaan heer fasaleed, dugsiga oo dhan, ama naadiyo iyo guddiyo. Qof ayaa isku mar ka tirsanaan kara kooxo badan.",
  whatAreGroups: "Waa maxay kooxuhu?",
  colName: "Magaca",
  colType: "Nooca",
  groupsResults: "Natiijooyinka",
  groupsEmpty: "Ma jiraan kooxo waafaqsan raadintaada.",
  directoryEmpty: "Ma jiraan xubno waafaqsan raadintaada.",
  loadMore: "Soo bandhig wax dheeraad ah",
  showingOf: "Waxaa la tusayaa {shown} ka mid ah {total}",

  navCalendar: "Kalandarrada",
  calendarTitle: "Kalandarka",
  upcomingEvents: "Dhacdooyinka soo socda",
  noEvents: "Ma jiraan dhacdooyin soo socda",
  searchEvents: "Raadi dhacdooyin",
  clearSearch: "Tirtir raadinta",
  noEventsMatch: "Ma jiraan dhacdooyin waafaqsan raadintaada.",
  allDay: "Maalinta oo dhan",
  calendars: "Kalandarrada",
  downloadIcs: "Soo dejiso {name} (.ics)",
  downloadIcsNote:
    "Waa koobi hal mar ah oo taariikhaha maanta ah. Ma cusboonaysiimayso marka qorshaha dugsigu isbeddelo.",
  subscribeIcs: "Ku biir {name}",
  subscribeLead:
    "Ku dar {name} barnaamijka kalandarka ee aad hore u isticmaasho. Dhacdooyinka cusub iyo kuwa isbeddelay iyagaa iskood u imanaya \u2014 uma baahnid inaad halkan ku soo noqoto.",
  subscribeApple: "Apple Calendar ama Outlook",
  subscribeGoogle: "Google Calendar",
  subscribeOther: "Ama link-gan ku dhaji barnaamij kasta oo kalandar ah",
  subscribeCopy: "Koobi link-ga",
  subscribeCopied: "Waa la koobiyeeyay",
  subscribeNote:
    "Barnaamijyada kalandarku waxay cusboonaysiinta ku hubiyaan jadwalkooda gaarka ah, sidaas darteed isbeddelku wuxuu qaadan karaa dhowr saacadood inuu soo muuqdo.",

  brandSubNewsletter: "Warsidaha PTO",
  navNewsletter: "Warsidayaasha",
  newsletterArchive: "Daabacaadihii hore",
  newsletterPrefsTitle: "Warsidaha",
  newsletterPrefsLead: "Dooro in warsidaha dugsiga loo diro iimaylkaaga iyo in kale.",
  newsletterSubscribeLabel: "Warsidaha iimayl iigu soo dir",
  newsletterSubscribed: "Waad ku biirtay.",
  newsletterUnsubscribed: "Warsidaha ma heli doontid.",
  unsubscribeTitle: "Ka bax",
  unsubscribeLead: "Ma joojinnaa u dirista warsidaha {email}?",
  unsubscribeConfirm: "Haa, iga saar",
  unsubscribeDone: "Waa lagaa saaray.",
  latestIssue: "Warsidihii ugu dambeeyay",

  volunteersTitle: "Mutadawaciinta",
  volunteersNeeded: "Mutadawaciin ayaa loo baahan yahay",
  volunteerSpotsFilled: "{filled} ka mid ah {slots} ayaa buuxsamay",
  volunteerSpotsLeft: "{left} ayaa weli loo baahan yahay",
  volunteerFull: "Dhammaan way buuxsameen",
  takeASpot: "Boos qaado",
  signInToVolunteer: "Gal si aad u mutadawacdo",
  volunteerWithdraw: "Booska ka noqo",
  volunteerWhoFor: "Yaa is-diiwaangelinaya?",
  volunteerNote: "Xusuus-qor (ikhtiyaari)",
  volunteerNotePlaceholder: "Wax kasta oo qabanqaabiyuhu u baahan yahay inuu ogaado",
  volunteerSignupsClosed: "Is-diiwaangelintu waa xiran tahay.",
  volunteerNoPositions: "Weli ma jiraan boosas la soo bandhigay.",
  volunteerNamesMembersOnly: "Gal si aad u aragto cidda is-diiwaangelisay.",
  volunteerAlready: "Horey ayaad tan isugu diiwaangelisay.",
  volunteerTookLastSpot: "Qof ayaa hadda qaatay booskii ugu dambeeyay.",
  volunteerError: "Taasi ma shaqayn. Fadlan mar kale isku day.",
  volunteerNotFound: "Warqadda is-diiwaangelinta lama helin",
  volunteerNotFoundBody: "Link-gan waa laga yaabaa inuu dhacay, ama is-diiwaangelinta la qaaday.",

  neighbors: "Deriska",
  noNeighbors: "Weli ma jiraan deris kuu dhow.",
  noNeighborsBody:
    "Deriska waxay soo muuqdaan marka xubno kale oo 2 mayl gudaheeda ah ay ciwaankooda u shidaan \u201cI tus sida deris\u201d. Qoyskaaga halkan lagama liisgareeyo.",
  seeAll: "Arag dhammaan",
  groups: "Kooxahaaga",
  member: "Xubin",
  connect: "La xiriir",
  connected: "Waa la xiriiray",
  yourProfile: "Profile-kaaga",
  preview: "Horudhac",
  whatYouShare: "Waxaad wadaagto",
  membersN: "Xubnaha",
  privateN: "Gaar ah",
  sharedN: "La wadaagay",
  shownAsNeighbor: "Waxaa lagu tusayaa sida deris",
  on: "Shidan",
  off: "Xiran",
  welcome: "Ku soo dhawoow {school}",
  addAddressTitle: "Ku dar ciwaankaaga si aad deriska u aragto",
  addAddressBody:
    "Waxaan ku tusi doonnaa xubnaha kuu dhow iyo masaafo qiyaastii ah \u2014 waligeen ma tusi doonno ciwaankaaga saxda ah.",
  addAddressBtn: "Ku dar ciwaan",
  osmAttribution: "Masaafooyinka \u00a9 tabarucayaasha OpenStreetMap",
  noGroups: "Weli koox kuma jirtid",
  noGroupsBody:
    "Qoyskaaga iyo fasalladaadu halkan ayay ka soo muuqan doonaan marka xafiisku ama macallin ku daro.",
  finishTitle: "Dhammee profile-kaaga",
  finishBody: "Ku dar taleefan ama sawir si kooxahaagu ay kuula soo xiriiraan.",
  finishBtn: "Sii wad dejinta",

  editProfile: "Wax ka beddel profile-ka",
  previewingAsMember: "Waxaad u eegaysaa sida xubin",
  whatOthersSee: "Kani waa waxa xubnaha kale arkaan",
  hiddenFromMembers: "{count} ayaa laga qariyay xubnaha",
  exitPreview: "Ka bax horudhaca",
  contact: "Xiriir",
  fromGroup: "laga helay {name}",
  shareCta: "Xogtaada la wadaag {name}",
  homeLabel: "Ciwaanka Guriga",
  mobile: "Mobiil",
  email: "Iimayl",
  website: "Website",
  typeAddress: "Ciwaan",
  typePhone: "Taleefan",
  exactHidden: "Ciwaanka saxda ah waa qarsoon yahay",
  firstName: "Magaca hore",
  lastName: "Magaca dambe",
  setupTitle: "Deji profile-kaaga",
  setupLead: "Ku dar magacaaga si bulshadaadu kuugu garato tusmada.",
  createProfileBtn: "Samee profile-kayga",
  skipToAdmin: "U bood console-ka maamulka",
  alwaysVisible: "Had iyo jeer waa la arkaa",
  firstFixedWhy:
    "Dadku waxay u baahan yihiin magac ay kugu garan karaan. Wax kasta oo kale adigaa doorta.",
  lnFull: "Buuxa",
  lnInitial: "Xarafka hore",
  shownAs: "Waxaa lagu tusayaa",
  photo: "Sawirka profile-ka",
  addPhoto: "Ku dar sawir",
  addContact: "Ku dar xog xiriir",
  showAsNeighbor: "I tus sida deris",
  neighborWhy:
    "Waxay xubnaha kuu dhow tusaysaa magacaaga iyo masaafo qiyaastii ah oo keliya \u2014 waligeed ma tusayso ciwaankaaga.",
  whoManages: "Yaa maamula profile-kan",
  inviteCoManager: "Qof ku casuum inuu kaa caawiyo maaraynta {name}",
  owner: "Milkiile",
  inviteTitle: "Qof ku casuum inuu kaa caawiyo maaraynta {name}",
  inviteWhy:
    "Wuxuu noqonayaa maamule-wadaag, wuxuuna wax ka beddeli karaa profile-ka {name}. Adiguna weli gelitaan ayaad haysataa.",
  inviteSend: "Dir casuumaadda",
  inviteSent: "Casuumaad loo diray {email}.",

  visMembers: "Xubnaha",
  visPrivate: "Gaar ah",
  visShared: "La wadaagay",
  visMembersDesc: "Qof kasta oo {school} ku gala",
  visPrivateDesc: "Adiga oo keliya, ilaa aad wadaagto",
  visSharedDesc: "Gaar ah, iyo dadka iyo kooxaha aad dooratay",
  whoCanSee: "Yaa arki kara {field}-kaaga?",
  sharedWith: "Waxaa la wadaagay",
  addPeople: "Ku dar dad ama kooxo",

  household: "Qoys",
  classroom: "Fasal",
  genericGroup: "Koox",
  genericGroupSub: "Dugsi, heer fasaleed, naadi, ama guddi",
  genericManages: "{name} ayaa maamula kooxdan.",
  roster: "Liiska",
  members: "Xubnaha",
  manage: "Maaree",
  youreAdmin: "Waxaad tahay maamule",
  viewOnly: "Xubin \u00b7 daawasho oo keliya",
  classMember: "Xubin fasalka",
  teachThisClass: "Adigaa bara fasalkan",
  addMember: "Ku dar xubin",
  setTitle: "Deji darajada",
  setTitles: "Deji darajooyinka",
  editGroupInfo: "Wax ka beddel xogta",
  householdContact: "Xiriirka qoyska",
  cascadeNote: "Waxay khusaysaa qof kasta oo qoyska ku jira.",
  manageMembers: "Maaree xubnaha",
  messageAll: "Fariin u dir dhammaan",
  adminManages: "{name} ayaa maamula qoyskan. Weydii maamule si isbeddel loo sameeyo.",
  teacherRuns: "{name} ayaa maamula fasalkan. Waxaad arki kartaa ardayda fasalka ee xogtooda la wadaaga xubnaha.",
  newGroup: "Cusub",
  newHousehold: "Qoys cusub",
  newClassroom: "Fasal cusub",
  groupName: "Magaca",
  create: "Samee",
  createGroupChoose: "Maxaad samayn lahayd?",
  createSubgroup: "Samee koox-hoosaad",
  subgroups: "Kooxaha hoose",
  parentGroup: "Kooxda sare",
  setParentGroup: "Deji kooxda sare",
  parentNone: "Koox sare ma leh (heerka ugu sarreeya)",
  noEligibleGroups: "Ma jiraan kooxo u qalma.",
  editGroup: "Wax ka beddel kooxda",
  renameGroup: "Magac beddel",
  deleteGroup: "Tirtir kooxda",
  deleteGroupConfirm: "Ma tirtiraa \u201c{name}\u201d?",
  deleteGroupWarn: "Tan dib looma soo celin karo.",
  deleteGroupKeepsPeople: "{count} qof ee ku jira way ku sii jiraan tusmada \u2014 waxaa keliya la saarayaa kooxda iyo xogta xiriirka ee ay wadaagto.",
  deleteGroupHasChildren: "Marka hore u dhaqaaji ama tirtir kooxaheeda hoose.",
  deleteGroupFailed: "Kooxdan lama tirtiri karin.",
  renameGroupFailed: "Kooxdan magaceeda lama beddeli karin.",
  groupType: "Nooca",
  groupTypeChangeNote: "Nooca ayaa go\u2019aaminaya waxa kooxdu qabato. Qoys keliya ayaa ciwaan la wadaaga xubnihiisa oo ka soo muuqda helitaanka deriska, oo maamulayaasha qoyska keliya ayaa hela calaamadda maamulaha qoyska.",
  changeTypeFailed: "Nooca kooxdan lama beddeli karin.",
  changeTypeHasChildren: "Qoysku ma qaadan karo kooxo hoose \u2014 marka hore ka saar.",
  reparentFailed: "Kooxdan lama dhaqaajin karin.",
  reparentRejected: "Kooxdaasi ma noqon karto tan sare \u2014 mid kale dooro.",
  confirmDelete: "Haa, tirtir",

  capParent: "Waalid",
  capTeacher: "Macallin",
  capStaff: "Shaqaale",
  capStudent: "Arday",
  capHouseholdAdmin: "Maamulaha qoyska",

  actingAs: "Waxaad u dhaqmaysaa sida",
  addPerson: "Ku dar qof",

  addPersonTitle: "Ku dar qof",
  addPersonLead: "Ku dar ilme, lammaane, ama qof kale oo aad maamusho. Waxaad awoodi doontaa inaad sidiisa u dhaqanto si aad profile-kiisa wax uga beddesho.",
  addPersonBtn: "Ku dar qofka",
  personType: "Nooca",
  personTypeNote: "Ikhtiyaari. Tan dib ayaad u beddeli kartaa.",
  personHousehold: "Qoys",
  personHouseholdNote: "Ikhtiyaari. Wuxuu qoys ku darayaa si ciwaanka la wadaago u khuseeyo.",
  householdNone: "Qoys ma leh",

  language: "Luqadda",
  languageNote: "Waxay tusmada u beddeshaa adiga oo keliya.",

  footerBuiltBy: "Bogga waxaa dhisay {school}.",
  footerFeedback: "Ma leedahay talo? Iimayl u dir {email}",

  landingWelcome: "Soo dhawoow",
  landingTitle: "{school} — tusmo, kalandar iyo warsidaha",
  landingDescription:
    "Tusmada, kalandarka, warsidaha iyo isdiiwaangelinta mutadawaciinta ee qoysaska {school}. Waxaa lagu heli karaa {languages}.",
  landingLead:
    "Wax kasta oo {school} qoysaska u haysato meel keliya: tusmo muujinaysa cidda dadku yihiin, kalandarka dugsiga, iyo warsidaha. Hal xisaab ayaa saddexdaba kuu furaysa.",
  landingReadIn: "Bogga ku akhri {language}",
  landingCreateAccount: "Xisaab samayso",
  landingNoPassword:
    "Ma jiro furaha sirta ah oo aad xasuusan lahayd — link aad ku gasho ayaan iimayl kuugu soo dirnaa.",
  landingSeeCalendar: "Eeg kalandarka",
  landingWhatsHere: "Waxa halkan yaal",
  landingMembersOnly: "Xubnaha oo keliya",
  landingOpenToAll: "U furan qof walba",
  landingOpen: "Fur {name}",
  landingDirBody:
    "Raadi qoyska ardayga fasalka la dhiganaya, macallin, ama qofka wax u qabta hawsha aad isku qortay. Wax kasta oo aad gelisid wuxuu ku bilaabmayaa inuu gaar yahay, adigana waxaad go'aamisaa mid mid cidda arki karta.",
  landingDirMore:
    "{feature}: dooro oo waxaad arki doontaa qoysaska xubnaha ah ee kuu dhow — magac iyo masaafo qiyaastii ah oo keliya, waligeed ma aha ciwaan.",
  landingCalBody:
    "Riwaayado, kulamo waalid-macallin, bannaanbax, iyo maalmaha aan dugsigu jirin. Hal mar ku biir, sanad-dugsiyeedka oo dhanna wuxuu iskiis ugu cusboonaanayaa abka kalandarka ee aad hore u isticmaasho.",
  landingCalMore: "{feature}: boos ka qaado dhacdada boggeeda toos ah.",
  landingNewsTitle: "Warsidaha",
  landingNewsBody:
    "Warka PTO-da ayaa dhowr toddobaad kasta iimaylkaaga ku soo gelaya: waxa soo socda, waxa la qabtay, iyo waxa weli gacmo u baahan.",
  landingNewsMore:
    "Qof kastaa wuu ku biiri karaa, daabacaadihii hore oo dhanna internetka ayay ku yaalliin. Xisaab looma baahna.",
  landingJoinTitle: "Ku biir tusmada",
  landingJoinBody:
    "Waxay qaadanaysaa dhowr daqiiqo. Waxba halkan kuma jiraan wax dadweynuhu arki karo — tusmadu waa u xiran tahay qof kasta oo bulshada {school} ka baxsan, adigana waxaad dooranaysaa waxa inta kale arkayso.",
  landingSchoolSiteLabel: "Ma raadinaysaa dugsiga laftiisa?",
  landingSchoolSiteLink: "Bogga Eisenhower Elementary",

  offlineBanner: "Offline \u2014 waxaa lagu tusayaa koobigaaga la kaydiyay",
  offlineReadOnly: "Akhris oo keliya",
  offlineNote:
    "Waad offline tahay, sidaas darteed tusmadu waa akhris oo keliya. Koobigaaga la kaydiyay ayaa la tusayaa. Dib u xiriir si aad isbeddel u samayso.",
  masqViewingAs: "Waxaad u eegaysaa sida",
  masqReturn: "Ku noqo maamulka",
  signOut: "Ka bax",
};

export const dictionaries: Record<Locale, Strings> = { en, es, zh, so };

/** Maps a Capability enum to its i18n dictionary key, so labels stay translated
 *  (never raw enum strings like "household_admin"). */
export const capabilityLabelKeys: Record<Capability, keyof Strings> = {
  parent: "capParent",
  teacher: "capTeacher",
  staff: "capStaff",
  student: "capStudent",
  household_admin: "capHouseholdAdmin",
};

export const localeNames: Record<Locale, { native: string; english: string }> = {
  en: { native: "English", english: "English" },
  es: { native: "Español", english: "Spanish" },
  zh: { native: "中文", english: "Chinese (Simplified)" },
  so: { native: "Soomaali", english: "Somali" },
};

// ── Language deep links ─────────────────────────────────────────────────────

/** The query parameter a language deep link carries: `?lang=so`.
 *
 *  It exists so a link can be handed to someone in the language they actually
 *  read — "here is the calendar in Somali" — without their having to find the
 *  language picker first. It is a one-shot instruction rather than a permanent
 *  part of the URL: an app applies it, remembers the choice the same way the
 *  picker would, and strips the parameter, so what stays in the address bar (and
 *  in anything bookmarked or re-shared from it) is the ordinary link. That also
 *  means these URLs need no route of their own — every existing path already
 *  accepts one. */
export const LOCALE_PARAM = "lang";

/** Resolve a BCP-47 language tag to one of our locales, or null.
 *
 *  Matches on the primary subtag only and case-insensitively, so `so`, `so-SO`,
 *  `SO_so` and `zh-Hans` all land where a reader would expect. Used for both the
 *  deep-link parameter and `navigator.language`, so a hand-typed code and a
 *  browser setting are interpreted by the same rule.
 *
 *  Anything unrecognized is null, never English: the caller's own fallback chain
 *  (saved choice, then browser language) is a better answer than a typo. */
export function localeFromTag(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const code = tag.trim().toLowerCase().split(/[-_]/)[0];
  return LOCALES.find((l) => l === code) ?? null;
}

/** The locale named by a URL's query string, if it names one at all. Takes
 *  `location.search` (with or without its leading "?").
 *
 *  Parsed by hand rather than with URLSearchParams because this module is
 *  imported by the Worker as well as the browser, and its tsconfig deliberately
 *  carries no DOM lib. A malformed percent-escape is treated as "no locale"
 *  rather than thrown, since this runs on the boot path of every page. */
export function localeFromSearch(search: string): Locale | null {
  for (const pair of search.replace(/^\?/, "").split("&")) {
    const eq = pair.indexOf("=");
    if ((eq === -1 ? pair : pair.slice(0, eq)) !== LOCALE_PARAM) continue;
    const raw = eq === -1 ? "" : pair.slice(eq + 1).replace(/\+/g, " ");
    try {
      return localeFromTag(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  return null;
}

/** Interpolate `{placeholder}` tokens in a string. */
export function interpolate(
  template: string,
  vars: Record<string, string | number> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

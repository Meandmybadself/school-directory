# Handoff: Eisenhower School Directory

## Overview
A privacy-conscious, members-only contact directory for a single school community
(teachers, staff, parents, students). People sign in with **email only** (magic link)
and act on behalf of one or more **Persons** they control (themselves and their
children). The product is the community's trust layer: it must feel safe, calm, and
unmistakably *not* a public social network — no follower counts, likes, public feeds,
or vanity metrics. Nothing in the product is world-readable.

This bundle is the **hi-fi design board**: a small reusable component system plus the
core screens, shown mobile-first with desktop for Home + Household, and with Home +
Profile proven in **English, Spanish, and Chinese**.

## About the Design Files
The files in this bundle are **design references created in HTML/React (via in-browser
Babel)** — prototypes that show the intended look, layout, copy, and behavior. They are
**not production code to copy directly**.

The task is to **recreate these designs in the target codebase's existing environment**
(React, Vue, SwiftUI, native, etc.), using its established components, tokens, routing,
i18n, and data layer. If no environment exists yet, choose the most appropriate stack
for a privacy-sensitive, internationalized, offline-tolerant app and implement there.

The HTML uses static placeholder data and is **non-interactive** (static frames). Wiring
state, navigation, and data fetching is part of the implementation work; this README
describes the intended interactions so you can build them.

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, radii, and component anatomy are
final and intended to be matched closely. Recreate the UI faithfully using your
codebase's libraries. The two Home "directions" (layout B, warm/serif style) are
**alternatives for the team to choose between**, not all three to ship — see
"Open design decisions."

---

## Design Tokens

### Color
| Token | Hex | Use |
|---|---|---|
| `--blue` | `#0068A8` | Primary actions, "Members" visibility, trust |
| `--blue-700` | `#00568C` | Primary hover / pressed, links |
| `--blue-800` | `#063F63` | Text on blue tint |
| `--blue-tint` | `#E6F1F9` | Members chip bg, info surfaces |
| `--blue-tint-2` | `#D2E6F4` | Members chip border |
| `--orange` | `#FAAB1C` | "Shared" visibility, active/neighbor accents, masquerade banner |
| `--orange-700` | `#CF7E00` | Orange icon/text on tint, "shown as neighbor" toggle |
| `--orange-ink` | `#8A5500` | Text on orange tint (AA contrast) |
| `--orange-tint` | `#FDF0D8` | Shared chip bg, neighbor opt-in surface |
| `--orange-tint-2` | `#FBE4B8` | Shared chip border |
| `--ink` | `#19232E` | Primary text |
| `--ink-2` | `#56636F` | Secondary text |
| `--ink-3` | `#8693A0` | Tertiary text, captions, placeholders |
| `--line` | `#E7EAED` | Hairline dividers, card borders |
| `--line-2` | `#DDE2E6` | Stronger borders, inputs |
| `--paper` | `#FFFFFF` | Card / sheet surfaces |
| `--bg` | `#F3F5F7` | App background |
| `--bg-2` | `#EEF1F4` | Inset surfaces, segmented control track |
| `--slate-tint` | `#EEF1F4` | "Private" chip bg (neutral, deliberately un-alarming) |
| `--ok` | `#1F8A5B` | Connected / success |
| `--warn` | `#B5562F` | Errors |

**Avatar palette** (deterministic by name hash): `#0068A8 #2F8F6B #C4632A #7257B8
#B8456B #1F7A8C #A67C00 #4A6FB5 #8A5A2B #5A7A3A`. Initials are 1–2 letters, white text.

### Typography
- **UI family:** "Hanken Grotesk" (Google Fonts), weights 400/500/600/700/800.
- **CJK family:** "Noto Sans SC" (added to the font stack; Chinese frames also get
  `line-height: 1.65` and `letter-spacing: .01em` for comfort).
- **Serif (warm-style variation only):** "Source Serif 4", weights 400/600.
- **Mono (labels / hex / fine print):** "Spline Sans Mono".

| Role | Size | Weight | Letter-spacing | Line-height |
|---|---|---|---|---|
| H1 (screen title) | 25px | 700 | -0.5px | 1.14 |
| H2 (section / sheet title) | 19px | 700 | -0.3px | 1.2 |
| Eyebrow (section label) | 11.5px | 700 | 0.7px, UPPERCASE | — |
| Lead / body | 15px | 400 | — | 1.5 |
| Field label | 12px | 600 | 0.2px | — |
| Meta / caption | 12.5px | 400 | — | — |
| Contact value | 14.5px | 600 | — | — |
| Contact label (overline) | 11.5px | 600 | 0.3px, UPPERCASE | — |
| Visibility chip | 12px | 600 | — | 1 |

Minimum body text 12px; inputs use 16px to avoid iOS zoom-on-focus.

### Spacing, radius, shadow
- Card padding 16px; screen body padding 16px 16px 26px; gap between cards 14px.
- Radii: cards `16px` (`--r-card`), controls/buttons `11px` (`--r-ctrl`), small `8px`,
  pills/chips `999px`, sheets `20px 20px 0 0`.
- Shadows: card `0 1px 2px rgba(20,30,40,.05)`; raised `0 1px 3px rgba(20,30,40,.06),
  0 6px 18px rgba(20,30,40,.06)`; popover/sheet `0 -8px 40px rgba(20,30,40,.16)`.
- Tap targets ≥ 44px (buttons 46px tall; icon buttons 38px with generous hit area —
  bump to 44px in production).

### Accessibility
WCAG AA contrast throughout. Provide visible keyboard focus rings (inputs use
`box-shadow: 0 0 0 3px var(--blue-tint)` + `border-color: var(--blue)`). Honor
`prefers-reduced-motion`. The "Private" state is intentionally neutral slate (not red) so
privacy never reads as an error.

---

## The visibility affordance (design once, reuse everywhere)
A single compact **word + icon chip** represents the share state of every field, contact
item, and group-level datum. It is color-coded so state is glanceable, and it opens a
bottom sheet to change state and manage who is shared with.

| State | Chip | Icon | Meaning |
|---|---|---|---|
| **Members** | blue (`--blue-tint` bg, `--blue-800` text, `--blue-tint-2` border) | two-people | Anyone signed in to Eisenhower |
| **Private** | slate (`--slate-tint` bg, `--ink-2` text, `--line-2` border) | lock | Only you, until you share |
| **Shared** | orange (`--orange-tint` bg, `--orange-ink` text, `--orange-tint-2` border) | lock | Private **+ N** chosen People/Groups; chip reads "Shared · N" |

Chip anatomy: height 25px, radius 999px, 12px icon, optional down-caret (omit the caret
in read-only contexts). There is **no "public to the internet"** state anywhere.

**Expanded sheet** (`VisibilitySheet`): titled "Who can see your <field>?", three radio
`OptionRow`s (Members / Private / Shared). When **Shared** is selected, an orange-tinted
"Shared with · N" panel appears listing each grantee (Person avatar or Group icon) with a
remove (✕) affordance and an "Add people or groups" button that opens the member/group
picker. Confirm with a full-width primary "Done".

### Special-case rules
- **First name** — always visible to your groups. Rendered as a *fixed, explained* state
  (a non-interactive Members chip reading "Always visible" + an info line: "People need a
  name to recognize you. You choose everything else."). It is **not** a toggle.
- **Last name** — its own sub-control: a 3-way segmented control **Full / Initial / Hide**
  with a live "Shown as: Dana R." preview. (Default in mocks: Initial.)
- **Address** — the standard visibility chip **plus** a separate, independent
  **"Show me as a neighbor"** opt-in toggle (orange surface). One line explains it
  surfaces only your name and rough distance to nearby members, **never your actual
  address**. The two controls are independent: address visibility and neighbor opt-in are
  set separately.

---

## Core concepts the UI must make legible
- **User vs Person.** You sign in as a User but *act as* a Person (yourself, or a child).
  An **active-Person switcher** is always reachable (top of every primary screen) showing
  avatar + name + capability hints ("Parent · Teacher"). Switching changes whose profile
  and groups you manage. "Who am I acting as" must be unambiguous at all times.
- **Shared control.** A Person (child) can be controlled by multiple Users (both parents).
  The profile shows co-managers and an "Invite someone to help manage <Name>" action.
- **Capabilities.** A Person can be several things at once (Teacher *and* Parent). Tools
  surface by capability — Teachers get Classroom management; household admins get Household
  management — as first-class areas, not hidden behind a generic settings gear.
- **Groups / Households / Classrooms.** Households cascade shared contact info (e.g. one
  family address). Classrooms are run by Teachers. A Person belongs to many groups.
- **Visibility levels:** Members or Private (+ shared with specific People/Groups). No
  public level.

---

## Screens / Views

> Phone frames are designed at **360px** wide. Component CSS lives under a `.sd` scope.
> Each screen = a vertical flex column: a 30px status bar, optional global banner, an app
> bar or screen header, a scrolling body (`padding: 16px`), and (on Home) a bottom nav.

### Onboarding
1. **Sign in** — Brand lockup; H1 "Sign in to the directory"; lead "Enter your email and
   we'll send you a link. No password to remember."; one email input (16px, focus ring);
   primary "Email me a link" (mail icon, full width). Footer reassurance with lock icon:
   "Private to the Eisenhower community. Nothing here is public." No separate sign-up.
2. **Check your email** — 64px blue-tint mail badge; H1 "Check your email"; "We sent a
   sign-in link to <email>. It expires in 15 minutes."; secondary "Open email app";
   ghost "Resend link".
3. **Signing you in** — centered spinner (blue ring), "Signing you in…" + subtext; brand
   pinned near bottom. Brief post-magic-link state.
4. **Registration closed** — privacy-preserving. Neutral slate check badge; H1 "Thanks —
   check your email"; "If this email belongs to an Eisenhower member, a sign-in link is on
   its way."; info box: "For everyone's privacy, we don't confirm whether an account
   exists. New sign-ups are managed by the school office." Never reveals whether the email
   exists.
5. **Invitation** — "<Inviter> invited you" row; H1 "You've been invited to Eisenhower
   School Directory"; a card "You'll help manage" showing the Person (avatar, name,
   Student/Grade tags) and a note that you become a co-manager and the inviter keeps
   access; primary "Accept invitation"; ghost "Not now".

### Home (most important screen)
App bar = **active-Person switcher** (avatar + name + "Parent · Teacher" + down-caret) on
the left; trailing globe (language) and search icon buttons. Bottom nav: Home / Directory
/ Groups / You.

- **Populated:** **Neighbors** module — section label + "See all"; a 2-up grid of
  `NeighborCard`s (avatar, blue distance chip "~0.4 mi", name, "Member", Connect/Connected
  button). **Your groups** — `GroupTile`s for the Household (home icon, blue) and Classroom
  (school icon, orange). **Profile snapshot** — your avatar/name, a "Preview" button, a
  "What you share" row of three mini-stat chips (4 Members / 2 Private / 1 Shared), and the
  orange "Shown as a neighbor · On" row with toggle.
- **Cold start** (new user, no address, no groups): welcome H1; Neighbors replaced by a
  dashed **CTA card** "Add your address to see neighbors" ("We'll show nearby members and a
  rough distance — never your exact address." + "Add address"); a muted "You're not in any
  groups yet" card; a blue-tint "Finish your profile" card with a 2-of-5 progress bar and
  "Continue setup".

### Profile
- **View** (how a member sees this Person): a persistent dark "Previewing as a member /
  This is what other members see / Exit preview" banner; centered 84px avatar; name with
  last-name rule applied ("Dana R."); capability tags (Parent / Teacher). **Contact** card
  of `ContactRow`s, each with a **read-only** visibility chip (no caret). Address shows
  "Near Linden & 4th · ~1.1 mi" with sub "Exact address hidden" and a Shared·2 chip.
  **Groups** tiles. Footer primary "Share your info with Dana".
- **Edit:** header "Edit profile" with ✕ and a primary "Save". Photo uploader (avatar with
  upload badge + "Add photo"). **First name** field (fixed Members state, explained).
  **Last name** field with the Full/Initial/Hide segmented sub-control + live preview.
  **Contact** items: the Address card (value + Shared chip + the orange "Show me as a
  neighbor" opt-in toggle), then `ContactItemEdit` rows for Mobile (Members), Email
  (Members), Website (Private), each with an editable visibility chip; a dashed "Add
  contact item". **Who manages this profile**: you ("Owner") + "Invite someone to help
  manage Dana".
- **Visibility sheet:** see "The visibility affordance" above.

### Groups
- **Household** (`HouseholdScreen admin` / read-only): hero (home icon, name, "4 members",
  admin/"view only" tag; admin gets a "Manage" action). **Household contact** card —
  shared address ("Cascades to everyone in the household") + home phone, each with a
  visibility chip (caret only for admins). **Members** list (`MemberRow`: avatar, name with
  last-name rule, title like "Parent" / "Student · Grade 4", You/Admin tags; admins get a
  ⋯ overflow). Admin footer "Edit household info"; non-admin footer info note "<Admin>
  manages this household."
- **Classroom** (`ClassroomScreen teacher` / member): hero (school icon, orange, "Ms.
  Ruiz · Grade 4", "Room 12 · 23 students"). Roster of `MemberRow`s with titles
  (Teacher / Assistant / Student) and an overflow "+17 more students" row. Teacher footer
  actions "Manage members" + "Message all" and a "Set titles" action; member view is
  read-only with an info note and chevrons instead of overflow menus.

### Internationalization
Home and Profile are rendered in **English, Spanish, and Chinese** to prove the layout
stretches (Spanish ~30% longer; Chinese denser but looser line-height). All visible copy
flows from a strings object (`t`) — never bake text into fixed-width pills. A **Language**
bottom sheet (opened from the globe button) lists English / Español / 中文 (native +
English name, selected state) and notes "Changes the directory for you only."

### Desktop (Home + Household)
240px left sidebar (brand, nav: Home / Directory / Groups / Your profile, school footer).
Top bar: page title, a centered search field, globe, and a **prominent active-Person
switcher pill** at top-right. **Home**: full-width Neighbors row (4-up), then a 2-column
content + 320px profile-snapshot rail. **Household**: breadcrumb, a wide member card
(hero + roster with per-row "Set title" + overflow) and a 320px household-contact rail.

### Cross-cutting states
- **Offline / read-only:** a dark global banner "Offline — showing your saved copy ·
  Read-only"; the Save button goes inert; editable controls dim to ~0.5 opacity and are
  non-interactive; an inline note "You're offline, so the directory is read-only … Reconnect
  to make changes." Should feel intentional, not broken.
- **Masquerade (admin):** a persistent **orange** banner across the app — "Viewing as
  <User> — Return to admin" (shield icon). An inline note warns actions are recorded in the
  audit log. The banner must be unmistakable and always present while masquerading.
- **Empty states:** no neighbors, no address, no groups, empty classroom, empty audit log —
  use the dashed `CTACard` / muted-info patterns shown.
- **Loading:** cache-first — content appears instantly from cache then refreshes; avoid
  jarring spinners on cached views.

---

## Components to standardize (the small system)
Built in `ds.jsx` (atoms) and `parts.jsx` (composites). Recreate these as your first-class
components:
- **Avatar** — deterministic colored initials by name hash; supports uploaded image,
  size, optional ring, and `textColor` override.
- **Vis (visibility chip)** + **VisibilitySheet** (expanded share panel with grantee
  management).
- **ContactRow** (view) / **ContactItemEdit** (edit) — type icon, overline label, value,
  visibility chip.
- **SwitcherPill / AppBar** — active-Person switcher (collapsed pill) + app bar.
- **NeighborCard** — avatar, distance chip, name, connect action.
- **MemberRow** — avatar, name (last-name rule), optional title + tags, admin affordances.
- **CTACard** — dashed primary card for empty states.
- **GroupTile** — icon tile entry point to a group.
- **Banners** — `OfflineBanner` (dark), `MasqBanner` (orange).
- **Field / LastNameControl / SheetOver / OptionRow / Tag / Btn / Icon / StatusBar /
  BottomNav** — supporting pieces.

Icons are a simple 1.7px-stroke `currentColor` line set (see the `Icon` map in `ds.jsx`):
lock, members (two-people), pencil, eye, plus, check, chevrons, home, school, phone, mail,
link, pin, x, wifioff, shield, search, upload, globe, gear, users3, file, table, swap,
bolt, info, etc. Swap for your codebase's icon library, matching weight and metaphor.

## Interactions & Behavior (to implement — mocks are static)
- **Auth:** email → magic link → "check email" → click link → "signing in" → Home.
  Registration-closed and unknown-email responses are identical and never confirm existence.
- **Active-Person switcher:** opens an expanded sheet listing People you control (avatar,
  name, capability tags) + "add/claim a Person"; selecting one swaps the whole app context
  instantly.
- **Visibility chip:** tap → bottom sheet; changing to Shared reveals grantee management;
  the member/group picker supports search, shows who currently has access, and allows
  revoke.
- **Last name:** segmented control updates the live "Shown as" preview and every place the
  name renders.
- **Neighbor opt-in:** independent of address visibility; off by default for new users.
- **Offline:** app-wide read-only; editable controls disabled with a reconnect affordance.
- **Masquerade:** persistent banner; "Return to admin" exits; actions are audit-logged.
- **Language:** per-user; switches all strings + applies CJK line-height; leave room for
  ~30% text expansion — never truncate into fixed-width pills.

## State Management (suggested)
`currentUser`; `activePersonId` + list of controllable Persons (with capabilities);
per-field `visibility` = `{ level: 'members'|'private', sharedWith: [{type:'person'|'group',
id}] }`; `lastNameDisplay: 'full'|'initial'|'hide'`; `showAsNeighbor: boolean`; group
membership + per-group admin/teacher role; `isOffline`; `masqueradingAs`; `locale`.

## Not yet designed (out of scope for this board)
The **sharing picker flow** end-to-end (5.8) and the **admin console** (invite / CSV bulk
upload with column mapping + dry-run / registration on-off / audit-log table) are described
in the brief but only stubbed here. Flag these as follow-up design before implementation.

## Open design decisions (need a pick before building)
- **Home layout:** default Neighbors-grid (A) vs list-first with switcher hero (B).
- **Visual style:** primary calm-institutional (Hanken Grotesk, blue/orange) vs the
  warm/serif variation (Source Serif 4 headings, warmer paper). Ship one.

## Assets
- Fonts: Hanken Grotesk, Noto Sans SC, Source Serif 4, Spline Sans Mono (Google Fonts).
- No raster images — avatars are generated from initials; "photo upload" is a placeholder.
- Icons are inline SVG (replace with your icon system).

## Files
All under this folder. Open `School Directory.html` in a browser to view the full board.
- `School Directory.html` — entry point; loads React + Babel and the scripts below.
- `ds.jsx` — tokens (CSS variables), `Icon` set, atoms (Avatar, Vis, Btn, Tag).
- `parts.jsx` — composites (AppBar, ContactRow, MemberRow, NeighborCard, CTACard,
  GroupTile, banners, Field, SheetOver, OptionRow, StatusBar, Phone).
- `screens-onboarding.jsx` — Sign in, Check email, Signing in, Registration closed,
  Invitation, Brand.
- `screens-home.jsx` — Home populated + cold start, BottomNav, ProfileSnapshot, strings
  (`HOME_EN`).
- `screens-profile.jsx` — Profile view + edit, LastNameControl, VisibilitySheet, strings
  (`PROFILE_EN`).
- `screens-groups.jsx` — Household + Classroom (admin/teacher + read-only).
- `screens-i18n.jsx` — ES/ZH string dictionaries, CJK styling, LanguageSheet, LangWrap.
- `screens-desktop.jsx` — Desktop Home + Household.
- `screens-variations.jsx` — Home layout B, warm/serif style, Offline + Masquerade states.
- `board.jsx` — assembles the static board (sections + labeled frames).

> Note: the `.jsx` files are transpiled in-browser by Babel for the prototype. They are
> **reference**, not a build target — port the components into your framework rather than
> shipping these scripts.

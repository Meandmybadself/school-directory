// What a signed-in member sees when the boards are not for them.
//
// This screen is the reason `GET /pto/access` exists as a route of its own,
// outside the gate every other `/pto/*` route sits behind: without an answer,
// a member who is not on the board would get a spinner or a bare 403, and the
// honest thing to show is a sentence explaining what this part of the site is
// and how somebody ends up with access to it.
//
// It is the ONE screen in this bundle whose copy is translated. The boards
// themselves are authoring chrome for eight volunteers and stay English, like
// the calendar's and the newsletter's admin screens — but an ordinary member is
// exactly who reads this, and a family missing from something with no
// explanation is the confusing outcome, not the private one (invariant 21's
// reasoning about telling a Controller their Person is unlisted).
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { Icon } from "../components/Icon.js";
import { ScreenHeader } from "../components/parts.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { useAccess } from "../lib/access.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { useI18n } from "../i18n/index.js";

function Body() {
  const { t } = useI18n();
  const { access } = useAccess();
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "28px 20px 40px" }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: "var(--blue-tint)",
          color: "var(--blue)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 18,
        }}
      >
        <Icon name="lock" size={26} stroke={1.8} />
      </div>
      <h1 className="sd-h1">{t("ptoNoAccessTitle")}</h1>
      <p className="sd-lead" style={{ marginTop: 10 }}>
        {t("ptoNoAccessBody")}
      </p>
      <p className="sd-lead" style={{ marginTop: 10 }}>
        {t("ptoNoAccessNote")}
      </p>
      {/* Naming the group is a nicety, not a disclosure: `GET /groups` already
          serves every group's name to any authenticated member, which CLAUDE.md
          invariant 21 records as an accepted cost of not building group-level
          hiding. Absent when no group has been configured yet. */}
      {access?.groupName && (
        <p className="sd-meta" style={{ marginTop: 14 }}>
          {access.groupName}
        </p>
      )}
      <p style={{ marginTop: 22 }}>
        <a className="sd-link" href="/">
          {t("navPto")} →
        </a>
      </p>
    </div>
  );
}

export function NoAccess() {
  const { t } = useI18n();
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    // No <SiteFooter/> here: DesktopShell appends one itself as the last child
    // of `.sd-deskbody`, so that its `margin-top: auto` pins it to the bottom of
    // a short page. Adding a second renders the credit line twice — which is
    // exactly what this screen did, being the shortest page in the app and the
    // one where it showed.
    return (
      <DesktopShell active="boards" title={t("navPto")}>
        <Body />
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="boards" />}>
      <ScreenHeader title={t("navPto")} left="arrowleft" onLeft={() => (window.location.href = "/")} />
      <div className="sd-scroll">
        <Body />
        <SiteFooter />
      </div>
    </AppShell>
  );
}

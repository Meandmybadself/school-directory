// One frame for every screen: the desktop shell on a wide window, the mobile
// app bar + bottom nav otherwise. The sibling apps spell this branch out in each
// screen; here every screen has the same three parts, so it is written once.
//
// The footer is added on mobile only — DesktopShell appends its own as the last
// child of `.sd-deskbody`, and a second one would render the credit line twice
// (NoAccess.tsx in apps/pto records how that was found).
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell, BottomNav, type NavKey } from "./AppShell.js";
import { DesktopShell } from "./DesktopShell.js";
import { ScreenHeader } from "./parts.js";
import { SiteFooter } from "./SiteFooter.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";

export function Screen({
  active,
  title,
  back,
  children,
}: {
  active: NavKey;
  title: string;
  /** Where the app bar's back arrow goes. Omitted on a top-level screen, which
   *  shows the app's mark there instead. */
  back?: string;
  children: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();

  if (isDesktop) {
    return (
      <DesktopShell active={active} title={title}>
        {children}
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active={active} />}>
      <ScreenHeader
        title={title}
        left={back ? "arrowleft" : "box"}
        onLeft={() => {
          if (back) navigate(back);
        }}
      />
      <div className="sd-scroll" style={{ display: "flex", flexDirection: "column" }}>
        {children}
        <SiteFooter style={{ padding: "8px 16px 20px" }} />
      </div>
    </AppShell>
  );
}

// What a signed-in member sees when the staff screens are not for them.
//
// `GET /lostfound/access` sits outside the staff gate for exactly this screen:
// without an answer, a member who isn't staff would get a spinner or a bare 403,
// and the honest thing to show is a sentence explaining what this part is and
// that the rest of the site — browsing, claiming — is open to them anyway.
//
// Translated, unlike the staff screens: an ordinary parent is exactly who reads
// it (the reasoning apps/pto's NoAccess gives).
import { Link } from "react-router-dom";
import { Screen } from "../components/Screen.js";
import { Icon } from "../components/Icon.js";
import { useAccess } from "../lib/access.js";
import { useI18n } from "../i18n/index.js";

export function NoAccess() {
  const { t } = useI18n();
  const { access } = useAccess();
  return (
    <Screen active="staff" title={t("lfNavStaff")} back="/">
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
        <h1 className="sd-h1">{t("lfNoAccessTitle")}</h1>
        <p className="sd-lead" style={{ marginTop: 10 }}>{t("lfNoAccessBody")}</p>
        <p className="sd-lead" style={{ marginTop: 10 }}>{t("lfNoAccessNote")}</p>
        {/* Naming the group discloses nothing `GET /groups` doesn't already
            serve every member (invariant 21's accepted cost). */}
        {access?.groupName && (
          <p className="sd-meta" style={{ marginTop: 14 }}>{access.groupName}</p>
        )}
        <p style={{ marginTop: 22 }}>
          <Link className="sd-link" to="/">
            {t("lfBackToAll")} →
          </Link>
        </p>
      </div>
    </Screen>
  );
}

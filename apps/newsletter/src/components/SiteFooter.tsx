// The site credit line: who built this, and where to send feedback.
//
// Copied into each app rather than imported, like the rest of the design system
// (see CLAUDE.md) — the three are expected to drift. The copy itself is NOT
// copied: it comes from the shared i18n dictionaries, so all three say the same
// thing in all four languages.
import type { CSSProperties } from "react";
import { useI18n } from "../i18n/index.js";

/** Where feedback goes. Config rather than copy — an instance that isn't
 *  Eisenhower overrides it the way it overrides the school name, and the default
 *  keeps the deploy working without a new CI variable. */
const FEEDBACK_EMAIL = import.meta.env.VITE_FEEDBACK_EMAIL ?? "admin@eisenhower.school";

/** Sentinel interpolated in place of the address, then split on.
 *
 *  The address has to be a `mailto:` link, so the sentence can't simply be
 *  interpolated and printed. Splitting on a sentinel keeps the address wherever
 *  the TRANSLATOR put it rather than assuming every language ends the sentence
 *  with it the way English does — Somali puts a verb after it. A NUL can never
 *  occur in a dictionary string, so the split is unambiguous. */
const SLOT = "\u0000";

export function SiteFooter({ style }: { style?: CSSProperties }) {
  const { t } = useI18n();
  const [before = "", after = ""] = t("footerFeedback", { email: SLOT }).split(SLOT);
  return (
    <footer
      style={{
        marginTop: "auto",
        paddingTop: 18,
        textAlign: "center",
        fontSize: 12.5,
        lineHeight: 1.6,
        color: "var(--ink-3)",
        ...style,
      }}
    >
      <div>{t("footerBuiltBy")}</div>
      <div>
        {before}
        <a className="sd-link" href={`mailto:${FEEDBACK_EMAIL}`}>{FEEDBACK_EMAIL}</a>
        {after}
      </div>
    </footer>
  );
}

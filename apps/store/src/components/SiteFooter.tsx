// The site credit line: who built this, and where to send feedback.
//
// Copied into each app rather than imported, like the rest of the design system
// (see CLAUDE.md) — the three are expected to drift. The copy itself is NOT
// copied: it comes from the shared i18n dictionaries, so all three say the same
// thing in all four languages.
import type { CSSProperties } from "react";
import { PTO_URL, SOURCE_URL } from "@sd/shared";
import { useI18n } from "../i18n/index.js";

/** Where feedback goes. Config rather than copy — an instance that isn't
 *  Eisenhower overrides it the way it overrides the school name, and the default
 *  keeps the deploy working without a new CI variable. */
const FEEDBACK_EMAIL = import.meta.env.VITE_FEEDBACK_EMAIL ?? "admin@eisenhower.school";

/** The organisation's name, as it reads in the credit line. Interpolated into
 *  `footerBuiltBy` by the i18n provider everywhere else; named here because this
 *  is the one place it has to be wrapped in a link. */
const SCHOOL_NAME = import.meta.env.VITE_SCHOOL_NAME ?? "Eisenhower PTO";

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
  const [builtBefore = "", builtAfter = ""] = t("footerBuiltBy", { school: SLOT }).split(SLOT);
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
      {/* The credit line names the PTO and links to its site. `{school}` is
          split on the same sentinel the address below uses, so the link lands
          wherever the TRANSLATOR put the organisation's name rather than where
          English puts it. */}
      <div>
        {builtBefore}
        <a className="sd-link" href={PTO_URL}>{SCHOOL_NAME}</a>
        {builtAfter}
      </div>
      <div>
        {before}
        <a className="sd-link" href={`mailto:${FEEDBACK_EMAIL}`}>{FEEDBACK_EMAIL}</a>
        {after}
      </div>
      <div>
        <a className="sd-link" href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
          {t("footerSource")}
        </a>
      </div>
    </footer>
  );
}

// The site credit line: whose site this is, where to send feedback, where the
// code is. Three items, one line, the same three in all five apps and on all
// four server-rendered public surfaces.
//
// Copied into each app rather than imported, like the rest of the design system
// (see CLAUDE.md) — the copies are expected to drift. The COPY itself is not
// copied: it comes from the shared i18n dictionaries, so every app says the same
// thing in all four languages.
import type { CSSProperties } from "react";
import { PTO_URL, SOURCE_URL } from "@sd/shared";
import { useI18n } from "../i18n/index.js";

/** Where feedback goes. Config rather than copy — an instance that isn't
 *  Eisenhower overrides it the way it overrides the school name, and the default
 *  keeps the deploy working without a new CI variable. */
const FEEDBACK_EMAIL = import.meta.env.VITE_FEEDBACK_EMAIL ?? "admin@eisenhower.school";

/** The organisation's name. A proper noun, so it is configuration and not a
 *  dictionary string — it reads the same in all four languages, and it is the
 *  whole of the first item rather than a word inside a sentence. */
const SCHOOL_NAME = import.meta.env.VITE_SCHOOL_NAME ?? "Eisenhower PTO";

/** Sentinel interpolated in place of the address, then split on.
 *
 *  The address has to be a `mailto:` link, so the sentence can't simply be
 *  interpolated and printed. Splitting on a sentinel keeps the address wherever
 *  the TRANSLATOR put it rather than assuming every language ends the phrase
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
        lineHeight: 1.8,
        color: "var(--ink-3)",
        ...style,
      }}
    >
      {/* One line that wraps, rather than three stacked ones: at this size the
          three items read as a single credit, and on a phone they break onto
          two lines by themselves. */}
      <span>
        <a className="sd-link" href={PTO_URL}>{SCHOOL_NAME}</a>
        <span aria-hidden="true"> · </span>
        {before}
        <a className="sd-link" href={`mailto:${FEEDBACK_EMAIL}`}>{FEEDBACK_EMAIL}</a>
        {after}
        <span aria-hidden="true"> · </span>
        <a className="sd-link" href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
          {t("footerSource")}
        </a>
      </span>
    </footer>
  );
}

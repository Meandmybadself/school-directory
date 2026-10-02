// Last line of defence for the whole app.
//
// React unmounts the entire tree on an uncaught render error, so without this a
// single unexpected shape from the API — a field that went missing, a date that
// didn't parse — takes a member to a blank white page with no way back and
// nothing to report. That is a likelier failure here than it looks: the three
// apps COPY this design system rather than importing it (see CLAUDE.md), so
// their assumptions about a DTO drift apart by design.
//
// Two things make this file deliberately plain. It is a class, because catching
// a render error is the one thing hooks still cannot do. And it resolves its own
// copy from the shared dictionaries instead of calling useI18n(), because it
// sits OUTSIDE the providers — a boundary that depended on the context it is
// meant to protect would render nothing on the very failure that matters most.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { dictionaries, localeFromSearch, localeFromTag, type Locale, type Strings } from "@sd/shared";

const STORAGE_KEY = "sd_locale";

/** The same signal order as detectLocale in ../i18n, minus the context. Every
 *  read is guarded: localStorage throws outright in some privacy modes, and
 *  this code path only ever runs when something has already gone wrong. */
function boundaryStrings(): Strings {
  let locale: Locale = "en";
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    locale =
      localeFromSearch(window.location.search) ??
      (saved && saved in dictionaries ? saved : null) ??
      localeFromTag(navigator.language) ??
      "en";
  } catch {
    // Keep English.
  }
  return dictionaries[locale];
}

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Nothing ships errors anywhere yet, so the console is the whole report —
    // which is why the component stack goes in with it.
    console.error("[app] unhandled render error", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const t = boundaryStrings();
    return (
      <div
        className="sd"
        role="alert"
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--bg, #F4F6F8)",
        }}
      >
        <div style={{ maxWidth: 360, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px", color: "var(--ink, #1F2933)" }}>
            {t.appErrorTitle}
          </h1>
          <p style={{ fontSize: 14.5, lineHeight: 1.5, margin: "0 0 20px", color: "var(--ink-2, #56636F)" }}>
            {t.appErrorBody}
          </p>
          {/* A full reload, not a state reset: whatever produced the bad render
              is still in memory, and re-rendering it would just fail again. */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              font: "inherit",
              fontWeight: 600,
              cursor: "pointer",
              border: 0,
              borderRadius: 10,
              padding: "10px 20px",
              background: "var(--blue, #0068A8)",
              // Same literal-fallback idiom as the colours above: the token is
              // preferred so this follows the theme, and the literal keeps the
              // button legible if the stylesheet itself is what failed.
              color: "var(--on-brand, #fff)",
            }}
          >
            {t.appErrorReload}
          </button>
        </div>
      </div>
    );
  }
}

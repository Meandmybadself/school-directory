import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/tokens.css";
import "./styles/board.css";
import { App } from "./app.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { I18nProvider } from "./i18n/index.js";
import { SessionProvider } from "./lib/session.js";
import { AccessProvider } from "./lib/access.js";

const SCHOOL_NAME = import.meta.env.VITE_SCHOOL_NAME ?? "Eisenhower PTO";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Outside the providers on purpose: a throw from I18nProvider or
        SessionProvider is exactly the blank-page case worth catching, and this
        boundary resolves its own copy so it doesn't need either of them. */}
    <ErrorBoundary>
      <I18nProvider school={SCHOOL_NAME}>
        <SessionProvider>
          {/* Inside SessionProvider, because the PTO-board gate is a question
              about the signed-in account and has no answer before /me lands. */}
          <AccessProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </AccessProvider>
        </SessionProvider>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// No service worker here, deliberately — same reasoning as the calendar, the
// newsletter and the store. The directory caches for offline reading; a board
// two people are moving cards on must never render from a cache.

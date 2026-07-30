import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/tokens.css";
import "./styles/newsletter.css";
import { App } from "./app.js";
import { I18nProvider } from "./i18n/index.js";
import { SessionProvider } from "./lib/session.js";

const SCHOOL_NAME = import.meta.env.VITE_SCHOOL_NAME ?? "Eisenhower";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider school={SCHOOL_NAME}>
      <SessionProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SessionProvider>
    </I18nProvider>
  </StrictMode>,
);

// No service worker, for the same reason the calendar app has none: this is a
// thin always-online authoring surface, and a third SW registration on a sibling
// origin would only add a stale-content failure mode. The public archive pages
// aren't served by this bundle at all — they're Pages Functions.

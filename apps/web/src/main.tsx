import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/tokens.css";
import { App } from "./app.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { I18nProvider } from "./i18n/index.js";
import { SessionProvider } from "./lib/session.js";

const SCHOOL_NAME = import.meta.env.VITE_SCHOOL_NAME ?? "Eisenhower PTO";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Outside the providers on purpose: a throw from I18nProvider or
        SessionProvider is exactly the blank-page case worth catching, and this
        boundary resolves its own copy so it doesn't need either of them. */}
    <ErrorBoundary>
      <I18nProvider school={SCHOOL_NAME}>
        <SessionProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </SessionProvider>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// Register the service worker (production only; dev would interfere with Vite HMR).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

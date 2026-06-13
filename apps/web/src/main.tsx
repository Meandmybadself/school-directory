import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/tokens.css";
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

// Register the service worker (production only; dev would interfere with Vite HMR).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// Mobile chrome: which app-bar sheet (language / account) is open. Owned by
// AppShell so every mobile ScreenHeader can open the language and account
// sheets, and AppShell renders the sheets themselves.
//
// Kept deliberately free of any import from parts.tsx or Sheets.tsx: the sheets
// import SheetOver from parts, so if this module (which ScreenHeader in parts
// consumes) pulled them in, it would form a parts <-> Sheets import cycle. This
// holds only the state; AppShell wires the actual sheet components to it.
import { createContext, useContext, useState, type ReactNode } from "react";

export type ChromeSheet = "language" | "account";

interface ChromeApi {
  /** The sheet currently open, or null. Read by AppShell to render it. */
  sheet: ChromeSheet | null;
  /** Open a sheet — called from the ScreenHeader buttons. */
  open: (sheet: ChromeSheet) => void;
  /** Close whatever is open. */
  close: () => void;
}

const ChromeContext = createContext<ChromeApi | null>(null);

export function ChromeProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<ChromeSheet | null>(null);
  return (
    <ChromeContext.Provider value={{ sheet, open: setSheet, close: () => setSheet(null) }}>
      {children}
    </ChromeContext.Provider>
  );
}

/** Null when used outside a ChromeProvider (e.g. the desktop shell), so callers
 *  can render nothing rather than crash. */
export function useChrome(): ChromeApi | null {
  return useContext(ChromeContext);
}

// Session/me state. Loads /me once against the shared API; a 401 simply means
// "signed out". Unlike the directory app there's no active-Person switching here
// — the calendar is shared, not per-Person — so this only tracks the user.
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { MeDTO } from "@sd/shared";
import { api, ApiError } from "./api.js";

interface SessionValue {
  loading: boolean;
  me: MeDTO | null;
  isMasquerading: boolean;
  /** Display label for the signed-in user: their first Person, else their email. */
  displayName: string;
  refresh: () => Promise<void>;
  stopMasquerade: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeDTO | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe(null);
      else throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stopMasquerade = useCallback(async () => {
    await api.stopMasquerade();
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api.signout();
    setMe(null);
  }, []);

  const isMasquerading = !!me?.masqueradingAs;
  const displayName =
    me?.persons.find((p) => p.id === me.activePersonId)?.displayName ??
    me?.persons[0]?.displayName ??
    me?.user.email ??
    "";

  return (
    <SessionContext.Provider
      value={{ loading, me, isMasquerading, displayName, refresh, stopMasquerade, signOut }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

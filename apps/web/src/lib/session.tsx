// Session/me state. Loads /me once; exposes the active person + switching.
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { ControllablePersonDTO, MeDTO } from "@sd/shared";
import { api, ApiError } from "./api.js";

interface SessionValue {
  loading: boolean;
  me: MeDTO | null;
  activePerson: ControllablePersonDTO | null;
  isMasquerading: boolean;
  refresh: () => Promise<void>;
  switchPerson: (personId: string) => Promise<void>;
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

  const switchPerson = useCallback(
    async (personId: string) => {
      await api.setActivePerson(personId);
      await refresh();
    },
    [refresh],
  );

  const stopMasquerade = useCallback(async () => {
    await api.stopMasquerade();
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api.signout();
    setMe(null);
  }, []);

  const activePerson =
    me?.persons.find((p) => p.id === me.activePersonId) ?? me?.persons[0] ?? null;
  const isMasquerading = !!me?.masqueradingAs;

  return (
    <SessionContext.Provider value={{ loading, me, activePerson, isMasquerading, refresh, switchPerson, stopMasquerade, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

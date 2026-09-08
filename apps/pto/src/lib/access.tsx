// The second gate, resolved once and shared.
//
// This app has two of them and they are not the same question. `useSession`
// answers "is anyone signed in?" — the one every sibling app asks. This answers
// "is this account on the PTO board?", which is what actually decides whether
// there is anything here for them.
//
// It is a UI convenience and NOTHING MORE. Every `/pto/*` route re-resolves the
// same gate server-side through `ptoAccess` in apps/api/src/lib/ptoBoard.ts, so
// a client that lied about this — or one that simply held a stale copy after
// someone was removed from the roster — would get 403s rather than data. Never
// move a decision that matters onto this value.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { PtoAccessDTO } from "@sd/shared";
import { ApiError, api } from "./api.js";
import { useSession } from "./session.js";

interface AccessValue {
  loading: boolean;
  access: PtoAccessDTO | null;
  refresh: () => Promise<void>;
}

const AccessContext = createContext<AccessValue | null>(null);

export function AccessProvider({ children }: { children: ReactNode }) {
  const { loading: sessionLoading, me } = useSession();
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<PtoAccessDTO | null>(null);

  const refresh = useCallback(async () => {
    if (!me) {
      // Signed out is not "no access" — it is a different screen entirely, and
      // conflating them would show a member who is merely logged out the "ask a
      // board member" card instead of a sign-in form.
      setAccess(null);
      setLoading(false);
      return;
    }
    try {
      setAccess(await api.access());
    } catch (err) {
      // A 401 raced the session load; anything else is a real failure. Either
      // way the answer is "no", which routes to a screen that offers a way
      // forward rather than a stack trace.
      if (!(err instanceof ApiError)) throw err;
      setAccess({ canUse: false, isSystemAdmin: false, groupName: null, groupId: null });
    } finally {
      setLoading(false);
    }
  }, [me]);

  useEffect(() => {
    if (sessionLoading) return;
    setLoading(true);
    void refresh();
  }, [sessionLoading, refresh]);

  return (
    <AccessContext.Provider value={{ loading: sessionLoading || loading, access, refresh }}>
      {children}
    </AccessContext.Provider>
  );
}

export function useAccess(): AccessValue {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error("useAccess must be used within AccessProvider");
  return ctx;
}

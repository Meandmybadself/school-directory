// The second gate, resolved once and shared — the PTO app's lib/access.tsx,
// asked of the newsletter's editors group instead.
//
// `useSession` answers "is anyone signed in?", the question every sibling app
// asks. This answers "may this account author the newsletter?", which is what
// decides whether they land on the issue list or on their own preferences.
// Before the editors group existed that was `me.user.isSystemAdmin`; it is now
// a roster question (invariant 31), so it has to be asked of the API.
//
// It is a UI convenience and NOTHING MORE. Every `/newsletter/*` authoring route
// re-resolves the same gate server-side through `newsletterAccess` in
// apps/api/src/lib/newsletter.ts, so a client that lied about this — or one
// that simply held a stale copy after someone was removed from the roster —
// would get 403s rather than data. Never move a decision that matters onto
// this value.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { NewsletterAccessDTO } from "@sd/shared";
import { ApiError, api } from "./api.js";
import { useSession } from "./session.js";

interface AccessValue {
  loading: boolean;
  access: NewsletterAccessDTO | null;
  refresh: () => Promise<void>;
}

const AccessContext = createContext<AccessValue | null>(null);

export function AccessProvider({ children }: { children: ReactNode }) {
  const { loading: sessionLoading, me } = useSession();
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<NewsletterAccessDTO | null>(null);

  const refresh = useCallback(async () => {
    if (!me) {
      // Signed out is not "no access" — it is a different screen entirely.
      setAccess(null);
      setLoading(false);
      return;
    }
    try {
      setAccess(await api.access());
    } catch (err) {
      // A 401 raced the session load; anything else is a real failure. Either
      // way the answer is "no", which routes a member to the one screen that
      // is theirs rather than to a stack trace. A system admin is still an
      // admin — the session already says so, and the settings screen must not
      // vanish because one request failed.
      if (!(err instanceof ApiError)) throw err;
      setAccess({
        canUse: !!me.user.isSystemAdmin,
        isSystemAdmin: !!me.user.isSystemAdmin,
        groupName: null,
        groupId: null,
      });
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

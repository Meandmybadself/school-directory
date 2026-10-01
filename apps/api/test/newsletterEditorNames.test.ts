// "Edited … by Dana R." on the newsletter issue list (migration 0032).
//
// `editorNames` reads `person`, so it has to compose the enumeration gate
// (invariant 21). This fake EVALUATES that gate rather than matching its text:
// a predicate collapsed to the literal "1" names the unlisted editor here and
// fails, which the source scan in personListable.test.ts cannot see.

import { describe, expect, it } from "vitest";
import type { AuthContext, HonoEnv } from "../src/env.js";
import { editorNames } from "../src/lib/newsletter.js";

interface P {
  id: string;
  first_name: string;
  last_name: string;
  last_name_visibility: "full" | "initial";
  unlisted_at: string | null;
}

const PERSONS: P[] = [
  { id: "p_dana", first_name: "Dana", last_name: "Ruiz", last_name_visibility: "initial", unlisted_at: null },
  { id: "p_milo", first_name: "Milo", last_name: "Ruiz", last_name_visibility: "full", unlisted_at: null },
  { id: "p_sam", first_name: "Sam", last_name: "Okafor", last_name_visibility: "full", unlisted_at: "2099-01-01" },
];

// Dana's account controls her own Person first, then her child's.
const CONTROL = [
  { user_id: "u_dana", person_id: "p_dana", since: "2099-01-01" },
  { user_id: "u_dana", person_id: "p_milo", since: "2099-02-01" },
  { user_id: "u_sam", person_id: "p_sam", since: "2099-01-01" },
];

function env(): HonoEnv["Bindings"] {
  return {
    DB: {
      prepare(sql: string) {
        let binds: unknown[] = [];
        return {
          bind(...args: unknown[]) {
            binds = args;
            return this;
          },
          async all() {
            const viewer = binds[0] as string;
            const mine = new Set(CONTROL.filter((c) => c.user_id === viewer).map((c) => c.person_id));
            const ids = new Set(binds.slice(1).filter((b) => typeof b === "string" && b.startsWith("u_")));
            const gated = sql.includes("unlisted_at IS NULL OR");
            const results = [...CONTROL]
              .sort((a, b) => a.since.localeCompare(b.since))
              .filter((c) => ids.has(c.user_id))
              .map((c) => ({ c, p: PERSONS.find((p) => p.id === c.person_id)! }))
              .filter(({ p }) => !gated || p.unlisted_at === null || mine.has(p.id))
              .map(({ c, p }) => ({
                user_id: c.user_id,
                first_name: p.first_name,
                last_name: p.last_name,
                last_name_visibility: p.last_name_visibility,
                mine: mine.has(p.id) ? 1 : 0,
              }));
            return { results };
          },
        };
      },
    },
  } as unknown as HonoEnv["Bindings"];
}

function viewer(userId: string): AuthContext {
  return {
    userId,
    realUserId: userId,
    email: `${userId}@x.test`,
    isSystemAdmin: false,
    sessionId: "s",
    activePersonId: null,
    isMasquerading: false,
    isApproved: true,
  };
}

describe("editorNames", () => {
  it("names an account by its OLDEST controlled Person, with the surname rule applied", async () => {
    const names = await editorNames(env(), viewer("u_other"), ["u_dana"]);
    expect(names.get("u_dana")).toBe("Dana R.");
  });

  it("shows the full surname to the person's own controller", async () => {
    const names = await editorNames(env(), viewer("u_dana"), ["u_dana"]);
    expect(names.get("u_dana")).toBe("Dana Ruiz");
  });

  it("does not name an editor whose Person is unlisted", async () => {
    const names = await editorNames(env(), viewer("u_other"), ["u_sam"]);
    expect(names.has("u_sam")).toBe(false);
  });

  it("asks nothing for an empty or all-null list", async () => {
    const names = await editorNames({} as HonoEnv["Bindings"], viewer("u_other"), [null, null]);
    expect(names.size).toBe(0);
  });
});

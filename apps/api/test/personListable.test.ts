// The tripwire for invariant 21: no statement reads `person` without deciding,
// out loud, whether the enumeration gate applies to it.
//
// WHY THIS IS A SOURCE SCAN AND NOT A ROUTE TEST. `privacyRoutes.test.ts` pins
// the guard onto the listings we know about by CALLING them and reading back the
// SQL they built. That catches a regression in a route somebody already wrote a
// test for, and it is worth having — but it is blind to the eighth listing
// somebody adds next year, because nothing exercises it and nothing knows to.
// That blindness is the exact failure invariants 12, 13 and 18 were each written
// after. So this test doesn't ask "do the routes we listed behave?", it asks
// "does anything in the tree read `person` without an answer?", which needs no
// foreknowledge of what was added.
//
// WHAT IT ACTUALLY PROVES, honestly. It is a textual scan, so its ceiling is the
// same as `verifyAuditChain`'s (invariant 5): it does not stop the unguarded
// query, it stops the SILENT one. A view, a dynamically built table name, or a
// guard constructed nearby and then not interpolated would all slip past. The
// alternative — a query builder that makes the unguarded read unrepresentable —
// would have to wrap all six join shapes these call sites already use, and this
// codebase deliberately reaches for raw prepared statements (SDD: ORM-agnostic).
// Detection that needs no one to remember is the right ceiling here; if a ninth
// and tenth call site ever make this annoying rather than clarifying, that is
// the signal to revisit, not now.
//
// HOW TO SATISfy IT. Either compose `personListableSql` / `personSearchSql` into
// the statement, or write `// UNLISTED-EXEMPT: <reason>` next to it and say why
// the gate doesn't apply — an admin-gated route, or rows the viewer controls by
// construction. A whole file may carry `UNLISTED-EXEMPT-FILE: <reason>` near the
// top. Both are reviewed decisions; neither is a silence.

import { describe, expect, it } from "vitest";

// The sources are read through Vite, which is already running this file, rather
// than through `node:fs`. This package's tsconfig types the WORKERS runtime and
// nothing else, on purpose — pulling @types/node in so a test can read a
// directory would put Node's globals in front of `src`, which is the one place
// they must never be. So: one declared method, no new types, no config change.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      opts: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
}

/** Every API source file, as text, keyed by path. */
const SOURCES: Record<string, string> = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Every statement that READS the `person` table, however it joins it.
 *
 *  `DELETE FROM person` is excluded, and the exclusion is narrow on purpose: it
 *  is the only write spelling that matches this pattern at all (an UPDATE says
 *  `UPDATE person`, which never did). The reason is not that a delete is
 *  harmless — it is the most destructive statement in the codebase — but that
 *  this rule is the wrong instrument for it, and answering it here would have
 *  been a fake answer rather than a decision.
 *
 *  `personListableSql` decides VISIBILITY: may this viewer see that this Person
 *  exists. A delete returns no rows, so it cannot be the oracle invariant 18
 *  describes; what it needs guarding by is AUTHORITY — may this viewer act on
 *  this Person — which is `isController`'s job and is pinned by the route's own
 *  tests, not by a source scan. Composing the visibility predicate into a
 *  delete's WHERE would read as a guard while restating, more weakly and in a
 *  second place, something the route already established. Worse, in
 *  `DELETE /persons/:id` it would be actively wrong: that statement runs in a
 *  batch AFTER the `control` rows are gone, so `id IN (SELECT person_id FROM
 *  control …)` is false by then and an unlisted Person's row would survive the
 *  delete that was supposed to remove it. A guard that silently skips the write
 *  it decorates is worse than no guard, and this is exactly the "`1`-shaped
 *  predicate that reads like a gate and gates nothing" failure invariant 22
 *  warns about, arrived at from the other direction. */
const READS_PERSON = /(?<!DELETE )FROM person\b|JOIN person\b/g;

/** The guard, written into the SQL text itself.
 *
 *  Matches the COMPARISON, not the column. Bare `/unlisted_at/` would have been
 *  the obvious spelling and was the wrong one: a statement that merely SELECTs
 *  the column — for a row shape, or to render it — would have satisfied it while
 *  enumerating every unlisted Person to anyone. The identifier's presence is not
 *  evidence of a predicate. */
const GUARD_INLINE = /unlisted_at\s+IS\s+(NOT\s+)?NULL/;

/** The guard, interpolated as `${something.sql}` — every real call site builds
 *  the predicate into a local and drops it into the template. */
const INTERPOLATED = /\$\{(\w+)\.sql\}/g;

/** …and that local has to have come from the seam, not from anywhere. */
const buildsGuard = (name: string) =>
  new RegExp(`(const|let)\\s+${name}\\s*=\\s*(personListableSql|personSearchSql)\\(`);

/** The gate was considered and consciously declined, with a stated reason. */
const EXEMPT = /UNLISTED-EXEMPT:/;
const EXEMPT_FILE = /UNLISTED-EXEMPT-FILE:/;

/** The statement an occurrence belongs to: its enclosing `prepare(` call plus
 *  the comment lines written immediately above it, which is where an exemption
 *  goes. Falls back to a window around the occurrence when there is no
 *  `prepare(` — a raw string constant, say. */
function statementAround(src: string, at: number): string {
  const prepareAt = src.lastIndexOf("prepare(", at);
  let start = prepareAt >= 0 && at - prepareAt < 800 ? prepareAt : Math.max(0, at - 200);
  // Walk backwards over contiguous `//` lines so a comment above the statement
  // is part of it.
  let lineStart = src.lastIndexOf("\n", start) + 1;
  for (;;) {
    const prevEnd = lineStart - 1;
    if (prevEnd <= 0) break;
    const prevStart = src.lastIndexOf("\n", prevEnd - 1) + 1;
    if (!src.slice(prevStart, prevEnd).trim().startsWith("//")) break;
    lineStart = prevStart;
  }
  start = lineStart;
  const end = Math.min(src.length, at + 1200);
  return src.slice(start, end);
}

interface Site {
  file: string;
  line: number;
  guarded: boolean;
  exempt: boolean;
}

function scan(): Site[] {
  const sites: Site[] = [];
  for (const [path, src] of Object.entries(SOURCES)) {
    const rel = path.replace(/^\.\.\/src\//, "");
    if (EXEMPT_FILE.test(src)) continue;
    for (const m of src.matchAll(READS_PERSON)) {
      const at = m.index!;
      const statement = statementAround(src, at);
      // Trace the interpolation rather than scanning the neighbourhood: a file
      // that guards ONE listing correctly must not thereby vouch for a second
      // one that guards nothing. The predicate has to reach THIS statement.
      const interpolated = [...statement.matchAll(INTERPOLATED)].map((m) => m[1]!);
      sites.push({
        file: rel,
        line: src.slice(0, at).split("\n").length,
        guarded:
          GUARD_INLINE.test(statement) ||
          interpolated.some((name) => buildsGuard(name).test(src)),
        exempt: EXEMPT.test(statement),
      });
    }
  }
  return sites;
}

describe("invariant 21: no statement reads `person` without answering the gate", () => {
  const sites = scan();

  it("finds the statements at all — a scan that matches nothing proves nothing", () => {
    expect(sites.length).toBeGreaterThan(8);
  });

  it("every read of `person` is either guarded or explicitly exempt", () => {
    const undecided = sites
      .filter((s) => !s.guarded && !s.exempt)
      .map((s) => `${s.file}:${s.line}`);
    // If this fails, you added a statement that reads `person`. Compose
    // personListableSql (or personSearchSql, which is built on it) into its
    // WHERE — or, if the gate genuinely doesn't apply, write
    // `// UNLISTED-EXEMPT: <why>` beside it. See CLAUDE.md invariant 21.
    expect(undecided).toEqual([]);
  });

  it("keeps the exemptions few enough to stay reviewable", () => {
    // Not a budget for its own sake: exemptions are the part of this rule no
    // machine checks, so they are the part worth noticing when it grows.
    const exempt = sites.filter((s) => s.exempt && !s.guarded);
    expect(exempt.length).toBeLessThanOrEqual(8);
  });
});

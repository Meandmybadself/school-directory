// Group hierarchy closure. Groups form a forest via grp.parent_id (School →
// Grade/Faculty → Classroom). Membership ROLLS UP: a Person in a descendant is
// an effective member of every ancestor — for rosters (downward) and for
// group-targeted shares / co-membership (upward). Group cardinality is small for
// a single school, so we load the whole edge set once and close in memory; the
// graph functions below are pure and unit-tested.

import type { Env } from "../env.js";

/** parent_id by group id (null/absent = root). */
export type ParentMap = Map<string, string | null>;

/** Build child → parent and parent → children maps from edges. */
export function buildGraph(edges: { id: string; parentId: string | null }[]): {
  parentOf: ParentMap;
  childrenOf: Map<string, string[]>;
} {
  const parentOf: ParentMap = new Map();
  const childrenOf = new Map<string, string[]>();
  for (const e of edges) {
    parentOf.set(e.id, e.parentId ?? null);
    if (e.parentId) {
      const arr = childrenOf.get(e.parentId) ?? [];
      arr.push(e.id);
      childrenOf.set(e.parentId, arr);
    }
  }
  return { parentOf, childrenOf };
}

/** Ancestor ids of `id`, immediate-parent-first, excluding `id`. Cycle-safe. */
export function ancestors(parentOf: ParentMap, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = parentOf.get(id) ?? null;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return out;
}

/** `id` plus all of its descendants (the subtree). Cycle-safe. */
export function subtree(childrenOf: Map<string, string[]>, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const g = stack.pop()!;
    if (seen.has(g)) continue;
    seen.add(g);
    out.push(g);
    for (const child of childrenOf.get(g) ?? []) stack.push(child);
  }
  return out;
}

/** Effective groups for a Person given their DIRECT group ids: each direct group
 *  plus all of its ancestors. This is what privacy resolution treats as "the
 *  viewer's groups". */
export function effectiveGroups(parentOf: ParentMap, directIds: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const g of directIds) {
    if (out.has(g)) continue;
    out.add(g);
    for (const a of ancestors(parentOf, g)) out.add(a);
  }
  return out;
}

/** Would setting `child`'s parent to `newParent` create a cycle? True if they're
 *  the same node or `newParent` lives within `child`'s subtree. */
export function wouldCycle(childrenOf: Map<string, string[]>, child: string, newParent: string): boolean {
  if (child === newParent) return true;
  return subtree(childrenOf, child).includes(newParent);
}

// ── DB wrappers ─────────────────────────────────────────────────────────────

async function loadEdges(env: Env): Promise<{ id: string; parentId: string | null }[]> {
  const rows = await env.DB.prepare("SELECT id, parent_id FROM grp").all<{ id: string; parent_id: string | null }>();
  return rows.results.map((r) => ({ id: r.id, parentId: r.parent_id }));
}

export async function loadGroupGraph(env: Env) {
  return buildGraph(await loadEdges(env));
}

/** All group ids whose roster rolls UP into `groupId` (the group + descendants). */
export async function subtreeGroupIds(env: Env, groupId: string): Promise<string[]> {
  const { childrenOf } = await loadGroupGraph(env);
  return subtree(childrenOf, groupId);
}

/** Effective group ids a Person belongs to (direct memberships + ancestors). */
export async function effectiveGroupIdsForPerson(env: Env, personId: string): Promise<Set<string>> {
  const [direct, graph] = await Promise.all([
    env.DB.prepare("SELECT group_id FROM membership WHERE person_id = ?").bind(personId).all<{ group_id: string }>(),
    loadGroupGraph(env),
  ]);
  return effectiveGroups(graph.parentOf, direct.results.map((r) => r.group_id));
}

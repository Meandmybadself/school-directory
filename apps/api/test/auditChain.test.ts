// The audit chain: appending to it, and checking it.
//
// This test carries a real (if tiny) audit_log rather than a stub, because both
// behaviours under test are about what happens BETWEEN two statements — a stub
// that answers each statement in isolation cannot express either one. The store
// below enforces the one constraint that matters, `seq` being unique, and that
// is enough to reproduce the fork the old writer produced.

import { describe, expect, it } from "vitest";
import { writeAudit, verifyAuditChain, type AuditMeta } from "../src/lib/audit.js";
import type { Env } from "../src/env.js";

interface AuditRow {
  id: string;
  seq: number;
  actor_user_id: string | null;
  masquerading_as: string | null;
  action: string;
  entity_kind: string | null;
  entity_id: string | null;
  detail_json: string | null;
  ip: string | null;
  user_agent: string | null;
  prev_hash: string | null;
  row_hash: string | null;
  created_at: string;
}

const COLS: (keyof AuditRow)[] = [
  "id", "seq", "actor_user_id", "masquerading_as", "action", "entity_kind",
  "entity_id", "detail_json", "ip", "user_agent", "prev_hash", "row_hash", "created_at",
];

/** An audit_log that honours UNIQUE(seq) — the whole point of migration 0016.
 *  `onBeforeInsert` lets a test slip a competing append in between a writer's
 *  read and its insert, which is the race itself. */
function store(onBeforeInsert?: (rows: AuditRow[], seq: number) => void) {
  const rows: AuditRow[] = [];

  const env = {
    DB: {
      prepare(sql: string) {
        return {
          args: [] as unknown[],
          bind(...args: unknown[]) {
            this.args = args;
            return this;
          },
          async first() {
            // The tail read.
            const sorted = [...rows].sort((a, b) => b.seq - a.seq);
            return sorted[0] ? { seq: sorted[0].seq, row_hash: sorted[0].row_hash } : null;
          },
          async all() {
            const limit = Number(this.args[0] ?? rows.length);
            return { results: [...rows].sort((a, b) => a.seq - b.seq).slice(0, limit) };
          },
          async run() {
            if (!sql.includes("INSERT INTO audit_log")) return { meta: { changes: 0 } };
            const row = Object.fromEntries(COLS.map((c, i) => [c, this.args[i]])) as unknown as AuditRow;
            onBeforeInsert?.(rows, row.seq);
            // ON CONFLICT (seq) DO NOTHING.
            if (rows.some((r) => r.seq === row.seq)) return { meta: { changes: 0 } };
            rows.push(row);
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  } as unknown as Env;

  return { env, rows };
}

const META: AuditMeta = {
  actorUserId: "01ADMIN",
  masqueradingAs: null,
  ip: "203.0.113.9",
  userAgent: "vitest",
};

describe("appending", () => {
  it("chains each row to the one before it", async () => {
    const { env, rows } = store();
    await writeAudit(env, { action: "auth.signin", entityKind: "user", entityId: "01A" }, META);
    await writeAudit(env, { action: "auth.signout", entityKind: "user", entityId: "01A" }, META);

    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(rows[0]!.prev_hash).toBe("");
    expect(rows[1]!.prev_hash).toBe(rows[0]!.row_hash);
    expect(await verifyAuditChain(env)).toMatchObject({ ok: true, checked: 2 });
  });

  it("retries onto the winner when another append takes the position first", async () => {
    // Fire once: the store plants a competing row at the seq this writer claimed,
    // between its read and its insert. That is exactly the interleaving the old
    // read-then-write allowed, and it used to produce two rows sharing a parent.
    let planted = false;
    const { env, rows } = store((rs, seq) => {
      if (planted) return;
      planted = true;
      rs.push({
        id: "01OTHER", seq,
        actor_user_id: "01SOMEONE", masquerading_as: null,
        action: "admin.action", entity_kind: null, entity_id: null,
        detail_json: null, ip: null, user_agent: null,
        prev_hash: "", row_hash: "beefbeef", created_at: "2026-01-01T00:00:00.000Z",
      });
    });

    await writeAudit(env, { action: "auth.signin", entityKind: "user", entityId: "01A" }, META);

    expect(rows).toHaveLength(2);
    const mine = rows.find((r) => r.id !== "01OTHER")!;
    // It moved to the next position and chained onto the row that beat it,
    // instead of claiming the same parent and forking the chain.
    expect(mine.seq).toBe(2);
    expect(mine.prev_hash).toBe("beefbeef");
    // No two rows share a position — the property the fork violated.
    expect(new Set(rows.map((r) => r.seq)).size).toBe(rows.length);
  });

  it("keeps one chain under a burst of concurrent appends", async () => {
    const { env, rows } = store();
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        writeAudit(env, { action: "admin.action", entityKind: "user", entityId: `01U${i}` }, META),
      ),
    );
    expect(rows).toHaveLength(12);
    expect([...rows].map((r) => r.seq).sort((a, b) => a - b)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]);
    expect(await verifyAuditChain(env)).toMatchObject({ ok: true, checked: 12 });
  });
});

describe("verifying", () => {
  async function seeded() {
    const s = store();
    for (const id of ["01A", "01B", "01C"]) {
      await writeAudit(s.env, { action: "person.updated", entityKind: "person", entityId: id }, META);
    }
    return s;
  }

  it("passes a chain nobody touched", async () => {
    const { env } = await seeded();
    expect(await verifyAuditChain(env)).toEqual({ ok: true, checked: 3, breaks: [] });
  });

  it("catches a row whose contents were edited after the fact", async () => {
    const { env, rows } = await seeded();
    rows[1]!.entity_id = "01SOMEONE_ELSE";
    const res = await verifyAuditChain(env);
    expect(res.ok).toBe(false);
    // Exactly one break, at the edited row: the walk continues from what's
    // STORED, so an edit doesn't cascade into every row after it.
    expect(res.breaks).toHaveLength(1);
    expect(res.breaks[0]).toMatchObject({ seq: 2, kind: "hash" });
  });

  it("catches a row that was deleted out of the middle", async () => {
    const { env, rows } = await seeded();
    rows.splice(1, 1);
    const res = await verifyAuditChain(env);
    expect(res.ok).toBe(false);
    expect(res.breaks.map((b) => b.kind).sort()).toEqual(["gap", "link"]);
  });

  it("catches a re-pointed parent even when the row itself still hashes", async () => {
    const { env, rows } = await seeded();
    // Rewrite prev_hash AND row_hash consistently — the row hashes fine on its
    // own. Only the link to the previous row gives it away, which is what
    // chaining buys over per-row hashing.
    const { sha256 } = await import("../src/lib/crypto.js");
    const r = rows[2]!;
    r.prev_hash = "0".repeat(64);
    r.row_hash = await sha256(
      [r.prev_hash, r.id, r.actor_user_id ?? "", "", r.action, r.entity_kind ?? "",
       r.entity_id ?? "", r.detail_json ?? "", r.created_at].join("|"),
    );
    const res = await verifyAuditChain(env);
    expect(res.ok).toBe(false);
    expect(res.breaks).toEqual([expect.objectContaining({ seq: 3, kind: "link" })]);
  });
});

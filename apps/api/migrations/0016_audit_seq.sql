-- Give the audit chain a serialisable position.
--
-- writeAudit used to read the newest row_hash and then insert a successor
-- chained to it, with nothing between the two statements. D1 has no transaction
-- around a read-then-write, and the audit flush runs inside waitUntil, so two
-- requests finishing together both read row N and both wrote a successor
-- claiming N as their parent. The chain became a tree, and a verifier walking it
-- would report tampering on an untampered log — which is the one thing a
-- tamper-evident log must never do.
--
-- `seq` plus a UNIQUE index turns the append into a compare-and-swap: a writer
-- claims the next position, and a loser is rejected by the index rather than
-- silently forking. See lib/audit.ts.
--
-- Backfill uses rowid, which is SQLite's insertion order — the true order these
-- rows were appended in, and closer to the truth than the ULID order the old
-- chain assumed. Rows written before this migration may therefore still fail
-- verification: that is history being honest about having been unverifiable,
-- not a new fault.

ALTER TABLE audit_log ADD COLUMN seq INTEGER;

UPDATE audit_log SET seq = rowid WHERE seq IS NULL;

CREATE UNIQUE INDEX idx_audit_seq ON audit_log (seq);

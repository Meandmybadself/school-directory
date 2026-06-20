-- 0005_group_hierarchy.sql — optional parent pointer on groups, forming a tree
-- (e.g. School → Grades / Faculty → Classrooms). Membership rolls up: a person
-- in a descendant group is an effective member of all ancestor groups, both for
-- rosters and for group-targeted shares. Households never participate (parent_id
-- stays NULL and they are never a parent). Closure is computed in the app layer
-- (group cardinality is small for a single school); this column is the source.
ALTER TABLE grp ADD COLUMN parent_id TEXT REFERENCES grp(id);
CREATE INDEX idx_grp_parent ON grp (parent_id);

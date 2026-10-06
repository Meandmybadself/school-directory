-- 0035_lf_suggested_rotation.sql — the vision model's guess at how far a
-- lost & found photo needs turning to stand upright.
--
-- A photo taken flat on a table has no "up" for the phone to record, so items
-- arrive sideways. The model already looks at every photo; it now also says
-- how many degrees CLOCKWISE would right it. It is a SUGGESTION, not an edit:
-- a Worker has no canvas, and a model can be wrong about which way is up, so
-- staff see it and turn the photo with one tap (the browser re-encodes it and
-- sends it back through PUT /lostfound/items/:id/photo, which resets this to 0).
-- Staff-only, like everything else about the photo's handling — it never
-- enters `publicItemOf`.
ALTER TABLE lf_item ADD COLUMN suggested_rotation INTEGER NOT NULL DEFAULT 0
  CHECK (suggested_rotation IN (0, 90, 180, 270));

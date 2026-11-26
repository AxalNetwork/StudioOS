-- D5585 part 15 (#5585): a render approval states the most it authorizes a render to spend.
--
-- A `render` decision of `approve` on a release manifest authorizes #5586's swarm admission to admit a video render or
-- brand image built on a pinned piece, before it spends (D5585-p15). `render_ceiling_microusd` is that limit in
-- micro-USD. Only a render approval carries one, and every render approval must, so a trigger enforces the pairing
-- on insert. A CHECK on an added column cannot read the other columns of an existing table without a rebuild.
--
-- Additive: one nullable column and one trigger. No row is written or changed. The table stays append-only through
-- its existing triggers. Rollback reverts the Worker; the column stays and is read by nothing.

ALTER TABLE work_graph_release_decisions ADD COLUMN render_ceiling_microusd INTEGER
  CHECK (render_ceiling_microusd IS NULL OR render_ceiling_microusd > 0);

CREATE TRIGGER IF NOT EXISTS work_graph_release_decisions_render_ceiling
BEFORE INSERT ON work_graph_release_decisions
WHEN (NEW.purpose = 'render' AND NEW.decision = 'approve') <> (NEW.render_ceiling_microusd IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_decisions.render_ceiling_microusd: a render approval, and only a render approval, carries a ceiling (D5585-p15).');
END;

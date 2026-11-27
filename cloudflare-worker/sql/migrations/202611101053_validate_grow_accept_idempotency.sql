-- D5352 (#5352) — the proposal id is the retry key for the remaining
-- target-writing Validate/Grow accept paths.

ALTER TABLE demand_signals ADD COLUMN source_proposal_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_demand_signals_source_proposal
  ON demand_signals (source_proposal_id) WHERE source_proposal_id IS NOT NULL;

ALTER TABLE product_feedback ADD COLUMN theme_source_proposal_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_feedback_theme_source_proposal
  ON product_feedback (theme_source_proposal_id) WHERE theme_source_proposal_id IS NOT NULL;

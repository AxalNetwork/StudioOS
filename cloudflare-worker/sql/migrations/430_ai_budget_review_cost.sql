-- D640: retain the provider's recorded cost on an over-budget review hold.
-- The value is informational; settlement may charge no more than the hold.
ALTER TABLE ai_budget_reservations ADD COLUMN recorded_cost_microusd INTEGER
  CHECK(recorded_cost_microusd IS NULL OR
    (typeof(recorded_cost_microusd)='integer' AND recorded_cost_microusd BETWEEN 0 AND 9007199254740991));
CREATE INDEX IF NOT EXISTS idx_ai_reservations_review_created
  ON ai_budget_reservations(status,created_at);

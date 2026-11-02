-- 694 · D1442 (#3991): the Ask panel's "N waiting" reads a member's rail
-- proposals by page (`GET /api/ai/rail/proposals?page=`), newest first.
-- Additive and idempotent: an index only, no data is touched.
CREATE INDEX IF NOT EXISTS idx_ai_rail_proposals_user_page
  ON ai_rail_proposals (user_id, rail_page, status, id DESC);

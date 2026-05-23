-- Task #6 — Track share-link conversion funnel: which views became a
-- network signup, a customer-discovery feedback submission, or a
-- signed deal document. All additive, `IF NOT EXISTS` so it's safe to
-- re-run; the worker also lazy-bootstraps via ensureDeckShareConversionSchema().

CREATE TABLE IF NOT EXISTS deck_share_conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  view_id INTEGER,
  share_token_id INTEGER,
  deck_id INTEGER NOT NULL,
  project_id INTEGER,
  user_id INTEGER,
  -- 'signup' | 'nda_signed' | 'feedback' | 'deal_pack_opened' | 'deal_signed'
  type TEXT NOT NULL,
  -- free-form pointer (envelope id / feedback id / document id / signup user_id)
  ref_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deck_share_conv_view ON deck_share_conversions(view_id);
CREATE INDEX IF NOT EXISTS idx_deck_share_conv_deck ON deck_share_conversions(deck_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deck_share_conv_user ON deck_share_conversions(user_id);

CREATE TABLE IF NOT EXISTS deck_share_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  view_id INTEGER,
  deck_id INTEGER NOT NULL,
  project_id INTEGER,
  user_id INTEGER,
  -- JSON map of slide_index → 'like'|'confusing'|'want_more'
  slide_reactions TEXT,
  overall_note TEXT,
  problem_fit TEXT,        -- 'strong' | 'mild' | 'none'
  willingness_to_pay TEXT, -- free-form (e.g. "$200/seat/mo")
  contact TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deck_share_fb_deck ON deck_share_feedback(deck_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deck_share_fb_user ON deck_share_feedback(user_id);

-- D1568 (#3815, deck v2 D7): follow-up signals from views.
--
-- raise_prospect_signals: what an investor's reading of their own deck link
--   told the founder, one row per signal. Written by the share heartbeat
--   (`services/raiseSignals.ts`), never by the founder:
--     first_view   the link's first view that was read;
--     revisit      a view that opened 48 hours or more after the link's
--                  previous view;
--     reached_ask  a view that read the version's ask card or a card after it.
--   A link has at most one first_view and one reached_ask; a view has at most
--   one revisit. Each signal names the follow-up it left: an `after_view`
--   email draft (`mail_drafts`, D1341) and, when the prospect's stage is
--   behind, a stage proposal the founder must Accept (`ai_rail_proposals`).
--   The row holds no read seconds and no figure.
--
-- Gone with its venture, its prospect, its link or its view (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS raise_prospect_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prospect_id INTEGER NOT NULL REFERENCES raise_prospects(id) ON DELETE CASCADE,
  share_token_id INTEGER NOT NULL REFERENCES pitch_deck_share_tokens(id) ON DELETE CASCADE,
  deck_id INTEGER NOT NULL REFERENCES pitch_decks(id) ON DELETE CASCADE,
  view_id INTEGER NOT NULL REFERENCES deck_share_views(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('first_view', 'revisit', 'reached_ask')),
  occurred_at TEXT NOT NULL,
  draft_uid TEXT,
  proposal_uid TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS raise_prospect_signals_once_per_link
  ON raise_prospect_signals (share_token_id, kind) WHERE kind IN ('first_view', 'reached_ask');
CREATE UNIQUE INDEX IF NOT EXISTS raise_prospect_signals_once_per_view
  ON raise_prospect_signals (view_id, kind);
CREATE INDEX IF NOT EXISTS idx_raise_prospect_signals_prospect
  ON raise_prospect_signals (prospect_id, occurred_at);

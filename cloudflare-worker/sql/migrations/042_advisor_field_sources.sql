-- Task #3 (AS) — Advisor write-router auto-fill expansion.
--
-- New `field_sources` audit table records every page-field value
-- the Personal Advisor wrote (or that the user then overwrote
-- manually), so a per-page <AdvisorFilledBanner> can attribute the
-- value back to the chat turn and the page can render sparkle
-- icons next to advisor-filled fields.
--
-- Plus column additions on the persona-bound profile tables so the
-- existing question banks can land *every* answer somewhere
-- canonical, instead of returning `noop` for half of the bank:
--   - mentors           ← mentor.topics.{willing,unwilling}, mentor.calendar.weekly_hours
--   - investor_profiles ← investor.{pipeline.deal_volume, coinvest.preferences, watchlist.seed_companies}
--   - partner_profiles  ← partner.{services.offered, dealflow.channels, conflicts.list, profile.focus}
--   - projects          ← founder.{financials.*, pipeline.top_deals, capital.raise_*,
--                                  captable.{entity,ownership}, compliance.status,
--                                  mentors.needs, team.cofounders}
--
-- Per repo convention every CREATE is `IF NOT EXISTS` and every
-- ALTER is unconditional (D1 stops the file on duplicate-column;
-- the writeRouter has lazy PRAGMA fallbacks for self-healing dev).

CREATE TABLE IF NOT EXISTS field_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  page_target TEXT,
  saved_to_table TEXT,
  saved_to_column TEXT,
  saved_to_id TEXT,
  -- 'advisor' | 'manual' | 'import'
  source TEXT NOT NULL DEFAULT 'advisor',
  -- Optional citation/justification supplied by the LLM tool call;
  -- enforced for high-risk fields (raise_target_usd, runway_months,
  -- monthly_burn_usd, mrr_usd) when requires_evidence is set on the
  -- bank question.
  evidence_text TEXT,
  filled_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_field_sources_user_page ON field_sources(user_id, page_target);

-- Mentor topics + calendar capacity ----------------------------------------
ALTER TABLE mentors ADD COLUMN topics_willing_json TEXT;
ALTER TABLE mentors ADD COLUMN topics_unwilling_json TEXT;
ALTER TABLE mentors ADD COLUMN weekly_hours_band TEXT;

-- Investor pipeline / coinvest / seed-watchlist ----------------------------
ALTER TABLE investor_profiles ADD COLUMN deal_volume_band TEXT;
ALTER TABLE investor_profiles ADD COLUMN coinvest_pref_text TEXT;
ALTER TABLE investor_profiles ADD COLUMN watchlist_seed_text TEXT;

-- Partner advisor-bank columns ---------------------------------------------
ALTER TABLE partner_profiles ADD COLUMN services_offered TEXT;
ALTER TABLE partner_profiles ADD COLUMN dealflow_channels TEXT;
ALTER TABLE partner_profiles ADD COLUMN conflicts_text TEXT;
ALTER TABLE partner_profiles ADD COLUMN focus_text TEXT;

-- Founder existing-bank columns on projects --------------------------------
-- runway / burn / MRR are surfaced on /build/financials and /build/metrics.
ALTER TABLE projects ADD COLUMN runway_months INTEGER;
ALTER TABLE projects ADD COLUMN monthly_burn_usd REAL;
ALTER TABLE projects ADD COLUMN mrr_usd REAL;
-- Active raise flag + target are surfaced on /capital/fundraise.
ALTER TABLE projects ADD COLUMN raise_active TEXT;       -- 'Yes'|'No'|'Soon'
ALTER TABLE projects ADD COLUMN raise_target_usd REAL;
-- Cap-table free text + entity label (kept distinct from users.entity_type
-- which is the cross-project identity setting).
ALTER TABLE projects ADD COLUMN entity_label TEXT;
-- Free-form fields that don't have a canonical column yet
-- (compliance.status, captable.ownership, mentors.needs,
-- team.cofounders, pipeline.top_deals). Stored as a JSON object
-- keyed by question_id so we never need a new migration per future
-- bank addition.
ALTER TABLE projects ADD COLUMN advisor_extras_json TEXT;

-- Cross-project advisor extras (partner.profile.focus, etc.) ---------------
ALTER TABLE users ADD COLUMN advisor_extras_json TEXT;

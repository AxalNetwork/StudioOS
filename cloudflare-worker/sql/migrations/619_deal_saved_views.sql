-- D1239 (#3252): private/firm deal-flow settings, never a grant to a deal.
CREATE TABLE IF NOT EXISTS deal_saved_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  firm_owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES company_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  shared_with_firm INTEGER NOT NULL DEFAULT 0 CHECK(shared_with_firm IN (0,1)),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
  spec_json TEXT NOT NULL CHECK(json_valid(spec_json) AND json_type(spec_json) = 'object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  mutation_uid TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deal_views_scope ON deal_saved_views(firm_owner_user_id,company_id,owner_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_view_default_company
  ON deal_saved_views(owner_user_id,firm_owner_user_id,company_id) WHERE is_default = 1 AND company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_view_default_unbound
  ON deal_saved_views(owner_user_id,firm_owner_user_id) WHERE is_default = 1 AND company_id IS NULL;

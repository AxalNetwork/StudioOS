-- D5024 part 2: commercial offers and immutable accepted composition, separate from grant entitlements.
CREATE TABLE licence_package_offers (
  uid TEXT PRIMARY KEY,
  licence_uid TEXT NOT NULL REFERENCES territory_licences(uid),
  package_uid TEXT NOT NULL REFERENCES program_packages(uid),
  package_key TEXT NOT NULL,
  package_version INTEGER NOT NULL CHECK (package_version > 0),
  package_name TEXT NOT NULL,
  pricing_recommendation_uid TEXT NOT NULL REFERENCES package_pricing_recommendations(uid),
  country_pricing_snapshot_uid TEXT NOT NULL,
  currency TEXT NOT NULL,
  recommended_annual_fee_cents INTEGER NOT NULL CHECK (typeof(recommended_annual_fee_cents) = 'integer' AND recommended_annual_fee_cents >= 0),
  accepted_annual_fee_cents INTEGER CHECK (accepted_annual_fee_cents IS NULL OR (typeof(accepted_annual_fee_cents) = 'integer' AND accepted_annual_fee_cents >= 0)),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','offered','accepted','declined','expired','superseded')),
  override_reason TEXT,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL CHECK (ends_on >= starts_on),
  expires_on TEXT,
  composition_json TEXT NOT NULL CHECK (json_valid(composition_json)),
  recommendation_json TEXT NOT NULL CHECK (json_valid(recommendation_json)),
  created_at TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  create_key TEXT NOT NULL,
  create_hash TEXT NOT NULL,
  decided_at TEXT,
  decided_by INTEGER,
  revision INTEGER NOT NULL DEFAULT 0,
  accept_key TEXT,
  accept_hash TEXT,
  acceptance_json TEXT CHECK (acceptance_json IS NULL OR json_valid(acceptance_json)),
  CHECK (state <> 'accepted' OR (accepted_annual_fee_cents IS NOT NULL AND decided_by IS NOT NULL AND acceptance_json IS NOT NULL)),
  CHECK (accepted_annual_fee_cents IS NULL OR accepted_annual_fee_cents = recommended_annual_fee_cents OR (override_reason IS NOT NULL AND length(trim(override_reason)) >= 10)),
  UNIQUE(created_by, create_key)
);
CREATE INDEX idx_package_offers_licence ON licence_package_offers(licence_uid, created_at, uid);
CREATE UNIQUE INDEX idx_package_offer_accept_key ON licence_package_offers(decided_by, accept_key) WHERE accept_key IS NOT NULL;

CREATE TABLE licence_package_items (
  offer_uid TEXT NOT NULL REFERENCES licence_package_offers(uid),
  program_key TEXT NOT NULL,
  package_uid TEXT NOT NULL,
  package_key TEXT NOT NULL,
  package_version INTEGER NOT NULL,
  position INTEGER NOT NULL,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  grant_uid TEXT NOT NULL REFERENCES program_grants(uid),
  grant_terms_revision INTEGER NOT NULL,
  grant_action TEXT NOT NULL CHECK (grant_action IN ('created','retained')),
  accepted_terms_json TEXT NOT NULL CHECK (json_valid(accepted_terms_json)),
  allocated_annual_fee_cents INTEGER CHECK (allocated_annual_fee_cents IS NULL OR allocated_annual_fee_cents >= 0),
  PRIMARY KEY(offer_uid, program_key)
);
CREATE INDEX idx_package_items_grant ON licence_package_items(grant_uid, offer_uid);

CREATE TABLE licence_package_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  offer_uid TEXT NOT NULL REFERENCES licence_package_offers(uid),
  licence_uid TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_user_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_package_events_offer ON licence_package_events(offer_uid, id);

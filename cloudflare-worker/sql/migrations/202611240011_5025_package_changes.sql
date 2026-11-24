-- D5025 part 2 (#5025): an HQ-scheduled package change. The owner's rule: an
-- accepted renewal, upgrade, downgrade or change takes effect at the next term
-- only, with no proration and no notice period. A row records HQ's decision to
-- move the licence from its current term to an offered next term; the offer is
-- accepted through D5024's route on or after effective_on. Applied and lapsed
-- are read from the offer's own state, so they are not stored here.
CREATE TABLE licence_package_changes (
  uid TEXT PRIMARY KEY,
  licence_uid TEXT NOT NULL REFERENCES territory_licences(uid),
  from_offer_uid TEXT NOT NULL REFERENCES licence_package_offers(uid),
  to_offer_uid TEXT NOT NULL REFERENCES licence_package_offers(uid),
  kind TEXT NOT NULL CHECK (kind IN ('renewal','upgrade','downgrade','change')),
  effective_on TEXT NOT NULL,
  old_annual_fee_cents INTEGER NOT NULL CHECK (typeof(old_annual_fee_cents) = 'integer' AND old_annual_fee_cents >= 0),
  new_annual_fee_cents INTEGER NOT NULL CHECK (typeof(new_annual_fee_cents) = 'integer' AND new_annual_fee_cents >= 0),
  old_currency TEXT NOT NULL,
  new_currency TEXT NOT NULL,
  financial_rule TEXT NOT NULL CHECK (financial_rule = 'next_term_no_proration'),
  state TEXT NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled','cancelled')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  created_at TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  schedule_key TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by INTEGER,
  cancel_reason TEXT,
  CHECK (from_offer_uid <> to_offer_uid),
  CHECK (state <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND length(trim(cancel_reason)) >= 10)),
  UNIQUE(created_by, schedule_key)
);
-- One live schedule per current term, and one per next-term offer.
CREATE UNIQUE INDEX idx_package_changes_from_live ON licence_package_changes(from_offer_uid) WHERE state = 'scheduled';
CREATE UNIQUE INDEX idx_package_changes_to_live ON licence_package_changes(to_offer_uid) WHERE state = 'scheduled';
CREATE INDEX idx_package_changes_licence ON licence_package_changes(licence_uid, effective_on, uid);

-- 634 — Partner invitations: per-invitation terms (D1118, #2998). Assigned to
-- #2998 by S21 for S1, 2026-10-26.
--
-- The owner answered A (#2998): the Super Admin sets an invitation's terms in
-- New invitation, and setting them is the approval. An Admin's invitation goes
-- with the standard terms. They apply to Deal-sourcing revenue share and
-- Custom only (PI4's "Adjust terms").
--
-- partner_invitations.terms_json — NULL means the standard terms. Otherwise a
--   JSON object written only by `routes/admin_partners.ts`:
--   {"revshare_bps": 1..5000, "attribution_window_days": 30..1095,
--    "term_months": 1..60, "note": text or null}. Basis points, so no
--   percentage is stored as a float.
-- partner_invitations.terms_set_by / terms_set_at — the Super Admin who set
--   them, and when. Both NULL with standard terms, both set with a value.
--
-- Grep first (D689 D-t): no `terms_json`, `terms_set_by` or `terms_set_at`
-- column exists on `partner_invitations` in an earlier migration or in
-- schema_baseline.sql. Nothing is backfilled: every existing invitation went
-- with the standard terms, which NULL says.

ALTER TABLE partner_invitations ADD COLUMN terms_json TEXT
  CHECK (terms_json IS NULL OR (json_valid(terms_json) AND json_type(terms_json) = 'object'));
ALTER TABLE partner_invitations ADD COLUMN terms_set_by INTEGER REFERENCES users(id);
ALTER TABLE partner_invitations ADD COLUMN terms_set_at TEXT;

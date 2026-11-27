-- 400_revenue_stripe_charge_index.sql — D587 (#1214): the Stripe charge sync.
--
-- `POST /api/revenue/projects/:projectId/entries/import-stripe` writes one
-- `revenue_entries` row per succeeded charge on the founder's own connected
-- Stripe account, with `source = 'stripe'`, `source_ref` the charge id and
-- `verification = 'verified'` (migration 311 reserved all three for it).
--
-- This index makes a charge land on a project's ledger once: a second import,
-- or two at the same time, insert nothing twice. It is partial, so manual and
-- CSV rows, whose `source_ref` is null, are untouched.
--
-- IDEMPOTENT: CREATE … IF NOT EXISTS. The worker's ensureRevenueEntriesSchema()
-- creates the same index on a cold isolate (D235).

CREATE UNIQUE INDEX IF NOT EXISTS uq_revenue_entries_stripe_charge
  ON revenue_entries(project_id, source_ref) WHERE source = 'stripe';

-- D4694 (#4694): a revision on every row HQ edits by reading a snapshot first,
-- so a write made from a stale snapshot is refused instead of replacing a
-- newer value.
--
--   territory_licences.terms_revision  Step 4's fee, shares, term and dates.
--       PATCH /api/admin/licences/:uid/terms and POST .../renew bump it.
--   licence_terms.revision             D797's terms schedule (one row per licence).
--       PUT /api/admin/licences/:uid/terms bumps it.
--   licence_fee_invoices.revision      D802's invoices. A payment or a void bumps it.
--
-- Each write is `UPDATE ... SET revision = revision + 1 WHERE ... AND revision = ?`
-- and the route reads the affected-row count: zero rows is a 409, never a
-- success. Existing rows start at 0, the revision a client reads before its
-- first edit. A licence with no schedule row yet reads revision 0 too.
--
-- ALTER TABLE ... ADD COLUMN has no IF NOT EXISTS in SQLite; the migration
-- ledger stops a replay, which is the deliberate choice here.

ALTER TABLE territory_licences ADD COLUMN terms_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE licence_terms ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE licence_fee_invoices ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

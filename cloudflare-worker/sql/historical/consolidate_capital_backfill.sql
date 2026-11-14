-- consolidate_capital_backfill.sql
--
-- Phase 3 of the capital-table consolidation. Pure data migration: copies
-- legacy `lp_investors` rows into the canonical `vc_funds` +
-- `limited_partners` tables and backfills `capital_calls.limited_partner_id`.
--
-- Fully idempotent — safe to run on every deploy. Each INSERT is guarded by
-- a NOT EXISTS subquery; the UPDATE is gated on `IS NULL`.

-- 1. Backfill vc_funds from any unique fund_name found in lp_investors.
INSERT INTO vc_funds (name, status, created_at, updated_at)
SELECT DISTINCT
    COALESCE(li.fund_name, 'Axal Fund I') AS fname,
    'active',
    datetime('now'),
    datetime('now')
FROM lp_investors li
WHERE NOT EXISTS (
    SELECT 1 FROM vc_funds f
    WHERE f.name = COALESCE(li.fund_name, 'Axal Fund I')
);

-- 2. Backfill limited_partners from lp_investors. Keyed on (email, fund_id);
--    duplicate guard relies on the uq_limited_partners_fund_email index.
INSERT INTO limited_partners (
    fund_id, user_id, name, email, commitment_amount, invested_amount, returns,
    status, created_at, updated_at
)
SELECT
    f.id AS fund_id,
    NULL AS user_id,
    li.name,
    li.email,
    COALESCE(li.committed_capital, 0),
    COALESCE(li.called_capital, 0),
    0,
    CASE WHEN li.status = 'active' THEN 'active' ELSE COALESCE(li.status, 'committed') END,
    COALESCE(li.created_at, datetime('now')),
    datetime('now')
FROM lp_investors li
JOIN vc_funds f ON f.name = COALESCE(li.fund_name, 'Axal Fund I')
WHERE NOT EXISTS (
    SELECT 1 FROM limited_partners lp
    WHERE lp.fund_id = f.id AND lp.email = li.email
);

-- 3. Recompute fund aggregates from the canonical limited_partners table.
UPDATE vc_funds
SET
    total_commitment = COALESCE(
        (SELECT SUM(commitment_amount) FROM limited_partners WHERE fund_id = vc_funds.id), 0
    ),
    deployed_capital = COALESCE(
        (SELECT SUM(invested_amount) FROM limited_partners WHERE fund_id = vc_funds.id), 0
    ),
    lp_count = COALESCE(
        (SELECT COUNT(*) FROM limited_partners WHERE fund_id = vc_funds.id), 0
    ),
    updated_at = datetime('now');

-- 4. Backfill capital_calls.limited_partner_id from the legacy lp_investor_id.
--    Mapping: lp_investors.email + lp_investors.fund_name -> limited_partners.id
UPDATE capital_calls
SET limited_partner_id = (
    SELECT lp.id FROM limited_partners lp
    JOIN vc_funds f ON f.id = lp.fund_id
    JOIN lp_investors li
      ON li.email = lp.email
     AND COALESCE(li.fund_name, 'Axal Fund I') = f.name
    WHERE li.id = capital_calls.lp_investor_id
    LIMIT 1
)
WHERE limited_partner_id IS NULL
  AND lp_investor_id IS NOT NULL;

/**
 * D4812 (#4812, part 8) — the fund the visual server seeds for
 * `fund_admin.a11y.spec.mjs`, so the Fund Admin pass scans rows, tables and
 * dialogs as the real routes answer them (`routes/fund_admin.ts` and the
 * stores it reads), with nothing stubbed by path.
 *
 * The shape is the D714 overview fixture's (`cloudflare-worker/test/
 * fund_admin_overview_d714.test.ts`), moved to the suite's pinned clock: one
 * fund with three LPs, a call whose first line is overdue and whose second is
 * part-received, an issued and a draft fee period, a prepared LP report pack,
 * one Mercury account with two credits, a proposed match and a match that
 * needs review. The viewer is HQ Security's Super Admin (9001,
 * `_security_seed.ts`). Every name, digit and reference is made up.
 */

const day = (now: number, n: number) => new Date(now + n * 86_400_000).toISOString().slice(0, 10);

export const FUND_ADMIN_FUND = { id: 4812, name: 'Synthetic Fund I' };

export function seedFundAdmin(db: any, now: number, superId: number) {
  const today = day(now, 0);
  const F = FUND_ADMIN_FUND.id;
  db.exec(`
INSERT INTO vc_funds (id, name, gp_user_id) VALUES (${F}, '${FUND_ADMIN_FUND.name}', NULL);
INSERT INTO limited_partners (id, fund_id, name, commitment_amount, invested_amount, status) VALUES
  (48120, ${F}, 'LP Alpha Partners', 1000000, 0, 'active'),
  (48121, ${F}, 'LP Beta Holdings with a fairly long registered name', 500000, 0, 'committed'),
  (48122, ${F}, 'LP Gamma', 250000, 0, 'active');
INSERT INTO fund_capital_calls (id, uid, fund_id, call_number, amount_cents, due_date, line_count, issued_by)
  VALUES (48120, 'fa-call-1', ${F}, 1, 6000000, '${day(now, -10)}', 2, ${superId});
INSERT INTO capital_calls (id, limited_partner_id, amount, amount_cents, status, due_date, fund_call_id) VALUES
  (481200, 48120, 40000, 4000000, 'pending', '${day(now, -10)}', 48120),
  (481201, 48121, 20000, 2000000, 'pending', '${day(now, 5)}', 48120);
INSERT INTO capital_call_receipts (uid, capital_call_id, limited_partner_id, fund_id, amount_cents, received_on, reference, source, recorded_by)
  VALUES ('fa-r-1', 481201, 48121, ${F}, 500000, '${today}', 'mercury:fa-txn-1', 'receipt', ${superId});
INSERT INTO fund_mgmt_fee_terms (id, uid, fund_id, fee_start_date, investment_period_end, effective_from, lpa_reference, status, recorded_by, confirmed_by, confirmed_at)
  VALUES (48120, 'fa-terms-1', ${F}, '2026-01-01', '2099-12-31', '2026-01-01', 'LPA §8.1 (synthetic)', 'confirmed', ${superId}, ${superId}, datetime('now'));
INSERT INTO fund_fee_periods (uid, fund_id, quarter, window_start, window_end, terms_id, status, digest, gross_cents, catch_up_cents,
    offset_pool_cents, offset_applied_cents, offset_carried_cents, net_cents, remittance_reference)
  VALUES ('fa-fp-1', ${F}, '2026Q2', '2026-04-01', '2026-06-30', 48120, 'issued', '${'a'.repeat(64)}', 500000, 0, 0, 0, 0, 500000, 'FEE-4812-2026Q2'),
         ('fa-fp-2', ${F}, '2026Q3', '2026-07-01', '2026-09-30', 48120, 'draft', '${'b'.repeat(64)}', 510000, 0, 0, 0, 0, 510000, 'FEE-4812-2026Q3');
INSERT INTO fund_report_drafts (uid, kind, audience, subject_key, fund_id, entity_key, period_label, period_start, period_end, status, figures_json, figures_sha256, built_by, prepared_by, prepared_at)
  VALUES ('fa-d-1', 'lp_quarterly_report', 'fund_lps', 'fund:${F}', ${F}, NULL, 'Q3 2026', '2026-07-01', '2026-09-30', 'prepared', '{}', '${'c'.repeat(64)}', ${superId}, ${superId}, datetime('now'));
INSERT INTO mercury_entity_connections (id, uid, entity_key, status, credentials_enc, token_preview, mercury_org_name, connected_by, last_synced_at)
  VALUES (48120, 'fa-conn-h', 'holdings', 'active', 'v1.synthetic-sealed', '…syn', 'Synthetic Holdings Org', ${superId}, datetime('now'));
INSERT INTO mercury_accounts (id, uid, mercury_account_id, connection_id, entity_key, kind, last_four, nickname, current_cents, available_cents, balance_read_at)
  VALUES (48120, 'fa-acct-h', 'merc-acct-synthetic-1', 48120, 'holdings', 'checking', '4417', 'Operating', 123450000, 120000000, datetime('now'));
INSERT INTO mercury_transactions (id, uid, mercury_transaction_id, account_id, amount_cents, created_on, posted_on, counterparty_name, memo)
  VALUES (48120, 'fa-txn-1', 'fa-txn-synthetic-1', 48120, 4000000, '${today}', '${today}', 'Synthetic Counterparty LLC', 'Synthetic memo'),
         (48121, 'fa-txn-2', 'fa-txn-synthetic-2', 48120, 510000, '${today}', '${today}', 'Synthetic Counterparty LLC', 'Synthetic memo');
INSERT INTO mercury_matches (uid, transaction_id, target_kind, target_id, state, origin, amount_cents) VALUES
  ('fa-m-1', 48120, 'capital_call_line', 481200, 'proposed', 'matcher', 4000000),
  ('fa-m-2', 48121, 'fee_period', (SELECT id FROM fund_fee_periods WHERE uid = 'fa-fp-2'), 'needs_review', 'matcher', 510000);
`);
  return FUND_ADMIN_FUND;
}

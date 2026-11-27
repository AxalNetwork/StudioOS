export const lpRow = { limited_partner_id: 4, fund_id: 7, fund_name: 'Example Fund', name: 'Example LP', email: 'example@example.test', status: 'active', lp_type: 'institution', commitment_cents: 1000000, called_cents: 200000, received_cents: 100000, outstanding_cents: 100000, distributed_cents: 0, overdue_lines: 0, unavailable: {} };
export const roster = { items: [lpRow], total_rows: 1, page: 1, per_page: 25, pages: 1, totals: { rows: 1, commitment_cents: 1000000 }, tally: { by_type: [] }, funds: [{ id: 7, name: 'Example Fund' }] };
// Synthetic figures only. Every Mercury entry point is a local stub.
export const period = { id: 1, label: '2026Q3', start_date: '2026-07-01', end_date: '2026-09-30', closed: false };
export const ledger = { id: 7, name: 'Example Fund', can_manage: true, periods: [period, { ...period, id: 2, label: '2026Q4' }], period,
  summary: { fee_cents: 12345, expense_cents: null }, trial_balance: [],
  journal: [{ entry_date: '2026-09-30', description: 'Recorded receipt', recorded_by: 9, lines: [
    { code: 'CASH', name: 'Cash', debit_cents: 12345, credit_cents: 0 },
    { code: 'CAPITAL', name: 'Capital called', debit_cents: 0, credit_cents: 12345 },
  ] }] };
export function fixtures(over = {}) {
  const calls = [];
  const rec = (name, fn) => (...args) => { calls.push([name, ...args]); return Promise.resolve().then(() => (over[name] || fn)(...args)); };
  const overview = { as_of: '2026-10-26', funds: { state: 'ok', items: [{ fund_id: 7, name: 'Example Fund' }] },
    entities: { state: 'ok', items: [] }, fees: { state: 'ok', items: [] }, drafts: { state: 'ok', items: [] }, matches: { state: 'ok', items: [] } };
  const uid = 'a'.repeat(32);
  const apis = {
    fundAdmin: {
      access: rec('access', () => ({ super_admin: false, acts: ['fee_terms.confirm', 'fee_period.issue', 'fund_report.issue'].map(act => ({ act, allowed: false, sentence: act === 'fee_terms.confirm' ? 'A Super Admin confirms a fund’s fee terms.' : act === 'fee_period.issue' ? 'A Super Admin issues fee periods.' : 'A Super Admin issues fund reports.' })) })),
      overview: rec('overview', () => overview),
      lps: rec('lps', () => roster),
    },
    fees: {
      state: rec('feeState', () => ({ terms: [{ uid: 'terms1', status: 'draft', annual_bps: 200, effective_from: '2026-01-01' }],
        lps: [{ id: 4, admitted_on: null, admission_missing: true, commitment_amount: 10000 }], net_invested: [], periods: [{ quarter: '2026Q3', status: 'draft', net_cents: 12345 }] })),
      period: rec('feePeriod', () => ({ lines: [{ limited_partner_id: 4, commitment_cents: 1000000, gross_fee_cents: 12445, offset_cents: 100, net_fee_cents: 12345, status: 'draft' }] })),
      statement: rec('statement', () => ({ net_fee_cents: 12345, gross_fee_cents: 12445, offset_cents: 100, reference_code: 'FEE-EXAMPLE', pay_to: { sentence: 'Nothing is due from you against this statement.' } })),
      previewPeriod: rec('preview', (id, quarter) => ({ quarter, digest: 'digest', totals: { net_cents: 12345, gross_cents: 12445, catch_up_cents: 0, applied_cents: 100 } })),
      confirmTerms: rec('confirmTerms', () => ({})), issuePeriod: rec('issuePeriod', () => ({})), linkFundingCall: rec('linkFundingCall', () => ({})),
    },
    reports: { periods: rec('reportPeriods', () => ({ items: [{ id: 3, period: 'Q3 2026', status: 'draft' }] })) },
    reporting: {
      list: rec('packs', () => ({ items: [{ uid, kind: 'lp_quarterly_report', period_label: 'Q3 2026', status: 'prepared', revision: 2, prepared_by: 10 }] })),
      read: rec('packRead', () => ({ figures_sha256: 'digest', figures: { totals: { commitments: { cents: 1000000 } } } })),
      returnDraft: rec('return', () => ({})), issue: rec('issueReport', () => ({})),
    },
    notices: {
      list: rec('notices', () => ({ notices: [{ uid, type: 'capital_call_notice', title: 'Capital call', fund_id: 7, amount_cents: null, notice_date: '2026-09-30', reference: 'EXAMPLE' }] })),
      one: rec('noticeRead', () => ({ uid, title: 'Capital call', amount_cents: null, reference: 'EXAMPLE', figures: { amount_cents: null } })),
      pdfBlob: rec('pdf', () => ({ blob: new Blob(['fixture']), filename: 'fixture.pdf' })),
    },
    ledger: { list: rec('ledgerList', () => ({ items: [ledger] })), read: rec('ledgerRead', (id, pid) => ({ ...ledger, period: { ...period, id: Number(pid) } })) },
    mercury: {
      connections: rec('connections', () => ({ entities: [] })), accounts: rec('accounts', () => ({ items: [] })),
      transactions: rec('transactions', () => ({ items: [], total: 0, page_size: 50 })), matches: rec('matches', () => ({ items: [] })),
    },
  };
  return { apis, calls, overview, uid };
}

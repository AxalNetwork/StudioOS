/** D6397 (#6397): recorded Fund Admin answers and navigation; no model or financial act. */
import type { VcFund } from '../../models/funds';
import type { FundAdminOverview } from '../fundAdminOverview';
import type { readFundCalls } from '../fundCallLedger';
export type FundAdminAnswerFacts = {
  overview: FundAdminOverview | null;
  ledgers: Record<number, Awaited<ReturnType<typeof readFundCalls>> | 'unreadable'>;
  funds: Record<number, VcFund | null | 'unreadable'>;
};

export const FUND_ADMIN_PROMPTS = Object.freeze({
  'explain:fund-outstanding': 'Explain outstanding capital',
  'identify:fund-overdue-lps': 'Identify overdue LPs',
  'summarize:fund-reconciliation': 'Summarize reconciliation exceptions',
  'prepare:fund-capital-call': 'Prepare a capital call',
  'identify:fund-incomplete-setup': 'Identify incomplete fund setup',
});
export type FundAdminPrompt = keyof typeof FUND_ADMIN_PROMPTS;
type Access = { acts: Array<{ act: string; allowed: boolean; sentence: string | null }> };
const BASE = '/admin/fund-admin';
const money = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value)
  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100)
  : '— Not recorded';
export const FUND_ADMIN_ANSWER_NOTE = 'Eadwyn prepares, explains and navigates. It never issues, records or moves money.';

/** Plain recorded snapshots only; the route owns authorization and audited reads. */
export function fundAdminAnswer(facts: FundAdminAnswerFacts, prompt: FundAdminPrompt, fundId: number | null, access: Access) {
  const overview = facts.overview;
  const answer = (state: 'ok' | 'not_recorded' | 'unreadable', lines: string[], path: string, label: string) => ({
    prompt, title: FUND_ADMIN_PROMPTS[prompt], state, as_of: overview?.as_of ?? null,
    lines, navigation: { to: path, label }, no_model: true, note: FUND_ADMIN_ANSWER_NOTE,
  });
  const failed = (path = BASE) => answer('unreadable', ['! Unreadable · Retry. The recorded source could not be read; this is not a zero.'], path, 'Open Fund Admin');
  if (!overview || overview.funds.state !== 'ok') return failed();
  const funds = overview.funds.items.filter(fund => fundId === null || fund.fund_id === fundId);
  if (fundId !== null && !funds.length) return null; // Never read an outside fund by a guessed ID.
  if (!funds.length) return answer('not_recorded', ['— Not recorded. No administered fund is recorded.'], BASE + '/funds', 'Open Funds');
  const chosen = funds.length === 1 ? funds[0] : null;
  const scoped = (path: string, extra = '') => BASE + path + (chosen ? `?fund=${chosen.fund_id}${extra}` : '');
  if (prompt === 'explain:fund-outstanding') {
    try {
      for (const fund of funds) {
        const ledger = facts.ledgers[fund.fund_id];
        if (!ledger || ledger === 'unreadable' || ledger.truncated) return failed(scoped('/calls'));
      }
    } catch { return failed(scoped('/calls')); }
    return answer('ok', funds.map(fund => `${fund.name}: committed ${money(fund.committed_cents)}, called ${money(fund.called_cents)}, received ${money(fund.received_cents)}, outstanding ${money(fund.outstanding_cents)}.`), scoped('/calls'), 'Open capital calls');
  }
  if (prompt === 'summarize:fund-reconciliation') {
    if (overview.matches.state !== 'ok') return failed(scoped('/reconciliation'));
    const rows = funds.map(fund => ({ fund, match: overview.matches.items.find(row => row.fund_id === fund.fund_id) }));
    return answer('ok', rows.map(({ fund, match }) => match
      ? `${fund.name}: ${match.proposed} proposed matches; ${match.needs_review} need review.`
      : `${fund.name}: — Not recorded. No match summary was recorded.`), scoped('/reconciliation'), 'Open reconciliation');
  }
  if (!chosen) return answer('not_recorded', ['Choose one administered fund to read its recorded detail.'], BASE + '/funds', 'Choose a fund');
  if (prompt === 'prepare:fund-capital-call') {
    const gate = access.acts.find(row => row.act === 'capital_call.preview');
    if (!gate?.allowed) return answer('not_recorded', [gate?.sentence || 'A capital call preview is not available to this viewer.'], scoped('/calls'), 'Open capital calls');
    return answer('ok', [`${chosen.name}: amount and due date are — Not recorded. Choose them in New capital call before reviewing its preview. No call is issued by Eadwyn.`], scoped('/calls', '&new=1'), 'Open New capital call preview');
  }
  if (prompt === 'identify:fund-overdue-lps') {
    try {
      const ledger = facts.ledgers[chosen.fund_id];
      if (!ledger || ledger === 'unreadable' || ledger.truncated) return failed(scoped('/calls'));
      const lines = [...ledger.calls.flatMap(call => call.lines.map(line => ({ line, call }))), ...ledger.unnumbered.map(line => ({ line, call: null }))]
        .filter(({ line }) => line.state === 'overdue');
      return answer('ok', lines.length ? lines.map(({ line, call }) => `${chosen.name} · ${call ? 'Call ' + call.call_number : 'Call number — Not recorded'} · due ${line.due_date || '— Not recorded'}: ${line.lp_name || 'Name — Not recorded'} · ${money(line.outstanding_cents)} outstanding.`)
        : [`${chosen.name}: no overdue LP line as of ${overview.as_of}.`], scoped('/calls'), lines.length ? `Open the ${lines.length} line${lines.length === 1 ? '' : 's'}` : 'Open capital calls');
    } catch { return failed(scoped('/calls')); }
  }
  try {
    const fund = facts.funds[chosen.fund_id];
    if (!fund || fund === 'unreadable') return failed(scoped('/funds'));
    const missing = [
      [fund.gp_user_id, 'GP of record'], [fund.lpa_doc_id, 'LPA document'],
      [fund.carried_interest, 'Carried interest'], [fund.management_fee, 'Management fee'],
      [fund.fund_size_cents, 'Target size'],
    ].filter(([value]) => value === null || value === undefined).map(([, label]) => String(label));
    return answer(missing.length ? 'not_recorded' : 'ok', [
      `${chosen.name}: ${missing.length ? missing.join(', ') + ' — Not recorded.' : 'No missing value in the checked GP, LPA reference, economics and target-size facts.'}`,
      `Fund facts updated: ${fund.updated_at || '— Not recorded'}. This checks recorded facts, not readiness to issue a financial act.`,
    ], BASE + '/funds/' + chosen.fund_id, 'Open fund setup');
  } catch { return failed(BASE + '/funds/' + chosen.fund_id); }
}

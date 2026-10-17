/**
 * D709 (#1774) — the management-fee store: terms, admissions, net invested
 * capital, offsets, and the periods and lines a GP previews and issues.
 *
 * `fundFeeCalc.ts` does the arithmetic; this reads its inputs, saves what it
 * returns and moves a period from draft to issued by compare-and-set. Issuing
 * records amounts and reference codes. NOTHING HERE MOVES MONEY: no Stripe,
 * no `fetch`, no transfer or payment request. A fee line is paid only when the
 * capital call line it is linked to is paid (`fundCallLedger.recordReceipt`).
 *
 * Every write puts its `activity_logs` actor row in its own batch, after the
 * one-row statement it audits (`ledgerAudit` inserts only WHERE changes()=1).
 * `today` always comes from the caller, so tests pin it.
 */
import type { Env } from '../types';
import { ledgerAudit, ledgerDate, ledgerText } from './fundLedger';
import {
  computePeriod, parseQuarter, previousQuarter, quarterOf, FEE_CALC_SENTENCES,
  type FeeTerms, type PeriodInputs, type PeriodResult,
} from './fundFeeCalc';
import { fundPayeeOf, payInstructionsFor } from './payInstructions';

/** Every refusal this store gives, as fixed sentences (as D628's `LEDGER_SENTENCES`). */
export const FEE_SENTENCES = [
  ...Object.values(FEE_CALC_SENTENCES),
  'Record annual basis points from 0 to 10000, an offset from 0 to 10000, a basis after the investment period of net_invested or committed, a fee start date, an investment-period end on or after it, and an LPA reference of up to 500 characters.',
  'A later version takes effect on the first day of a quarter after every issued period.',
  'These terms are already confirmed.',
  'Fee terms not found.',
  'A confirmed version already takes effect on that date.',
  'Every version keeps the first confirmed fee start date.',
  'Record an admission date and a source of up to 500 characters.',
  'This LP has an issued fee line, so its admission date is fixed.',
  'LP not found.',
  'Record an as-of date, net invested capital in whole cents and a source of up to 500 characters.',
  'Record a portfolio company of this fund, an Axal entity (holdings, management or gp), an amount in cents, a received date, a description and a source.',
  'Issue the quarter before this one first.',
  'A quarter is billed in advance only up to the coming quarter.',
  'This quarter is already issued.',
  'The preview is out of date. Preview the quarter again.',
  'Preview this quarter before issuing it.',
  'Capital call not found.',
  'Fee period not found.',
  'Issue this quarter before linking a capital call.',
] as const;
export type FeeSentence = typeof FEE_SENTENCES[number];
const TERMS_INVALID: FeeSentence = 'Record annual basis points from 0 to 10000, an offset from 0 to 10000, a basis after the investment period of net_invested or committed, a fee start date, an investment-period end on or after it, and an LPA reference of up to 500 characters.';
export class FeeRefusal extends Error {
  status: 400 | 404 | 409;
  sentences: string[];
  constructor(sentences: string | string[], status: 400 | 404 | 409 = 400) {
    const list = (Array.isArray(sentences) ? sentences : [sentences])
      .map(s => ((FEE_SENTENCES as readonly string[]).includes(s) ? s : 'The fee request could not be recorded.'));
    super(list[0]); this.status = status; this.sentences = list;
  }
}

const BPS = (v: unknown) => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 10000;
const ids = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
const rowsOf = <T>(r: { results?: T[] | null }) => r.results ?? [];
const uid = () => crypto.randomUUID().replace(/-/g, '');
const firstOfQuarter = (day: string) => parseQuarter(quarterOf(day))!.first === day;
type Actor = { id: number };

// ---------------------------------------------------------------- terms

/** Decision 1's defaults: the GP confirms them, and the LPA governs. */
export const TERM_DEFAULTS = { annual_bps: 200, basis_during: 'committed', basis_after: 'net_invested', frequency: 'quarterly_in_advance', payee: 'gp', offset_bps: 10000 } as const;

async function confirmedTerms(env: Env, fundId: number): Promise<FeeTerms[]> {
  return rowsOf(await env.DB.prepare(
    `SELECT id, annual_bps, basis_after, offset_bps, fee_start_date, investment_period_end, effective_from
       FROM fund_mgmt_fee_terms WHERE fund_id = ? AND status = 'confirmed' ORDER BY effective_from, id`,
  ).bind(fundId).all<FeeTerms>());
}
async function lastIssuedEnd(env: Env, fundId: number): Promise<string | null> {
  const r = await env.DB.prepare(`SELECT MAX(window_end) AS d FROM fund_fee_periods WHERE fund_id = ? AND status <> 'draft'`).bind(fundId).first<{ d: string | null }>();
  return r?.d ?? null;
}
/**
 * A version's `effective_from` rule, checked at record and again at confirm:
 * the first confirmed version takes effect on its fee start date; a later one
 * on the first day of a quarter after every issued period, never twice, and
 * keeping the first fee start date.
 */
async function checkEffective(env: Env, fundId: number, t: { fee_start_date: string; effective_from: string; id?: number }) {
  const confirmed = (await confirmedTerms(env, fundId)).filter(c => c.id !== t.id);
  if (!confirmed.length) {
    if (t.effective_from !== t.fee_start_date) throw new FeeRefusal('A later version takes effect on the first day of a quarter after every issued period.');
    return;
  }
  if (t.fee_start_date !== confirmed[0].fee_start_date) throw new FeeRefusal('Every version keeps the first confirmed fee start date.');
  if (confirmed.some(c => c.effective_from === t.effective_from)) throw new FeeRefusal('A confirmed version already takes effect on that date.', 409);
  const issued = await lastIssuedEnd(env, fundId);
  if (!firstOfQuarter(t.effective_from) || (issued && t.effective_from <= issued)) {
    throw new FeeRefusal('A later version takes effect on the first day of a quarter after every issued period.');
  }
}

export async function recordTerms(env: Env, actor: Actor, fundId: number, b: Record<string, unknown>) {
  const t = {
    annual_bps: b.annual_bps ?? TERM_DEFAULTS.annual_bps, offset_bps: b.offset_bps ?? TERM_DEFAULTS.offset_bps,
    basis_after: b.basis_after ?? TERM_DEFAULTS.basis_after, fee_start_date: b.fee_start_date, investment_period_end: b.investment_period_end,
    effective_from: b.effective_from ?? b.fee_start_date, lpa_reference: typeof b.lpa_reference === 'string' ? b.lpa_reference.trim() : b.lpa_reference,
  };
  if (!BPS(t.annual_bps) || !BPS(t.offset_bps) || !['net_invested', 'committed'].includes(String(t.basis_after))
    || !ledgerDate(t.fee_start_date) || !ledgerDate(t.investment_period_end) || t.investment_period_end < t.fee_start_date
    || !ledgerDate(t.effective_from) || t.effective_from < t.fee_start_date || !ledgerText(t.lpa_reference)) {
    throw new FeeRefusal(TERMS_INVALID);
  }
  await checkEffective(env, fundId, t as { fee_start_date: string; effective_from: string });
  const id = uid();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO fund_mgmt_fee_terms (uid, fund_id, annual_bps, basis_after, offset_bps, fee_start_date, investment_period_end, effective_from, lpa_reference, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, fundId, t.annual_bps, t.basis_after, t.offset_bps, t.fee_start_date, t.investment_period_end, t.effective_from, t.lpa_reference, actor.id),
    ledgerAudit(env, actor.id, 'fund_fee_terms_recorded', { fund_id: fundId, terms_uid: id, ...t }),
  ]);
  return { uid: id, status: 'draft' };
}

export async function confirmTerms(env: Env, actor: Actor, fundId: number, termsUid: string) {
  const t = await env.DB.prepare('SELECT * FROM fund_mgmt_fee_terms WHERE uid = ? AND fund_id = ?').bind(termsUid, fundId).first<any>();
  if (!t) throw new FeeRefusal('Fee terms not found.', 404);
  if (t.status === 'confirmed') throw new FeeRefusal('These terms are already confirmed.', 409);
  // Checked again here, so nothing confirms into a past that was issued after the draft was written.
  await checkEffective(env, fundId, t);
  const [r] = await env.DB.batch([
    env.DB.prepare(`UPDATE fund_mgmt_fee_terms SET status = 'confirmed', confirmed_by = ?, confirmed_at = datetime('now'), updated_at = datetime('now')
      WHERE uid = ? AND fund_id = ? AND status = 'draft'`).bind(actor.id, termsUid, fundId),
    ledgerAudit(env, actor.id, 'fund_fee_terms_confirmed', { fund_id: fundId, terms_uid: termsUid }),
  ]);
  if (Number(r.meta.changes) !== 1) throw new FeeRefusal('These terms are already confirmed.', 409);
  return { uid: termsUid, status: 'confirmed' };
}

// ------------------------------------------------- admissions, figures, offsets

export async function recordAdmission(env: Env, actor: Actor, fundId: number, lpId: number, b: Record<string, unknown>) {
  const lp = ids(lpId) && await env.DB.prepare('SELECT id FROM limited_partners WHERE id = ? AND fund_id = ?').bind(lpId, fundId).first();
  if (!lp) throw new FeeRefusal('LP not found.', 404);
  const label = b.closing_label == null || b.closing_label === '' ? null : String(b.closing_label).trim().slice(0, 200);
  if (!ledgerDate(b.admitted_on) || !ledgerText(b.source)) throw new FeeRefusal('Record an admission date and a source of up to 500 characters.');
  const frozen = await env.DB.prepare(`SELECT 1 FROM fund_fee_lines WHERE limited_partner_id = ? AND status <> 'draft' LIMIT 1`).bind(lpId).first();
  if (frozen) throw new FeeRefusal('This LP has an issued fee line, so its admission date is fixed.', 409);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO fund_lp_admissions (uid, fund_id, limited_partner_id, admitted_on, closing_label, source, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(limited_partner_id) DO UPDATE SET admitted_on = excluded.admitted_on, closing_label = excluded.closing_label,
        source = excluded.source, recorded_by = excluded.recorded_by, updated_at = datetime('now')`)
      .bind(uid(), fundId, lpId, b.admitted_on, label, String(b.source).trim(), actor.id),
    ledgerAudit(env, actor.id, 'fund_lp_admission_recorded', { fund_id: fundId, limited_partner_id: lpId, admitted_on: b.admitted_on, closing_label: label }),
  ]);
  return { limited_partner_id: lpId, admitted_on: b.admitted_on };
}

export async function recordNetInvested(env: Env, actor: Actor, fundId: number, b: Record<string, unknown>) {
  if (!ledgerDate(b.as_of) || !Number.isSafeInteger(b.net_invested_cents) || Number(b.net_invested_cents) < 0 || !ledgerText(b.source)) {
    throw new FeeRefusal('Record an as-of date, net invested capital in whole cents and a source of up to 500 characters.');
  }
  const id = uid();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO fund_net_invested_capital (uid, fund_id, as_of, net_invested_cents, source, recorded_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, fundId, b.as_of, b.net_invested_cents, String(b.source).trim(), actor.id),
    ledgerAudit(env, actor.id, 'fund_net_invested_recorded', { fund_id: fundId, uid: id, as_of: b.as_of, net_invested_cents: b.net_invested_cents }),
  ]);
  return { uid: id };
}

export async function recordOffset(env: Env, actor: Actor, fundId: number, b: Record<string, unknown>) {
  const ok = ids(b.project_id) && ['holdings', 'management', 'gp'].includes(String(b.axal_entity)) && Number.isSafeInteger(b.amount_cents)
    && Number(b.amount_cents) > 0 && ledgerDate(b.received_on) && ledgerText(b.description) && ledgerText(b.source);
  // The company must hold a position in this fund.
  const held = ok && await env.DB.prepare('SELECT 1 FROM portfolio_positions WHERE fund_id = ? AND project_id = ? LIMIT 1').bind(fundId, b.project_id).first();
  if (!held) throw new FeeRefusal('Record a portfolio company of this fund, an Axal entity (holdings, management or gp), an amount in cents, a received date, a description and a source.');
  const id = uid();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO fund_fee_offsets (uid, fund_id, project_id, axal_entity, amount_cents, received_on, description, source, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, fundId, b.project_id, b.axal_entity, b.amount_cents, b.received_on, String(b.description).trim(), String(b.source).trim(), actor.id),
    ledgerAudit(env, actor.id, 'fund_fee_offset_recorded', { fund_id: fundId, uid: id, project_id: b.project_id, axal_entity: b.axal_entity, amount_cents: b.amount_cents, received_on: b.received_on }),
  ]);
  return { uid: id };
}

// ---------------------------------------------------------------- periods

/** Canonical JSON: keys sorted at every level, so one input set has one digest. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export async function digestOf(result: PeriodResult): Promise<string> {
  const body = canonical({ quarter: result.quarter, window: result.window, lines: [...result.lines].sort((a, b) => a.limited_partner_id - b.limited_partner_id), inputs: result.inputs });
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export const lineReference = (quarter: string, lpId: number) => `AXAL-MF-${quarter}-L${lpId}`;
export const remittanceReference = (quarter: string, fundId: number) => `AXAL-MF-${quarter}-F${fundId}`;

async function inputsFor(env: Env, fundId: number, quarter: string, today: string): Promise<PeriodInputs> {
  const [terms, lps, net, offsets, prev] = await Promise.all([
    confirmedTerms(env, fundId),
    env.DB.prepare(
      `SELECT lp.id, lp.commitment_amount, lp.status, a.admitted_on, a.id AS admission_id,
              EXISTS (SELECT 1 FROM fund_fee_lines l JOIN fund_fee_periods p ON p.id = l.period_id
                       WHERE l.limited_partner_id = lp.id AND l.status <> 'draft' AND p.quarter < ?) AS has_prior_line
         FROM limited_partners lp LEFT JOIN fund_lp_admissions a ON a.limited_partner_id = lp.id AND a.fund_id = lp.fund_id
        WHERE lp.fund_id = ? ORDER BY lp.id`,
    ).bind(quarter, fundId).all<any>(),
    env.DB.prepare('SELECT id, as_of, net_invested_cents FROM fund_net_invested_capital WHERE fund_id = ? ORDER BY as_of, id').bind(fundId).all<any>(),
    env.DB.prepare('SELECT id, amount_cents, received_on FROM fund_fee_offsets WHERE fund_id = ? AND counted_in_period_id IS NULL ORDER BY id').bind(fundId).all<any>(),
    env.DB.prepare(`SELECT id, offset_carried_cents FROM fund_fee_periods WHERE fund_id = ? AND quarter = ? AND status <> 'draft'`).bind(fundId, previousQuarter(quarter)).first<any>(),
  ]);
  return {
    quarter, today, terms,
    lps: rowsOf(lps).map(r => ({ ...r, has_prior_line: Number(r.has_prior_line) === 1 })),
    netInvested: rowsOf(net), offsets: rowsOf(offsets),
    previous: prev ? { id: prev.id, carried_cents: Number(prev.offset_carried_cents) } : null,
  };
}

/**
 * The order and timing rules (decision 7): a quarter issues only once the one
 * before it is issued or paid, unless that one ends before the fee start; and
 * no later than the quarter after today's (UTC), since the fee is in advance.
 */
async function sequenceChecked(env: Env, fundId: number, quarter: string, today: string, terms: FeeTerms[]) {
  const q = parseQuarter(quarter);
  if (!q) throw new FeeRefusal(FEE_CALC_SENTENCES.badQuarter);
  const coming = parseQuarter(quarterOf(today))!;
  const next = new Date(Date.parse(`${coming.last}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  if (q.first > next) throw new FeeRefusal('A quarter is billed in advance only up to the coming quarter.');
  const start = terms[0]?.fee_start_date;
  const prev = parseQuarter(previousQuarter(quarter))!;
  if (start && prev.last >= start) {
    const issued = await env.DB.prepare(`SELECT 1 FROM fund_fee_periods WHERE fund_id = ? AND quarter = ? AND status <> 'draft'`).bind(fundId, previousQuarter(quarter)).first();
    if (!issued) throw new FeeRefusal('Issue the quarter before this one first.', 409);
  }
}

async function periodRow(env: Env, fundId: number, quarter: string) {
  return await env.DB.prepare('SELECT * FROM fund_fee_periods WHERE fund_id = ? AND quarter = ?').bind(fundId, quarter).first<any>();
}

/** Recompute a quarter. Throws on a refusal; the caller saves nothing then. */
async function compute(env: Env, fundId: number, quarter: string, today: string) {
  const inputs = await inputsFor(env, fundId, quarter, today);
  await sequenceChecked(env, fundId, quarter, today, inputs.terms);
  const result = computePeriod(inputs);
  if (result.refusals.length) throw new FeeRefusal(result.refusals);
  return { result, digest: await digestOf(result) };
}

/** Preview: the quarter's figures, saved as its draft (replacing an earlier one), and their digest. */
export async function previewPeriod(env: Env, actor: Actor, fundId: number, quarter: string, today: string) {
  const existing = await periodRow(env, fundId, quarter);
  if (existing && existing.status !== 'draft') throw new FeeRefusal('This quarter is already issued.', 409);
  const { result, digest } = await compute(env, fundId, quarter, today);
  const periodUid = uid();
  const t = result.totals;
  const statements = [
    env.DB.prepare(`DELETE FROM fund_fee_lines WHERE period_id IN (SELECT id FROM fund_fee_periods WHERE fund_id = ? AND quarter = ? AND status = 'draft')`).bind(fundId, quarter),
    env.DB.prepare(`DELETE FROM fund_fee_periods WHERE fund_id = ? AND quarter = ? AND status = 'draft'`).bind(fundId, quarter),
    env.DB.prepare(`INSERT INTO fund_fee_periods (uid, fund_id, quarter, window_start, window_end, terms_id, net_invested_id, digest, gross_cents, catch_up_cents,
        offset_pool_cents, offset_applied_cents, offset_carried_cents, net_cents, remittance_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(periodUid, fundId, quarter, result.window!.start, result.window!.end, result.terms_id, result.net_invested_id, digest, t.gross_cents, t.catch_up_cents,
        t.offset_pool_cents, t.applied_cents, t.carried_cents, t.net_cents, remittanceReference(quarter, fundId)),
    ledgerAudit(env, actor.id, 'fund_fee_period_previewed', { fund_id: fundId, quarter, digest }),
    ...result.lines.map(l => env.DB.prepare(`INSERT INTO fund_fee_lines (uid, period_id, fund_id, limited_partner_id, commitment_cents, committed_days, invested_days,
        invested_share_cents, gross_fee_cents, catch_up_days, catch_up_cents, offset_cents, net_fee_cents, reference_code)
      SELECT ?, id, fund_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM fund_fee_periods WHERE uid = ? AND status = 'draft'`)
      .bind(uid(), l.limited_partner_id, l.commitment_cents, l.committed_days, l.invested_days, l.invested_share_cents, l.gross_fee_cents, l.catch_up_days,
        l.catch_up_cents, l.offset_cents, l.net_fee_cents, lineReference(quarter, l.limited_partner_id), periodUid)),
  ];
  await env.DB.batch(statements);
  return { quarter, status: 'draft', digest, window: result.window, totals: result.totals, lines: result.lines, inputs: result.inputs };
}

/**
 * Issue: recompute, refuse a digest that differs (409), then one batch holds
 * the compare-and-set, its audit row, the lines' freeze and the offsets'
 * count, each guarded on the compare-and-set having landed.
 */
export async function issuePeriod(env: Env, actor: Actor, fundId: number, quarter: string, digest: unknown, today: string) {
  const existing = await periodRow(env, fundId, quarter);
  if (existing && existing.status !== 'draft') {
    if (existing.digest === digest) return { period: existing, already_issued: true };
    throw new FeeRefusal('This quarter is already issued.', 409);
  }
  if (!existing) throw new FeeRefusal('Preview this quarter before issuing it.', 409);
  const { result, digest: fresh } = await compute(env, fundId, quarter, today);
  if (typeof digest !== 'string' || digest !== fresh || existing.digest !== fresh) throw new FeeRefusal('The preview is out of date. Preview the quarter again.', 409);
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE fund_fee_periods SET status = 'issued', issued_by = ?, issued_at = datetime('now'), updated_at = datetime('now')
      WHERE fund_id = ? AND quarter = ? AND status = 'draft' AND digest = ?`).bind(actor.id, fundId, quarter, fresh),
    ledgerAudit(env, actor.id, 'fund_fee_period_issued', { fund_id: fundId, quarter, digest: fresh, net_cents: result.totals.net_cents,
      remittance_reference: remittanceReference(quarter, fundId) }),
    env.DB.prepare(`UPDATE fund_fee_lines SET status = 'issued', updated_at = datetime('now')
      WHERE status = 'draft' AND period_id = (SELECT id FROM fund_fee_periods WHERE fund_id = ? AND quarter = ?) AND EXISTS (SELECT 1 FROM fund_fee_periods p WHERE p.fund_id = ? AND p.quarter = ? AND p.status = 'issued' AND p.digest = ?)`)
      .bind(fundId, quarter, fundId, quarter, fresh),
    env.DB.prepare(`UPDATE fund_fee_offsets SET counted_in_period_id = (SELECT id FROM fund_fee_periods WHERE fund_id = ? AND quarter = ?), updated_at = datetime('now')
      WHERE fund_id = ? AND counted_in_period_id IS NULL AND id IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM fund_fee_periods p WHERE p.fund_id = ? AND p.quarter = ? AND p.status = 'issued' AND p.digest = ?)`)
      .bind(fundId, quarter, fundId, JSON.stringify(result.inputs.offset_ids), fundId, quarter, fresh),
  ]);
  const after = await periodRow(env, fundId, quarter);
  if (Number(results[0].meta.changes) !== 1) {
    // A concurrent issue with this digest is the same issue; anything else changed underneath.
    if (after && after.status !== 'draft' && after.digest === fresh) return { period: after, already_issued: true };
    throw new FeeRefusal('The preview is out of date. Preview the quarter again.', 409);
  }
  return { period: after, already_issued: false };
}

// ---------------------------------------------------------------- funding

/**
 * Decision 8: link a period's issued lines to their LPs' lines in one capital
 * call of the same fund. Net fees linked to one call line may not pass what it
 * owes; a line that would, or whose LP has no line in the call, stays unlinked
 * with its reason. A line linked to an already-paid call line is paid at once.
 */
export async function linkFundingCall(env: Env, actor: Actor, fundId: number, quarter: string, callUid: unknown) {
  const period = await periodRow(env, fundId, quarter);
  if (!period) throw new FeeRefusal('Fee period not found.', 404);
  if (period.status === 'draft') throw new FeeRefusal('Issue this quarter before linking a capital call.', 409);
  const call = typeof callUid === 'string' && await env.DB.prepare('SELECT id FROM fund_capital_calls WHERE uid = ? AND fund_id = ?').bind(callUid, fundId).first<{ id: number }>();
  if (!call) throw new FeeRefusal('Capital call not found.', 404);
  const lines = rowsOf(await env.DB.prepare(
    `SELECT l.id, l.limited_partner_id, l.net_fee_cents, cc.id AS call_line_id, cc.status AS call_status,
            COALESCE(cc.amount_cents, CAST(ROUND(cc.amount * 100) AS INTEGER)) AS owed_cents,
            (SELECT COALESCE(SUM(o.net_fee_cents), 0) FROM fund_fee_lines o WHERE o.capital_call_line_id = cc.id) AS linked_cents
       FROM fund_fee_lines l
       LEFT JOIN capital_calls cc ON cc.fund_call_id = ? AND cc.limited_partner_id = l.limited_partner_id
      WHERE l.period_id = ? AND l.capital_call_line_id IS NULL AND l.status = 'issued' ORDER BY l.limited_partner_id`,
  ).bind(call.id, period.id).all<any>());
  const linked: Array<{ limited_partner_id: number; capital_call_line_id: number; paid: boolean }> = [];
  const unlinked: Array<{ limited_partner_id: number; reason: 'no_call_line' | 'exceeds_call_line' }> = [];
  const added = new Map<number, number>();
  const statements: ReturnType<Env['DB']['prepare']>[] = [];
  for (const l of lines) {
    if (l.call_line_id == null) { unlinked.push({ limited_partner_id: l.limited_partner_id, reason: 'no_call_line' }); continue; }
    const total = Number(l.linked_cents) + (added.get(l.call_line_id) ?? 0) + Number(l.net_fee_cents);
    if (total > Number(l.owed_cents)) { unlinked.push({ limited_partner_id: l.limited_partner_id, reason: 'exceeds_call_line' }); continue; }
    added.set(l.call_line_id, total - Number(l.linked_cents));
    const paid = l.call_status === 'paid';
    statements.push(env.DB.prepare(
      `UPDATE fund_fee_lines SET capital_call_line_id = ?, status = CASE WHEN ? THEN 'paid' ELSE status END,
          paid_via = CASE WHEN ? THEN 'capital_call' ELSE paid_via END, paid_evidence = CASE WHEN ? THEN ? ELSE paid_evidence END,
          paid_at = CASE WHEN ? THEN datetime('now') ELSE paid_at END, updated_at = datetime('now')
        WHERE id = ? AND capital_call_line_id IS NULL`,
    ).bind(l.call_line_id, paid ? 1 : 0, paid ? 1 : 0, paid ? 1 : 0, `capital_call_line:${l.call_line_id}`, paid ? 1 : 0, l.id));
    linked.push({ limited_partner_id: l.limited_partner_id, capital_call_line_id: l.call_line_id, paid });
  }
  if (statements.length) {
    statements.push(
      env.DB.prepare(`UPDATE fund_fee_periods SET status = 'paid', paid_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND status = 'issued' AND NOT EXISTS (SELECT 1 FROM fund_fee_lines l WHERE l.period_id = fund_fee_periods.id AND l.status <> 'paid')`).bind(period.id),
      env.DB.prepare(`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('fund_fee_period_funding_linked', ?, ?, ?)`)
        .bind(JSON.stringify({ fund_id: fundId, quarter, call_uid: callUid, linked, unlinked }), String(actor.id), actor.id),
    );
    await env.DB.batch(statements);
  }
  return { quarter, linked, unlinked };
}

// ---------------------------------------------------------------- reads

export async function feeState(env: Env, fundId: number) {
  const [terms, lps, net, offsets, periods] = await Promise.all([
    env.DB.prepare(`SELECT uid, annual_bps, basis_during, basis_after, frequency, payee, offset_bps, fee_start_date, investment_period_end, effective_from,
        lpa_reference, status, confirmed_at FROM fund_mgmt_fee_terms WHERE fund_id = ? ORDER BY effective_from, id`).bind(fundId).all<any>(),
    env.DB.prepare(`SELECT lp.id, lp.status, lp.commitment_amount, a.admitted_on, a.closing_label, a.source
       FROM limited_partners lp LEFT JOIN fund_lp_admissions a ON a.limited_partner_id = lp.id AND a.fund_id = lp.fund_id
      WHERE lp.fund_id = ? AND lp.status IN ('committed', 'active') AND lp.commitment_amount > 0 ORDER BY lp.id`).bind(fundId).all<any>(),
    env.DB.prepare('SELECT uid, as_of, net_invested_cents, source FROM fund_net_invested_capital WHERE fund_id = ? ORDER BY as_of DESC, id DESC').bind(fundId).all<any>(),
    env.DB.prepare(`SELECT o.uid, o.project_id, o.axal_entity, o.amount_cents, o.received_on, o.description, o.source, p.quarter AS counted_in
       FROM fund_fee_offsets o LEFT JOIN fund_fee_periods p ON p.id = o.counted_in_period_id WHERE o.fund_id = ? ORDER BY o.received_on, o.id`).bind(fundId).all<any>(),
    env.DB.prepare(`SELECT quarter, window_start, window_end, status, gross_cents, catch_up_cents, offset_applied_cents, offset_carried_cents, net_cents,
        remittance_reference, issued_at, paid_at FROM fund_fee_periods WHERE fund_id = ? ORDER BY quarter DESC`).bind(fundId).all<any>(),
  ]);
  return {
    defaults: TERM_DEFAULTS, terms: rowsOf(terms),
    lps: rowsOf(lps).map(l => ({ ...l, admission_missing: !l.admitted_on })),
    net_invested: rowsOf(net), offsets: rowsOf(offsets), periods: rowsOf(periods),
  };
}

export async function readPeriod(env: Env, fundId: number, quarter: string) {
  const period = await periodRow(env, fundId, quarter);
  if (!period) throw new FeeRefusal('Fee period not found.', 404);
  const lines = rowsOf(await env.DB.prepare(
    `SELECT l.limited_partner_id, l.commitment_cents, l.committed_days, l.invested_days, l.invested_share_cents, l.gross_fee_cents, l.catch_up_days,
            l.catch_up_cents, l.offset_cents, l.net_fee_cents, l.reference_code, l.status, l.paid_at, cc.uid AS capital_call_line_uid
       FROM fund_fee_lines l LEFT JOIN capital_calls cc ON cc.id = l.capital_call_line_id WHERE l.period_id = ? ORDER BY l.limited_partner_id`,
  ).bind(period.id).all<any>());
  const { id: _id, terms_id: _t, net_invested_id: _n, issued_by: _b, ...out } = period;
  return { period: out, lines, remittance: await remittanceFor(env, fundId, period.remittance_reference) };
}

/**
 * Decision 9: where the Fund remits the period's fee. Only Fund I is an Axal
 * entity (#1773's `fundPayeeOf`), so only its remittance reads #1773's
 * resolver, and only its masked output and warning are printed. Any other
 * fund never reads the registry and names no Axal payee. Issuing needs none
 * of this.
 */
export async function remittanceFor(env: Env, fundId: number, reference: string) {
  if (await fundPayeeOf(env, fundId) !== 'fund') {
    return { available: false as const, code: 'not_an_axal_fund', message: 'Axal holds no payment instructions for this fund.' };
  }
  const pay = await payInstructionsFor(env, 'gp', 'management_fee');
  if (!pay.ok) return { available: false as const, code: pay.code, message: pay.message };
  return { available: true as const, payee: pay.payee, purpose: pay.purpose, reference, instructions: pay.instructions, warning: pay.warning };
}

/**
 * Decision 9: one LP's statement. The LP funds its share by a capital
 * contribution, so `pay_to` is never due; `remittance` is the Fund's to the
 * GP, as the period read gives it.
 */
export async function statementFor(env: Env, fundId: number, quarter: string, lpId: number) {
  const { period, lines, remittance } = await readPeriod(env, fundId, quarter);
  const line = lines.find(l => l.limited_partner_id === lpId);
  if (!line) throw new FeeRefusal('LP not found.', 404);
  const terms = await env.DB.prepare('SELECT annual_bps, lpa_reference, investment_period_end FROM fund_mgmt_fee_terms WHERE fund_id = ? AND id = (SELECT terms_id FROM fund_fee_periods WHERE fund_id = ? AND quarter = ?)')
    .bind(fundId, fundId, quarter).first<any>();
  return {
    quarter, window: { start: period.window_start, end: period.window_end, days: line.committed_days + line.invested_days },
    rate_bps: terms?.annual_bps ?? null, lpa_reference: terms?.lpa_reference ?? null,
    basis: [
      ...(line.committed_days ? [{ basis: 'committed', days: line.committed_days, cents: line.commitment_cents }] : []),
      ...(line.invested_days ? [{ basis: 'net_invested_share', days: line.invested_days, cents: line.invested_share_cents }] : []),
    ],
    gross_fee_cents: line.gross_fee_cents, catch_up_days: line.catch_up_days, catch_up_cents: line.catch_up_cents,
    offset_cents: line.offset_cents, net_fee_cents: line.net_fee_cents, reference_code: line.reference_code,
    funding_call_line: line.capital_call_line_uid ?? null, status: line.status,
    pay_to: { due: false, sentence: 'Nothing is due from you against this statement.' },
    remittance,
  };
}

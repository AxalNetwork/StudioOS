/**
 * D6242 (#6242) — Eadwyn's two Fund-zone drafts beside the `funds/calls` reminder (D553): the LP summary
 * (`funds/lps`, on the LP record drawer) and the quarterly letter (`funds/reporting`, on a draft period's editor).
 *
 * Both are zone-draft surfaces in `routes/research.ts`, so they run, store, accept and discard exactly as the
 * reminder does: the run writes the GP's own `research_zone_drafts` row and nothing else, and neither surface has
 * an `accept` hook, so Accept stamps that row and writes no fund record. The letter's Accept fills the period's
 * unsaved editor on the page; only the page's Save draft writes the period.
 *
 * THE GATE IS THE DRAWER'S AND THE EDITOR'S OWN. `/research/drafts` authorises on sign-in alone and leaves the
 * scoping to each surface, so each gather runs `requireFundGp` (the institutional tier, the GP of record, the
 * active company; an admin operates every fund), the gate on every read the drawer and the editor make. A caller it
 * refuses, a scope that is not `<fund id>:<record id>`, or a record of another fund gives nothing to draft.
 *
 * EVERY FIGURE IS ONE THE SCREEN SHOWS. The LP summary's material is formatted by the drawer's own functions
 * (`frontend/src/pages/investor/fundLpRecordModel.js`) over the same three reads the drawer makes, for that one LP
 * only: their register row, their ledger lines and receipts, and their comms log. `unfoundFigures` then refuses any
 * draft that quotes a number the material does not carry, so a kept draft can only repeat figures on the page.
 */
import type { Env } from '../types';
import { requireFundGp } from './fundGpAccess';
import { readFundLedger } from './fundCallLedger';
import { listCommunications } from './fundLpComms';
import { letterMaterial, periodMovements } from './fundDrafts';
import { callLines, calledToDate, lpCommitmentDollars, lpPaidDollars, moneyText, registerMoney } from '../../../frontend/src/pages/investor/fundLpRecordModel.js';
import { COMM_KIND_LABELS } from '../../../frontend/src/pages/investor/fundLpCommsModel.js';

export const LP_SUMMARY_INSTRUCTION = [
  'Summarise, for the general partner, where the one limited partner below stands with the fund: their commitment, what has been called and paid, what is still outstanding, and what was logged as sent to them.',
  'Quote every amount and date exactly as written below, and add no figure, total or percentage of your own.',
  'Where something is marked "not recorded", say so rather than guess it. Do not mention any other limited partner.',
  'This is a private summary for the general partner: do not address the limited partner and do not say anything has been sent.',
].join(' ');

export const LETTER_INSTRUCTION_FULL = [
  "Draft the Letter section of this period's quarterly report to the fund's limited partners, in two to four short paragraphs separated by blank lines.",
  'Speak only of the numbered capital movements and the key developments below. Quote every amount and date exactly as written and add no figure, total or percentage of your own.',
  'Write "Not recorded" for anything the records do not give. Never project returns, value the portfolio or promise anything.',
  'This is a draft for the general partner to edit, save and issue; never write as though it has been sent.',
].join(' ');

/** `<fund id>:<record id>`, both written as ids; anything else is no scope. */
export function parseFundScope(scope: string): { fundId: number; recordId: number } | null {
  const m = /^([1-9]\d{0,14}):([1-9]\d{0,14})$/.exec(String(scope ?? ''));
  return m ? { fundId: Number(m[1]), recordId: Number(m[2]) } : null;
}

/** The fund, when `requireFundGp` lets this request operate it; null for any refusal. */
async function operatedFund(c: any, fundId: number): Promise<any | null> {
  try {
    return (await requireFundGp(c, fundId)).fund;
  } catch {
    return null;
  }
}

const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** The numbers a text quotes, each as written ("1,250,000.00", "2026", "05"). */
function numbersIn(text: string): string[] {
  return [...String(text ?? '').matchAll(NUMBER)].map((m) => m[0].replace(/[.,]+$/, ''));
}

/**
 * The numbers a draft quotes that its material does not carry, as written. Empty means every figure, date and count
 * in the draft is one the material (and so the screen) shows.
 */
export function unfoundFigures(text: string, material: string[]): string[] {
  const known = new Set(numbersIn(material.join('\n')));
  return [...new Set(numbersIn(text).filter((n) => !known.has(n)))];
}

/** What is kept for a run: the draft, or null (refused as `draft_unfaithful`) when it quotes a figure not in its material. */
export function holdToMaterial(text: string, material: string[]): string | null {
  if (!material.length || !String(text ?? '').trim()) return null;
  return unfoundFigures(text, material).length ? null : text.trim();
}

// ---------------------------------------------------------------- funds/lps

/**
 * The LP summary's material from the drawer's three reads, formatted as the drawer formats them. [] when there is
 * nothing to read: no recorded commitment, no call line, no receipt and nothing logged.
 */
export function lpSummaryMaterial(input: {
  fund: { name?: string | null };
  lp: any;
  ledger: { entries?: any[]; truncated?: boolean };
  comms: { items?: any[]; truncated?: boolean };
}): string[] {
  const { fund, lp, ledger, comms } = input;
  if (!lp) return [];
  const commitment = lpCommitmentDollars(lp);
  const paid = lpPaidDollars(lp);
  const { lines, loose } = callLines(ledger?.entries);
  const logged = Array.isArray(comms?.items) ? comms.items : [];
  // A commitment of 0 is the column's default, not an agreed figure: with nothing else, there is nothing to read.
  if (!(Number(commitment) > 0) && !lines.length && !loose.length && !logged.length) return [];
  const called = calledToDate(lines, ledger?.truncated);
  const out = [
    `LP: ${lp.name || `LP #${lp.id}`}, on the fund ${fund?.name || 'whose name is not recorded'}`,
    `Commitment: ${commitment == null ? 'not recorded' : registerMoney(commitment)}`,
    `Paid to date: ${paid == null ? 'not recorded' : registerMoney(paid)}`,
    `Committed on: ${day(lp.commitment_date) || 'not recorded'}`,
    `Called to date: ${called == null ? 'not totalled, because only the newest ledger entries were read or a line has no owed figure' : moneyText(called)}`,
  ];
  if (!lines.length) out.push('Call lines: none for this LP yet.');
  for (const l of lines) {
    const receipts = l.receipts.map((r: any) => `received ${r.received_on || 'on a date not recorded'}${r.reference ? ` (reference ${r.reference})` : ''}`);
    out.push(`${l.call}, ${l.due ? `due ${l.due}` : 'no due date recorded'}: owed ${moneyText(l.owed)}; received ${moneyText(l.received)}; outstanding ${moneyText(l.outstanding)}; ${l.state}${receipts.length ? `; ${receipts.join('; ')}` : ''}`);
  }
  for (const r of loose) {
    out.push(`A receipt of ${moneyText(r.amount_cents)}, received ${r.received_on || 'on a date not recorded'}, ${r.call_number != null ? `on call ${r.call_number}` : 'on a line not on this list'}`);
  }
  if (ledger?.truncated) out.push('Only the newest ledger entries were read.');
  if (!logged.length) out.push('Comms log: nothing has been logged as sent to this LP.');
  for (const m of logged) {
    out.push(`Logged as sent ${day(m.sent_at) || 'on a date not recorded'}: ${(COMM_KIND_LABELS as Record<string, string>)[m.kind] || m.kind}, "${String(m.subject || '').slice(0, 200)}", logged by ${m.logged_by_name || 'someone not recorded'}`);
  }
  if (comms?.truncated) out.push('Only the newest comms log entries were read.');
  return out;
}

/** The `funds/lps` gather: the scope is `<fund id>:<LP id>`, and the LP must be on that fund. */
export async function lpSummaryGather(c: any, scope: string): Promise<string[]> {
  const s = parseFundScope(scope);
  if (!s) return [];
  const fund = await operatedFund(c, s.fundId);
  if (!fund) return [];
  const env = c.env as Env;
  // The register's own row (`LPs.listByFund`'s projection), for this one LP of this fund.
  const lp = await env.DB.prepare(
    `SELECT lp.*, COALESCE(u.email, lp.email) AS email, COALESCE(u.name, lp.name) AS name,
            u.id AS account_user_id, u.kyc_status AS kyc_status
       FROM limited_partners lp LEFT JOIN users u ON u.id = lp.user_id
      WHERE lp.id = ? AND lp.fund_id = ?`,
  ).bind(s.recordId, s.fundId).first<any>();
  if (!lp) return [];
  const [ledger, comms] = await Promise.all([readFundLedger(env, s.fundId, s.recordId), listCommunications(env, s.fundId, s.recordId)]);
  return lpSummaryMaterial({ fund, lp, ledger, comms });
}

// ---------------------------------------------------------- funds/reporting

/** The period's saved Key developments, as the editor stores them (`narrative.developments`). */
export function savedDevelopments(notes: unknown): Array<{ date: string; title: string; body: string }> {
  let narrative: any = {};
  try { narrative = typeof notes === 'string' ? JSON.parse(notes) : (notes ?? {}); } catch { narrative = {}; }
  const rows = Array.isArray(narrative?.developments) ? narrative.developments : [];
  return rows.filter((d: any) => d && typeof d.title === 'string' && d.title.trim())
    .map((d: any) => ({ date: String(d.date || ''), title: d.title.trim().slice(0, 200), body: String(d.body || '').trim().slice(0, 600) }));
}

/**
 * The letter's material: the period's numbered capital movements (D6252's `letterMaterial`, the same rows) and its
 * saved Key developments. [] when the period records neither.
 */
export function letterDraftMaterial(
  period: { period: string; period_start: string | null; period_end: string | null; notes?: unknown },
  calls: Parameters<typeof letterMaterial>[1],
  distributions: Parameters<typeof letterMaterial>[2],
): string[] {
  const movements = letterMaterial(period, calls, distributions);
  const developments = savedDevelopments(period.notes);
  if (!movements && !developments.length) return [];
  const out = movements ? [...movements.lines] : [
    `Period: ${period.period}${day(period.period_start) && day(period.period_end) ? ` (${day(period.period_start)} to ${day(period.period_end)})` : ', dates not recorded'}`,
    'Capital movements: none recorded in this period.',
  ];
  if (developments.length) {
    out.push('Key developments recorded on this period:');
    developments.forEach((d, i) => out.push(`(${String.fromCharCode(97 + (i % 26))}) ${d.date || 'Date not recorded'}, ${d.title}${d.body ? `: ${d.body}` : ''}`));
  } else {
    out.push('Key developments: none recorded on this period.');
  }
  return out;
}

/** The `funds/reporting` gather: the scope is `<fund id>:<period id>`, and the period must be a draft of that fund. */
export async function letterDraftGather(c: any, scope: string): Promise<string[]> {
  const s = parseFundScope(scope);
  if (!s) return [];
  const fund = await operatedFund(c, s.fundId);
  if (!fund) return [];
  const env = c.env as Env;
  const period = await env.DB.prepare(
    'SELECT id, period, period_start, period_end, status, notes FROM fund_report_periods WHERE fund_id = ? AND id = ?',
  ).bind(s.fundId, s.recordId).first<any>();
  // An issued period offers no draft: its letter cannot change.
  if (!period || period.status !== 'draft') return [];
  const moved = period.period_start && period.period_end
    ? await periodMovements(env, s.fundId, period.period_start, period.period_end)
    : { calls: [], distributions: [] };
  return letterDraftMaterial(period, moved.calls, moved.distributions);
}

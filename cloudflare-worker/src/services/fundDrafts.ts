/**
 * #6252 (D6252): what Eadwyn drafts on the fund pages, and over what. The F1/F2 canvas
 * (`design/canvases/integrated/ops-data.js`, `fd-page` and `fd-report` rails) promised two actions D631 left out:
 *
 *   Fund brief    a one-paragraph description of this fund from its recorded facts.
 *   Letter draft  the letter's opening paragraph from this period's recorded capital movements.
 *
 * The builders are pure: the route reads the rows (the period's through `periodMovements`) and passes them in. Each builder returns the material the model is given, as
 * numbered lines, and the sources those numbers name, so the draft cites [n] and the page lists what [n] is. A
 * builder with nothing recorded returns null, and the route refuses before any model is called.
 *
 * The letter keeps the rules of the library skill `lp-quarterly-letter-draft` (services/agents/skills): amounts as
 * recorded with their dates, "Not recorded" for what is missing, and no projected returns. That skill drafts the
 * whole letter for an agent run; this drafts only the opening paragraph a GP accepts into the editor, so it shares
 * the skill's rules rather than its prompt.
 */

import type { Env } from '../types';
import { formatMinor } from '../../../frontend/src/lib/money.js';

export interface DraftSource { n: number; kind: string; ref: string; label: string; date: string | null }
export interface DraftMaterial { lines: string[]; sources: DraftSource[] }

// The fund pages record USD (D631's `currency: 'USD'`); formatted by the shared money rules, never by hand.
const money = (cents: unknown): string | null =>
  Number.isSafeInteger(cents) && (cents as number) >= 0 ? formatMinor(cents as number, 'USD', { locale: 'en-US' }) : null;
const day = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export const BRIEF_INSTRUCTION = [
  'Write one paragraph describing this fund for a reader who has not seen it.',
  'Use only the numbered facts below and cite each fact you use with its number in brackets, like [2].',
  'Where a fact says Not recorded, leave it out or say it is not recorded. Never estimate it.',
  'Do not project returns, rate the fund, or say what anyone should do.',
].join(' ');

export const LETTER_INSTRUCTION = [
  "Write the opening paragraph of this period's quarterly letter to the fund's limited partners.",
  'Summarise only the numbered capital movements below: what was called and what was distributed, with amounts and dates as recorded.',
  'Cite each movement you mention with its number in brackets, like [1].',
  'Write "Not recorded" for anything the records do not give. Never project returns.',
  'This is a draft for the general partner to edit and issue; never write as though it has been sent.',
].join(' ');

/**
 * The brief's facts, from `readFundPage`'s shape. Null when nothing beyond the name is recorded: a description of a
 * fund with no facts would be written from the model's own knowledge.
 */
export function briefMaterial(page: any): DraftMaterial | null {
  const f = page?.fund;
  if (!f || typeof f.name !== 'string') return null;
  const facts: Array<[string, string, string, string | null]> = [];
  const add = (kind: string, ref: string, label: string, value: string | null, date: string | null = null) => {
    if (value !== null && value !== undefined && value !== '') facts.push([kind, ref, `${label}: ${value}`, date]);
  };
  add('fund', `fund:${f.id}:status`, 'Status', f.status ?? null);
  add('fund', `fund:${f.id}:vintage`, 'Vintage year', f.vintage_year != null ? String(f.vintage_year) : null);
  add('fund', `fund:${f.id}:size`, 'Target size (USD)', money(f.size_cents));
  // With no LP there is no commitment to speak of: the page's $0.00 is the empty sum, not a recorded figure.
  if (Number.isSafeInteger(f.lp_count) && f.lp_count > 0) {
    add('limited_partners', `fund:${f.id}:lps`, 'Limited partners (counted live)', String(f.lp_count));
    add('limited_partners', `fund:${f.id}:committed`, 'Committed by LPs (USD)', money(page?.totals?.committed_cents));
  }
  add('positions', `fund:${f.id}:invested`, 'Invested in attributed positions (USD)', money(page?.totals?.invested_cents));
  add('fund', `fund:${f.id}:gp`, 'General partner of record', [f.gp?.name, f.gp?.entity].filter(Boolean).join(', ') || null);
  for (const [key, label] of [['fund_admin', 'Fund administrator'], ['auditor', 'Auditor'], ['legal_counsel', 'Legal counsel'], ['custodian', 'Custodian']] as const) {
    add('fund', `fund:${f.id}:${key}`, label, f.providers?.[key] ?? null);
  }
  if (page?.lpa?.status) add('lpa', `fund:${f.id}:lpa`, 'Limited partnership agreement', `${page.lpa.status}${page.lpa.version != null ? `, version ${page.lpa.version}` : ''}`, day(page.lpa.updated_at));
  if (!facts.length) return null;
  const sources = facts.map(([kind, ref, label, date], i) => ({ n: i + 1, kind, ref, label, date }));
  return { lines: [`Fund: ${f.name}`, ...sources.map((s) => `[${s.n}] ${s.label}${s.date ? ` (${s.date})` : ''}`)], sources };
}

/**
 * The period's recorded capital calls and paid distributions, the rows `letterMaterial` reads. D6242 (#6242) reads
 * the same rows for the whole letter's draft on the `funds/reporting` surface, so both drafts speak of one set.
 */
export async function periodMovements(env: Env, fundId: number, start: string, end: string) {
  const calls = await env.DB.prepare(
    `SELECT id, call_number, amount_cents, purpose, due_date, created_at FROM fund_capital_calls
      WHERE fund_id = ? AND date(created_at) BETWEEN date(?) AND date(?) ORDER BY created_at, id LIMIT 50`,
  ).bind(fundId, start, end).all<any>();
  const dists = await env.DB.prepare(
    `SELECT id, amount_cents, distribution_type, distributed_at, created_at FROM fund_distributions
      WHERE fund_id = ? AND status = 'paid' AND date(COALESCE(distributed_at, created_at)) BETWEEN date(?) AND date(?)
      ORDER BY COALESCE(distributed_at, created_at), id LIMIT 500`,
  ).bind(fundId, start, end).all<any>();
  return { calls: calls.results || [], distributions: dists.results || [] };
}

/**
 * The letter's movements in the period: capital calls recorded in it and distributions paid in it, both inclusive
 * of the period's start and end dates. Null when the period has no dates or no movement.
 */
export function letterMaterial(
  period: { period: string; period_start: string | null; period_end: string | null },
  calls: Array<{ id: number; call_number: number; amount_cents: number; purpose: string | null; due_date: string | null; created_at: string }>,
  distributions: Array<{ id: number; amount_cents: number; distribution_type: string; distributed_at: string | null; created_at: string }>,
): DraftMaterial | null {
  const start = day(period?.period_start); const end = day(period?.period_end);
  if (!start || !end) return null;
  const inside = (d: string | null) => !!d && d >= start && d <= end;
  const movements: Array<Omit<DraftSource, 'n'> & { line: string }> = [];
  for (const c of calls || []) {
    const d = day(c.created_at);
    if (!inside(d) || !money(c.amount_cents)) continue;
    movements.push({ kind: 'capital_call', ref: `capital_call:${c.id}`, label: `Capital call ${c.call_number}`, date: d,
      line: `Capital call ${c.call_number}, recorded ${d}: ${money(c.amount_cents)}${c.due_date ? `, due ${day(c.due_date) ?? 'Not recorded'}` : ', due date Not recorded'}${c.purpose ? `, for ${String(c.purpose).slice(0, 200)}` : ''}` });
  }
  // Distributions are one row per LP; the letter speaks of them by date and type, so they are summed per both.
  const groups = new Map<string, { date: string; type: string; cents: number; ids: number[] }>();
  for (const r of distributions || []) {
    const d = day(r.distributed_at ?? r.created_at);
    if (!inside(d) || !Number.isSafeInteger(r.amount_cents) || r.amount_cents <= 0) continue;
    const key = `${d}|${r.distribution_type}`;
    const g = groups.get(key) ?? { date: d as string, type: String(r.distribution_type), cents: 0, ids: [] };
    g.cents += r.amount_cents; g.ids.push(r.id); groups.set(key, g);
  }
  for (const g of [...groups.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const type = g.type.replace(/_/g, ' ');
    movements.push({ kind: 'distribution', ref: `distribution:${g.ids.join(',')}`, label: `Distribution (${type})`, date: g.date,
      line: `Distribution, ${type}, paid ${g.date}: ${money(g.cents)} across ${g.ids.length} LP${g.ids.length === 1 ? '' : 's'}` });
  }
  if (!movements.length) return null;
  movements.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const sources = movements.map(({ line: _line, ...s }, i) => ({ n: i + 1, ...s }));
  return { lines: [`Period: ${period.period} (${start} to ${end})`, ...movements.map((m, i) => `[${i + 1}] ${m.line}`)], sources };
}

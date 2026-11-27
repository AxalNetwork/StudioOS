/**
 * D1242 (#3255, part 6 of #2423) — Deal flow's Studio lens for an admin or an
 * Operating Partner (DLS11, DLS11b, DLS12): the same /deals list, with the
 * board's columns the ROUND's status (`dealFlowModel.ROUND_WORD`), the table's
 * extra columns (Lead partner, Investors, Source), each row's menu, and who
 * set a Not raising round so. Pure, so `frontend/test/deal_studio_lens_d1242.test.mjs`
 * holds each rule.
 *
 * READ. `GET /api/deals/studio` (`services/dealStudioLens.ts`): every round,
 * each with `can_move` from the Worker's own rule (an admin any round, an
 * Operating Partner only the rounds they lead), so the menu never offers a
 * move the Worker refuses.
 *
 * D5916 (#5916, Deals v2 board DE12, canvas section DX12): the lens redrawn.
 * Above the rounds, the stage strip (every round counted by its status,
 * Not raising included) and the Needs attention strip, each count worked out
 * from this one read; the Table is the default view; the table's columns are
 * the canvas's. Two of the canvas's five attention counts have no field
 * behind them in this read and are left out (`ATTENTION_NOT_COUNTED`).
 */
import { BASE, ROUND_WORD, roundWord } from './dealFlowModel';
import { roundAsk } from '../../../components/deals/dealMoney.js';
import { DEFAULT_SLA, slaBand } from '../../../lib/dealFlow.js';

export const CRUMB = 'Studio';
export const STUDIO_LINE = 'Every active round, who owns it, who is engaged and what needs attention.';

/** The board's columns: the round's pipeline. Not raising sits outside, as a filter. */
export const LENS_COLUMNS = Object.freeze(['applied', 'scored', 'active', 'funded']);
const NOT_RAISING = 'rejected';

/** DX12's stage strip: the four pipeline statuses, then Not raising. */
export const STAGE_STRIP = Object.freeze([...LENS_COLUMNS, NOT_RAISING]);

/**
 * DX12's Needs attention strip, the counts this read can back. Each `rule` is
 * the sentence the chip's title gives, so nobody has to guess what it counts.
 */
export const ATTENTION = Object.freeze([
  { key: 'no_owner', label: 'No owner', chip: 'no owner', rule: 'An open round with no lead partner recorded.' },
  { key: 'stale', label: 'Stale', chip: 'stale', rule: 'An open round past the red band of your Stage SLA in its current status.' },
  { key: 'terms_missing', label: 'Terms missing', chip: 'terms missing', rule: 'A Screened or Raising round with no ask, no instrument or no minimum check recorded.' },
]);

/** The canvas's two other counts: no field of `GET /api/deals/studio` records them, so they are not drawn (D5916). */
export const ATTENTION_NOT_COUNTED = Object.freeze([
  { key: 'investor_waiting', label: 'Investor waiting', why: 'No field records an investor waiting on the studio: an interested invitation is the investor’s next step, not the studio’s.' },
  { key: 'closing_blocked', label: 'Closing blocked', why: 'The read carries no closing checklist or blocker.' },
]);

const ATTENTION_KEYS = new Set(ATTENTION.map((a) => a.key));
const isStage = (v) => LENS_COLUMNS.includes(v);

/**
 * What the address names on the lens: Table (the default, DX12) or Board; the
 * round filter (a pipeline status from the stage strip, or Not raising,
 * optionally intake's alone); and one Needs attention filter.
 */
export function studioViewOf(search = '') {
  const q = new URLSearchParams(String(search));
  const view = q.get('view') === 'board' ? 'board' : 'table';
  const round = q.get('round');
  const notRaising = round === 'not_raising';
  const intakeOnly = notRaising && q.get('by') === 'intake';
  const stage = !notRaising && isStage(round) ? round : null;
  const attention = !notRaising && ATTENTION_KEYS.has(q.get('attention')) ? q.get('attention') : null;
  return { view, notRaising, intakeOnly, stage, attention };
}

export function studioViewHref({ view = 'table', notRaising = false, intakeOnly = false, stage = null, attention = null } = {}) {
  const q = new URLSearchParams();
  if (view === 'board' && !notRaising) q.set('view', 'board');
  if (notRaising) q.set('round', 'not_raising');
  else if (isStage(stage)) q.set('round', stage);
  if (notRaising && intakeOnly) q.set('by', 'intake');
  if (!notRaising && ATTENTION_KEYS.has(attention)) q.set('attention', attention);
  const s = q.toString();
  return s ? `${BASE}?${s}` : BASE;
}

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** One round from one `GET /api/deals/studio` row. A value the read did not return stays null. */
export function studioRow(r = {}) {
  const inv = r.investors || {};
  return {
    id: String(r.id ?? ''),
    name: r.project_name || 'Name not recorded',
    sector: r.project_sector || null,
    status: r.status || null,
    round: roundWord(r.status),
    ask: roundAsk(r),
    currency: r.currency || null,
    source: r.source || null,
    lead: r.lead_partner_name || null,
    hasLead: r.lead_partner_id != null || Boolean(r.lead_partner_name),
    youLead: r.you_lead === true,
    canMove: r.can_move === true,
    daysInStage: num(r.days_in_stage),
    investors: { invited: num(inv.invited), interested: num(inv.interested), committed: num(inv.committed) },
    notRaisingBy: r.not_raising_by || null,
    passedBy: r.passed_by_name || null,
    terms: r.terms || {},
  };
}

/** "[6] invited · [2] interested · [1] committed", "Not invited yet", or null when the counts were not read. */
export function investorsLine({ invited, interested, committed } = {}) {
  if (invited == null || interested == null || committed == null) return null;
  if (invited === 0 && committed === 0) return 'Not invited yet';
  return `${invited} invited · ${interested} interested · ${committed} committed`;
}

/** Who set a Not raising round so, in words. Intake is never a pass. */
export function notRaisingLine(row) {
  if (row?.status !== NOT_RAISING) return null;
  if (row.notRaisingBy === 'intake') return 'Set to Not raising by intake scoring, not by a person';
  if (row.notRaisingBy === 'person') return row.passedBy ? `Passed by ${row.passedBy}` : 'Passed by a person whose name is not recorded';
  return 'Who set it is not recorded';
}

/** The round's next status in the pipeline, or null at Funded and Not raising. */
export function nextStatus(status) {
  const i = LENS_COLUMNS.indexOf(status);
  return i >= 0 && i < LENS_COLUMNS.length - 1 ? LENS_COLUMNS[i + 1] : null;
}

/**
 * A row's menu (DLS11, DLS12). Advance and Pass only where this caller may
 * move the round; Invite investors for an admin on a Screened or Raising round
 * (the Worker's own rule), on the deal page; Edit terms where they may move it.
 */
export function rowActions(row, role) {
  const out = [];
  if (!row) return out;
  if (row.canMove && nextStatus(row.status)) out.push({ key: 'advance', label: 'Advance' });
  if (row.canMove && row.status !== NOT_RAISING) out.push({ key: 'pass', label: 'Pass…' });
  if (role === 'admin' && (row.status === 'scored' || row.status === 'active')) {
    out.push({ key: 'invite', label: 'Invite investors', href: `/deals/${encodeURIComponent(row.id)}/invitations` });
  }
  if (row.canMove) out.push({ key: 'terms', label: 'Edit terms' });
  return out;
}

/**
 * DX12's row actions: Advance as the row's own button, the rest (Pass,
 * Invite investors, Edit terms) behind More. Both empty where this caller may
 * not move the round, so an Operating Partner sees no control on a round
 * someone else leads.
 */
export function splitActions(row, role) {
  const all = rowActions(row, role);
  return { primary: all.find((a) => a.key === 'advance') || null, more: all.filter((a) => a.key !== 'advance') };
}

/** The table's column heads (DX12), in the canvas's order. */
export const TABLE_COLUMNS = Object.freeze(['Company', 'Round status', 'Scorecard', 'Lead', 'Investors', 'Ask', 'Committed', 'Source', 'Days', 'Attention']);

/** Why Committed is not a figure: the read counts committed investors, not what they committed. */
export const COMMITTED_NOT_READ = 'This read counts the investors who committed, not the amount.';

/** The committed cell: "1 investor", "3 investors", or null when the count was not read. */
export function committedLine(row) {
  const n = row?.investors?.committed;
  if (n == null) return null;
  return `${n} ${n === 1 ? 'investor' : 'investors'}`;
}

/** The foot of an admin's table (DX12). */
export const PARTNER_FOOT = 'Operating Partners see the same table; actions appear only on rounds they lead.';

/** The line above an Operating Partner's lens (DLS12). */
export const PARTNER_NOTE = 'You can move the rounds you lead. The studio moves the rest.';

/** The line every studio pass carries (DLS11): it is not an investor's pass. */
export const PASS_CLOSES = 'This closes the round for every investor and tells the founder.';

/** The notice above the board (DLS11), or null when intake set none. */
export function intakeNotice(n) {
  const k = num(n);
  if (!k) return null;
  return `${k} ${k === 1 ? 'round was' : 'rounds were'} set to Not raising by intake scoring, not by a person.`;
}

/** An open round: In intake, Screened or Raising. Funded and Not raising need no owner and do not go stale. */
const OPEN = new Set(['applied', 'scored', 'active']);
const blank = (v) => v == null || v === '';

/** The Needs attention keys one round carries, in the strip's order, against the viewer's Stage SLA. */
export function attentionOf(row, sla = DEFAULT_SLA) {
  if (!row || !OPEN.has(row.status)) return [];
  const out = [];
  if (!row.hasLead) out.push('no_owner');
  if (slaBand(row.daysInStage, sla) === 'red') out.push('stale');
  if ((row.status === 'scored' || row.status === 'active')
    && (row.ask == null || blank(row.terms?.instrument) || blank(row.terms?.minimum_check))) out.push('terms_missing');
  return out;
}

/** The strip's counts over every round the read returned (never over a filtered view). */
export function attentionCounts(rows = [], sla = DEFAULT_SLA) {
  const out = Object.fromEntries(ATTENTION.map((a) => [a.key, 0]));
  for (const r of rows) for (const k of attentionOf(r, sla)) out[k] += 1;
  return out;
}

/** "2 no owner", the chip's words. */
export function attentionChip(key, n) {
  const a = ATTENTION.find((x) => x.key === key);
  return a ? `${n} ${a.chip}` : null;
}

/** The stage strip's counts: every round the read returned, by status. A status the strip does not name is not counted. */
export function stageCounts(rows = []) {
  const out = Object.fromEntries(STAGE_STRIP.map((s) => [s, 0]));
  for (const r of rows) if (r.status in out) out[r.status] += 1;
  return out;
}

/**
 * The rows the view shows: the pipeline, or Not raising (optionally intake's
 * alone), then the stage strip's status and the attention filter, narrowed by
 * the search. The attention filter needs the SLA the strip counted with.
 */
export function lensRows(rows = [], { notRaising = false, intakeOnly = false, stage = null, attention = null, sla = DEFAULT_SLA, q = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (notRaising ? r.status !== NOT_RAISING : r.status === NOT_RAISING) return false;
    if (intakeOnly && r.notRaisingBy !== 'intake') return false;
    if (!notRaising && stage && r.status !== stage) return false;
    if (!notRaising && attention && !attentionOf(r, sla).includes(attention)) return false;
    if (!needle) return true;
    return [r.name, r.sector, r.lead, r.source].some((v) => String(v || '').toLowerCase().includes(needle));
  });
}

/** A column's head (DLS11): its count and its asks, per currency, with those that record none counted apart. */
export function columnSummary(rows = []) {
  const byCurrency = new Map();
  let none = 0;
  for (const r of rows) {
    if (r.ask == null || r.ask <= 0) { none += 1; continue; }
    const c = r.currency || 'USD';
    byCurrency.set(c, (byCurrency.get(c) || 0) + r.ask);
  }
  return { count: rows.length, asks: [...byCurrency.entries()].map(([currency, total]) => ({ currency, total })), none };
}

export { ROUND_WORD };

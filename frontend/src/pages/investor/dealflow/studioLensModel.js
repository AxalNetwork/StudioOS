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
 */
import { BASE, ROUND_WORD, roundWord } from './dealFlowModel';

export const CRUMB = 'Studio';
export const STUDIO_LINE = 'Every round on the platform, how it scores, and who is looking at it.';

/** The board's columns: the round's pipeline. Not raising sits outside, as a filter. */
export const LENS_COLUMNS = Object.freeze(['applied', 'scored', 'active', 'funded']);
const NOT_RAISING = 'rejected';

/** What the address names on the lens: Board or Table, and the Not raising filter (optionally intake's alone). */
export function studioViewOf(search = '') {
  const q = new URLSearchParams(String(search));
  const view = q.get('view') === 'table' ? 'table' : 'board';
  const notRaising = q.get('round') === 'not_raising';
  const intakeOnly = notRaising && q.get('by') === 'intake';
  return { view, notRaising, intakeOnly };
}

export function studioViewHref({ view = 'board', notRaising = false, intakeOnly = false } = {}) {
  const q = new URLSearchParams();
  if (view === 'table') q.set('view', 'table');
  if (notRaising) q.set('round', 'not_raising');
  if (notRaising && intakeOnly) q.set('by', 'intake');
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
    ask: num(r.amount ?? r.target_raise),
    currency: r.currency || null,
    source: r.source || null,
    lead: r.lead_partner_name || null,
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

/** The rows the view shows: the pipeline, or Not raising (optionally intake's alone), narrowed by the search. */
export function lensRows(rows = [], { notRaising = false, intakeOnly = false, q = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (notRaising ? r.status !== NOT_RAISING : r.status === NOT_RAISING) return false;
    if (intakeOnly && r.notRaisingBy !== 'intake') return false;
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

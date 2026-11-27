/**
 * D6049 (#6049, Raise v2 RA-16) — Fundraising readiness in one order: the
 * header's coverage line, at most three priorities, then every area in one
 * table. Pure view builders over the module read's own records
 * (`readinessRecords` in `services/raiseCycle.ts`); nothing is scored here.
 *
 * Product-market fit is not an area: its row (`id: 'pmf'`) is left out of the
 * table, the priorities and the coverage, and drawn as its own section
 * (`PmfPart`), so it is never averaged into readiness (RA-16).
 *
 * No store holds a target for any area (RA-16 draws none, and the Worker has
 * no column for one), so every area says `NO_TARGET` rather than a number.
 *
 * Each action opens the workflow the Worker names for that item
 * (`cells.fix_href`, D5071); the address is never worked out here.
 */
import { appPath, dayWord } from './pmfModel.js';

export const NO_TARGET = 'Not recorded · no target set';
export const MAX_PRIORITIES = 3;
/** The Worker's order (`READINESS_ITEMS`), less Product-market fit. */
export const AREA_ORDER = ['narrative', 'deck', 'data_room', 'cap_table', 'use_of_funds', 'traction', 'team'];

/** Why each area matters to an investor, in RA-16's words where it has them. */
export const WHY = {
  narrative: 'Investors ask for the story first.',
  deck: 'Nothing can be shared without it.',
  data_room: 'Diligence stalls without it.',
  cap_table: 'Investors check who owns what before terms.',
  use_of_funds: 'It says what this round buys.',
  traction: 'Claims need a measured source.',
  team: 'Investors back the people first.',
};

/** The words on each area's one action. Where it goes is the Worker's `fix_href`. */
export const ACTION = {
  narrative: 'Open the narrative',
  deck: 'Open the Pitch Studio',
  data_room: 'Open the data room checklist',
  cap_table: 'Open the cap table',
  use_of_funds: 'Open Use of funds',
  traction: 'Open Metrics',
  team: 'Open the founding team',
};

const EVIDENCE_WORD = { measured: 'Measured', stated: 'Stated', pattern: 'Pattern', anecdote: 'Anecdote' };

/**
 * RA-23's words for an area, each with its tone:
 *   Ready            scored, nothing missing
 *   Needs attention  scored, with something missing
 *   Missing          nothing to score yet (no score, or a measured 0), with something missing
 *   Stale            its inputs changed since it was scored (D5071 freshness)
 *   Unavailable      its check could not read its store just now
 *   Not recorded     no check or person has assessed it
 */
export const STATUS = {
  ready: { word: 'Ready', tone: 'ok' },
  attention: { word: 'Needs attention', tone: 'warn' },
  missing: { word: 'Missing', tone: 'bad' },
  stale: { word: 'Stale', tone: 'warn' },
  unavailable: { word: 'Unavailable', tone: 'grey' },
  not_recorded: { word: 'Not recorded', tone: 'dashed' },
};
/** The states a priority is drawn from. Not recorded is coverage, not a gap. */
const NEEDS = new Set(['missing', 'attention', 'stale', 'unavailable']);

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v) => (v == null ? '' : String(v).trim());
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function statusOf(cells) {
  const assessed = cells.updated != null && cells.updated !== '';
  if (!assessed) return 'not_recorded';
  const missing = text(cells.missing);
  if (/^unavailable\b/i.test(missing)) return 'unavailable';
  if (/^stale\b/i.test(text(cells.freshness))) return 'stale';
  const score = num(cells.score);
  if (!missing) return score == null ? 'not_recorded' : 'ready';
  return score == null || score === 0 ? 'missing' : 'attention';
}

/** One area as its row draws it. */
export function areaRow(row) {
  const cells = row?.cells && typeof row.cells === 'object' ? row.cells : {};
  const key = typeof row?.id === 'string' ? row.id : null;
  const state = statusOf(cells);
  const score = num(cells.score);
  const day = dayWord(cells.updated);
  const scoreLine = state === 'not_recorded'
    ? 'Not recorded · not assessed yet'
    : [score == null ? 'Not scored' : `${score} of 10`, EVIDENCE_WORD[cells.evidence] || null, day ? `as of ${day}` : null].filter(Boolean).join(' · ');
  const missing = text(cells.missing);
  const fresh = text(cells.freshness);
  const href = appPath(cells.fix_href);
  return {
    key,
    label: text(cells.item) || 'Not recorded',
    state, status: STATUS[state].word, tone: STATUS[state].tone,
    score, day,
    // The evidence column leads with what is missing; the score line follows it.
    evidence: state !== 'ready' && state !== 'not_recorded' && missing ? missing : scoreLine,
    evidenceSub: state !== 'ready' && state !== 'not_recorded' && missing ? scoreLine : null,
    freshness: fresh === 'Unavailable' ? 'Freshness unavailable · its check could not run just now' : null,
    target: NO_TARGET,
    why: state === 'ready' ? null : WHY[key] || null,
    // Ready needs no action; any other state opens the workflow that fixes it, where the Worker names one.
    action: state !== 'ready' && href ? { text: ACTION[key] || `Open ${text(cells.item) || 'the area'}`, href } : null,
    raw: row,
  };
}

/**
 * The areas, in the Worker's order, Product-market fit left out.
 * `{ state: 'unreadable' }` when the read failed; `{ state: 'loading' }` while it reads.
 */
export function areasOf(records, status = 'ready') {
  if (status === 'loading') return { state: 'loading', rows: [] };
  if (status === 'unreadable' || records?.state === 'unreadable') return { state: 'unreadable', rows: [] };
  const rows = (Array.isArray(records?.rows) ? records.rows : [])
    .filter((r) => r && r.id !== 'pmf')
    .map(areaRow);
  const at = (k) => { const i = AREA_ORDER.indexOf(k); return i < 0 ? AREA_ORDER.length : i; };
  rows.sort((a, b) => at(a.key) - at(b.key));
  return { state: 'ready', rows };
}

/** The mean of the scored areas, out of 100, as `overallReadiness` reads it; null with none. */
export function overall(rows) {
  const xs = rows.map((r) => r.score).filter((s) => s != null);
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) : null;
}

/**
 * At most three priorities: the areas that need attention and have a
 * workflow to fix them, Team never (it is assessed by a person, as on the
 * Overview's next steps). The largest gain first (the area at 10, the mean
 * of the others unchanged), then the Worker's order. A gain is used only to
 * order them; it is not drawn, so no number here can disagree with the
 * Overview's.
 */
export function priorities(rows) {
  const now = overall(rows);
  const gain = (r) => {
    if (now == null) return 0;
    const next = overall(rows.map((x) => (x === r ? { ...x, score: 10 } : x)));
    return next - now;
  };
  const order = (k) => { const i = AREA_ORDER.indexOf(k); return i < 0 ? AREA_ORDER.length : i; };
  return rows
    .filter((r) => NEEDS.has(r.state) && r.key !== 'team' && r.action)
    .map((r) => ({ ...r, gain: gain(r) }))
    .sort((a, b) => b.gain - a.gain || order(a.key) - order(b.key))
    .slice(0, MAX_PRIORITIES)
    .map((r) => ({
      key: r.key, label: r.label, status: r.status, tone: r.tone,
      reason: r.state === 'stale' ? 'Its inputs changed since it was scored.' : r.evidence,
      action: r.action,
    }));
}

/** "7 areas: 3 ready, 2 missing, 1 needs attention, 1 not recorded", in RA-16's order of words. */
export function summaryLine(rows) {
  if (!rows.length) return 'No area is assessed yet.';
  const counts = Object.keys(STATUS).map((k) => [STATUS[k].word, rows.filter((r) => r.state === k).length]).filter(([, n]) => n > 0);
  return `${plural(rows.length, 'fundraising area', 'fundraising areas')}: ${counts.map(([w, n]) => `${n} ${w.toLowerCase()}`).join(', ')}`;
}

/**
 * The header's coverage and freshness line (RA-16): "5 of 7 areas assessed ·
 * 3 need attention · last assessed 21 Oct 2026". Null when the read is not
 * here or failed, so the header never claims a coverage it did not read.
 */
export function coverageLine(records) {
  const areas = areasOf(records);
  if (!records || areas.state !== 'ready' || !areas.rows.length) return null;
  const rows = areas.rows;
  const assessed = rows.filter((r) => r.state !== 'not_recorded').length;
  const need = rows.filter((r) => NEEDS.has(r.state)).length;
  const days = rows.map((r) => r.raw?.cells?.updated).filter((d) => typeof d === 'string' && dayWord(d)).sort();
  const last = days.length ? dayWord(days[days.length - 1]) : null;
  return [
    `${assessed} of ${plural(rows.length, 'area', 'areas')} assessed`,
    need ? `${need} ${need === 1 ? 'needs' : 'need'} attention` : 'none needs attention',
    last ? `last assessed ${last}` : 'last assessed: Not recorded',
  ].join(' · ');
}

/** D5081 part 5 (#5081, RA-12, RA-14): the header's words for Fundraising readiness' own primary. */
export const FIX_NEXT = 'Fix next priority';

/**
 * Fundraising readiness' header action (RA-14): Fix next priority, opening the workflow of the first priority the
 * page lists (`priorities`), never Raise's global Build your deck. None while the read is not here or failed, and
 * none when no assessed area needs attention, so the header never offers a fix the read does not name.
 */
export function nextPriorityAction(records) {
  if (!records || records.state === 'unreadable') return null;
  const areas = areasOf(records);
  if (areas.state !== 'ready') return null;
  const first = priorities(areas.rows)[0];
  return first?.action?.href ? { label: FIX_NEXT, href: first.action.href } : null;
}

/**
 * D5900 (#5900, Deals v2 DX1b) — the deal card's rules (boards DE01, DE01b)
 * and the shared score's view, as pure functions. No React here.
 *
 * A SCORE IS A BAND (D1240, D5900). `POST /api/venture-scores/batch` sends per
 * scope its state, band and confidence word and no number, so the shared
 * score says the band and confidence the Worker sent ("Team: Strong, high
 * confidence"), never a figure, and never 0 for a missing one. Each kind of
 * absence is its own family, drawn apart by `ScopeScore`:
 *
 *   missing        the batch holds no row for the scope   "Not scored"
 *   not_recorded   a row, but too little recorded to score "Not enough recorded"
 *   not_expected   not expected at the venture's stage    "Not expected yet"
 *   unreadable     the scope, or the whole read, failed   "Unreadable" / "—"
 *   locked         the founder has not shared it           "Locked"
 *   not_shared     the batch left the deal out             "Not shared"
 *   loading        still reading                           "Reading…"
 *
 * The card's states (DE01b) come from fields the reads already carry: Passed
 * is the flow's `stage`, Unassigned its `owner`, Stale its `days_in_stage`
 * against the product's one stage SLA (`lib/dealFlow.js` `slaBand`, the
 * Standard preset), Locked and Low confidence the batch.
 */

import { DEFAULT_SLA, slaBand, slaPreset } from '../../../lib/dealFlow.js';
import { SCOPE_LABEL, STAGE_WORD } from './flowModel.js';

/** `flowModel.scopeCell`'s kind → the family the shared score draws. */
export const SCORE_FAMILY = Object.freeze({
  scored: 'value',
  not_scored: 'missing',
  not_enough: 'not_recorded',
  not_expected: 'not_expected',
  unreadable: 'unreadable',
  failed: 'unreadable',
  locked: 'locked',
  not_shared: 'not_shared',
  loading: 'loading',
});

/**
 * The shared score's view of one `scopeCell`: its family, the word drawn,
 * the confidence, and the sentence a screen reader announces. Only values
 * the Worker sent go into it, so the sentence never carries a figure.
 */
export function scoreView(cell, label) {
  const family = SCORE_FAMILY[cell?.kind] || 'loading';
  const word = cell?.word || 'Reading…';
  if (family === 'value') {
    const confidence = cell.confidence || null;
    return {
      family, word, confidence, low: confidence === 'Low',
      announce: `${label}: ${word}, ${confidence ? `${confidence.toLowerCase()} confidence` : 'confidence not recorded'}`,
      title: cell.title || null,
    };
  }
  // A whole read that failed draws "—" (D1240); it is announced as what it is.
  const said = family === 'unreadable' ? 'Unreadable' : word;
  return { family, word, confidence: null, low: false, announce: `${label}: ${said}`, title: cell?.title || null };
}

/** The scope's label for the shared score (SCORING's eleven, no Overall). */
export const scopeLabel = (key) => SCOPE_LABEL[key] || 'Scope';

// ---------------------------------------------------------------- the three status families

/**
 * Company status, my process and transaction status (D4815 "three status
 * families"), each its own shape on the card and never the same pill.
 *
 * - Company: where the company is. No read on the list carries the company's
 *   stage (`GET /api/deals/flow` and `GET /api/deals` select the venture's
 *   name and sector only), so it says Not recorded with that reason.
 * - My process: the firm's own stage on the flow (D1238).
 * - Transaction: the round's status, the studio's `deals.status` (D1236).
 */
export const COMPANY_UNRECORDED = 'The deal list does not carry the company’s stage yet.';
export const PLACE_UNRECORDED = 'The deal list does not carry where the company is based yet.';

export function familiesOf(row) {
  return {
    company: { word: 'Not recorded', title: COMPANY_UNRECORDED, recorded: false },
    process: { word: STAGE_WORD[row?.stage] || 'Not on your deals', title: 'My investment process' },
    transaction: { word: row?.round || 'Not recorded', title: 'The round’s status', recorded: !!row?.roundStatus },
  };
}

// ---------------------------------------------------------------- the card's states (DE01b)

/** The seven DE01b examples, in the canvas's order. "normal" is a card with none of the others. */
export const CARD_STATES = Object.freeze(['normal', 'low_confidence', 'missing', 'locked', 'stale', 'passed', 'unassigned']);

export const STALE_AFTER = slaPreset(DEFAULT_SLA).amber;
export const STALE_TITLE = `In this stage ${STALE_AFTER} days or more (the Standard stage SLA).`;

/**
 * Which DE01b states a row is in, from its reads. A card can be in more than
 * one (a stale, unassigned card); `normal` only when it is in none.
 *
 * - low_confidence: the batch scored at least one scope and every scored one is Low.
 * - missing: the scores were read and a scope chosen for the card is not scored.
 * - locked: the founder has not shared the scorecard.
 * - stale: on the board (not passed) and amber or red on the Standard SLA; an
 *   unrecorded stage start is never stale.
 */
export function cardStates(row, cards = [], cellOf = null) {
  const out = [];
  const scores = row?.scores || { state: 'loading', byScope: {} };
  if (scores.state === 'ok') {
    const scored = Object.values(scores.byScope || {}).filter((s) => s.state === 'scored' && s.band);
    if (scored.length && scored.every((s) => s.confidence === 'Low')) out.push('low_confidence');
    if (cellOf && cards.some((k) => cellOf(scores, k).kind !== 'scored')) out.push('missing');
  }
  if (scores.state === 'locked') out.push('locked');
  const passed = row?.stage === 'passed';
  if (!passed && ['amber', 'red'].includes(slaBand(row?.daysInStage, DEFAULT_SLA))) out.push('stale');
  if (passed) out.push('passed');
  if (row?.inFlow && !row?.owner) out.push('unassigned');
  return out.length ? out : ['normal'];
}

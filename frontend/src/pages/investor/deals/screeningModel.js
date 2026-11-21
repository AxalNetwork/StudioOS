/**
 * D4815 (#5909, canvas DX6, board DE06) — the rules of the Screening decision
 * table, kept pure so a test reads them without a page.
 *
 *   · The summary's four figures, each from a read: Deals to screen (the desk
 *     less the deals you have already decided), Scorecards ready and
 *     Low-confidence scorecards (the scorecard batch), and Stale screens,
 *     which no read carries and so is Not recorded.
 *   · A figure whose read failed or has not answered is `null` with its state
 *     (`unreadable` or `loading`); it is never 0.
 *   · Your decision is the investor's own deal flow: undecided offers Move to
 *     diligence and Pass; an unreadable flow offers Try again, never Pass.
 */
import { stripOf } from '../../../components/scoring/scorecard/scorecardModel';
import { passReasonLabel } from '../../../lib/dealFlow.js';

/** Columns the canvas draws and no read carries (named in D4815). */
export const NOT_IN_READ = Object.freeze(['Material risks', 'Last change', 'Stale screens']);

/** The flow's stages that are a decision already taken on a screened deal. */
const MOVED = Object.freeze({ diligence: 'Diligence', commit: 'Commit', closing: 'Closing' });

/**
 * The flow read as one state: `loading`, `failed`, `not_investor` (the Worker
 * refused a reader with no investor licence, so no decision is theirs to
 * record), or `ready` with a map of deal id to the flow row.
 */
export function flowStateOf(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'error') return read.error?.status === 403 ? { state: 'not_investor' } : { state: 'failed' };
  const items = Array.isArray(read.data?.items) ? read.data.items : [];
  return { state: 'ready', entries: new Map(items.map((f) => [Number(f.deal_id), f])) };
}

/**
 * One row's decision cell. `open` is the only state that offers Pass; an
 * unread flow is `unreadable` (Try again), never an invitation to decide.
 */
export function decisionOf(flow, dealId) {
  if (!flow || flow.state === 'loading') return { kind: 'loading', text: 'Reading…' };
  if (flow.state === 'failed') return { kind: 'unreadable', text: 'Unreadable' };
  if (flow.state === 'not_investor') return { kind: 'not_investor', text: 'An investor records this in their own deal flow.' };
  const entry = flow.entries.get(Number(dealId)) || null;
  if (entry?.stage === 'passed') return { kind: 'passed', text: `Passed · ${passReasonLabel(entry.pass?.reason)}`, entry };
  if (MOVED[entry?.stage]) return { kind: 'moved', text: `In ${MOVED[entry.stage]}`, entry };
  return { kind: 'open', entry };
}

/** A scorecard is ready when it is open to you and at least one scope is scored. */
export function isReady(item) {
  const s = stripOf(item);
  return s.state === 'open' && s.scopes.some((x) => x.state === 'scored');
}

/**
 * Low confidence: a ready scorecard whose every scored scope reads Low. A
 * scored scope with no confidence word is not counted as Low: that would be a
 * guess about a word the scorecard did not send.
 */
export function isLowConfidence(item) {
  if (!isReady(item)) return false;
  return stripOf(item).scopes.filter((x) => x.state === 'scored').every((x) => x.confidence === 'low');
}

/**
 * The Confidence cell: how many scored scopes read High, Medium and Low, as
 * the scorecard sends them. Never one word for the whole scorecard, because
 * the scorecard has none (eleven scopes, no total).
 */
export function confidenceCell(strips, dealId) {
  if (!strips || strips.status === 'loading') return { kind: 'loading', text: 'Reading…' };
  if (strips.status === 'error') return { kind: 'unreadable', text: 'Unreadable' };
  const s = stripOf(strips.items.get(Number(dealId)));
  if (s.state === 'closed' || s.state === 'locked') return { kind: 'closed', text: 'Not open to you' };
  if (s.state === 'unreadable') return { kind: 'unreadable', text: 'Unreadable' };
  const scored = s.scopes.filter((x) => x.state === 'scored');
  if (!scored.length) return { kind: 'not_scored', text: 'Not scored yet' };
  const n = (w) => scored.filter((x) => x.confidence === w).length;
  const parts = [['High', n('high')], ['Medium', n('medium')], ['Low', n('low')]].filter(([, c]) => c > 0).map(([w, c]) => `${w} ${c}`);
  const unworded = scored.length - n('high') - n('medium') - n('low');
  if (unworded > 0) parts.push(`${unworded} not recorded`);
  return { kind: 'scored', text: parts.join(' · '), low: scored.every((x) => x.confidence === 'low') };
}

/**
 * The four summary figures. Each is `{ value, state }`: `value` is a string
 * only when its read answered; otherwise `state` says why there is none.
 */
export function screeningSummary({ deals, strips, flow }) {
  const rows = deals?.available ? deals.rows || [] : null;
  const deskState = !deals ? 'loading' : deals.available ? 'ready' : 'unreadable';

  let toScreen = { value: null, state: deskState };
  if (rows) {
    if (flow?.state === 'loading' || !flow) toScreen = { value: null, state: 'loading' };
    else if (flow.state === 'failed') toScreen = { value: null, state: 'unreadable' };
    // Undecided: no decision of yours is recorded. A reader with no deal flow has recorded none.
    else toScreen = { value: String(rows.filter((r) => ['open', 'not_investor'].includes(decisionOf(flow, r.deal_id).kind)).length), state: 'ready' };
  }

  const stripState = !strips || strips.status === 'loading' ? 'loading' : strips.status === 'error' ? 'unreadable' : 'ready';
  const counted = (pred) => {
    if (!rows) return { value: null, state: deskState };
    if (stripState !== 'ready') return { value: null, state: stripState };
    return { value: String(rows.filter((r) => pred(strips.items.get(Number(r.deal_id)))).length), state: 'ready' };
  };

  return {
    toScreen,
    ready: counted(isReady),
    low: counted(isLowConfidence),
    // No read carries when a deal or its scorecard last changed (D4815, #5909).
    stale: { value: null, state: 'not_recorded' },
  };
}

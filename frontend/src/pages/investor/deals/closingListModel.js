/**
 * D4815 part 8 (#5911, canvas DX8, board DE08 A): the rules of the Closing
 * list, kept pure so a test drives them without a page.
 *
 *   · The KPI strip is five figures: Deals at closing, Paper executed,
 *     Signatures outstanding, Blocking conditions, Transfers recorded.
 *   · The list is by deal, not by document: investment, closing progress,
 *     signatures outstanding, open conditions, transfer state, and Open.
 *   · Every figure is `{ state, value, text, reason }`, with `state` one of
 *     `recorded`, `unrecorded`, `unreadable` or `loading`. A figure whose read
 *     failed is `unreadable` with a reason that names the read. It is never 0.
 *   · Paper reads in the agreement lifecycle's words (D4811 part 22, #5796):
 *     a completed envelope is "Executed".
 *
 * ONE PLACE TO SWAP. `closingRows` and `closingKpis` are the only functions
 * that join the zone's reads. When `GET /api/deals/closing-overview` (#6157)
 * lands, its per-deal parts (checklist, envelopes, conditions, transfer,
 * closing) already carry the same recorded/value or unreadable/null/reason
 * shape, so the zone's reads change here and nowhere else.
 */
import { formatMinor, majorToMinor, currencyCode } from '../../../lib/money.js';
import { dealStage } from '../../../lib/dealFlow.js';
import { AGREEMENT_STATES } from '../../../lib/contractLifecycle.js';

/** A read that has not answered yet. */
export const LOADING = Object.freeze({ state: 'loading' });
/** A read that failed. */
export const UNREADABLE = Object.freeze({ state: 'unreadable' });
/** A read that answered, with its list. */
export const ready = (items) => ({ state: 'ready', items: Array.isArray(items) ? items : [] });

/** The canvas's empty state (DE08 A). */
export const EMPTY_TITLE = 'No deals are currently in closing.';
export const EMPTY_BODY = 'Closing tracks documents, conditions and recorded transfer status.';

/** What each read is called when it could not be read. */
const READ_NAME = Object.freeze({
  deals: 'the deal record',
  envelopes: 'the signature archive',
  conditions: 'the conditions record',
  transfers: 'the transfers record',
});

/**
 * What waits on #6157 (`GET /api/deals/closing-overview`). Named here so the
 * page's limits block and the decision say one thing.
 */
export const WAITS_ON_OVERVIEW = Object.freeze([
  'one read in place of four lists and one checklist read per deal at closing',
  'the closing record (`closings.ts`) per deal, which no list read carries',
  'conditions on decisions you cannot see, which hold a transfer but are not in your conditions list',
]);

/**
 * An envelope's status in the agreement lifecycle's words. `completed` is the
 * only status that is Executed. `declined` has no lifecycle state, so it
 * keeps its own word, as Closings does (D4811 part 22).
 */
const PAPER_KEY = Object.freeze({ completed: 'executed', sent: 'sent', draft: 'prepared', voided: 'voided' });
export function paperWord(status) {
  const key = PAPER_KEY[status];
  if (key) return AGREEMENT_STATES[key].label;
  if (status === 'declined') return 'Declined';
  return 'Not recorded';
}

const figure = (state, extra = {}) => ({ state, value: null, text: null, reason: null, ...extra });
const recorded = (value, text) => figure('recorded', { value, text });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The first read in `names` that failed, else the first still loading, else null. */
function blocked(reads, names) {
  const failed = names.filter((n) => reads[n]?.state === 'unreadable');
  if (failed.length) {
    const list = failed.map((n) => READ_NAME[n]);
    const said = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
    return figure('unreadable', { reason: `${said} could not be read` });
  }
  if (names.some((n) => !reads[n] || reads[n].state === 'loading')) return figure('loading');
  return null;
}

/** The deals the shared stage map calls closing, as a read. */
export function closingDeals(dealsRead) {
  if (!dealsRead || dealsRead.state !== 'ready') return dealsRead || LOADING;
  return ready(dealsRead.items.filter((d) => dealStage(d) === 'closing'));
}

/**
 * Signatures still to come on one set of envelopes: only paper out for
 * signature (`sent`) has signatures outstanding. An envelope that records no
 * recipient cannot be counted and is reported apart, never folded in.
 */
export function outstandingOf(envelopes) {
  let outstanding = 0; let unrecorded = 0;
  for (const e of envelopes) {
    if (e.status !== 'sent') continue;
    const need = Number(e.recipient_count);
    const got = Number(e.signed_count);
    if (!Number.isFinite(need) || need <= 0) { unrecorded += 1; continue; }
    outstanding += Math.max(0, need - (Number.isFinite(got) ? got : 0));
  }
  return { outstanding, unrecorded };
}

/**
 * The investment on a deal: the round's confirmed commitments
 * (`capital_committed` on the deal list, major units) in the deal's currency.
 * None confirmed, or no currency, is Not recorded, never $0.
 */
export function investmentOf(deal) {
  const code = currencyCode(deal?.currency);
  const amount = Number(deal?.capital_committed);
  if (!code) return figure('unrecorded', { reason: 'the deal records no currency' });
  if (!Number.isFinite(amount) || amount <= 0) return figure('unrecorded', { reason: 'no commitment is confirmed' });
  const text = formatMinor(majorToMinor(amount, code), code, { trimWhole: true });
  return text ? recorded(amount, text) : figure('unrecorded', { reason: 'the amount cannot be shown' });
}

/**
 * Closing progress from the deal's checklist (migration 335): items done of
 * the items that count. A skipped item is not counted either way. `list` is
 * undefined while its read runs, UNREADABLE when it failed and null when no
 * checklist is applied.
 */
export function progressOf(list) {
  if (list === undefined || list === LOADING) return figure('loading');
  if (list === UNREADABLE) return figure('unreadable', { reason: 'this deal’s checklist could not be read' });
  if (!list) return figure('unrecorded', { reason: 'no closing checklist is applied' });
  const items = Array.isArray(list.items) ? list.items : [];
  const counted = items.filter((i) => i.state !== 'skipped');
  if (!counted.length) return figure('unrecorded', { reason: 'the checklist has no items yet' });
  const done = counted.filter((i) => i.state === 'done').length;
  return recorded(done, `${done} of ${counted.length}`);
}

/**
 * One row per deal at closing. `reads` is `{ deals, envelopes, conditions,
 * transfers }`, each LOADING, UNREADABLE or `ready(items)`; `checklists` maps
 * a deal id to its checklist read (see `progressOf`). Returns the deals' own
 * state and the rows; with the deal record unread there are no rows to draw.
 */
export function closingRows(reads, checklists = {}) {
  const deals = closingDeals(reads.deals);
  if (deals.state !== 'ready') return { state: deals.state, rows: [] };
  const rows = deals.items.map((d) => {
    const id = d.id;
    const own = (read) => read.items.filter((x) => x.deal_id != null && Number(x.deal_id) === Number(id));

    let signatures = blocked(reads, ['envelopes']);
    if (!signatures) {
      const { outstanding, unrecorded } = outstandingOf(own(reads.envelopes));
      signatures = recorded(outstanding, String(outstanding));
      if (unrecorded) signatures.reason = `${plural(unrecorded, 'envelope records', 'envelopes record')} no recipient and ${unrecorded === 1 ? 'is' : 'are'} not counted`;
    }

    let conditions = blocked(reads, ['conditions']);
    if (!conditions) {
      const n = own(reads.conditions).length;
      conditions = recorded(n, String(n));
    }

    let transfer = blocked(reads, ['transfers']);
    if (!transfer) {
      const n = own(reads.transfers).length;
      transfer = recorded(n, n ? (n === 1 ? 'Transfer recorded' : `${n} transfers recorded`) : 'Transfer not recorded');
    }

    return {
      id,
      name: d.project_name || `Deal #${id}`,
      // D6866: Open lands on the deal's closing workspace (DX17 to DX22).
      href: `/deals/closing?deal=${id}`,
      investment: investmentOf(d),
      progress: progressOf(checklists[id]),
      signatures,
      conditions,
      transfer,
    };
  });
  return { state: 'ready', rows };
}

/**
 * The strip's five figures. Every one but the first is a join on the deals at
 * closing, so it needs the deal record AND its own read, and names whichever
 * is missing.
 */
export function closingKpis(reads) {
  const deals = closingDeals(reads.deals);
  const ids = deals.state === 'ready' ? new Set(deals.items.map((d) => Number(d.id))) : new Set();
  const on = (read) => read.items.filter((x) => x.deal_id != null && ids.has(Number(x.deal_id)));
  const kpi = (key, label, needs, compute) => ({ key, label, ...(blocked(reads, needs) || compute()) });

  return [
    kpi('deals', 'Deals at closing', ['deals'], () => recorded(deals.items.length, String(deals.items.length))),
    kpi('executed', 'Paper executed', ['deals', 'envelopes'], () => {
      const paper = on(reads.envelopes);
      const executed = paper.filter((e) => e.status === 'completed').length;
      return { ...recorded(executed, `${executed} of ${paper.length}`), reason: 'executed means the envelope is completed' };
    }),
    kpi('signatures', 'Signatures outstanding', ['deals', 'envelopes'], () => {
      const { outstanding, unrecorded } = outstandingOf(on(reads.envelopes));
      return {
        ...recorded(outstanding, String(outstanding)),
        reason: unrecorded
          ? `${plural(unrecorded, 'envelope records', 'envelopes record')} no recipient and ${unrecorded === 1 ? 'is' : 'are'} not counted`
          : 'on paper sent for signature',
      };
    }),
    kpi('blocking', 'Blocking conditions', ['deals', 'conditions'], () => {
      const n = on(reads.conditions).length;
      return { ...recorded(n, String(n)), reason: 'open IC conditions on decisions you can see' };
    }),
    kpi('transfers', 'Transfers recorded', ['deals', 'transfers'], () => {
      const n = on(reads.transfers).length;
      return { ...recorded(n, String(n)), reason: 'recorded here, not moved here' };
    }),
  ];
}

/** A figure as one word for an export: its text, Unreadable, Not recorded, or empty while it is read. */
export function figureWord(f) {
  if (f.state === 'recorded') return f.text;
  if (f.state === 'unreadable') return 'Unreadable';
  if (f.state === 'loading') return '';
  return 'Not recorded';
}

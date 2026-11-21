/**
 * D4707 (#4707), D4819 L16 (#5926) — how one licence history
 * row reads. Pure.
 *
 * Honesty states kept apart: a row written before the change was recorded is
 * "Not recorded"; a change that was recorded and cannot be read is
 * "Unreadable"; an actor whose account no longer exists is "Unknown account";
 * a row no person wrote (an automatic step such as the compliance ladder's
 * suspension) is "System"; and a row that names nobody without saying it was
 * automatic is "Not recorded".
 *
 * L16: the primary text is a title in operator words, never the raw event key.
 * A key this file does not know reads "Licence record changed", and the key
 * is shown only as a muted secondary line.
 */

import { eventOutcomeOf } from '../../lib/licenceContracts.js';
import { TOKEN_SPLIT_HISTORY_LABEL } from '../../lib/tokenSplit';
import { syncFailureSentence } from './licenceOverviewModel.js';
import { NOT_RECORDED } from '../../lib/absence';

export { NOT_RECORDED };

const LABELS = {
  term_years: 'Term (years)', annual_fee_cents: 'Annual fee (cents)', currency: 'Currency',
  revenue_share_bps: 'Revenue share (bps)', token_split_bps: TOKEN_SPLIT_HISTORY_LABEL, starts_on: 'Starts',
  renews_on: 'Renews', status: 'Status', countries: 'Countries',
};

/**
 * Every event kind the Worker writes to `licence_events`, in operator words.
 * The writers are listed in D4819 § Build, L16.
 */
export const EVENT_TITLES = Object.freeze({
  created: 'Licence drafted',
  activated: 'Licence activated',
  suspended: 'Licence suspended',
  reinstated: 'Licence reinstated',
  renewed: 'Licence renewed',
  terminated: 'Licence terminated',
  territory_changed: 'Territory changed',
  seats_changed: 'Seats changed',
  terms_changed: 'Terms amended',
  contract_instantiated: 'Agreement drafted',
  contract_sent: 'Agreement sent for signature',
  program_changed: 'Program access changed',
});

export const UNKNOWN_EVENT_TITLE = 'Licence record changed';

/** `{ title, key }`: the operator title, and the raw key only when it has no title of its own. */
export function eventTitle(event) {
  const k = String(event || '');
  return Object.prototype.hasOwnProperty.call(EVENT_TITLES, k)
    ? { title: EVENT_TITLES[k], key: null }
    : { title: UNKNOWN_EVENT_TITLE, key: k || null };
}

/** Kept for callers that print a key in words; History itself uses `eventTitle`. */
export const eventLabel = (event) => String(event || '').replace(/_/g, ' ');

/**
 * Who did it. `detail.automatic` marks a row written by a scheduled step, not a
 * person (`complianceLadder.ts`); any other row with no actor says so plainly.
 */
export function actorLabel(actor, detail) {
  if (!actor || actor.state === 'none') return detail && detail.automatic === true ? 'System' : NOT_RECORDED;
  if (actor.state === 'unknown') return 'Unknown account';
  return actor.name || 'Unknown account';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 Nov 2026 · 14:32 UTC" from the row's stamp (ISO or SQL); Not recorded when there is none. */
export function whenLabel(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(stamp || ''));
  if (!m) return NOT_RECORDED;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || m[2]} ${m[1]} · ${m[4]}:${m[5]} UTC`;
}

/** The reason the writer recorded: the row's note, or `detail.reason`; Not recorded otherwise. */
export function reasonLabel(e) {
  const note = typeof e?.note === 'string' ? e.note.trim() : '';
  if (note) return { recorded: true, text: note };
  const r = e?.detail && typeof e.detail === 'object' && typeof e.detail.reason === 'string' ? e.detail.reason.trim() : '';
  if (r) return { recorded: true, text: r };
  return { recorded: false, text: NOT_RECORDED };
}

/** A row's outcome in words; anything the contract does not name reads as Not recorded. */
export function outcomeLabel(outcome) {
  const o = eventOutcomeOf(outcome);
  if (o === 'committed') return 'Done';
  if (o === 'partial') return 'HQ done · branch pending';
  return NOT_RECORDED;
}

/**
 * The row's branch outcome, from the push record the writer kept (`outcome`)
 * and, for a push that did not land, what the licence's `sync` says now.
 *
 * `{ state, text, now? }`, `state` one of:
 * - `out_of_sync`: `partial`. HQ holds the change and the push did not land
 *   (D4707). `now` adds what `sync` says today: still pending and why, or that
 *   the branch has since accepted HQ's latest revision.
 * - `none`: the licence was only drafted, which never pushes.
 * - `no_failure`: `committed`. No failed push is recorded. That covers a
 *   push the branch accepted, a licence with no branch, and a write that does
 *   not push, because the row does not tell those apart (D4819 § Build, L16).
 * - `not_recorded`: no outcome was written (a row from before D4707).
 */
export function branchOutcome(e, sync) {
  const o = eventOutcomeOf(e?.outcome);
  if (o === 'partial') {
    return { state: 'out_of_sync', text: 'HQ done · branch pending: the push to the branch did not land', now: syncNow(sync) };
  }
  if (o === 'committed') {
    if (e?.event === 'created') return { state: 'none', text: 'No branch change' };
    return { state: 'no_failure', text: 'No failed push recorded' };
  }
  return { state: 'not_recorded', text: NOT_RECORDED };
}

function syncNow(sync) {
  if (!sync || sync.available === false) return null;
  if (sync.pending) {
    const why = syncFailureSentence(sync.pending.failure_code);
    const rev = sync.pending.revision == null ? '' : ` (revision ${sync.pending.revision})`;
    return `Still pending now${rev}.${why ? ` ${why}` : ''}`;
  }
  if (sync.hq_revision != null && sync.branch_revision != null && sync.branch_revision >= sync.hq_revision) {
    return `The branch has since accepted revision ${sync.hq_revision}.`;
  }
  return null;
}

const show = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/**
 * `{ state: 'not_recorded' | 'unreadable' | 'none' | 'changes', rows }` — the
 * fields that differ, each `{ field, label, before, after }`. A field present
 * on one side only is still a change.
 */
export function changeRows(change) {
  if (!change || change.recorded === false) return { state: 'not_recorded', rows: [] };
  if (change.readable === false) return { state: 'unreadable', rows: [] };
  const before = change.before && typeof change.before === 'object' ? change.before : {};
  const after = change.after && typeof change.after === 'object' ? change.after : {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const rows = keys
    .filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    .map((k) => ({ field: k, label: LABELS[k] || k.replace(/_/g, ' '), before: show(before[k]), after: show(after[k]) }));
  return { state: rows.length ? 'changes' : 'none', rows };
}

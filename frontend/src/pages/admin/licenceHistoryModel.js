/**
 * D4707 (#4707) — how one licence history row reads. Pure.
 *
 * Honesty states kept apart: a row written before the change was recorded is
 * "Not recorded"; a change that was recorded and cannot be read is
 * "Unreadable"; an actor whose account no longer exists is "Unknown account",
 * and a row no person wrote (a scheduled job) is "System".
 */

const LABELS = {
  term_years: 'Term (years)', annual_fee_cents: 'Annual fee (cents)', currency: 'Currency',
  revenue_share_bps: 'Revenue share (bps)', token_split_bps: 'Token split (bps)', starts_on: 'Starts',
  renews_on: 'Renews', status: 'Status', countries: 'Countries',
};

export const eventLabel = (event) => String(event || '').replace(/_/g, ' ');

export function actorLabel(actor) {
  if (!actor || actor.state === 'none') return 'System';
  if (actor.state === 'unknown') return 'Unknown account';
  return actor.name || 'Unknown account';
}

export function outcomeLabel(outcome) {
  if (outcome === 'committed') return 'Done';
  if (outcome === 'partial') return 'HQ done · branch pending';
  return 'Not recorded';
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

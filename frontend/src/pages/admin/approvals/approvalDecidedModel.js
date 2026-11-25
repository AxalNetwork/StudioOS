/** Decided filters, history rows, notes and pagination. */
import { ageText, dayText, nf, stampText } from './approvalsFormat.js';
import { laneLabelOf } from './approvalsLanesModel.js';

/* ------------------------------------------------------------------ *
 * Decided (APR10)
 * ------------------------------------------------------------------ */
export const OUTCOME_FILTERS = [
  { key: null, label: 'Any outcome' },
  { key: 'approved', label: 'Approved' },
  { key: 'declined', label: 'Declined' },
  { key: 'other', label: 'Other' },
];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Decided's query from the address: the filters the Worker reads, a bad one dropped rather than sent. */
export function decidedQueryOf(search) {
  const p = new URLSearchParams(search || '');
  const out = {};
  const page = Number(p.get('page'));
  out.page = Number.isSafeInteger(page) && page >= 1 && page <= 40 ? page : 1;
  if (p.get('lane')) out.lane = p.get('lane');
  if (OUTCOME_FILTERS.some((o) => o.key && o.key === p.get('outcome'))) out.outcome = p.get('outcome');
  if (/^[1-9]\d*$/.test(p.get('decided_by') || '')) out.decided_by = p.get('decided_by');
  if (DAY.test(p.get('from') || '')) out.from = p.get('from');
  if (DAY.test(p.get('to') || '')) out.to = p.get('to');
  // D4814: "Include HQ lanes" off. The page drops it for a plain Admin, who never has HQ's lanes.
  if (p.get('hq') === '0') out.hq = '0';
  return out;
}

const OUTCOME_TONE = { approved: 'good', declined: 'bad', other: null };

/** Decided's rows: when, lane, who, the store's own outcome word, who decided, the wait, and whether they see the note. */
export function decidedRows(reply) {
  return (Array.isArray(reply?.items) ? reply.items : []).map((r) => ({
    key: `${r.lane}:${r.item_id}:${r.decided_at}`,
    laneKey: r.lane,
    itemId: Number.isInteger(Number(r.item_id)) ? Number(r.item_id) : null,
    itemUid: r.item_uid || null,
    when: stampText(r.decided_at) || 'Not recorded',
    lane: laneLabelOf(r.lane, r.lane_label),
    who: r.who || 'Not recorded',
    outcome: { word: r.outcome_word || 'Not recorded', tone: OUTCOME_TONE[r.outcome] ?? null },
    by: r.decided_by?.name || 'Not recorded',
    wait: ageText(r.wait_hours) || 'Not recorded',
    // D4814 (AP-07): a wait the lane did not record is a dash, never 0.
    waitKnown: r.wait_hours !== null && r.wait_hours !== undefined,
    note: r.note || null,
    shown: !!r.note && !!r.note_shown,
  }));
}

/**
 * What the log cannot say, as the page prints it: each lane that records
 * only from a day ("decisions were not recorded before 25 Oct 2026"), each
 * lane that does not record, with why, and each lane's caveat.
 */
export function decidedNotes(reply) {
  const lanes = Array.isArray(reply?.lanes) ? reply.lanes : [];
  return {
    since: lanes.filter((l) => l.recorded && l.since).map((l) => `${laneLabelOf(l.key, l.label)}: decisions were not recorded before ${dayText(l.since) || l.since}.`),
    notRecorded: lanes.filter((l) => !l.recorded).map((l) => ({ label: laneLabelOf(l.key, l.label), reason: l.reason || 'It does not record its decisions.' })),
    caveats: lanes.filter((l) => l.recorded && l.caveat).map((l) => ({ label: laneLabelOf(l.key, l.label), text: l.caveat })),
    unreadable: Array.isArray(reply?.unreadable) ? reply.unreadable : [],
  };
}

/** "1–25 of 357", or "1–25 of —" with the reason when a lane failed. */
export function decidedPageLine(reply) {
  const n = Array.isArray(reply?.items) ? reply.items.length : 0;
  if (!n) return null;
  const size = Number(reply.page_size) || 25;
  const from = ((Number(reply.page) || 1) - 1) * size;
  return `${nf(from + 1)}–${nf(from + n)} of ${reply.total === null || reply.total === undefined ? '—' : nf(reply.total)}`;
}

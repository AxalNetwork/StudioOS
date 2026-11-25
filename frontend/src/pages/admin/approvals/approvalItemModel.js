/** Item detail, review destinations and history as displayed by the Approvals drawer. */
import { HQ_LANES, LANES, groupLabel, laneLabelOf } from './approvalsLanesModel.js';
import { ageText, dayText, nf, stampText } from './approvalsFormat.js';
import { assigneeOf, humanWhat, inboxRows, slaBand } from './inboxQueueModel.js';
import { ownerLine } from './approvalAssignmentModel.js';

/** The lane boards on this page, by the name the Review line gives them. */
const BOARD_NAMES = { product_testers: 'Product testers', wellbeing_experts: 'Wellbeing experts', comarketing: 'Co-marketing', best_fit: 'Best-Fit' };

/**
 * D4814: where review continues, for the Review cell's "in [destination]".
 * A lane decided on one of this page's boards says "[board] · Approvals";
 * never "Here", never "Decided on".
 */
export function reviewDestination(lane) {
  if (BOARD_NAMES[lane]) return `${BOARD_NAMES[lane]} · Approvals`;
  const studio = LANES.find((l) => l.key === lane);
  if (studio?.door) return studio.door;
  const hq = HQ_LANES.find((l) => l.key === lane);
  if (hq) return hq.door || 'its own page, not built yet';
  return 'its own page';
}

/**
 * The item read as the drawer draws it, or the refusal as its state:
 *   gone      404 `item_not_waiting` — decided, withdrawn or moved;
 *   missing   404 `item_not_found` — not on this inbox (an HQ lane for an Admin too);
 *   unread    503 or anything else — "Could not be read", with Try again.
 */
export function itemView(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'error') {
    const code = read.error?.code;
    if (code === 'item_not_waiting') return { state: 'gone', text: read.error.message || 'This item is not waiting any more.' };
    if (code === 'item_not_found' || read.error?.status === 404) return { state: 'missing', text: 'That item is not on this inbox.' };
    return { state: 'unread', text: read.error?.message || 'The item could not be read.', ref: errorRef(read.error) };
  }
  const r = read.reply || {};
  const it = r.item || {};
  const lane = r.lane || {};
  return {
    state: 'ready',
    lane: it.lane || lane.key,
    id: it.id,
    who: it.who || 'Profile name not recorded',
    what: humanWhat(it.what),
    laneLabel: laneLabelOf(lane.key || it.lane, lane.label || it.lane_label),
    group: groupLabel(lane.group),
    hq: !!lane.hq,
    submitted: stampText(it.created_at) || 'Not recorded',
    age: ageText(it.age_hours) || 'Age not recorded',
    sla: it.sla || 'unknown',
    band: slaBand(it.sla),
    assignee: assigneeOf(it),
    ownerLine: ownerLine(assigneeOf(it), r.history),
    assigneeReason: r.assignee_reason || null,
    notifies: lane.notifies || null,
    decidedOn: lane.decided_on || null,
    undecided: lane.undecided_reason || null,
    history: historyLines(r.history),
  };
}

/** History (APR3): "Assigned to [B] by [A]" with its day, oldest first; unreadable says so. */
export function historyLines(history) {
  if (!history) return { state: 'unread', text: 'History could not be read.' };
  if (history.available === false) return { state: 'unread', text: history.reason || 'History could not be read.' };
  const items = Array.isArray(history.items) ? history.items : [];
  return {
    state: 'ready',
    lines: items.map((h) => ({
      text: h.actor_user_id === h.assignee_user_id ? `${h.assignee_name} took it` : `Assigned to ${h.assignee_name} by ${h.actor_name}`,
      day: dayText(h.created_at) || 'Not recorded',
    })),
    capped: !!history.capped,
  };
}

/**
 * D4814 (AP-04): where the drawer stands in the queue — "6 of 133" with the
 * rows before and after it on the page read. Null when the item is not on
 * that page (opened from a link, say), so no position is invented.
 */
export function queueStep(reply, at) {
  const rows = inboxRows(reply);
  const i = rows.findIndex((r) => r.lane === at?.lane && Number(r.id) === Number(at?.id));
  if (i < 0) return null;
  const page = Number(reply?.page) || 1;
  const size = Number(reply?.page_size) || 25;
  const total = reply?.total;
  return {
    pos: `${nf((page - 1) * size + i + 1)} of ${total == null ? 'the queue' : nf(total)}`,
    prev: rows[i - 1] || null,
    next: rows[i + 1] || null,
  };
}

/**
 * D4814 (AP-04, AP-15): the drawer's closing line — where the decision is
 * made and why it is not made here. Never "Here", never "Decided on".
 */
export function continueLine(lane) {
  if (BOARD_NAMES[lane]) return `This decision is made on the ${BOARD_NAMES[lane]} board in Approvals, where its evidence and notification rules live.`;
  const dest = reviewDestination(lane);
  if (dest === 'its own page' || /not built yet/.test(dest)) return 'This lane’s review page is not built yet.';
  return `This decision is completed in ${dest}, where its evidence and notification rules live.`;
}

/**
 * A refusal as the toast says it (APR13c): the Worker's own sentence, and that
 * the list was read again. A stale item (it left the board) reads the same way.
 */
export function refusalToast(e) {
  const said = e?.message && e.message !== 'Request failed' ? e.message : 'That could not be done.';
  return `${said.replace(/\.?$/, '.')} The list is up to date now.`;
}

/** "Details": the status and the Worker's code, never a body or a stack. */
export function errorRef(e) {
  if (!e) return null;
  const bits = [];
  if (e.status) bits.push(`HTTP ${e.status}`);
  if (e.code) bits.push(e.code);
  return bits.length ? bits.join(' · ') : null;
}

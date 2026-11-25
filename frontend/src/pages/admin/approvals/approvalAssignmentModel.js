/** Reviewer choices, ownership, page collection and copy for assignment. */
import { nf, stampText } from './approvalsFormat.js';
import { hasNextPage, inboxRows, waitingFigure } from './inboxQueueModel.js';

/**
 * Assign's choices. D4814 (AP-05): a radio list of every active admin, the
 * caller first, then the lowest workload, then alphabetical, each with the
 * items they own now ("You · 14 assigned", "4 assigned"). The load is the
 * Worker's `tiles.per_admin`, which it withholds when a lane was not read or
 * was cut at the cap; then no load is shown rather than a short one, the order
 * is you then alphabetical, and the note says why. With no reviewer list there
 * is nobody to choose, and the dialog says why rather than offering an empty list.
 */
export function assignChoices(reply, callerId) {
  if (!Array.isArray(reply?.reviewers)) return { state: 'unread', text: reply?.reviewers_reason || 'The admins could not be read, so nobody can be chosen.' };
  const perAdmin = Array.isArray(reply.tiles?.per_admin) ? reply.tiles.per_admin : null;
  const counts = new Map((perAdmin || []).map((p) => [Number(p.id), Number(p.count)]));
  const loads = perAdmin !== null;
  const choices = reply.reviewers.map((r) => {
    const you = callerId != null && Number(r.id) === Number(callerId);
    const n = counts.get(Number(r.id));
    const load = loads && n !== undefined ? `${nf(n)} assigned` : null;
    return { id: r.id, name: r.name, you, n: load ? n : null, load: [you ? 'You' : null, load].filter(Boolean).join(' · ') || null };
  });
  choices.sort((a, b) => (a.you !== b.you ? (a.you ? -1 : 1)
    : loads && a.n !== b.n ? (a.n ?? Infinity) - (b.n ?? Infinity)
      : String(a.name).localeCompare(String(b.name), 'en', { sensitivity: 'base' })));
  return {
    state: 'ready',
    choices: choices.map((c) => ({ ...c, label: [c.name, c.load].filter(Boolean).join(' · ') })),
    note: loads ? 'Order: you, then lowest workload, then alphabetical. Counts are items currently owned.'
      : `Order: you, then alphabetical. Workloads are not shown: ${lowerFirst(reply.tiles?.reason || 'They could not be counted.')}`,
  };
}

const lowerFirst = (t) => t.replace(/^./, (c) => c.toLowerCase());

/** D4814 (AP-05): what the dialog says before anything else. */
export const ASSIGN_NOTE = 'Assigning changes ownership only.';

export const assignNoteRest = (n) => `It does not decide ${n === 1 ? 'this item' : 'these items'}.`;

/** D4814 (AP-05): the primary button names the person once one is chosen. */
export function assignButton(choices, pick) {
  const c = Array.isArray(choices) ? choices.find((x) => x.id === pick) : null;
  return c ? `Assign to ${c.you ? 'me' : c.name}` : 'Assign';
}

/** Assign's title: one item by who it is about, or "Assign 3 items". */
export function assignTitle(items) {
  if (items.length === 1) return `Assign ${items[0].who}’s ${items[0].laneLabel === 'KYC' ? 'identity check' : 'item'}`;
  return `Assign ${nf(items.length)} items`;
}

/** D4814 (AP-05): the names Assign is about ("Ada Example, Harbor Robotics and 3 more"). */
export function assignNames(items, shown = 3) {
  const names = items.map((r) => r.who).filter(Boolean);
  if (names.length <= shown) return names.join(', ');
  return `${names.slice(0, shown).join(', ')} and ${nf(names.length - shown)} more`;
}

/**
 * The most items one Assign sends: the Worker's `ASSIGNMENT_CAP`
 * (`approvalAssignments.ts`), which refuses more with `too_many`. A test reads
 * both so they cannot drift.
 */
export const ASSIGN_CAP = 40;

/**
 * D4814 (AP-01): the ownership callout, when unowned work is the queue's
 * problem. It needs the Worker's exact figures (`tiles.complete`): a floor
 * read past an unread lane cannot say "of 133". It shows when at least half
 * of what waits has no owner, or when an overdue item has none. "the main
 * reason this queue is ageing" is said only when most overdue items have no
 * owner, which is what that sentence claims. `assignOverdue` is how many
 * overdue items have no owner (Assign overdue… offers them).
 */
export function ownershipCallout(inbox) {
  if (inbox?.status !== 'ready') return null;
  const r = inbox.reply || {};
  const t = r.tiles || {};
  if (t.complete !== true) return null;
  const waiting = waitingFigure(inbox);
  if (waiting.state !== 'ready' || waiting.partial) return null;
  const nobody = t.unassigned;
  const overdue = t.over_72h;
  const overdueNobody = t.overdue_unassigned;
  if (![nobody, overdue, overdueNobody].every((x) => Number.isInteger(x))) return null;
  if (nobody <= 0) return null;
  if (!(nobody * 2 >= waiting.n || overdueNobody > 0)) return null;
  return {
    nobody,
    waiting: waiting.n,
    overdueNobody,
    text: `${nf(nobody)} of ${nf(waiting.n)} waiting ${waiting.n === 1 ? 'item has' : 'items have'} no owner${overdueNobody > 0 ? `, including ${nf(overdueNobody)} overdue` : ''}.`,
    cause: overdue > 0 && overdueNobody * 2 > overdue ? 'Unowned items are the main reason this queue is ageing.' : null,
    assignOverdue: overdueNobody,
  };
}

/** D4814: the inbox read behind Assign overdue…: nobody holds it and it is over 72 hours. */
export const OVERDUE_UNOWNED = { assigned: 'none', age: 'past' };

/**
 * D4814: the overdue items nobody holds, read page by page from the inbox
 * (oldest first) up to what one Assign may send. `readPage(n)` answers the
 * inbox reply for page n. Answers `{ rows, total }`; `total` is the Worker's
 * count of the matching items, or null when it withheld it.
 */
export async function collectOverdue(readPage, cap = ASSIGN_CAP) {
  const rows = [];
  let total = null;
  for (let page = 1; rows.length < cap; page += 1) {
    // One page at a time: the next is read only if this one says there is one.
    // eslint-disable-next-line no-await-in-loop
    const reply = await readPage(page);
    if (page === 1) total = reply?.total ?? null;
    rows.push(...inboxRows(reply).filter((row) => row.sla === 'past' && row.assignee.kind === 'none'));
    if (!hasNextPage(reply)) break;
  }
  return { rows: rows.slice(0, cap), total };
}

/** D4814: Assign overdue…'s title, and what it leaves when more wait than one Assign takes. */
export const overdueAssignTitle = (rows) => `Assign ${nf(rows.length)} overdue ${rows.length === 1 ? 'item' : 'items'}`;

export function overdueAssignLine(rows, total) {
  if (total != null && total > rows.length) return `The oldest ${nf(rows.length)} of ${nf(total)} are listed: one assignment takes at most ${nf(ASSIGN_CAP)}. The rest stay unassigned until you assign them.`;
  if (total == null && rows.length >= ASSIGN_CAP) return `The oldest ${nf(rows.length)} are listed: one assignment takes at most ${nf(ASSIGN_CAP)}, and how many more there are was not counted.`;
  return null;
}

/**
 * D4814 (AP-04): the owner box's second line — when the current owner took
 * it and who assigned it, from the latest assignment in History; "Nobody owns
 * this item yet" for none; nothing invented when History was not read.
 */
export function ownerLine(assignee, history) {
  if (assignee?.kind === 'none') return 'Nobody owns this item yet';
  if (assignee?.kind !== 'person') return null;
  const items = history && history.available !== false && Array.isArray(history.items) ? history.items : null;
  if (!items) return null;
  const last = [...items].reverse().find((h) => Number(h.assignee_user_id) === Number(assignee.id));
  if (!last) return null;
  const day = stampText(last.created_at);
  const by = Number(last.actor_user_id) === Number(last.assignee_user_id) ? 'they took it' : `assigned by ${last.actor_name || 'Not recorded'}`;
  return [day ? `Owner since ${day}` : null, by].filter(Boolean).join(' · ');
}

/** The body Assign sends: the Worker's `{ lane, item_id }` per item. */
export const assignItems = (rows) => rows.map((r) => ({ lane: r.lane, item_id: r.id }));

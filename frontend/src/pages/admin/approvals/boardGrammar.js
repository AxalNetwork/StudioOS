/**
 * D4814 (#4814, part 3) — the native boards' shared grammar as pure functions
 * (AP-08 to AP-13): who owns each item, the four-cell summary, the
 * Co-marketing lifecycle and the words every board shares. No React, so
 * `node --test` loads it alone.
 *
 * WHO OWNS AN ITEM is the inbox's assignment record (D1040), read through the
 * inbox filtered to the board's lane (`GET /api/admin/approvals?lane=`), page
 * by page. The boards key pitches and experts by `uid`; the inbox keys every
 * lane by its numeric `id`, which the boards' reads also carry, so owners
 * join on `id`. A row the owner read did not reach is "Not read", never
 * "Unassigned".
 */
import { assigneeOf } from './inboxModel';

const nf = (n) => Number(n).toLocaleString('en-US');

/** Each board's lane key on the inbox. */
export const BOARD_LANE = { 'product-testers': 'product_testers', 'co-marketing': 'comarketing', 'wellbeing-experts': 'wellbeing_experts' };

/** The inbox pages an owner read follows, at 25 a page. */
export const OWNER_PAGES = 8;

/** The Waiting column's urgency in words (`UrgencyPill`), from a board row's band. */
export const slaOfBand = (band) => (band?.key === 'past' ? 'past' : band?.key === 'due' ? 'due_soon' : null);

/** Approvals › Lanes › [board]: the breadcrumb every board shares. */
export const boardCrumb = (current) => ({ to: '/admin/approvals', label: 'Approvals', via: { to: '/admin/approvals/lanes', label: 'Lanes' }, current });

/** The drawer's closing line on a board that decides here (AP-09a). */
export const DECIDED_HERE = 'Decided here, in Approvals. You’ll see what changes before anything is recorded.';

/**
 * Every page of the inbox filtered to one lane, up to `OWNER_PAGES`.
 * `readPage(n)` answers the inbox reply for page n. Answers
 * `{ first, items, complete }`: `first` carries `reviewers` and
 * `tiles.per_admin` for the Assign dialog.
 */
export async function readLaneOwners(readPage, pages = OWNER_PAGES) {
  const items = [];
  let first = null;
  let complete = false;
  for (let page = 1; page <= pages; page += 1) {
    // One page at a time: the next is read only if this one says there is one.
    // eslint-disable-next-line no-await-in-loop
    const reply = await readPage(page);
    if (page === 1) first = reply;
    items.push(...(Array.isArray(reply?.items) ? reply.items : []));
    const size = Number(reply?.page_size) || 25;
    const total = reply?.total;
    const more = total == null ? (reply?.items || []).length === size : page * size < total;
    if (!more) { complete = true; break; }
  }
  return { first, items, complete };
}

/**
 * The owner read as the boards use it: `{ state, byId, complete, reason }`.
 * `state` is 'loading', 'unread' (the inbox or its assignment record failed)
 * or 'ready'. `byId` maps an item's numeric id to its inbox item.
 */
export function ownersOf(read) {
  if (!read || read.status === 'loading' || read.status === 'idle') return { state: 'loading', byId: new Map(), complete: false };
  if (read.status !== 'ready') return { state: 'unread', byId: new Map(), complete: false, reason: read.error?.message || 'The assignment record could not be read.' };
  const r = read.reply || {};
  if (r.first?.assignments?.available === false) return { state: 'unread', byId: new Map(), complete: false, reason: r.first.assignments.reason || 'The assignment record could not be read.' };
  const byId = new Map((r.items || []).map((it) => [Number(it.id), it]));
  return { state: 'ready', byId, complete: !!r.complete, first: r.first };
}

/**
 * One row's owner, in the inbox's words (`assigneeOf`): Unassigned, a name,
 * or "Not read" when the owner read failed or did not reach this item.
 */
export function rowOwner(owners, id) {
  if (!owners || owners.state === 'loading') return { kind: 'loading', text: '…' };
  if (owners.state !== 'ready') return { kind: 'unread', text: 'Not read' };
  const it = owners.byId.get(Number(id));
  if (!it) return { kind: 'unread', text: 'Not read' };
  return assigneeOf(it);
}

/**
 * The four-cell summary every board shares (AP-08, AP-10, AP-12): the waiting
 * figure, Overdue, Unassigned and a fourth (Oldest, or Co-marketing's
 * "Approved, not published"). Each cell is
 * `{ key, label, state: 'loading'|'ready'|'unreadable', value, sub, tone, reason }`.
 *
 * Overdue and Unassigned are counted over the waiting rows the board read, so
 * they are drawn only when those rows are every waiting item (`complete`);
 * otherwise they say why. A 0 is drawn only when it was measured.
 */
export function boardStrip({ status, label, total, rows, complete, owners, fourth, noun = 'waiting' }) {
  const loading = { state: 'loading' };
  if (status === 'loading') return [{ key: 'waiting', label, ...loading }, { key: 'overdue', label: 'Overdue', ...loading }, { key: 'unassigned', label: 'Unassigned', ...loading }, fourth || { key: 'oldest', label: 'Oldest', ...loading }];
  if (status !== 'ready') {
    const why = { state: 'unreadable', reason: 'The board could not be read.' };
    return [{ key: 'waiting', label, ...why }, { key: 'overdue', label: 'Overdue', ...why }, { key: 'unassigned', label: 'Unassigned', ...why }, fourth || { key: 'oldest', label: 'Oldest', ...why }];
  }
  const list = Array.isArray(rows) ? rows : [];
  const waiting = total == null
    ? { key: 'waiting', label, state: 'unreadable', reason: 'How many are waiting was not counted.' }
    : { key: 'waiting', label, state: 'ready', value: nf(total), sub: noun };
  const short = 'Counted only when every waiting item is read, and this read stopped short.';
  const past = list.filter((r) => r.band?.key === 'past').length;
  const overdue = !complete
    ? { key: 'overdue', label: 'Overdue', state: 'unreadable', reason: short }
    : { key: 'overdue', label: 'Overdue', state: 'ready', value: nf(past), sub: past ? 'over 72 hours' : 'measured · nothing over 72 h', tone: past ? 'bad' : null };
  let unassigned;
  if (!complete) unassigned = { key: 'unassigned', label: 'Unassigned', state: 'unreadable', reason: short };
  else if (!owners || owners.state === 'loading') unassigned = { key: 'unassigned', label: 'Unassigned', state: 'loading' };
  else if (owners.state !== 'ready') unassigned = { key: 'unassigned', label: 'Unassigned', state: 'unreadable', reason: owners.reason };
  else {
    const kinds = list.map((r) => rowOwner(owners, r.id).kind);
    if (kinds.includes('unread')) unassigned = { key: 'unassigned', label: 'Unassigned', state: 'unreadable', reason: 'Some waiting items were not on the assignment read, so no count is drawn.' };
    else {
      const n = kinds.filter((k) => k === 'none').length;
      unassigned = { key: 'unassigned', label: 'Unassigned', state: 'ready', value: nf(n), sub: `of ${nf(list.length)}`, tone: n ? 'warn' : null };
    }
  }
  let last = fourth;
  if (!last) {
    const top = list.filter((r) => r.ageHours != null).sort((a, b) => b.ageHours - a.ageHours)[0];
    last = !complete ? { key: 'oldest', label: 'Oldest', state: 'unreadable', reason: short }
      : top ? { key: 'oldest', label: 'Oldest', state: 'ready', value: top.age, sub: top.name || top.title || 'waiting' }
        : { key: 'oldest', label: 'Oldest', state: 'ready', value: '—', sub: list.length ? 'arrival not recorded' : 'nothing waiting' };
  }
  return [waiting, overdue, unassigned, last];
}

/**
 * Co-marketing's lifecycle (AP-10, AP-11): approval and publication are two
 * steps, never one. `at` is the pitch's stored state; Rejected and Withdrawn
 * leave the line, so no step is current.
 */
export const LIFECYCLE = [
  { key: 'proposed', label: '1 · Proposed', note: 'review here' },
  { key: 'approved', label: '2 · Approved', note: 'attribution code issued' },
  { key: 'published', label: '3 · Published', note: 'a separate step, from Approved' },
];
export function lifecycleSteps(at) {
  return LIFECYCLE.map((s) => ({ ...s, current: s.key === at }));
}
export const LIFECYCLE_LINE = 'Approving does not publish. Publishing happens from the Approved tab once the content is ready.';

/** Wellbeing's register note (AP-13): lookups are by hand. */
export const REGISTER_NOTE = 'Register lookups aren’t automated. Check the licence against the issuing register before verifying.';

/**
 * D4814 (#4814, part 5, AP-18e): the refusals that mean another decision got
 * there first. Each is refused before anything is written (the Worker's
 * conditional writes), so the dialog can say nothing was recorded by you.
 */
export const CHANGED_CODES = new Set(['tester_changed', 'pitch_decided', 'review_changed', 'already_decided']);
export const isChanged = (e) => Number(e?.status) === 409 && CHANGED_CODES.has(e?.code);
export const CHANGED_LEAD = 'This item changed while you were reviewing it.';
export const CHANGED_REST = 'The latest state has been loaded. Nothing was recorded by you.';

/**
 * D4814 (AP-18d, AP-18f): what a board says after a decision. The Worker
 * answers `notified: false` when the decision is recorded but the notice did
 * not go out; then the line says so and asks for a check before any retry.
 * `notified: null` (nobody was due a notice) or a reply without the field is
 * the ordinary line.
 */
export function afterDecision(line, reply, who) {
  if (reply && reply.notified === false) {
    return {
      warn: true,
      text: 'The decision was recorded, but the notification could not be delivered.',
      sub: `Check the item before trying again — ${who || 'they'} may not know yet.`,
    };
  }
  return { warn: false, text: line };
}

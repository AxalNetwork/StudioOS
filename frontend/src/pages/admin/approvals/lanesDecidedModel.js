/**
 * D4814 (#4814, part 4) — Lanes as an operations map (AP-06) and Decided as an
 * audit trail (AP-07), as pure functions. No React, so `node --test` loads it
 * alone.
 *
 * Lanes reads two stores: the Studio glance for each lane's count and oldest
 * wait (D1041), and the inbox for each lane's split by age band (D1132), which
 * is where "N overdue" comes from. A lane either store could not read says so;
 * a total short by an unread lane is "N+", never N.
 */
import { GROUPS } from './approvalsModel';

const nf = (n) => Number(n).toLocaleString('en-US');

/** The three lanes decided on Approvals' own boards (AP-06's "Approvals board" tag). */
export const NATIVE_BOARDS = new Set(['product_testers', 'comarketing', 'wellbeing_experts']);

/** A lane's overdue count from the inbox's band split, or null when it was not split (capped, unread, not on the inbox). */
export function laneOverdue(inboxReply, key) {
  const l = (Array.isArray(inboxReply?.lanes) ? inboxReply.lanes : []).find((x) => x.key === key);
  const n = l?.bands?.past;
  return Number.isInteger(n) ? n : null;
}

/**
 * The groups as the map draws them: each group's lanes, how many wait in it
 * ("N waiting", or "N+" when a lane in it was not read) and how many lanes.
 */
export function laneGroups(views, inboxReply) {
  return GROUPS.map((g) => {
    const rows = views.filter((v) => v.group === g.key).map((v) => ({ ...v, overdue: v.state === 'ready' ? laneOverdue(inboxReply, v.key) : null, native: NATIVE_BOARDS.has(v.key) }));
    const read = rows.filter((r) => r.state === 'ready');
    const sum = read.reduce((t, r) => t + r.count, 0);
    const short = rows.some((r) => r.state === 'unreadable');
    const loading = rows.some((r) => r.state === 'loading');
    return {
      ...g, rows,
      waiting: loading ? null : `${nf(sum)}${short ? '+' : ''} waiting`,
      lanes: `${rows.length} ${rows.length === 1 ? 'lane' : 'lanes'}`,
    };
  });
}

/**
 * AP-06's banner when a lane could not be read: "127+ waiting · 1 lane could
 * not be read." with the lanes named. Null when every lane answered.
 */
export function lanesBanner(views) {
  const unread = views.filter((v) => v.state === 'unreadable');
  if (!unread.length) return null;
  const sum = views.filter((v) => v.state === 'ready').reduce((t, v) => t + v.count, 0);
  return {
    text: `${nf(sum)}+ waiting · ${unread.length} ${unread.length === 1 ? 'lane' : 'lanes'} could not be read.`,
    names: `${unread.map((v) => v.label).join(', ')} didn’t respond; every other lane is measured.`,
  };
}

/** Decided's query from the address. D4814: `hq=0` is "Include HQ lanes" off; a plain Admin never sends it. */
export function decidedHq(search, superAdmin) {
  if (!superAdmin) return null;
  return new URLSearchParams(search || '').get('hq') === '0' ? '0' : null;
}

/** How a decision's note reads in the log: shown to the person, internal, or no note. */
export function noteKind(row) {
  if (!row?.note) return 'none';
  return row.shown ? 'shown' : 'internal';
}

/** How many of Decided's filters are in force (the page is not one). */
export function decidedFilterCount(f = {}) {
  return ['lane', 'outcome', 'decided_by', 'from', 'to', 'hq'].filter((k) => f[k]).length;
}

/**
 * "About this history" (AP-07), after the log: each lane recorded only from a
 * day, each lane that does not record, each lane's caveat, and the two things
 * true of every row.
 */
export function aboutHistory(notes) {
  return [
    ...(notes?.since || []),
    ...(notes?.notRecorded || []).map((n) => `${n.label} does not record its decisions: ${n.reason}`),
    ...(notes?.caveats || []).map((c) => `${c.label}: ${c.text}`),
    'A wait shows a dash when the lane did not record when the item arrived. That is not a wait of zero.',
    'Open ↗ goes to the page that decides that lane, where the item is if it still exists.',
  ];
}

/**
 * D4814 (#4814, part 6, AP-07): where Decided's Open ↗ goes for a row. A
 * product tester opens on its board by id; a co-marketing pitch by the uid
 * the Worker now sends (`item_uid`). Every other lane has no address for one
 * decided item, so its row opens the lane's page (null here).
 */
export function decidedItemPath(row) {
  if (row?.laneKey === 'product_testers' && Number.isInteger(row.itemId)) return `/admin/approvals/product-testers/${row.itemId}`;
  if (row?.laneKey === 'comarketing' && row.itemUid) return `/admin/approvals/co-marketing/${encodeURIComponent(row.itemUid)}`;
  return null;
}

/** D4814 (#4814, part 6, AP-05): the Assign dialog's reviewer search, on names, ignoring case. */
export function matchReviewers(choices, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return choices;
  return choices.filter((c) => String(c.name || '').toLowerCase().includes(needle));
}

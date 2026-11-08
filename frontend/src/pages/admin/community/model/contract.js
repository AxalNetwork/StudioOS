/**
 * #4717 package 6 — THE COMMUNITY READ'S CONTRACT: the shape of
 * `GET /api/admin/community/overview` (D931, the worker's
 * `services/communityOverview.ts`), written once and checked at runtime.
 *
 * Every block of the answer is in one of three states (D931): available
 * (`available: true`, and then it must have every field below), unreadable
 * (`available: false` with a reason) or not recorded (`recorded: false` with
 * a reason). A block in either of the last two is never checked for fields:
 * saying it could not be read IS its contract.
 *
 * Who holds it to what:
 *   - the worker's real answer is checked against it in
 *     `cloudflare-worker/test/community_contract_4717.test.ts`, so a renamed
 *     or dropped field fails on the worker's side, before a page draws it;
 *   - `useCommunityReads` checks every answer and reports the paths that do
 *     not match (paths only, never a value), so a drift in production is
 *     seen in the error log as well as on the page;
 *   - the builders read each field strictly (package 3, `read.js`), so a
 *     field that breaks the contract is drawn as unreadable, never as 0.
 *
 * The keys a map must carry come from the same lists the cards draw from
 * (the event types, the job statuses, the profiles), so the contract and the
 * page cannot disagree about them.
 *
 * @typedef {{ available: true } & Record<string, unknown>} Available
 * @typedef {{ available: false, unreadable?: true, reason: string }} Unreadable
 * @typedef {{ recorded: false, reason: string }} NotRecorded
 * @typedef {Available | Unreadable | NotRecorded} Block
 * @typedef {{
 *   weeks: 4 | 12 | 52, week_starts: string[], current_week: string, as_of: string,
 *   window: { from: string, to: string }, previous: { from: string, to: string },
 *   blocks: Record<string, Block | Record<string, Block | number>>,
 * }} CommunityOverview
 */
import { EVENT_TYPES } from '../../../../lib/eventTypes.js';
import { ROLE_LABELS } from './activity.js';
import { JOB_PARTS } from './jobs.js';
import { count, isObj, isText } from './read.js';

const EVENT_TYPE_KEYS = EVENT_TYPES.map((t) => t.id);
const ROLE_KEYS = ROLE_LABELS.map(([k]) => k);
const JOB_STATUS_KEYS = JOB_PARTS.map(([k]) => k);

/**
 * Each available block's fields, by kind:
 *   counts   whole numbers;           hours  whole hours, or null when none is recorded;
 *   share    a share from 0 to 1, or null;  optional  whole numbers that an older read may leave out;
 *   totals   `{ window, previous }` of whole numbers, at each key;
 *   map      `{ key, keys }`: a map of whole numbers carrying every key in `keys`;
 *   weekly   `{ key, count }`: a list of `{ week, [count] }` on the read's own weeks;
 *   rows     `{ key, text, counts, hours }`: a list whose rows have those fields;
 *   nested   `[path, kind]`: a field below the block (`members_entered.value`).
 */
export const OVERVIEW_BLOCKS = {
  'queue.events': { counts: ['count', 'overdue', 'waiting_from_created_at'], hours: ['oldest_hours'] },
  'queue.event_rows': { counts: ['total'], rows: { key: 'rows', text: ['title'], hours: ['waiting_hours'] } },
  'queue.jobs': { counts: ['pending', 'overdue', 'wait_not_recorded'], hours: ['oldest_wait_hours'], rows: { key: 'review', text: ['title'], hours: ['waiting_hours'] } },
  'events.weekly': { totals: ['registrations'], weekly: { key: 'weekly', count: 'registrations' } },
  'events.show_up': { counts: ['events', 'seats_taken', 'attended'], optional: ['confirmed'], share: ['rate'] },
  'events.upcoming': { counts: ['events', 'seats_taken'] },
  'events.next_up': { counts: ['total'], rows: { key: 'rows', text: ['title', 'starts_at'] } },
  'events.by_type': { map: { key: 'counts', keys: EVENT_TYPE_KEYS } },
  'events.waitlisted': { counts: ['registrations', 'events'] },
  'events.by_status': { map: { key: 'counts', keys: [] } },
  jobs: {
    totals: ['applications'],
    weekly: { key: 'weekly', count: 'count' },
    map: { key: 'by_status', keys: JOB_STATUS_KEYS },
    rows: { key: 'most_applied', text: ['title'], counts: ['applications'] },
  },
  'participation_by_role.events': { map: { key: 'by_role', keys: ROLE_KEYS }, counts: ['not_recorded'] },
  'participation_by_role.jobs': { map: { key: 'by_role', keys: ROLE_KEYS } },
  circles: { counts: ['total', 'published', 'featured'], nested: [['members_entered.value', 'count']], map: { key: 'by_type', keys: [] } },
  network: { kindStates: 'by_kind_state' },
  'wellbeing.experts': { counts: ['verified', 'unverified', 'hidden', 'inactive'] },
  'wellbeing.bookings': { counts: ['window', 'previous'], weekly: { key: 'weekly', count: 'count' } },
  'wellbeing.checkins': { checkins: true },
};

const at = (o, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o);
const isHours = (v) => v === null || count(v) !== null;
const isShare = (v) => v === null || v === undefined || (typeof v === 'number' && v >= 0 && v <= 1);

/** What is wrong with one available block, as `field: what` lines. */
function blockProblems(b, spec, weeks) {
  const out = [];
  const need = (ok, field, what) => { if (!ok) out.push(`${field}: ${what}`); };
  for (const f of spec.counts || []) need(count(b[f]) !== null, f, 'not a whole number');
  for (const f of spec.optional || []) need(b[f] == null || count(b[f]) !== null, f, 'not a whole number');
  for (const f of spec.hours || []) need(isHours(b[f]), f, 'not whole hours or null');
  for (const f of spec.share || []) need(isShare(b[f]), f, 'not a share from 0 to 1');
  for (const f of spec.totals || []) {
    need(isObj(b[f]) && count(b[f].window) !== null && count(b[f].previous) !== null, f, 'not { window, previous } in whole numbers');
  }
  for (const [path, kind] of spec.nested || []) need(kind === 'count' && count(at(b, path)) !== null, path, 'not a whole number');
  if (spec.map) {
    const m = b[spec.map.key];
    if (!isObj(m)) out.push(`${spec.map.key}: not a map`);
    else {
      for (const [k, v] of Object.entries(m)) need(count(v) !== null, `${spec.map.key}.${k}`, 'not a whole number');
      for (const k of spec.map.keys) need(k in m, `${spec.map.key}.${k}`, 'missing');
    }
  }
  if (spec.weekly) {
    const rows = b[spec.weekly.key];
    if (!Array.isArray(rows)) out.push(`${spec.weekly.key}: not a list`);
    else {
      rows.forEach((r, i) => {
        need(isObj(r) && Array.isArray(weeks) && weeks.includes(r.week), `${spec.weekly.key}.${i}.week`, 'not one of the read\'s weeks');
        need(isObj(r) && count(r[spec.weekly.count]) !== null, `${spec.weekly.key}.${i}.${spec.weekly.count}`, 'not a whole number');
      });
    }
  }
  if (spec.rows) {
    const rows = b[spec.rows.key];
    if (!Array.isArray(rows)) out.push(`${spec.rows.key}: not a list`);
    else {
      rows.forEach((r, i) => {
        const p = `${spec.rows.key}.${i}`;
        if (!isObj(r)) { out.push(`${p}: not a row`); return; }
        for (const f of spec.rows.text || []) need(isText(r[f]), `${p}.${f}`, 'not text');
        for (const f of spec.rows.counts || []) need(count(r[f]) !== null, `${p}.${f}`, 'not a whole number');
        for (const f of spec.rows.hours || []) need(isHours(r[f]), `${p}.${f}`, 'not whole hours or null');
      });
    }
  }
  if (spec.kindStates) {
    const m = b[spec.kindStates];
    if (!isObj(m)) out.push(`${spec.kindStates}: not a map`);
    else {
      for (const [k, v] of Object.entries(m)) {
        need(isObj(v) && count(v.active) !== null && count(v.hidden) !== null, `${spec.kindStates}.${k}`, 'not { active, hidden } in whole numbers');
      }
    }
  }
  if (spec.checkins) {
    need(typeof b.withheld === 'boolean', 'withheld', 'not true or false');
    if (b.withheld === false) {
      need(isObj(b.band) && count(b.band.at_least) !== null && count(b.band.under) !== null && b.band.under > b.band.at_least, 'band', 'not { at_least, under } in whole numbers');
    }
  }
  return out;
}

/**
 * Every way `data` breaks the contract, as `path: what` lines; empty when it
 * keeps it. Paths and field names only, never a value, so a line can go to
 * the error log.
 */
export function checkOverview(data) {
  if (!isObj(data)) return ['the answer: not an object'];
  const out = [];
  if (![4, 12, 52].includes(data.weeks)) out.push('weeks: not 4, 12 or 52');
  if (!Array.isArray(data.week_starts) || !data.week_starts.every(isText) || data.week_starts.length !== data.weeks) out.push('week_starts: not one date per week');
  else if (!data.week_starts.includes(data.current_week)) out.push('current_week: not one of week_starts');
  if (!isText(data.as_of) || Number.isNaN(Date.parse(data.as_of))) out.push('as_of: not a time');
  if (!isObj(data.blocks)) return [...out, 'blocks: not an object'];
  for (const [path, spec] of Object.entries(OVERVIEW_BLOCKS)) {
    const b = at(data.blocks, path);
    if (!isObj(b)) { out.push(`blocks.${path}: missing`); continue; }
    if (b.available !== true) {
      // Unreadable or not recorded: it must say why, and that is all it must say.
      if (!(b.available === false || b.recorded === false) || !isText(b.reason)) out.push(`blocks.${path}: neither available nor a reason`);
      continue;
    }
    for (const p of blockProblems(b, spec, data.week_starts)) out.push(`blocks.${path}.${p}`);
  }
  return out;
}

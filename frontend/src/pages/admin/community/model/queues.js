/**
 * #4717 package 6 — The two review queues (D918's events, the job board's postings): Waiting on you's counts, the oldest wait, and Needs a decision's rows.
 *
 * Split out of communityModel.js, which re-exports what the page and the
 * tests import. Pure: nothing here fetches.
 */
import { nf, stamp, waitText } from './format.js';
import { FIGURE_UNREAD, blockOf, countsAt, hoursOf, isObj, isText } from './read.js';

export function queueCounts(reads) {
  const ev = eventQueueOf(reads.overview);
  const jb = jobQueueOf(reads.overview);
  return {
    loading: ev.state === 'loading' || jb.state === 'loading',
    events: ev.state === 'ready' ? ev.count : null,
    jobs: jb.state === 'ready' ? jb.count : null,
  };
}

/**
 * #4717 package 3 — D918's events queue, checked: its count, Overdue and
 * created-at counts are whole numbers, and its oldest wait is hours or null
 * (nothing waiting, or nothing dated). Anything else is unreadable.
 */

export function eventQueueOf(overview) {
  const b = blockOf(overview, 'queue.events');
  if (b.state !== 'ready') return b;
  const c = countsAt(b.block, ['count', 'overdue', 'waiting_from_created_at']);
  const oldest = hoursOf(b.block.oldest_hours);
  if (!c || oldest === undefined || c.overdue > c.count || c.waiting_from_created_at > c.count) return { state: 'unreadable', reason: FIGURE_UNREAD };
  return { state: 'ready', count: c.count, overdue: c.overdue, fromCreated: c.waiting_from_created_at, oldestHours: oldest };
}

/** The job board's queue, checked the same way: pending, Overdue and undated are whole numbers. */
export function jobQueueOf(overview) {
  const b = blockOf(overview, 'queue.jobs');
  if (b.state !== 'ready') return b;
  const c = countsAt(b.block, ['pending', 'overdue', 'wait_not_recorded']);
  const oldest = hoursOf(b.block.oldest_wait_hours);
  if (!c || oldest === undefined || c.overdue > c.pending || c.wait_not_recorded > c.pending) return { state: 'unreadable', reason: FIGURE_UNREAD };
  return { state: 'ready', count: c.pending, overdue: c.overdue, notRecorded: c.wait_not_recorded, oldestHours: oldest, review: b.block.review };
}

export function oldestWait(overview) {
  const ev = eventQueueOf(overview);
  const jb = jobQueueOf(overview);
  if (ev.state === 'loading' || jb.state === 'loading') return { text: null, overdue: false, note: null };
  const hours = [];
  const notes = [];
  let overdue = false;
  if (ev.state === 'ready') {
    if (ev.oldestHours !== null) hours.push(ev.oldestHours);
    overdue ||= ev.overdue > 0;
    if (ev.fromCreated > 0) notes.push(`${nf(ev.fromCreated)} events wait from when they were created; their submission was not stamped.`);
  } else notes.push('How long events have waited could not be read.');
  if (jb.state === 'ready') {
    if (jb.oldestHours !== null) hours.push(jb.oldestHours);
    overdue ||= jb.overdue > 0;
    if (jb.notRecorded > 0) notes.push(`${nf(jb.notRecorded)} jobs were submitted before waits were recorded, so they are not dated or marked overdue.`);
  } else notes.push('How long jobs have waited could not be read.');
  return {
    text: hours.length ? waitText(Math.max(...hours)) : null,
    overdue,
    note: notes.length ? notes.join(' ') : null,
  };
}

export function buildNeeds(reads) {
  const er = blockOf(reads.overview, 'queue.event_rows');
  const eq = eventQueueOf(reads.overview);
  const jq = jobQueueOf(reads.overview);
  if ([er, eq, jq].some((b) => b.state === 'loading')) return { state: 'loading' };
  // #4717 package 3: a row is listed only when it has a title and its wait is hours or not recorded.
  const rowOk = (r, wait) => isObj(r) && isText(r.title) && hoursOf(r[wait]) !== undefined;
  const evOk = er.state === 'ready' && eq.state === 'ready' && Array.isArray(er.block.rows) && er.block.rows.every((r) => rowOk(r, 'waiting_hours'));
  const jbOk = jq.state === 'ready' && Array.isArray(jq.review) && jq.review.every((r) => rowOk(r, 'waiting_hours'));
  if (!evOk && !jbOk) return { state: 'unreadable', reason: 'Neither the events nor the job board could be read. That is not the same as nothing waiting.' };
  const wait = (hours, fromCreated) => (hours === null || hours === undefined
    ? 'wait not recorded'
    : `waiting ${waitText(Number(hours))}${fromCreated ? ' · since created' : ''}`);
  const items = [];
  if (evOk) {
    for (const e of er.block.rows) {
      items.push({ kind: 'Event', id: `event-${e.event_id}`, title: e.title, sub: null, wait: wait(e.waiting_hours, e.from_created), overdue: e.overdue === true, since: stamp(e.waiting_since) });
    }
  }
  if (jbOk) {
    for (const j of jq.review) {
      items.push({ kind: 'Job', id: `job-${j.posting_id}`, title: j.title, sub: j.company || null, wait: wait(j.waiting_hours, false), overdue: j.overdue === true, since: stamp(j.waiting_since) });
    }
  }
  // Oldest first; a wait not recorded is listed after every dated one.
  items.sort((a, b) => (Number.isNaN(a.since) ? 1 : Number.isNaN(b.since) ? -1 : a.since - b.since));
  return {
    state: 'ready',
    total: (evOk ? eq.count : 0) + (jbOk ? jq.count : 0),
    overdue: (evOk ? eq.overdue : 0) + (jbOk ? jq.overdue : 0),
    rows: items.slice(0, 6),
    partial: !evOk ? 'The events queue could not be read, so only jobs are listed.' : !jbOk ? 'The job board could not be read, so only events are listed.' : null,
  };
}

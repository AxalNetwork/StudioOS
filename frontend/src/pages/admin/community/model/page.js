/**
 * #4717 package 6 — The page as a whole: its eight tiles, the consoles strip, whether every read failed and whether Community is empty.
 *
 * Split out of communityModel.js, which re-exports what the page and the
 * tests import. Pure: nothing here fetches.
 */
import { showUpTile } from './events.js';
import { deltaText, nf } from './format.js';
import { circlesOf, rosterOf } from './people.js';
import { oldestWait, queueCounts } from './queues.js';
import { FIGURE_UNREAD, blockOf, count, countsAt, failed } from './read.js';
import { expertsOf } from './wellbeing.js';

/** The page's eight tiles, CM1 rows 1 and 2, in the canvas's order. */
export function buildTiles(reads) {
  const tiles = [];

  // Waiting on you — the two review queues, added (#4717: the Community read's own counts).
  const wait = { key: 'waiting', label: 'Waiting on you' };
  const q = queueCounts(reads);
  if (q.loading) tiles.push({ ...wait, state: 'loading' });
  else {
    const ev = { count: q.events };
    const jb = { count: q.jobs };
    if (ev.count === null || jb.count === null) {
      tiles.push({ ...wait, state: 'unreadable', reason: 'The events or jobs queue could not be read, so there is no total.' });
    } else {
      const age = oldestWait(reads.overview);
      tiles.push({
        ...wait,
        state: 'ready',
        value: nf(ev.count + jb.count),
        sub: `${nf(ev.count)} events · ${nf(jb.count)} jobs${age.text ? ` · oldest ${age.text}` : ''}`,
        overdue: age.overdue,
        note: age.note,
      });
    }
  }

  // Upcoming events — D918's next 30 days (published or waiting) and their seats taken (D1121).
  const up = { key: 'upcoming', label: 'Upcoming events' };
  const ub = blockOf(reads.overview, 'events.upcoming');
  if (ub.state !== 'ready') tiles.push({ ...up, ...ub });
  else {
    const c = countsAt(ub.block, ['events', 'seats_taken']);
    tiles.push(c
      ? { ...up, state: 'ready', value: nf(c.events), sub: `next 30 days · ${nf(c.seats_taken)} registered` }
      : { ...up, state: 'unreadable', reason: FIGURE_UNREAD });
  }

  const weeks = reads.overview?.data?.weeks;
  const period = (key, label, path, pick) => {
    const b = blockOf(reads.overview, path);
    if (b.state !== 'ready') return { key, label, ...b };
    // #4717: a figure the block does not carry as whole numbers is unreadable, never 0 and never a crash.
    const fig = pick(b.block) || {};
    const window = count(fig.window);
    const previous = count(fig.previous);
    if (window === null || previous === null) return { key, label, state: 'unreadable', reason: 'This figure could not be read. That is not the same as none.' };
    return { key, label, state: 'ready', value: nf(window), sub: deltaText(window, previous, weeks) };
  };
  tiles.push(period('registrations', 'Event registrations', 'events.weekly', (b) => b.registrations));
  tiles.push(period('applications', 'Job applications', 'jobs', (b) => b.applications));
  tiles.push(showUpTile(reads.overview, weeks));

  // Published circles — "[9] of [11]".
  const pc = { key: 'circles', label: 'Published circles' };
  const ci = circlesOf(reads);
  if (ci.state !== 'ready') tiles.push({ ...pc, state: ci.state, ...(ci.reason ? { reason: ci.reason } : {}) });
  else tiles.push({ ...pc, state: 'ready', value: `${nf(ci.published)} of ${nf(ci.total)}` });

  // Advisors & partners — active on the roster.
  const ro = { key: 'roster', label: 'Advisors & partners' };
  const roster = rosterOf(reads);
  if (roster.state !== 'ready') tiles.push({ ...ro, state: roster.state, ...(roster.reason ? { reason: roster.reason } : {}) });
  else tiles.push({ ...ro, state: 'ready', value: nf(roster.active), sub: 'active on the roster' });

  const ex = expertsOf(reads.overview);
  if (ex.state !== 'ready') tiles.push({ key: 'experts', label: 'Wellbeing experts', ...ex });
  else {
    const { verified, unverified, hidden, inactive } = ex;
    const away = [hidden ? `${nf(hidden)} hidden` : null, inactive ? `${nf(inactive)} inactive` : null].filter(Boolean).join(' · ');
    tiles.push({
      key: 'experts',
      label: 'Wellbeing experts',
      state: 'ready',
      value: `${nf(verified)} verified of ${nf(verified + unverified)}`,
      sub: away ? `listed · ${away} not listed` : 'listed, sample experts not counted',
    });
  }
  return tiles;
}

/**
 * The oldest wait in the review queues (D931's `queue`), and whether anything
 * is Overdue. A queue that could not be read gives no age, and says so; one
 * whose items have no recorded submission says how many, and never dates them.
 */

/** CM1 row 8: five console doors, one figure each. */
export function buildConsoles(reads) {
  const q = queueCounts(reads);
  const lane = (key) => {
    if (q.loading) return { state: 'loading' };
    return q[key] === null ? { state: 'unreadable' } : { state: 'ready', text: `${nf(q[key])} pending` };
  };
  const ci = circlesOf(reads);
  return {
    events: lane('events'),
    jobs: lane('jobs'),
    circles: ci.state === 'ready' ? { state: 'ready', text: `${nf(ci.draft)} drafts` } : { state: ci.state },
    roster: (() => {
      const ro = rosterOf(reads);
      return ro.state === 'ready' ? { state: 'ready', text: `${nf(ro.active)} active` } : { state: ro.state === 'loading' ? 'loading' : 'unreadable' };
    })(),
    wellbeing: (() => {
      const ex = expertsOf(reads.overview);
      return ex.state === 'ready' ? { state: 'ready', text: `${nf(ex.unverified)} to verify` } : { state: ex.state === 'loading' ? 'loading' : 'unreadable' };
    })(),
  };
}

/** CM10 variant B: every read failed. The consoles strip still works. */
export function pageFailed(reads) {
  // #4717: the page has one read; when it fails, nothing is drawn.
  return failed(reads.overview);
}

/**
 * CM8: the Community read answered, and nothing has happened yet: no event in
 * any status, no posting in any status and no circle. Zeros are real here,
 * and only the read's own counts decide it (#4717); a block it could not read
 * is never taken for an empty one.
 */

export function isEmptyCommunity(reads) {
  const ev = blockOf(reads.overview, 'events.by_status');
  const jb = blockOf(reads.overview, 'jobs');
  const ci = circlesOf(reads);
  if (ev.state !== 'ready' || jb.state !== 'ready' || ci.state !== 'ready') return false;
  const zero = (o) => o && typeof o === 'object' && Object.values(o).every((v) => count(v) === 0);
  return zero(ev.block.counts) && zero(jb.block.by_status) && ci.total === 0;
}

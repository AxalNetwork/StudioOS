/**
 * #4717 package 6 — The page as a whole: its eight figures and D4820's four KPIs, the Manage Community figures, and whether every read failed.
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

/**
 * The page's eight figures, in v1's order. D4820 draws four of them as the KPI
 * row (`buildKpis`); show-up is drawn in Events, published circles and the
 * roster in Network, and wellbeing experts in Wellbeing.
 */
export function buildTiles(reads) {
  const tiles = [];

  // Waiting on you — the review queues, added (#4717: the Community read's own counts; D4820 part 3: the experts to verify too).
  const wait = { key: 'waiting', label: 'Waiting on you' };
  const q = queueCounts(reads);
  if (q.loading) tiles.push({ ...wait, state: 'loading' });
  else {
    if (q.events === null || q.jobs === null || q.experts === null) {
      tiles.push({ ...wait, state: 'unreadable', reason: 'The events, jobs or wellbeing experts queue could not be read, so there is no total.' });
    } else {
      const age = oldestWait(reads.overview);
      tiles.push({
        ...wait,
        state: 'ready',
        value: nf(q.events + q.jobs + q.experts),
        sub: `${nf(q.events)} events · ${nf(q.jobs)} jobs · ${nf(q.experts)} experts${age.text ? ` · oldest ${age.text}` : ''}`,
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

/** Manage Community's figures (CM1 row 8, D4820 CM01): one per console that has a queue or drafts. */
export function buildConsoles(reads) {
  const q = queueCounts(reads);
  const lane = (key, verb = 'to review') => {
    if (q.loading) return { state: 'loading' };
    return q[key] === null ? { state: 'unreadable' } : { state: 'ready', text: `${nf(q[key])} ${verb}` };
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
    // D4820 part 3: the experts Approvals would list, the same number as Waiting on you's, not every unverified profile.
    wellbeing: lane('experts', 'to verify'),
  };
}

/** CM10 variant B: every read failed. The consoles strip still works. */
export function pageFailed(reads) {
  // #4717: the page has one read; when it fails, nothing is drawn.
  return failed(reads.overview);
}

/** D4820: the four authoritative KPIs, in the canvas's order. Active members is never one: it is not recorded. */
export const KPI_KEYS = ['waiting', 'upcoming', 'registrations', 'applications'];

/** D4820 CM01: the KPI row, the four figures of `buildTiles` whose keys are `KPI_KEYS`. */
export function buildKpis(reads) {
  const tiles = buildTiles(reads);
  return KPI_KEYS.map((k) => tiles.find((t) => t.key === k));
}

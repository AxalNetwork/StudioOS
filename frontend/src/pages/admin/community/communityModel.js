/**
 * D930 (#2367) — Admin › Community at /admin/community, built to the owner's
 * "Community overview" canvas (CM1–CM13). Pure: it turns the reads the page
 * makes into tiles and blocks, and never fetches.
 *
 * EVERY FIGURE IS IN ONE OF FOUR STATES:
 *   - `ready`: read, with its value;
 *   - `loading`: the read has not answered;
 *   - `unreadable`: the read failed, which is not a claim of zero;
 *   - `unrecorded`: no store records it (CM1's two cards), said in a
 *     sentence and never drawn as 0.
 * D930's `notyet` is gone: D933 reads every figure it stood for.
 *
 * THE READS (D930 §2). Each answers alone:
 *   #4717 package 2: ONE SNAPSHOT. Every figure on the page, and every
 *   row behind a figure (next up, needs a decision, most applications), is
 *   the Community read's, under one `as_of`. The page used to read the Studio
 *   glance, every page of the events list, the events analytics, every page
 *   of the job board and the circles list beside it, and recompute what the
 *   read already counted; those reads now belong to the lightboxes alone.
 *   - `overview`  GET /api/admin/community/overview?weeks= — D931's counts,
 *                 the roster's among them (#4717: counted on the server over
 *                 the whole table, archived rows out, never a capped list),
 *                 every period figure and chart (D933). Each block answers
 *                 alone: `{ available: true }`, `{ available: false, reason }`
 *                 or `{ recorded: false, reason }`;
 *   - `activity`  GET /api/admin/community/activity — D932's ten newest rows,
 *                 read by the Recent activity card itself, for its chips.
 *
 * D933 (#2717) draws every figure D930 left waiting for these reads: the
 * period control, every tile and its delta, the weekly chart and its table,
 * the funnel and events by type, who takes part, wellbeing, the waits in
 * Needs a decision, and Recent activity. No block waits for a part any more.
 *
 * #4717 package 6: ONE MODULE PER DOMAIN, under `model/` (README there). This
 * file is their front door and re-exports exactly what it always exported,
 * so the page, the lightboxes and the tests import from one place.
 */

export { SCOPE_LABEL, SCOPE_TITLE } from '../insights/insightsModel';
export { AS_ENTERED_TIP, CHECKINS_WITHHELD, COMMUNITY_PATH, EMPTY_LINE, MIN_CHECKIN_COHORT, MOVED_KEY, MOVED_NOTICE, NOT_RECORDED, OVERDUE_HOURS, PAGE_LINE, PAGE_UNREADABLE, RECENT_ROWS } from './model/constants.js';
export { DEFAULT_WEEKS, PERIODS, searchWithWeeks, weeksFrom } from './model/period.js';
export { blockOf, clockOf, laneOf, readAllPages } from './model/read.js';
export { asOfLabel, beforeLabel, dayLabel, daysOpenText, deltaText, jobDaysOpen, seatsText, stamp, waitText, weekLabel } from './model/format.js';
export { buildNeeds, oldestWait } from './model/queues.js';
export { buildEventsFunnel, buildNextUp } from './model/events.js';
export { buildJobs } from './model/jobs.js';
export { buildCircles, rosterOf } from './model/people.js';
export { biggestChange, buildActivity, buildWho } from './model/activity.js';
export { buildWellbeing } from './model/wellbeing.js';
export { buildConsoles, buildTiles, isEmptyCommunity, pageFailed } from './model/page.js';

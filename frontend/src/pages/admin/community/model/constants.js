/**
 * #4717 package 6 — The page's fixed words and numbers: its address, the moved notice, the empty and unreadable lines, the Overdue hours, the check-in cohort and CM1's two figures no store records.
 *
 * Split out of communityModel.js, which re-exports what the page and the
 * tests import. Pure: nothing here fetches.
 */

export const COMMUNITY_PATH = '/admin/community';

export const MOVED_KEY = 'held-community';

export const MOVED_NOTICE = 'Community has a new address. Update your bookmark.';

export const PAGE_LINE = 'What members did in events, jobs, circles and wellbeing, and what waits on you.';

export const PAGE_UNREADABLE = 'Community figures could not be read. Nothing here is a zero.';

export const AS_ENTERED_TIP = 'An admin types this number on each circle. It is not counted from sign-ups.';

/** D915: an item waiting longer than this is Overdue (D931's `overdue_hours`). */
export const OVERDUE_HOURS = 72;

/** The check-in band is withheld under this many founders (D931's `min_cohort`). */
export const MIN_CHECKIN_COHORT = 7;

export const CHECKINS_WITHHELD = 'Too few check-ins to show. We show this only when seven or more founders check in.';

export const RECENT_ROWS = 10;

/** CM1's two figures no store records. The canvas's first sentence was stale (D893): see D930 §5. */
export const NOT_RECORDED = [
  {
    key: 'active-members',
    title: 'Active members',
    reason: 'Nothing records who took part in Community, apart from using the platform. Insights counts active accounts platform-wide.',
  },
  {
    key: 'circle-discussions',
    title: 'Circle discussions',
    reason: 'Circles have no discussion store. The number on a circle is typed by an admin.',
  },
];

/** D4820 CM02d: Needs your attention when both queues were read and nothing waits. */
export const QUEUE_CLEAR = 'Nothing needs your attention · Approvals are currently clear.';

/** D4820 CM04a: a genuinely empty Community. */
export const BUILD_TITLE = 'Build your community';
export const BUILD_LINE = 'Create your first event or circle to start seeing participation, opportunities and community activity here.';

/** D4820: the Additional insights row, one line for every figure no store records (`NOT_RECORDED`). */
export const insightsLabel = (n) => `Additional insights · ${n} unavailable`;
export const INSIGHTS_EMPTY_LEAD = 'Activity analytics will appear once there is enough community activity';

/** D4820 CM01: Manage Community, six destinations, one short line each (the canvas's words). */
export const MANAGE_TITLE = 'Manage Community';
export const MANAGE_LINE = 'Where decisions and changes happen';

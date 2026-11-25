/** Addresses, navigation and shared copy for the Approvals page. Existing board and lane imports also resolve here. */
import { EXPERT_TABS, PITCH_TABS, TESTER_TABS } from './approvalsBoardModel.js';

export const PATH = '/admin/approvals';

export const TITLE = 'Approvals';

// D4814: the intro copy, as the issue words it.
export const LINE = 'Review every waiting decision here. Continue to the relevant review surface when required.';

export const LANES_LINE = 'Each lane is one kind of decision. Most are decided on their own page.';

export const DECIDED_LINE = 'Decisions made here and on each lane’s own page, newest first.';

export const RAIL_NOTE = 'Eadwyn reads what is waiting here. Nothing is decided until you decide it.';

export const MOVED_KEY = 'held-approvals';

export const MOVED_NOTICE = 'Approvals has a new address. Update your bookmark.';

export const LANE_FAILED = 'Could not be read';

/** The page's tabs (APR1, APR2, APR10), each its own address. */
export const TABS = [
  { key: 'inbox', label: 'Inbox', path: '' },
  { key: 'lanes', label: 'Lanes', path: '/lanes' },
  { key: 'decided', label: 'Decided', path: '/decided' },
];

export function tabOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  const t = TABS.find((x) => `${PATH}${x.path}` === p);
  return t ? t.key : 'inbox';
}

// D1045 (#2893): the glance-built Inbox (its Waiting tile, lane rows, group
// counts, bars and filters) gave way to the inbox read; see inboxModel.js.

/* ------------------------------------------------------------------ *
 * The lane boards (APR4, APR6, APR8)
 * ------------------------------------------------------------------ */
export const BOARDS = {
  'product-testers': { title: 'Product testers', line: 'Anyone with a profile can apply to test products. Approve them and testing programs can pick them.' },
  'co-marketing': { title: 'Co-marketing pitches', line: 'Partners pitch joint webinars, posts and events. Approve the idea, then publish it when it goes out.' },
  'wellbeing-experts': { title: 'Wellbeing experts', line: 'Members only see verified experts. Check each expert’s credentials before you verify them.' },
};

const BOARD_TABS = [['co-marketing', PITCH_TABS], ['wellbeing-experts', EXPERT_TABS], ['product-testers', TESTER_TABS]];

/**
 * What a lane-board path opens: the board and its tab, or null. D1046: one
 * segment past a board that is not a tab is one item's address
 * (`/admin/approvals/co-marketing/<uid>`): the board on its first tab, with
 * that item's drawer open. Tab paths win, so no id can shadow a tab.
 */
export function boardOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  for (const [slug, tabs] of BOARD_TABS) {
    const t = tabs.find((x) => `${PATH}/${slug}${x.path}` === p);
    if (t) return { board: slug, tab: t.key };
  }
  for (const [slug, tabs] of BOARD_TABS) {
    const head = `${PATH}/${slug}/`;
    if (!p.startsWith(head)) continue;
    const rest = p.slice(head.length);
    if (rest && !rest.includes('/')) {
      let item;
      try { item = decodeURIComponent(rest); } catch { return null; }
      return { board: slug, tab: tabs[0].key, item };
    }
  }
  return null;
}

/** The path of a board's tab. */
export const tabPath = (board, key) => {
  const tabs = BOARD_TABS.find(([slug]) => slug === board)?.[1] || [];
  return `${PATH}/${board}${tabs.find((t) => t.key === key)?.path || ''}`;
};

export {
  NOT_YET, GLANCE_FAILED, GROUPS, LANES, HQ_LANES, isHqLane, HQ_ONLY_TITLE, HQ_ONLY_LINE,
  NOT_A_QUEUE, bandOf, laneView, laneViews, oldestLine,
} from './approvalsLanesModel.js';

export { ageText, hoursSince, dayText } from './approvalsFormat.js';

export {
  PITCH_TABS, EXPERT_TABS, TESTER_TABS, assetWord, pitchRows, attributionTotals, expertState,
  credentialsText, expertBoard, PROFILES, profileWord, INTAKE_PAUSED, INTAKE_PAUSED_LINE,
  identityWord, testerRows, profileChart, profileChartFromCounts, answerPairs, testerHistory,
  testerActions, REASON_MIN, reasonReady, publishUrlOk, decisionCopy, doneLine, refusalLine,
} from './approvalsBoardModel.js';

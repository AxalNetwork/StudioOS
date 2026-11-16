/**
 * D4817 part 8 (#5311, canvas PF-08): the Admin Investor preview of Portfolio,
 * as a pure model — who is previewing, which board an address draws, the one
 * banner's words, and what each board withholds and which writes it turns off.
 *
 * WHAT A PREVIEW IS. An administrator who picks Investor in the shell's
 * Preview shell menu browses the investor shell with their OWN session
 * (`lib/previewShells.js`: "data and permissions unchanged"). That is not an
 * investor: a Portfolio read would answer with the administrator's book, or
 * none, and a write would go out as the administrator. So the preview draws
 * each Portfolio board's layout, navigation and section headings, reads no
 * investor record, marks every withheld record "Private in preview" (never a
 * 0 and never an empty book), and turns every write off with a reason
 * (canvas PF-08; addendum: "one shared banner and compact withheld sections,
 * without private reads"). A support session (View As) is not a preview: the
 * session is the member's own, and nothing here applies.
 */
import { PREVIEW_SHELLS, homePreviewKey } from '../../lib/previewShells';

/** The banner, in the canvas's words. */
export const PREVIEW_BANNER = 'Previewing Investor · private investor data withheld';
/** The banner's second line: what the preview reads and that it writes nothing. */
export const PREVIEW_READ_ONLY = 'Read-only. You are seeing the Investor shell with your own administrator session, so no investor’s positions, reports or support are read, and nothing on these pages can be changed.';
/** The chip a withheld record carries. */
export const PRIVATE_IN_PREVIEW = 'Private in preview';
/** Why a write is off. */
export const WRITES_OFF = 'Writes are disabled in preview: each of these acts on an investor’s own record. To act as a member, use View As on their row in Team.';

/**
 * True when the session is an administrator previewing the Investor shell:
 * an admin, not in a support session, browsing as `investor`. `view` is the
 * shell's `useViewMode()` value.
 */
export function isInvestorPreview(view) {
  return Boolean(view) && view.isAdmin === true && view.isImpersonating !== true && view.viewMode === 'investor';
}

/** The Portfolio board each previewed address draws, or null for an address the preview does not draw. */
const BOARD_PATHS = {
  '/portfolio': 'overview',
  '/portfolio/health': 'overview',
  '/portfolio/positions': 'positions',
  '/portfolio/updates': 'updates',
  '/portfolio/performance': 'performance',
  '/portfolio/value-add': 'value-add',
};
export function previewBoardOf(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  return BOARD_PATHS[path] || null;
}

/**
 * True when the page at `pathname` draws its own preview banner, so the shell's
 * Preview shell strip stands down there and the viewer reads one banner, not
 * two that disagree about writes. `selectedKey` is the switcher's selection.
 */
export function pageOwnsPreviewBanner(pathname, selectedKey) {
  return selectedKey === 'investor' && (previewBoardOf(pathname) !== null || previewCompanyTabOf(pathname) !== null);
}

/**
 * D4817 part 10 (#5311): the company workspace's addresses
 * (`/portfolio/companies/:uid` and its tabs, App.jsx's routes) and the tab
 * each names, or null for an address that is not one. `terms` is the old
 * Terms address, which lands on Financials.
 */
const COMPANY_PATH = /^\/portfolio\/companies\/[^/]+(?:\/(reports|terms|financials|support|activity))?\/?$/;
export function previewCompanyTabOf(pathname) {
  const m = COMPANY_PATH.exec(String(pathname || ''));
  if (!m) return null;
  return m[1] || 'overview';
}

/** The way back: the viewer's own shell, as the Preview shell strip names it. */
export function previewExitLabel(superAdmin) {
  const home = PREVIEW_SHELLS.find((o) => o.key === homePreviewKey(superAdmin === true));
  return `Back to ${home ? home.label : 'HQ'}`;
}

/** The frame's nav slug for a board (the Overview has none). */
export function frameTabOf(board) {
  return board === 'overview' ? null : board;
}

/** The addendum's route-aware title: `Investor preview` before `Axal VC`. */
export function previewDocTitle(title) {
  return String(title).replace(/ · Axal VC$/, ' · Investor preview · Axal VC');
}

/** The performance figures the Overview and Performance draw, each withheld, with its definition. */
export const PREVIEW_FIGURES = [
  { key: 'tvpi', label: 'TVPI', note: 'Total value ÷ paid-in' },
  { key: 'dpi', label: 'DPI', note: 'Distributed ÷ paid-in' },
  { key: 'rvpi', label: 'RVPI', note: 'Unrealised ÷ paid-in' },
  { key: 'irr', label: 'IRR', note: 'Cash-flow dated' },
  { key: 'paid_in', label: 'Invested capital', note: 'Paid-in' },
  { key: 'unrealised', label: 'Unrealised value', note: 'Latest marks, unmarked at cost' },
  { key: 'distributed', label: 'Realised proceeds', note: 'Distributions recorded' },
  { key: 'companies', label: 'Companies', note: 'Positions in the book' },
];

/**
 * Each board in preview: whether it leads with the performance summary, its
 * tiles and sections (each withheld), and the writes the real board offers,
 * drawn off. The headings are the real boards' own.
 */
export const PREVIEW_BOARDS = {
  overview: {
    performance: true,
    tiles: [],
    sections: [
      { key: 'attention', title: 'Needs attention' },
      { key: 'reporting', title: 'Reporting' },
      { key: 'value-add', title: 'Value-add' },
      { key: 'companies', title: 'Portfolio companies' },
    ],
    writes: [],
  },
  positions: {
    performance: false,
    tiles: [],
    sections: [
      { key: 'register', title: 'Investment register' },
      { key: 'attention-rules', title: 'Attention rules and evidence' },
      { key: 'mark-history', title: 'Mark history' },
    ],
    writes: [],
  },
  updates: {
    performance: false,
    tiles: ['Received', 'Not received'],
    sections: [
      { key: 'obligations', title: 'Reporting obligations' },
      { key: 'duties', title: 'Companies you signed into' },
    ],
    writes: [
      { key: 'chase', label: 'Chase' },
      { key: 'chase-overdue', label: 'Chase all overdue' },
    ],
  },
  performance: {
    performance: true,
    tiles: [],
    sections: [
      { key: 'quarters', title: 'NAV at each quarter-end' },
      { key: 'cohorts', title: 'Vintage cohorts' },
    ],
    writes: [],
  },
  'value-add': {
    performance: false,
    // The figures and sections PF-05 (D4817 part 5) draws on the real board.
    tiles: ['Open commitments', 'In progress', 'Delivered', 'Introductions made', 'Overdue commitments', 'No support recorded'],
    sections: [
      { key: 'commitments', title: 'Commitments' },
      { key: 'introductions', title: 'Introductions' },
    ],
    writes: [
      { key: 'log-support', label: 'Log support' },
      { key: 'deliver', label: 'Deliver' },
      { key: 'withdraw', label: 'Withdraw' },
    ],
  },
};

/* ------------------------------------------------- the company workspace */

/**
 * D4817 part 10 (#5311): who the previewed company is. Its name, sector,
 * stage and holding come only from the investor's own reads (positions, the
 * reports owed), so the preview reads none and says so in their place.
 */
export const COMPANY_WITHHELD = 'Company withheld in preview';

/** The company workspace's six key facts (`companyModel.js`' `keyFactsOf`), each withheld. */
export const PREVIEW_COMPANY_FACTS = [
  { key: 'invested', label: 'Invested' },
  { key: 'ownership', label: 'Ownership' },
  { key: 'fmv', label: 'Latest FMV' },
  { key: 'multiple', label: 'Multiple' },
  { key: 'report', label: 'Latest report' },
  { key: 'support', label: 'Open support' },
];

/**
 * Each company tab in preview: its sections, headed as the real tab heads
 * them (a heading that carries the company's name says "this company"), and
 * the writes the real tab offers, drawn off.
 */
export const PREVIEW_COMPANY_TABS = {
  overview: {
    sections: [
      { key: 'why', title: 'Health and evidence' },
      { key: 'next', title: 'Next actions' },
      { key: 'reported', title: 'Company-reported performance' },
      { key: 'recent', title: 'Recent activity' },
    ],
    writes: [],
  },
  financials: {
    sections: [
      { key: 'rounds', title: 'Investment history · gross' },
      { key: 'return', title: 'Return' },
      { key: 'marks', title: 'Valuation marks' },
      { key: 'distributions', title: 'Distributions' },
      { key: 'ownership-rights', title: 'Ownership & rights' },
      { key: 'captable', title: 'Cap table' },
    ],
    writes: [{ key: 'captable-ask', label: 'Ask for access' }],
  },
  reports: {
    sections: [
      { key: 'obligation', title: 'Reporting obligation' },
      { key: 'timeline', title: 'Reports owed to you' },
      { key: 'updates', title: 'Updates you received' },
    ],
    writes: [
      { key: 'ask', label: 'Ask for this report' },
      { key: 'waive', label: 'Waive this period' },
    ],
  },
  support: {
    sections: [{ key: 'support', title: 'Support for this company' }],
    writes: [{ key: 'record-support', label: 'Record support…' }],
  },
  activity: {
    sections: [{ key: 'activity', title: 'Activity · newest first' }],
    writes: [],
  },
};

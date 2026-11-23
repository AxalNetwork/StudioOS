/**
 * Build's entry in CycleRoute.jsx's cycle table (D661, #1474; split out by
 * D5615, #5615): its modules, the one place a startup is created, Connect a
 * tool and its lightbox (D650, D686), the connector parts (D1311), its tools
 * and its AI bands (D424, D510, D6042).
 */
import ConnectToolSheet from '../../account/ConnectToolSheet';
import { buildPartsMap } from '../buildParts';
import { toFnMap } from '../adapters';
import { MODULES } from '../modules';
import { cyclesWrite } from '../../../lib/api/cycles';
import { buildModuleExportApi } from '../../../lib/api/buildModuleExport.js';
import MvpSummary from '../MvpSummary';
import SolutionDesignRisks from '../SolutionDesignRisks';
import RoadmapBoard from '../RoadmapBoard';
import { mvpPhoneRow } from '../mvpTable';
import { BUILD_ASKS, BUILD_RAIL_NOTES } from '../buildEadwyn';
import { lazyStep } from '../lazyStep.jsx';

// D6028 (#6028, BD1, BD2): Build Overview V2, behind its own lazy boundary.
const BuildOverview = lazyStep(() => import('../BuildOverview'));

/**
 * Build's read (#1475, D662) is already in D661's shape (chart specs,
 * `{ key, label }` columns, `{ id, cells }` rows), so it passes through with
 * no adapter, as Raise's does. The primary action is D650's Connect a tool,
 * the sheet the Build desk opened.
 *
 * Build's new stores (risks, formation steps, the must-have mark) have no
 * page of their own: their Add and Edit forms are `forms.js`'s, on the
 * module page. The roadmap, the cap table and the operating cadence link
 * the pages that edit them today.
 */
const build = {
  Overview: BuildOverview,
  modules: MODULES.build,
  // THE ONE PLACE A STARTUP IS CREATED. `/projects` is retired and the Build
  // desk inherited the only `api.createProject` caller; sixteen links,
  // the Command Palette's among them, address it as `/build?new=1`. The
  // Build overview keeps it: `?new=1` opens the form, also when this page is
  // already mounted.
  creates: true,
  path: 'connect',
  Mount: BuildMount,
  action: (q, open) => ({ label: 'Connect a tool', href: `/build/connect${q}`, onOpen: open }),
  // D5077 (#5077, BD7, BD8, BD18 A): Connect a tool is the overview's primary only. On a module the
  // header gives way to the module's own work, the connector parts draw in a Sources region under the
  // records, and that region carries Connect a tool as "Connect or manage tools".
  modulePrimary: false,
  sourcesRegion: true,
  // D4846 part 2 (#6032, BD14 B): from 768px to 1023px Build draws its desktop pages laid out for a tablet,
  // not the phone page (`ui/phone/tabletTier.js`).
  tabletPages: true,
  // D5077 (BD21): each module's own Eadwyn asks and rail sentence (buildEadwyn.js).
  asks: BUILD_ASKS,
  railNotes: BUILD_RAIL_NOTES,
  // D1311 (#2398, #2408): each module's connector parts, in the canvases'
  // order, one line per connector (buildParts.jsx). GitHub's are D782's;
  // Vercel's and Lovable's lines wait there for their tasks.
  parts: toFnMap(buildPartsMap()),
  // D6036 (#6036): Product roadmap's board links /build/roadmap itself, as Dependencies and Scenarios (D6034 part 2,
  // option A), so the module draws no second door to it.
  tools: toFnMap({
    'founding-team': (q) => ({ label: 'Open the cap table and vesting', href: `/raise/cap-table${q || ''}` }),
    'operating-systems': (q) => ({ label: 'Open the operating cadence', href: `/build/cadence${q}` }),
  }),
  add: toFnMap({}),
  fills: {},
  // D6031 (#6031, BD8): Prototype / MVP's summary line above its table ("N of M must-haves complete ·
  // target <date> · N blocked", with Set for a missing date), and its phone rows carrying Due, Test, Built and Tested.
  aboveRecords: toFnMap({
    'prototype-mvp': (module, { projectId, reload }) => (
      <MvpSummary facts={module?.facts} save={(date) => cyclesWrite.build.mvpTarget(projectId, date)} onSaved={reload} />
    ),
    // D6033 (#6033, BD25, Q1 A): Solution design's Risks list, its own paged read, above the features table.
    // A risk added or edited re-reads the module, so the counts card's severities follow.
    'solution-design': (_module, { projectId, reload, search }) => (
      <SolutionDesignRisks key={projectId} projectId={projectId} search={search} onChanged={reload} />
    ),
    // D6036 (#6036, BD25, BD26, BD30): the figure strip, Board and Timeline above the roadmap's list.
    'product-roadmap': (module, { query, onQuery, search }) => <RoadmapBoard module={module} query={query} onQuery={onQuery} search={search} />,
  }),
  // D6033 (BD34): the Risks list shows on a phone before the venture has a feature (a Build Plan risk needs none).
  aboveRecordsWhenEmpty: ['solution-design'],
  phoneRows: toFnMap({ 'prototype-mvp': mvpPhoneRow }),
  // D6043 (#6043): each module's records list as CSV, with the table's own search, filters and sort.
  exportRecords: (projectId, slug, query) => buildModuleExportApi.exportCsv(projectId, slug, query),
  // The Build desk's four AI bands (ZoneDraft, D424, D510), on the modules
  // they read: the roadmap tradeoff on Product roadmap; the Monday plan, the
  // Friday retro and the KPI annotation on Operating systems, the weekly
  // cadence they serve. D6042 adds the split-and-vesting check on Founding
  // team and the filings summary on Company creation.
  drafts: new Map([
    ['product-roadmap', [{
      surface: 'build/roadmap', label: 'Proposal · tradeoff, reasoned', run: 'Argue the ordering', accept: 'Accept the argument',
      empty: 'Nothing proposed yet. Eadwyn will read the horizons and quarters you have set and argue the one ordering most worth changing — from the record, not from anything it knows about your market.',
      nothingToDraft: 'There are no objectives to argue an order between yet.',
      foot: 'This writes an argument, never an order. Reordering stays in Roadmap.',
    }]],
    // D6042 (#6042): Founding team's and Company creation's record-only drafts. #5077 owns the
    // modules' asks and rail sentences (buildEadwyn.js); these are only the bands behind them.
    ['founding-team', [{
      surface: 'build/founding', label: 'Check · split and vesting', run: 'Check the split and vesting', accept: 'Keep this check',
      empty: 'Nothing checked yet. Eadwyn will read the founders on your cap table — each one\'s ownership, vesting and agreement — say whether the split adds up, and list what is not recorded. It never says what the split or vesting should be.',
      nothingToDraft: 'No founder is recorded on the cap table for this startup yet.',
      foot: 'Kept as wording only. The cap table and vesting change only in the cap table.',
    }]],
    ['company-creation', [{
      surface: 'build/company', label: 'Summary · filings and formation', run: 'Summarise the filings', accept: 'Keep this summary',
      empty: 'Nothing summarised yet. Eadwyn will read your formation order, formation steps and open obligations, explain where formation stands, and name what is due next — from the record, never from a jurisdiction\'s rules.',
      nothingToDraft: 'No formation order, filing or entity is recorded for this startup yet.',
      foot: 'Kept as wording only. Nothing is filed and no filing changes.',
    }]],
    ['operating-systems', [{
      surface: 'build/this-week', label: 'Proposal · Monday plan', run: 'Draft a Monday plan', accept: 'Accept the plan',
      empty: 'Nothing proposed yet. Eadwyn will read what actually moved — your current key results and the cards still open — and propose next week\'s commitments.',
      nothingToDraft: 'There are no current objectives and no open cards to plan from yet.',
      foot: 'Owners and risk are never proposed: neither is recorded.',
    }, {
      surface: 'build/retro', label: 'Proposal · retro summary', run: 'Draft a retro summary', accept: 'Accept the summary',
      empty: 'Nothing proposed yet. Eadwyn will read this week on your board — the cards touched in the last seven days and the open ones past their due date — and summarise it for your Friday retro.',
      nothingToDraft: 'There are no cards on this board to summarise yet.',
      foot: 'The board keeps no history of its moves, so the summary never says how often a card moved.',
    }, {
      surface: 'build/kpi', label: 'Out of range · explain this?', run: 'Draft an annotation', accept: 'Keep this annotation',
      empty: 'Nothing proposed yet. Eadwyn will name the figure that moved most between your last two snapshots and draft one line about the movement — never about its cause, which nothing here records.',
      nothingToDraft: 'No metric snapshot is recorded for this startup yet.',
      foot: 'Kept as wording only. The snapshot has no annotation field to attach it to.',
    }]],
  ]),
};

export default build;

// D686 §5.4 (#1597): the sheet connects for this project's company, and a
// change re-reads the Build page once the lightbox closes.
function BuildMount({ projectId, onClose, onChanged, asPage }) {
  return <ConnectToolSheet projectId={projectId} onClose={onClose} onChanged={onChanged} asPage={asPage} />;
}

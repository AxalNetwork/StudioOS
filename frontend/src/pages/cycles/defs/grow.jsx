/**
 * Grow's entry in CycleRoute.jsx's cycle table (D661, #1474; split out by
 * D5615, #5615): its modules, Share an update and its lightbox (D654, D686),
 * Distribution's own primary (D4484), each module's parts and its AI band.
 */
import { cyclesWrite } from '../../../lib/api/cycles';
import ShareUpdateLightbox from '../../founder/ShareUpdateLightbox';
import { distributionPrimary } from '../distribution/distributionModel.js';
import DurableCompanyRecord from '../DurableCompanyRecord';
import DurabilityChecklist from '../DurabilityChecklist';
import DurableDueStrip from '../DurableDueStrip';
import GrowFromMercury from '../GrowFromMercury';
import GrowFromTiktok from '../GrowFromTiktok';
import { DurableFromGoogle, RevenueFromGoogle } from '../GrowFromGoogle';
import FromNotion from '../FromNotion';
import { ImprovementPosthog, RevenuePosthog } from '../GrowPosthog';
import UpdateAskReplies from '../UpdateAskReplies';
import FeedbackThemes from '../FeedbackThemes';
import FeedbackTab, { addFeedbackAction } from '../FeedbackTab';
import { api as mainApi } from '../../../lib/api';
import { toFnMap } from '../adapters';
import { MODULES } from '../modules';
import PartnershipsCoMarketing from '../PartnershipsCoMarketing';
import { lazyStep } from '../lazyStep.jsx';
import { growModuleTitle } from '../growOverviewModel';

// D4574 (#4574, H5): Grow's steps, each behind its own lazy boundary.
const CalendarWeek = lazyStep(() => import('../distribution/CalendarTab.jsx'), 'CalendarWeek');
const UpdatesHistory = lazyStep(() => import('../UpdatesHistory'));
const GrowOverview = lazyStep(() => import('../GrowOverview'));

/** D840 part 3 (#2348): a Grow module's "From Mercury" part, from its read's `parts.from_mercury`. */
const fromMercury = (slug, data, ctx) => <GrowFromMercury slug={slug} part={data?.parts?.from_mercury} projectId={ctx.projectId} reload={ctx.reload} />;
// D5866 (#5866): the founder's own TikTok, after From Mercury, anchored at #from-tiktok.
const fromTiktok = (slug, data, ctx) => <GrowFromTiktok slug={slug} part={data?.parts?.from_tiktok} projectId={ctx.projectId} reload={ctx.reload} />;

/**
 * Grow's read (#1488, D664) carries its own shapes, so it has an adapter
 * (`adapters/grow.js`), as Validate does. The primary action is D654's
 * Share an update, the sheet the Grow desk opened.
 *
 * Every Grow store has its Add and Edit form in `forms.js`, on the module
 * page (D695, #1657): Open a role writes through `POST /cycles/grow/roles`,
 * and the jobs board keeps its own editor. The metric log, Talent and the
 * compliance calendar stay one tool link away.
 */
/** D6865 part 2 (#6891, GR-21C): Eadwyn's feedback-theme placements, through the existing proposal routes. */
const FEEDBACK_PROPOSALS = {
  list: (projectId) => mainApi.listValidateProposals(projectId),
  accept: (id) => mainApi.acceptValidateProposal(id),
  discard: (id) => mainApi.discardValidateProposal(id),
};

const grow = {
  Overview: GrowOverview,
  moduleName: (slug) => growModuleTitle(slug),
  modules: MODULES.grow,
  path: 'update',
  Mount: GrowMount,
  action: (q, open) => ({ label: 'Share an update', href: `/grow/update${q}`, onOpen: open }),
  actions: toFnMap({ distribution: distributionPrimary }),
  tools: toFnMap({
    'revenue-and-traction': (q) => ({ label: 'Open the metric log and this month’s targets', href: `/grow/focus${q}` }),
    'team-expansion': (q) => ({ label: 'Open Talent: roles and applicants', href: `/grow/talent${q}` }),
    'durable-company-building': () => ({ label: 'Open compliance in Calendar', href: '/calendar?layer=compliance' }),
  }),
  add: toFnMap({}),
  // D6122 (#6122, GR-21): Company's due strip above the obligations, filtering them by window.
  aboveRecords: toFnMap({
    // D6118 (GR-09): the Mercury-sourced partner proposal sits on top of the partner table.
    'partner-network': (data, ctx) => fromMercury('partner-network', data, ctx),
    'durable-company-building': (data, ctx) => (
      <DurableDueStrip counts={data?.parts?.due_counts} on={data?.parts?.due_on} query={ctx.query} onQuery={ctx.onQuery} search={ctx.search} />
    ),
  }),
  recordPage: toFnMap({ 'durable-company-building': (record,ctx) => <DurableCompanyRecord record={record} {...ctx}/> }),
  // D6865 part 2 (#6891, GR-21, GR-27): Customers › Feedback owns its page (D6049): the counts, themes, the selected
  // theme's items with their record chip and origin, the weight and Close the loop, Eadwyn's placements, and Add
  // feedback as the one primary action (none while nothing is recorded: the empty state carries it).
  homes: toFnMap({
    'product-improvement': (data, ctx) => ({
      sub: 'What customers, investors and your team ask for, grouped by theme, and who to tell when it ships.',
      action: addFeedbackAction(data, ctx.search),
      body: (p) => <FeedbackTab {...p} data={data} projectId={ctx.projectId} reload={ctx.reload} fillsOn={ctx.fillsOn}
        api={cyclesWrite} proposals={FEEDBACK_PROPOSALS} />,
    }),
  }),
  fills: { 'product-improvement': 'feedback_theme' },
  // The Grow desk's AI band (ZoneDraft, D424) on the module it reads: the
  // applicant ranking on Team expansion. D4493 retired Distribution's
  // outreach-sequence band: 'Ask Eadwyn for a sequence' in the sequence
  // builder (Prospects) runs it through D4488's drafting task.
  drafts: new Map([
    ['team-expansion', [{
      surface: 'grow/talent', label: 'Match · why this one', run: 'Rank the applicants', accept: 'Keep this ranking',
      empty: 'Nothing proposed yet. Eadwyn will rank your applicants and give reasons for the top one — each a receipt you can open and check in their own application.',
      nothingToDraft: 'No live role has an applicant yet.',
      foot: 'A reading only. Nothing here moves an application to a screen.',
    }]],
  ]),
  // A module's further parts, drawn under its table from the module read.
  parts: toFnMap({
    // D686 §5.8: the Updates history (#updates) above the checklist.
    'durable-company-building': (data, ctx) => (<>
      {/* D6122 (GR-21): the last five, and where the next one is written. */}
      <UpdatesHistory updates={data?.parts?.updates} reason={data?.parts?.updates_reason} onShare={ctx.canWrite ? ctx.openAction : undefined}
        limit={5} more={{ text: ctx.canWrite ? 'Write the update in Reporting →' : 'Open Reporting →', href: `/grow/reporting${ctx.projectId ? `?project_id=${ctx.projectId}` : ''}` }} />
      <DurabilityChecklist items={data?.parts?.checklist}
        onToggle={ctx.canWrite && ctx.projectId ? (key, done) => cyclesWrite.grow.checklist(ctx.projectId, key, done).then(ctx.reload) : undefined}
        onNotApplicable={ctx.canWrite && ctx.projectId ? (key, na) => cyclesWrite.grow.checklistNotApplicable(ctx.projectId, key, na).then(ctx.reload) : undefined} />
      {ctx.canWrite ? fromMercury('durable-company-building', data, ctx) : <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"><h2 className="font-semibold">Cash and runway</h2><p className="text-sm text-gray-600 dark:text-gray-400">From the founder’s Mercury: only the venture’s team sees these figures.</p></section>}
      {/* D1095 (#2960): Calendar events tagged #board or #filing, each an obligation proposal. */}
      <DurableFromGoogle projectId={ctx.projectId} canDecide={ctx.canWrite===true} />
    </>),
    // The replies customer and partner asks brought in, beside the rows.
    distribution: (data, ctx) => (<>
      {/* D1090 (#2955): planned pieces, typed here or from Notion; a plan, never what was sent. */}
      <CalendarWeek projectId={ctx.projectId} />
      {fromMercury('distribution', data, ctx)}
      {fromTiktok('distribution', data, ctx)}
      <FromNotion section="grow" projectId={ctx.projectId} module="distribution" />
    </>),
    // D1090 (#2955): a feedback database in Notion, as product feedback.
    // D6098 (#6098): Rename or merge a theme; `parts.themes` reaches writers only.
    // D6865 (#6865): the counts strip, a theme's weight and Close the loop (GR-21, GR-23, GR-26); D6865 part 2
    // (#6891) draws them in the Feedback tab's own page (`homes` above), so they are not repeated here.
    'product-improvement': (data, ctx) => (<>
      <FeedbackThemes themes={data?.parts?.themes}
        onRename={ctx.projectId ? (body) => cyclesWrite.grow.feedbackTheme(ctx.projectId, body).then((out) => { ctx.reload(); return out; }) : undefined} />
      <FromNotion section="grow" projectId={ctx.projectId} module="product_improvement" />
      {/* D1608 (#3731): survey scores and feedback from the founder's PostHog. */}
      <ImprovementPosthog projectId={ctx.projectId} />
    </>),
    // D6118 (#6118, GR-09): Partnerships is one page. Co-marketing (pitches and attributions) is drawn
    // under the partner table; the Mercury proposal is above it (`aboveRecords`).
    'partner-network': (data, ctx) => (<>
      <UpdateAskReplies replies={data?.parts?.from_update_asks} pill="Partner" />
      <PartnershipsCoMarketing projectId={ctx.projectId} />
    </>),
    // D840 part 3 (#2348): the founder's own Mercury, anchored at #from-mercury.
    // D1095 (#2960): then a metrics Sheet's figures, From Google.
    'revenue-and-traction': (data, ctx) => (<>
      {fromMercury('revenue-and-traction', data, ctx)}
      {/* D5866: Audience on TikTok, beside revenue and never inside MRR, the ledger or a KPI. */}
      {fromTiktok('revenue-and-traction', data, ctx)}
      <RevenueFromGoogle projectId={ctx.projectId} />
      {/* D1608 (#3731): PostHog's metrics and product retention, apart from revenue retention. */}
      <RevenuePosthog projectId={ctx.projectId} />
    </>),
    'team-expansion': (data, ctx) => fromMercury('team-expansion', data, ctx),
  }),
};

export default grow;

function GrowMount({ projectId, onClose, onDone, asPage }) {
  return <ShareUpdateLightbox projectId={projectId} onClose={onClose} onSent={onDone} asPage={asPage} />;
}

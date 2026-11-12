/**
 * Grow's entry in CycleRoute.jsx's cycle table (D661, #1474; split out by
 * D5615, #5615): its modules, Share an update and its lightbox (D654, D686),
 * Distribution's own primary (D4484), each module's parts and its AI band.
 */
import { cyclesWrite } from '../../../lib/api/cycles';
import ShareUpdateLightbox from '../../founder/ShareUpdateLightbox';
import { distributionPrimary } from '../distribution/distributionModel.js';
import DurabilityChecklist from '../DurabilityChecklist';
import GrowFromMercury from '../GrowFromMercury';
import { DurableFromGoogle, RevenueFromGoogle } from '../GrowFromGoogle';
import FromNotion from '../FromNotion';
import { ImprovementPosthog, RevenuePosthog } from '../GrowPosthog';
import UpdateAskReplies from '../UpdateAskReplies';
import { toFnMap } from '../adapters';
import { MODULES } from '../modules';
import { lazyStep } from '../lazyStep.jsx';

// D4574 (#4574, H5): Grow's steps, each behind its own lazy boundary.
const CalendarWeek = lazyStep(() => import('../distribution/CalendarTab.jsx'), 'CalendarWeek');
const UpdatesHistory = lazyStep(() => import('../UpdatesHistory'));

/** D840 part 3 (#2348): a Grow module's "From Mercury" part, from its read's `parts.from_mercury`. */
const fromMercury = (slug, data, ctx) => <GrowFromMercury slug={slug} part={data?.parts?.from_mercury} projectId={ctx.projectId} reload={ctx.reload} />;

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
const grow = {
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
      <UpdatesHistory updates={data?.parts?.updates} reason={data?.parts?.updates_reason} onShare={ctx.openAction} />
      <DurabilityChecklist items={data?.parts?.checklist}
        onToggle={ctx.projectId ? (key, done) => cyclesWrite.grow.checklist(ctx.projectId, key, done).then(ctx.reload) : undefined} />
      {fromMercury('durable-company-building', data, ctx)}
      {/* D1095 (#2960): Calendar events tagged #board or #filing, each an obligation proposal. */}
      <DurableFromGoogle projectId={ctx.projectId} />
    </>),
    // The replies customer and partner asks brought in, beside the rows.
    distribution: (data, ctx) => (<>
      {/* D1090 (#2955): planned pieces, typed here or from Notion; a plan, never what was sent. */}
      <CalendarWeek projectId={ctx.projectId} />
      {fromMercury('distribution', data, ctx)}
      <FromNotion section="grow" projectId={ctx.projectId} module="distribution" />
    </>),
    // D1090 (#2955): a feedback database in Notion, as product feedback.
    'product-improvement': (_data, ctx) => (<>
      <FromNotion section="grow" projectId={ctx.projectId} module="product_improvement" />
      {/* D1608 (#3731): survey scores and feedback from the founder's PostHog. */}
      <ImprovementPosthog projectId={ctx.projectId} />
    </>),
    'partner-network': (data, ctx) => (<>
      <UpdateAskReplies replies={data?.parts?.from_update_asks} pill="Partner" />
      {fromMercury('partner-network', data, ctx)}
    </>),
    // D840 part 3 (#2348): the founder's own Mercury, anchored at #from-mercury.
    // D1095 (#2960): then a metrics Sheet's figures, From Google.
    'revenue-and-traction': (data, ctx) => (<>
      {fromMercury('revenue-and-traction', data, ctx)}
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

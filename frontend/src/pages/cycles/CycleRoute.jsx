import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { cyclesApi, cyclesWrite } from '../../lib/api/cycles';
import { verdictApi } from '../../lib/api/verdict';
import { WorkerRail, Unreadable } from '../../ui';
import RailFrame from '../../ui/RailFrame';
import { RailCrumbsProvider, useRailOption, useSetRailCrumbs } from '../../ui/railCrumbs';
import { ASSIST_SURFACES } from '../../ui/eadwynConfig';
import FillProposals from '../../workspaces/FillProposals';
import ZoneDraft from '../../workspaces/ZoneDraft';
import AlsoIn from '../../workspaces/AlsoIn';
import useAssistMode from '../../hooks/useAssistMode';
import useAiSpend from '../../hooks/useAiSpend';
import useScrollToHash from '../../hooks/useScrollToHash';
import ShareUpdateLightbox from '../founder/ShareUpdateLightbox';
import ConnectToolSheet from '../account/ConnectToolSheet';
import { takeBuildProject, toolDeepLink } from '../account/connectorsModel';
import RoundCallSheet from '../founder/RoundCallSheet';
import RecordLightbox from '../founder/RecordLightbox';
import { recordingHref } from '../founder/recordSetup';
import { openingStep } from '../founder/assistantSession.js';
import { reviewPath } from '../../lib/activeRecording';
import { useActiveRecording } from '../../contexts/ActiveRecordingContext';
import CreateStartupForm from '../../components/CreateStartupForm';
import CycleOverview, { CycleHeader } from './CycleOverview';
import RecordView, { RecordPhoneProvider } from './RecordView';
import InterviewRecord from '../founder/InterviewReviewPage';
import Lightbox, { LightboxBarProvider } from '../../ui/Lightbox';
import { RECORD_ID } from './cyclePaths';
import { availableRecord, CLIENT_ACTIONS, confirmView, declaredActions, finishRecordWrite, recordActionBody, recordEditAction, recordFormFor, rowAction } from './recordModel';
import PhoneCycleRoot from './PhoneCycleRoot';
import CycleModulePage from './CycleModulePage';
import PhoneModulePage, { CycleBar, PHONE_GUTTER } from './PhoneModulePage';
import DurabilityChecklist from './DurabilityChecklist';
import ToolsHistory from './ToolsHistory';
import SolutionDesignFromCode from './SolutionDesignFromCode';
import FoundingTeamFromCode from './FoundingTeamFromCode';
import CompanyFromCode from './CompanyFromCode';
import GrowFromMercury from './GrowFromMercury';
import MercuryRaiseFeed from './MercuryRaiseFeed';
import RoadmapFromGithub from './RoadmapFromGithub';
import MvpFromGithub from './MvpFromGithub';
import UpdatesHistory from './UpdatesHistory';
import UpdateAskReplies from './UpdateAskReplies';
import CallsHistory from './CallsHistory';
import RaiseReceiptMatches from '../../components/RaiseReceiptMatches';
import { FromYourInterviews, InterviewsSection, PainThemesSection, HypothesesSection } from './ValidateSections';
import { acceptSuggestions } from './validatePhone';
import { interviewSessionsApi } from '../../lib/api/interviewSessions';
import FormLightbox from './FormLightbox';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth';
import { editFor, formFor, formsFor } from './forms';
import { adaptCard, adaptModule, adaptOverview, fnOf, toFnMap } from './adapters';
import { cellView, cycleOf } from './cycleModel';
import { MODULES } from './modules';
import { useAuth } from '../../hooks/useAuthSync';
import { moduleToolLinks } from './founderToolNavigation.js';
import { NarrativeHome, NarrativeTabBar, NarrativeTabPage } from '../raise/narrative/NarrativeTool';
import { isNarrativeTab, SLUG as NARRATIVE, tabSearch } from '../raise/narrative/narrativeModel';

/** D840 part 3 (#2348): a Grow module's "From Mercury" part, from its read's `parts.from_mercury`. */
const fromMercury = (slug, data, ctx) => <GrowFromMercury slug={slug} part={data?.parts?.from_mercury} projectId={ctx.projectId} reload={ctx.reload} />;
/** D840 part 2 (#2347): a Raise module's From Mercury, from `parts.mercury`, which only the founder's own read carries. */
const mercuryPart = (slug, data, ctx) => <MercuryRaiseFeed slug={slug} part={data?.parts?.mercury} projectId={ctx.projectId} reload={ctx.reload} />;

/**
 * D661 (#1474) — a cycle's overview and module pages, wired to its read.
 *
 * `/<cycle>` draws the overview and `/<cycle>/:slug` one module page, from
 * `GET /api/cycles/<cycle>/…` through `adapters/` (Validate #1487, Raise
 * #1501, Grow #1488, Build #1475). The project is `?project_id=`, else the founder's
 * first, as the retired desks chose it.
 *
 * THE AI BANDS ARE A TABLE (`drafts`), rendered by one `<ZoneDraft {...draft}>`
 * below. `research_ask_session.test.mjs` censuses every band against the
 * Worker's `DRAFT_SURFACES` and reads this file's `surface: '…'` entries for
 * it, and `validate_fills_the_blanks.test.mjs` holds each cycle's rail
 * sentence to the bands in its own entry.
 *
 * THE MODULES' WORKING TOOLS STAY WHERE THEY ARE. D696 draws records with
 * D695's Add/Edit forms. D661 gives a module page a link to "the module's own
 * tool where it has one, rather than a second copy of it". Validate's zone
 * pages are gone (D704): its curation lives on its module pages and records,
 * and only Market intelligence still links a tool of its own. Each Add has an address, `/<cycle>/<slug>/new` (`?form=<key>` for a
 * later one): its form is a dialog over the module page, or the page itself
 * on a phone (D695). Add is offered only where it opens a form; a button with
 * nothing behind it is not drawn.
 */

const CYCLE_DEFS = {
  validate: {
    modules: MODULES.validate,
    // D685 §5.4: "Record a session" is the lightbox at /validate/record. A plain
    // click opens it over this page (`onOpen`); a new tab or a deep link follows
    // the href to the same place. The interview comes with it, or is made at Start.
    // D686: every cycle's action is `{ path, Mount }` on this one mechanism.
    path: 'record',
    Mount: ValidateMount,
    action: (q, open) => ({ label: 'Record a session', href: `/validate/record${q}`, onOpen: open }),
    tools: toFnMap({
      'market-intelligence': () => ({ label: 'Open the competitor tracker', href: '/build/competitors' }),
    }),
    add: toFnMap({
      'customer-research': (q, open) => ({ text: 'Record a session', href: `/validate/record${q}`, onOpen: open }),
    }),
    // The AI fill bands the Validate desk carried, on the module they fill.
    fills: { 'problem-discovery': 'pain_tag', experiments: 'hypothesis' },
    // D697 (#1659): the three bottom sections, what the Interviews, Pain map
    // and Hypotheses pages drew. They read nothing: counts are the module
    // read's `parts`, writes are these callbacks, and the venture is always
    // the page's, never a row's. Each dialog goes through `ctx.openDialog`.
    parts: toFnMap({
      'customer-research': (data, ctx) => <InterviewsSection parts={data?.parts} projectId={ctx.projectId} query={ctx.query} openDialog={ctx.openDialog}
        onLog={(payload) => api.createInterview(ctx.projectId, payload).then(ctx.reload)}
        onExport={() => api.exportValidateInterviews(ctx.projectId)} />,
      'problem-discovery': (data, ctx) => <PainThemesSection parts={data?.parts} projectId={ctx.projectId} query={ctx.query} openDialog={ctx.openDialog}
        onExport={() => api.exportValidatePainMap(ctx.projectId)}
        // #1692's `attach` on the theme record, so the theme's activity logs it.
        onAssign={(themeId, body) => cyclesApi.recordAction('validate', ctx.projectId, 'problem-discovery', themeId, 'attach', body).then(ctx.reload)}
        newThemeHref={formFor('validate', 'problem-discovery') ? `/validate/problem-discovery/new?project_id=${encodeURIComponent(ctx.projectId)}` : null} />,
      experiments: (data, ctx) => <HypothesesSection parts={data?.parts} projectId={ctx.projectId} query={ctx.query} openDialog={ctx.openDialog}
        // Link to a pain's lists, as FVW handed them: the board's unretired claims and its themes.
        onLoadLinkLists={() => api.getValidationBoard(ctx.projectId).then((board) => ({
          hypotheses: (board?.hypotheses || []).filter((h) => !h.retired_at), painGroups: board?.pain_groups || [],
        }))}
        // #1692's `link` on the theme record, so both sides log it.
        onLink={(painGroupId, body) => cyclesApi.recordAction('validate', ctx.projectId, 'problem-discovery', painGroupId, 'link', body).then(ctx.reload)}
        // Only until #1656 registers New hypothesis as the table's Add (decision 20).
        onNewHypothesis={formFor('validate', 'experiments') ? undefined : (body) => api.createHypothesis(ctx.projectId, body).then(ctx.reload)} />,
      // D693 decision 13 (#1704): the verdict zone's Export summary, under the Decisions table.
      verdict: (_data, ctx) => <ExportSummary projectId={ctx.projectId} />,
    }),
    // D697 (#1659): an interview is Customer research's record. The page draws
    // what the read sends, with the session's working parts inside it.
    recordPage: toFnMap({
      'customer-research': (read, ctx) => <InterviewRecord read={read} {...ctx} />,
    }),
  },
  /**
   * Raise's read (#1501, D663) is already in D661's shape: its cards carry
   * chart specs and its records carry their own `add`, so it needs no
   * adapter. Its modules are in `modules.js`, held to `services/raiseCycle.ts`'s
   * list by `cycle_adapters_d661.test.ts`.
   *
   * Data room's module page is `/raise/data-room` with no mode: that static
   * route draws this page with `slug="data-room"` (D696 decision 12), so all
   * seven Raise modules have module pages. Its two tools are reached from it:
   * the read-only access view through the tool link below, and the files tool
   * through `founderToolNavigation.js`'s door.
   */
  raise: {
    modules: MODULES.raise,
    // D686: Call for Capital opens at /raise/call over the page, the venture
    // kept; behind ROUND_CALLS_ENABLED, its lightbox says Coming soon in its
    // own words (the tall Lightbox + ActionSheet frame, #1598).
    path: 'call',
    Mount: RaiseMount,
    action: (q, open) => ({ label: 'Call for Capital', href: `/raise/call${q}`, onOpen: open }),
    // D686 §5.6: Capital relationships' Calls history, anchored at #calls.
    // D752 (#1989): then the founder's "Match to my Mercury" for committed prospects.
    // D840 part 2 (#2347): every Raise module's From Mercury, the founder's alone, anchored at #from-mercury.
    parts: toFnMap({
      ...Object.fromEntries(MODULES.raise.map((m) => [m.slug, (data, ctx) => mercuryPart(m.slug, data, ctx)])),
      // D909 (#2693, NAR1): Home's tiles, Needs you and footer, from the module read's `parts.narrative`.
      'investor-narrative': (data, ctx) => (
        <>
          <NarrativeHome data={data} />
          {mercuryPart('investor-narrative', data, ctx)}
        </>
      ),
      'capital-relationships': (data, ctx) => (
        <>
          <CallsHistory calls={data?.parts?.calls} />
          <RaiseReceiptMatches role={ctx.role} onChanged={ctx.reload} />
          {mercuryPart('capital-relationships', data, ctx)}
        </>
      ),
    }),
    tools: toFnMap({
      'investor-narrative': () => ({ label: 'Open the positioning workspace', href: '/raise/pitch/positioning' }),
      'pitch-deck': () => ({ label: 'Open the pitch deck', href: '/raise/pitch' }),
      'cap-table': () => ({ label: 'Open the cap table', href: '/raise/capital/cap-table' }),
      'use-of-funds': () => ({ label: 'Open the financial model', href: '/raise/capital/model' }),
      'capital-relationships': () => ({ label: 'Open the investor pipeline', href: '/raise/capital/pipeline' }),
      // D696 decision 12: the access view manages nothing, so the label says what it shows.
      'data-room': (q) => ({ label: 'Open the access view: grants, NDA state and recent access', href: `/raise/data-room?mode=access${q ? `&${q.slice(1)}` : ''}` }),
    }),
    add: toFnMap({}),
    fills: {},
    // The Raise desk's four AI bands (ZoneDraft, D424), on the modules they
    // read: the round and its order of payment on Cap table, which holds the
    // scenario both read; the room and the clauses on Fundraising readiness,
    // which scores the data room and the documents, so the room's band sits
    // there rather than on Data room's module page. The narrative band sits on
    // Investor narrative, whose check it phrases.
    drafts: new Map([
      ['cap-table', [{
        surface: 'raise/capital', label: 'Proposal · plain-language read', run: 'Read the round back', accept: 'Attach to scenario',
        empty: 'Nothing proposed yet. Eadwyn will read your round and cap-table scenario back in plain language, and show every step of the arithmetic.',
        nothingToDraft: 'No round and no cap-table scenario are recorded for this startup yet.',
        foot: 'Shown step by step, because you will be asked to defend this number.',
      }, {
        surface: 'raise/liquidity', label: 'Proposal · plain-language read', run: 'Explain the order of payment', accept: 'Attach to term sheet',
        empty: 'Nothing proposed yet. Eadwyn will explain who is paid what and in what order from your cap table and round — and name every term the answer needs that nothing here records.',
        nothingToDraft: 'No cap-table scenario is recorded, so there is no ownership to pay out.',
        foot: 'No preference term is stored, so none is assumed.',
      }]],
      ['fundraising-readiness', [{
        surface: 'raise/data-room', label: 'Gap analysis', run: 'Read the room', accept: 'Keep this reading',
        empty: 'Nothing proposed yet. Eadwyn will read what this room holds, what sits behind NDA, and what the investors with access have actually opened.',
        nothingToDraft: 'This room holds no folders and no files yet.',
        foot: 'Read from the room itself, never from a generic diligence checklist.',
      }, {
        surface: 'raise/legal', tone: 'warn', label: 'Clause explained', run: 'Explain the clauses', accept: 'Keep this reading',
        empty: 'Nothing proposed yet. Eadwyn will read the documents you have stored and name the clauses worth looking at again, quoting each one.',
        nothingToDraft: 'No stored legal document has any text to read.',
        // A reading of your own documents, and the footnote says what it is
        // rather than what it is not (D424's voice rule).
        foot: 'A reading of your documents, not counsel’s review. Counsel is on the Team page.',
      }]],
      // #1524 item 3 (D663): the consistency check lists each figure the
      // narrative states differently from the stored metrics; on request,
      // Eadwyn phrases the fix for the first one, citing both sides.
      ['investor-narrative', [{
        surface: 'raise/narrative-fix', tone: 'warn', label: 'Mismatch · phrase the fix', run: 'Phrase the fix', accept: 'Save reading to copy',
        empty: 'Nothing proposed yet. Eadwyn will phrase the fix for the first mismatch the consistency check found in your newest narrative version, naming both figures and where each was read.',
        nothingToDraft: 'The consistency check found no mismatch in your newest narrative version.',
        foot: 'Neither figure is taken as the right one. Keeping the wording changes neither the narrative nor the metrics.',
      }]],
    ]),
  },
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
  grow: {
    modules: MODULES.grow,
    path: 'update',
    Mount: GrowMount,
    action: (q, open) => ({ label: 'Share an update', href: `/grow/update${q}`, onOpen: open }),
    tools: toFnMap({
      'revenue-and-traction': (q) => ({ label: 'Open the metric log and this month’s targets', href: `/grow/focus${q}` }),
      'team-expansion': (q) => ({ label: 'Open Talent: roles and applicants', href: `/grow/talent${q}` }),
      'durable-company-building': () => ({ label: 'Open the compliance calendar', href: '/compliance' }),
    }),
    add: toFnMap({}),
    fills: { 'product-improvement': 'feedback_theme' },
    // The Grow desk's two AI bands (ZoneDraft, D424), on the modules they
    // read: the applicant ranking on Team expansion, the outreach sequence
    // for sign-ups who have not converted on Distribution.
    drafts: new Map([
      ['team-expansion', [{
        surface: 'grow/talent', label: 'Match · why this one', run: 'Rank the applicants', accept: 'Keep this ranking',
        empty: 'Nothing proposed yet. Eadwyn will rank your applicants and give reasons for the top one — each a receipt you can open and check in their own application.',
        nothingToDraft: 'No live role has an applicant yet.',
        foot: 'A reading only. Nothing here moves an application to a screen.',
      }]],
      ['distribution', [{
        surface: 'grow/customers', label: 'Proposal · outreach sequence', run: 'Draft a sequence', accept: 'Accept sequence',
        empty: 'Nothing proposed yet. Eadwyn will draft a sequence for the signups who have gone furthest without converting, opening each touch on a pain you have actually recorded.',
        nothingToDraft: 'No customer signup is recorded for this startup yet.',
        foot: 'Each opener quotes a pain from your own map, or says none fits.',
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
      </>),
      // The replies customer and partner asks brought in, beside the rows.
      distribution: (data, ctx) => (<>
        <UpdateAskReplies replies={data?.parts?.from_update_asks} pill="Lead" />
        {fromMercury('distribution', data, ctx)}
      </>),
      'partner-network': (data, ctx) => (<>
        <UpdateAskReplies replies={data?.parts?.from_update_asks} pill="Partner" />
        {fromMercury('partner-network', data, ctx)}
      </>),
      // D840 part 3 (#2348): the founder's own Mercury, anchored at #from-mercury.
      'revenue-and-traction': (data, ctx) => fromMercury('revenue-and-traction', data, ctx),
      'team-expansion': (data, ctx) => fromMercury('team-expansion', data, ctx),
    }),
  },
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
  build: {
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
    // D686 §5.4: Operating systems' Tools history, anchored at #tools.
    // D782 (#2114): Solution design's From GitHub (Built with, proposals, notes), anchored at #from-github.
    parts: toFnMap({
      'solution-design': (data, ctx) => <SolutionDesignFromCode part={data?.parts?.from_code} projectId={ctx.projectId} reload={ctx.reload} />,
      // D782 (#2112): Prototype / MVP's pull request states and release checks, anchored at #from-github.
      'prototype-mvp': (data) => <MvpFromGithub github={data?.parts?.github} />,
      // D782 (#2111): Product roadmap's milestones and releases from GitHub, anchored at #from-github.
      'product-roadmap': (data) => <RoadmapFromGithub github={data?.parts?.github} />,
      'operating-systems': (data) => <ToolsHistory tools={data?.parts?.tools} />,
      // D782 (#2115): who builds (the founder matches each login) and where the code sits, anchored at #from-github.
      'founding-team': (data, ctx) => <FoundingTeamFromCode part={data?.parts?.github} projectId={ctx.projectId} reload={ctx.reload} />,
      'company-creation': (data, ctx) => <CompanyFromCode part={data?.parts?.github} projectId={ctx.projectId} reload={ctx.reload} />,
    }),
    tools: toFnMap({
      'product-roadmap': (q) => ({ label: 'Open the roadmap: Now, Next and Later', href: `/build/roadmap${q}` }),
      'founding-team': () => ({ label: 'Open the cap table and vesting', href: '/raise/capital/cap-table' }),
      'operating-systems': (q) => ({ label: 'Open the operating cadence', href: `/build/cadence${q}` }),
    }),
    add: toFnMap({}),
    fills: {},
    // The Build desk's four AI bands (ZoneDraft, D424, D510), on the modules
    // they read: the roadmap tradeoff on Product roadmap; the Monday plan, the
    // Friday retro and the KPI annotation on Operating systems, the weekly
    // cadence they serve.
    drafts: new Map([
      ['product-roadmap', [{
        surface: 'build/roadmap', label: 'Proposal · tradeoff, reasoned', run: 'Argue the ordering', accept: 'Accept the argument',
        empty: 'Nothing proposed yet. Eadwyn will read the horizons and quarters you have set and argue the one ordering most worth changing — from the record, not from anything it knows about your market.',
        nothingToDraft: 'There are no objectives to argue an order between yet.',
        foot: 'This writes an argument, never an order. Reordering stays in Roadmap.',
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
  },
};

const filterString = (filter) => Object.entries(filter || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}:${v}`).join(',');

export function useProject(reloadKey = 0, { kept = null, drop = [], immediate = false } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Writes build on the latest query, never on a render's (react-router hands a
  // functional update the search params of the render that made the setter), and
  // drop `drop`'s keys in the same write: a sign-in's return or `?tool=` that the
  // lightbox has read must not come back with the venture (D686 §5.4, #1597).
  const latest = useRef(searchParams);
  latest.current = searchParams;
  const dropRef = useRef(drop);
  const writeProject = useCallback((id, extraDrop = []) => {
    const next = new URLSearchParams(latest.current);
    for (const k of dropRef.current || []) next.delete(k);
    for (const k of extraDrop) next.delete(k);
    next.set('project_id', String(id));
    setSearchParams(next, { replace: true });
  }, [setSearchParams]);
  // The read's own links (`next.href`) say `?project=`; the page's say
  // `?project_id=`. Either picks the venture.
  const named = Number(searchParams.get('project_id') || searchParams.get('project')) || null;
  // Back from a provider's sign-in at /build/connect with no venture named: the
  // one Build kept before the redirect (D686 §5.4), taken once.
  const [stashed] = useState(() => (named ? null : kept?.() ?? null));
  const requested = named || stashed;
  useEffect(() => {
    if (named || !stashed) return;
    writeProject(stashed);
  }, [named, stashed, writeProject]);
  const [projectId, setProjectId] = useState(requested);
  const [status, setStatus] = useState(requested ? 'ready' : 'loading');
  useEffect(() => {
    if (requested) { setProjectId(requested); setStatus('ready'); return undefined; }
    let alive = true;
    api.listProjects().then((list) => {
      if (!alive) return;
      const first = (list || [])[0];
      setProjectId(first?.id || null);
      setStatus(first ? 'ready' : 'none');
      if (first) writeProject(first.id);
    }).catch(() => { if (alive) setStatus('unreadable'); });
    return () => { alive = false; };
  }, [requested, writeProject, reloadKey]);
  return { projectId: immediate && requested ? requested : projectId, status: immediate && requested ? 'ready' : status, writeProject };
}

/**
 * The writes an Add form submits through: the cycles' own, and Verdict's
 * `record` as `w.verdict` (D693, Record a decision).
 */
const formWrites = { ...cyclesWrite, verdict: verdictApi };

/**
 * D693 decision 13: Export summary, the verdict zone's CSV (`founder_validate.ts`,
 * gated by `canReadDecision` as the module is). A quiet button; a failure shows
 * the Worker's sentence.
 */
function ExportSummary({ projectId }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = () => {
    if (!projectId || busy) return;
    setBusy(true); setError('');
    Promise.resolve(api.exportValidateSummary(projectId))
      .catch((e) => setError(e?.message || 'The summary could not be exported.'))
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="verdict-export-summary">
      <button type="button" onClick={run} disabled={busy}
        className="rounded-lg border border-axal-hairline px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:text-gray-200">
        {busy ? 'Exporting…' : 'Export summary'}
      </button>
      {error && <span role="alert" className="text-[12px] text-red-700 dark:text-red-400">{error}</span>}
    </div>
  );
}

/** The module page under the lightbox: the founder's, when it is one of this cycle's modules; else the overview (null). */
export function underModule(modules, path, cycle = 'validate', action = 'record') {
  const slug = underSlug(path, cycle, action);
  return (modules || []).some((m) => m.slug === slug) ? slug : null;
}

/**
 * The lightbox, with the interview it was opened on (`?interview=<id>`, from a
 * row's "Record a session") read first so Who is pre-filled. An interview that
 * cannot be found opens the lightbox with Who empty rather than not at all.
 */
export function RecordMount({ projectId, interviewId, onClose, onStarted, asPage }) {
  const { recorder } = useActiveRecording();
  // D768: while Record a session is open, the rail is that option's (transcription).
  useRailOption('transcribe:interview', 'Record a session');
  const [interview, setInterview] = useState(interviewId ? undefined : null);
  useEffect(() => {
    if (!interviewId) { setInterview(null); return undefined; }
    let alive = true;
    api.listInterviews(projectId)
      .then((rows) => { if (alive) setInterview((rows || []).find((r) => String(r.id) === String(interviewId)) || null); })
      .catch(() => { if (alive) setInterview(null); });
    return () => { alive = false; };
  }, [projectId, interviewId]);
  if (interview === undefined) return null;
  return <RecordLightbox projectId={projectId} interview={interview} onClose={onClose} onStarted={onStarted} recorder={recorder} asPage={asPage} />;
}

/** The module slug of a cycle path (`/validate/customer-research?…`), or null for the overview and the cycle's own action path. */
export function underSlug(path, cycle = 'validate', action = 'record') {
  // One fixed pattern reads the cycle segment, which is then compared, so no
  // regex is ever built from `cycle`.
  const m = /^\/([a-z]+)\/([a-z0-9-]+)(?:[/?#]|$)/.exec(String(path || ''));
  return m && m[1] === cycle && m[2] !== action ? m[2] : null;
}

/**
 * Where a Record a session finish lands (D694): the live view while it
 * records here; a channel session still waiting for its messages or its
 * transcript keeps its session page, the one page that draws that wait; every
 * other finish is Customer research, in the session's venture, else the page's.
 */
export function finishPath(session, where, projectId) {
  if (where === 'live') return `/validate/record/live?session=${encodeURIComponent(session?.id)}`;
  if (session?.submitted_via === 'meeting_bot') return `/validate/session/${encodeURIComponent(session?.id)}`;
  if (openingStep(session) === 'channel') return `/validate/session/${encodeURIComponent(session?.id)}`;
  return reviewPath({ ...session, project_id: session?.project_id ?? projectId });
}

/*
 * Each cycle's open lightbox (D686 §5.1). Build, Raise and Grow each mount a
 * sheet that draws its own `<Lightbox size="tall">` with an `ActionSheet`
 * body: Build's `ConnectToolSheet` (S02-B, #1597), Raise's `RoundCallSheet`
 * in its `CallLightbox` (S03-A) and Grow's `ShareUpdateLightbox` (S03-B).
 * Validate's `RecordMount` draws `RecordLightbox`. This route draws no frame
 * around any of them: two dialogs must never nest.
 */
function ValidateMount({ projectId, searchParams, onClose, onDone, asPage }) {
  return <RecordMount projectId={projectId} interviewId={searchParams.get('interview')} onClose={onClose} onStarted={onDone} asPage={asPage} />;
}
// D686 §5.4 (#1597): the sheet connects for this project's company, and a
// change re-reads the Build page once the lightbox closes.
function BuildMount({ projectId, onClose, onChanged, asPage }) {
  return <ConnectToolSheet projectId={projectId} onClose={onClose} onChanged={onChanged} asPage={asPage} />;
}
function RaiseMount({ projectId, onClose, asPage }) {
  return <RoundCallSheet projectId={projectId} onClose={onClose} asPage={asPage} />;
}
function GrowMount({ projectId, onClose, onDone, asPage }) {
  return <ShareUpdateLightbox projectId={projectId} onClose={onClose} onSent={onDone} asPage={asPage} />;
}

/** D696: a scoped record read and its declared actions; the route owns every mount. */
export function useCycleRecord({ enabled, cycle, projectId, slug, id, reload, edit, navigate, back }) {
  const location = useLocation();
  const key = `${cycle}/${projectId}/${slug}/${id}`;
  const currentKey = useRef(key); currentKey.current = key;
  const sequence = useRef(0);
  const [read, setRead] = useState(null);
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState(null);
  const writing = useRef(false);
  const activityBusy = useRef(false);
  const page = useRef(1);
  const load = useCallback(async (afterWrite = false) => {
    const serial = ++sequence.current;
    const fresh = () => currentKey.current === key && serial === sequence.current;
    try {
      const data = await cyclesApi.record(cycle, projectId, slug, id);
      if (fresh()) { page.current = 1; setRead({ key, status: 'ready', data, activity: data.activity ?? [] }); }
    } catch (error) {
      if (!fresh()) return;
      if (afterWrite && error?.status === 404) { navigate(back, { replace: true }); return; }
      setRead({ key, status: [403, 404].includes(error?.status) ? 'refused' : 'unreadable', error: error?.message || 'This record could not be read.' });
    }
  }, [cycle, projectId, slug, id, key, navigate, back]);
  useEffect(() => {
    setRead(null); setActionError(''); setPending(null);
    if (enabled) void load();
    return () => { sequence.current += 1; };
  }, [enabled, load, reload]);
  const state = read?.key === key ? read : null;
  const raw = state?.data;
  const declarations = declaredActions(raw);
  const data = raw ? availableRecord(raw, edit) : null;
  const selected = raw && typeof location.state?.editing === 'string'
    ? rowAction(location.state.editingPayload?.record === key
      ? { key: location.state.editing, body: location.state.editingPayload.body } : location.state.editing, declarations) : null;
  const formSpec = selected ? recordFormFor(selected, raw, edit) : null;
  const closeForm = () => {
    if (currentKey.current !== key) return;
    if (location.key === 'default') {
      navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: { ...location.state, editing: null } });
      return;
    }
    navigate(-1);
  };
  const perform = async (action, values) => {
    if (writing.current) throw new Error('A change is already being saved.');
    writing.current = true; setActionError('');
    try {
      const result = action.key === 'edit'
        ? await edit.submit(cyclesWrite, projectId, formSpec.id, values)
        : await cyclesApi.recordAction(cycle, projectId, slug, id, action.key, recordActionBody(action, values));
      if (currentKey.current !== key) return result;
      await finishRecordWrite(result, {
        open: (...args) => window.open(...args),
        onError: sentence => { throw new Error(sentence); },
        reread: () => load(true),
      });
      return result;
    } finally { writing.current = false; }
  };
  const send = action => { void perform(action).catch(error => {
    if (currentKey.current === key) setActionError(error?.message || 'This change could not be saved.');
  }); };
  const write = action => { if (action.confirm) setPending({ key, action }); else send(action); };
  const confirmation = pending?.key === key ? confirmView(pending.action) : null;
  return {
    status: state?.status ?? 'loading', data, error: state?.error, activity: state?.activity, actionError,
    link: action => { if (action.href?.startsWith('mailto:')) window.location.href = action.href; else navigate(action.href); },
    openForm: action => navigate(`${location.pathname}${location.search}${location.hash}`, { state: { ...location.state, editing: action.key, editingPayload: { record: key, body: action.body } } }),
    write,
    client: action => { Promise.resolve().then(() => CLIENT_ACTIONS.get(action.key)?.(raw)).catch(error => {
      if (currentKey.current === key) setActionError(error?.message || 'The export could not be created.');
    }); },
    showAll: async () => {
      if (activityBusy.current) return;
      activityBusy.current = true;
      const serial = sequence.current;
      try {
        const result = await cyclesApi.recordActivity(cycle, projectId, slug, id, page.current + 1);
        if (currentKey.current !== key || sequence.current !== serial) return;
        page.current += 1;
        setRead(previous => ({ ...previous, activity: [...previous.activity, ...(result.items ?? [])],
          data: { ...previous.data, activity_total: result.total ?? previous.data.activity_total } }));
      } catch (error) { if (currentKey.current === key) setActionError(error?.message || 'Activity could not be read.'); }
      finally { activityBusy.current = false; }
    },
    form: formSpec ? <FormLightbox key={`${key}/${selected.key}`} form={formSpec.form} current={formSpec.current}
      cycle={cycle} slug={slug}
      loadOptions={selected.key === 'edit' && edit.loadOptions ? () => edit.loadOptions(cyclesWrite, projectId, formSpec.id) : null}
      onSubmit={values => perform(selected, values)} onClose={closeForm} /> : null,
    confirm: confirmation ? <Lightbox size="fit" width={420} label={confirmation.title} title={confirmation.title}
      onClose={() => setPending(null)} footer={<div className="flex justify-end gap-2 p-4">
        <button type="button" className="rounded-lg border border-axal-hairline px-3 py-2 text-axal-ink dark:border-gray-700 dark:text-gray-100" onClick={() => setPending(null)}>Cancel</button>
        <button type="button" className={`rounded-lg border px-3 py-2 ${pending.action.tone === 'danger'
          ? 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300'
          : pending.action.tone === 'primary' ? 'border-axal-violet bg-axal-violet text-white dark:border-violet-500 dark:bg-violet-600'
          : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100'}`}
          onClick={() => { const action = pending.action; setPending(null); send(action); }}>{confirmation.cta}</button>
      </div>}><p className="p-4 text-sm text-axal-ink dark:text-gray-100">{confirmation.body}</p></Lightbox> : null,
  };
}

/**
 * `lightbox` is the cycle's action route (D685 §5.4, D686 §5.1):
 * `/validate/record`, `/build/connect`, `/raise/call`, `/grow/update`, the
 * cycle page with its lightbox open over it. The page underneath is the one the
 * founder was on (`location.state.under`), the overview on a deep link. Closing
 * goes back to it; the lightbox makes no server call.
 */
/**
 * D695 (#1656): a row's Edit that reads its record (Validate's rows carry no
 * `edit`) opens once the record answers, through `recordFormFor`, as the
 * record page opens it. `target` is null when no such Edit is open.
 */
function useRowRecordEdit(target) {
  const [state, setState] = useState(null);
  const key = target ? `${target.cycle}/${target.slug}/${target.projectId}/${target.row.id}` : null;
  useEffect(() => {
    if (!target) return undefined;
    let live = true;
    cyclesApi.record(target.cycle, target.projectId, target.slug, target.row.id)
      .then((read) => { if (live) setState({ key, spec: recordFormFor(recordEditAction(read), read, target.edit), error: null }); },
        (error) => { if (live) setState({ key, spec: null, error: error?.message || 'This record could not be read.' }); });
    return () => { live = false; };
    // `key` names the record; a new `target` object for it does not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state && state.key === key ? state : null;
}

/**
 * D696 (#1658): a record's title as the rail's third crumb, "section › module
 * › record", while the record is drawn; leaving the record drops it. It sits
 * inside `RailCrumbsProvider`, whose setter it calls, and draws nothing.
 */
function RecordCrumb({ title, type = null, id = null }) {
  const setCrumbs = useSetRailCrumbs();
  useEffect(() => {
    // D768: `ref` names the record a run on this page reads (D765's `record`).
    setCrumbs({ record: title || null, ref: title && type && id != null ? { type, id } : null });
    return () => setCrumbs({ record: null });
  }, [setCrumbs, title, type, id]);
  return null;
}

export default function CycleRoute({ cycle, lightbox = false, adding = false, record = false, slug: suppliedSlug }) {
  const { slug: routeSlug, id: recordId } = useParams();
  const location = useLocation();
  const { user } = useAuth() || {};
  const def = Object.prototype.hasOwnProperty.call(CYCLE_DEFS, cycle) ? CYCLE_DEFS[cycle] : null;
  // D685 §5.4: while this tab records (or holds a paused recording), the setup
  // never opens over it: `/validate/record` is that recording's live view.
  const { state: recording } = useActiveRecording();
  const toLive = lightbox && cycle === 'validate' ? recordingHref(recording) : null;
  // Under the lightbox is the module page the founder was on, when it is one of
  // this cycle's modules; otherwise (a deep link, or the interview log) the overview.
  const slug = lightbox ? underModule(def?.modules, location.state?.under, cycle, def?.path) : suppliedSlug ?? routeSlug;
  const [searchParams, setSearchParams] = useSearchParams();
  const [projectsKey, setProjectsKey] = useState(0);
  // Build's lightbox reads a sign-in's return or `?tool=` once; the venture's write drops those keys too (#1597).
  const [connectDrop] = useState(() => (lightbox && cycle === 'build' ? toolDeepLink(location.search, [])?.strip || [] : []));
  const { projectId, status: projectStatus, writeProject } = useProject(projectsKey, { kept: lightbox && cycle === 'build' ? takeBuildProject : null, drop: connectDrop, immediate: record });
  const creates = Boolean(def?.creates);
  const [creating, setCreating] = useState(() => creates && searchParams.get('new') === '1');
  // Followed, not only seeded: the Command Palette can address `?new=1` from
  // this very page, which changes the search without a remount.
  useEffect(() => {
    if (creates && searchParams.get('new') === '1') setCreating(true);
  }, [creates, searchParams]);
  const name = cycleOf(cycle)?.name || 'Validate';
  const moduleName = slug ? (def?.modules || []).find((m) => m.slug === slug)?.name || null : null;
  const [fillsOn] = useAssistMode(name);
  const q = projectId ? `?project_id=${projectId}` : '';
  const navigate = useNavigate();
  // A lightbox that changed something (a tool connected) marks the page dirty;
  // it reloads on close, not behind the lightbox, so nothing flashes.
  const dirty = useRef(false);
  // The module's Add and Edit forms (`forms.js`), for a store with no page of
  // its own (D695). The open Add is the address's: `/new` opens the first form,
  // `?form=<key>` a later one. The open Edit is the row the history entry names
  // (`state.editing`), so Back closes it as it closes an Add.
  const forms = useMemo(() => (slug && def ? formsFor(cycle, slug) : []), [cycle, slug, def]);
  const edit = slug && def ? editFor(cycle, slug) : null;
  const formOpen = adding && forms.length ? forms.find((f) => f.key === searchParams.get('form')) || forms[0] : null;
  const editingId = !adding && edit && location.state?.editing != null ? String(location.state.editing) : null;
  const phone = usePhoneWidth();
  // #1652's `?add=1` (the Worker's card hrefs) is the first Add's address: the
  // URL becomes `/new`, the rest of the query kept. A module with no form, and
  // the overview, ignore it (D688).
  useEffect(() => {
    if (record) return;
    if (adding || lightbox || !slug || !forms.length || searchParams.get('add') !== '1') return;
    const params = new URLSearchParams(searchParams);
    params.delete('add');
    const rest = params.toString();
    navigate(`/${cycle}/${slug}/new${rest ? `?${rest}` : ''}`, { replace: true });
  }, [record, adding, lightbox, slug, forms, searchParams, cycle, navigate]);
  const drafts = !record && slug && def?.drafts instanceof Map && Array.isArray(def.drafts.get(slug)) ? def.drafts.get(slug) : [];
  const fillKind = !record && slug && def?.fills && Object.prototype.hasOwnProperty.call(def.fills, slug) ? def.fills[slug] : null;
  // The cost before a run (D424), read only while a band is drawn: a draft
  // band or a fill band, which quotes its own kind's task from the same read.
  const ai = useAiSpend({ enabled: Boolean(fillsOn && projectId && (drafts.length || fillKind)) });

  const [overview, setOverview] = useState(null);
  // D685 §5.12: the phone focus reads the overview as sent; adapting a card replaces its series.
  const [rawOverview, setRawOverview] = useState(null);
  const [overviewStatus, setOverviewStatus] = useState('loading');
  const [module, setModule] = useState(null);
  const [moduleStatus, setModuleStatus] = useState('loading');
  // D693 decision 7: a read refused on purpose keeps the Worker's sentence.
  const [moduleMessage, setModuleMessage] = useState('');
  // D693 decision 7: false once a Validate read says the viewer may not read
  // decisions, or the Verdict read refuses; the tabs then drop Verdict.
  const [canReadDecisions, setCanReadDecisions] = useState(true);
  // D686: a history address (`#tools`, `#calls`, `#updates`) scrolls once its section is drawn.

  const [query, setQuery] = useState({ q: '', filter: {}, sort: '', page: 1 });
  const [reload, setReload] = useState(0);
  // D697 decision 21: the one dialog a module's further parts opened. It is
  // drawn after the size container (a `fixed` layer inside it would sit against
  // the column), or as the body below 1024px when it is a page; a new module
  // or record closes it.
  const [dialog, setDialog] = useState(null);
  const openDialog = useCallback((element, { page = false } = {}) => setDialog(element ? { element, page } : null), []);
  useEffect(() => { setDialog(null); }, [cycle, slug, recordId]);
  const known = !slug || (def?.modules || []).some((m) => m.slug === slug);
  const validRecord = RECORD_ID.test(recordId ?? '') && recordId !== 'new';
  // D906 (#2454): under Investor narrative a record id that is a tab word
  // (`/story`, `/check`, …) is the tool's tab, never a version (versions are numbers).
  const narrativeTab = record && cycle === 'raise' && isNarrativeTab(slug, recordId) ? recordId : null;
  const recordState = useCycleRecord({ enabled: record && known && validRecord && !narrativeTab && !!projectId && !!def,
    cycle, projectId, slug, id: recordId, reload, edit, navigate, back: `/${cycle}/${slug}${q}` });
  useScrollToHash(record ? recordState.status !== 'ready' : moduleStatus !== 'ready');
  // The page re-reads once the lightbox is gone, however it went: ×, Escape and
  // a finish navigate away from the action route, and so does the browser's
  // Back, which never calls `closeAction`. The route keeps this component
  // mounted across that change, so the dirty mark survives to be read here.
  useEffect(() => {
    if (!lightbox && dirty.current) { dirty.current = false; setReload((n) => n + 1); }
  }, [lightbox]);
  // An Add or an Edit (D695) is followed the same way: a save marks the page,
  // and it re-reads once the form's address or history entry is left.
  useEffect(() => {
    if (!adding && !editingId && dirty.current) { dirty.current = false; setReload((n) => n + 1); }
  }, [adding, editingId]);

  // The table's query resets when the module changes.
  useEffect(() => { setQuery({ q: '', filter: {}, sort: '', page: 1 }); }, [slug]);

  useEffect(() => {
    if (record || slug || !projectId || !def) return undefined;
    let alive = true;
    setOverviewStatus('loading');
    cyclesApi.overview(cycle, projectId)
      .then((data) => {
        if (!alive) return;
        if (typeof data?.can_read_decisions === 'boolean') setCanReadDecisions(data.can_read_decisions);
        setRawOverview(data); setOverview(adaptOverview(cycle, data)); setOverviewStatus('ready');
      })
      .catch(() => { if (alive) setOverviewStatus('unreadable'); });
    return () => { alive = false; };
  }, [record, cycle, slug, projectId, reload, def]);

  useEffect(() => {
    if (record || !slug || !known || !projectId || !def) return undefined;
    let alive = true;
    setModuleStatus('loading');
    cyclesApi.module(cycle, projectId, slug, { q: query.q, filter: filterString(query.filter), sort: query.sort, page: query.page })
      .then((data) => {
        if (!alive) return;
        if (typeof data?.can_read_decisions === 'boolean') setCanReadDecisions(data.can_read_decisions);
        setModule(adaptModule(cycle, slug, data)); setModuleMessage(''); setModuleStatus('ready');
      })
      // A 403 is a refusal, not a failure (D693 decision 7: "Partners do not
      // see decisions."), so it is drawn as the Worker's sentence, with no Retry.
      .catch((error) => {
        if (!alive) return;
        if (error?.status === 403) {
          if (slug === 'verdict') setCanReadDecisions(false);
          setModuleMessage(error?.message || ''); setModuleStatus('refused');
        } else setModuleStatus('unreadable');
      });
    return () => { alive = false; };
  }, [record, cycle, slug, known, projectId, query, reload, def]);

  // One card re-read: the module read returns that card on its own, so the
  // others stay drawn (D656: a failing source leaves the others alone).
  const retryCard = useCallback((cardSlug) => {
    if (!projectId) return;
    cyclesApi.module(cycle, projectId, cardSlug, {})
      .then((data) => setOverview((o) => (o ? { ...o, cards: o.cards.map((c) => (c.slug === cardSlug ? adaptCard(cycle, { slug: cardSlug, ...data.card }) : c)) } : o)))
      .catch(() => {});
  }, [cycle, projectId]);

  const tabs = useMemo(() => (def?.modules || [])
    .filter((m) => canReadDecisions || !(cycle === 'validate' && m.slug === 'verdict'))
    .map((m) => ({ slug: m.slug, name: m.name })), [def, cycle, canReadDecisions]);
  const editing = editingId ? (module?.records?.rows || []).find((row) => String(row?.id) === editingId) || null : null;
  const rowEdit = useRowRecordEdit(!record && projectId && edit?.readsRecord && editing && edit.idOf(editing) != null
    ? { cycle, slug, projectId, edit, row: editing } : null);

  if (toLive) return <Navigate to={toLive} replace />;
  if (!def) return null;
  if (!known) return <Navigate to={`/${cycle}${q}`} replace />;
  if (record && !validRecord) return <Navigate to={`/${cycle}/${slug}${q}`} replace />;
  // A known module with no Add form has no `/new`: its page instead.
  if (adding && slug && !forms.length) return <Navigate to={`/${cycle}/${slug}${location.search}`} replace />;

  const openAction = projectId && def.path
    ? () => navigate(`/${cycle}/${def.path}${q}`, { state: { under: `${location.pathname}${location.search}` } })
    : undefined;
  const closeAction = () => {
    if (location.state?.under) navigate(-1);
    else navigate(`/${cycle}${q}`, { replace: true });
  };
  // An Add pushed from the page goes back to it; a deep link to `/new` replaces
  // itself with the module page, the venture kept (as `closeAction` does). An
  // Edit is the same URL with `state.editing`, so closing it is Back.
  const closeAdd = () => {
    if (location.state?.under) { navigate(-1); return; }
    const params = new URLSearchParams(searchParams);
    params.delete('form');
    const rest = params.toString();
    navigate(`/${cycle}/${slug}${rest ? `?${rest}` : ''}`, { replace: true });
  };
  const closeEdit = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(`${location.pathname}${location.search}`, { replace: true });
  };
  const addHref = (entry, i) => {
    const params = new URLSearchParams(q);
    if (i > 0) params.set('form', entry.key);
    const rest = params.toString();
    return `/${cycle}/${slug}/new${rest ? `?${rest}` : ''}`;
  };
  // The one open form, Add or Edit. Below 1024px it is the page, drawn in the
  // body's gutter; at 1024px and up it is the dialog at the mount below.
  const saved = () => { dirty.current = true; };
  const openForm = record ? recordState.form
    : !projectId ? null
    : formOpen ? (
      <FormLightbox key={`add-${formOpen.key}`} form={formOpen} cycle={cycle} slug={slug} search={location.search}
        // An Add whose choices are the Worker's (Record a decision's For and Evidence, D693) reads them here.
        loadOptions={formOpen.loadOptions ? () => formOpen.loadOptions(formWrites, projectId) : null}
        onSearch={formOpen.search ? (_field, q) => formOpen.search(formWrites, projectId, q) : null}
        onSubmit={(values) => formOpen.submit(formWrites, projectId, values)}
        onSaved={saved}
        onClose={closeAdd} />
    ) : editing && edit.idOf(editing) != null && edit.readsRecord ? (
      // Drawn once the record answers: its values, or the refusal in the dialog.
      rowEdit?.spec ? (
        <FormLightbox key={`edit-${editing.id}`} form={rowEdit.spec.form} current={rowEdit.spec.current} cycle={cycle} slug={slug}
          loadOptions={edit.loadOptions ? () => edit.loadOptions(cyclesWrite, projectId, rowEdit.spec.id) : null}
          onSubmit={(values) => edit.submit(cyclesWrite, projectId, rowEdit.spec.id, values)}
          onSaved={saved}
          onClose={closeEdit} />
      ) : rowEdit ? (
        <FormLightbox key={`edit-${editing.id}-refused`} form={{ ...edit, fields: [] }} cycle={cycle} slug={slug}
          refused={rowEdit.error || 'This record has no Edit.'} onSubmit={() => {}} onClose={closeEdit} />
      ) : null
    ) : editing && edit.idOf(editing) != null ? (
      <FormLightbox key={`edit-${editing.id}`} form={edit} current={edit.valuesOf(editing)} cycle={cycle} slug={slug}
        loadOptions={edit.loadOptions ? () => edit.loadOptions(cyclesWrite, projectId, edit.idOf(editing)) : null}
        onSubmit={(values) => edit.submit(cyclesWrite, projectId, edit.idOf(editing), values)}
        onSaved={saved}
        onClose={closeEdit} />
    ) : null;
  // What finishing does: `finishPath`'s page replaces the action route, and a
  // sent update opens its page, so Back never reopens the lightbox. Only the
  // session page reads the interview it was opened for.
  const onDone = cycle === 'validate'
    ? (session, interview, where) => {
      const to = finishPath(session, where, projectId);
      navigate(to, to.startsWith('/validate/session/') ? { state: { interview }, replace: true } : { replace: true });
    }
    : cycle === 'grow' ? (uid) => navigate(`/updates/${encodeURIComponent(uid)}`, { replace: true }) : undefined;
  const action = def.action(q, openAction);
  const Mount = def.Mount || null;
  const rail = (
    <WorkerRail
      workspace={name}
      role="founder"
      stance="Evidence-led view"
      fills
      note={ASSIST_SURFACES.workspace.desks[name]?.fills}
      coverage={[projectId ? `Venture #${projectId} selected` : 'No venture selected']}
      footer="Traceable surface · no unsupported automated actions"
    />
  );

  // D703 step 8: the bar every phone page below 1024px draws, as a function
  // of the page's own title, sub and Back (the `Lightbox` page mode calls it).
  // Its back label names where Back goes (decision 5).
  const phoneBar = (backLabel) => ({ title, sub, onBack }) => (
    <CycleBar back={{ label: backLabel, onClick: onBack }} title={title} sub={sub} eadwynLabel={`${name} · ${title}`} />
  );
  // An Add or Edit page's Back returns to the module, or in record mode to the record (step 9).
  const pageBack = record ? (recordState.data?.title || moduleName || name) : (moduleName || name);
  // Below 1024px an action page is the route's only content (decision 11).
  const actionPage = phone && lightbox && Mount && projectId;

  let body;
  if (projectStatus === 'none') {
    // A founder with no venture yet is offered the one way to make one.
    const createBtn = 'inline-flex w-fit items-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep';
    body = (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-axal-hairline bg-white p-4 text-[13px] text-axal-muted dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400" data-testid="cycle-no-venture">
        <p className="m-0">There is no venture to show yet. {name} fills in once you have one.</p>
        {creates
          ? <button type="button" className={createBtn} onClick={() => setCreating(true)} data-testid="cycle-create-venture">Create your startup</button>
          : <Link className={createBtn} to="/build?new=1" data-testid="cycle-create-venture">Create your startup</Link>}
      </div>
    );
  } else if (narrativeTab) {
    body = (
      <NarrativeTabPage tab={narrativeTab} projectId={projectId} projectStatus={projectStatus} onRetryProject={() => setProjectsKey((n) => n + 1)}
        fixOn={fillsOn} search={location.search} cards={tabs} action={action} phone={phone} />
    );
  } else if (record) {
    const recordTitle = recordState.data?.title || moduleName;
    body = <div className="space-y-4" data-testid="cycle-record-page">
      {/* D703 step 7: below 1024px the record is a pushed page under
          `CycleBar`, whose Back goes to the module; the loading, refused and
          unreadable states draw under it too. */}
      {phone ? (
        <CycleBar back={{ label: moduleName || name, to: `/${cycle}/${slug}${q}` }} title={recordTitle}
          sub={recordState.data?.sub || undefined} eadwynLabel={`${name} · ${recordTitle}`} />
      ) : (
        <CycleHeader cycle={cycle} cards={tabs} active={slug} record moduleName={moduleName}
          title={recordTitle} sub={recordState.data?.sub || ''} search={q} />
      )}
      <RecordPhoneProvider phone={phone}>
      {recordState.status === 'loading' ? <p className="text-sm text-axal-muted dark:text-gray-400" aria-busy="true">Loading record…</p>
        : recordState.status === 'refused' ? <p className="text-sm text-axal-ink dark:text-gray-100">{recordState.error}</p>
        : recordState.status === 'unreadable' ? <Unreadable what="This record" claim={recordState.error} onRetry={() => setReload(n => n + 1)} />
        : recordState.data && (fnOf(def.recordPage, slug)?.(recordState.data, { projectId, id: recordId, activity: recordState.activity, cycleName: name, moduleName, onLink: recordState.link, onForm: recordState.openForm, onWrite: recordState.write, onClient: recordState.client, onShowAll: recordState.showAll, act: (key, body) => cyclesApi.recordAction(cycle, projectId, slug, recordId, key, body), reload: () => setReload((n) => n + 1), openDialog })
          ?? <RecordView record={recordState.data} activity={recordState.activity}
          cycleName={name} moduleName={moduleName} onLink={recordState.link} onForm={recordState.openForm}
          onWrite={recordState.write} onClient={recordState.client} onShowAll={recordState.showAll} />)}
      </RecordPhoneProvider>
      {recordState.actionError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{recordState.actionError}</p>}
    </div>;
  } else if (!slug) {
    // D703 decision 1: below 1024px the root is the phone page, in place of
    // the overview and `AlsoIn`, never beside them. Both read the same overview.
    const overviewState = projectStatus === 'unreadable' ? 'unreadable' : overviewStatus;
    body = phone ? (
      <PhoneCycleRoot cycle={cycle} raw={rawOverview} status={overviewState} search={q} projectId={projectId}
        openAction={openAction} onChanged={() => setReload((n) => n + 1)} onRetry={() => setReload((n) => n + 1)} />
    ) : (
      <>
        <CycleOverview
          cycle={cycle}
          data={overview}
          status={overviewState}
          onRetry={() => setReload((n) => n + 1)}
          onRetryCard={retryCard}
          action={action}
          search={q}
        />
        <AlsoIn role="founder" row={name} />
      </>
    );
  } else {
    const recs = module?.records;
    // D703 step 6: below 1024px the module is a pushed page with the same props.
    const ModulePage = phone ? PhoneModulePage : CycleModulePage;
    body = (
      <ModulePage
        cycle={cycle}
        slug={slug}
        moduleName={moduleName}
        cards={tabs}
        data={module}
        status={projectStatus === 'unreadable' ? 'unreadable' : moduleStatus}
        message={moduleStatus === 'refused' ? moduleMessage : undefined}
        onRetry={() => setReload((n) => n + 1)}
        records={recs}
        recordsStatus={moduleStatus === 'ready' ? (recs?.state === 'unreadable' ? 'unreadable' : 'ready') : undefined}
        recordsMessage={recs?.state === 'unreadable' ? recs.reason : undefined}
        query={query}
        onQuery={setQuery}
        action={action}
        add={forms.length && projectId
          ? forms.map((entry, i) => ({ text: entry.button, href: addHref(entry, i), state: { under: `${location.pathname}${location.search}` } }))
          : fnOf(def.add, slug)?.(q, openAction)}
        rowAction={edit && projectId && !edit.hiddenFor?.(module) ? (row) => (edit.idOf(row) == null ? null : {
          text: edit.button,
          label: `${edit.button} ${((v) => (v.nr ? 'this row' : v.text))(cellView(row?.cells?.[recs?.cols?.[0]?.key]))}`,
          onClick: () => navigate(`${location.pathname}${location.search}`, { state: { editing: String(row.id) } }),
        }) : undefined}
        tool={fnOf(def.tools, slug)?.(q)}
        tools={moduleToolLinks(cycle, slug, user, q)}
        search={q}
        subnav={cycle === 'raise' && slug === NARRATIVE ? <NarrativeTabBar active="home" search={tabSearch(q, searchParams.get('version'))} /> : undefined}
      >
        {fillKind && projectId && (
          <FillProposals key={`${slug}-${fillKind}`} projectId={projectId} kind={fillKind} enabled={fillsOn} ai={ai} workspace={name} onApplied={() => setReload((n) => n + 1)}
            railOption={`fill:${fillKind}`} />
        )}
        {fillsOn && projectId ? drafts.map((draft) => (
          <ZoneDraft key={`${slug}-${draft.surface}`} {...draft} scopeKey={String(projectId)} scoped={cycle === 'raise' && slug === 'investor-narrative'} ai={ai} accent="violet" railOption={`draft:${draft.surface}`} />
        )) : null}
        {/* D757 §2.7 (#1928): each Validate module's interview suggestions, writers only. Verdict takes none. */}
        {moduleStatus === 'ready' && cycle === 'validate' && slug !== 'verdict' && (
          <FromYourInterviews parts={module?.parts}
            onAccept={(id, payload) => interviewSessionsApi.accept(id, payload).then(() => setReload((n) => n + 1))}
            onDiscard={(id) => interviewSessionsApi.discard(id).then(() => setReload((n) => n + 1))}
            onAcceptAll={(batches) => acceptSuggestions(batches, interviewSessionsApi).finally(() => setReload((n) => n + 1))} />
        )}
        {moduleStatus === 'ready' && fnOf(def.parts, slug)?.(module, { projectId, reload: () => setReload((n) => n + 1), openAction, query, openDialog, role: user?.role ?? null })}
      </ModulePage>
    );
  }

  // D698 — where the rail is: the cycle, and on a module route the module, so
  // it reads "Validate › Customer research". In record mode `RecordCrumb`
  // adds the record's title (D696). The provider draws no element.
  // The rail sits in the one frame every rail host uses (D556), as the
  // Validate desk's own did; the frame is this page's outermost element so it
  // docks to the edge.
  return (
    <RailCrumbsProvider section={name} module={moduleName}>
    <RailFrame rail={rail} data-testid={`cycle-route-${cycle}`}>
      {/* Every cycle path is full-bleed (`cyclePaths.js`, D694), so this is the
          one gutter: the canvas's 22/24/30px (CO:54), 14/14/40px in a cycle
          column under 760px (CO:18), and 14/22/18px on a phone (CO:25-26).
          The column is the size container. The form sheets and the action
          Mount draw `fixed` layers, so they sit after it: an older browser
          would place them against the column (decision 13). */}
      {/* D703 decision 11: below 1024px an action page is the route's only
          content, so neither the size container nor the body is drawn. */}
      {!actionPage && (
      <div className="@container/cycle min-w-0">
      <div className="min-w-0 px-[22px] pt-[14px] pb-[18px] lg:px-6 lg:pt-[22px] lg:pb-[30px] lg:@max-[760px]/cycle:px-[14px] lg:@max-[760px]/cycle:pt-[14px] lg:@max-[760px]/cycle:pb-[40px]" data-testid="cycle-route-body">
        <LightboxBarProvider bar={phone ? phoneBar(pageBack) : null}>
        {phone && openForm ? openForm : phone && dialog?.page ? dialog.element : body}
        </LightboxBarProvider>
        {creates && !record && (
          <CreateStartupForm
            open={creating}
            onOpenChange={(next) => {
              setCreating(next);
              // Drop ?new=1 once the form closes, so a reload does not reopen it.
              if (!next && searchParams.get('new') === '1') {
                setSearchParams((old) => { const params = new URLSearchParams(old); params.delete('new'); return params; }, { replace: true });
              }
            }}
            onCreated={(created) => { if (created?.id) writeProject(created.id, ['new']); setProjectsKey((n) => n + 1); }}
          />
        )}
      </div>
      </div>
      )}
      {!phone && openForm}
      {record && recordState.confirm}
      {lightbox && Mount && projectId && (
        <Mount projectId={projectId} q={q} searchParams={searchParams} onClose={closeAction} onDone={onDone}
          asPage={phone ? { pageBelow: 'lg', bar: phoneBar(moduleName || name), pageClass: PHONE_GUTTER } : undefined}
          onChanged={() => { dirty.current = true; }} />
      )}
      {dialog && !(phone && dialog.page) && dialog.element}
      <RecordCrumb title={record && recordState.status === 'ready' ? recordState.data?.title : null} type={`${cycle}/${slug}`} id={narrativeTab ? null : recordId ?? null} />
    </RailFrame>
    </RailCrumbsProvider>
  );
}

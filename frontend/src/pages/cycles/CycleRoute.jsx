import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { cyclesApi, cyclesWrite } from '../../lib/api/cycles';
import { WorkerRail } from '../../ui';
import RailFrame from '../../ui/RailFrame';
import { ASSIST_SURFACES } from '../../ui/eadwynConfig';
import FillProposals from '../../workspaces/FillProposals';
import ZoneDraft from '../../workspaces/ZoneDraft';
import AlsoIn from '../../workspaces/AlsoIn';
import useAssistMode from '../../hooks/useAssistMode';
import useAiSpend from '../../hooks/useAiSpend';
import useScrollToHash from '../../hooks/useScrollToHash';
import ShareUpdateLightbox from '../founder/ShareUpdateLightbox';
import ConnectToolSheet from '../account/ConnectToolSheet';
import { takeBuildProject } from '../account/connectorsModel';
import RoundCallSheet from '../founder/RoundCallSheet';
import RecordLightbox from '../founder/RecordLightbox';
import { recordingHref } from '../founder/recordSetup';
import { useActiveRecording } from '../../contexts/ActiveRecordingContext';
import CreateStartupForm from '../../components/CreateStartupForm';
import CycleOverview from './CycleOverview';
import ValidatePhoneFocus from './ValidatePhoneFocus';
import CycleModulePage from './CycleModulePage';
import DurabilityChecklist from './DurabilityChecklist';
import ToolsHistory from './ToolsHistory';
import UpdatesHistory from './UpdatesHistory';
import UpdateAskReplies from './UpdateAskReplies';
import CallsHistory from './CallsHistory';
import RecordFormSheet from './RecordFormSheet';
import { editFor, formFor } from './forms';
import { adaptCard, adaptModule, adaptOverview, fnOf, toFnMap } from './adapters';
import { cellView, cycleOf } from './cycleModel';
import { MODULES } from './modules';
import { useAuth } from '../../hooks/useAuthSync';
import { moduleToolLinks } from './founderToolNavigation.js';

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
 * THE MODULES' WORKING TOOLS STAY WHERE THEY ARE. No canvas yet draws a
 * module's Add form, a record's edit view, or Validate's curation (merging
 * pain themes, linking evidence, the Verdict): S02 found the gap on #1474.
 * D661 already gives a module page a link to "the module's own tool where it
 * has one, rather than a second copy of it", so each module links to the
 * zone page that edits it today. Add is offered only where it opens a form
 * directly; a button with nothing behind it is not drawn.
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
      'problem-discovery': (q) => ({ label: 'Curate pain themes: merge, rename, judge severity', href: `/validate/pain-map${q}` }),
      'customer-research': (q) => ({ label: 'Open the interview log: notes, recordings, evidence', href: `/validate/interviews${q}` }),
      'market-intelligence': () => ({ label: 'Open the competitor tracker', href: '/build/competitors' }),
      experiments: (q) => ({ label: 'Open the hypothesis board and the verdict', href: `/validate/hypotheses${q}` }),
    }),
    add: toFnMap({
      'customer-research': (q, open) => ({ text: 'Record a session', href: `/validate/record${q}`, onOpen: open }),
    }),
    // The AI fill bands the Validate desk carried, on the module they fill.
    fills: { 'problem-discovery': 'pain_tag', experiments: 'hypothesis' },
  },
  /**
   * Raise's read (#1501, D663) is already in D661's shape: its cards carry
   * chart specs and its records carry their own `add`, so it needs no
   * adapter. Its modules are in `modules.js`, held to `services/raiseCycle.ts`'s
   * list by `cycle_adapters_d661.test.ts`.
   *
   * `/raise/data-room` IS THE DATA ROOM. The module's slug and the tool's
   * route are the same path, and the tool's static route wins, so the Data
   * room tab opens the working tool itself, which is D661's rule for a
   * module that has one. The other six have module pages.
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
    parts: toFnMap({
      'capital-relationships': (data) => <CallsHistory calls={data?.parts?.calls} />,
    }),
    tools: toFnMap({
      'investor-narrative': () => ({ label: 'Open the positioning workspace', href: '/raise/pitch/positioning' }),
      'pitch-deck': () => ({ label: 'Open the pitch deck', href: '/raise/pitch' }),
      'cap-table': () => ({ label: 'Open the cap table', href: '/raise/capital/cap-table' }),
      'use-of-funds': () => ({ label: 'Open the financial model', href: '/raise/capital/model' }),
      'capital-relationships': () => ({ label: 'Open the investor pipeline', href: '/raise/capital/pipeline' }),
    }),
    add: toFnMap({}),
    fills: {},
    // The Raise desk's four AI bands (ZoneDraft, D424), on the modules they
    // read: the round and its order of payment on Cap table, which holds the
    // scenario both read; the room and the clauses on Fundraising readiness,
    // which scores the data room and the documents. Data room has no module
    // page of its own (its tool's route wins), so its band sits here too. The
    // narrative band sits on Investor narrative, whose check it phrases.
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
        surface: 'raise/narrative-fix', tone: 'warn', label: 'Mismatch · phrase the fix', run: 'Phrase the fix', accept: 'Keep this wording',
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
   * Grow's new stores (feedback, channels, partners, markets, obligations)
   * have no page of their own: their Add and Edit forms are `forms.js`'s, on
   * the module page. Revenue, roles and the compliance calendar link the
   * pages that edit them today.
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
    add: toFnMap({
      'team-expansion': () => ({ text: 'Post a role', href: '/jobs/new' }),
    }),
    fills: {},
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
      </>),
      // The replies customer and partner asks brought in, beside the rows.
      distribution: (data) => <UpdateAskReplies replies={data?.parts?.from_update_asks} pill="Lead" />,
      'partner-network': (data) => <UpdateAskReplies replies={data?.parts?.from_update_asks} pill="Partner" />,
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
    parts: toFnMap({
      'operating-systems': (data) => <ToolsHistory tools={data?.parts?.tools} />,
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

export function useProject(reloadKey = 0, { kept = null } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  // The read's own links (`next.href`) say `?project=`; the page's say
  // `?project_id=`. Either picks the venture.
  const named = Number(searchParams.get('project_id') || searchParams.get('project')) || null;
  // Back from a provider's sign-in at /build/connect with no venture named: the
  // one Build kept before the redirect (D686 §5.4), taken once.
  const [stashed] = useState(() => (named ? null : kept?.() ?? null));
  const requested = named || stashed;
  useEffect(() => {
    if (named || !stashed) return;
    setSearchParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(stashed)); return next; }, { replace: true });
  }, [named, stashed, setSearchParams]);
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
      if (first) setSearchParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(first.id)); return next; }, { replace: true });
    }).catch(() => { if (alive) setStatus('unreadable'); });
    return () => { alive = false; };
  }, [requested, setSearchParams, reloadKey]);
  return { projectId, status };
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
export function RecordMount({ projectId, interviewId, onClose, onStarted }) {
  const { recorder } = useActiveRecording();
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
  return <RecordLightbox projectId={projectId} interview={interview} onClose={onClose} onStarted={onStarted} recorder={recorder} />;
}

/** The module slug of a cycle path (`/validate/customer-research?…`), or null for the overview and the cycle's own action path. */
export function underSlug(path, cycle = 'validate', action = 'record') {
  if (!/^[a-z]+$/.test(cycle)) return null;
  const m = new RegExp(`^/${cycle}/([a-z0-9-]+)(?:[/?#]|$)`).exec(String(path || ''));
  return m && m[1] !== action ? m[1] : null;
}

/*
 * Each cycle's open lightbox (D686 §5.1). Build, Raise and Grow mount their
 * existing self-framed sheets for now, with no frame of their own around them:
 * two dialogs must never nest. S02-B, S03-A and S03-B each swap their cycle's
 * Mount for a `<Lightbox size="tall">` with an `ActionSheet` body.
 */
function ValidateMount({ projectId, searchParams, onClose, onDone }) {
  return <RecordMount projectId={projectId} interviewId={searchParams.get('interview')} onClose={onClose} onStarted={onDone} />;
}
// D686 §5.4 (#1597): the sheet connects for this project's company, and a
// change re-reads the Build page once the lightbox closes.
function BuildMount({ projectId, onClose, onChanged }) {
  return <ConnectToolSheet projectId={projectId} onClose={onClose} onChanged={onChanged} />;
}
function RaiseMount({ projectId, onClose }) {
  return <RoundCallSheet projectId={projectId} onClose={onClose} />;
}
function GrowMount({ projectId, onClose, onDone }) {
  return <ShareUpdateLightbox projectId={projectId} onClose={onClose} onSent={onDone} />;
}

/**
 * `lightbox` is the cycle's action route (D685 §5.4, D686 §5.1):
 * `/validate/record`, `/build/connect`, `/raise/call`, `/grow/update`, the
 * cycle page with its lightbox open over it. The page underneath is the one the
 * founder was on (`location.state.under`), the overview on a deep link. Closing
 * goes back to it; the lightbox makes no server call.
 */
export default function CycleRoute({ cycle, lightbox = false }) {
  const { slug: routeSlug } = useParams();
  const location = useLocation();
  const { user } = useAuth() || {};
  const def = Object.prototype.hasOwnProperty.call(CYCLE_DEFS, cycle) ? CYCLE_DEFS[cycle] : null;
  // D685 §5.4: while this tab records (or holds a paused recording), the setup
  // never opens over it: `/validate/record` is that recording's live view.
  const { state: recording } = useActiveRecording();
  const toLive = lightbox && cycle === 'validate' ? recordingHref(recording) : null;
  // Under the lightbox is the module page the founder was on, when it is one of
  // this cycle's modules; otherwise (a deep link, or the interview log) the overview.
  const slug = lightbox ? underModule(def?.modules, location.state?.under, cycle, def?.path) : routeSlug;
  const [searchParams, setSearchParams] = useSearchParams();
  const [projectsKey, setProjectsKey] = useState(0);
  const { projectId, status: projectStatus } = useProject(projectsKey, { kept: lightbox && cycle === 'build' ? takeBuildProject : null });
  const creates = Boolean(def?.creates);
  const [creating, setCreating] = useState(() => creates && searchParams.get('new') === '1');
  // Followed, not only seeded: the Command Palette can address `?new=1` from
  // this very page, which changes the search without a remount.
  useEffect(() => {
    if (creates && searchParams.get('new') === '1') setCreating(true);
  }, [creates, searchParams]);
  const name = cycleOf(cycle)?.name || 'Validate';
  const [fillsOn] = useAssistMode(name);
  const q = projectId ? `?project_id=${projectId}` : '';
  const navigate = useNavigate();
  // A lightbox that changed something (a tool connected) marks the page dirty;
  // it reloads on close, not behind the lightbox, so nothing flashes.
  const dirty = useRef(false);
  // The module's Add and Edit forms (`forms.js`), for a store with no page of
  // its own. `editing` is the row being edited.
  const form = slug && def ? formFor(cycle, slug) : null;
  const edit = slug && def ? editFor(cycle, slug) : null;
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  useEffect(() => { setFormOpen(false); setEditing(null); }, [slug]);
  const drafts = slug && def?.drafts instanceof Map && Array.isArray(def.drafts.get(slug)) ? def.drafts.get(slug) : [];
  const fillKind = slug && def?.fills && Object.prototype.hasOwnProperty.call(def.fills, slug) ? def.fills[slug] : null;
  // The cost before a run (D424), read only while a band is drawn: a draft
  // band or a fill band, which quotes its own kind's task from the same read.
  const ai = useAiSpend({ enabled: Boolean(fillsOn && projectId && (drafts.length || fillKind)) });

  const [overview, setOverview] = useState(null);
  // D685 §5.12: the phone focus reads the overview as sent; adapting a card replaces its series.
  const [rawOverview, setRawOverview] = useState(null);
  const [overviewStatus, setOverviewStatus] = useState('loading');
  const [module, setModule] = useState(null);
  const [moduleStatus, setModuleStatus] = useState('loading');
  // D686: a history address (`#tools`, `#calls`, `#updates`) scrolls once its section is drawn.
  useScrollToHash(moduleStatus !== 'ready');
  const [query, setQuery] = useState({ q: '', filter: {}, sort: '', page: 1 });
  const [reload, setReload] = useState(0);
  const known = !slug || (def?.modules || []).some((m) => m.slug === slug);
  // The page re-reads once the lightbox is gone, however it went: ×, Escape and
  // a finish navigate away from the action route, and so does the browser's
  // Back, which never calls `closeAction`. The route keeps this component
  // mounted across that change, so the dirty mark survives to be read here.
  useEffect(() => {
    if (!lightbox && dirty.current) { dirty.current = false; setReload((n) => n + 1); }
  }, [lightbox]);

  // The table's query resets when the module changes.
  useEffect(() => { setQuery({ q: '', filter: {}, sort: '', page: 1 }); }, [slug]);

  useEffect(() => {
    if (slug || !projectId || !def) return undefined;
    let alive = true;
    setOverviewStatus('loading');
    cyclesApi.overview(cycle, projectId)
      .then((data) => { if (alive) { setRawOverview(data); setOverview(adaptOverview(cycle, data)); setOverviewStatus('ready'); } })
      .catch(() => { if (alive) setOverviewStatus('unreadable'); });
    return () => { alive = false; };
  }, [cycle, slug, projectId, reload, def]);

  useEffect(() => {
    if (!slug || !known || !projectId || !def) return undefined;
    let alive = true;
    setModuleStatus('loading');
    cyclesApi.module(cycle, projectId, slug, { q: query.q, filter: filterString(query.filter), sort: query.sort, page: query.page })
      .then((data) => { if (alive) { setModule(adaptModule(cycle, slug, data)); setModuleStatus('ready'); } })
      .catch(() => { if (alive) setModuleStatus('unreadable'); });
    return () => { alive = false; };
  }, [cycle, slug, known, projectId, query, reload, def]);

  // One card re-read: the module read returns that card on its own, so the
  // others stay drawn (D656: a failing source leaves the others alone).
  const retryCard = useCallback((cardSlug) => {
    if (!projectId) return;
    cyclesApi.module(cycle, projectId, cardSlug, {})
      .then((data) => setOverview((o) => (o ? { ...o, cards: o.cards.map((c) => (c.slug === cardSlug ? adaptCard(cycle, { slug: cardSlug, ...data.card }) : c)) } : o)))
      .catch(() => {});
  }, [cycle, projectId]);

  const tabs = useMemo(() => (def?.modules || []).map((m) => ({ slug: m.slug, name: m.name })), [def]);

  if (toLive) return <Navigate to={toLive} replace />;
  if (!def) return null;
  if (!known) return <Navigate to={`/${cycle}${q}`} replace />;

  const openAction = projectId && def.path
    ? () => navigate(`/${cycle}/${def.path}${q}`, { state: { under: `${location.pathname}${location.search}` } })
    : undefined;
  const closeAction = () => {
    if (location.state?.under) navigate(-1);
    else navigate(`/${cycle}${q}`, { replace: true });
  };
  // What finishing does: the recording view or the session replaces the action
  // route, and a sent update opens its page, so Back never reopens the lightbox.
  const onDone = cycle === 'validate'
    ? (session, interview, where) => (where === 'live'
      ? navigate(`/validate/record/live?session=${encodeURIComponent(session.id)}`, { replace: true })
      : navigate(`/validate/session/${session.id}`, { state: { interview }, replace: true }))
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
  } else if (!slug) {
    body = (
      <>
        {cycle === 'validate' && overviewStatus === 'ready' && rawOverview && projectStatus !== 'unreadable' && <ValidatePhoneFocus raw={rawOverview} search={q} projectId={projectId} onChanged={() => setReload((n) => n + 1)} />}
        <CycleOverview
          cycle={cycle}
          data={overview}
          status={projectStatus === 'unreadable' ? 'unreadable' : overviewStatus}
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
    body = (
      <CycleModulePage
        cycle={cycle}
        slug={slug}
        cards={tabs}
        data={module}
        status={projectStatus === 'unreadable' ? 'unreadable' : moduleStatus}
        onRetry={() => setReload((n) => n + 1)}
        records={recs}
        recordsStatus={moduleStatus === 'ready' ? (recs?.state === 'unreadable' ? 'unreadable' : 'ready') : undefined}
        recordsMessage={recs?.state === 'unreadable' ? recs.reason : undefined}
        query={query}
        onQuery={setQuery}
        action={action}
        add={fnOf(def.add, slug)?.(q, openAction) || (form && projectId ? { text: form.button, onClick: () => setFormOpen(true) } : undefined)}
        rowAction={edit && projectId && !edit.hiddenFor?.(module) ? (row) => (edit.idOf(row) == null ? null : {
          text: edit.button,
          label: `${edit.button} ${((v) => (v.nr ? 'this row' : v.text))(cellView(row?.cells?.[recs?.cols?.[0]?.key]))}`,
          onClick: () => setEditing(row),
        }) : undefined}
        tool={fnOf(def.tools, slug)?.(q)}
        tools={moduleToolLinks(cycle, slug, user, q)}
        search={q}
      >
        {fillKind && projectId && (
          <FillProposals key={`${slug}-${fillKind}`} projectId={projectId} kind={fillKind} enabled={fillsOn} ai={ai} workspace={name} onApplied={() => setReload((n) => n + 1)} />
        )}
        {fillsOn && projectId ? drafts.map((draft) => (
          <ZoneDraft key={`${slug}-${draft.surface}`} {...draft} scopeKey={String(projectId)} ai={ai} accent="violet" />
        )) : null}
        {moduleStatus === 'ready' && fnOf(def.parts, slug)?.(module, { projectId, reload: () => setReload((n) => n + 1), openAction })}
      </CycleModulePage>
    );
  }

  // The rail sits in the one frame every rail host uses (D556), as the
  // Validate desk's own did; the frame is this page's outermost element so it
  // docks to the edge.
  return (
    <RailFrame rail={rail} data-testid={`cycle-route-${cycle}`}>
      {/* The route is full-bleed (`p-0`), so the inset is this page's own,
          the same `p-5` WorkspaceShell gives every other workspace page. */}
      <div className="min-w-0 p-5" data-testid="cycle-route-body">
        {body}
        {creates && (
          <CreateStartupForm
            open={creating}
            onOpenChange={(next) => {
              setCreating(next);
              // Drop ?new=1 once the form closes, so a reload does not reopen it.
              if (!next && searchParams.get('new') === '1') {
                setSearchParams((old) => { const params = new URLSearchParams(old); params.delete('new'); return params; }, { replace: true });
              }
            }}
            onCreated={() => setProjectsKey((n) => n + 1)}
          />
        )}
        {form && formOpen && projectId && (
          <RecordFormSheet form={form} cycle={name}
            onSubmit={(values) => form.submit(cyclesWrite, projectId, values)}
            onSaved={() => setReload((n) => n + 1)}
            onClose={() => setFormOpen(false)} />
        )}
        {edit && editing && projectId && edit.idOf(editing) != null && (
          <RecordFormSheet key={String(editing.id)} form={edit} current={edit.valuesOf(editing)} cycle={name}
            loadOptions={edit.loadOptions ? () => edit.loadOptions(cyclesWrite, projectId, edit.idOf(editing)) : null}
            onSubmit={(values) => edit.submit(cyclesWrite, projectId, edit.idOf(editing), values)}
            onSaved={() => setReload((n) => n + 1)}
            onClose={() => setEditing(null)} />
        )}
        {lightbox && Mount && projectId && (
          <Mount projectId={projectId} q={q} searchParams={searchParams} onClose={closeAction} onDone={onDone}
            onChanged={() => { dirty.current = true; }} />
        )}
      </div>
    </RailFrame>
  );
}

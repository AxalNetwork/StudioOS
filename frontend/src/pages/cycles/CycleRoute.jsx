import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { cyclesApi } from '../../lib/api/cycles';
import { WorkerRail } from '../../ui';
import RailFrame from '../../ui/RailFrame';
import { ASSIST_SURFACES } from '../../ui/eadwynConfig';
import FillProposals from '../../workspaces/FillProposals';
import AlsoIn from '../../workspaces/AlsoIn';
import useAssistMode from '../../hooks/useAssistMode';
import CycleOverview from './CycleOverview';
import CycleModulePage from './CycleModulePage';
import { adaptCard, adaptModule, adaptOverview, fnOf, toFnMap } from './adapters';
import { cycleOf } from './cycleModel';
import { MODULES } from './modules';

/**
 * D661 (#1474) — a cycle's overview and module pages, wired to its read.
 *
 * `/validate` draws the overview and `/validate/:slug` one module page, from
 * `GET /api/cycles/validate/…` (#1487) through `adapters/validate.js`. The
 * project is `?project_id=`, else the founder's first, as the Validate desk
 * this replaces chose it.
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
    // The primary action opens the interview form; a session attaches to the
    // interview it records (`RecordSessionSheet`), so the form comes first.
    action: (q) => ({ label: 'Record a session', href: `/validate/interviews?new=record${q ? `&${q.slice(1)}` : ''}` }),
    tools: toFnMap({
      'problem-discovery': (q) => ({ label: 'Curate pain themes: merge, rename, judge severity', href: `/validate/pain-map${q}` }),
      'customer-research': (q) => ({ label: 'Open the interview log: notes, recordings, evidence', href: `/validate/interviews${q}` }),
      'market-intelligence': () => ({ label: 'Open the competitor tracker', href: '/build/competitors' }),
      experiments: (q) => ({ label: 'Open the hypothesis board and the verdict', href: `/validate/hypotheses${q}` }),
    }),
    add: toFnMap({
      'customer-research': (q) => ({ text: 'Record a session', href: `/validate/interviews?new=record${q ? `&${q.slice(1)}` : ''}` }),
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
    // D653's Call for Capital, behind ROUND_CALLS_ENABLED; with the flag off
    // the page says so in its own words.
    action: () => ({ label: 'Call for Capital', href: '/round-calls' }),
    tools: toFnMap({
      'investor-narrative': () => ({ label: 'Open the positioning workspace', href: '/raise/pitch/positioning' }),
      'pitch-deck': () => ({ label: 'Open the pitch deck', href: '/raise/pitch' }),
      'cap-table': () => ({ label: 'Open the cap table', href: '/raise/capital/cap-table' }),
      'use-of-funds': () => ({ label: 'Open the financial model', href: '/raise/capital/model' }),
      'capital-relationships': () => ({ label: 'Open the investor pipeline', href: '/raise/capital/pipeline' }),
    }),
    add: toFnMap({}),
    fills: {},
  },
};

const filterString = (filter) => Object.entries(filter || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}:${v}`).join(',');

function useProject() {
  const [searchParams, setSearchParams] = useSearchParams();
  // The read's own links (`next.href`) say `?project=`; the page's say
  // `?project_id=`. Either picks the venture.
  const requested = Number(searchParams.get('project_id') || searchParams.get('project')) || null;
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
  }, [requested, setSearchParams]);
  return { projectId, status };
}

export default function CycleRoute({ cycle }) {
  const { slug } = useParams();
  const def = Object.prototype.hasOwnProperty.call(CYCLE_DEFS, cycle) ? CYCLE_DEFS[cycle] : null;
  const { projectId, status: projectStatus } = useProject();
  const name = cycleOf(cycle)?.name || 'Validate';
  const [fillsOn] = useAssistMode(name);
  const q = projectId ? `?project_id=${projectId}` : '';

  const [overview, setOverview] = useState(null);
  const [overviewStatus, setOverviewStatus] = useState('loading');
  const [module, setModule] = useState(null);
  const [moduleStatus, setModuleStatus] = useState('loading');
  const [query, setQuery] = useState({ q: '', filter: {}, sort: '', page: 1 });
  const [reload, setReload] = useState(0);
  const known = !slug || (def?.modules || []).some((m) => m.slug === slug);

  // The table's query resets when the module changes.
  useEffect(() => { setQuery({ q: '', filter: {}, sort: '', page: 1 }); }, [slug]);

  useEffect(() => {
    if (slug || !projectId || !def) return undefined;
    let alive = true;
    setOverviewStatus('loading');
    cyclesApi.overview(cycle, projectId)
      .then((data) => { if (alive) { setOverview(adaptOverview(cycle, data)); setOverviewStatus('ready'); } })
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

  if (!def) return null;
  if (!known) return <Navigate to={`/${cycle}${q}`} replace />;

  const action = def.action(q);
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
    body = <p className="m-0 rounded-xl border border-axal-hairline bg-white p-4 text-[13px] text-axal-muted dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400" data-testid="cycle-no-venture">There is no venture to show yet. {name} fills in once you have one.</p>;
  } else if (!slug) {
    body = (
      <>
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
    const fillKind = def.fills && Object.prototype.hasOwnProperty.call(def.fills, slug) ? def.fills[slug] : null;
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
        add={fnOf(def.add, slug)?.(q)}
        tool={fnOf(def.tools, slug)?.(q)}
        search={q}
      >
        {fillKind && projectId && (
          <FillProposals key={`${slug}-${fillKind}`} projectId={projectId} kind={fillKind} enabled={fillsOn} onApplied={() => setReload((n) => n + 1)} />
        )}
      </CycleModulePage>
    );
  }

  // The rail sits in the one frame every rail host uses (D556), as the
  // Validate desk's own did; the frame is this page's outermost element so it
  // docks to the edge.
  return (
    <RailFrame rail={rail} data-testid={`cycle-route-${cycle}`}>
      <div className="min-w-0">{body}</div>
    </RailFrame>
  );
}

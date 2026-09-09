import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowUpRight, ChevronRight, ClipboardCheck, KanbanSquare, LineChart, Route, Target } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import ExecutionPage from '../ExecutionPage';
import ZoneDraft from '../../workspaces/ZoneDraft';
import useAssistMode from '../../hooks/useAssistMode';
import { zonePillClass } from './deskZoneNav';
import CreateStartupForm from '../../components/CreateStartupForm';
import './founderBuildDesk.css';

/**
 * Five labels, five routes, IN THE ARTBOARD'S ORDER.
 *
 * This lived inline in the chip row as a five-pair array literal. Pulling it up
 * is not tidying: `founder_overview_subpage_links.test.mjs` holds one rule for
 * all four desks — that the chip row and the cards under it come from the same
 * list, so a card cannot summarise a page the row does not name, or hand off to
 * a page that is not in this bucket. That rule needs the list to be findable.
 *
 * A3's `anchB` reads This week, Board, Roadmap, Cadence, KPI entry
 * (`design/incoming/Founder Workspaces Canvas.dc.html`), and Cadence sat third
 * here. The CARDS keep their own order, which is also the artboard's: the pair
 * row puts the board beside cadence, and the chip row does not follow it.
 */
const SECTIONS = [
  ['This week', 'this-week'], ['Board', 'board'], ['Roadmap', 'roadmap'],
  ['Cadence', 'cadence'], ['KPI entry', 'kpi'],
];

/**
 * The four board columns A3 draws, and the one the store cannot fill.
 *
 * `mvp_tasks.status` is `todo | in_progress | done` — there is no review state
 * anywhere in the schema, and the desk drew three columns without saying why
 * the artboard has four. Folding review into In progress would be worse than
 * either: a card waiting on someone else's read is not a card being worked, and
 * the count a founder reads on a Monday would be wrong in the direction that
 * makes the week look busier than it is. So the column is drawn, empty, with
 * the reason on it (D56/D68).
 */
const BOARD_COLUMNS = [
  ['Backlog', 'todo'], ['In progress', 'in_progress'], ['Review', null], ['Shipped', 'done'],
];

/**
 * A3's roadmap pills, and what each horizon means once it is one.
 *
 * The artboard labels its three roadmap cards In flight / Committed /
 * Provisional and its periods with quarters. `roadmap_okrs` carries both
 * `kanban_status` (now/next/later) and `quarter` — and `quarter` has never been
 * read by this desk, so a founder who set one saw "now" where they had written
 * "Q3 2026".
 */
const HORIZONS = [
  ['now', 'In flight'], ['next', 'Committed'], ['later', 'Provisional'],
];

const WEEK_MS = 7 * 86400000;
const clean = (value) => String(value || '').trim();
const dateRange = () => {
  const start = new Date();
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const format = (date) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  return `${format(start)}–${format(end)}`;
};
const metricValue = (value, unit = '') => {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Not recorded';
  if (unit === '$') return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(numeric);
  return numeric.toLocaleString();
};
const stamp = (row) => {
  const t = Date.parse(row?.updated_at || row?.created_at || '');
  return Number.isNaN(t) ? null : t;
};
/**
 * The one-line note A3 prints under each board count ("2 added this week",
 * "1 stale 5 days"). Both come off the same rows the count came from, so the
 * note can never disagree with the number above it — which is the failure the
 * Partner Retainers zone shipped and had to be fixed for.
 */
function columnNote(rows, key) {
  if (!rows.length) return 'No cards in this column';
  const now = Date.now();
  const added = rows.filter((row) => {
    const t = Date.parse(row?.created_at || '');
    return !Number.isNaN(t) && now - t <= WEEK_MS;
  }).length;
  if (key === 'done') return added ? `${added} this week` : 'None shipped this week';
  if (added) return `${added} added this week`;
  const oldest = rows.map(stamp).filter((t) => t !== null).sort((a, b) => a - b)[0];
  if (oldest == null) return 'No dates recorded';
  const days = Math.floor((now - oldest) / 86400000);
  return days >= 5 ? `1 stale ${days} days` : 'All touched this week';
}
/** The most recent movement in a KPI, or null when there is nothing to compare. */
function movement(latest, previous, field) {
  if (!latest || !previous) return null;
  const a = Number(latest[field]); const b = Number(previous[field]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  const pct = Math.round(((a - b) / Math.abs(b)) * 100);
  if (Math.abs(pct) < 20) return null;
  return `${pct > 0 ? '+' : ''}${pct}% on the previous snapshot`;
}

export default function FounderBuildDesk() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const seed = location.state?.founderBuildSeed;
  const workspace = searchParams.get('mode') === 'workspace';
  const [projects, setProjects] = useState(() => seed?.projects || []);
  const [projectId, setProjectId] = useState(() => seed?.projectId || null);
  const [okrs, setOkrs] = useState(() => seed?.okrs || []);
  const [deals, setDeals] = useState(() => seed?.deals || []);
  const [cards, setCards] = useState(() => seed?.cards ?? null);
  const [snapshots, setSnapshots] = useState(() => seed?.snapshots || []);
  const [summary, setSummary] = useState(() => seed?.summary || null);
  const [state, setState] = useState(() => seed ? 'ready' : 'loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [fillsOn] = useAssistMode('Build');
  // `/projects` is retired (task #101) and this desk inherited the one thing it
  // could do that nothing else can: create a startup. `?new=1` opens the form,
  // because that is how the Command Palette's "Create startup" entry addressed
  // /projects and a <Navigate> redirect cannot carry a query string.
  const [creating, setCreating] = useState(() => searchParams.get('new') === '1');

  useEffect(() => {
    if (workspace) return;
    let alive = true;
    setState(seed ? 'ready' : 'loading');
    Promise.all([api.listProjects(), api.pipelineActive().catch(() => [])]).then(([list, active]) => {
      if (!alive) return;
      const available = list || [];
      const requested = Number(searchParams.get('project_id'));
      const chosen = available.find((item) => item.id === requested) || available.find((item) => item.id === seed?.projectId) || available[0];
      setProjects(available); setDeals(active || []); setProjectId(chosen?.id || null); setError('');
      if (!chosen) setState('ready');
    }).catch((err) => {
      if (!alive) return;
      setError(err?.message || 'The operating records could not be loaded.'); setState('error');
    });
    return () => { alive = false; };
  }, [workspace, reloadKey]);

  useEffect(() => {
    if (!projectId || workspace) return;
    let alive = true;
    setState('loading');
    setSearchParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(projectId)); return next; }, { replace: true });
    Promise.all([
      api.listOkrs(projectId),
      api.listMetricsSnapshots(projectId),
      api.metricsSummary(projectId).catch(() => null),
      // A3 prints a note under each board count. `pipelineActive` returns the
      // counts alone, so the notes need the rows — and this is the same read
      // `/build/board` already makes, not a new surface.
      api.pipelineDealDetail(projectId).catch(() => null),
    ]).then(([roadmap, metrics, metricSummary, detail]) => {
      if (!alive) return;
      setOkrs(roadmap?.okrs || []); setSnapshots(metrics?.snapshots || []); setSummary(metricSummary);
      setCards(detail ? (detail.tasks || []) : null); setState('ready'); setError('');
    }).catch((err) => {
      if (!alive) return;
      setError(err?.message || 'Records for this startup could not be loaded.'); setState('error');
    });
    return () => { alive = false; };
  }, [projectId, workspace, reloadKey]);

  const data = useMemo(() => {
    const now = okrs.filter((item) => item.kanban_status === 'now');
    const commitments = now.flatMap((item) => (item.key_results || []).filter((result) => clean(result.text)).map((result, index) => ({
      id: `${item.id}-${index}`, text: result.text, current: result.current, target: result.target, unit: result.unit,
    })));
    const selectedDeal = deals.find((deal) => Number(deal.id) === Number(projectId));
    const taskCounts = selectedDeal?.task_counts || {};
    // THREE DIFFERENT ABSENCES, AND ONLY ONE OF THEM IS A ZERO.
    //   · Review has no status behind it at all — no count, ever.
    //   · The rows read but this column is empty — that is a real zero.
    //   · The board could not be read — unknown, and a zero here would tell a
    //     founder their board is empty when it is merely unreachable. The old
    //     desk printed `Number(taskCounts.todo) || 0` and made exactly that
    //     claim whenever `pipelineActive` failed, because the failure was
    //     caught into an empty array.
    const board = BOARD_COLUMNS.map(([label, key]) => {
      if (key === null) return { label, key, count: null, note: 'No review state is recorded' };
      const rows = Array.isArray(cards) ? cards.filter((card) => card.status === key) : null;
      if (rows) return { label, key, count: rows.length, note: columnNote(rows, key) };
      // The server's own GROUP BY, when the detail read is the thing that
      // failed: a column missing from a GROUP BY genuinely holds no rows.
      if (selectedDeal) return { label, key, count: Number(taskCounts[key]) || 0, note: 'Card dates are unavailable' };
      return { label, key, count: null, note: 'The board could not be read' };
    });
    const boardTotal = board.reduce((sum, column) => sum + (column.count || 0), 0);
    const roadmap = HORIZONS.map(([status, pill]) => ({
      status, pill, items: okrs.filter((item) => item.kanban_status === status),
    }));
    return { now, commitments, board, boardTotal, roadmap, selectedDeal };
  }, [okrs, deals, cards, projectId]);

  const navigationState = { founderBuildSeed: { projects, projectId, okrs, deals, cards, snapshots, summary } };
  if (workspace) return <ExecutionPage />;
  const query = projectId ? `?project_id=${projectId}` : '';
  const links = Object.fromEntries(SECTIONS.map(([, slug]) => [slug, `/build/${slug}${query}`]));
  const metricsLink = `/build/metrics${query}`;
  // `This week` is the bucket's own entry point and the first chip in the row
  // below, which is what these two controls should offer — not the shared
  // workspace `/execution?mode=workspace` renders.
  const executionLink = links['this-week'];

  return <main className="build-desk" data-testid="founder-build-desk">
    <section className="build-canvas">
      <div className="build-main">
        <header className="build-hero">
          <div className="build-hero-line">
            <div><h1>Operate the company this week</h1><p>Commitments first. Everything else on this page exists to serve the seven days in front of you.</p></div>
            <div className="build-actions">
              <Link data-testid="link-open-execution-workspace" className="build-open" to={executionLink} state={navigationState}>Open this week <ArrowUpRight size={14} /></Link>
            </div>
          </div>
          <CreateStartupForm
            open={creating}
            onOpenChange={(next) => {
              setCreating(next);
              // Drop ?new=1 once the form is closed, so a reload does not
              // reopen it and the back button behaves.
              if (!next && searchParams.get('new') === '1') {
                const params = new URLSearchParams(searchParams);
                params.delete('new');
                setSearchParams(params, { replace: true });
              }
            }}
            onCreated={() => setReloadKey((k) => k + 1)}
          />
          <nav aria-label="Operating desk sections" className="build-anchors">
            {
              // Board was the one pill that never became a link: it fell
              // through to an in-page anchor onto a section of this page,
              // while /build/board sat unreachable from the desk. Pairing each
              // label with its target here, rather than in a five-arm ternary
              // ending in that fallthrough, keeps the pairing a table.
              //
              // These are `//` lines inside the expression rather than a JSX
              // block comment on purpose: `codeOnly` strips whole-line `//`
              // comments and cannot strip `{/* … */}`, so prose here would read
              // to founder_shell's anchor ban as if it were markup.
              SECTIONS.map(([label, slug], index) => (
                <NavLink data-testid={`link-build-anchor-${index}`} key={label} to={links[slug]} className={zonePillClass}>{label}</NavLink>
              ))
            }
          </nav>
        </header>
        {state === 'error' && <div className="build-error" data-testid="status-build-error"><AlertCircle size={16} /> {error} <button data-testid="button-retry-build" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></div>}
        <BuildSections loading={state === 'loading'} hasProjects={projects.length > 0} data={data} snapshots={snapshots} summary={summary} links={links} metricsLink={metricsLink} executionLink={executionLink} navigationState={navigationState} projectId={projectId} fillsOn={fillsOn} onSaved={() => setReloadKey((value) => value + 1)} />
      </div>
      <WorkerRail
        workspace="Build"
        className="build-rail"
        stance="Manual operating view"
        note="This desk reads stored records. It does not move cards, generate plans, or change commitments."
        coverage={[
          `${data.commitments.length} current key result${data.commitments.length === 1 ? '' : 's'}`,
          `${data.boardTotal} stored execution card${data.boardTotal === 1 ? '' : 's'} for this startup`,
        ]}
        action={<Link data-testid="link-rail-open-execution" to={executionLink} state={navigationState}>Open this week <ChevronRight size={14} /></Link>}
      />
    </section>
  </main>;
}

function BuildSections({ loading, hasProjects, data, snapshots, summary, links, metricsLink, executionLink, navigationState, projectId, fillsOn, onSaved }) {
  const latest = snapshots[0];
  const previous = snapshots[1];
  const objectives = data.roadmap.reduce((count, column) => count + column.items.length, 0);
  return <div className="build-sections">
     <section className="build-card build-week" id="build-0"><SectionHead icon={ClipboardCheck} title={`This week · ${dateRange()}`} meta={loading ? 'Reading source records' : `${data.commitments.length} commitment${data.commitments.length === 1 ? '' : 's'} · risk not recorded`} />
      {fillsOn && projectId ? <ZoneDraft
        surface="build/this-week"
        scopeKey={String(projectId)}
        accent="violet"
        label="Proposal · Monday plan"
        run="Draft a Monday plan"
        accept="Accept the plan"
        empty="Nothing proposed yet. Eadwyn will read what actually moved — your current key results and the cards still open — and propose next week's commitments."
        nothingToDraft="There are no current objectives and no open cards to plan from yet."
        foot="Owners and risk are never proposed: neither is recorded."
      /> : null}
      {loading ? <Skeleton rows={4} /> : !hasProjects ? <Empty icon={Target} text="No startup is available to this view yet." detail="Create or select a startup before setting operating commitments." link={executionLink} state={navigationState} /> : data.commitments.length ? <><p className="build-source">Current key results from Now roadmap items. An owner and an at-risk state are not recorded against a key result, so neither is shown.</p><div className="commitments">{data.commitments.map((item) => <div className="commitment" key={item.id}><i /><strong>{item.text}</strong><span>{item.target !== null && item.target !== undefined ? `${item.current ?? 0} / ${item.target}${item.unit ? ` ${item.unit}` : ''}` : 'Progress not recorded'}</span></div>)}</div></> : <Empty icon={ClipboardCheck} text="No current commitments are recorded." detail="This desk does not invent a Monday plan. Add Now OKRs and key results in Roadmap." link={links.roadmap} state={navigationState} />}
       <Link data-testid="link-open-this-week" className="manage-link" to={links['this-week']} state={navigationState}>Open detailed weekly view <ChevronRight size={14} /></Link>
       <Link data-testid="link-manage-roadmap" className="manage-link" to={links.roadmap} state={navigationState}>Manage commitments in Roadmap <ChevronRight size={14} /></Link>
    </section>
    <div className="build-pair">
      <section className="build-card" id="build-1"><SectionHead icon={KanbanSquare} title="Execution board" meta={loading ? 'Reading board' : `${data.boardTotal} card${data.boardTotal === 1 ? '' : 's'}`} />
        {loading ? <Skeleton rows={2} /> : <div className="stage-grid">{data.board.map((column) => <div key={column.label} className={column.key === null ? 'is-unbacked' : undefined}><span>{column.label}</span><strong>{column.count === null ? '—' : column.count}</strong><small>{column.note}</small></div>)}</div>}
        <p className="build-source">Cards are yours. This desk only ever proposes new ones or summarises movement — it never moves a card for you.</p>
        <Link data-testid="link-open-board-workspace" className="manage-link" to={links.board} state={navigationState}>Open detailed board <ChevronRight size={14} /></Link>
      </section>
      <section className="build-card" id="build-2"><SectionHead icon={Route} title="Operating cadence" meta="Not recorded" /><div className="cadence-empty"><Route size={20} /><strong>No operating cadence recorded</strong><p>There is no cadence store connected to this operating desk, so no plan, standup or retro is assumed to exist. Once one is recorded, a Friday retro can be drafted from the board's own history — until then there is no history of a review to draft from.</p></div>
        <Link data-testid="link-open-cadence" className="manage-link" to={links.cadence} state={navigationState}>Open cadence <ChevronRight size={14} /></Link>
      </section>
    </div>
    <section className="build-card" id="build-3"><SectionHead icon={Target} title="Roadmap" meta={loading ? 'Reading roadmap' : `${objectives} objective${objectives === 1 ? '' : 's'} · MVP scope feeds the board above`} />
      {loading ? <Skeleton rows={3} /> : objectives ? <div className="roadmap-list">{data.roadmap.map((column) => <article key={column.status}><div className="roadmap-period"><span>{periodOf(column.items)}</span><b className={`roadmap-pill is-${column.status}`}>{column.pill}</b></div>{column.items.length ? column.items.map((item) => <div className="roadmap-item" key={item.id}><strong>{item.objective}</strong><small>{(item.key_results || []).filter((result) => clean(result.text)).length} key result{(item.key_results || []).filter((result) => clean(result.text)).length === 1 ? '' : 's'}</small></div>) : <small>No objectives recorded</small>}</article>)}</div> : <Empty icon={Target} text="No roadmap items are recorded." detail="Roadmap status comes directly from stored OKRs." link={links.roadmap} state={navigationState} />}
      {fillsOn && projectId ? <ZoneDraft
        surface="build/roadmap"
        scopeKey={String(projectId)}
        accent="violet"
        label="Proposal · tradeoff, reasoned"
        run="Argue the ordering"
        accept="Accept the argument"
        empty="Nothing proposed yet. Eadwyn will read the horizons and quarters you have set and argue the one ordering most worth changing — from the record, not from anything it knows about your market."
        nothingToDraft="There are no objectives to argue an order between yet."
        foot="This writes an argument, never an order. Reordering stays in Roadmap."
      /> : null}
      <Link data-testid="link-edit-roadmap" className="manage-link" to={links.roadmap} state={navigationState}>Edit roadmap <ChevronRight size={14} /></Link>
    </section>
    <section className="build-card" id="build-4"><SectionHead icon={LineChart} title="KPI entry" meta={latest?.snapshot_date ? `Input only — the read lives in the KPI ledger · latest ${latest.snapshot_date}` : 'Input only — the read lives in the KPI ledger'} />
      {loading ? <Skeleton rows={2} /> : <KpiEntry projectId={projectId} latest={latest} previous={previous} summary={summary} onSaved={onSaved} />}
      {fillsOn && projectId ? <ZoneDraft
        surface="build/kpi"
        scopeKey={String(projectId)}
        accent="violet"
        label="Out of range · explain this?"
        run="Draft an annotation"
        accept="Keep this annotation"
        empty="Nothing proposed yet. Eadwyn will name the figure that moved most between your last two snapshots and draft one line about the movement — never about its cause, which nothing here records."
        nothingToDraft="No metric snapshot is recorded for this startup yet."
        foot="Kept as wording only. The snapshot has no annotation field to attach it to."
      /> : null}
         <Link data-testid="link-open-kpi-ledger" className="manage-link" to={links.kpi} state={navigationState}>Open KPI ledger <ChevronRight size={14} /></Link>
         <Link data-testid="link-enter-metrics" className="manage-link" to={metricsLink} state={navigationState}>Enter or review metrics <ChevronRight size={14} /></Link>
    </section>
  </div>;
}

/**
 * A3's KPI card is INPUT, and this desk read it back instead.
 *
 * "Input only — the read lives on Home" is the artboard's own subtitle, and the
 * four boxes it draws are form fields. The desk rendered four read-only figures
 * and two links to somewhere else — so the one thing the zone exists for, a
 * founder putting this month's numbers in without leaving the page, was the one
 * thing it could not do. `POST /api/progress/metrics/:id` has always backed it.
 *
 * RUNWAY IS NOT A FIELD, deliberately. `progress.ts` refuses runway from the
 * client and derives it from cash ÷ burn, "so that the three numbers cannot
 * disagree inside one board pack". A fourth box would invite a founder to type
 * a number the server then ignores.
 */
function KpiEntry({ projectId, latest, previous, summary, onSaved }) {
  const [form, setForm] = useState({ mrr: '', paying_accounts: '', net_burn: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const fields = [
    ['mrr', 'MRR', '$'],
    ['paying_accounts', 'Paid trials', ''],
    ['net_burn', 'Monthly burn', '$'],
  ];
  const save = async () => {
    const entries = Object.entries(form).filter(([, value]) => clean(value) !== '');
    if (!entries.length) { setNote('Enter at least one figure before saving.'); return; }
    setBusy(true); setNote('');
    try {
      await api.createMetricsSnapshot(projectId, Object.fromEntries(entries.map(([key, value]) => [key, Number(value)])));
      setForm({ mrr: '', paying_accounts: '', net_burn: '' });
      setNote('Saved as a new snapshot.');
      onSaved();
    } catch (cause) {
      setNote(cause?.message || 'That snapshot could not be saved.');
    } finally { setBusy(false); }
  };
  return <>
    <div className="kpi-grid">
      {fields.map(([key, label, unit]) => {
        const flag = movement(latest, previous, key);
        return <div key={key} className={flag ? 'is-flagged' : undefined}>
          <span>{label}</span>
          <input
            data-testid={`input-kpi-${key}`}
            inputMode="decimal"
            value={form[key]}
            placeholder={metricValue(latest?.[key], unit)}
            aria-label={`${label} — new value`}
            onChange={(event) => setForm((old) => ({ ...old, [key]: event.target.value }))}
          />
          {flag ? <small className="kpi-flag">{flag}</small> : null}
        </div>;
      })}
      <div className="is-derived"><span>Runway</span><strong>{summary?.runway_months == null ? 'Not recorded' : `${Number(summary.runway_months).toFixed(1)} mo`}</strong><small>Derived from cash and burn — not entered</small></div>
    </div>
    <div className="kpi-actions">
      <button type="button" data-testid="button-save-kpi" disabled={busy || !projectId} onClick={save}>{busy ? 'Saving…' : 'Save snapshot'}</button>
      {note ? <span data-testid="text-kpi-note">{note}</span> : null}
    </div>
    <p className="build-source">Placeholders show the latest stored snapshot. Saving records a new one; nothing here overwrites a figure you already filed.</p>
  </>;
}

/** The quarter a horizon's objectives were filed under, when they agree on one. */
function periodOf(items) {
  const quarters = [...new Set(items.map((item) => clean(item.quarter)).filter(Boolean))];
  if (!quarters.length) return 'Quarter not recorded';
  return quarters.length === 1 ? quarters[0] : `${quarters.length} quarters`;
}
function SectionHead({ icon: Icon, title, meta }) { return <div className="build-section-head"><div><Icon size={16} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Empty({ icon: Icon, text, detail, link, state }) { return <div className="build-empty"><Icon size={21} /><div><strong>{text}</strong><p>{detail}</p>{link && <Link data-testid="link-build-empty-action" to={link} state={state}>Open detailed editor <ChevronRight size={13} /></Link>}</div></div>; }
function Skeleton({ rows }) { return <div className="build-skeleton">{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div>; }

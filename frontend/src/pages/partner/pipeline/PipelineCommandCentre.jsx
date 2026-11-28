import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { partnerPipelineActivityApi } from '../../../lib/api/partnerPipelineActivity';
import { NoPartnerProfile, formatDay, isNoPartnerProfile } from '../kit';
import { Unreadable } from '../../../ui/Honesty';
import { Sheet } from '../../../ui';
import { NotRecorded } from '../../../workspaces/canvasKit';
import {
  ATTENTION_SHOWN, FEED_ALL_LIMIT, MOVEMENT_NONE, MOVEMENT_SHOWN, SETUP_LINKS, allMovementView, attentionItems,
  headlineMetrics, isFirstRun, lifecycleStrip, movementView, ok, railSteps, riskItems, setupSteps, unreadable,
} from './commandCentre';
import OpportunitySheet, { OPPORTUNITY_SOURCES } from './OpportunitySheet';

/**
 * Pipeline · the root, `/pipeline` — D4838 (#4838, part 1), canvas `Pipeline v2` boards PP01, PP01m, PP02, PP02m.
 *
 * TWO STATES, NOT FIVE EMPTY REPORTS. On first run (nothing to score leads against and nothing ever sent) the root
 * is one activation path: "Set up your pipeline", five setup steps derived from the record, Add services and Set
 * fit rules linking to the editors that already exist (Offers › Catalog, Offers › Audience fit), and a lifecycle
 * preview. No $0 won and no 0% win rate. Populated, it is a command centre in the canvas's order: Needs attention,
 * four metrics each with its basis and How calculated, the lifecycle strip, Recent movement (D5942's recorded
 * lifecycle feed, newest first: D4838 part 9, #5943) and Risks. The rules are `commandCentre.js`'s, so the page and its tests agree.
 *
 * Every read is the zones' own; this page adds no route. A read that fails is Unreadable where it would have been
 * drawn, never a zero, and never a reason to call the pipeline empty.
 *
 * #9110 (D9110, PP-6): a Recent movement row whose event names a need opens the shared `OpportunitySheet` on its
 * Activity tab, and See all opens the whole recorded feed (up to the Worker's 200) in an All movement sheet on
 * this same address. One sheet is open at a time.
 */

const SOURCES = {
  leads: () => api.listPartnerLeads(),
  proposals: () => api.listPartnerProposals(),
  negotiations: () => api.listPartnerNegotiations(),
  retainers: () => api.listPartnerRetainers(),
  analytics: () => api.quotesAnalytics(),
  fitRules: () => api.listPartnerFitRules(),
  services: () => api.listServiceOfferings({ mine: 1 }),
  // D4838 part 9 (#5943): Recent movement is the recorded lifecycle feed, never derived on this page.
  activity: () => partnerPipelineActivityApi.list({ limit: MOVEMENT_SHOWN }),
};

/** Every read, settled; a failed one is `unreadable`, and "no partner profile" is said once. */
export async function readPipeline(sources = SOURCES) {
  const keys = Object.keys(sources);
  const settled = await Promise.allSettled(keys.map((k) => sources[k]()));
  const out = {};
  let noProfile = false;
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') out[keys[i]] = ok(s.value);
    else {
      if (isNoPartnerProfile(s.reason?.message)) noProfile = true;
      out[keys[i]] = unreadable();
    }
  });
  return { sources: out, noProfile };
}

/** Everything the page draws, from one set of reads. */
export function pipelineView(sources) {
  const firstRun = isFirstRun(sources);
  const steps = setupSteps(sources);
  const attention = firstRun ? [] : attentionItems(sources);
  const core = ['leads', 'proposals', 'negotiations', 'retainers'];
  const failed = core.every((k) => sources[k]?.state !== 'ok');
  return {
    firstRun, steps, attention, failed,
    metrics: headlineMetrics(sources),
    lifecycle: lifecycleStrip(sources),
    risks: riskItems(sources),
    movement: movementView(sources.activity),
    scoringNote: sources.leads?.state === 'ok' ? sources.leads.data?.scoring_note || null : null,
  };
}

const card = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const h2 = 'm-0 text-[15px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100';
const primaryBtn = 'inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[#b45309] px-4 text-[14px] font-bold text-white hover:bg-[#92400e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b45309] sm:w-auto';
const secondaryBtn = 'inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-[#fde68a] bg-[#fffbf2] px-4 text-[14px] font-bold text-[#92400e] hover:border-[#b45309] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b45309] sm:w-auto dark:border-amber-900 dark:bg-[#2b210d] dark:text-amber-300';

const LIFE = [
  ['Lead', 'A founder need this firm could serve, scored against your own fit rules.'],
  ['Proposal', 'What you offered, its price and scope, and what happened after you sent it.'],
  ['Negotiation', 'The live discussion: the one open question and who owes the next move.'],
  ['Retainer', 'Recurring work: usage against scope and when it renews.'],
];

function StepMark({ done, index }) {
  if (done === true) return <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-[12px] font-bold text-white">✓</span>;
  return (
    <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-axal-hairline text-[12px] font-bold text-axal-muted dark:border-gray-700 dark:text-gray-400">
      {index + 1}
    </span>
  );
}

/** PP01 / PP01m — the activation path. */
export function FirstRun({ steps, scoringNote }) {
  const doneCount = steps.filter((s) => s.done === true).length;
  return (
    <div className="flex flex-col gap-4" data-testid="pipeline-first-run">
      <section className={card} aria-labelledby="pl-setup-h">
        <h2 id="pl-setup-h" className={h2}>Setup progress</h2>
        <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-axal-muted dark:text-gray-400">
          Pipeline matches founder needs against what this firm actually does. Define the firm’s services and fit rules
          before Axal scores opportunities.
        </p>
        <ol className="mt-3 flex list-none flex-col gap-2 p-0" aria-label={`Setup progress, ${doneCount} of ${steps.length} done`}>
          {steps.map((s, i) => (
            <li key={s.key} className="flex min-h-[32px] items-center gap-2.5 text-[14px] text-axal-ink dark:text-gray-100" data-testid={`pipeline-setup-${s.key}`} data-done={String(s.done)}>
              <StepMark done={s.done} index={i} />
              <span className={s.done === true ? 'font-semibold' : ''}>{s.label}</span>
              {s.done === true && <span className="sr-only"> — done</span>}
              {s.done === null && <NotRecorded>Not confirmed</NotRecorded>}
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Link to={SETUP_LINKS.services} className={primaryBtn} data-testid="pipeline-setup-add-services">Add services</Link>
          <Link to={SETUP_LINKS.rules} className={secondaryBtn} data-testid="pipeline-setup-fit-rules">Set fit rules</Link>
        </div>
        {scoringNote && (
          <details className="mt-3 text-[13px] text-axal-muted dark:text-gray-400">
            <summary className="cursor-pointer font-semibold text-[#92400e] dark:text-amber-300">How lead matching works</summary>
            <p className="mt-1.5 max-w-2xl leading-relaxed">{scoringNote}</p>
          </details>
        )}
      </section>

      <section aria-labelledby="pl-life-h" className="flex flex-col gap-2">
        <h2 id="pl-life-h" className="m-0 text-[12px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">How work moves here</h2>
        <ol className="grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {LIFE.map(([stage, line], i) => (
            <li key={stage} className={card}>
              <span className="text-[14px] font-extrabold text-axal-ink dark:text-gray-100">
                {i > 0 && <span aria-hidden="true" className="mr-1 text-axal-muted">→</span>}{stage}
              </span>
              <p className="mt-1 text-[13px] leading-relaxed text-axal-muted dark:text-gray-400">{line}</p>
            </li>
          ))}
        </ol>
      </section>

      <ExploreDemand />
    </div>
  );
}

function ExploreDemand() {
  return (
    <section className={card} aria-labelledby="pl-demand-h" data-testid="pipeline-explore-demand">
      <h2 id="pl-demand-h" className="m-0 text-[12px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">Explore demand</h2>
      <p className="mt-1 text-[14px] font-bold text-axal-ink dark:text-gray-100">Demand Insights</p>
      <p className="mt-0.5 text-[13px] text-axal-muted dark:text-gray-400">See where founder demand is concentrated before changing your offers or fit rules.</p>
      <Link to={SETUP_LINKS.demand} className="mt-2 inline-flex min-h-[44px] items-center text-[13.5px] font-bold text-[#92400e] underline dark:text-amber-300">Open Demand Insights →</Link>
    </section>
  );
}

function Metric({ m }) {
  return (
    <div className={card} data-testid={`pipeline-metric-${m.label.toLowerCase().replace(/\s+/g, '-')}`} data-state={m.state}>
      <span className="text-[12px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">{m.label}</span>
      <div className="mt-1 min-h-[28px]">
        {m.state === 'value' && <span className="font-mono text-[22px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{m.value}</span>}
        {m.state === 'none' && <span className="text-[15px] font-bold text-axal-ink dark:text-gray-100">{m.value}</span>}
        {m.state === 'unreadable' && <Unreadable what={m.label} claim="It is unknown, not zero." />}
      </div>
      {m.basis && <p className="mt-0.5 text-[12px] text-axal-muted dark:text-gray-400">{m.basis}</p>}
      {m.how && (
        <details className="mt-1.5 text-[12px] text-axal-muted dark:text-gray-400">
          <summary className="cursor-pointer font-semibold">How calculated</summary>
          <p className="mt-1 leading-relaxed">{m.how}</p>
        </details>
      )}
    </div>
  );
}

function Attention({ items }) {
  const shown = items.slice(0, ATTENTION_SHOWN);
  return (
    <section aria-labelledby="pl-attn-h" className="flex flex-col gap-2.5" data-testid="pipeline-attention">
      <div className="flex items-baseline gap-2">
        <h2 id="pl-attn-h" className="m-0 text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Needs attention</h2>
        <span className="text-[13px] text-axal-muted dark:text-gray-400">{items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'nothing right now'}</span>
      </div>
      {shown.length ? (
        <ul className="grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((a) => (
            <li key={a.key} className="flex flex-col gap-1 rounded-xl border border-[#fde68a] bg-[#fffbf2] p-3.5 dark:border-amber-900 dark:bg-[#2b210d]" data-testid={`pipeline-attention-${a.key}`}>
              <span className="text-[14px] font-extrabold text-axal-ink dark:text-gray-100">{a.who}</span>
              <span className="text-[13.5px] font-semibold text-[#92400e] dark:text-amber-300">{a.issue}</span>
              {a.detail && <span className="text-[12.5px] text-axal-muted dark:text-gray-400">{a.detail}</span>}
              <Link to={a.to} className="mt-1.5 inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#b45309] px-3 text-[13.5px] font-bold text-[#92400e] hover:bg-white sm:self-start dark:text-amber-300 dark:hover:bg-gray-900">
                {a.action}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[13.5px] text-axal-muted dark:text-gray-400">No negotiation waits on us, no retainer is over scope or due within 30 days, and no quote has gone a week without a recorded reply.</p>
      )}
      {items.length > shown.length && (
        <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{`${items.length - shown.length} more in the zones below.`}</p>
      )}
    </section>
  );
}

function Lifecycle({ cells }) {
  return (
    <section aria-labelledby="pl-lc-h" className="flex flex-col gap-2" data-testid="pipeline-lifecycle">
      <h2 id="pl-lc-h" className="m-0 text-[12px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">Lifecycle</h2>
      {/* Phone: one row that scrolls sideways (PP02m); desktop: four cells. */}
      <ol className="-mx-1 flex list-none snap-x gap-2 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
        {cells.map((c, i) => (
          <li key={c.key} className="min-w-[160px] snap-start md:min-w-0">
            <Link to={c.to} className={`${card} flex min-h-[44px] flex-col hover:border-[#b45309]`}>
              <span className="text-[13px] font-bold text-axal-muted dark:text-gray-400">
                {i > 0 && <span aria-hidden="true" className="mr-1">→</span>}{c.label}
              </span>
              {c.state === 'ok' ? (
                <>
                  <span className="font-mono text-[22px] font-extrabold text-axal-ink dark:text-gray-100">{c.count}</span>
                  <span className="text-[12px] text-axal-muted dark:text-gray-400">{c.sub}</span>
                </>
              ) : <span className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">Unreadable</span>}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

const movementGrid = 'grid grid-cols-[88px_minmax(0,1fr)] gap-2 text-[13.5px]';

/**
 * One event. With a need it is a 44px button that opens that opportunity's sheet (#9110); without one it is the
 * same line as plain text, because there is nothing to open.
 */
function MovementRow({ e, onOpen, testId }) {
  const inner = (
    <>
      <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{formatDay(e.at)}</span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <b className="text-axal-ink dark:text-gray-100">{e.text}</b>
        {e.who ? <span className="text-axal-muted dark:text-gray-400"> · {e.who}</span> : null}
      </span>
    </>
  );
  if (e.needId == null || !onOpen) return <li className={`${movementGrid} py-1`} data-testid={testId}>{inner}</li>;
  return (
    <li data-testid={testId}>
      <button type="button" onClick={() => onOpen(e)} data-testid={`${testId}-open`} data-need-id={e.needId} title="Open opportunity"
        className={`${movementGrid} min-h-[44px] w-full items-center rounded-lg px-2 text-left hover:bg-[#fffbf2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#b45309] dark:hover:bg-[#2b210d]`}>
        {inner}
      </button>
    </li>
  );
}

/** Recent movement (D4838 part 9, #5943): the feed's recorded events, newest first, each with its opportunity. */
function Movement({ movement, onOpen, onSeeAll }) {
  const rows = movement?.state === 'ok' ? movement.rows : [];
  return (
    <section className={card} aria-labelledby="pl-move-h" data-testid="pipeline-movement" data-state={movement?.state || 'unreadable'}>
      <h2 id="pl-move-h" className={h2}>Recent movement</h2>
      {movement?.state !== 'ok' ? (
        <p className="mt-1.5 text-[13px] font-semibold text-red-700 dark:text-red-300" data-testid="pipeline-movement-unreadable">
          Unreadable. The lifecycle feed could not be read; this is not evidence that nothing moved.
        </p>
      ) : rows.length ? (
        <>
          <ul className="mt-2 flex list-none flex-col gap-0.5 p-0" data-testid="pipeline-movement-list">
            {rows.map((e) => <MovementRow key={e.key} e={e} onOpen={onOpen} testId={`pipeline-movement-row-${e.key}`} />)}
          </ul>
          {onSeeAll && (
            <button type="button" onClick={onSeeAll} data-testid="pipeline-movement-see-all"
              className="mt-1.5 inline-flex min-h-[44px] items-center text-[13.5px] font-bold text-[#92400e] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#b45309] dark:text-amber-300">
              See all
            </button>
          )}
        </>
      ) : (
        <p className="mt-1.5 text-[13px] text-axal-muted dark:text-gray-400" data-testid="pipeline-movement-none">
          {MOVEMENT_NONE}
        </p>
      )}
    </section>
  );
}

/** The All movement sheet's read: the whole feed the Worker will return, newest first. */
export const ALL_MOVEMENT_SOURCE = () => partnerPipelineActivityApi.list({ limit: FEED_ALL_LIMIT });

/** All movement's body, from `allMovementView`: a skeleton, Unreadable with Try again, nothing moved, or the rows. */
export function AllMovementList({ view, onOpen, onRetry }) {
  if (view.state === 'loading') {
    return (
      <div aria-busy="true" className="grid gap-2" data-testid="pipeline-all-movement-loading">
        <span className="sr-only">Reading the lifecycle feed…</span>
        {[0, 1, 2, 3, 4].map((i) => <span key={i} className="h-6 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />)}
      </div>
    );
  }
  if (view.state !== 'ok') {
    return (
      <div className="grid gap-2" data-testid="pipeline-all-movement-unreadable">
        <p className="m-0 text-[13px] font-semibold text-red-700 dark:text-red-300">
          Unreadable. The lifecycle feed could not be read; this is not evidence that nothing moved.
        </p>
        {onRetry && (
          <button type="button" onClick={onRetry} data-testid="pipeline-all-movement-retry"
            className="inline-flex min-h-[44px] items-center justify-self-start rounded-lg border border-axal-hairline bg-white px-3 text-[13px] font-bold text-axal-ink hover:border-[#b45309] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
            Try again
          </button>
        )}
      </div>
    );
  }
  if (!view.rows.length && !view.capped) {
    return <p className="m-0 text-[13px] text-axal-muted dark:text-gray-400" data-testid="pipeline-all-movement-none">{MOVEMENT_NONE}</p>;
  }
  return (
    <div className="grid gap-2">
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0" data-testid="pipeline-all-movement-list">
        {view.rows.map((e) => <MovementRow key={e.key} e={e} onOpen={onOpen} testId={`pipeline-all-movement-row-${e.key}`} />)}
      </ul>
      {view.capped && (
        <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="pipeline-all-movement-capped">
          {`Showing the latest ${FEED_ALL_LIMIT} events.`} Older events may be recorded and are not listed here.
        </p>
      )}
    </div>
  );
}

const SHEET_SOURCES = { opportunity: OPPORTUNITY_SOURCES, feed: ALL_MOVEMENT_SOURCE };

/** See all (#9110): the recorded feed in a sheet on `/pipeline`, not a page. The canvas draws no such list. */
export function AllMovementSheet({ onClose, onOpen, source = ALL_MOVEMENT_SOURCE }) {
  const [read, setRead] = useState({ state: 'loading' });
  const gen = useRef(0);
  const load = useCallback(async () => {
    const mine = ++gen.current;
    setRead({ state: 'loading' });
    try {
      const data = await source();
      if (mine === gen.current) setRead(ok(data));
    } catch {
      if (mine === gen.current) setRead(unreadable());
    }
  }, [source]);
  useEffect(() => { load(); return () => { gen.current += 1; }; }, [load]);
  return (
    <Sheet title="All movement" eyebrow="Pipeline" sub="Recorded lifecycle events, newest first." onClose={onClose}
      width={560} phone="full" testId="pipeline-all-movement">
      <div className="px-5 py-4">
        <AllMovementList view={allMovementView(read)} onOpen={onOpen} onRetry={load} />
      </div>
    </Sheet>
  );
}

function Risks({ items }) {
  return (
    <section className={card} aria-labelledby="pl-risk-h" data-testid="pipeline-risks">
      <h2 id="pl-risk-h" className={h2}>Risks</h2>
      {items.length ? (
        <ul className="mt-2 flex list-none flex-col gap-1.5 p-0">
          {items.map((r) => (
            <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13.5px]">
              <span><b className="text-axal-ink dark:text-gray-100">{r.who}</b> <span className="text-axal-muted dark:text-gray-400">· {r.text}</span></span>
              <span className="rounded-full border border-axal-hairline px-2 py-0.5 text-[11.5px] font-bold text-axal-muted dark:border-gray-700 dark:text-gray-400">{r.tag}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-1.5 text-[13px] text-axal-muted dark:text-gray-400">No renewal inside 30 days, no scope overrun and nothing stalled for a week.</p>}
    </section>
  );
}

/**
 * PP02 / PP02m — the populated command centre. It holds which sheet is open: one opportunity (from a movement row)
 * or All movement, never both. A row in All movement closes that sheet and opens the opportunity's. `sheetSources`
 * is the two sheets' reads, for a test.
 */
export function CommandCentre({ view, sheetSources = SHEET_SOURCES }) {
  const [sheet, setSheet] = useState(null);
  const openOpportunity = useCallback((e) => setSheet({ kind: 'opportunity', needId: e.needId, title: e.who }), []);
  const close = useCallback(() => setSheet(null), []);
  return (
    <div className="flex flex-col gap-4" data-testid="pipeline-command-centre">
      <Attention items={view.attention} />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" data-testid="pipeline-metrics">
        {view.metrics.map((m) => <Metric key={m.label} m={m} />)}
      </div>
      <Lifecycle cells={view.lifecycle} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* See all is drawn only over an answered feed with rows: Movement decides, from the same view. */}
        <Movement movement={view.movement} onOpen={openOpportunity} onSeeAll={() => setSheet({ kind: 'all' })} />
        <Risks items={view.risks} />
      </div>
      <ExploreDemand />
      {sheet?.kind === 'all' && <AllMovementSheet onClose={close} onOpen={openOpportunity} source={sheetSources.feed} />}
      {sheet?.kind === 'opportunity' && (
        <OpportunitySheet opportunity={{ needId: sheet.needId }} title={sheet.title || undefined} initialTab="Activity" onClose={close}
          sources={sheetSources.opportunity} />
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" data-testid="pipeline-loading">
      <span className="sr-only">Reading the pipeline…</span>
      {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />)}
    </div>
  );
}

/**
 * The root. `onView` tells the route which state is showing, so the shell's title and the Eadwyn rail's steps
 * follow it (first run: "Set up your pipeline"; populated: "Win the work").
 */
export default function PipelineCommandCentre({ onView }) {
  const [read, setRead] = useState(null);
  const gen = useRef(0);
  const load = useCallback(async () => {
    const mine = ++gen.current;
    const r = await readPipeline();
    if (mine === gen.current) setRead(r);
  }, []);
  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => (read && !read.noProfile ? pipelineView(read.sources) : null), [read]);

  useEffect(() => {
    if (!onView) return;
    if (!read) { onView({ firstRun: false, rail: railSteps({ loading: true }) }); return; }
    if (!view) { onView({ firstRun: false, rail: railSteps({ failed: true }) }); return; }
    onView({ firstRun: view.firstRun, rail: { ...railSteps(view), onRetry: view.failed ? load : undefined } });
  }, [read, view, onView, load]);

  if (!read) return <Skeleton />;
  if (read.noProfile) return <NoPartnerProfile />;
  if (view.failed) {
    return (
      <div className={card} data-testid="pipeline-unreadable">
        <Unreadable what="Pipeline" claim="This is not evidence of an empty pipeline." onRetry={load} />
      </div>
    );
  }
  return view.firstRun
    ? <FirstRun steps={view.steps} scoringNote={view.scoringNote} />
    : <CommandCentre view={view} />;
}

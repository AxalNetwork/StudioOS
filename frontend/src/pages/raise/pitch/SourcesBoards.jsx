import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { deckSourcesApi } from '../../../lib/api/deckSources';
import { reportError } from '../../../lib/log';
import { Lightbox } from '../../../ui';
import {
  GRADES, LEGEND_GRADES, LEGEND_LEAD, LEGEND_NOTE, LEGEND_SOURCES, LEGEND_TITLE, METER_EMPTY, METER_ERROR,
  METER_LOADING, METER_SUB, changedSince, chipOf, fillLink, gapLine, groupSources, meterOf, missingRows, scorecardDialog, valueText,
} from './sourcesModel';

/**
 * D896 (#2675, part 2 of #2434) — the deck's sources, built to the "Pitch Deck
 * Studio" canvas:
 *
 *   PD4   SourcesStep      New deck › step 2: every record by area, the meter
 *                          and what is missing. Part 3 mounts it in New deck.
 *   PD10  SourcesPanel     the editor's Sources panel: search, grade filter,
 *                          Stale only, Show [n] more, the dashed missing row,
 *                          and the Scoring rows with their dialog. Part 4
 *                          mounts it beside the editor.
 *   PD10b SourcesLegend    how sources and grades work.
 *   PD11  CoverageMeter    S, M and L; full, partial, empty, loading, error.
 *
 * Every value comes from `GET /api/decks/sources`; nothing here is a sample.
 * Choosing which records feed a deck (PD4's boxes) and including a band are
 * the caller's state: this file writes nothing.
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const MONO = 'font-mono tabular-nums';
const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep disabled:opacity-50`;
const LINK = 'text-[12px] font-bold text-axal-violet hover:underline dark:text-violet-300';
const PILL = 'inline-flex min-h-[28px] items-center rounded-full border px-2.5 text-[11px] font-bold';
const PILL_ON = `${PILL} border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300`;
const PILL_OFF = `${PILL} border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400`;

/** The violet ramp, strongest first; Not recorded is a dashed outline (PD11). */
const GRADE_FILL = {
  Measured: 'bg-[#7c3aed]',
  Reviewed: 'bg-[#9b6cf0]',
  Sourced: 'bg-[#b99cf5]',
  Stated: 'bg-[#d8c9fa]',
};
const GAP = 'border border-dashed border-axal-muted dark:border-gray-500';
const SOURCE_TEXT = {
  Connector: 'text-axal-violet dark:text-violet-300',
  Document: 'text-sky-600 dark:text-sky-400',
  Recorded: 'text-amber-600 dark:text-amber-400',
  Signed: 'text-emerald-600 dark:text-emerald-400',
  Typed: 'text-axal-muted dark:text-gray-400',
};
const HEIGHT = { S: 'h-1.5', M: 'h-2.5', L: 'h-4' };

export function GradeDot({ grade, size = 'h-2 w-2' }) {
  const fill = GRADE_FILL[grade];
  return <span aria-hidden="true" className={`inline-block ${size} flex-none rounded-[2px] ${fill || GAP}`} />;
}

/** The chip under a figure: source, record, date and grade; it explains itself on hover. */
export function SourceChip({ item }) {
  const c = chipOf(item);
  if (!c) return null;
  return (
    <span title={c.title} className={`inline-flex flex-wrap items-center gap-1 font-mono text-[10.5px] font-medium ${MUTED}`} data-testid={`source-chip-${item.source_key}`}>
      <span className={`font-bold ${SOURCE_TEXT[c.source] || ''}`}>{c.icon} {c.source}</span>
      <span>· {c.record}</span>
      {c.date ? <span>· {c.date}</span> : null}
      <span className="inline-flex items-center gap-1">· <GradeDot grade={c.grade} />{c.grade}</span>
    </span>
  );
}

/**
 * PD11: the 100% bar split by grade, dashed for Not recorded. `status` is the
 * read's: `loading` and `error` draw no counts at all.
 */
export function CoverageMeter({ coverage, status = 'ok', size = 'M', onRetry, legend = false, label = true }) {
  const meter = status === 'ok' ? meterOf(coverage) : null;
  const bar = `flex ${HEIGHT[size] || HEIGHT.M} w-full gap-px overflow-hidden rounded-full`;
  return (
    <div className="flex flex-col gap-1.5" data-testid="coverage-meter" data-state={status === 'ok' ? (meter?.state || 'error') : status}>
      {label ? (
        <div className={`flex justify-between gap-2 text-[11.5px] ${MUTED}`}>
          <span>Data coverage</span>
          <span className={MONO}>{status === 'loading' ? METER_LOADING : meter ? meter.short : METER_ERROR}</span>
        </div>
      ) : null}
      {status === 'loading' ? (
        <div className={`${bar} animate-pulse bg-axal-hairline dark:bg-gray-800`} aria-label={METER_LOADING} role="img" />
      ) : !meter ? (
        <div className={`flex min-h-[28px] items-center justify-between gap-2 rounded-[9px] border border-axal-hairline px-2 text-[11px] dark:border-gray-700 ${MUTED}`} role="alert">
          <span>{METER_ERROR}</span>
          {onRetry ? <button type="button" className={LINK} onClick={onRetry}>Try again</button> : null}
        </div>
      ) : meter.state === 'empty' ? (
        <div className={`${bar} ${GAP}`} role="img" aria-label={meter.label} />
      ) : (
        <div className={bar} role="img" aria-label={`${meter.label}: ${meter.segments.map((s) => `${s.n} ${s.key}`).join(', ')}`}>
          {meter.segments.filter((s) => s.n > 0).map((s) => (
            <span key={s.key} style={{ flex: s.n }} className={GRADE_FILL[s.key] || `${GAP} rounded-[2px] box-border`} />
          ))}
        </div>
      )}
      {legend && meter ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {meter.segments.map((s) => (
            <li key={s.key} className="flex justify-between text-[12px]">
              <span className={`flex items-center gap-1.5 ${INK}`}><GradeDot grade={s.key} size="h-2.5 w-2.5" />{s.key}</span>
              <span className={`${MONO} ${INK}`}>{s.n}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** PD10b: the five sources and the five grades, one line each. */
export function SourcesLegend({ onClose }) {
  return (
    <Lightbox label={LEGEND_TITLE} title={LEGEND_TITLE} onClose={onClose} width={640} testId="sources-legend"
      footer={<div className="flex justify-end"><button type="button" className={PRIMARY} onClick={onClose}>Close</button></div>}>
      <div className="flex flex-col gap-4">
        <p className={`m-0 text-[13px] leading-[1.55] ${INK}`}>{LEGEND_LEAD}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className={`font-mono text-[10px] font-bold uppercase tracking-[.07em] ${MUTED}`}>Sources · where it came from</span>
            {LEGEND_SOURCES.map((s) => (
              <div key={s.id} className="flex gap-2 text-[12.5px] leading-[1.45]">
                <span className={`min-w-[96px] font-bold ${SOURCE_TEXT[s.id]}`}>{s.icon} {s.id}</span>
                <span className={MUTED}>{s.line}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <span className={`font-mono text-[10px] font-bold uppercase tracking-[.07em] ${MUTED}`}>Grades · how strong it is</span>
            {LEGEND_GRADES.map((g) => (
              <div key={g.id} className="flex items-baseline gap-2 text-[12.5px] leading-[1.45]">
                <GradeDot grade={g.id} size="h-2.5 w-2.5" />
                <span className={INK}><b>{g.id}</b> <span className={MUTED}>{g.line}</span></span>
              </div>
            ))}
          </div>
        </div>
        <div className={`rounded-[10px] border border-axal-hairline bg-axal-ground px-3 py-2.5 text-[12px] leading-[1.5] dark:border-gray-700 dark:bg-gray-800 ${MUTED}`}>{LEGEND_NOTE}</div>
      </div>
    </Lightbox>
  );
}

/** PD10's dialog: what investors would see if the band went on this deck, never the number. */
export function ScorecardDialog({ item, onKeepOff, onInclude }) {
  const d = scorecardDialog(item);
  return (
    <Lightbox label={d.title} title={d.title} onClose={onKeepOff} width={520} testId="scorecard-dialog"
      footer={(
        <div className="flex justify-end gap-1.5">
          <button type="button" className={GHOST} onClick={onKeepOff}>{d.keepOff}</button>
          <button type="button" className={PRIMARY} onClick={onInclude} disabled={!d.canInclude}>{d.include}</button>
        </div>
      )}>
      <p className={`m-0 text-[13px] leading-[1.55] ${INK}`}>{d.body}</p>
    </Lightbox>
  );
}

/** The reads every board here shares: the items, the coverage, and Try again. */
export function useDeckSources(projectId, { includeScoring = false } = {}) {
  const [state, setState] = useState({ status: projectId ? 'loading' : 'idle', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!projectId) { setState({ status: 'idle', data: null }); return undefined; }
    let live = true;
    setState({ status: 'loading', data: null });
    deckSourcesApi.list(projectId, { includeScoring }).then(
      (data) => { if (live) setState({ status: 'ok', data }); },
      (e) => { if (live) setState({ status: 'error', data: null }); reportError('pitch-studio:sources', e); },
    );
    return () => { live = false; };
  }, [projectId, includeScoring, tick]);
  const retry = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, retry };
}

function ScoringToggle({ item, on, onToggle }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={`Include ${item.label}`} onClick={onToggle}
      className={`relative h-[18px] w-[30px] flex-none rounded-full ${on ? 'bg-axal-violet' : 'bg-axal-hairline dark:bg-gray-700'}`}>
      <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white dark:bg-gray-100 ${on ? 'left-[14px]' : 'left-[2px]'}`} />
    </button>
  );
}

/** One source row: label and value, the chip, or the dashed gap with its module link. */
function SourceRow({ item, stale, scoringOn, onScoring }) {
  const value = valueText(item);
  const gap = gapLine(item);
  const dashed = item.state !== 'recorded' && !item.optional;
  return (
    <li className={`flex flex-col gap-1.5 px-3 py-2 ${dashed ? 'mx-3 my-1 rounded-[8px] border border-dashed border-axal-hairline dark:border-gray-700' : ''}`} data-testid={`source-row-${item.source_key}`}>
      <div className="flex justify-between gap-2 text-[12.5px]">
        <span className={`font-semibold ${INK}`}>{item.label}</span>
        <span className={`${MONO} ${INK}`}>{item.optional ? (scoringOn ? 'On' : 'Off') : value}</span>
      </div>
      {item.optional ? (
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[11.5px] ${MUTED}`}>{value || gap}</span>
          <ScoringToggle item={item} on={scoringOn} onToggle={() => onScoring?.(item)} />
        </div>
      ) : value ? (
        <SourceChip item={item} />
      ) : (
        <span className={`text-[11.5px] ${MUTED}`}>
          {gap}{item.state === 'not_recorded' ? <> · <Link to={fillLink(item).href} className={LINK}>{fillLink(item).text}</Link></> : null}
        </span>
      )}
      {stale ? <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">{changedSince(stale)}</span> : null}
    </li>
  );
}

const GRADE_FILTERS = ['all', ...GRADES, 'Not recorded'];

/**
 * PD10: the editor's Sources panel. `stale` is the refresh read's stale
 * bindings (`staleKeys`: key → the binding), `scoring` the bands the founder includes on this version.
 */
export function SourcesPanel({ items = [], status = 'ok', onRetry, stale = new Map(), scoring = new Set(), onScoringChange }) {
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('all');
  const [staleOnly, setStaleOnly] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [legend, setLegend] = useState(false);
  const [asking, setAsking] = useState(null);
  const groups = useMemo(() => groupSources(items, { search, grade, staleOnly, stale, expanded }), [items, search, grade, staleOnly, stale, expanded]);
  const toggle = (item) => {
    if (scoring.has(item.source_key)) { const next = new Set(scoring); next.delete(item.source_key); onScoringChange?.(next); }
    else setAsking(item);
  };
  return (
    <section className="flex min-h-0 flex-col" aria-label="Sources" data-testid="sources-panel">
      <div className="flex flex-col gap-2 border-b border-axal-hairline px-3 py-2.5 dark:border-gray-700">
        <label className="relative block">
          <span className="sr-only">Search sources</span>
          <Search size={14} aria-hidden="true" className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${MUTED}`} />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search sources"
            className="min-h-[36px] w-full rounded-[7px] border border-axal-hairline bg-white pl-8 pr-2.5 text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="sr-only" htmlFor="sources-grade">Grade</label>
          <select id="sources-grade" value={grade} onChange={(e) => setGrade(e.target.value)} className={`${grade === 'all' ? PILL_OFF : PILL_ON} pr-1`}>
            {GRADE_FILTERS.map((g) => <option key={g} value={g}>{g === 'all' ? 'All grades' : g}</option>)}
          </select>
          <button type="button" aria-pressed={staleOnly} className={staleOnly ? PILL_ON : PILL_OFF} onClick={() => setStaleOnly((v) => !v)}>Stale only</button>
          <button type="button" className={`${LINK} ml-auto min-h-[28px]`} onClick={() => setLegend(true)}>How sources and grades work ›</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {status === 'loading' ? (
          <div className="flex flex-col gap-2 p-3" aria-hidden="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800" />)}</div>
        ) : status === 'error' ? (
          <div className="flex flex-col items-start gap-2 p-3" role="alert">
            <span className={`text-[12.5px] font-bold ${INK}`}>Sources could not be read.</span>
            {onRetry ? <button type="button" className={GHOST} onClick={onRetry}><RefreshCw size={14} aria-hidden="true" /> Try again</button> : null}
          </div>
        ) : !groups.length ? (
          <p className={`m-0 p-3 text-[12.5px] ${MUTED}`}>No source matches.</p>
        ) : groups.map((g) => (
          <div key={g.id} className="border-b border-axal-hairline pb-1 last:border-b-0 dark:border-gray-700" data-testid={`sources-group-${g.id}`}>
            <div className={`px-3 pb-0.5 pt-2 font-mono text-[9.5px] font-semibold uppercase tracking-[.07em] ${MUTED}`}>{g.label}</div>
            {g.note ? <p className={`m-0 px-3 text-[11px] ${MUTED}`}>{g.note}</p> : null}
            <ul className="m-0 list-none p-0">
              {g.items.map((it) => <SourceRow key={it.source_key} item={it} stale={stale.get(it.source_key)} scoringOn={scoring.has(it.source_key)} onScoring={toggle} />)}
            </ul>
            {g.more ? (
              <button type="button" className={`${LINK} min-h-[32px] px-3`} onClick={() => setExpanded((s) => new Set([...s, g.id]))}>{g.more} ▾</button>
            ) : null}
          </div>
        ))}
      </div>
      {legend ? <SourcesLegend onClose={() => setLegend(false)} /> : null}
      {asking ? (
        <ScorecardDialog item={asking} onKeepOff={() => setAsking(null)}
          onInclude={() => { onScoringChange?.(new Set([...scoring, asking.source_key])); setAsking(null); }} />
      ) : null}
    </section>
  );
}

/**
 * PD4: New deck › Sources and coverage. Every recorded item starts chosen;
 * `onChange(keys)` hands the chosen keys to the flow that mounts this (part 3),
 * and `onContinue` moves it to the outline.
 */
export function SourcesStep({ items = [], coverage, status = 'ok', onRetry, onChange, onContinue }) {
  const recorded = useMemo(() => items.filter((it) => it.state === 'recorded' && !it.optional).map((it) => it.source_key), [items]);
  const [chosen, setChosen] = useState(() => new Set(recorded));
  const [expanded, setExpanded] = useState(() => new Set());
  useEffect(() => { setChosen(new Set(recorded)); }, [recorded]);
  useEffect(() => { onChange?.([...chosen]); }, [chosen, onChange]);
  const groups = useMemo(() => groupSources(items, { expanded }), [items, expanded]);
  const missing = missingRows(items);
  const flip = (key) => setChosen((s) => { const next = new Set(s); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const meter = meterOf(coverage);
  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_360px]" data-testid="sources-step">
      <div className="flex min-w-0 flex-col gap-3.5">
        {status === 'error' ? (
          <div className={`${CARD} flex flex-col items-start gap-2 p-4`} role="alert">
            <span className={`text-[13.5px] font-bold ${INK}`}>Sources could not be read.</span>
            {onRetry ? <button type="button" className={GHOST} onClick={onRetry}><RefreshCw size={14} aria-hidden="true" /> Try again</button> : null}
          </div>
        ) : status === 'loading' ? (
          [0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-[12px] bg-axal-hairline dark:bg-gray-800" aria-hidden="true" />)
        ) : groups.map((g) => (
          <section key={g.id} className={`${CARD} overflow-hidden`} aria-label={g.label} data-testid={`sources-step-${g.id}`}>
            <div className="flex items-center justify-between gap-2 border-b border-axal-hairline px-4 py-2.5 dark:border-gray-700">
              <span className={`text-[13.5px] font-extrabold ${INK}`}>{g.label}</span>
              {g.note ? <span className={`text-[11px] ${MUTED}`}>{g.note}</span> : null}
            </div>
            <ul className="m-0 list-none p-0">
              {g.items.map((it) => {
                const value = valueText(it);
                return (
                  <li key={it.source_key} className="grid grid-cols-[18px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1 border-b border-axal-hairline px-4 py-2 text-[12.5px] last:border-b-0 sm:grid-cols-[18px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.6fr)] dark:border-gray-700">
                    <input type="checkbox" className="h-4 w-4 accent-axal-violet" aria-label={`Use ${it.label}`} checked={chosen.has(it.source_key)} disabled={!value} onChange={() => flip(it.source_key)} />
                    <span className={`font-semibold ${INK}`}>{it.label}</span>
                    <span className={`${MONO} ${value ? INK : MUTED} col-start-2 sm:col-start-auto`}>{value || gapLine(it)}</span>
                    <span className="col-start-2 sm:col-start-auto">
                      {value ? <SourceChip item={it} /> : it.state === 'not_recorded' ? <Link to={fillLink(it).href} className={LINK}>{fillLink(it).text}</Link> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            {g.more ? <button type="button" className={`${LINK} min-h-[36px] px-4`} onClick={() => setExpanded((s) => new Set([...s, g.id]))}>{g.more} ▾</button> : null}
          </section>
        ))}
      </div>
      <div className="flex flex-col gap-3.5">
        <section className={`${CARD} flex flex-col gap-2.5 p-4`} aria-label="Data coverage">
          <span className={`text-[14px] font-extrabold ${INK}`}>Data coverage</span>
          {status === 'ok' && meter ? (
            <>
              <span className={`font-mono text-[22px] font-semibold ${INK}`}>{meter.label}</span>
              <span className={`text-[12px] ${MUTED}`}>{meter.state === 'empty' ? METER_EMPTY : METER_SUB}</span>
            </>
          ) : null}
          <CoverageMeter coverage={coverage} status={status === 'ok' && !meter ? 'error' : status} size="L" onRetry={onRetry} legend label={false} />
        </section>
        {status === 'ok' && missing.length ? (
          <section className={`${CARD} flex flex-col gap-2 p-4`} aria-label="Missing">
            <span className={`text-[14px] font-extrabold ${INK}`}>Missing</span>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {missing.map((m) => (
                <li key={m.key} className="flex justify-between gap-2 rounded-[8px] border border-dashed border-axal-hairline px-2.5 py-2 text-[12.5px] dark:border-gray-700">
                  <span className={INK}>{m.label}</span>
                  <Link to={m.href} className={LINK}>{m.text}</Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {onContinue ? <button type="button" className={PRIMARY} onClick={onContinue} disabled={status !== 'ok'}>Continue to outline</button> : null}
      </div>
    </div>
  );
}


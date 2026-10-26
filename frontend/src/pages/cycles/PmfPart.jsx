import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cyclesWrite } from '../../lib/api/cycles';
import { Lightbox } from '../../ui';
import {
  BANDS, EMPTY_NOTE, GRADES, INPUTS, MISSING_FOOT, MODEL_VERSION, POINTS_FOOT, TITLE,
  gapRows, historyView, inputGroups, kitView, pmfView, readinessHref, validateHref,
} from './pmfModel';

/**
 * D1141 (#2433) and D1145 (#3031) — Fundraising readiness's Product-market fit
 * part, and the door to it from Validate's overview (RD12).
 *
 * D1145 draws the score part 3 stores (D1144), from the module read's
 * `parts.pmf`, beside the raise kit the module's own card scores:
 *
 *   RD1   the two tiles, the inputs, the gaps and the score history
 *   RD2–3 an input's lightbox (a bottom sheet on a phone, RD18 B)
 *   RD8   the history, from `GET /api/cycles/raise/pmf/history`
 *   RD9   product pull, Not expected yet until a product is live
 *   RD10  the records left out before a pivot, counted on each input
 *   RD14  below the floor: Not enough recorded, every input dashed
 *   RD16  A · the read failed: Unreadable with Try again, never "no score";
 *         B · one input unread: the score without it, at a lower confidence
 *
 * Re-score (RD6) is the module's own Re-score, which now offers Product-market
 * fit (`forms.js`); Team is scored on its record (RD7). Every words and number
 * here comes from `pmfModel.js`.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYE = 'm-0 font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const PILL = 'inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const P_NEUTRAL = `${PILL} border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100`;
const P_DASHED = `${PILL} border-dashed border-gray-400 bg-white text-axal-muted dark:border-gray-500 dark:bg-gray-900 dark:text-gray-400`;
const P_AMBER = `${PILL} border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-400/50 dark:bg-amber-400/10 dark:text-amber-300`;
const P_VIOLET = `${PILL} whitespace-normal border-violet-200 bg-violet-50 font-mono text-axal-violet-deep dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300`;
const BAND_PILL = {
  Strong: `${PILL} border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300`,
  Fair: P_AMBER,
  Weak: `${PILL} border-red-200 bg-red-50 text-red-700 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-300`,
};
const BAND_GLYPH = { Strong: '▲', Fair: '◐', Weak: '▼' };
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const BTN = 'inline-flex min-h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[12.5px] font-bold max-sm:min-h-[44px]';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const CHIP = (on) => `inline-flex min-h-[28px] items-center rounded-full border px-3 text-[12px] max-sm:min-h-[40px] ${on
  ? 'border-violet-200 bg-violet-50 font-bold text-axal-violet-deep dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300'
  : 'border-axal-hairline bg-white font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`;
const TH = 'px-3 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2 align-top text-[12.5px] text-axal-ink dark:text-gray-100';

export function PmfPart({ part, card = null, records = null, projectId = null, reload = null }) {
  const search = projectId ? `?project_id=${projectId}` : '';
  const view = useMemo(() => pmfView(part), [part]);
  const groups = useMemo(() => inputGroups(part, search), [part, search]);
  const gaps = useMemo(() => gapRows(view.kind === 'unreadable' ? null : part, records, search), [part, records, search, view.kind]);
  const kit = useMemo(() => kitView(card), [card]);
  const history = useHistory(projectId, view.kind === 'unreadable' ? null : part?.id ?? 'none');
  const [open, setOpen] = useState(null);
  const opened = open ? groups.flatMap((g) => g.rows).find((r) => r.key === open) : null;

  return (
    <section className="flex flex-col gap-3" id="product-market-fit" data-testid="pmf-part">
      <div className="grid gap-3 lg:grid-cols-2">
        <PmfTile view={view} history={history} reload={reload} />
        <KitTile kit={kit} />
      </div>
      {view.kind === 'unreadable' ? null : (
        <>
          {view.empty ? (
            <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-500/40 dark:bg-violet-500/10" data-testid="pmf-empty">
              <p className={`m-0 text-[13px] font-bold ${INK}`}>{EMPTY_NOTE}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link className={GHOST} to={validateHref('customer-research', search)}>Open Customer research ›</Link>
                <Link className={GHOST} to={validateHref('record', search)}>Record a session</Link>
              </div>
            </div>
          ) : null}
          <div className="grid gap-3 lg:grid-cols-3">
            <Inputs view={view} groups={groups} part={part} onOpen={setOpen} />
            <Gaps gaps={gaps} />
          </div>
        </>
      )}
      <HistoryCard history={history} pivotAt={part?.pivot_at ?? null} />
      <ModelFold search={search} />
      {opened ? <InputLightbox row={opened} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

/** RD8's points, read once per stored point. A failed read is said, never an empty history. */
function useHistory(projectId, key) {
  const [state, setState] = useState({ status: 'loading', items: [], more: false, cursor: null });
  const load = useCallback(async () => {
    if (!projectId) { setState({ status: 'none', items: [], more: false, cursor: null }); return; }
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const r = await cyclesWrite.raise.pmfHistory(projectId, { limit: 200 });
      setState({ status: 'ok', items: Array.isArray(r?.items) ? r.items : [], more: Boolean(r?.has_more), cursor: r?.next_cursor ?? null });
    } catch {
      setState({ status: 'error', items: [], more: false, cursor: null });
    }
  }, [projectId]);
  const older = useCallback(async () => {
    try {
      const r = await cyclesWrite.raise.pmfHistory(projectId, { limit: 200, before: state.cursor });
      setState((s) => ({ status: 'ok', items: [...(Array.isArray(r?.items) ? r.items : []), ...s.items], more: Boolean(r?.has_more), cursor: r?.next_cursor ?? null }));
    } catch {
      setState((s) => ({ ...s, status: 'error' }));
    }
  }, [projectId, state.cursor]);
  useEffect(() => { load(); }, [load, key]);
  return { ...state, retry: load, older };
}

// ---------------------------------------------------------------------------
// The tiles (RD1, RD14, RD16)
// ---------------------------------------------------------------------------

function PmfTile({ view, history, reload }) {
  if (view.kind === 'unreadable') {
    return (
      <div className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="pmf-tile" data-state="unreadable">
        <p className={EYE}>{TITLE}</p>
        <p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-bold text-red-700 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-300" data-testid="pmf-unreadable">{view.line}</p>
        {reload ? <button type="button" className={`${GHOST} self-start`} onClick={reload} data-testid="pmf-retry">Try again</button> : null}
      </div>
    );
  }
  const spark = history.status === 'ok' ? historyView(history.items).slice(-6).map((p) => p.value) : [];
  return (
    <div className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="pmf-tile" data-state={view.kind}>
      <p className={EYE}>{TITLE}{view.partial ? ' · partial' : ''}</p>
      {view.kind === 'scored' ? (
        <>
          <div className="flex flex-wrap items-baseline gap-2">
            <p className={`m-0 font-mono text-[40px] font-bold leading-none tracking-[-.03em] ${INK}`} data-testid="pmf-value">{view.value}</p>
            {view.band ? <span className={BAND_PILL[view.band] || P_NEUTRAL} data-testid="pmf-band">{BAND_GLYPH[view.band]} {view.band}</span> : null}
          </div>
          <p className={`m-0 font-mono text-[12px] font-bold ${INK}`} data-testid="pmf-confidence">{[view.confidence, view.coverage].filter(Boolean).join(' · ')}</p>
        </>
      ) : (
        <>
          <p className={`m-0 text-[22px] font-extrabold tracking-[-.02em] ${MUTED}`} data-testid="pmf-not-enough">{view.line}</p>
          <p className={`m-0 text-[12.5px] ${MUTED}`}>{view.note}</p>
          {view.coverage ? <p className={`m-0 font-mono text-[12px] ${MUTED}`}>{view.coverage} recorded</p> : null}
        </>
      )}
      <Spark values={spark} label="Product-market fit over its last stored points" />
      {view.unreadLine ? <p className="m-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] font-bold text-amber-800 dark:border-amber-400/50 dark:bg-amber-400/10 dark:text-amber-300" data-testid="pmf-partial">{view.unreadLine}</p> : null}
      <p className={`m-0 border-t border-axal-hairline pt-2 font-mono text-[12px] dark:border-gray-800 ${INK}`} data-testid="pmf-verdict">{view.verdict}<span className={`ml-2 font-sans ${MUTED}`}>Shown, not scored.</span></p>
      <p className={`m-0 text-[12px] ${MUTED}`} data-testid="pmf-foot">{view.foot}</p>
    </div>
  );
}

function KitTile({ kit }) {
  return (
    <div className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="kit-tile" data-state={kit.kind}>
      <p className={EYE}>Raise kit</p>
      {kit.kind === 'scored' ? (
        <>
          <div className="flex flex-wrap items-baseline gap-2">
            <p className={`m-0 font-mono text-[40px] font-bold leading-none tracking-[-.03em] ${INK}`} data-testid="kit-value">{kit.value}</p>
            <span className={`font-mono text-[12px] font-semibold ${MUTED}`}>{kit.note}</span>
          </div>
          <Spark values={kit.spark} label="The raise kit over its last scores" />
          <p className={`m-0 text-[12px] ${MUTED}`}>From the readiness items below. An item left unscored is left out, never counted as 0.</p>
        </>
      ) : kit.kind === 'empty' ? (
        <>
          <p className={`m-0 text-[22px] font-extrabold tracking-[-.02em] ${MUTED}`}>{kit.line}</p>
          <p className={`m-0 font-mono text-[12px] ${MUTED}`}>{kit.note}</p>
          <p className={`m-0 text-[12px] ${MUTED}`}>Fills as you build the raise kit in Raise.</p>
        </>
      ) : (
        <p role="alert" className="m-0 text-[13px] font-bold text-red-700 dark:text-red-300">{kit.line}</p>
      )}
    </div>
  );
}

/** Six points at most; a point with no value breaks the line. */
function Spark({ values, label }) {
  const pts = (values || []).map((v, i) => (v == null ? null : { x: values.length < 2 ? 150 : 6 + (i * 288) / (values.length - 1), y: 6 + ((100 - v) / 100) * 36 }));
  if (!pts.some(Boolean)) return null;
  let d = ''; let pen = false;
  for (const p of pts) { if (!p) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; pen = true; }
  return (
    <svg viewBox="0 0 300 48" className="h-12 w-full text-axal-violet dark:text-violet-300" role="img" aria-label={`${label}: ${values.map((v) => (v == null ? 'not enough recorded' : v)).join(', ')}`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" />
      {pts.map((p, i) => (p ? <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="currentColor" /> : null))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// What Product-market fit rests on (RD1, RD9, RD10, RD14, RD16 B, RD18 A)
// ---------------------------------------------------------------------------

function Inputs({ view, groups, part, onOpen }) {
  const left = groups.flatMap((g) => g.rows).reduce((a, r) => a + (r.beforePivot ? 1 : 0), 0);
  const pivot = part?.pivot_at ? `After the pivot on ${groupDay(part.pivot_at)}, only records from after it count${left ? '; each input says how many it left out' : ''}.` : null;
  return (
    <div className={`${CARD} flex flex-col gap-2 px-4 py-3 lg:col-span-2`} data-testid="pmf-inputs">
      <h3 className={`m-0 text-[15px] font-extrabold tracking-[-.01em] ${INK}`}>What {TITLE} rests on</h3>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>A bar's shade is its grade. {view.coverage ? `${view.coverage} recorded.` : ''}</p>
      {pivot ? <p className={`m-0 text-[12.5px] ${INK}`} data-testid="pmf-pivot">{pivot}</p> : null}
      {groups.map((g) => (
        <div key={g.key} className="flex flex-col">
          <p className={`${EYE} pb-1 pt-3`}>{g.title}</p>
          {g.rows.map((r) => <InputRow key={r.key} row={r} onOpen={onOpen} />)}
        </div>
      ))}
      <p className={`m-0 border-t border-axal-hairline pt-2 text-[12px] dark:border-gray-800 ${MUTED}`}>{view.kind === 'scored' && !view.empty ? `${POINTS_FOOT} The score is ${view.value}.` : MISSING_FOOT}</p>
    </div>
  );
}

function groupDay(x) { return historyView([{ computed_at: x, model: '' }])[0].day; }

function InputRow({ row, onOpen }) {
  const missing = row.state !== 'recorded';
  return (
    <div className="flex items-start gap-3 border-t border-axal-hairline py-2.5 dark:border-gray-800" data-testid="pmf-input-row" data-state={row.state} data-key={row.key}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={`m-0 text-[13.5px] font-bold leading-snug ${row.state === 'not_expected' ? MUTED : INK}`}>{row.label}</p>
        <p className={`m-0 font-mono text-[12px] leading-relaxed ${MUTED}`}>{row.words}</p>
        {row.bar != null ? (
          <span className="relative block h-2.5 w-full max-w-[420px] rounded border border-axal-hairline bg-axal-ground dark:border-gray-700 dark:bg-gray-800" aria-hidden="true">
            <span className="absolute inset-y-0 left-0 rounded bg-axal-violet dark:bg-violet-400" style={{ width: `${row.bar}%`, opacity: row.shade }} />
          </span>
        ) : <span className="block h-2.5 w-full max-w-[420px] rounded border border-dashed border-gray-400 dark:border-gray-500" aria-hidden="true" />}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={missing ? (row.state === 'unreadable' ? P_AMBER : P_DASHED) : P_NEUTRAL} data-testid="pmf-input-status">{row.status}</span>
          {row.stale ? <span className={P_AMBER}>◷ Stale</span> : null}
          {row.source && !missing ? <span className={P_NEUTRAL}>{row.source}</span> : null}
          {row.asOf ? <span className={`font-mono text-[11.5px] ${MUTED}`}>As of {row.asOf}</span> : null}
          {row.weight ? <span className={`font-mono text-[11.5px] ${MUTED}`}>{row.weight}</span> : null}
          {row.why ? <span className={`font-mono text-[11.5px] ${MUTED}`} data-testid="pmf-input-why">{row.why}</span> : null}
          {row.beforePivot ? <span className={`font-mono text-[11.5px] ${MUTED}`}>{row.beforePivot}</span> : null}
        </div>
      </div>
      {row.state === 'not_expected' ? null : <span className={`font-mono text-[16px] font-bold ${missing ? MUTED : INK}`} data-testid="pmf-input-value">{row.value}</span>}
      <button type="button" className={`${GHOST} border-transparent px-1.5 text-axal-violet-deep dark:text-violet-300`} onClick={() => onOpen(row.key)} aria-label={`Open ${row.label}`} data-testid="pmf-input-open">Open ›</button>
    </div>
  );
}

/** RD2 and RD3: what one input read, how it is scored, and where it is recorded. A bottom sheet on a phone. */
function InputLightbox({ row, onClose }) {
  const recorded = row.state === 'recorded';
  const facts = [
    ['Value', recorded ? `${row.value} of 100` : row.status],
    ['Weight', `${row.weightNumber} of 100`, 'in model v1, shared out again over the inputs that apply'],
    ['Contribution', row.contribution != null ? `${row.contribution} points` : '—', row.contribution != null ? null : 'Out of the value'],
    ['As of', row.asOf || '—'],
  ];
  return (
    <Lightbox label={row.label} eyebrow={`${TITLE} · ${row.moduleLabel}`} title={row.label} onClose={onClose} width={600} phone="sheet" testId="pmf-input-lightbox"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose}>Close</button>
          <Link className={PRIMARY} to={row.href} onClick={onClose}>Open {row.moduleLabel.replace(/^(Validate|Build) › /, '')} ›</Link>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          <span className={recorded ? P_NEUTRAL : row.state === 'unreadable' ? P_AMBER : P_DASHED}>{row.status}</span>
          {row.stale ? <span className={P_AMBER}>◷ Stale</span> : null}
          {row.source ? <span className={P_NEUTRAL}>{row.source}</span> : null}
        </div>
        <dl className="m-0 grid gap-3 sm:grid-cols-2">
          {facts.map(([k, v, sub]) => (
            <div key={k}>
              <dt className={EYE}>{k}</dt>
              <dd className={`m-0 text-[13px] font-semibold ${INK}`}>{v}</dd>
              {sub ? <dd className={`m-0 text-[12px] ${MUTED}`}>{sub}</dd> : null}
            </div>
          ))}
        </dl>
        {row.rule ? (
          <div className="border-t border-axal-hairline pt-3 dark:border-gray-800">
            <p className={EYE}>Method</p>
            <p className={`m-0 mt-1 text-[13px] ${INK}`}>{row.rule}</p>
          </div>
        ) : null}
        <div className="border-t border-axal-hairline pt-3 dark:border-gray-800">
          <p className={EYE}>What it read</p>
          <p className={`m-0 mt-1 font-mono text-[12.5px] ${INK}`} data-testid="pmf-lightbox-words">{row.words}</p>
          {row.why ? <p className={`m-0 mt-1 text-[12.5px] ${MUTED}`}>{row.why}</p> : null}
          {row.beforePivot ? <p className={`m-0 mt-1 text-[12.5px] ${MUTED}`}>{row.beforePivot}.</p> : null}
          {row.key === 'product_pull' && row.state === 'not_expected' ? <p className={`m-0 mt-1 text-[12.5px] ${MUTED}`}>Coverage counts the inputs that apply, so it leaves this one out until a product is live.</p> : null}
        </div>
      </div>
    </Lightbox>
  );
}

// ---------------------------------------------------------------------------
// Gaps (RD1, RD18 C)
// ---------------------------------------------------------------------------

function Gaps({ gaps }) {
  const [scope, setScope] = useState('all');
  const n = { all: gaps.length, pmf: gaps.filter((g) => g.scope === 'pmf').length, kit: gaps.filter((g) => g.scope === 'kit').length };
  const shown = scope === 'all' ? gaps : gaps.filter((g) => g.scope === scope);
  return (
    <div className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="pmf-gaps">
      <h3 className={`m-0 text-[15px] font-extrabold tracking-[-.01em] ${INK}`}>Gaps · {gaps.length}</h3>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Which gaps">
        {[['all', 'All'], ['pmf', TITLE], ['kit', 'Raise kit']].map(([k, l]) => (
          <button key={k} type="button" className={CHIP(scope === k)} aria-pressed={scope === k} onClick={() => setScope(k)} data-testid={`pmf-gaps-${k}`}>{l} {n[k]}</button>
        ))}
      </div>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>Every next step that raises either score, by what it raises.</p>
      {shown.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="pmf-gaps-none">No gap is recorded{scope === 'all' ? '' : ' here'}.</p> : null}
      {shown.map((g, i) => (
        <div key={`${g.scope}-${i}`} className="flex flex-col gap-1.5 border-t border-axal-hairline py-2.5 dark:border-gray-800" data-testid="pmf-gap" data-scope={g.scope}>
          <p className={`m-0 text-[13.5px] font-bold leading-snug ${INK}`}>{g.text}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {g.gains.map((w) => <span key={w} className={P_VIOLET}>{w}</span>)}
            <span className={P_NEUTRAL}>{g.scopeLabel}</span>
            {g.href ? <Link className={`${PILL} min-h-[26px] border-violet-200 bg-white text-axal-violet-deep max-sm:min-h-[44px] dark:border-violet-500/40 dark:bg-gray-900 dark:text-violet-300`} to={g.href}>{g.moduleLabel} ›</Link>
              : g.moduleLabel ? <span className={`font-mono text-[11.5px] ${MUTED}`}>{g.moduleLabel}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Score history (RD8)
// ---------------------------------------------------------------------------

function HistoryCard({ history, pivotAt }) {
  const [mode, setMode] = useState('chart');
  const points = useMemo(() => historyView(history.items, pivotAt), [history.items, pivotAt]);
  return (
    <div className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="pmf-history" data-state={history.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={`m-0 text-[15px] font-extrabold tracking-[-.01em] ${INK}`}>Score history</h3>
        <div className="inline-flex gap-0.5 rounded-[9px] border border-axal-hairline bg-axal-ground p-0.5 dark:border-gray-700 dark:bg-gray-800" role="group" aria-label="Show the history as">
          {['chart', 'table'].map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
              className={`min-h-[28px] rounded-[7px] px-3 text-[12px] max-sm:min-h-[40px] ${mode === m ? `bg-white font-bold shadow-sm dark:bg-gray-900 ${INK}` : `font-semibold ${MUTED}`}`}>{m === 'chart' ? 'Chart' : 'Table'}</button>
          ))}
        </div>
      </div>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>One point each time the inputs changed. A point below the floor shows no number; earlier points are never rewritten.</p>
      {history.status === 'loading' ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="pmf-history-loading">Reading…</p> : null}
      {history.status === 'error' ? (
        <div className="flex flex-wrap items-center gap-2" role="alert" data-testid="pmf-history-error">
          <p className="m-0 text-[13px] font-bold text-red-700 dark:text-red-300">The score history could not be read. That is not the same as no history.</p>
          <button type="button" className={GHOST} onClick={history.retry}>Try again</button>
        </div>
      ) : null}
      {history.status === 'ok' && points.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="pmf-history-empty">No score is stored yet.</p> : null}
      {history.status === 'ok' && points.length > 0 ? (mode === 'chart' ? <HistoryChart points={points} /> : <HistoryTable points={points} />) : null}
      {history.status === 'ok' && history.more ? <button type="button" className={`${GHOST} self-start`} onClick={history.older}>Read older points</button> : null}
    </div>
  );
}

function HistoryChart({ points }) {
  const W = 640; const H = 180; const L = 32; const R = 12; const T = 22; const B = 24;
  const x = (i) => (points.length < 2 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (points.length - 1));
  const y = (v) => T + ((100 - v) / 100) * (H - T - B);
  const segs = []; let prev = null;
  points.forEach((p, i) => {
    if (p.value == null) return;
    if (prev) segs.push({ d: `M${x(prev.i).toFixed(1)} ${y(prev.v).toFixed(1)}L${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`, gap: i - prev.i > 1 });
    prev = { i, v: p.value };
  });
  const summary = points.map((p) => `${p.day}: ${p.label}`).join('; ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full text-axal-violet dark:text-violet-300" role="img" aria-label={`Product-market fit history. ${summary}`} data-testid="pmf-history-chart">
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-axal-hairline dark:stroke-gray-800" strokeWidth="1" />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" className="fill-axal-muted text-[10px] dark:fill-gray-400">{v}</text>
        </g>
      ))}
      {points.map((p, i) => (p.pivot || p.modelChange ? (
        <g key={`m${i}`}>
          <line x1={x(i)} x2={x(i)} y1={T - 6} y2={H - B} className="stroke-axal-ink dark:stroke-gray-300" strokeWidth="1" strokeDasharray={p.pivot ? undefined : '2 3'} />
          <text x={x(i) + 4} y={T - 8} className="fill-axal-ink text-[10px] dark:fill-gray-300">{p.pivot ? 'Pivot' : p.modelChange}</text>
        </g>
      ) : null))}
      {segs.map((s, i) => <path key={i} d={s.d} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={s.gap ? '5 4' : undefined} />)}
      {points.map((p, i) => (p.value == null
        ? <circle key={i} cx={x(i)} cy={H - B} r="3" fill="none" className="stroke-axal-muted dark:stroke-gray-400" strokeDasharray="2 2"><title>{`${p.day} · ${p.label}`}</title></circle>
        : <circle key={i} cx={x(i)} cy={y(p.value)} r="3" fill="currentColor"><title>{`${p.day} · ${p.label} · ${p.confidence}${p.coverage ? ` · ${p.coverage} inputs` : ''}`}</title></circle>))}
      <text x={L} y={H - 6} className="fill-axal-muted text-[10px] dark:fill-gray-400">{points[0].day}</text>
      <text x={W - R} y={H - 6} textAnchor="end" className="fill-axal-muted text-[10px] dark:fill-gray-400">{points[points.length - 1].day}</text>
    </svg>
  );
}

function HistoryTable({ points }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" data-testid="pmf-history-table">
        <thead><tr className="border-b border-axal-hairline dark:border-gray-800">{['Day', 'Score', 'Band', 'Confidence', 'Inputs', 'Model', 'Why'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
        <tbody>
          {[...points].reverse().map((p) => (
            <tr key={p.id} className="border-b border-axal-hairline last:border-0 dark:border-gray-800">
              <td className={`${TD} font-mono`}>{p.day}{p.pivot ? ' · after the pivot' : ''}</td>
              <td className={`${TD} font-mono font-bold ${p.value == null ? MUTED : ''}`}>{p.label}</td>
              <td className={TD}>{p.band || '—'}</td>
              <td className={TD}>{p.confidence}</td>
              <td className={`${TD} font-mono`}>{p.coverage || '—'}</td>
              <td className={`${TD} font-mono`}>{p.model}</td>
              <td className={`${TD} ${MUTED}`}>{p.trigger || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// How it is scored (RD4, D1141's fold until part 5 reads the stored model)
// ---------------------------------------------------------------------------

function ModelFold({ search }) {
  return (
    <details className={`${CARD} px-4 py-3`} data-testid="pmf-model">
      <summary className={`cursor-pointer text-[12.5px] font-bold ${INK}`}>How {TITLE} is scored · {MODEL_VERSION}</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead><tr className="border-b border-axal-hairline dark:border-gray-800"><th className={TH}>Input</th><th className={TH}>Rule</th><th className={TH}>Weight</th></tr></thead>
          <tbody>
            {INPUTS.map((i) => (
              <tr key={i.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-800" data-testid="pmf-input">
                <td className={TD}>{i.module ? <Link className={LINK} to={validateHref(i.module, search)}>{i.name}</Link> : i.name}</td>
                <td className={TD}>{i.rule}</td>
                <td className={`${TD} font-mono tabular-nums`}>{i.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={`m-0 mt-2 flex list-none flex-col gap-0.5 p-0 text-[12px] ${MUTED}`}>
        {GRADES.map(([g, f, why]) => <li key={g}><span className={`font-bold ${INK}`}>{g} {f}</span> · {why}</li>)}
      </ul>
      <p className={`m-0 mt-2 text-[12px] ${MUTED}`}>{BANDS}</p>
    </details>
  );
}

/** RD12: Validate's overview hands off to the readiness page. */
export function ReadinessDoor({ search = '' }) {
  return (
    <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="pmf-door">
      What Validate records will feed Product-market fit on Fundraising readiness. <Link className={LINK} to={readinessHref(search)}>Open Fundraising readiness</Link>
    </p>
  );
}

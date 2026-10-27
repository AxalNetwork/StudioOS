/**
 * D1241 (#3254, part 5 of #2423) — DLS8 and DLS9, Compare at
 * /deals/compare?ids=: two to four ventures side by side. Light and dark are
 * the same page (Tailwind's `dark:` pairs).
 *
 *   - Each venture keeps one colour (`COMPARE_COLOURS`) in its card, the chart
 *     and the table.
 *   - "Scores by scope": grouped bars, one per venture per scope, whose length
 *     is the band's rank from SCORING's batch (D1256), never a value. Low
 *     confidence is drawn hatched; a scope without a score is a dash with its
 *     word. The table below holds the same bands, the strongest alone in a row
 *     in weight 800.
 *   - Eadwyn's note: drafted from the bands on press, shown, and saved to the
 *     investor's notes only on Save to notes (`/api/deals/flow/compare-note`).
 *     Discard writes nothing. Eadwyn never changes a score.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { dealFlowApi } from '../../../lib/api/dealFlow.js';
import { dealViewsApi } from '../../../lib/api/dealViews.js';
import { ventureScoresApi } from '../../../lib/api/ventureScores.js';
import { reportError } from '../../../lib/log';
import { Unreadable } from '../../../ui';
import { ScopeStrip } from '../../../components/scoring/scorecard/Scorecard';
import { MAX_COMPARE } from './dealFlowModel';
import { fitOf, flowRows, scoresOf, stageWord, stripScopes } from './flowModel';
import { AskCell, DaysCell, FitCell } from './FlowCells';
import { COMPARE_COLOURS, barShare, compareCsv, compareRows, compareSummary } from './compareModel';

const BOX = 'flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const PILL = 'rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] dark:border-gray-700';
const BTN = 'inline-flex items-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const PRIMARY = 'inline-flex items-center rounded-[9px] bg-violet-700 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-violet-800 disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500';
const HATCH = { backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.55) 0 3px, transparent 3px 6px)' };

/** The chart: per scope, one bar per venture in its colour; a missing score is a dash with its word. */
function ScopeBars({ ventures }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="dealflow-compare-chart">
      {compareRows(ventures).map((r) => (
        <li key={r.key} className="grid grid-cols-[140px_minmax(0,1fr)] items-start gap-3" data-testid={`dealflow-compare-chart-${r.key}`}>
          <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{r.label}</span>
          <div className="flex flex-col gap-1">
            {r.cells.map((c, i) => (
              <div key={ventures[i].id} className="flex items-center gap-2" title={`${ventures[i].name}: ${c.title || c.word}`}>
                {c.kind === 'scored'
                  ? <span className="h-2.5 rounded-sm bg-gray-100 dark:bg-gray-800" style={{ width: '60%' }}>
                    <span className={`block h-full rounded-sm ${COMPARE_COLOURS[i].bar} ${c.low ? 'opacity-70' : ''}`} style={{ width: `${Math.round(barShare(c.band) * 100)}%`, ...(c.low ? HATCH : {}) }}
                      data-testid={`dealflow-compare-bar-${r.key}-${i}`} data-band={c.band} data-low={c.low ? '1' : '0'} />
                  </span>
                  : <span className="w-[60%] border-t border-dashed border-gray-300 dark:border-gray-600" data-testid={`dealflow-compare-bar-${r.key}-${i}`} data-band="none" />}
                <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{c.kind === 'scored' ? `${c.word}${c.confidence ? ` · ${c.confidence.toLowerCase()}` : ''}` : c.word}</span>
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The table: the same bands, the strongest alone in a row in weight 800, then the facts. */
function CompareTable({ ventures }) {
  const head = 'px-2 py-1.5 text-left text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400';
  return (
    <div className="overflow-x-auto" id="compare-table">
      <table className="w-full border-collapse text-[13px]" data-testid="dealflow-compare-table">
        <thead>
          <tr className="border-b border-axal-hairline dark:border-gray-800">
            <th className={head}>Scope</th>
            {ventures.map((v, i) => <th key={v.id} className={head}><span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${COMPARE_COLOURS[i].swatch}`} aria-hidden="true" />{v.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {compareRows(ventures).map((r) => (
            <tr key={r.key} className="border-t border-gray-100 dark:border-gray-800">
              <th scope="row" className="px-2 py-1.5 text-left font-semibold">{r.label}</th>
              {r.cells.map((c, i) => (
                <td key={ventures[i].id} className={`px-2 py-1.5 ${c.best ? 'font-extrabold' : ''}`} title={c.title || undefined} data-testid={`dealflow-compare-cell-${r.key}-${i}`} data-best={c.best ? '1' : '0'}>
                  {c.kind === 'scored' ? <>{c.word}{c.confidence && <span className="font-normal text-axal-muted dark:text-gray-400"> · {c.confidence}</span>}</> : <span className="text-axal-muted dark:text-gray-400">{c.word}</span>}
                </td>
              ))}
            </tr>
          ))}
          <tr className="border-t border-axal-hairline dark:border-gray-700"><th scope="row" className="px-2 py-1.5 text-left font-semibold">Ask</th>{ventures.map((v) => <td key={v.id} className="px-2 py-1.5"><AskCell row={v} /></td>)}</tr>
          <tr className="border-t border-gray-100 dark:border-gray-800"><th scope="row" className="px-2 py-1.5 text-left font-semibold">Your stage</th>{ventures.map((v) => <td key={v.id} className="px-2 py-1.5">{stageWord(v.stage)}</td>)}</tr>
          <tr className="border-t border-gray-100 dark:border-gray-800"><th scope="row" className="px-2 py-1.5 text-left font-semibold">Days in stage</th>{ventures.map((v) => <td key={v.id} className="px-2 py-1.5"><DaysCell row={v} /></td>)}</tr>
          <tr className="border-t border-gray-100 dark:border-gray-800"><th scope="row" className="px-2 py-1.5 text-left font-semibold">Fit to my thesis</th>{ventures.map((v) => <td key={v.id} className="px-2 py-1.5"><FitCell fit={v.fit} /></td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

/** Eadwyn's note: nothing is drafted until pressed, and nothing is saved until Save to notes. */
export function CompareNote({ ids, api: noteApi = dealFlowApi }) {
  const key = ids.join(',');
  const [saved, setSaved] = useState({ kind: 'loading' });
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    noteApi.compareNotes(ids).then((r) => { if (alive) setSaved({ kind: 'ok', items: r?.items || [] }); }, (e) => { reportError('DealFlow:notes', e); if (alive) setSaved({ kind: 'unreadable' }); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const run = async () => {
    setBusy(true); setError('');
    try { setDraft(await noteApi.draftCompareNote(ids)); } catch (e) { reportError('DealFlow:draft-note', e); setError(e?.message || 'Eadwyn could not draft this note. Try again.'); } finally { setBusy(false); }
  };
  const keep = async () => {
    setBusy(true); setError('');
    try {
      const out = await noteApi.keepCompareNote(draft.receipt);
      setSaved((s) => ({ kind: 'ok', items: [out.saved, ...(s.kind === 'ok' ? s.items : [])] }));
      setDraft(null);
    } catch (e) { reportError('DealFlow:keep-note', e); setError(e?.message || 'The note could not be saved. Nothing was saved.'); } finally { setBusy(false); }
  };
  return (
    <section className={BOX} data-testid="dealflow-compare-note">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="m-0 text-[14px] font-bold text-axal-ink dark:text-gray-100">Draft a comparison note</h3>
          <p className={MUTED}>Eadwyn drafts from the scores on this page. Nothing is saved until you press Save to notes.</p>
        </div>
        {!draft && <button type="button" className={BTN} onClick={run} disabled={busy} data-testid="dealflow-compare-note-draft">{busy ? 'Drafting…' : 'Draft with Eadwyn'}</button>}
      </div>
      {draft && (
        <div className="flex flex-col gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-950" data-testid="dealflow-compare-note-text">
          <p className="m-0 whitespace-pre-line text-[13px] text-axal-ink dark:text-gray-100">{draft.note?.text}</p>
          <div className="flex gap-2">
            <button type="button" className={PRIMARY} onClick={keep} disabled={busy} data-testid="dealflow-compare-note-save">{busy ? 'Saving…' : 'Save to notes'}</button>
            <button type="button" className={BTN} onClick={() => setDraft(null)} disabled={busy} data-testid="dealflow-compare-note-discard">Discard</button>
          </div>
        </div>
      )}
      {error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="dealflow-compare-note-refused">{error}</p>}
      {saved.kind === 'unreadable' && <p className={MUTED} data-testid="dealflow-compare-note-unread">Your saved notes for these ventures could not be read. Drafting still works.</p>}
      {saved.kind === 'ok' && saved.items.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="dealflow-compare-notes">
          {saved.items.map((n) => <li key={n.uid} className="border-l-2 border-violet-300 pl-3 text-[13px] dark:border-violet-700">{n.text}</li>)}
        </ul>
      )}
    </section>
  );
}

function download(text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'compare.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (e) { reportError('DealFlow:csv', e); }
}

/** DLS8/DLS9 from rows already read, each with its scores and fit. */
export function CompareView({ ventures, missing = 0, ids = [] }) {
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="dealflow-compare-page">
      <nav className="text-[13px] text-axal-muted dark:text-gray-400"><Link to="/deals?view=table" className="font-semibold text-violet-700 underline dark:text-violet-300">Deal flow</Link> › Compare</nav>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[20px] font-extrabold">Compare · {ventures.length} ventures</h2>
        {ventures.length >= 2 && (
          <div className="flex gap-2">
            {ventures.length < MAX_COMPARE && <Link to="/deals?view=table" className={PRIMARY} data-testid="dealflow-compare-add">Add a venture</Link>}
            <button type="button" className={BTN} onClick={() => download(compareCsv(ventures))} data-testid="dealflow-compare-csv">Export CSV</button>
          </div>
        )}
      </div>
      {missing > 0 && <p className={MUTED} data-testid="dealflow-compare-missing">{missing === 1 ? 'One picked venture is' : `${missing} picked ventures are`} not on the deal list, so {missing === 1 ? 'it is' : 'they are'} not compared.</p>}
      {ventures.length < 2
        ? <section className={BOX} data-testid="dealflow-compare-few"><p className="m-0 text-sm">Pick at least two ventures to compare, from the table.</p></section>
        : (
          <>
            <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
              {ventures.map((v, i) => (
                <li key={v.id} className={BOX} data-testid={`dealflow-compare-${v.id}`}>
                  <div className="flex items-center gap-2"><span className={`inline-block h-3 w-3 rounded-full ${COMPARE_COLOURS[i].swatch}`} aria-label={`${COMPARE_COLOURS[i].name} in the chart`} role="img" /><span className="font-semibold">{v.name}</span></div>
                  {v.sector && <span className={MUTED}>{v.sector}</span>}
                  <div className="flex flex-wrap gap-1"><span className={PILL}>{stageWord(v.stage)}</span><span className={PILL}>{v.round}</span></div>
                  <AskCell row={v} />
                  {v.scores.state === 'locked' ? <ScopeStrip locked /> : <ScopeStrip scopes={stripScopes(v.scores)} />}
                </li>
              ))}
              {ventures.length < MAX_COMPARE && (
                <li className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 p-4 text-center dark:border-gray-600">
                  <Link to="/deals?view=table" className="font-semibold text-violet-700 underline dark:text-violet-300">Add a venture</Link>
                  <span className={MUTED}>Up to four</span>
                </li>
              )}
            </ul>
            <section className={BOX} aria-labelledby="compare-chart-title">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="compare-chart-title" className="m-0 text-[14px] font-bold">Scores by scope</h3>
                <a href="#compare-table" className="text-[12.5px] font-semibold text-violet-700 underline dark:text-violet-300">View as table</a>
              </div>
              <p className="m-0 text-[13px]" data-testid="dealflow-compare-summary">{compareSummary(ventures)}</p>
              <p className={MUTED}>A bar is a band: Weak, Fair or Strong, never a number. A hatched bar has low confidence; a dashed line is a scope without a score.</p>
              <ScopeBars ventures={ventures} />
              <CompareTable ventures={ventures} />
            </section>
            <CompareNote ids={ids.length ? ids : ventures.map((v) => v.id)} />
          </>
        )}
    </div>
  );
}

/** /deals/compare: the picked rows from the deal list and the flow, with their scores and fit. */
export function DealCompare({ ids }) {
  const key = ids.join(',');
  const [read, setRead] = useState({ kind: 'loading' });
  const [scores, setScores] = useState(null);
  const [fits, setFits] = useState(null);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let alive = true;
    setRead({ kind: 'loading' });
    Promise.all([api.listDeals(), dealFlowApi.flow().catch(() => ({ items: [] }))]).then(
      ([deals, flow]) => { if (alive) setRead({ kind: 'ok', rows: flowRows('all', { flow, deals }) }); },
      (e) => { reportError('DealFlow:compare', e); if (alive) setRead({ kind: 'unreadable' }); },
    );
    return () => { alive = false; };
  }, [again]);
  useEffect(() => {
    let alive = true;
    if (!ids.length) return undefined;
    ventureScoresApi.batch(ids.map(Number)).then((s) => { if (alive) setScores(s); }, (e) => { reportError('DealFlow:compare-scores', e); if (alive) setScores('failed'); });
    dealViewsApi.fit(ids).then((f) => { if (alive) setFits(new Map((f?.items || []).map((x) => [String(x.deal_id), x]))); }, (e) => { reportError('DealFlow:compare-fit', e); if (alive) setFits('failed'); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const ventures = useMemo(() => (read.kind === 'ok'
    ? ids.map((id) => read.rows.find((r) => r.id === String(id))).filter(Boolean).map((r) => ({ ...r, scores: scoresOf(scores, r.id), fit: fitOf(fits, r.id) }))
    : []), [read, scores, fits, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (read.kind === 'loading') return <section className={BOX} aria-busy="true"><p className={MUTED}>Reading…</p></section>;
  if (read.kind === 'unreadable') return <section className={BOX}><Unreadable what="The ventures to compare" claim="That is not the same as having none." onRetry={() => setAgain((n) => n + 1)} /></section>;
  return (
    <>
      {scores === 'failed' && <p className="m-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" role="status" data-testid="dealflow-compare-scores-failed">Scores could not be read. Names, stages and money are current.</p>}
      <CompareView ventures={ventures} missing={ids.length - ventures.length} ids={ventures.map((v) => v.id)} />
    </>
  );
}


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
 *   - D6151 (#6151, board DE29): below 768px the chart and the table give way to
 *     one column: a sticky legend of the ventures in their colours, and each
 *     section stacked with every venture's value under each row. With two
 *     ventures every section is open; with three or four, one at a time.
 *   - D6149 (#6149): each card has Remove (the same address without that id),
 *     Add a venture returns to the table with the picks ticked (`&pick=`),
 *     Export CSV writes every row the table shows (`compareSections`), and the
 *     page prints (`comparePrint.js`).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { dealInsightsApi } from '../../../lib/api/dealInsights.js';
import { dealFlowApi } from '../../../lib/api/dealFlow.js';
import { dealViewsApi } from '../../../lib/api/dealViews.js';
import { ventureScoresApi } from '../../../lib/api/ventureScores.js';
import { reportError } from '../../../lib/log';
import { Unreadable } from '../../../ui';
import { ScopeStrip } from '../../../components/scoring/scorecard/Scorecard';
import { MAX_COMPARE, addVentureHref, compareHref } from './dealFlowModel';
import { fitOf, flowRows, scoresOf, stageWord, stripScopes } from './flowModel';
import { AskCell, DaysCell, FitCell } from './FlowCells';
import { COMPARE_COLOURS, barShare, compareCsv, compareRows, compareSections, compareSummary, compareTraction } from './compareModel';
import { COMPARE_PRINT_CSS } from './comparePrint';

const BOX = 'flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const WARN = 'm-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';
const PILL = 'rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] dark:border-gray-700';
const BTN = 'inline-flex items-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const PRIMARY = 'inline-flex items-center rounded-[9px] bg-violet-700 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-violet-800 disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500';
const OPACITY = { High: 'opacity-100', Medium: 'opacity-80', Low: 'opacity-55' };
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
                    <span className={`block h-full rounded-sm ${COMPARE_COLOURS[i].bar} ${OPACITY[c.confidence] ?? 'opacity-55'}`} style={{ width: `${Math.round(barShare(c.band) * 100)}%`, ...(c.low ? HATCH : {}) }}
                      data-testid={`dealflow-compare-bar-${r.key}-${i}`} data-band={c.band} data-low={c.low ? '1' : '0'} />
                  </span>
                  : <span className="w-[60%] border-t border-dashed border-gray-300 dark:border-gray-600" data-testid={`dealflow-compare-bar-${r.key}-${i}`} data-band="none" />}
                <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{c.kind === 'scored' ? `${c.word}${c.confidence ? ` · ${c.confidence.toLowerCase()} confidence` : ' · confidence not recorded'}` : c.word}</span>
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A row's cells drawn richer than its words (a link, a title); every other row is its words from `compareSections`. */
const RICH_CELL = {
  ask: (v) => <AskCell row={v} />,
  days: (v, flowUnknown) => <DaysCell row={v} flowUnknown={flowUnknown} testId={`dealflow-compare-days-${v.id}`} />,
  fit: (v) => <FitCell fit={v.fit} />,
};

/**
 * The table: the same bands, the strongest alone in a row in weight 800, then the facts.
 * D6149 (#6149): its sections and rows are `compareSections`', the list the CSV writes.
 */
function CompareTable({ ventures, flowUnknown = false }) {
  const head = 'px-2 py-1.5 text-left text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400';
  return (
    <div className="max-h-[65vh] overflow-auto" id="compare-table">
      <table className="w-full border-collapse text-[13px]" data-testid="dealflow-compare-table">
        <thead className="sticky top-0 z-10 bg-white dark:bg-gray-900">
          <tr className="border-b border-axal-hairline dark:border-gray-800">
            <th scope="col" className={head}>Comparison</th>
            {ventures.map((v, i) => <th scope="col" key={v.id} className={head}><span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${COMPARE_COLOURS[i].swatch}`} aria-hidden="true" data-print-swatch="" />{v.name}</th>)}
          </tr>
        </thead>
        {compareSections(ventures, { flowUnknown }).map((section) => (
          <tbody key={section.key} data-testid={`dealflow-compare-section-${section.key}`}>
            <tr><th scope="rowgroup" colSpan={ventures.length + 1} className="bg-gray-50 px-2 py-2 text-left text-sm font-bold dark:bg-gray-800">{section.label}</th></tr>
            {section.rows.map((row) => (
              <tr key={row.key} className="border-t border-gray-100 dark:border-gray-800">
                <th scope="row" className="px-2 py-1.5 text-left font-semibold">{row.label}</th>
                {row.scope
                  ? row.scope.cells.map((c, i) => (
                    <td key={ventures[i].id} className={`px-2 py-1.5 ${c.best ? 'font-extrabold' : ''}`} title={c.title || undefined} data-testid={`dealflow-compare-cell-${row.scope.key}-${i}`} data-best={c.best ? '1' : '0'}>
                      {c.kind === 'scored' ? <>{c.word}{c.confidence && <span className="font-normal text-axal-muted dark:text-gray-400"> · {c.confidence}</span>}</> : <span className="text-axal-muted dark:text-gray-400">{row.cells[i]}</span>}
                    </td>
                  ))
                  : ventures.map((v, i) => <td key={v.id} className="px-2 py-1.5">{RICH_CELL[row.key] ? RICH_CELL[row.key](v, flowUnknown) : row.cells[i]}</td>)}
              </tr>
            ))}
          </tbody>
        ))}
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
  const [againNotes, setAgainNotes] = useState(0);
  useEffect(() => {
    let alive = true;
    noteApi.compareNotes(ids).then((r) => { if (alive) setSaved({ kind: 'ok', items: r?.items || [], unreadable: Number(r?.unreadable) || 0 }); }, (e) => { reportError('DealFlow:notes', e); if (alive) setSaved({ kind: 'unreadable' }); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, againNotes]);
  const run = async () => {
    setBusy(true); setError('');
    try { setDraft(await noteApi.draftCompareNote(ids)); } catch (e) { reportError('DealFlow:draft-note', e); setError(e?.message || 'Eadwyn could not draft this note. Try again.'); } finally { setBusy(false); }
  };
  const keep = async () => {
    setBusy(true); setError('');
    try {
      const out = await noteApi.keepCompareNote(draft.receipt);
      setSaved((s) => ({ kind: 'ok', items: [out.saved, ...(s.kind === 'ok' ? s.items : [])], unreadable: s.kind === 'ok' ? s.unreadable : 0 }));
      setDraft(null);
    } catch (e) { reportError('DealFlow:keep-note', e); setError(e?.message || 'The note could not be saved. Nothing was saved.'); } finally { setBusy(false); }
  };
  return (
    <section className={BOX} data-testid="dealflow-compare-note">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="m-0 text-[14px] font-bold text-axal-ink dark:text-gray-100">Decision notes</h3>
          <p className={MUTED}>Eadwyn drafts from the scores on this page. Nothing is saved until you press Save to notes.</p>
        </div>
        {!draft && <button type="button" className={BTN} onClick={run} disabled={busy} data-testid="dealflow-compare-note-draft">{busy ? 'Drafting…' : 'Draft the note'}</button>}
      </div>
      {draft && (
        <div className="flex flex-col gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-950" data-testid="dealflow-compare-note-text">
          <p className={MUTED}>Proposal awaiting your decision</p>
          <p className="m-0 whitespace-pre-line text-[13px] text-axal-ink dark:text-gray-100">{draft.note?.text}</p>
          <div className="flex gap-2">
            <button type="button" className={PRIMARY} onClick={keep} disabled={busy} data-testid="dealflow-compare-note-save">{busy ? 'Saving…' : 'Save to notes'}</button>
            <button type="button" className={BTN} onClick={() => setDraft(null)} disabled={busy} data-testid="dealflow-compare-note-discard">Discard</button>
          </div>
        </div>
      )}
      {error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="dealflow-compare-note-refused">{error}</p>}
      {saved.kind === 'unreadable' && <p className={MUTED} data-testid="dealflow-compare-note-unread">Your saved notes for these ventures could not be read. Drafting still works. <button type="button" className="font-semibold underline" onClick={() => setAgainNotes((n) => n + 1)}>Try again</button></p>}
      {saved.kind === 'ok' && saved.unreadable > 0 && <p className={MUTED} data-testid="dealflow-compare-note-partial">{saved.unreadable === 1 ? 'One saved note' : `${saved.unreadable} saved notes`} could not be read{saved.items.length ? '; the others are below' : ''}. <button type="button" className="font-semibold underline" onClick={() => setAgainNotes((n) => n + 1)}>Try again</button></p>}
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

/**
 * D6151 (DE29): Compare on a phone. The same sections and rows as the table
 * (`compareSections`), stacked: each row names itself once, then lists every
 * venture's value beside its colour. A missing value is its word, never a bar.
 * Two ventures: every section open. Three or four: one section open at a time.
 */
export function ComparePhone({ ventures, flowUnknown = false }) {
  const sections = compareSections(ventures, { flowUnknown });
  const accordion = ventures.length > 2;
  const [open, setOpen] = useState(sections[0]?.key ?? null);
  return (
    <div className="flex flex-col gap-3 md:hidden" data-testid="dealflow-compare-phone" data-print="hide">
      <div className="sticky top-0 z-10 bg-gray-50 py-2 dark:bg-gray-950">
        <ul className="m-0 flex list-none gap-2 overflow-x-auto p-0" aria-label="Ventures compared" data-testid="dealflow-compare-legend">
          {ventures.map((v, i) => (
            <li key={v.id} className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${COMPARE_COLOURS[i].swatch}`} aria-hidden="true" />{v.name}
            </li>
          ))}
        </ul>
        {accordion && <p className="m-0 mt-1 font-mono text-[11px] text-axal-muted dark:text-gray-400">One section open at a time</p>}
      </div>
      {sections.map((section) => {
        const isOpen = !accordion || open === section.key;
        return (
          <section key={section.key} className={BOX} data-testid={`dealflow-compare-phone-${section.key}`}>
            {accordion ? (
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : section.key)}
                className="-my-2 flex min-h-[44px] w-full items-center justify-between text-left text-[14px] font-bold text-axal-ink dark:text-gray-100"
                data-testid={`dealflow-compare-phone-toggle-${section.key}`}>
                {section.label}<span aria-hidden="true" className="text-gray-500">{isOpen ? '▴' : '▾'}</span>
              </button>
            ) : <h3 className="m-0 text-[14px] font-bold">{section.label}</h3>}
            {isOpen && section.rows.map((row) => (
              <div key={row.key} className="flex flex-col gap-1.5 border-t border-axal-hairline pt-2 dark:border-gray-800">
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{row.label}</span>
                {ventures.map((v, i) => {
                  const c = row.scope ? row.scope.cells[i] : null;
                  return (
                    <div key={v.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 text-[12.5px]" data-testid={`dealflow-compare-phone-cell-${row.key}-${i}`}>
                      <span className="flex min-w-0 items-center gap-1.5 text-axal-ink dark:text-gray-100">
                        <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${COMPARE_COLOURS[i].swatch}`} aria-hidden="true" /><span className="truncate">{v.name}</span>
                      </span>
                      <span className="min-w-0">
                        {c ? (c.kind === 'scored'
                          ? <span className="flex items-center gap-1.5">
                            <span className="h-2 w-16 shrink-0 rounded-sm bg-gray-100 dark:bg-gray-800"><span className={`block h-full rounded-sm ${COMPARE_COLOURS[i].bar} ${OPACITY[c.confidence] ?? 'opacity-55'}`} style={{ width: `${Math.round(barShare(c.band) * 100)}%`, ...(c.low ? HATCH : {}) }} /></span>
                            <span className={c.best ? 'font-extrabold' : 'font-semibold'}>{c.word}</span>
                            <span className="text-[11px] text-axal-muted dark:text-gray-400">{c.confidence || 'confidence not recorded'}</span>
                          </span>
                          : <span className="italic text-axal-muted dark:text-gray-400">{row.cells[i]}</span>)
                          : RICH_CELL[row.key] ? RICH_CELL[row.key](v, flowUnknown) : <span className="break-words">{row.cells[i]}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** DLS8/DLS9 from rows already read, each with its scores and fit. */
export function CompareView({ ventures, missing = 0, ids = [], flowUnknown = false }) {
  // D6149 (#6149): Remove and Add a venture work from the ventures on the page, so a pick that is not on the list drops out.
  const shownIds = ventures.map((v) => v.id);
  const addHref = addVentureHref(shownIds);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="dealflow-compare-page" data-compare-print="">
      <style>{COMPARE_PRINT_CSS}</style>
      <nav className="text-[13px] text-axal-muted dark:text-gray-400" data-print="hide"><Link to="/deals?view=table" className="font-semibold text-violet-700 underline dark:text-violet-300">Deal flow</Link> › Compare</nav>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[20px] font-extrabold">Compare · {ventures.length} ventures</h2>
        {ventures.length >= 2 && (
          <div className="flex flex-wrap gap-2" data-print="hide">
            {ventures.length < MAX_COMPARE && <Link to={addHref} className={PRIMARY} data-testid="dealflow-compare-add">Add a venture</Link>}
            <button type="button" className={BTN} onClick={() => download(compareCsv(ventures, { flowUnknown }))} data-testid="dealflow-compare-csv">Export CSV</button>
            <button type="button" className={BTN} onClick={() => window.print()} data-testid="dealflow-compare-print">Print</button>
          </div>
        )}
      </div>
      {missing > 0 && <p className={MUTED} data-testid="dealflow-compare-missing">{missing === 1 ? 'One picked venture is' : `${missing} picked ventures are`} not on the deal list, so {missing === 1 ? 'it is' : 'they are'} not compared.</p>}
      {ventures.length < 2
        ? <section className={BOX} data-testid="dealflow-compare-few"><p className="m-0 text-sm">Pick at least two ventures to compare, from <Link to={addHref} className="font-semibold text-violet-700 underline dark:text-violet-300" data-testid="dealflow-compare-few-add">the table</Link>.</p></section>
        : (
          <>
            <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4" data-print="cards">
              {ventures.map((v, i) => (
                <li key={v.id} className={BOX} data-testid={`dealflow-compare-${v.id}`}>
                  <div className="flex items-start gap-2">
                    <span className={`mt-1.5 inline-block h-3 w-3 shrink-0 rounded-full ${COMPARE_COLOURS[i].swatch}`} aria-label={`${COMPARE_COLOURS[i].name} in the chart`} role="img" data-print-swatch="" />
                    <span className="min-w-0 flex-1 font-semibold">{v.name}</span>
                    <Link to={compareHref(shownIds.filter((id) => id !== v.id))} className="-my-2.5 -mr-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-2 text-[12.5px] font-semibold text-axal-muted underline hover:text-axal-ink focus-visible:outline-2 focus-visible:outline-violet-600 dark:text-gray-400 dark:hover:text-gray-100"
                      aria-label={`Remove ${v.name} from the comparison`} data-print="hide" data-testid={`dealflow-compare-remove-${v.id}`}>Remove</Link>
                  </div>
                  {v.sector && <span className={MUTED}>{v.sector}</span>}
                  <div className="flex flex-wrap gap-1"><span className={PILL}>{flowUnknown ? 'Stage unreadable' : stageWord(v.stage)}</span><span className={PILL}>{v.round}</span></div>
                  <AskCell row={v} />
                  {v.scores.state === 'locked' ? <ScopeStrip locked /> : <ScopeStrip scopes={stripScopes(v.scores)} />}
                </li>
              ))}
              {ventures.length < MAX_COMPARE && (
                <li className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 p-4 text-center dark:border-gray-600" data-print="hide">
                  <Link to={addHref} className="font-semibold text-violet-700 underline dark:text-violet-300" data-testid="dealflow-compare-add-slot">Add a venture</Link>
                  <span className={MUTED}>Up to four</span>
                </li>
              )}
            </ul>
            <section className={BOX} aria-labelledby="compare-chart-title">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="compare-chart-title" className="m-0 text-[14px] font-bold">Scores by scope</h3>
                <a href="#compare-table" className="hidden text-[12.5px] font-semibold text-violet-700 underline md:inline dark:text-violet-300" data-print="hide">View as table</a>
              </div>
              <p className="m-0 text-[13px]" data-testid="dealflow-compare-summary">{compareSummary(ventures)}</p>
              <p className={MUTED} data-print="hide">A bar is a band: Weak, Fair or Strong, never a number. Opacity and the label show confidence. A dashed line marks a scope without a score.</p>
              <div className="hidden md:block" data-print="hide"><ScopeBars ventures={ventures} /></div>
              <div className="hidden md:block print:block"><CompareTable ventures={ventures} flowUnknown={flowUnknown} /></div>
            </section>
            <ComparePhone ventures={ventures} flowUnknown={flowUnknown} />
            <CompareNote key={(ids.length ? ids : ventures.map(v => v.id)).join(',')} ids={ids.length ? ids : ventures.map((v) => v.id)} />
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
  const [againScores, setAgainScores] = useState(0);
  const [traction, setTraction] = useState({ key: null, reads: {} });
  const [againTraction, setAgainTraction] = useState(0);
  useEffect(() => {
    let alive = true;
    setRead({ kind: 'loading' });
    // D4635 (#4635): a failed flow read is said, never read as an empty flow (which would claim "Not on your deals").
    let flowFailed = false;
    Promise.all([api.listDeals(), dealFlowApi.flow().catch((e) => { reportError('DealFlow:compare-flow', e); flowFailed = true; return { items: [] }; })]).then(
      ([deals, flow]) => { if (alive) setRead({ kind: 'ok', flowFailed, rows: flowRows('all', { flow, deals }), deals }); },
      (e) => { reportError('DealFlow:compare', e); if (alive) setRead({ kind: 'unreadable' }); },
    );
    return () => { alive = false; };
  }, [again]);
  useEffect(() => {
    let alive = true;
    if (!ids.length) return undefined;
    setScores(null); setFits(null);
    ventureScoresApi.batch(ids.map(Number)).then((s) => { if (alive) setScores(s); }, (e) => { reportError('DealFlow:compare-scores', e); if (alive) setScores('failed'); });
    dealViewsApi.fit(ids).then((f) => { if (alive) setFits(new Map((f?.items || []).map((x) => [String(x.deal_id), x]))); }, (e) => { reportError('DealFlow:compare-fit', e); if (alive) setFits('failed'); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, againScores]);
  const picked = useMemo(() => read.kind === 'ok'
    ? ids.map(id => read.rows.find(row => row.id === String(id))).filter(Boolean) : [], [read, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    setTraction({ key, reads: {} });
    for (const { id } of picked) {
      const remember = value => {
        if (alive) setTraction(current => ({ key, reads: { ...current.reads, [id]: value } }));
      };
      dealInsightsApi.traction(id).then(remember, error => remember([403, 404].includes(error?.status) ? { masked: true } : 'failed'));
    }
    return () => { alive = false; };
  }, [key, picked, againTraction]);
  const listed = new Map((Array.isArray(read.deals) ? read.deals : []).map(deal => [String(deal.id), deal]));
  const ventures = picked.map(row => ({
    ...row, close: listed.get(row.id)?.closing_deadline, valuation: listed.get(row.id)?.valuation_cap ?? null, scores: scoresOf(scores, row.id), fit: fitOf(fits, row.id),
    traction: traction.key === key ? traction.reads[row.id] : undefined,
  }));
  if (read.kind === 'loading') return <section className={BOX} aria-busy="true"><p className={MUTED}>Reading…</p></section>;
  if (read.kind === 'unreadable') return <section className={BOX}><Unreadable what="The ventures to compare" claim="That is not the same as having none." onRetry={() => setAgain((n) => n + 1)} /></section>;
  return (
    <>
      {scores === 'failed' && <p className={WARN} role="status" data-testid="dealflow-compare-scores-failed">Scores could not be read. Names, stages and money are current. <button type="button" className="font-semibold underline" onClick={() => setAgainScores((n) => n + 1)}>Try again</button></p>}
      {fits === 'failed' && <p className={WARN} role="status" data-testid="dealflow-compare-fit-failed">Fit to your thesis could not be read. The scores are current. <button type="button" className="font-semibold underline" onClick={() => setAgainScores((n) => n + 1)}>Try again</button></p>}
      {read.flowFailed && <p className={WARN} role="status" data-testid="dealflow-compare-flow-failed">Your deal flow could not be read, so where each venture is on it is not shown. <button type="button" className="font-semibold underline" onClick={() => setAgain((n) => n + 1)}>Try again</button></p>}
      {ventures.some(venture => compareTraction(venture.traction).state === 'unreadable') && <p className={WARN} role="status">Some traction figures could not be read. <button type="button" className="font-semibold underline" onClick={() => setAgainTraction(value => value + 1)}>Try again</button></p>}
      <CompareView ventures={ventures} missing={ids.length - ventures.length} ids={ventures.map((v) => v.id)} flowUnknown={!!read.flowFailed} />
    </>
  );
}


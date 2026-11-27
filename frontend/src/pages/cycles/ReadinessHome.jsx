import { Children, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Unreadable } from '../../ui';
import { CardBody } from './CycleOverview';
import { isPlainClick, safeHref } from './cycleModel';
import { HistoryCard, KitTile, PmfPart, usePmfHistory } from './PmfPart';
import { kitView, pmfView } from './pmfModel';
import { MAX_PRIORITIES, areasOf, priorities, summaryLine } from './readinessModel';
import { ShareReadinessButton } from './evidence/ShareReadiness';

/**
 * D6049 (#6049, Raise v2 RA-16) — Fundraising readiness owns its page, in one
 * order: the header names coverage and freshness (`coverageLine`, handed to
 * the header by the def), then
 *
 *   1. at most three priorities, each with its reason and one action;
 *   2. every Raise area in one table: status, evidence, why it matters, one
 *      action, and a List / Chart switch whose chart keeps the table;
 *   3. Product-market fit as its own section (`PmfPart`), not averaged in;
 *   4. Detail, collapsed: the score history, and the raise kit with its peer
 *      benchmark (the module card the generic page drew at the top).
 *
 * The AI gap analysis disclosure (`ReadinessBands`) follows, drawn by the
 * route around the page's Eadwyn bands. The page draws this in place of the
 * generic chart and records table (`home`), so nothing is drawn twice.
 *
 * Every action opens the workflow the Worker names (D5071's `fix_href`); an
 * area's name opens its record where the read links it. A read that failed
 * says so (Unreadable), and an area nobody assessed says Not recorded.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYE = 'm-0 font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const PILL = 'inline-flex w-fit items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const TONE = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  warn: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  grey: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
  dashed: 'border-dashed border-gray-400 bg-white text-axal-muted dark:border-gray-500 dark:bg-gray-900 dark:text-gray-400',
};
/** The glyph beside each word, so no state relies on colour alone (D5129). */
const GLYPH = { ok: '●', warn: '◐', bad: '○', grey: '◌', dashed: '–' };
const ACTION = 'inline-flex min-h-[36px] items-center justify-center whitespace-nowrap rounded-[9px] border border-axal-lavender-edge bg-white px-3 text-[12.5px] font-bold text-axal-violet-deep hover:bg-axal-lavender max-lg:min-h-[44px] dark:border-violet-800 dark:bg-gray-900 dark:text-violet-300 dark:hover:bg-violet-900/30';
const ADD = 'inline-flex min-h-[36px] items-center whitespace-nowrap rounded-[9px] bg-axal-violet px-3.5 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep max-lg:min-h-[44px]';
const SUMMARY = 'flex min-h-[44px] cursor-pointer flex-wrap items-baseline gap-x-2 px-4 py-2.5';

export function StatusPill({ row }) {
  return <span className={`${PILL} ${TONE[row.tone] || TONE.grey}`} data-testid="readiness-status" data-tone={row.tone}><span aria-hidden="true" className="mr-1">{GLYPH[row.tone]}</span>{row.status}</span>;
}

function ActionLink({ action, testid }) {
  if (!action?.href) return null;
  return <Link to={action.href} className={ACTION} data-testid={testid}>{action.text} ›</Link>;
}

/** The module's Add entries (Re-score), as `RecordsTable` draws them. */
function AddButtons({ add }) {
  const list = (Array.isArray(add) ? add : [add]).filter((a) => a?.text);
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((a) => {
        if (a.onClick) return <button key={a.text} type="button" onClick={a.onClick} className={ADD}>{a.text}</button>;
        const href = safeHref(a.href);
        return href ? <Link key={a.text} to={href} state={a.state} data-testid="records-add" aria-haspopup={a.onOpen ? 'dialog' : undefined}
          onClick={a.onOpen ? (e) => { if (isPlainClick(e)) { e.preventDefault(); a.onOpen(); } } : undefined} className={ADD}>{a.text}</Link> : null;
      })}
    </div>
  );
}

function Priorities({ areas, list }) {
  return (
    <section className="flex flex-col gap-2.5" aria-labelledby="readiness-priorities-title" data-testid="readiness-priorities">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="readiness-priorities-title" className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Top priorities</h2>
        <span className={`text-[12px] ${MUTED}`}>At most {MAX_PRIORITIES}</span>
      </div>
      {areas.state === 'loading' ? <div className="h-16 rounded-xl bg-axal-ground dark:bg-gray-800" aria-busy="true" /> : null}
      {areas.state === 'unreadable' ? (
        <p className={`m-0 ${CARD} px-4 py-3 text-[13px] ${INK}`} data-testid="readiness-priorities-unreadable">The priorities could not be worked out, because the areas below could not be read. This is not a claim that nothing needs attention.</p>
      ) : null}
      {areas.state === 'ready' && list.length === 0 ? (
        <p className={`m-0 ${CARD} px-4 py-3 text-[13px] ${MUTED}`} data-testid="readiness-priorities-none">
          {areas.rows.length ? 'No assessed area needs attention now.' : 'No area is assessed yet, so there is no priority to name.'}
        </p>
      ) : null}
      {list.length > 0 ? (
        <ol className="m-0 grid list-none gap-2.5 p-0 lg:grid-cols-3">
          {list.map((p, i) => (
            <li key={p.key || i} className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="readiness-priority" data-key={p.key}>
              <p className={EYE}>Priority {i + 1}</p>
              <div className="flex flex-wrap items-center gap-2">
                <b className={`text-[14px] ${INK}`}>{p.label}</b>
                <StatusPill row={p} />
              </div>
              <p className={`m-0 text-[12.5px] leading-relaxed ${MUTED}`}>{p.reason}</p>
              <div className="mt-auto"><ActionLink action={p.action} testid="readiness-priority-action" /></div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/** RA-07: an assessed area as a bar out of 10; one nobody assessed is hatched and named, never drawn as 0. */
function AreaBars({ rows }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0 px-4 py-3" data-testid="readiness-chart" aria-label="Each area's score out of 10">
      {rows.map((r) => (
        <li key={r.key || r.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-2.5 text-[12.5px]">
          <span className={`truncate font-semibold ${INK}`}>{r.label}</span>
          {r.score != null ? (
            <span className="relative block h-3 rounded border border-axal-hairline bg-axal-ground dark:border-gray-700 dark:bg-gray-800" aria-hidden="true">
              <span className="absolute inset-y-0 left-0 rounded bg-axal-violet dark:bg-violet-400" style={{ width: `${Math.max(0, Math.min(100, r.score * 10))}%` }} />
            </span>
          ) : (
            <span className="block h-3 rounded border border-dashed border-gray-400 bg-[repeating-linear-gradient(45deg,transparent_0_4px,rgba(120,120,120,.18)_4px_8px)] dark:border-gray-500" aria-hidden="true" data-testid="readiness-chart-hatched" />
          )}
          <span className={`font-mono text-[12px] ${r.score != null ? INK : MUTED}`}>{r.score != null ? `${r.score} of 10` : r.status}</span>
        </li>
      ))}
    </ul>
  );
}

function AreasTable({ areas, add, rowHref, message, onRetry }) {
  const [mode, setMode] = useState('list');
  const rows = areas.rows;
  const cols = 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.8fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_auto]';
  return (
    <section className={`${CARD} overflow-hidden`} aria-labelledby="readiness-areas-title" data-testid="readiness-areas" data-state={areas.state}>
      <div className="flex flex-col gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 id="readiness-areas-title" className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Raise readiness{areas.state === 'ready' && rows.length ? ` · ${rows.length} areas` : ''}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {areas.state === 'ready' && rows.length > 0 ? (
              <div className="inline-flex gap-0.5 rounded-[9px] border border-axal-hairline bg-axal-ground p-0.5 dark:border-gray-700 dark:bg-gray-800" role="group" aria-label="Show the areas as">
                {[['list', 'List'], ['chart', 'Chart']].map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} data-testid={`readiness-view-${k}`}
                    className={`min-h-[28px] rounded-[7px] px-3 text-[12px] max-lg:min-h-[44px] ${mode === k ? `bg-white font-bold shadow-sm dark:bg-gray-900 ${INK}` : `font-semibold ${MUTED}`}`}>{l}</button>
                ))}
              </div>
            ) : null}
            <AddButtons add={add} />
          </div>
        </div>
        {areas.state === 'ready' ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="readiness-summary">{summaryLine(rows)}</p> : null}
      </div>
      {areas.state === 'loading' ? <div className="flex flex-col gap-2 px-4 py-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-4 rounded bg-axal-ground dark:bg-gray-800" />)}</div> : null}
      {areas.state === 'unreadable' ? <div className="px-4 py-3"><Unreadable what="The readiness areas" claim={message || 'This is not a claim that none is assessed.'} onRetry={onRetry} /></div> : null}
      {areas.state === 'ready' && rows.length === 0 ? (
        <p className={`m-0 px-4 py-5 text-[13px] ${MUTED}`} data-testid="readiness-areas-empty">No area is assessed yet. Re-score reads what each area’s check can measure; Team is scored on its record.</p>
      ) : null}
      {areas.state === 'ready' && rows.length > 0 && mode === 'chart' ? <AreaBars rows={rows} /> : null}
      {areas.state === 'ready' && rows.length > 0 ? (
        <div role="table" aria-label="Raise readiness areas" className={mode === 'chart' ? 'border-t border-axal-hairline dark:border-gray-800' : ''}>
          <div role="row" className={`hidden gap-2.5 border-b border-axal-hairline bg-axal-ground/60 px-4 py-2 text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted lg:grid dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-400 ${cols}`}>
            {['Area', 'Status', 'Evidence', 'Why it matters'].map((c) => <span key={c} role="columnheader">{c}</span>)}
            <span role="columnheader" className="sr-only">Action</span>
          </div>
          {rows.map((r) => {
            const href = rowHref?.(r.raw) || null;
            return (
              <div key={r.key || r.label} role="row" className={`grid gap-x-2.5 gap-y-1.5 border-b border-axal-ground px-4 py-3 text-[12.5px] last:border-b-0 lg:items-start ${cols} dark:border-gray-800`} data-testid="readiness-area" data-key={r.key} data-state={r.state}>
                <span role="cell" className={`font-semibold ${INK}`}>{href ? <Link to={href} className="hover:underline">{r.label}</Link> : r.label}</span>
                <span role="cell"><StatusPill row={r} /></span>
                <span role="cell" className="flex flex-col gap-0.5">
                  <span className={r.state === 'not_recorded' ? MUTED : INK} data-testid="readiness-evidence">{r.evidence}</span>
                  {r.evidenceSub ? <span className={`font-mono text-[11.5px] ${MUTED}`}>{r.evidenceSub}</span> : null}
                  {r.freshness ? <span className={`font-mono text-[11.5px] ${MUTED}`}>{r.freshness}</span> : null}
                  <span className={`font-mono text-[11.5px] ${MUTED}`} data-testid="readiness-target">Target: {r.target}</span>
                </span>
                <span role="cell" className={MUTED}>{r.why ? <><span className="mr-1.5 text-[10.5px] uppercase tracking-[.06em] text-axal-faint lg:hidden">Why it matters</span>{r.why}</> : null}</span>
                <span role="cell" className="lg:justify-self-end"><ActionLink action={r.action} testid="readiness-area-action" /></span>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function Fold({ title, sub, testid, children }) {
  return (
    <details className={`group ${CARD}`} data-testid={testid}>
      <summary className={SUMMARY}>
        <b className={`text-[13.5px] ${INK}`}>{title}</b>
        <span className={`text-[12px] ${MUTED}`}>{sub}</span>
        <span aria-hidden="true" className={`ml-auto ${MUTED} group-open:rotate-180`}>▾</span>
      </summary>
      <div className="flex min-w-0 flex-col gap-3 border-t border-axal-hairline px-4 py-3 dark:border-gray-800">{children}</div>
    </details>
  );
}

export default function ReadinessHome({
  card = null, records = null, recordsStatus = 'ready', recordsMessage = '', add = null, rowHref = null,
  onRetry = null, onRetryRecords = null, search = '', part = undefined, projectId = null, reload = null, role = null,
}) {
  const areas = useMemo(() => areasOf(records, recordsStatus), [records, recordsStatus]);
  const list = useMemo(() => (areas.state === 'ready' ? priorities(areas.rows) : []), [areas]);
  const kit = useMemo(() => kitView(card), [card]);
  const pmfReadable = pmfView(part).kind !== 'unreadable';
  // One history read for the PMF tile's sparkline and Detail's history.
  const history = usePmfHistory(projectId, pmfReadable ? part?.id ?? 'none' : null);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="readiness-home">
      {/* D6897 (RA-30): the snapshot as a dated link, offered to founders; the Worker lets only the venture's founders make one. */}
      {projectId && role === 'founder' ? <div className="flex justify-end"><ShareReadinessButton projectId={projectId} /></div> : null}
      <Priorities areas={areas} list={list} />
      <AreasTable areas={areas} add={add} rowHref={rowHref} message={recordsMessage} onRetry={onRetryRecords || onRetry} />
      <PmfPart part={part} projectId={projectId} reload={reload} history={history} />
      <section className="flex flex-col gap-2" aria-label="Detail" data-testid="readiness-detail">
        <p className={EYE}>Detail</p>
        <Fold title="Score history" sub="Product-market fit over time, with a table view" testid="readiness-history">
          <HistoryCard history={history} pivotAt={part?.pivot_at ?? null} />
        </Fold>
        <Fold title="Raise kit and peer benchmark" sub="Supporting models, kept below the priorities" testid="readiness-kit">
          <KitTile kit={kit} />
          {/* The module card the generic page drew first: the items' bars, the kit over time, the benchmark and Team's reads. Its one step is a priority above. */}
          <CardBody card={card && card.next ? { ...card, next: null } : card} onRetry={onRetry} search={search} />
        </Fold>
      </section>
    </div>
  );
}

/**
 * The page's Eadwyn readings, collapsed (RA-16: "AI gap analysis · Eadwyn’s
 * reading; proposals only"): the room and the clauses bands and the
 * Product-market fit reading. The route wraps what it would have drawn in
 * this, so the bands, their rail options and their switch are unchanged.
 * With nothing to draw (the switch off, no venture) it draws nothing.
 */
export function ReadinessBands({ children }) {
  if (Children.toArray(children).length === 0) return null;
  return (
    <details className={`group ${CARD}`} data-testid="readiness-ai">
      <summary className={SUMMARY}>
        <b className={`text-[13.5px] ${INK}`}>AI gap analysis</b>
        <span className={`text-[12px] ${MUTED}`}>Eadwyn’s reading; proposals only, never a change until you keep one</span>
        <span aria-hidden="true" className={`ml-auto ${MUTED} group-open:rotate-180`}>▾</span>
      </summary>
      <div className="flex min-w-0 flex-col gap-3 border-t border-axal-hairline px-4 py-3 dark:border-gray-800">{children}</div>
    </details>
  );
}

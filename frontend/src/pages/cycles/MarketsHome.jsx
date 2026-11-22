/**
 * D6120 (#6120, Grow v2 Markets GR-21, GR-23, GR-25, GR-26, GR-27) — /grow/market-expansion's own page: the
 * venture's markets ranked by readiness out of 40, unscored ones last with their missing parts named, each
 * row's next step, the state chips and sort, Compare as a panel on the same page, first use, one market, and
 * the loading and Unavailable states. Desktop draws a table; below 1024px (`phone`) the same rows are cards.
 *
 * It owns the module's body (`defs/grow.jsx` `homes`), so the generic chart and records table are not drawn.
 * Filter and sort go through the read (`onQuery`): nothing is filtered in the browser, so every count is the
 * store's. The chips count every market (`parts.state_counts`), whatever the filter.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataState, StateChip } from '../../ui/Honesty.jsx';
import {
  MARKET_DECISIONS, MARKET_PARTS, MARKET_STATES, SORTS, compareSummary, dayLabel, diffWords, marketView, missingLine,
  nextStep, sizeLabel, stateChips,
} from './marketsModel.js';

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const BTN = 'inline-flex min-h-[36px] items-center justify-center whitespace-nowrap rounded-[9px] border px-3.5 text-[12.5px] font-bold max-lg:min-h-[44px]';
const PRIMARY = `${BTN} border-axal-violet bg-axal-violet text-white hover:bg-axal-violet-deep dark:border-violet-500 dark:bg-violet-600 dark:hover:bg-violet-500`;
const SECONDARY = `${BTN} border-axal-hairline bg-white text-axal-ink hover:border-axal-violet disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100`;
const LINK = 'font-semibold text-axal-violet-deep hover:underline dark:text-violet-300';
const MUTED = 'text-axal-muted dark:text-gray-400';

/** A state: its glyph and its word (GR-21), never a colour alone. */
export function StatePill({ state }) {
  const s = MARKET_STATES[state];
  if (!s) return <DataState state="not_recorded" reasonVisible={false} reason="No state recorded" />;
  return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-axal-hairline bg-axal-ground px-2 py-0.5 text-[11px] font-bold text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" data-testid="market-state">
    <i aria-hidden="true" className="not-italic">{s.glyph}</i>{s.label}</span>;
}

/** The decision and the day it was taken, or Not recorded: Not decided. */
export function DecisionPill({ decision, on, short = false }) {
  const d = MARKET_DECISIONS[decision];
  if (!d) return <DataState state="not_recorded" reason="Not decided" data-testid="market-decision" />;
  const day = dayLabel(on, short);
  return <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid="market-decision">
    <i aria-hidden="true" className="not-italic">{d.glyph}</i>{d.label}
    {day ? <small className="font-normal text-axal-muted dark:text-gray-400">{short ? day : `decided ${day}`}</small> : null}</span>;
}

/** Readiness: "28 / 40" (read "28 out of 40, current"), or Not recorded naming the unscored parts. */
export function Readiness({ view, big = false }) {
  if (view.readiness == null) return <DataState state="not_recorded" reason={missingLine(view.missing)} data-testid="market-readiness" />;
  return <span className={`font-mono ${big ? 'text-[18px]' : 'text-[13px]'} text-axal-ink dark:text-gray-100`} data-testid="market-readiness">
    <b aria-hidden="true">{view.readiness}</b><span aria-hidden="true"> / 40</span><span className="sr-only">{view.readiness} out of 40, current</span></span>;
}

/** The weakest part: its name and score ("measured 0" for a zero), or "not scored". */
export function Weakest({ view }) {
  const w = view.weakest;
  if (!w) return <DataState state="not_recorded" reasonVisible={false} />;
  return <span className="inline-flex flex-col" data-testid="market-weakest"><b className="text-[12.5px] text-axal-ink dark:text-gray-100">{w.part}</b>
    <small className={`text-[11px] ${MUTED}`}>{w.score == null ? 'not scored' : <span className="font-mono">{w.score} / 10{w.score === 0 ? ' · measured 0' : ''}</span>}</small></span>;
}

/** A part's score in a compare cell: "7 / 10" and its source, or Not recorded (never 0). */
function PartCell({ part }) {
  if (part.score == null) return <DataState state="not_recorded" reasonVisible={false} reason={`No ${part.part.toLowerCase()} score`} />;
  return <span className="flex flex-col"><span className="font-mono text-[13px] text-axal-ink dark:text-gray-100"><b>{part.score}</b> / 10{part.score === 0 ? ' · measured 0' : ''}</span>
    {part.source && <small className={`text-[11px] ${MUTED}`}>{part.source}</small>}</span>;
}

const Diff = ({ d }) => (!d ? null : d.compared ? <span>{d.text}</span>
  : <span className={`text-[12px] ${MUTED}`} data-testid="market-diff-nc"><span aria-hidden="true">○ </span>{d.text}</span>);

function planCell(v, kind) {
  if (kind === 'loc') return v.localisation ? `${v.localisation.done} of 3 done` : null;
  if (!v.plan) return null;
  return v.plan.total ? `${v.plan.open} of ${v.plan.total} open` : '0 · no steps yet';
}

/** GR-23: Compare two markets, as a panel on Markets (the owner's answer A, D6119-p2). */
export function ComparePanel({ a, b, onClose, phone = false }) {
  const sum = compareSummary(a, b);
  const nrCell = (text) => text ?? <DataState state="not_recorded" reasonVisible={false} reason="Could not be read with the list" />;
  const rows = [
    ...MARKET_PARTS.map(([key, part]) => ({ key, head: part, a: <PartCell part={a.parts.find((p) => p.key === key)} />, b: <PartCell part={b.parts.find((p) => p.key === key)} />, diff: <Diff d={diffWords(a, b, key)} /> })),
    { key: 'readiness', head: 'Readiness', note: 'out of 40, current', a: <Readiness view={a} />, b: <Readiness view={b} />, diff: <Diff d={sum.readiness} /> },
    { key: 'weakest', head: 'Weakest part', a: <Weakest view={a} />, b: <Weakest view={b} />, diff: sum.weakest },
    { key: 'loc', head: 'Localisation', a: nrCell(planCell(a, 'loc')), b: nrCell(planCell(b, 'loc')) },
    { key: 'steps', head: 'Open entry steps', a: nrCell(planCell(a, 'steps')), b: nrCell(planCell(b, 'steps')) },
    { key: 'size', head: 'Size', a: a.size ? <SizeCell size={a.size} /> : <DataState state="not_recorded" reason="No size recorded" />, b: b.size ? <SizeCell size={b.size} /> : <DataState state="not_recorded" reason="No size recorded" />, diff: sum.size },
    { key: 'decision', head: 'Decision', a: <DecisionPill decision={a.decision} on={a.decidedOn} />, b: <DecisionPill decision={b.decision} on={b.decidedOn} /> },
  ];
  const title = `Compare ${a.name} and ${b.name}`;
  return (
    <section className={`${CARD} flex flex-col gap-3 p-4`} aria-labelledby="market-compare-title" data-testid="market-compare">
      <div className="flex items-start justify-between gap-2">
        <h2 id="market-compare-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close compare" className="min-h-[36px] min-w-[36px] rounded-[9px] border border-axal-hairline text-axal-muted hover:text-axal-ink max-lg:min-h-[44px] max-lg:min-w-[44px] dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-100">✕</button>
      </div>
      {phone ? (
        <div className="flex flex-col gap-2.5" data-testid="market-compare-stacked">
          {rows.map((r) => (
            <section key={r.key} className="rounded-[10px] border border-axal-hairline p-3 dark:border-gray-800" aria-label={r.head}>
              <h3 className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.head}{r.note ? <small className={`ml-1 font-normal ${MUTED}`}>{r.note}</small> : null}</h3>
              <dl className="m-0 mt-1.5 grid grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] gap-x-2 gap-y-1 text-[12.5px]">
                <dt className={MUTED}>{a.name}</dt><dd className="m-0">{r.a}</dd>
                <dt className={MUTED}>{b.name}</dt><dd className="m-0">{r.b}</dd>
              </dl>
              {r.diff ? <p className="m-0 mt-1.5 text-[12.5px] text-axal-ink dark:text-gray-200">{r.diff}</p> : null}
            </section>
          ))}
        </div>
      ) : (
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead><tr className={`text-[10.5px] uppercase tracking-[.06em] ${MUTED}`}>
            <th scope="col" className="w-[150px] py-1.5"><span className="sr-only">Part</span></th><th scope="col" className="py-1.5">{a.name}</th><th scope="col" className="py-1.5">{b.name}</th><th scope="col" className="py-1.5">Difference, in words</th>
          </tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.key} className="border-t border-axal-ground align-top dark:border-gray-800">
              <th scope="row" className="py-2 pr-2 font-bold text-axal-ink dark:text-gray-100">{r.head}{r.note ? <small className={`block font-normal ${MUTED}`}>{r.note}</small> : null}</th>
              <td className="py-2 pr-2">{r.a}</td><td className="py-2 pr-2">{r.b}</td><td className="py-2 text-axal-ink dark:text-gray-200">{r.diff}</td>
            </tr>))}</tbody>
        </table>
      )}
      <p className={`m-0 text-[11.5px] ${MUTED}`}>Scores, sources, localisation and entry steps from the Markets list. An unscored part reads Not recorded and is not compared, never 0.</p>
    </section>
  );
}

function SizeCell({ size }) {
  return <span className="flex flex-col"><b className="font-mono text-[13px] text-axal-ink dark:text-gray-100">{sizeLabel(size)}</b>
    {size.source ? <small className={`text-[11px] ${MUTED}`}>{size.source}</small> : <small className={`text-[11px] ${MUTED}`}>Source not recorded</small>}</span>;
}

/** A pick-to-compare box, 44px on a phone. */
function PickBox({ view, picked, disabled, onPick }) {
  return <label className="inline-flex min-h-[36px] min-w-[36px] cursor-pointer items-center justify-center max-lg:min-h-[44px] max-lg:min-w-[44px]">
    <input type="checkbox" className="h-[18px] w-[18px] accent-axal-violet" checked={picked} disabled={disabled && !picked}
      onChange={() => onPick(view.uid)} aria-label={`Pick ${view.name} to compare`} data-testid="market-pick" />
  </label>;
}

function NextCell({ view, href, canWrite }) {
  const step = canWrite ? nextStep(view) : null;
  if (!step || !href) return <span className={MUTED} aria-label="No next step">—</span>;
  const to = step.hash ? `${href}#${step.hash}` : href;
  return <Link to={to} state={step.open ? { editing: step.open } : undefined} className={`relative z-10 text-[12.5px] ${LINK}`} data-testid="market-next">{step.text} →</Link>;
}

function countryLine(v) {
  const where = v.country ? [v.country.name, v.country.region].filter(Boolean).join(' · ') : v.geography ? v.geography : 'No country attached';
  const replies = Array.isArray(v.replies) && v.replies.length ? ` · ${v.replies.length} ${v.replies.length === 1 ? 'reply' : 'replies'}` : '';
  return `${where}${replies}`;
}

/** The page's Add market (the module's own form, `forms.js` `market`). */
function AddButton({ add, label }) {
  const a = (Array.isArray(add) ? add : [add]).find((x) => x?.text && x?.href);
  if (!a) return null;
  return <Link to={a.href} state={a.state} className={PRIMARY} data-testid="markets-add">{label || a.text}</Link>;
}

export default function MarketsHome({ records, recordsStatus = 'ready', recordsMessage = '', add, rowHref, onRetryRecords, phone = false, query = {}, onQuery, parts = null }) {
  const [picked, setPicked] = useState([]);
  const [comparing, setComparing] = useState(false);
  const canWrite = parts?.can_write === true;
  const rows = (Array.isArray(records?.rows) ? records.rows : []).filter((r) => r?.market);
  const views = rows.map((r) => ({ row: r, view: marketView(r.market) }));
  const filter = query?.filter?.state || '';
  const sort = query?.sort || '-readiness';
  const total = typeof records?.total === 'number' ? records.total : views.length;
  const chips = stateChips(parts?.state_counts);
  const everything = chips[0].count;
  const set = (patch) => onQuery?.({ ...query, page: 1, ...patch });
  const pickedViews = picked.map((uid) => views.find((x) => x.view.uid === uid)?.view).filter(Boolean);
  const onPick = (uid) => { setComparing(false); setPicked((p) => (p.includes(uid) ? p.filter((x) => x !== uid) : p.length >= 2 ? p : [...p, uid])); };
  const one = everything === 1 || (everything == null && !filter && total === 1);

  const compareButton = one
    ? <span className="inline-flex flex-col items-end"><button type="button" className={SECONDARY} disabled aria-describedby="markets-compare-why" data-testid="markets-compare">Compare</button>
      <small id="markets-compare-why" className={`text-[11px] ${MUTED}`}>Add a second market to compare</small></span>
    : <span className="inline-flex flex-col items-end"><button type="button" className={SECONDARY} disabled={pickedViews.length !== 2} aria-describedby={pickedViews.length !== 2 ? 'markets-compare-why' : undefined}
      onClick={() => setComparing(true)} data-testid="markets-compare">Compare{pickedViews.length ? ` ${pickedViews.length}` : ''}</button>
      {pickedViews.length !== 2 && <small id="markets-compare-why" className={`text-[11px] ${MUTED}`}>Pick two markets to compare</small>}</span>;

  const head = (
    <div className="flex flex-wrap items-start justify-between gap-2.5" data-testid="markets-head">
      <p className={`m-0 text-[13px] ${MUTED}`}>Which market next, and why?</p>
      <div className="flex flex-wrap items-start gap-2">
        {recordsStatus === 'ready' && total + (everything ?? 0) > 0 && compareButton}
        {canWrite && <AddButton add={add} />}
      </div>
    </div>
  );

  if (recordsStatus === 'loading') {
    return <div className="flex min-w-0 flex-col gap-3" data-testid="markets-home" data-state="loading">{head}
      <section className={`${CARD} p-4`} aria-busy="true" aria-label="Loading markets"><DataState state="loading" size="block" /></section></div>;
  }
  if (recordsStatus === 'unreadable') {
    return <div className="flex min-w-0 flex-col gap-3" data-testid="markets-home" data-state="unreadable">
      <div className="flex flex-wrap items-start justify-between gap-2.5"><p className={`m-0 text-[13px] ${MUTED}`}>Which market next, and why?</p>{canWrite && <AddButton add={add} />}</div>
      <section className={`${CARD} p-4`} aria-labelledby="markets-fail-title">
        <h2 id="markets-fail-title" className="m-0 mb-2 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">Your markets</h2>
        <DataState state="unavailable" size="block" what="The market list" announce="always" retryLabel="Try again" onRetry={onRetryRecords}
          claim="Your markets are not lost, and they are not shown as an empty list." reason={recordsMessage || undefined} />
        <p className={`m-0 mt-2 text-[12px] ${MUTED}`}>{canWrite ? 'Add market still works. ' : ''}Filters, sort, compare and the next steps return with the list.</p>
      </section>
    </div>;
  }

  // GR-25: first use, nothing recorded and no filter narrowing it.
  if (!filter && total === 0 && !everything) {
    return <div className="flex min-w-0 flex-col gap-3" data-testid="markets-home" data-state="zero">
      <section className={`${CARD} flex flex-col items-start gap-2.5 px-4 py-5`} aria-labelledby="markets-zero-title" data-testid="markets-zero">
        <h2 id="markets-zero-title" className="m-0 text-[16px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">No markets yet</h2>
        <p className="m-0 max-w-[62ch] text-[13px] leading-relaxed text-axal-ink/80 dark:text-gray-300">Add the markets you might go after. Each is scored on four parts — Demand, Regulation, Partners and Cost to enter — and readiness appears once all four are scored.</p>
        {canWrite ? <AddButton add={add} label="Add your first market" /> : <p className={`m-0 text-[12.5px] ${MUTED}`}>Nothing recorded yet. The founder adds markets here.</p>}
      </section>
    </div>;
  }

  const readOnly = parts && parts.can_write === false;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="markets-home" data-state="ready">
      {head}
      {readOnly && <p role="status" className="m-0 rounded-[10px] border border-axal-hairline bg-axal-ground px-3.5 py-2.5 text-[12.5px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200" data-testid="markets-read-only">
        <span aria-hidden="true">⦸ </span>You can read this venture’s markets; the founder can make you a writer.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Filter by state" className="flex flex-wrap gap-1.5" data-testid="markets-chips">
          {chips.map((c) => (
            <button key={c.value || 'all'} type="button" role="radio" aria-checked={filter === c.value} onClick={() => set({ filter: { ...(query.filter || {}), state: c.value } })}
              className={`min-h-[32px] rounded-full border px-3 text-[12px] font-semibold max-lg:min-h-[44px] ${filter === c.value
                ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300'
                : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}>
              {c.label} <span className="font-mono">{c.count == null ? '' : c.count}</span>
            </button>))}
        </div>
        <label className={`flex items-center gap-2 text-[12px] ${MUTED}`}>Sort
          <select value={sort} onChange={(e) => set({ sort: e.target.value })} data-testid="markets-sort"
            className="min-h-[32px] rounded-full border border-axal-hairline bg-white px-3 text-[12px] font-semibold text-axal-ink max-lg:min-h-[44px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select></label>
      </div>
      {parts?.plan_state === 'unreadable' && <DataState state="unavailable" size="block" what="Entry steps and localisation checks"
        claim="Next steps past scoring, and Compare’s localisation and open steps, read Not recorded until they can be read." />}

      {comparing && pickedViews.length === 2 && <ComparePanel a={pickedViews[0]} b={pickedViews[1]} phone={phone} onClose={() => setComparing(false)} />}

      {views.length === 0 ? (
        <section className={`${CARD} px-4 py-5`} data-testid="markets-none"><DataState state="none">{`No market is ${MARKET_STATES[filter]?.label.toLowerCase() || 'in this filter'}.`}</DataState></section>
      ) : phone ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label="Markets, ranked by readiness" data-testid="markets-cards">
          {views.map(({ row, view }) => {
            const href = rowHref?.(row);
            return <li key={row.id} className={`${CARD} relative flex flex-col gap-2 p-3.5`} data-testid="market-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">{href ? <Link to={href} className="text-[15px] font-bold text-axal-ink after:absolute after:inset-0 dark:text-gray-100">{view.name}</Link> : <b className="text-[15px] text-axal-ink dark:text-gray-100">{view.name}</b>}
                  <small className={`block text-[11.5px] ${MUTED}`}>{countryLine(view)}</small></div>
                <span className="relative z-10"><PickBox view={view} picked={picked.includes(view.uid)} disabled={picked.length >= 2} onPick={onPick} /></span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5"><StatePill state={view.state} /><DecisionPill decision={view.decision} on={view.decidedOn} short /></div>
              <dl className="m-0 grid grid-cols-2 gap-2 text-[12px]">
                <div><dt className={MUTED}>Readiness</dt><dd className="m-0"><Readiness view={view} /></dd></div>
                <div><dt className={MUTED}>Weakest</dt><dd className="m-0"><Weakest view={view} /></dd></div>
              </dl>
              <NextCell view={view} href={href} canWrite={canWrite} />
            </li>;
          })}
        </ul>
      ) : (
        <section className={`${CARD} overflow-hidden`} aria-labelledby="markets-table-title">
          <h2 id="markets-table-title" className="sr-only">Markets, ranked by readiness</h2>
          <table className="w-full border-collapse text-left text-[12.5px]" data-testid="markets-table">
            <thead><tr className={`border-b border-axal-hairline bg-axal-ground/60 text-[10.5px] uppercase tracking-[.06em] dark:border-gray-800 dark:bg-gray-800/60 ${MUTED}`}>
              <th scope="col" className="w-[44px] px-3 py-2"><span className="sr-only">Pick</span></th>
              <th scope="col" className="py-2 pr-3">Market</th><th scope="col" className="py-2 pr-3">State</th>
              <th scope="col" className="py-2 pr-3">Readiness <span className="font-mono">/40</span></th><th scope="col" className="py-2 pr-3">Weakest part</th>
              <th scope="col" className="py-2 pr-3">Decision</th><th scope="col" className="py-2 pr-3">Next step</th>
            </tr></thead>
            <tbody>{views.map(({ row, view }) => {
              const href = rowHref?.(row);
              const on = picked.includes(view.uid);
              return <tr key={row.id} className={`border-b border-axal-ground align-top last:border-b-0 dark:border-gray-800 ${on ? 'bg-axal-lavender/40 dark:bg-violet-900/20' : ''}`} data-testid="market-row">
                <td className="px-3 py-2"><PickBox view={view} picked={on} disabled={picked.length >= 2} onPick={onPick} /></td>
                <td className="py-2.5 pr-3">{href ? <Link to={href} className="font-bold text-axal-ink hover:underline dark:text-gray-100">{view.name}</Link> : <b className="text-axal-ink dark:text-gray-100">{view.name}</b>}
                  <small className={`block text-[11px] ${MUTED}`}>{countryLine(view)}</small></td>
                <td className="py-2.5 pr-3"><StatePill state={view.state} /></td>
                <td className="py-2.5 pr-3"><Readiness view={view} /></td>
                <td className="py-2.5 pr-3"><Weakest view={view} /></td>
                <td className="py-2.5 pr-3"><DecisionPill decision={view.decision} on={view.decidedOn} short /></td>
                <td className="py-2.5 pr-3"><NextCell view={view} href={href} canWrite={canWrite} /></td>
              </tr>;
            })}</tbody>
          </table>
        </section>
      )}

      <div className={`flex flex-wrap items-center justify-between gap-2 text-[12px] ${MUTED}`} data-testid="markets-count">
        <span>{total} {total === 1 ? 'market' : 'markets'}{views.length ? ' · readiness out of 40, current' : ''}</span>
        {sort === '-readiness' && views.length > 1 && <span>Unscored markets sort after scored ones</span>}
        {typeof records?.page_size === 'number' && total > records.page_size && (
          <nav aria-label="Pages" className="flex gap-1.5">
            <button type="button" className={SECONDARY} disabled={(records.page || 1) <= 1} onClick={() => onQuery?.({ ...query, page: (records.page || 1) - 1 })}>Previous</button>
            <button type="button" className={SECONDARY} disabled={(records.page || 1) * records.page_size >= total} onClick={() => onQuery?.({ ...query, page: (records.page || 1) + 1 })}>Next</button>
          </nav>)}
      </div>
      {!phone && <div className={`grid gap-2 text-[12px] lg:grid-cols-3 ${MUTED}`} data-testid="markets-legend">
        <span><b className="text-axal-ink dark:text-gray-100">Readiness</b> the sum of four parts scored 0–10, shown only when all four are scored.</span>
        <span><b className="text-axal-ink dark:text-gray-100">Weakest part</b> the lowest score, or the first unscored part.</span>
        <span><b className="text-axal-ink dark:text-gray-100">Next step</b> the first unscored part; then the first entry step, then the first open localisation check.</span>
      </div>}
      {parts?.replies_state === 'unreadable' && <p className="m-0 text-[12px]"><StateChip kind="unavailable" /> <span className={MUTED}>Replies to a market ask couldn’t be read; the counts beside each market leave them out.</span></p>}
    </div>
  );
}

/**
 * D1240 (#3253) — the table (DLS2, DLS2b) and its phone cards (DLS18a). The
 * compare tick and Venture stay put while the scopes scroll; every head sorts
 * and a scope's ≥ sets its minimum band. A score is its band and confidence,
 * never a number; the scorecard strip draws the bands.
 *
 * D4815 DX2 (#5901, board DE02): My stage stays put beside Venture; each row
 * opens a quick preview under it (one at a time, `previewOf`), and the footer
 * pages by number as well as by ‹ ›. Every sortable head carries `aria-sort`.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScopeStrip } from '../../../components/scoring/scorecard/Scorecard';
import { AskCell, DaysCell, FitCell, OwnerCell, ScopeCell, VentureCell } from './FlowCells';
import {
  COLUMNS, PAGE_SIZE, SCOPE_SHORT, SHORT_LINE, enteredWord, pageNumbers, pageOf, pagesFor, previewOf, shortDayOf, stageWord, stripScopes,
} from './flowModel';
import { MAX_COMPARE } from './dealFlowModel';

const MUTED = 'text-[12px] text-axal-muted dark:text-gray-400';
const STICKY = 'sticky z-10 bg-white dark:bg-gray-900';
// The two fixed columns' widths, so My stage can sit exactly after Venture (the tick is w-8 = 32px).
const VENTURE_W = 'w-[200px] min-w-[200px] max-w-[200px]';
const STAGE_LEFT = 'left-[232px]';
const HEAD_BTN = 'inline-flex items-center gap-1 font-bold uppercase hover:text-axal-ink dark:hover:text-gray-100';
const NEXT_MIN = { '': 'fair', fair: 'strong', strong: '' };
const MIN_MARK = { '': '≥', fair: '≥ Fair', strong: '≥ Strong' };

function Head({ col, sort, onSort, min, onMin }) {
  const on = sort.by === col.id || (col.id === 'days' && sort.by === 'days');
  const sortable = col.scope || ['fit', 'days', 'ask'].includes(col.id);
  return (
    <th className="whitespace-nowrap px-2 py-1.5 text-left text-[11px] text-gray-500 dark:text-gray-400" aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      {sortable
        ? <button type="button" className={HEAD_BTN} onClick={() => onSort({ ...sort, by: col.id, dir: on && sort.dir === 'desc' ? 'asc' : 'desc' })} data-testid={`dealflow-head-${col.id}`}>{col.scope ? SCOPE_SHORT[col.id] : col.label}{on ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button>
        : <span className="font-bold uppercase">{col.label}</span>}
      {col.scope && (
        <button type="button" className={`ml-1 rounded px-1 text-[10.5px] ${min ? 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200' : 'text-gray-400 hover:text-axal-ink dark:text-gray-500 dark:hover:text-gray-100'}`}
          onClick={() => onMin(col.id, NEXT_MIN[min || ''])} aria-label={`Minimum for ${col.label}: ${min || 'any'}`} data-testid={`dealflow-min-${col.id}`}>{MIN_MARK[min || '']}</button>
      )}
    </th>
  );
}

function Cell({ col, row, words, onAdd }) {
  switch (col.id) {
    case 'stage': return row.inFlow ? <span>{stageWord(row.stage)}</span> : (
      <span className="flex flex-col"><span className={MUTED}>Not on your deals</span><button type="button" className="w-fit text-[12px] font-semibold text-violet-700 underline hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-100" onClick={() => onAdd(row)} aria-haspopup="dialog" data-testid={`dealflow-add-${row.id}`}>Add to my deal flow</button></span>
    );
    case 'round': return <span className="whitespace-nowrap rounded-full border border-axal-hairline px-2 py-0.5 text-[12px] dark:border-gray-700">{row.round}</span>;
    case 'ask': return <AskCell row={row} />;
    case 'scorecard': return row.scores.state === 'locked' ? <ScopeStrip locked /> : <ScopeStrip scopes={stripScopes(row.scores)} />;
    case 'fit': return <FitCell fit={row.fit} testId={`dealflow-cell-${row.id}-fit`} />;
    case 'days': return <DaysCell row={row} />;
    case 'owner': return <OwnerCell row={row} />;
    case 'entered': return row.enteredVia ? <span className="flex flex-col"><span>{enteredWord(row.enteredVia)}</span>{row.enteredAt && <span className={MUTED}>{shortDayOf(row.enteredAt)}</span>}</span> : <span className={MUTED}>—</span>;
    default: return <ScopeCell scores={row.scores} scope={col.id} words={words} testId={`dealflow-cell-${row.id}-${col.id}`} />;
  }
}

/** DE02's quick preview: what the reads carry about one row, and the way into the deal. */
function Preview({ row, span, onPeek }) {
  return (
    <tr className="border-t border-violet-100 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/30" data-testid={`dealflow-preview-${row.id}`}>
      <td colSpan={span} className="px-4 py-3" id={`dealflow-preview-cell-${row.id}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
            {previewOf(row).map((l) => (
              <React.Fragment key={l.label}>
                <dt className="font-semibold text-axal-muted dark:text-gray-400">{l.label}</dt>
                <dd className={`m-0 whitespace-normal ${l.muted ? MUTED : 'text-axal-ink dark:text-gray-100'}`}>{l.text}</dd>
              </React.Fragment>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            {row.canOpen
              ? <Link to={`/deals/${row.id}`} className="rounded-[9px] border border-axal-hairline px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:bg-white dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800" data-testid={`dealflow-preview-open-${row.id}`}>Open deal</Link>
              : <span className={MUTED} data-testid={`dealflow-preview-closed-${row.id}`}>Opens once you are invited or commit.</span>}
            {onPeek && <button type="button" className="rounded-[9px] border border-axal-hairline px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:bg-white dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800" onClick={() => onPeek(row)} aria-haspopup="dialog">Details</button>}
          </div>
        </div>
      </td>
    </tr>
  );
}

export function FlowTable({ rows, columns, sort, onSort, filters, onMin, picked, onPick, onAdd, page, onPage, words, onWords, onPeek = null }) {
  // My stage is fixed beside Venture (DE02), so it leaves the scrolling set.
  const fixedStage = columns.includes('stage');
  const cols = COLUMNS.filter((c) => c.id !== 'stage' && columns.includes(c.id));
  const pages = pagesFor(rows.length);
  const shown = pageOf(rows, page);
  const span = 2 + (fixedStage ? 1 : 0) + cols.length;
  // One preview open at a time; a new page, sort or filter closes it.
  const [open, setOpen] = useState(null);
  useEffect(() => { setOpen(null); }, [page, sort.by, sort.dir, rows.length]);
  const ventureSort = sort.by === 'name' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-testid="dealflow-table">
      <p className={`m-0 ${MUTED}`}>{SHORT_LINE} Hover a score for its band and confidence. Venture stays put; scopes scroll sideways.</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-axal-hairline dark:border-gray-800">
              <th className={`${STICKY} left-0 w-8 px-1`}><span className="sr-only">Compare</span></th>
              <th className={`${STICKY} left-8 ${VENTURE_W} px-2 text-left text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400`} aria-sort={ventureSort}>
                <button type="button" className={HEAD_BTN} onClick={() => onSort({ ...sort, by: 'name', dir: sort.by === 'name' && sort.dir === 'asc' ? 'desc' : 'asc' })} data-testid="dealflow-head-name">Venture{ventureSort ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button>
              </th>
              {fixedStage && <th className={`${STICKY} ${STAGE_LEFT} whitespace-nowrap border-r border-axal-hairline px-2 py-1.5 text-left text-[11px] text-gray-500 dark:border-gray-800 dark:text-gray-400`} data-testid="dealflow-head-stage"><span className="font-bold uppercase">My stage</span></th>}
              {cols.map((c) => <Head key={c.id} col={c} sort={sort} onSort={onSort} min={filters.min[c.id] || ''} onMin={onMin} />)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <React.Fragment key={r.id}>
                <tr className={`border-t border-gray-100 align-top dark:border-gray-800 ${open === r.id ? 'bg-violet-50/60 dark:bg-violet-950/30' : ''}`} data-testid={`dealflow-row-${r.id}`}>
                  <td className={`${STICKY} left-0 px-1 py-2`}><input type="checkbox" aria-label={`Compare ${r.name}`} checked={picked.includes(r.id)} disabled={!picked.includes(r.id) && picked.length >= MAX_COMPARE} onChange={() => onPick(r.id)} data-testid={`dealflow-tick-${r.id}`} /></td>
                  <td className={`${STICKY} left-8 ${VENTURE_W} px-2 py-2`}>
                    <VentureCell row={r} onPeek={onPeek} />
                    <button type="button" className="mt-0.5 w-fit text-[11.5px] font-semibold text-violet-700 underline hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-100"
                      aria-expanded={open === r.id} aria-controls={open === r.id ? `dealflow-preview-cell-${r.id}` : undefined}
                      onClick={() => setOpen(open === r.id ? null : r.id)} data-testid={`dealflow-preview-toggle-${r.id}`}>
                      {open === r.id ? 'Hide preview' : 'Preview'}<span className="sr-only"> of {r.name}</span>
                    </button>
                  </td>
                  {fixedStage && <td className={`${STICKY} ${STAGE_LEFT} whitespace-nowrap border-r border-axal-hairline px-2 py-2 dark:border-gray-800`} data-testid={`dealflow-cell-${r.id}-stage`}><Cell col={{ id: 'stage' }} row={r} words={words} onAdd={onAdd} /></td>}
                  {cols.map((c) => <td key={c.id} className={`whitespace-nowrap px-2 py-2 ${c.id === 'fit' ? 'border-l-2 border-sky-200 dark:border-sky-800' : ''}`}><Cell col={c} row={r} words={words} onAdd={onAdd} /></td>)}
                </tr>
                {open === r.id && <Preview row={r} span={span} onPeek={onPeek} />}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={words} onChange={() => onWords(!words)} data-testid="dealflow-words" />Show confidence as words</label>
        <nav aria-label="Pages" className="flex items-center gap-2 text-[12.5px]">
          <span data-testid="dealflow-pages">{rows.length ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, rows.length)} of ${rows.length}` : '0 of 0'}</span>
          <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" className="px-1 disabled:opacity-40" data-testid="dealflow-prev-page">‹</button>
          {pages > 1 && pageNumbers(page, pages).map((n, i) => (n === '…'
            ? <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-axal-muted">…</span>
            : <button key={n} type="button" onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined} aria-label={`Page ${n}`}
              className={`min-w-[24px] rounded px-1.5 py-0.5 ${n === page ? 'bg-violet-100 font-bold text-violet-800 dark:bg-violet-900 dark:text-violet-200' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`} data-testid={`dealflow-page-${n}`}>{n}</button>))}
          <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" className="px-1 disabled:opacity-40" data-testid="dealflow-next-page">›</button>
        </nav>
      </div>
    </section>
  );
}

/**
 * DLS18a: the table as cards on a phone, with the card scopes.
 *
 * D4634 (#4634): the same rows, in the same pages, as the desktop table: one page of `PAGE_SIZE` at a time with
 * the count and the next and previous controls, so the 26th match and every one after it are reachable. A round
 * not on the member's deals offers Add to my deal flow, as the table's Stage cell does.
 */
export function PhoneCards({ rows, cards, picked, onPick, onAdd = null, page = 1, onPage = null, onPeek = null }) {
  const pages = pagesFor(rows.length);
  const at = Math.min(Math.max(1, page), pages);
  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="dealflow-phone-cards">
        {pageOf(rows, at).map((r) => (
          <li key={r.id} className="flex flex-col gap-1 rounded-xl border border-axal-hairline bg-white p-3 text-[13px] dark:border-gray-800 dark:bg-gray-900" data-testid={`dealflow-phone-row-${r.id}`}>
            <div className="flex items-start justify-between gap-2"><VentureCell row={r} onPeek={onPeek} /><input type="checkbox" aria-label={`Compare ${r.name}`} checked={picked.includes(r.id)} disabled={!picked.includes(r.id) && picked.length >= MAX_COMPARE} onChange={() => onPick(r.id)} /></div>
            <span className={MUTED}>{r.inFlow ? stageWord(r.stage) : 'Not on your deals'} · {r.round}</span>
            {!r.inFlow && onAdd && (
              <button type="button" className="min-h-[44px] w-fit text-[13px] font-semibold text-violet-700 underline hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-100"
                onClick={() => onAdd(r)} aria-haspopup="dialog" data-testid={`dealflow-phone-add-${r.id}`}>Add to my deal flow</button>
            )}
            <div className="flex flex-wrap gap-x-3">{cards.map((k) => <span key={k} className="flex gap-1"><span className={MUTED}>{SCOPE_SHORT[k]}</span><ScopeCell scores={r.scores} scope={k} /></span>)}</div>
            <div className="flex justify-between"><AskCell row={r} /><DaysCell row={r} /></div>
          </li>
        ))}
      </ul>
      <nav aria-label="Pages" className="flex items-center justify-between gap-2 text-[13px]" data-testid="dealflow-phone-pages">
        <button type="button" disabled={at <= 1 || !onPage} onClick={() => onPage(at - 1)} aria-label="Previous page" className="min-h-[44px] min-w-[44px] px-2 disabled:opacity-40" data-testid="dealflow-phone-prev-page">‹ Previous</button>
        <span>{rows.length ? `${(at - 1) * PAGE_SIZE + 1}–${Math.min(at * PAGE_SIZE, rows.length)} of ${rows.length}` : '0 of 0'}</span>
        <button type="button" disabled={at >= pages || !onPage} onClick={() => onPage(at + 1)} aria-label="Next page" className="min-h-[44px] min-w-[44px] px-2 disabled:opacity-40" data-testid="dealflow-phone-next-page">Next ›</button>
      </nav>
    </div>
  );
}

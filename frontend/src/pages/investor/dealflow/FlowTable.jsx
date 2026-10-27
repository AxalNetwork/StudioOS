/**
 * D1240 (#3253) — the table (DLS2, DLS2b) and its phone cards (DLS18a). The
 * compare tick and Venture stay put while the scopes scroll; every head sorts
 * and a scope's ≥ sets its minimum band. A score is its band and confidence,
 * never a number; the scorecard strip draws the bands.
 */
import React from 'react';
import { ScopeStrip } from '../../../components/scoring/scorecard/Scorecard';
import { AskCell, DaysCell, FitCell, OwnerCell, ScopeCell, VentureCell } from './FlowCells';
import {
  COLUMNS, PAGE_SIZE, SCOPE_SHORT, SHORT_LINE, enteredWord, pageOf, pagesFor, shortDayOf, stageWord, stripScopes,
} from './flowModel';
import { MAX_COMPARE } from './dealFlowModel';

const MUTED = 'text-[12px] text-axal-muted dark:text-gray-400';
const STICKY = 'sticky z-10 bg-white dark:bg-gray-900';
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

export function FlowTable({ rows, columns, sort, onSort, filters, onMin, picked, onPick, onAdd, page, onPage, words, onWords, onPeek = null }) {
  const cols = COLUMNS.filter((c) => columns.includes(c.id));
  const pages = pagesFor(rows.length);
  const shown = pageOf(rows, page);
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-testid="dealflow-table">
      <p className={`m-0 ${MUTED}`}>{SHORT_LINE} Hover a score for its band and confidence. Venture stays put; scopes scroll sideways.</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-axal-hairline dark:border-gray-800">
              <th className={`${STICKY} left-0 w-8 px-1`}><span className="sr-only">Compare</span></th>
              <th className={`${STICKY} left-8 min-w-[180px] px-2 text-left text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400`}>
                <button type="button" className={HEAD_BTN} onClick={() => onSort({ ...sort, by: 'name', dir: sort.by === 'name' && sort.dir === 'asc' ? 'desc' : 'asc' })} data-testid="dealflow-head-name">Venture</button>
              </th>
              {cols.map((c) => <Head key={c.id} col={c} sort={sort} onSort={onSort} min={filters.min[c.id] || ''} onMin={onMin} />)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 align-top dark:border-gray-800" data-testid={`dealflow-row-${r.id}`}>
                <td className={`${STICKY} left-0 px-1 py-2`}><input type="checkbox" aria-label={`Compare ${r.name}`} checked={picked.includes(r.id)} disabled={!picked.includes(r.id) && picked.length >= MAX_COMPARE} onChange={() => onPick(r.id)} data-testid={`dealflow-tick-${r.id}`} /></td>
                <td className={`${STICKY} left-8 px-2 py-2`}><VentureCell row={r} onPeek={onPeek} /></td>
                {cols.map((c) => <td key={c.id} className={`whitespace-nowrap px-2 py-2 ${c.id === 'fit' ? 'border-l-2 border-sky-200 dark:border-sky-800' : ''}`}><Cell col={c} row={r} words={words} onAdd={onAdd} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={words} onChange={() => onWords(!words)} data-testid="dealflow-words" />Show confidence as words</label>
        <span className="flex items-center gap-2 text-[12.5px]" data-testid="dealflow-pages">
          {rows.length ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, rows.length)} of ${rows.length}` : '0 of 0'}
          <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" className="px-1 disabled:opacity-40">‹</button>
          <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" className="px-1 disabled:opacity-40" data-testid="dealflow-next-page">›</button>
        </span>
      </div>
    </section>
  );
}

/** DLS18a: the table as cards on a phone, with the card scopes. */
export function PhoneCards({ rows, cards, picked, onPick, onPeek = null }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="dealflow-phone-cards">
      {rows.slice(0, PAGE_SIZE).map((r) => (
        <li key={r.id} className="flex flex-col gap-1 rounded-xl border border-axal-hairline bg-white p-3 text-[13px] dark:border-gray-800 dark:bg-gray-900" data-testid={`dealflow-phone-row-${r.id}`}>
          <div className="flex items-start justify-between gap-2"><VentureCell row={r} onPeek={onPeek} /><input type="checkbox" aria-label={`Compare ${r.name}`} checked={picked.includes(r.id)} disabled={!picked.includes(r.id) && picked.length >= MAX_COMPARE} onChange={() => onPick(r.id)} /></div>
          <span className={MUTED}>{r.inFlow ? stageWord(r.stage) : 'Not on your deals'} · {r.round}</span>
          <div className="flex flex-wrap gap-x-3">{cards.map((k) => <span key={k} className="flex gap-1"><span className={MUTED}>{SCOPE_SHORT[k]}</span><ScopeCell scores={r.scores} scope={k} /></span>)}</div>
          <div className="flex justify-between"><AskCell row={r} /><DaysCell row={r} /></div>
        </li>
      ))}
    </ul>
  );
}


import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Unreadable } from '../../ui';
import { CardBody, CycleHeader } from './CycleOverview';
import { recordHref, recordId, rowLinks } from './recordModel.js';
import { MODULE_LINK_CLASS } from './founderToolNavigation.js';
import { cardView, cellView, cycleOf, isPlainClick, pageButtons, recordsCount, safeHref } from './cycleModel';

/**
 * D661 (#1474) — one module page for all 26 modules, drawn to
 * `Cycle Overview.dc.html`'s `module=0…6` and `Cycle Modules · Boards.dc.html`
 * from #1469's module read:
 *
 *   { module, card: Card, records: { cols, rows, total, page, page_size,
 *     filters?, sorts?, add? } }
 *
 * The tabs, the module's chart at full size with its caption and next action,
 * then its records as a working table (search, filters, sort, pages, Add),
 * then the module's further parts (`children`).
 *
 * The table's controls are the read's own query (`q`, `filter`, `sort`,
 * `page`): the page hands them to `onQuery`, and the caller re-reads. Nothing
 * is filtered in the browser, so a count is always the store's count.
 *
 * A module that already has a full working tool (the cap table, the data
 * room, the pitch deck, the capital pipeline, the roadmap) is linked through
 * `tool`, not redrawn here.
 */

const PILL = {
  v1: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  v2: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  v3: 'border-axal-lavender-edge bg-white text-axal-violet-deep dark:border-violet-800 dark:bg-gray-900 dark:text-violet-300',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  warn: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  grey: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
  muted: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};
export const NR = 'rounded-full border border-dashed border-gray-300 bg-axal-ground px-2 py-0.5 text-[10.5px] font-semibold text-axal-muted dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400';
const CONTROL = 'rounded-full border border-axal-hairline bg-white px-[11px] py-[5px] text-[12px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

export function Cell({ cell, first = false, linkState = undefined, plain = false }) {
  const v = cellView(cell);
  if (v.nr) return <span className={NR}>Not recorded</span>;
  const text = !plain && v.href ? <Link to={v.href} state={linkState} className="hover:underline">{v.text}</Link> : v.text;
  if (v.tone) return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${PILL[v.tone]}`}>{text}</span>;
  return <span className={first ? 'font-semibold text-axal-ink dark:text-gray-100' : 'text-axal-ink/80 dark:text-gray-300'}>{text}</span>;
}

/**
 * `rowAction(row)` → `{ text, label, onClick }` or null: one control at the
 * end of each row the caller can act on (Edit). A row it returns null for
 * draws an empty cell, so the columns stay aligned.
 *
 * Each `add` entry is `{ text, href, state?, onOpen?, onClick? }`. A link
 * passes its `state` on, so an Add's `/new` address carries `state.under`
 * and closing it can go back to the page that opened it (D695).
 */
export function RecordsTable({ title, records, status = 'ready', message = '', query = {}, onQuery, onRetry, add, rowAction, rowHref }) {
  const [text, setText] = useState(query.q || '');
  const cols = Array.isArray(records?.cols) ? records.cols : [];
  const rows = Array.isArray(records?.rows) ? records.rows : [];
  const filters = Array.isArray(records?.filters) ? records.filters : [];
  const sorts = Array.isArray(records?.sorts) ? records.sorts : [];
  const count = recordsCount(records);
  const addButtons = Array.isArray(add) ? add : [add || records?.add].filter(Boolean);
  const set = (patch) => onQuery?.({ ...query, page: 1, ...patch });
  const acts = typeof rowAction === 'function';
  const tracks = cols.map((_, i) => (i === 0 ? 'minmax(0,1.6fr)' : 'minmax(0,1fr)'));
  const grid = { gridTemplateColumns: [...tracks, ...(acts && tracks.length ? ['auto'] : [])].join(' ') || '1fr' };
  const searching = !!(query.q || Object.values(query.filter || {}).some(Boolean));

  return (
    <section className="overflow-hidden rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-records">
      <div className="flex flex-col gap-2.5 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">{title}</h2>
          <div className="flex flex-wrap gap-2">{addButtons.map((addBtn) => {
            const addHref = safeHref(addBtn?.href);
            const className = 'whitespace-nowrap rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep';
            return addBtn?.text && (addBtn.onClick
              ? <button key={addBtn.text} type="button" onClick={addBtn.onClick} className={className}>{addBtn.text}</button>
              : addHref ? <Link key={addBtn.text} to={addHref} state={addBtn.state} data-testid="records-add" aria-haspopup={addBtn.onOpen ? 'dialog' : undefined} onClick={addBtn.onOpen ? (e) => { if (isPlainClick(e)) { e.preventDefault(); addBtn.onOpen(); } } : undefined} className={className}>{addBtn.text}</Link> : null);
          })}</div>
        </div>
        <form role="search" onSubmit={(e) => { e.preventDefault(); set({ q: text.trim() }); }}>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} aria-label={`Search ${title}`} placeholder={`Search ${String(title || '').toLowerCase()}…`}
            className="w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink placeholder:text-axal-faint focus:outline-none focus:ring-2 focus:ring-axal-violet/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
        </form>
        {(filters.length > 0 || sorts.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {filters.map((f) => (
              <select key={f.key} aria-label={f.label} className={CONTROL} value={query.filter?.[f.key] || ''}
                onChange={(e) => set({ filter: { ...(query.filter || {}), [f.key]: e.target.value } })}>
                <option value="">{f.label}: all</option>
                {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ))}
            {sorts.length > 0 && (
              <select aria-label="Sort" className={`${CONTROL} ml-auto`} value={query.sort || sorts[0].key} onChange={(e) => set({ sort: e.target.value })}>
                {sorts.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
              </select>
            )}
          </div>
        )}
      </div>

      {status === 'unreadable' && <div className="px-4 py-3"><Unreadable what={`The ${String(title || 'records').toLowerCase()}`} claim={message || 'This is not a claim that there are none.'} onRetry={onRetry} /></div>}
      {status === 'loading' && <div className="flex flex-col gap-2 px-4 py-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-4 rounded bg-axal-ground dark:bg-gray-800" />)}</div>}
      {status === 'ready' && (
        <>
          {cols.length > 0 && (
            <div role="row" className="hidden gap-2.5 border-b border-axal-hairline bg-axal-ground/60 px-4 py-2 text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted md:grid dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-400" style={grid}>
              {cols.map((c) => <span key={c.key} role="columnheader">{c.label}</span>)}
              {acts && <span role="columnheader" className="sr-only">Actions</span>}
            </div>
          )}
          {rows.length === 0 && (
            <p className="m-0 px-4 py-5 text-[13px] text-axal-muted dark:text-gray-400" data-testid="records-empty">
              {searching ? 'Nothing matches this search.' : 'No records yet.'}
            </p>
          )}
          {rows.map((r, ri) => {
            const href = rowHref?.(r);
            return (
            <div key={r.id ?? ri} role="row" className="relative grid grid-cols-2 items-center gap-x-2.5 gap-y-1 border-b border-axal-ground px-4 py-2.5 text-[12.5px] last:border-b-0 md:[grid-template-columns:var(--cols)] dark:border-gray-800" style={{ '--cols': grid.gridTemplateColumns }}>
              {cols.map((c, ci) => (
                <span key={c.key} role="cell" className={ci === 0 ? 'col-span-2 md:col-span-1' : ''}>
                  {ci > 0 && <span className="mr-1.5 text-[10.5px] uppercase tracking-[.06em] text-axal-faint md:hidden">{c.label}</span>}
                  {ci === 0 && href ? <Link to={href} className="after:absolute after:inset-0 focus-visible:underline">
                    <Cell cell={r.cells?.[c.key]} first plain />
                  </Link> : <Cell cell={r.cells?.[c.key]} first={ci === 0} plain={!!href} />}
                </span>
              ))}
              {acts && <RowAction action={rowAction(r)} />}
            </div>
          ); })}
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5" data-testid="records-count">
            <span className="text-[12px] text-axal-muted dark:text-gray-400">{count.label}</span>
            {count.pages > 1 && (
              <nav aria-label="Pages" className="flex gap-1">
                <button type="button" className={CONTROL} disabled={count.page <= 1} onClick={() => onQuery?.({ ...query, page: count.page - 1 })} aria-label="Previous page">‹</button>
                {pageButtons(count.page, count.pages).map((p, i) => (p === '…'
                  ? <span key={`e${i}`} className="px-1.5 text-[12px] text-axal-muted">…</span>
                  : <button key={p} type="button" aria-current={p === count.page ? 'page' : undefined} onClick={() => onQuery?.({ ...query, page: p })}
                    className={`${CONTROL} ${p === count.page ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300' : ''}`}>{p}</button>))}
                <button type="button" className={CONTROL} disabled={count.page >= count.pages} onClick={() => onQuery?.({ ...query, page: count.page + 1 })} aria-label="Next page">›</button>
              </nav>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function RowAction({ action }) {
  return (
    <span role="cell" className="col-span-2 md:col-span-1 md:justify-self-end">
      {action?.text && typeof action.onClick === 'function' && (
        <button type="button" onClick={action.onClick} aria-label={action.label || action.text} data-testid="records-row-action"
          className="relative z-10 rounded-[9px] border border-axal-hairline px-2.5 py-1 text-[11.5px] font-semibold text-axal-violet-deep hover:bg-axal-lavender dark:border-gray-700 dark:text-violet-300 dark:hover:bg-violet-900/30">
          {action.text}
        </button>
      )}
    </span>
  );
}

export default function CycleModulePage({
  cycle, slug, cards, data, status = data ? 'ready' : 'loading', message = '', onRetry,
  records, recordsStatus, recordsMessage, query, onQuery, onRetryRecords, action, add, rowAction, tool, tools = [], children, search = '',
}) {
  const meta = cycleOf(cycle);
  if (!meta) return null;
  const card = data?.card || null;
  const view = cardView(card);
  const name = card?.name || data?.module?.name || slug;
  const toolLinks = [tool, ...tools].filter((item) => safeHref(item?.href));
  const recs = records ?? data?.records;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="cycle-module" data-cycle={meta.key} data-module={slug}>
      <CycleHeader cycle={meta.key} cards={cards || (card ? [card] : [])} active={slug} action={action} title={name} sub={[card?.caption, 'Records below; the tabs above move between modules.'].filter(Boolean).join(' ')} search={search} />
      {status === 'unreadable' ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30" data-testid="cycle-module-unreadable">
          <Unreadable what={name} claim={message || 'This is not a claim that nothing is recorded.'} onRetry={onRetry} />
        </div>
      ) : (
        <>
          <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-module-chart" data-state={view.state}>
            <div className="flex flex-wrap items-baseline justify-between gap-2.5">
              <h2 className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">{name} · at a glance</h2>
              {card?.range && <span className="text-[11px] text-axal-faint dark:text-gray-500">{card.range}</span>}
            </div>
            <CardBody card={card} onRetry={onRetry} search={search} />
            {view.state === 'ok' && card.caption && <span className="text-[12.5px] leading-relaxed text-axal-ink/80 dark:text-gray-300">{card.caption}</span>}

          </section>
          {toolLinks.map((item) => (
            <Link key={item.href} to={item.href} className={MODULE_LINK_CLASS} data-testid="cycle-module-tool">
              {item.label || `Open ${name}`}
            </Link>
          ))}
          <RecordsTable
            key={`${meta.key}/${slug}`}
            title={data?.module?.records_title || name}
            records={recs}
            status={recordsStatus || (recs ? 'ready' : status)}
            message={recordsMessage}
            query={query}
            onQuery={onQuery}
            onRetry={onRetryRecords || onRetry}
            add={add}
            rowAction={rowAction}
            rowHref={(row) => rowLinks(recs, row) ? recordHref(meta.key, slug, recordId(row), search) : null}
          />
          {children}
        </>
      )}
    </div>
  );
}

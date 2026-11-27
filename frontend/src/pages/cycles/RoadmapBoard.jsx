import { useEffect, useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { recordHref } from './recordModel.js';
import { COLUMNS, STATE_TAGS, dateLine, roadmapColumns, roadmapStrip, roadmapTimeline, stripPressed, toggleStrip } from './roadmapBoardModel.js';
import { DOOR, boardColumn, boardHref, boardView, doorHref, itemParam } from './roadmapShortcut.js';

/**
 * D6036 (#6036, BD25, BD26, BD28, BD30) — Build › Product roadmap's board, above its list.
 *
 * The figure strip (Now, Next, Later, Done, Shipped this month, Late, Unlinked) reads the Worker's counts over
 * every item; Late and Unlinked are toggle buttons that set the list's own filter, so the board and the list
 * below show exactly those items. Board and Timeline are a native radio group. The board draws the listed
 * page in four columns; on a phone, one column at a time behind a segmented control (BD30). The timeline
 * groups the listed items by target month, with a No date recorded tray. Each mark is a word and a glyph.
 * The list under the board keeps the search, filters, paging, Add and Export.
 *
 * D8776 (#8776, BLR01, BLR04, BLR07A/D): the link above the board names the page it opens, "Quarters,
 * dependencies and scenarios", with one line on what it shows (owner question 1, option A). Board or Timeline
 * (`?view=`), the phone column (`?column=`) and a linked item (`?item=`) are in the address, so Back from the
 * landing, by its link or the browser's, comes back to the view, column and card the founder left; the link
 * hands the landing this address, and focus returns to the control that left.
 */
const STRIP_CELL = 'flex min-h-[44px] min-w-0 flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left';
const IDLE = 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BUTTON_IDLE = `${IDLE} hover:bg-axal-ground dark:hover:bg-gray-800`;
const ON = 'border-violet-500 bg-violet-50 text-violet-900 dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-100';
const TAG = 'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-bold leading-[1.6]';
const TONES = {
  late: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/45 dark:bg-amber-500/10 dark:text-amber-300',
  unlinked: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/45 dark:bg-amber-500/10 dark:text-amber-300',
  blocked: 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300',
  in_flight: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/40 dark:bg-violet-400/10 dark:text-violet-300',
  provisional: 'border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300',
  done: 'border-green-200 bg-green-50 text-green-800 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-300',
  blocks: 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200',
};
const SEG = 'min-h-[44px] flex-1 cursor-pointer rounded-lg px-2 text-center text-[12.5px] font-bold';

function Tag({ tone, glyph, children, testid }) {
  return <span className={`${TAG} ${TONES[tone]}`} data-testid={testid}><span aria-hidden="true">{glyph}</span>{children}</span>;
}

function Card({ card, href, focusRef }) {
  const state = STATE_TAGS[card.state];
  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-axal-hairline bg-white p-2.5 dark:border-gray-700 dark:bg-gray-900" data-testid="roadmap-card" data-state={card.state}>
      {href
        ? <Link to={href} ref={focusRef} className="text-[13px] font-bold text-axal-ink hover:underline dark:text-gray-100" data-testid={`roadmap-card-link-${card.id}`}>{card.title}</Link>
        : <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{card.title}</span>}
      <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
        <span>{card.owner || 'No owner'}</span>
        <span aria-hidden="true">·</span>
        {card.late ? <Tag tone="late" glyph="▲" testid="roadmap-card-late">{dateLine(card)}</Tag> : <span>{dateLine(card)}</span>}
      </span>
      {card.unlinked
        ? <span><Tag tone="unlinked" glyph="◌" testid="roadmap-card-unlinked">Unlinked · no theme, no KPI</Tag></span>
        : card.moves && <span className="text-[12px] text-axal-ink/80 dark:text-gray-300">{card.moves}</span>}
      <span className="flex flex-wrap gap-1.5">
        <Tag tone={card.state} glyph={state.glyph} testid="roadmap-card-state">
          {card.state === 'blocked' && card.waitsOn ? `Blocked · waits on ${card.waitsOn}` : state.word}
        </Tag>
        {card.blocks > 0 && <Tag tone="blocks" glyph="→" testid="roadmap-card-blocks">Blocks {card.blocks}</Tag>}
      </span>
    </li>
  );
}

/** The venture the page's own search names (`?project_id=`, or a read link's legacy `?project=`). */
const ventureOf = (search) => {
  const p = new URLSearchParams(String(search || ''));
  return p.get('project_id') || p.get('project') || null;
};

export default function RoadmapBoard({ module, query, onQuery, search = '' }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const strip = roadmapStrip(module?.facts);
  const records = module?.records;
  const board = roadmapColumns(records);
  const timeline = roadmapTimeline(records);
  const view = boardView(params.get('view'));
  const item = itemParam(params.get('item'));
  const itemColumn = item == null ? null : board.columns.find((c) => c.cards.some((card) => Number(card.id) === item))?.key ?? null;
  const phoneColumn = boardColumn(params.get('column'), itemColumn);
  // Each choice replaces the address rather than adding to history, so Back still leaves the page.
  const write = (key, value) => setParams((old) => { const next = new URLSearchParams(old); next.set(key, value); return next; }, { replace: true });
  const projectId = ventureOf(search);
  const doorRef = useRef(null);
  const cardRef = useRef(null);
  const focused = useRef(false);
  const focusDoor = location.state?.roadmapFocus === 'door';
  useEffect(() => {
    if (focused.current) return;
    const target = focusDoor ? doorRef.current : item != null ? cardRef.current : null;
    if (!target?.focus) return;
    focused.current = true;
    target.focus();
  });
  const hrefOf = (card) => (card.id == null ? null : recordHref('build', 'product-roadmap', card.id, search));
  const refOf = (card) => (item != null && Number(card.id) === item ? cardRef : undefined);
  const paged = board.total > board.listed;
  const itemCount = Number(module?.facts?.items);
  // Before the first item the progressive list draws BD28's zero guide; the board draws nothing over it.
  if (!board.listed && !(itemCount > 0)) return null;
  return (
    <section className="flex min-w-0 flex-col gap-3" data-testid="roadmap-board" aria-label="Product roadmap board">
      {strip && (
        <div role="group" aria-label="Roadmap figures" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" data-testid="roadmap-strip">
          {strip.map((c) => {
            const body = (
              <>
                <b className="text-[18px] font-extrabold leading-none tracking-[-.02em]" data-testid={`roadmap-strip-${c.key}-value`}>{c.text}</b>
                <span className="text-[12px] font-semibold">{c.key === 'late' ? '▲ ' : c.key === 'unlinked' ? '◌ ' : ''}{c.label}</span>
                <span className="text-[11px] text-axal-muted dark:text-gray-400">{c.sub}</span>
              </>
            );
            return c.filter && c.value != null
              ? <button key={c.key} type="button" aria-pressed={stripPressed(query, c)} className={`${STRIP_CELL} ${stripPressed(query, c) ? ON : BUTTON_IDLE}`}
                onClick={() => onQuery?.(toggleStrip(query, c))} data-testid={`roadmap-strip-${c.key}`}>{body}</button>
              : <div key={c.key} className={`${STRIP_CELL} ${IDLE}`} data-testid={`roadmap-strip-${c.key}`}>{body}</div>;
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <fieldset className="m-0 flex gap-1 rounded-xl border border-axal-hairline p-1 dark:border-gray-700" data-testid="roadmap-view">
          <legend className="sr-only">View</legend>
          {[['board', 'Board'], ['timeline', 'Timeline']].map(([value, label]) => (
            <label key={value} className={`${SEG} flex items-center justify-center px-3 ${view === value ? 'bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100' : 'text-axal-ink dark:text-gray-200'}`}>
              <input type="radio" name="roadmap-view" value={value} checked={view === value} onChange={() => write('view', value)} className="sr-only" data-testid={`roadmap-view-${value}`} />
              {label}
            </label>
          ))}
        </fieldset>
        {/* D8776 (#8776, BLR01, BLR07A): the link names the page it opens; one line says what that page shows. */}
        <div className="flex min-w-0 flex-col gap-0.5 max-md:w-full">
          <Link ref={doorRef} to={doorHref(projectId)} state={{ roadmapFrom: boardHref(projectId, view, phoneColumn) }}
            className="flex min-h-[44px] items-center gap-1 text-[12.5px] font-semibold text-violet-700 hover:underline md:min-h-0 dark:text-violet-300" data-testid="roadmap-dependencies-link">
            {DOOR}<span aria-hidden="true">›</span>
          </Link>
          <span className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="roadmap-door-explainer">
            {itemCount > 0 ? `The same ${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : 'Your items'} placed by quarter, with what waits on what and saved what-ifs.
          </span>
        </div>
      </div>
      {paged && (
        <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="roadmap-paged">
          Showing the {board.listed} items on this page of {board.total}. The list below pages, searches and filters them.
        </p>
      )}
      {view === 'board' ? (
        <>
          <fieldset className="m-0 flex gap-1 rounded-xl border border-axal-hairline p-1 md:hidden dark:border-gray-700" data-testid="roadmap-phone-columns">
            <legend className="sr-only">Column</legend>
            {COLUMNS.map(([key, label]) => (
              <label key={key} className={`${SEG} flex items-center justify-center ${phoneColumn === key ? 'bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100' : 'text-axal-ink dark:text-gray-200'}`}>
                <input type="radio" name="roadmap-phone-column" value={key} checked={phoneColumn === key} onChange={() => write('column', key)} className="sr-only" data-testid={`roadmap-phone-column-${key}`} />
                {label} {board.columns.find((c) => c.key === key).cards.length}
              </label>
            ))}
          </fieldset>
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-4" data-testid="roadmap-columns">
            {board.columns.map((col) => (
              <section key={col.key} className={`${col.key === phoneColumn ? 'flex' : 'hidden'} min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-axal-ground p-2.5 md:flex dark:border-gray-800 dark:bg-gray-950`} data-testid={`roadmap-column-${col.key}`} aria-label={col.label}>
                <h3 className="m-0 flex items-baseline justify-between text-[13px] font-extrabold text-axal-ink dark:text-gray-100">
                  {col.label}<span className="text-[11px] font-semibold text-axal-muted dark:text-gray-400">{col.cards.length} listed</span>
                </h3>
                {col.cards.length
                  ? <ul className="m-0 flex list-none flex-col gap-2 p-0">{col.cards.map((card) => <Card key={card.id} card={card} href={hrefOf(card)} focusRef={refOf(card)} />)}</ul>
                  : <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">None listed here.</p>}
              </section>
            ))}
          </div>
          {board.other.length > 0 && (
            <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="roadmap-other">
              {board.other.length} listed {board.other.length === 1 ? 'item has' : 'items have'} a column other than Now, Next, Later or Done; the list below shows {board.other.length === 1 ? 'it' : 'them'}.
            </p>
          )}
        </>
      ) : (
        <div className="flex min-w-0 flex-col gap-3" data-testid="roadmap-timeline">
          {timeline.months.map((m) => (
            <section key={m.key} className="flex min-w-0 flex-col gap-2" data-testid="roadmap-timeline-month" aria-label={m.label}>
              <h3 className="m-0 text-[13px] font-extrabold text-axal-ink dark:text-gray-100">{m.label}</h3>
              <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-3">{m.cards.map((card) => <Card key={card.id} card={card} href={hrefOf(card)} focusRef={refOf(card)} />)}</ul>
            </section>
          ))}
          <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-dashed border-axal-hairline p-2.5 dark:border-gray-700" data-testid="roadmap-timeline-nodate" aria-label="No date recorded">
            <h3 className="m-0 text-[13px] font-extrabold text-axal-ink dark:text-gray-100">No date recorded</h3>
            {timeline.noDate.length
              ? <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-3">{timeline.noDate.map((card) => <Card key={card.id} card={card} href={hrefOf(card)} focusRef={refOf(card)} />)}</ul>
              : <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">Every listed item has a target date.</p>}
          </section>
        </div>
      )}
    </section>
  );
}

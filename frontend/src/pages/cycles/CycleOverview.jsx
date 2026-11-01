import { Link, useNavigate } from 'react-router-dom';
import { Unrecorded, Unreadable } from '../../ui';
import { Chart, Spark } from './CycleCharts';
import { cardView, cycleOf, cycleTabs, figureDelta, figureValue, isPlainClick, linkSearch, nextHref, safeHref, sparkDrawable } from './cycleModel';
import { MODULES } from './modules';

/**
 * D661 (#1474) — one overview for all four cycles, drawn to
 * `Cycle Overview.dc.html` (`variant=full`, `new`, `states`) from #1469's
 * shared read (D656): the cycle's question, four headline figures with
 * sparklines, then one chart card per module in the read's order.
 *
 * THERE IS NO MODULE LIST, no status pill and no Pro strip: the owner asked
 * why each overview showed its modules twice, and this is the answer. The
 * tabs above are navigation; the cards are the modules.
 *
 * The component draws what it is handed and reads nothing itself, so a cycle
 * is wired by passing its read in (`lib/api/cycles.js` arrives with the first
 * cycle whose read is on `main`).
 *   data      the overview read, or null while it loads
 *   status    'loading' | 'ready' | 'unreadable'
 *   onRetry   re-read the whole overview
 *   onRetryCard(slug)  re-read one unreadable card; the others stay drawn
 *   action    { label?, href?, onClick? } — the cycle's primary action
 *   search    `?project_id=…`, carried by the tabs and each card's link
 */

const SECTION = 'text-[10px] font-extrabold uppercase tracking-[.09em]';
const CARD = 'flex min-w-0 flex-col gap-2.5 rounded-xl border border-axal-hairline bg-white px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900';
// D1466 (#3714, RO01): an empty card is drawn lighter than a card with data, at the same height.
const CARD_EMPTY = 'flex min-w-0 flex-col gap-2.5 rounded-xl border border-axal-hairline bg-[#faf9fc] px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900/60';

/**
 * D1466 (#3714, RO00, RO09): the figure row's column count follows the number
 * of figures, so no track is left empty (the owner's half-width row was the
 * staff summary's two figures in a fixed four-column grid). Literal classes,
 * so Tailwind keeps them. Below 1024px the phone page replaces this grid, so
 * `sm:` only matters where the component is mounted narrower.
 */
export const FIGURE_COLS = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
  5: 'grid-cols-1 sm:grid-cols-5',
  6: 'grid-cols-1 sm:grid-cols-3 min-[90rem]:grid-cols-6',
};
export const figureCols = (n) => FIGURE_COLS[Math.min(Math.max(n, 1), 6)];

/**
 * D1466 (RO00): two module columns from 1024px, three from 1280px, every card
 * in a row the same height. The last card spans the tracks its row leaves
 * empty: seven cards in three columns give Capital relationships the whole
 * last row, and in two columns the last row too.
 */
export function lastCardSpan(n) {
  if (n < 1) return '';
  const lg = n % 2 === 1 ? 'lg:col-span-2' : '';
  const xl = n % 3 === 1 ? 'xl:col-span-3' : n % 3 === 2 ? 'xl:col-span-2' : lg ? 'xl:col-span-1' : '';
  return [lg, xl].filter(Boolean).join(' ');
}

/** D1466 (RO06): an overview card draws at most this many charts, then "More in the module ›". */
export const CARD_CHART_LIMIT = 2;

export function CycleHeader({ cycle, cards, active = null, action, title, sub, record = false, moduleName, search = '', chip = null, more = null }) {
  const meta = cycleOf(cycle);
  const navigate = useNavigate();
  const tabs = cycleTabs(meta.key, cards, active, search, { back: record ? `‹ Back to ${moduleName}` : null });
  const current = tabs.find((t) => t.active) || tabs[0];
  const label = action?.label || meta.action;
  const href = safeHref(action?.href);
  const btn = 'inline-flex items-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep';
  return (
    <header className="flex flex-col gap-1.5" data-testid="cycle-header">
      <span className={`${SECTION} text-axal-violet dark:text-violet-300`}>{meta.name} · {record ? moduleName : meta.question}</span>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h1 className="m-0 text-[20px] font-extrabold leading-tight tracking-[-.025em] text-axal-ink sm:text-2xl dark:text-gray-100">{title || meta.name}</h1>
          {/* D1146 (#3032): a header chip, such as Validate's Product-market fit (RD12). */}
          {chip}
        </div>
        {/* D1060 (#2930): `more` sits beside the action, as the Reporting desk's More menu. */}
        <div className="flex items-center gap-2">
          {!record && action?.onClick
            ? <button type="button" className={btn} onClick={action.onClick} disabled={!!action.disabled} data-testid="cycle-action">{label}</button>
            : !record && href ? <Link className={btn} to={href} data-testid="cycle-action" aria-haspopup={action?.onOpen ? 'dialog' : undefined} onClick={action?.onOpen ? (e) => { if (isPlainClick(e)) { e.preventDefault(); action.onOpen(); } } : undefined}>{label}</Link> : null}
          {more}
        </div>
      </div>
      <p className="m-0 text-[13px] leading-relaxed text-axal-ink/80 dark:text-gray-300">{sub ?? `${meta.outcome}. The cycle’s data at a glance; the tabs above move between modules.`}</p>
      <nav aria-label={`${meta.name} modules`} className="mt-1 hidden flex-wrap gap-1.5 lg:flex" data-testid="cycle-tabs">
        {tabs.map((t) => (
          <Link key={t.key || 'overview'} to={t.href} aria-current={t.active && !t.back ? 'page' : undefined}
            className={`whitespace-nowrap rounded-full border px-[11px] py-[5px] text-[11px] ${t.active ? 'border-axal-lavender-edge bg-axal-lavender font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300' : 'border-axal-hairline bg-white font-semibold text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:text-gray-100'}`}>
            {t.name}
          </Link>
        ))}
      </nav>
      <label className="mt-1 flex min-h-[44px] items-center gap-2 rounded-xl border border-axal-hairline bg-white px-3.5 lg:hidden dark:border-gray-700 dark:bg-gray-900">
        <span className={`${SECTION} text-axal-muted dark:text-gray-400`}>{record ? 'Record' : 'Module'}</span>
        {/* Keyed by tab, not href (D686): a history tab and its module tab can share one path. */}
        <select className="min-w-0 flex-1 bg-transparent text-sm font-bold text-axal-ink outline-none dark:text-gray-100" value={record ? 'record' : current.key || 'overview'}
          onChange={(e) => { const to = tabs.find((t) => (t.key || 'overview') === e.target.value); if (to) navigate(to.href); }} aria-label={`${meta.name} module`}>
          {record && <option value="record">{title}</option>}
          {tabs.map((t) => <option key={t.key || 'overview'} value={t.key || 'overview'}>{t.name}</option>)}
        </select>
      </label>
    </header>
  );
}

export function FigureTile({ fig }) {
  const value = figureValue(fig);
  const delta = figureDelta(fig);
  const unreadable = fig?.state === 'unreadable';
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-axal-hairline bg-white px-3.5 py-3 dark:border-gray-800 dark:bg-gray-900" data-testid={`cycle-figure-${fig?.key}`}
      title={[fig?.source && `From ${fig.source}`, fig?.as_of && `as of ${fig.as_of}`].filter(Boolean).join(', ') || undefined}>
      <span className={`${SECTION} text-axal-muted dark:text-gray-400`}>{fig?.label}</span>
      <span className="text-[22px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">
        {value ?? (unreadable
          ? <span className="text-[13px] font-semibold text-red-700 dark:text-red-300">{fig?.source ? `${fig.source} could not be read` : 'Could not be read'}</span>
          : <span className="text-[15px]"><Unrecorded reason={fig?.source ? `${fig.source} does not hold this yet.` : undefined} /></span>)}
      </span>
      {fig?.coverage && <span className="text-xs text-axal-muted">{fig.coverage.scored} of {fig.coverage.total} items scored</span>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{fig?.key === 'committed' && fig?.reason ? fig.reason : delta || (value == null ? 'nothing recorded yet' : 'change not recorded')}</span>
        {value != null && sparkDrawable(fig.spark) && <Spark values={fig.spark} label={`${fig.label}, last points`} />}
      </div>
    </div>
  );
}

export function CardBody({ card, onRetry, charts, compact = false, search = '', limit = null, wide = false }) {
  let view = charts ? { state: 'ok', charts } : cardView(card);
  if (view.state === 'ok' && limit && view.charts.length > limit) view = { ...view, charts: view.charts.slice(0, limit) };
  if (view.state === 'loading') {
    return (
      <div className="flex flex-col gap-2" data-testid="card-loading" aria-busy="true" aria-label="Loading">
        {[70, 92, 56, 80].map((w) => <div key={w} className="h-3 rounded-full bg-axal-ground dark:bg-gray-800" style={{ width: `${w}%` }} />)}
      </div>
    );
  }
  if (view.state === 'ok') {
    // D1466 (RO00): a card spanning its row lays its charts side by side, and a
    // lone chart keeps half the row, so a wide card never blows its chart up.
    const layout = !wide ? `flex flex-col ${compact ? 'gap-3.5' : 'gap-5'}`
      : view.charts.length > 1 ? 'grid grid-cols-1 items-start gap-5 lg:grid-cols-2' : 'flex flex-col lg:max-w-[50%]';
    return <div className={layout} data-testid={wide ? 'card-charts-wide' : undefined}>{view.charts.map((s, i) => <Chart key={i} spec={s} label={card?.caption || card?.name} />)}</div>;
  }
  // D1466 (#3714, RO01, RO06): an empty or too-little card is one muted line
  // and, when the read names one, the module's first step: no dashed box
  // taking half the page.
  if (view.state === 'empty') {
    const next = card?.next;
    const href = nextHref(next?.href, search);
    return (
      <div className="flex flex-col items-start gap-1.5" data-testid="card-empty">
        <span className="text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">{view.reason}</span>
        {next?.text && (href
          ? <Link to={href} className="text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">{next.text} ›</Link>
          : <span className="text-[12.5px] font-semibold text-axal-violet-deep dark:text-violet-300">{next.text}</span>)}
      </div>
    );
  }
  if (view.state === 'too_little') {
    return <p className="m-0 text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400" data-testid="card-too-little">{view.reason}</p>;
  }
  if (view.state === 'not_recorded') {
    return (
      <div className="flex flex-col items-start gap-1.5" data-testid="card-not-recorded">
        <span className="rounded-full border border-axal-hairline bg-axal-ground px-2 py-0.5 text-[11.5px] font-semibold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">Not recorded</span>
        <span className="text-[12.5px] text-axal-muted dark:text-gray-400">{view.reason}</span>
      </div>
    );
  }
  return (
    <div role="alert" className="flex items-center justify-between gap-2.5 rounded-[10px] border border-red-200 bg-red-50 p-3.5 dark:border-red-900 dark:bg-red-950/30" data-testid="card-unreadable">
      <span className="text-[12.5px] text-red-700 dark:text-red-300">{view.reason}</span>
      {onRetry && <button type="button" onClick={onRetry} className="shrink-0 text-[12px] font-bold text-red-700 hover:underline dark:text-red-300">Try again</button>}
    </div>
  );
}

/** One module's card: its name (linking to its page), range, chart or state, caption and the one next action. */
export function CycleCard({ cycle, card, slug, onRetry, search = '', span = '' }) {
  const view = cardView(card);
  const name = card?.name || slug;
  const next = card?.next;
  const href = nextHref(next?.href, search);
  const moduleHref = card?.slug ? `/${cycle}/${card.slug}${linkSearch(search)}` : null;
  // D1466 (RO06): a card holding more than it can draw at its row's height is
  // cut off, and its module page holds the rest.
  const cut = view.state === 'ok' && view.charts.length > CARD_CHART_LIMIT;
  return (
    <article className={`${view.state === 'empty' ? CARD_EMPTY : CARD} ${span}`.trim()} data-testid={`cycle-card-${card?.slug || slug}`} data-state={view.state}>
      <div className="flex items-baseline justify-between gap-2.5">
        {moduleHref
          ? <Link to={moduleHref} className="text-[14.5px] font-extrabold tracking-[-.01em] text-axal-ink hover:text-axal-violet-deep hover:underline dark:text-gray-100">{name} ›</Link>
          : <span className="text-[14.5px] font-extrabold text-axal-ink dark:text-gray-100">{name || 'Loading…'}</span>}
        {card?.range && <span className="whitespace-nowrap text-[11px] text-axal-faint dark:text-gray-500">{card.range}</span>}
      </div>
      <CardBody card={card} onRetry={onRetry} compact search={search} limit={CARD_CHART_LIMIT} wide={/col-span-[23]/.test(span)} />
      {view.state === 'ok' && card.caption && <span className="text-[12px] leading-relaxed text-axal-ink/80 dark:text-gray-300">{card.caption}</span>}
      {view.state === 'ok' && (next?.text || cut) && (
        <div className="mt-auto flex flex-col gap-1.5 pt-0.5">
          {next?.text && (
            <span className="text-[11.5px] text-axal-muted dark:text-gray-400">
              Next: {href ? <Link to={href} className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">{next.text}</Link> : next.text}
            </span>
          )}
          {cut && moduleHref && <Link to={moduleHref} className="text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" data-testid="cycle-card-more">More in the module ›</Link>}
        </div>
      )}
    </article>
  );
}

// D693 decision 14: a loading overview draws one placeholder per module of its cycle.
//
// D1466 (#3714): `lead` is the row between the figures and the cards (Raise's
// Next steps and From your tools); `status: 'refused'` is a read refused on
// purpose (403/404), drawn as the Worker's sentence in muted ink, never red
// (RO15). A read-only summary (`data.read_only`, D1191's staff view) draws an
// amber "Read only" bar and no primary action (RO14). `ask` is the page's Ask
// button, drawn after `more` (Raise's, D1466).
export default function CycleOverview({ cycle, data, status = data ? 'ready' : 'loading', message = '', onRetry, onRetryCard, action: actionIn, placeholders = MODULES[cycle]?.length ?? 6, figurePlaceholders = 4, search = '', chip = null, more: moreIn = null, ask = null, lead = null }) {
  const meta = cycleOf(cycle);
  if (!meta) return null;
  const cards = Array.isArray(data?.cards) ? data.cards : [];
  const figures = Array.isArray(data?.figures) ? data.figures : [];
  const readOnly = data?.read_only === true;
  // A read-only reader gets no primary action and no Ask (RO14); `ask` sits after `more` in the header.
  const action = readOnly ? null : actionIn;
  const more = readOnly ? null : (moreIn && ask ? <>{moreIn}{ask}</> : moreIn || ask);
  const figureCount = status === 'loading' ? figurePlaceholders : figures.length;
  const cardCount = status === 'loading' ? placeholders : cards.length;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="cycle-overview" data-cycle={meta.key}>
      <CycleHeader cycle={meta.key} cards={cards} action={action} search={search} chip={chip} more={more} />
      {readOnly && status === 'ready' && (
        <div role="status" className="flex items-center gap-2 rounded-[10px] border border-amber-300 bg-amber-50 px-3.5 py-2 text-[12.5px] font-bold text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200" data-testid="cycle-overview-read-only">
          Read only · {data?.mode === 'summary' ? 'HQ summary. Counts only; the founder’s records stay with the founder.' : 'You can read this cycle but not change it.'}
        </div>
      )}
      {status === 'refused' ? (
        <div role="status" className="max-w-[620px] rounded-xl border border-axal-hairline bg-white px-5 py-4 text-[14px] font-semibold text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100" data-testid="cycle-overview-refused">
          {message || `You cannot open this venture’s ${meta.name}.`}
        </div>
      ) : status === 'unreadable' ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30" data-testid="cycle-overview-unreadable">
          <Unreadable what={`The ${meta.name} overview`} claim={message || 'This is not a claim that nothing is recorded.'} onRetry={onRetry} />
        </div>
      ) : (
        <>
          {figureCount > 0 && (
            <div className={`grid gap-3 ${figureCols(figureCount)}`} data-testid="cycle-figures" data-count={figureCount}>
              {status === 'loading'
                ? Array.from({ length: figurePlaceholders }, (_, i) => <div key={i} className="h-[92px] rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" aria-busy="true" />)
                : figures.map((f) => <FigureTile key={f.key} fig={f} />)}
            </div>
          )}
          {status !== 'loading' && lead}
          <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2 xl:grid-cols-3" data-testid="cycle-cards">
            {status === 'loading'
              ? Array.from({ length: placeholders }, (_, i) => <CycleCard key={i} cycle={meta.key} card={null} slug="" search={search} span={i === placeholders - 1 ? lastCardSpan(cardCount) : ''} />)
              : cards.map((c, i) => <CycleCard key={c.slug} cycle={meta.key} card={c} search={search} span={i === cards.length - 1 ? lastCardSpan(cardCount) : ''} onRetry={onRetryCard ? () => onRetryCard(c.slug) : undefined} />)}
          </div>
        </>
      )}
    </div>
  );
}

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

export function CycleHeader({ cycle, cards, active = null, action, title, sub, record = false, moduleName, search = '' }) {
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
        <h1 className="m-0 text-[20px] font-extrabold leading-tight tracking-[-.025em] text-axal-ink sm:text-2xl dark:text-gray-100">{title || meta.name}</h1>
        {!record && action?.onClick
          ? <button type="button" className={btn} onClick={action.onClick} data-testid="cycle-action">{label}</button>
          : !record && href ? <Link className={btn} to={href} data-testid="cycle-action" aria-haspopup={action?.onOpen ? 'dialog' : undefined} onClick={action?.onOpen ? (e) => { if (isPlainClick(e)) { e.preventDefault(); action.onOpen(); } } : undefined}>{label}</Link> : null}
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
        <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{delta || (value == null ? 'nothing recorded yet' : 'change not recorded')}</span>
        {value != null && sparkDrawable(fig.spark) && <Spark values={fig.spark} label={`${fig.label}, last points`} />}
      </div>
    </div>
  );
}

export function CardBody({ card, onRetry, charts, compact = false, search = '' }) {
  const view = charts ? { state: 'ok', charts } : cardView(card);
  if (view.state === 'loading') {
    return (
      <div className="flex flex-col gap-2" data-testid="card-loading" aria-busy="true" aria-label="Loading">
        {[70, 92, 56, 80].map((w) => <div key={w} className="h-3 rounded-full bg-axal-ground dark:bg-gray-800" style={{ width: `${w}%` }} />)}
      </div>
    );
  }
  if (view.state === 'ok') {
    return <div className={`flex flex-col ${compact ? 'gap-3.5' : 'gap-5'}`}>{view.charts.map((s, i) => <Chart key={i} spec={s} label={card?.caption || card?.name} />)}</div>;
  }
  if (view.state === 'empty') {
    const next = card?.next;
    const href = nextHref(next?.href, search);
    return (
      <div className="flex flex-col items-start gap-1.5 rounded-[10px] border border-dashed border-gray-300 px-3.5 py-4 dark:border-gray-600" data-testid="card-empty">
        <span className="text-[12.5px] text-axal-muted dark:text-gray-400">{view.reason}</span>
        {next?.text && (href
          ? <Link to={href} className="text-[12px] font-bold text-axal-violet-deep hover:underline dark:text-violet-300">{next.text}</Link>
          : <span className="text-[12px] font-bold text-axal-violet-deep dark:text-violet-300">{next.text}</span>)}
      </div>
    );
  }
  if (view.state === 'too_little') {
    return <div className="rounded-[10px] border border-dashed border-gray-300 px-3.5 py-4 text-[12.5px] text-axal-muted dark:border-gray-600 dark:text-gray-400" data-testid="card-too-little">{view.reason}</div>;
  }
  if (view.state === 'not_recorded') {
    return (
      <div className="flex flex-col items-start gap-1.5" data-testid="card-not-recorded">
        <span className="rounded-full border border-dashed border-gray-300 bg-axal-ground px-2 py-0.5 text-[10.5px] font-semibold text-axal-muted dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">Not recorded</span>
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
export function CycleCard({ cycle, card, slug, onRetry, search = '' }) {
  const view = cardView(card);
  const name = card?.name || slug;
  const next = card?.next;
  const href = nextHref(next?.href, search);
  return (
    <article className={CARD} data-testid={`cycle-card-${card?.slug || slug}`} data-state={view.state}>
      <div className="flex items-baseline justify-between gap-2.5">
        {card?.slug
          ? <Link to={`/${cycle}/${card.slug}${linkSearch(search)}`} className="text-[14.5px] font-extrabold tracking-[-.01em] text-axal-ink hover:text-axal-violet-deep dark:text-gray-100">{name} ›</Link>
          : <span className="text-[14.5px] font-extrabold text-axal-ink dark:text-gray-100">{name || 'Loading…'}</span>}
        {card?.range && <span className="whitespace-nowrap text-[11px] text-axal-faint dark:text-gray-500">{card.range}</span>}
      </div>
      <CardBody card={card} onRetry={onRetry} compact search={search} />
      {view.state === 'ok' && card.caption && <span className="text-[12px] leading-relaxed text-axal-ink/80 dark:text-gray-300">{card.caption}</span>}
      {view.state === 'ok' && next?.text && (
        <span className="text-[11.5px] text-axal-muted dark:text-gray-400">
          Next: {href ? <Link to={href} className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">{next.text}</Link> : next.text}
        </span>
      )}
    </article>
  );
}

// D693 decision 14: a loading overview draws one placeholder per module of its cycle.
export default function CycleOverview({ cycle, data, status = data ? 'ready' : 'loading', message = '', onRetry, onRetryCard, action, placeholders = MODULES[cycle]?.length ?? 6, search = '' }) {
  const meta = cycleOf(cycle);
  if (!meta) return null;
  const cards = Array.isArray(data?.cards) ? data.cards : [];
  const figures = Array.isArray(data?.figures) ? data.figures : [];
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="cycle-overview" data-cycle={meta.key}>
      <CycleHeader cycle={meta.key} cards={cards} action={action} search={search} />
      {status === 'unreadable' ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30" data-testid="cycle-overview-unreadable">
          <Unreadable what={`The ${meta.name} overview`} claim={message || 'This is not a claim that nothing is recorded.'} onRetry={onRetry} />
        </div>
      ) : (
        <>
          {(status === 'loading' || figures.length > 0) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="cycle-figures">
              {status === 'loading'
                ? [0, 1, 2, 3].map((i) => <div key={i} className="h-[92px] rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" aria-busy="true" />)
                : figures.map((f) => <FigureTile key={f.key} fig={f} />)}
            </div>
          )}
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2" data-testid="cycle-cards">
            {status === 'loading'
              ? Array.from({ length: placeholders }, (_, i) => <CycleCard key={i} cycle={meta.key} card={null} slug="" search={search} />)
              : cards.map((c) => <CycleCard key={c.slug} cycle={meta.key} card={c} search={search} onRetry={onRetryCard ? () => onRetryCard(c.slug) : undefined} />)}
          </div>
        </>
      )}
    </div>
  );
}

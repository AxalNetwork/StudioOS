import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Unreadable, Unrecorded } from '../../../ui';
import { Bar100, ChartTable, HBars, Legend, WeekLines } from '../../../ui/Charts';
import { EMPTY_LINE } from './eventsDeskModel';
import {
  PERIODS, attentionRows, count, nextEvents, overviewBlock, overviewStatuses, overviewTileData,
  percent, profileParts, sourceParts, typeRows, weeklyChart, weeklySentence,
} from './overviewModel';
import { Card, EYE, LINK, Pill, SUB } from './parts';

/** D920: each D918 block keeps its own loading, failed, unrecorded or ready state. */
function State({ b, label, onRetry, children }) {
  if (b.state === 'loading') return <div role="status" className="animate-pulse py-3 text-[13px] text-axal-muted dark:text-gray-400">Reading…</div>;
  if (b.state === 'unreadable') return <Unreadable what={label} claim={b.reason || ''} onRetry={onRetry} />;
  if (b.state === 'unrecorded') return <p className={SUB}><Unrecorded reason={b.reason} />{b.reason ? ` · ${b.reason}` : ''}</p>;
  return children;
}

function OverviewTile({ t, pending, onRetry }) {
  return <Card testId={`events-tile-${t.key}`}>
    <span className={EYE}>{t.label}</span>
    <State b={t} label={t.label} onRetry={onRetry}>
      <div className="flex flex-col gap-1.5 break-words font-mono text-[24px] font-medium leading-tight tracking-[-.02em] text-axal-ink dark:text-gray-100">
        {(Array.isArray(t.value) ? t.value : [t.value]).map((line, i) => <span key={i}>{line}</span>)}
      </div>
      <span className={SUB}>{t.sub}</span>
      {t.delta ? <span className={SUB}>{t.delta}</span> : null}
      {t.flag ? <span className="self-start rounded-lg border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t.flag}</span> : null}
      {t.note ? <span className={SUB}>{t.note}</span> : null}
    </State>
    {pending ? <div data-testid="events-payment-pending"><State b={pending} label="Pending payments" onRetry={onRetry}><span className={SUB}>{count(pending.count)} payment pending</span></State></div> : null}
  </Card>;
}

function Block({ title, b, id, onRetry, children, meta, className = '' }) {
  return <Card title={title} meta={meta} testId={`events-block-${id}`} className={className}>
    <State b={b} label={title} onRetry={onRetry}>{children}</State>
  </Card>;
}
function Toggle({ table, setTable, id }) {
  return <button type="button" className={`${LINK} min-h-9 self-end`} aria-pressed={table} onClick={() => setTable(!table)} data-testid={`events-table-${id}`}>{table ? 'View as chart' : 'View as table'}</button>;
}

function Weekly({ b, showup, retry }) {
  const [table, setTable] = useState(false);
  const chart = weeklyChart(b);
  return <Block title="Registrations and check-ins by week" b={b} id="weekly" onRetry={retry}>
    {b.state === 'ready' ? <>
      <Toggle table={table} setTable={setTable} id="weekly" />
      {table ? <div className="overflow-x-auto"><ChartTable chart={chart} caption="Registrations and check-ins by week" /></div> : <>
        <Legend items={chart.series.map((s) => ({ label: s.label, tone: s.tone }))} />
        <div role="img" aria-label={chart.labels.map((l, i) => `${l}${i === chart.labels.length - 1 ? ' so far' : ''}: ${count(chart.series[0].values[i])} registrations, ${count(chart.series[1].values[i])} check-ins`).join('; ')}>
          <WeekLines series={chart.series} labels={chart.labels} />
        </div>
      </>}
      <p className={SUB}>The current week is still running: so far. Registrations use sign-up dates; check-ins use scan dates. A missing value breaks the line.</p>
      <p className="m-0 text-[13px] leading-normal text-axal-ink dark:text-gray-100" data-testid="events-weekly-sentence">{weeklySentence(b, showup)}</p>
    </> : null}
  </Block>;
}

function Types({ b, retry }) {
  const [all, setAll] = useState(false);
  const [table, setTable] = useState(false);
  const rows = typeRows(b, all);
  return <Block title="Events by type" b={b} id="types" onRetry={retry}>
    {b.state === 'ready' ? <>
      <span className={SUB}>Published and waiting events starting in this period.</span>
      <Toggle table={table} setTable={setTable} id="types" />
      {rows.length ? table ? <ChartTable chart={{ type: 'hbar', rows }} caption="Events by type" /> : <div role="img" aria-label={rows.map((r) => `${r.label}: ${count(r.value)}`).join('; ')}><HBars rows={rows} axis="events" /></div> : <p className={SUB}>No events of these types in this period.</p>}
      <button type="button" className={`${LINK} min-h-9 self-start`} onClick={() => setAll(!all)} aria-expanded={all} data-testid="events-types-all">{all ? 'Hide types with none' : 'Show all twelve types'}</button>
    </> : null}
  </Block>;
}

function ShowUp({ b, retry }) {
  const [table, setTable] = useState(false);
  const rows = (b.recent || []).slice(0, 8).map((r) => ({ label: r.title, value: Number.isFinite(r.rate) ? r.rate * 100 : null, text: `${count(r.attended)} of ${count(r.seats_taken)} · ${r.seats_taken === 0 ? 'No seats taken' : percent(r.rate)}`, tone: 'violet' }));
  return <Block title="Show-up by event" b={b} id="showup" onRetry={retry}>
    {b.state === 'ready' ? <>
      <span className={SUB}>Last eight events that ended in this period. The reference line marks all ended events.</span>
      {rows.length ? <>
        <Toggle table={table} setTable={setTable} id="showup" />
        <span className={SUB}>{b.seats_taken === 0 ? 'No seats taken at ended events.' : `All events ${percent(b.rate)}`}</span>
        {table ? <ChartTable chart={{ type: 'hbar', rows }} caption="Show-up by event" /> : <div role="img" aria-label={rows.map((r) => `${r.label}: ${r.text}`).join('; ')}><HBars rows={rows} truncateLabels max={100} reference={Number.isFinite(b.rate) ? b.rate * 100 : null} axis="100%" /></div>}
      </> : <p className={SUB}>No event has ended yet.</p>}
    </> : null}
  </Block>;
}

function Who({ b, source = false, retry }) {
  const [table, setTable] = useState(false);
  const parts = source ? sourceParts(b) : profileParts(b);
  const complete = parts.every((p) => Number.isFinite(p.value));
  const total = complete ? parts.reduce((n, p) => n + p.value, 0) : null;
  const title = source ? 'How they got a seat' : 'By profile';
  return <div data-testid={`events-who-${source ? 'source' : 'profile'}`} className="flex flex-col gap-3">
    <h3 className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">{title}</h3>
    <State b={b} label={title} onRetry={retry}>
      <Toggle table={table} setTable={setTable} id={source ? 'source' : 'profile'} />
      {table ? <ChartTable chart={{ type: 'hbar', rows: parts.map((p) => ({ ...p, text: count(p.value) })) }} caption={title} /> : <>
        {total > 0 ? <div role="img" aria-label={parts.map((p) => `${p.label}: ${count(p.value)}`).join('; ')}><Bar100 parts={parts} /></div> : <p className={SUB}>{total === 0 ? 'No seats taken this period.' : 'Counts not recorded.'}</p>}
        <Legend items={parts.map((p) => ({ ...p, label: `${p.label} · ${count(p.value)}` }))} />
      </>}
      {!source ? <p className={SUB}>Other includes explorers, guests and admins. Unknown profiles: {count(b.counts?.not_recorded)}. The bar covers recorded profiles.</p> : <p className={SUB}>Added by an admin · <Unrecorded reason={b.added_by_admin?.reason} /></p>}
    </State>
  </div>;
}

export default function EventsOverview({ reads, now, weeks = 12, onWeeks }) {
  const get = (key) => overviewBlock(reads.overview, key);
  const weekly = get('weekly');
  const showup = get('show_up');
  const attention = get('needs_attention');
  const status = get('by_status');
  const next = nextEvents(reads.all, now);
  const tiles = overviewTileData(reads.overview);
  const statuses = overviewStatuses(status);
  const empty = status.state === 'ready' && statuses.every((s) => s.count === 0);
  return <div className="flex flex-col gap-3.5" data-testid="events-overview">
    <div role="radiogroup" aria-label="Overview period" className="flex flex-wrap items-center gap-2" data-testid="events-period">
      {PERIODS.map((n) => <label key={n} className="cursor-pointer">
        <input type="radio" name="events-overview-period" value={n} checked={weeks === n} onChange={() => onWeeks?.(n)} className="peer sr-only" data-testid={`events-period-${n}`} />
        <span className={`inline-flex min-h-10 items-center rounded-lg border px-3 text-[12px] font-bold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-axal-violet ${weeks === n ? 'border-axal-violet bg-axal-lavender text-axal-violet dark:border-violet-400 dark:bg-violet-950 dark:text-violet-300' : 'border-axal-hairline bg-white text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400'}`}>{n} weeks</span>
      </label>)}
      <span className={SUB}>Monday weeks, UTC · current week so far</span>
    </div>
    {empty ? <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="events-empty">{EMPTY_LINE}</p> : null}
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="events-tiles">
      {tiles.map((t) => <OverviewTile key={t.key} t={t} pending={t.key === 'paid' ? get('payment_pending') : null} onRetry={reads.reload} />)}
    </div>
    <Weekly b={weekly} showup={showup} retry={reads.reload} />
    <div className="grid gap-3.5 lg:grid-cols-2">
      <Block title="Needs attention" b={attention} id="attention" meta={attention.state === 'ready' ? `${count(attention.total)} items` : null} onRetry={reads.reload}>
        {attentionRows(attention).map((r, i) => <div key={`${r.kind}-${r.event_id}`} className="flex flex-wrap items-start justify-between gap-2 border-b border-axal-hairline pb-3 dark:border-gray-700" data-testid={`events-attention-${i}`}>
          <div className="min-w-0 flex-1"><Pill tone={r.tone}>{r.label}</Pill><p className="my-1 text-[13px] text-axal-ink dark:text-gray-100">{r.title} {r.detail}</p></div>
          <Link className={`${LINK} min-h-10 py-2`} to={r.href}>{r.action}</Link>
        </div>)}
        {attention.state === 'ready' ? <><p className={SUB}>{attention.total === 0 ? 'Nothing needs attention.' : `Showing ${Math.min(6, attention.items?.length || 0)} of ${count(attention.total)} items.`}</p><Link className={LINK} to="/admin/events/all?view=attention">See all</Link></> : null}
      </Block>
      <Block title="Next up" b={next} id="next" meta="Next five events" onRetry={reads.reload}>
        {(next.rows || []).map((e) => <div key={e.id} className="flex flex-col gap-1.5 border-b border-axal-hairline pb-3 dark:border-gray-700" data-testid={`events-next-${e.id}`}>
          <Link className={LINK} to={`/admin/events/${e.id}`}>{e.title}</Link><span className={SUB}>{e.when}</span>
          <div className="flex flex-wrap gap-2"><Pill>{e.typeLabel}</Pill><span className={SUB}>{e.formatLabel}</span>{e.status === 'pending_review' ? <Pill tone="amber">{e.statusLabel}</Pill> : null}</div>
          <span className={SUB}>{e.status === 'pending_review' ? 'Sign-ups open once approved' : `${count(e.seats_taken)} taken · ${!(e.capacity > 0) ? 'No cap' : `${count(e.capacity)} capacity`} · ${count(e.waitlisted)} waiting`}</span>
          {e.status === 'published' && e.capacity > 0 && Number.isFinite(e.seats_taken) ? <div className="h-1.5 rounded bg-axal-ground dark:bg-gray-800"><div className="h-1.5 rounded bg-axal-violet dark:bg-violet-400" style={{ width: `${Math.min(100, e.seats_taken / e.capacity * 100)}%` }} /></div> : null}
        </div>)}
        {next.state === 'ready' && next.rows.length === 0 ? <p className={SUB}>No upcoming events.</p> : null}
      </Block>
    </div>
    <div className="grid gap-3.5 lg:grid-cols-3"><Types b={get('by_type')} retry={reads.reload} /><ShowUp b={showup} retry={reads.reload} /><Card title="Who comes" testId="events-block-who"><Who b={get('by_role')} retry={reads.reload} /><Who b={get('by_source')} source retry={reads.reload} /></Card></div>
    <Block title="Every event by status" b={status} id="status" onRetry={reads.reload}>
      <div className="flex flex-wrap gap-2">{statuses.map((s) => <Link key={s.key} to={s.key === 'other' ? '/admin/events/all' : `/admin/events/all?status=${encodeURIComponent(s.key)}`} className="min-h-10 py-1" data-testid={`events-status-${s.key}`}><Pill tone={s.tone}>{s.word} · {count(s.count)}</Pill></Link>)}</div>
    </Block>
    <div className="grid gap-3.5 lg:grid-cols-2">{[['views', 'Page views'], ['feedback', 'Feedback']].map(([key, title]) => <Block key={key} title={title} b={get(key)} id={key} onRetry={reads.reload} className="border-dashed" />)}</div>
  </div>;
}

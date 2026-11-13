import React, { useEffect, useRef } from 'react';
import { Coins } from 'lucide-react';
import Sheet from '../../../ui/Sheet.jsx';
import { CoverageMark } from './RevenueStates.jsx';
import { coverageCount, readAgo, readClock } from './revenueModel.js';

/**
 * D5039 (canvas RV01 header, RV11 drawer) — the cockpit's header and its Data
 * coverage drawer.
 *
 * Period drives every figure tagged with the period; Scope narrows the parts
 * that name a licence (receivables, subsidiaries, promotions) and leaves the
 * platform-wide figures as they are, which say so. The read time is when the
 * summary answered. The coverage button counts sources, and opens the one
 * place on the page where each "why" is written.
 */

const SELECT = 'min-h-[44px] sm:min-h-[36px] rounded-lg border border-axal-hairline bg-white px-2.5 text-[13px] font-semibold text-axal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** The nine-dot strip on the coverage button: one per source, its shape by state. */
function CoverageDots({ sources }) {
  return (
    <span aria-hidden="true" className="inline-flex gap-[3px]">
      {sources.map((s) => (
        <span
          key={s.key}
          className={`inline-block h-2 w-2 rounded-sm ${
            s.state === 'complete' || s.state === 'live' ? 'bg-emerald-600 dark:bg-emerald-400'
              : s.state === 'partial' || s.state === 'stale' ? 'border border-amber-600 bg-amber-200 dark:bg-amber-700'
                : s.state === 'loading' ? 'bg-axal-hairline dark:bg-gray-700'
                  : 'border-[1.5px] border-dashed border-axal-muted bg-transparent dark:border-gray-400'}`}
        />
      ))}
    </span>
  );
}

export function RevenueHeader({
  period, periods, onPeriod, scope, scopes, onScope, stream = 'all', onStream, readAt, nowMs, sources, onCoverage, ask = null,
}) {
  const count = coverageCount(sources);
  const ago = readAgo(readAt, nowMs);
  const clock = readClock(readAt);
  return (
    <header className="flex flex-col gap-3" data-testid="hq-revenue-header">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[12px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">
            <Coins size={13} aria-hidden="true" /> HQ · Revenue
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Revenue</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-axal-muted dark:text-gray-400">
            Revenue, receivables, billing exceptions and subsidiary reporting across HQ.
          </p>
        </div>
        {ask}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[13px] text-axal-muted dark:text-gray-400">
            Period
            <select className={SELECT} value={period || ''} onChange={(e) => onPeriod(e.target.value)} data-testid="hq-revenue-period" disabled={!periods.length}>
              {!periods.length && <option value="">Loading…</option>}
              {periods.map((p) => <option key={p.key} value={p.key}>{p.label}{p.current ? ' (current)' : ''}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[13px] text-axal-muted dark:text-gray-400">
            Scope
            <select className={SELECT} value={scope || ''} onChange={(e) => onScope(e.target.value || null)} data-testid="hq-revenue-scope">
              <option value="">All subsidiaries</option>
              {scopes.map((s) => <option key={s.licence_uid} value={s.licence_uid}>{s.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[13px] text-axal-muted dark:text-gray-400">
            Stream
            <select className={SELECT} value={stream} onChange={(e) => onStream?.(e.target.value)} aria-describedby="revenue-stream-scope" data-testid="hq-revenue-stream-filter">
              <option value="all">All streams</option>
              <option value="licence_fees">Licence fees</option>
              <option value="statements">Revenue-share statements</option>
              <option value="subscriptions">Subscriptions</option>
              <option value="tokens">AI / tokens</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[12.5px] text-axal-muted dark:text-gray-400">
          <span data-testid="hq-revenue-read-time">
            {clock ? <>Read <b className="font-semibold text-axal-ink dark:text-gray-100">{ago}</b> · {clock}</> : 'Reading…'}
          </span>
          <button
            type="button"
            onClick={() => onCoverage(null)}
            aria-haspopup="dialog"
            aria-label={`Data coverage: ${count.label}${count.partial ? `, ${count.partial} partial` : ''}${count.missing ? `, ${count.missing} not complete` : ''}${count.loading ? `, ${count.loading} loading` : ''}. Open details`}
            className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-axal-hairline bg-white px-3 font-sans text-[13px] font-bold text-axal-ink hover:bg-axal-ground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
            data-testid="hq-revenue-coverage-button"
          >
            <CoverageDots sources={sources} />
            {count.label}
          </button>
        </div>
      </div>
    </header>
  );
}

/**
 * RV11 — Data coverage. Each source once, with its state and its reason. A
 * figure's "Why?" opens this at its own source.
 */
export function DataCoverageDrawer({ sources, focus, period, readAt, onClose, onReload }) {
  const count = coverageCount(sources);
  const listRef = useRef(null);
  useEffect(() => {
    if (!focus || !listRef.current || typeof listRef.current.querySelector !== 'function') return;
    const el = listRef.current.querySelector(`[data-source="${focus}"]`);
    el?.scrollIntoView?.({ block: 'center' });
    el?.focus?.();
  }, [focus]);
  return (
    <Sheet
      eyebrow="Data coverage"
      title={count.label}
      sub={`${readClock(readAt) ? `Read ${readClock(readAt)}` : 'Reading'} · ${period}`}
      onClose={onClose}
      width={520}
      testId="hq-revenue-coverage"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] text-axal-muted dark:text-gray-400">Every “Why?” on the page opens here. Each explanation lives once, in this panel.</p>
          <button type="button" onClick={onReload} className="min-h-[36px] rounded-lg border border-axal-hairline px-3 text-[13px] font-bold dark:border-gray-700">Re-read all sources</button>
        </div>
      )}
    >
      <ul ref={listRef} className="divide-y divide-axal-hairline px-5 py-2 dark:divide-gray-800" data-testid="hq-revenue-coverage-list">
        {sources.map((s) => (
          <li
            key={s.key}
            id={`coverage-${s.key}`}
            data-source={s.key}
            tabIndex={-1}
            className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-3 outline-none focus-visible:ring-2 focus-visible:ring-axal-violet ${focus === s.key ? 'bg-violet-50/60 dark:bg-violet-950/20' : ''}`}
          >
            <b className="text-[14px] text-axal-ink dark:text-gray-100">{s.name}</b>
            <span className="row-span-2 self-start"><CoverageMark state={s.state} /></span>
            <p className="text-[13px] leading-relaxed text-axal-muted dark:text-gray-400">{s.reason}</p>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

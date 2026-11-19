/**
 * D5020 (#5020, the HQ screens) — what the three Country pricing pages share: the frame (title, the Pricing tabs,
 * the back link to the ledger), one read's states (Reading, Unavailable with Retry, refused) and the state tags.
 * HQ only: the routes are `hqOnly`, and the reads are Super Admin, so a refusal is said as that, never as empty.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { reportError } from '../../../lib/log';
import { RailFrame, Unreadable, WorkerRail } from '../../../ui';
import { PRICING_TABS } from './pricingHqModel';

const TAG = {
  value: 'text-gray-900 dark:text-gray-100',
  complete: 'text-gray-900 dark:text-gray-100',
  current: 'text-gray-700 dark:text-gray-300',
  provisional: 'font-medium text-amber-800 dark:text-amber-300',
  stale: 'font-medium text-amber-800 dark:text-amber-300',
  incomplete: 'font-semibold text-rose-700 dark:text-rose-300',
  not_recorded: 'italic text-gray-500 dark:text-gray-400',
  unavailable: 'font-semibold text-red-700 dark:text-red-300',
};

/** One state with its word, never colour alone. */
export function Tag({ c, testId }) {
  return <span className={TAG[c?.state] || TAG.value} data-state={c?.state} data-testid={testId}>{c?.label}</span>;
}

/**
 * One read: `{ state: 'loading' | 'ok' | 'error' | 'refused', data, retry }`. A newer read wins over an older one
 * that answers late.
 */
export function usePricingRead(fn, deps, what) {
  const [res, setRes] = useState({ state: 'loading', data: null });
  const gen = useRef(0);
  const run = useCallback(() => {
    gen.current += 1;
    const mine = gen.current;
    setRes((r) => ({ state: 'loading', data: r.data }));
    fn()
      .then((data) => { if (mine === gen.current) setRes({ state: 'ok', data }); })
      .catch((e) => {
        if (mine !== gen.current) return;
        reportError(`licence_pricing_${what}_failed`, e);
        setRes({ state: e?.status === 403 ? 'refused' : 'error', data: null, status: e?.status ?? null });
      });
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [run]);
  return { ...res, retry: run };
}

/** The states a read can be in before there is anything to draw. Null once it has data. */
export function ReadState({ res, what }) {
  if (res.state === 'ok' || (res.state === 'loading' && res.data)) return null;
  if (res.state === 'loading') {
    return <p className="mt-6 text-sm text-gray-500 dark:text-gray-400" data-testid="pricing-reading"><Loader2 size={14} className="inline animate-spin" /> Reading {what}…</p>;
  }
  if (res.state === 'refused') {
    return (
      <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status" data-testid="pricing-refused">
        Country pricing is Super Admin only, at HQ. Your account cannot read {what}; that is not a claim that there is none.
      </p>
    );
  }
  return <div className="mt-6" data-testid="pricing-unavailable"><Unreadable what={what.replace(/^./, (c) => c.toUpperCase())} claim="It is Unavailable, not empty." onRetry={res.retry} /></div>;
}

const TAB_LABEL = Object.fromEntries(PRICING_TABS.map((t) => [t.key, t.label]));
const tabProps = (current, key) => ({
  'aria-current': key === current ? 'page' : undefined,
  'data-testid': `pricing-tab-${key}`,
  className: `whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${key === current
    ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
    : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'}`,
});

/** The frame: back to the ledger, the title, the Pricing tabs with only the current one lit. */
export function PricingFrame({ tab, title, lede, tools, children, testId }) {
  const rail = <WorkerRail workspace="Licences" role="super_admin" note="Eadwyn reads country pricing on this page and changes nothing." data-testid="hq-licence-pricing-rail" />;
  return (
    <RailFrame rail={rail} data-testid={testId}>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <p className="text-[12px] font-semibold text-gray-500 dark:text-gray-400">
          <a href="/admin/licences" className="hover:underline">Licences</a> / Pricing
        </p>
        <header className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{title}</h1>
            {lede && <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-400">{lede}</p>}
          </div>
          {tools && <div className="flex flex-wrap items-center gap-2">{tools}</div>}
        </header>
        <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800" aria-label="Country pricing" data-testid="pricing-tabs">
          {/* Each tab is written out whole, so the route guard (`admin_route_reachability.test.mjs`) reads it as a door. */}
          <a href="/admin/licences/pricing" {...tabProps(tab, 'catalogue')}>{TAB_LABEL.catalogue}</a>
          <a href="/admin/licences/pricing/reviews" {...tabProps(tab, 'reviews')}>{TAB_LABEL.reviews}</a>
          <a href="/admin/licences/pricing/models" {...tabProps(tab, 'models')}>{TAB_LABEL.models}</a>
        </nav>
        {children}
      </div>
    </RailFrame>
  );
}

export const cardClass = 'rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';
export const thClass = 'whitespace-nowrap border-b border-gray-200 bg-gray-50 px-3 py-2 text-left font-mono text-[10px] font-bold uppercase tracking-[.07em] text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400';
export const tdClass = 'px-3 py-2.5 align-top';
export const todayIso = () => new Date().toISOString().slice(0, 10);

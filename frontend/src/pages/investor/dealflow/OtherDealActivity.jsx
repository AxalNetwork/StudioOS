/**
 * D4815 (#4815), canvas DX1 — "Other deal activity": one compact line under
 * Deal flow with a count per zone, each linking to the zone's own route. It
 * replaces the zone mini-boards that stacked under the flow. The counts and
 * their sources are `otherActivityModel.js`'s. Every entry is a link to a
 * route, Deal rooms included (`/deals/rooms`, the second slice).
 *
 * D6160 (#6160, canvas DCA18): after the four, "Round calls · 3 open" from
 * the investor's own round calls list, read only for an account whose role is
 * investor (the Worker's investor branch). It is absent while the read is out
 * and while calls are switched off, and Unreadable alone when its read fails.
 *
 * `surviving`: the personal flow above could not be read. The line then
 * carries a heading saying the rest is still available, so nothing below is
 * mistaken for the investor's own deal flow.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { roundCallsApi } from '../../../lib/api/roundCalls';
import { useAuth } from '../../../hooks/useAuthSync';
import { reportError } from '../../../lib/log';
import {
  OTHER_ACTIVITY_SURVIVING, OTHER_ACTIVITY_TITLE, ROUND_CALLS_ENTRY, otherActivityItems, otherActivityLabel,
  roundCallsItem, roundCallsLabel, roundCallsReadOf,
} from './otherActivityModel';

const SOURCES = {
  screening: () => api.dealScreening(),
  commit: () => api.icCommitRoom(),
  closing: () => api.listDeals(undefined, 'mine'),
  rooms: () => api.listDeals(),
};

/** The four reads, and the round calls read for an investor, each failing on its own. */
function useActivityReads(roundCalls) {
  const [reads, setReads] = useState({});
  const load = useCallback(() => {
    setReads({});
    for (const [key, read] of Object.entries(SOURCES)) {
      Promise.resolve().then(read).then(
        (data) => setReads((s) => ({ ...s, [key]: { kind: 'ok', data } })),
        (e) => { reportError('OtherDealActivity:read', e); setReads((s) => ({ ...s, [key]: { kind: 'unreadable', data: null } })); },
      );
    }
    if (roundCalls) {
      const key = ROUND_CALLS_ENTRY.key;
      Promise.resolve().then(() => roundCallsApi.investorList()).then(
        (data) => setReads((s) => ({ ...s, [key]: { kind: 'ok', data } })),
        (e) => {
          const read = roundCallsReadOf(e);
          if (read.kind === 'unreadable') reportError('OtherDealActivity:round-calls', e);
          setReads((s) => ({ ...s, [key]: read }));
        },
      );
    }
  }, [roundCalls]);
  useEffect(() => { load(); }, [load]);
  return [reads, load];
}

const LINK = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-[9px] px-2 text-[13px] text-axal-ink hover:bg-violet-50 dark:text-gray-100 dark:hover:bg-violet-950 md:min-h-0 md:py-1';

function Figure({ item }) {
  if (item.state === 'count') return <b className="font-mono tabular-nums" data-testid={`other-activity-${item.key}-count`}>{item.count}</b>;
  if (item.state === 'unreadable') return <span className="text-[12px] font-semibold text-amber-800 dark:text-amber-300" data-testid={`other-activity-${item.key}-unreadable`}>Unreadable</span>;
  return <span className="text-[12px] text-axal-muted dark:text-gray-400" aria-hidden="true">…</span>;
}

export function OtherDealActivityLine({ reads, surviving = false, onRetry }) {
  const items = otherActivityItems(reads);
  const calls = roundCallsItem(reads?.[ROUND_CALLS_ENTRY.key]);
  const anyUnreadable = items.some((i) => i.state === 'unreadable') || calls?.state === 'unreadable';
  return (
    <section className="flex flex-col gap-2 rounded-[12px] border border-axal-hairline bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900"
      aria-label={surviving ? OTHER_ACTIVITY_SURVIVING : OTHER_ACTIVITY_TITLE} data-testid="other-activity">
      {surviving && <h2 className="m-0 text-[13.5px] font-bold" data-testid="other-activity-surviving">{OTHER_ACTIVITY_SURVIVING}</h2>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {!surviving && <b className="text-[13.5px]">{OTHER_ACTIVITY_TITLE}</b>}
        {items.map((item) => (
          <Link key={item.key} to={item.href} className={LINK} aria-label={otherActivityLabel(item)} data-testid={`other-activity-${item.key}`}>{item.label} <Figure item={item} /> <span aria-hidden="true">→</span></Link>))}
        {calls && (
          <Link to={calls.href} className={`${LINK} border border-axal-hairline dark:border-gray-700`} aria-label={roundCallsLabel(calls)} data-testid="other-activity-round_calls">
            {calls.label} · {calls.state === 'count'
              ? <><b className="font-mono tabular-nums" data-testid="other-activity-round_calls-count">{calls.count}</b> open</>
              : <span className="text-[12px] font-semibold text-amber-800 dark:text-amber-300" data-testid="other-activity-round_calls-unreadable">! Unreadable</span>}
            {' '}<span aria-hidden="true">→</span>
          </Link>
        )}
        {anyUnreadable && onRetry && <button type="button" className="text-[12.5px] font-semibold underline" onClick={onRetry} data-testid="other-activity-retry">Try again</button>}
      </div>
    </section>
  );
}

export default function OtherDealActivity({ surviving = false }) {
  const { user } = useAuth() || {};
  // The Worker's investor branch answers on `users.role`; anyone else takes the founder's list.
  const [reads, retry] = useActivityReads(user?.role === 'investor');
  return <OtherDealActivityLine reads={reads} surviving={surviving} onRetry={retry} />;
}

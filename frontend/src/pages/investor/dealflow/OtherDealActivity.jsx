/**
 * D4815 (#4815), canvas DX1 — "Other deal activity": one compact line under
 * Deal flow with a count per zone, each linking to the zone's own route. It
 * replaces the zone mini-boards that stacked under the flow. The counts and
 * their sources are `otherActivityModel.js`'s. Every entry is a link to a
 * route, Deal rooms included (`/deals/rooms`, the second slice).
 *
 * `surviving`: the personal flow above could not be read. The line then
 * carries a heading saying the rest is still available, so nothing below is
 * mistaken for the investor's own deal flow.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import {
  OTHER_ACTIVITY_SURVIVING, OTHER_ACTIVITY_TITLE, otherActivityItems, otherActivityLabel,
} from './otherActivityModel';

const SOURCES = {
  screening: () => api.dealScreening(),
  commit: () => api.icCommitRoom(),
  closing: () => api.listDeals(undefined, 'mine'),
  rooms: () => api.listDeals(),
};

/** The four reads, each failing on its own. */
function useActivityReads() {
  const [reads, setReads] = useState({});
  const load = useCallback(() => {
    setReads({});
    for (const [key, read] of Object.entries(SOURCES)) {
      Promise.resolve().then(read).then(
        (data) => setReads((s) => ({ ...s, [key]: { kind: 'ok', data } })),
        (e) => { reportError('OtherDealActivity:read', e); setReads((s) => ({ ...s, [key]: { kind: 'unreadable', data: null } })); },
      );
    }
  }, []);
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
  const anyUnreadable = items.some((i) => i.state === 'unreadable');
  return (
    <section className="flex flex-col gap-2 rounded-[12px] border border-axal-hairline bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900"
      aria-label={surviving ? OTHER_ACTIVITY_SURVIVING : OTHER_ACTIVITY_TITLE} data-testid="other-activity">
      {surviving && <h2 className="m-0 text-[13.5px] font-bold" data-testid="other-activity-surviving">{OTHER_ACTIVITY_SURVIVING}</h2>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {!surviving && <b className="text-[13.5px]">{OTHER_ACTIVITY_TITLE}</b>}
        {items.map((item) => (
          <Link key={item.key} to={item.href} className={LINK} aria-label={otherActivityLabel(item)} data-testid={`other-activity-${item.key}`}>{item.label} <Figure item={item} /> <span aria-hidden="true">→</span></Link>))}
        {anyUnreadable && onRetry && <button type="button" className="text-[12.5px] font-semibold underline" onClick={onRetry} data-testid="other-activity-retry">Try again</button>}
      </div>
    </section>
  );
}

export default function OtherDealActivity({ surviving = false }) {
  const [reads, retry] = useActivityReads();
  return <OtherDealActivityLine reads={reads} surviving={surviving} onRetry={retry} />;
}

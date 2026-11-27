import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { roundCallsApi } from '../../lib/api/roundCalls.js';
import { reportError } from '../../lib/log';

/**
 * D686 §5.6 item 11 (#1598) — HQ · Review queue's "Counsel review" tab: the
 * round calls whose founder asked for counsel review of their current terms,
 * oldest request first, from `GET /api/round-calls/counsel-queue` (Super
 * Admin, independent of the venture; the Worker filters). Each row opens the
 * call at `/round-calls/:uid`, where the counsel form already is. Nothing is
 * approved here.
 */
const INSTRUMENTS = { safe: 'SAFE', equity: 'Equity', convertible_note: 'Convertible note' };
const ROW = 'flex items-start justify-between gap-3 border-b border-axal-hairline px-4 py-3 text-[13px] last:border-b-0 dark:border-gray-800';

const day = (v) => {
  const d = v ? new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z')) : null;
  return d && !Number.isNaN(d.valueOf()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null;
};

/** The tab's body from its read alone: loading, Coming soon, Unreadable, empty, or the rows. */
export function CounselQueueView({ read, onRetry }) {
  if (read.status === 'loading') return <p role="status" className="text-[13px] text-axal-muted">Loading…</p>;
  if (read.status === 'off') return <p className="text-[13px] text-axal-muted" data-testid="counsel-queue-off">Coming soon. Round calls are not enabled.</p>;
  if (read.status === 'unreadable') {
    return (
      <p role="alert" className="text-[13px]" data-testid="counsel-queue-unreadable">
        Unreadable. The counsel queue could not be read; this is not a claim that it is empty.{' '}
        <button type="button" onClick={onRetry} className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Try again</button>
      </p>
    );
  }
  const items = read.data?.items || [];
  if (!items.length) return <p className="text-[13px] text-axal-muted" data-testid="counsel-queue-empty">No call is waiting for counsel review.</p>;
  return (
    <ul className="rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" data-testid="counsel-queue">
      {items.map((c) => (
        <li key={c.uid} className={ROW} data-testid="counsel-queue-row">
          <div className="min-w-0">
            <div className="font-semibold text-axal-ink dark:text-gray-100">{c.name}</div>
            <div className="text-[12px] text-axal-muted dark:text-gray-400">
              {[c.project_name, INSTRUMENTS[c.instrument] || c.instrument, c.state === 'awaiting_counsel' ? 'Paused for renewed approval' : 'Draft', day(c.counsel_requested_at) && `Requested ${day(c.counsel_requested_at)}`].filter(Boolean).join(' · ')}
            </div>
          </div>
          <Link to={`/round-calls/${encodeURIComponent(c.uid)}`} className="shrink-0 font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Review the terms</Link>
        </li>
      ))}
    </ul>
  );
}

/** The tab with its read. */
export default function CounselQueue() {
  const [read, setRead] = useState({ status: 'loading' });
  const load = useCallback(() => {
    setRead({ status: 'loading' });
    roundCallsApi.counselQueue().then(
      (data) => setRead({ status: 'ready', data }),
      (e) => {
        if (e?.code === 'round_calls_disabled') { setRead({ status: 'off' }); return; }
        reportError('ReviewQueue:counsel', e); setRead({ status: 'unreadable' });
      },
    );
  }, []);
  useEffect(() => { load(); }, [load]);
  return <CounselQueueView read={read} onRetry={load} />;
}

import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Unreadable, Unrecorded } from '../../../ui';
import {
  EMPTY_LINE, LIST_CLAIM, UNRECORDED_BLOCKS, analyticsJoin, overviewTiles, readyList, statusCounts,
} from './eventsDeskModel';
import { Card, Pill, Tile } from './parts';

/**
 * D915 (#2368) — Overview (EV1), the blocks whose reads exist (D915 §3): the
 * four tiles, the status strip from R1 (each chip opens All events with that
 * status), and Page views and Feedback as "Not recorded". The period control,
 * the weekly chart, Registrations, Paid tickets, Free seats, Cancelled, Who
 * comes, Events by type, Needs attention, Next up and Show-up by event wait for
 * the parts that build them (§6).
 */
export default function EventsOverview({ reads, now }) {
  const list = readyList(reads.all);
  const join = useMemo(() => analyticsJoin(reads.analytics, list ? list.length : 0), [reads.analytics, list]);
  const tiles = overviewTiles({ all: reads.all, queue: reads.queue, join, now });
  const empty = list !== null && list.length === 0;
  return (
    <div className="flex flex-col gap-3.5" data-testid="events-overview">
      {empty ? <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="events-empty">{EMPTY_LINE}</p> : null}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="events-tiles">
        {tiles.map((t) => <Tile key={t.key} t={t} onRetry={reads.reload} />)}
      </div>
      <Card title="Every event by status" testId="events-status-strip">
        {reads.all.status === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">Reading…</span> : null}
        {reads.all.status === 'error' ? <Unreadable what="The events list" claim={LIST_CLAIM} onRetry={reads.reload} /> : null}
        {list ? (
          <div className="flex flex-wrap gap-[7px]">
            {statusCounts(list).map((s) => (
              <Link key={s.key} to={`/admin/events/all?status=${encodeURIComponent(s.key)}`} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-axal-violet" data-testid={`events-status-${s.key}`}>
                <Pill tone={s.tone}>{`${s.word} · ${s.count.toLocaleString('en-US')}`}</Pill>
              </Link>
            ))}
          </div>
        ) : null}
      </Card>
      <div className="grid gap-3.5 lg:grid-cols-2">
        {UNRECORDED_BLOCKS.map((b) => (
          <Card key={b.key} title={b.title} className="border-dashed" testId={`events-unrecorded-${b.key}`}>
            <span className="text-[12.5px]"><Unrecorded reason={b.reason} /></span>
            <p className="m-0 text-[12.5px] leading-normal text-axal-muted dark:text-gray-400">{b.reason}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

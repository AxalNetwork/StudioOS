/**
 * HQ · Support — canvas Y1, three queues.
 *
 * Escalations already have a store (`hq_escalations`) and are queue 1.
 * HQ-held end-user tickets and subsidiary-admin tickets about the admin
 * product do not: those two queues say so, rather than borrowing /help,
 * which is one inbox for every role and cannot tell the three apart.
 *
 * Super Admin stays on axal.vc. This page does not configure a domain.
 */
import React, { useCallback, useState, useEffect } from 'react';
import { Inbox } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';

const UNAVAILABLE = Symbol('unavailable');

function Absent({ reason }) {
  return (
    <p className="text-[12.5px] leading-relaxed text-axal-muted">
      <Unrecorded /> — {reason}
    </p>
  );
}

export default function HqSupportPage() {
  const [lane, setLane] = useState(null);
  const load = useCallback(() => {
    setLane(null);
    api.escalations({ status: 'open' }).then(setLane, (e) => {
      reportError('hq-support', e);
      setLane(UNAVAILABLE);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = lane && lane !== UNAVAILABLE && lane.available ? (lane.items || []) : null;
  const oldest = items && items.length
    ? items.reduce((a, b) => (String(a.created_at) < String(b.created_at) ? a : b))
    : null;

  const coverage = items
    ? [`${items.length} open escalation${items.length === 1 ? '' : 's'} from subsidiaries.`]
    : [];

  return (
    <div className="mx-auto grid max-w-6xl gap-4 px-4 py-6 lg:grid-cols-[1fr_280px]" data-testid="hq-support-page">
      <div>
        <header>
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <Inbox size={13} /> HQ · Support
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Support</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            Three queues. Escalations are what subsidiaries push up. The other two — people HQ holds
            directly, and subsidiary admins stuck on the admin product — are not a separate store yet,
            so they are named rather than counted as zero.
          </p>
        </header>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Card>
            <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Escalations</div>
            <div className="mt-1 text-2xl font-extrabold tabular-nums text-axal-ink dark:text-white">
              {items ? items.length : <Unrecorded />}
            </div>
            <p className="mt-1 text-[11px] text-axal-faint">
              {oldest ? `Oldest ${String(oldest.created_at).slice(0, 16).replace('T', ' ')}` : 'Pushed up by subsidiaries'}
            </p>
          </Card>
          <Card>
            <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">HQ-held users</div>
            <div className="mt-1 text-2xl font-extrabold"><Unrecorded /></div>
            <p className="mt-1 text-[11px] leading-relaxed text-axal-faint">
              No ticket names an HQ-held account separately from the shared Help Center.
            </p>
          </Card>
          <Card>
            <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">Subsidiary admins</div>
            <div className="mt-1 text-2xl font-extrabold"><Unrecorded /></div>
            <p className="mt-1 text-[11px] leading-relaxed text-axal-faint">
              Admins filing about the admin product have no queue of their own. Open a ticket on Studio still lands in Help.
            </p>
          </Card>
        </div>

        <Card className="mt-4">
          <h2 className="text-[14.5px] font-extrabold tracking-tight">Escalations awaiting HQ</h2>
          {lane === null && <p className="mt-2 text-[12.5px] text-axal-muted">Reading the escalation board…</p>}
          {lane === UNAVAILABLE && (
            <div className="mt-2">
              <Unreadable what="Escalations" claim="This is not a claim that nothing was pushed up." onRetry={load} />
            </div>
          )}
          {lane && lane !== UNAVAILABLE && !lane.available && <div className="mt-2"><Absent reason={lane.reason} /></div>}
          {items && items.length === 0 && (
            <p className="mt-2 text-[12.5px] text-axal-muted" data-testid="hq-support-empty">
              Nothing is open. An empty board means nothing was pushed up, not that the queue cannot exist.
            </p>
          )}
          {items && items.length > 0 && (
            <ul className="mt-3 space-y-2" data-testid="hq-support-escalations">
              {items.map((it) => (
                <li key={it.uid} className="rounded-xl border border-axal-hairline bg-axal-ground p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-bold text-axal-ink dark:text-white">{it.subject || it.kind}</div>
                      <div className="mt-0.5 text-[10.5px] text-axal-faint">
                        {it.branch_code} · {it.kind} · {it.created_at}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[.08em] text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                      {it.sla === 'past' ? 'past SLA' : 'open'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <WorkerRail
        workspace="Support"
        role="super_admin"
        stance="Read-only summary"
        note="Escalations are the only queue with a store. The other two are named, not counted."
        coverage={coverage}
        coverageNote={coverage.length ? undefined : 'The escalation board has not answered yet.'}
        unavailable={[
          ['HQ-held user tickets', 'Help Center is one inbox and does not mark who HQ holds.'],
          ['Subsidiary-admin product tickets', 'No ticket persona separates admins stuck on the console from everyone else.'],
        ]}
      />
    </div>
  );
}

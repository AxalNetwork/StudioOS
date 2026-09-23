/**
 * HQ · Support — canvas H22, which draws Y1: three queues, the tenant × queue
 * matrix, and the ticket→GitHub mirror strip (D204).
 *
 * WHAT CHANGED. This page used to count one queue and mark the other two
 * "Not recorded", on the ground that no ticket persona separated them. Every
 * fact those two queues need was already on HQ's own database — a ticket names
 * its requester, the account says what it is, `licence_admins` says which
 * licence it administers — so `GET /api/admin/hq-support` sorts each open
 * ticket by its requester's standing and the page renders what it measured.
 *
 * EVERY PART ANSWERS FOR ITSELF. The route makes five reads and each carries its
 * own state: an unreadable escalation board costs the escalation card and the
 * matrix's escalation cells, never the ticket queues beside it. A read that
 * failed renders `Unreadable`; a read that hit its ceiling renders its count as
 * not counted, never as the length of a cut list (D131).
 *
 * THE QUEUES FOOT TO HQ HOME. The two ticket queues and the three places an
 * open ticket can land outside them sum to Home's Queue backlog, and the footing
 * line says so under the cards — two figures that each defined "open" for
 * themselves is how a tile and a desk come to disagree.
 *
 * NO TICKET HAS AN SLA. Escalations carry a due date and render in three bands;
 * tickets carry none, so their ages render without a band rather than borrowing
 * one nobody set.
 *
 * Super Admin stays on axal.vc. This page configures nothing.
 */
import React, { useCallback, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';

const UNAVAILABLE = Symbol('unavailable');

/** How the page names each queue — H22's own three names. */
export const QUEUE_TITLES = {
  escalations: 'Escalations from subsidiaries',
  hq_held: 'HQ-held users',
  admin_product: 'Admins about the Admin product',
};

/** The three places an open ticket lands outside H22's two queues. */
export const OUTSIDE_BUCKETS = [
  ['hq_staff', 'from HQ staff'],
  ['account_closed', 'from closed accounts'],
  ['not_on_record', 'with no account on record'],
];

/** Hours to the canvas's own unit. The server sends hours; the page never parses a stamp. */
export function fmtAge(hours) {
  if (hours === null || hours === undefined || !Number.isFinite(Number(hours))) return null;
  const h = Number(hours);
  return h < 1 ? '<1h' : `${Math.floor(h)}h`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** What the oldest open item is, in the band's words. */
function oldestLabel(data) {
  const o = data?.total?.oldest;
  if (!o) return null;
  if (o.queue === 'escalations') {
    const code = data.escalations?.items?.[0]?.branch_code;
    return code ? `escalation from ${code}` : 'escalation';
  }
  return o.queue === 'hq_held' ? 'HQ-held user' : 'admin about the Admin product';
}

/**
 * The band's right-hand sentence. Four states, and none of them is a total the
 * server did not send: loading, a failed read, a total withheld with its reason,
 * and a measured count — where a measured zero says "Nothing is waiting".
 */
export function supportBandText(data, failed) {
  if (failed) return 'unreadable';
  if (!data) return '…';
  const t = data.total;
  if (!t || t.value === null || t.value === undefined) return 'total not recorded';
  if (t.value === 0) return 'Nothing is waiting';
  const age = fmtAge(t.oldest?.age_hours);
  const what = oldestLabel(data);
  return `${t.value} open${age ? ` · oldest ${age}${what ? ` · ${what}` : ''}` : ''}`;
}

const PILL = {
  past: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  due_soon: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  ok: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  none: 'bg-axal-ground text-axal-muted dark:bg-white/5 dark:text-gray-300',
};

const SLA_WORD = { past: 'past SLA', due_soon: 'due within 24h', ok: 'on time' };

/**
 * One queue. Pure over its props so every state renders in a test.
 *
 * `state` is 'loading' | 'unreadable' | 'ready'. `count` null on a ready queue
 * means the read hit its ceiling: the items are still the oldest, exactly, but
 * how many there are is not known, and the card says that rather than a number.
 */
export function QueueCard({
  queue, who, state, reason, count, items = [], bands = null, onRetry, testId,
}) {
  const title = QUEUE_TITLES[queue];
  return (
    <Card>
      <div data-testid={testId}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-extrabold tracking-tight text-axal-ink dark:text-white">{title}</span>
          <span className="text-[13px] font-extrabold tabular-nums text-axal-ink dark:text-white">
            {state === 'ready'
              ? (count === null || count === undefined
                ? <Unrecorded reason="More open items than one read counts, so no total is shown.">Not counted</Unrecorded>
                : count)
              : state === 'unreadable' ? <Unrecorded>Unreadable</Unrecorded> : '…'}
          </span>
        </div>
        <p className="mt-1 text-[10.5px] leading-relaxed text-axal-faint">{who}</p>

        {state === 'loading' && <p className="mt-3 text-[12px] text-axal-muted">Reading the queue…</p>}
        {state === 'unreadable' && (
          <div className="mt-3"><Unreadable what={title} claim={reason} onRetry={onRetry} /></div>
        )}

        {state === 'ready' && bands && (
          <p className="mt-2 text-[10.5px] tabular-nums text-axal-muted" data-testid={`${testId}-bands`}>
            {bands.ok} on time · {bands.due_soon} due within 24h · {bands.past} past SLA
          </p>
        )}

        {state === 'ready' && count === 0 && (
          <p className="mt-3 text-[12px] text-axal-muted" data-testid={`${testId}-empty`}>Nothing is waiting.</p>
        )}

        {state === 'ready' && items.length > 0 && (
          <ul className="mt-3 grid gap-1.5">
            {items.map((it) => {
              const age = fmtAge(it.age_hours);
              const body = (
                <>
                  <span className="min-w-0 text-[11.5px] font-semibold text-axal-ink dark:text-gray-100">
                    {it.title}
                    {it.meta && <span className="block text-[10px] font-normal text-axal-faint">{it.meta}</span>}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold tabular-nums ${PILL[it.band || 'none']}`}
                    title={it.band ? SLA_WORD[it.band] : 'Tickets carry no due date, so their age has no band.'}
                  >
                    {age || <Unrecorded>undated</Unrecorded>}
                  </span>
                </>
              );
              const row = 'flex items-center justify-between gap-2 rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5';
              return (
                <li key={it.key}>
                  {it.to
                    ? <Link to={it.to} className={`${row} hover:border-[#881337]/40`}>{body}</Link>
                    : <div className={row}>{body}</div>}
                </li>
              );
            })}
          </ul>
        )}

        {state === 'ready' && items.length > 0 && (count === null || count === undefined || count > items.length) && (
          <p className="mt-2 text-[10.5px] text-axal-faint" data-testid={`${testId}-cut`}>
            {count === null || count === undefined
              ? `The ${items.length} oldest are listed; the rest are more than one read counts.`
              : `The ${items.length} oldest of ${count} are listed.`}
          </p>
        )}
      </div>
    </Card>
  );
}

/** The escalation queue's props, from the payload. */
export function escalationCardProps(data, failed) {
  const base = {
    queue: 'escalations',
    who: 'What a branch pushes up to HQ: moderation, content for brand approval, a seat increase, or other.',
    testId: 'hq-support-queue-escalations',
  };
  if (failed) return { ...base, state: 'unreadable', reason: 'The Support read failed, so this queue is unknown — not empty.' };
  if (!data) return { ...base, state: 'loading' };
  const e = data.escalations;
  if (!e?.available) return { ...base, state: 'unreadable', reason: e?.reason };
  return {
    ...base,
    state: 'ready',
    count: e.count,
    bands: e.bands,
    items: (e.items || []).map((x) => ({
      key: x.uid,
      title: `${x.branch_code} · ${x.subject || String(x.kind || '').replace(/_/g, ' ')}`,
      meta: `${String(x.kind || '').replace(/_/g, ' ')}${x.raised_by_name ? ` · raised by ${x.raised_by_name}` : ''}`,
      age_hours: x.age_hours,
      band: x.sla,
    })),
  };
}

/** One ticket queue's props, from the payload. */
export function ticketCardProps(data, failed, persona) {
  const base = {
    queue: persona,
    who: persona === 'hq_held'
      ? 'Accounts HQ holds directly, in no branch.'
      : 'A licence’s administrators, filing about the Admin product itself.',
    testId: `hq-support-queue-${persona.replace('_', '-')}`,
  };
  if (failed) return { ...base, state: 'unreadable', reason: 'The Support read failed, so this queue is unknown — not empty.' };
  if (!data) return { ...base, state: 'loading' };
  const t = data.tickets;
  if (!t?.available) return { ...base, state: 'unreadable', reason: t?.reason };
  const b = t.buckets?.[persona];
  return {
    ...base,
    state: 'ready',
    count: b ? b.count : null,
    items: (b?.items || []).map((x) => ({
      key: x.id,
      title: x.title || `Ticket #${x.id}`,
      meta: [x.requester, x.licence ? (x.licence.licence_ref || x.licence.brand_name) : null, x.status?.replace('_', ' ')]
        .filter(Boolean).join(' · '),
      age_hours: x.age_hours,
      to: `/help/tickets/${x.id}`,
    })),
  };
}

/**
 * The proof that the two ticket queues and the tickets outside them are one
 * backlog — the same `open` HQ Home's Queue backlog tile reads.
 */
export function FootingLine({ tickets }) {
  if (!tickets?.available) return null;
  if (!tickets.complete || tickets.open === null) {
    return (
      <p className="mt-3 text-[11px] leading-relaxed text-axal-muted" data-testid="hq-support-footing">
        More open tickets than one read counts, so the queues are not totalled here. The Queue backlog on{' '}
        <Link to="/hq" className="underline">HQ Home</Link> counts every one.
      </p>
    );
  }
  const b = tickets.buckets;
  const outside = OUTSIDE_BUCKETS.map(([k, words]) => `${b[k]?.count ?? 0} ${words}`);
  const hidden = OUTSIDE_BUCKETS.filter(([k]) => (b[k]?.items || []).length > 0);
  return (
    <div className="mt-3" data-testid="hq-support-footing">
      <p className="text-[11px] leading-relaxed text-axal-muted tabular-nums">
        {b.hq_held?.count ?? 0} HQ-held + {b.admin_product?.count ?? 0} about the Admin product + {outside.join(' + ')}
        {' '}= {plural(tickets.open, 'open ticket', 'open tickets')} — the Queue backlog on{' '}
        <Link to="/hq" className="underline">HQ Home</Link>.
      </p>
      {hidden.length > 0 && (
        <details className="mt-2 text-[11px] text-axal-muted" data-testid="hq-support-outside">
          <summary className="cursor-pointer font-semibold">Tickets outside the two queues</summary>
          <ul className="mt-2 grid gap-1">
            {hidden.flatMap(([k, words]) => (b[k].items || []).map((x) => (
              <li key={`${k}-${x.id}`}>
                <Link to={`/help/tickets/${x.id}`} className="underline">{x.title || `Ticket #${x.id}`}</Link>
                {' '}— {words}{x.requester ? ` · ${x.requester}` : ''}{fmtAge(x.age_hours) ? ` · ${fmtAge(x.age_hours)}` : ''}
              </li>
            )))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** What a blank cell means. The reason travels with it; a bare dash never does. */
export const WHY_WORD = {
  does_not_apply: 'Does not apply',
  branch_database: 'On the branch',
  unreadable: 'Unreadable',
  incomplete: 'Not counted',
};

const CELLS = [['escalations', 'Escalations'], ['hq_held', 'HQ-held'], ['about_admin', 'About Admin']];

/**
 * Tenant × queue. Every cell is a measured count with the age of its oldest
 * item, or a word saying why there is none and a numbered reason under the
 * table — the reasons are shown, not only hovered, because a reason nobody can
 * read on a phone is not a reason.
 */
export function TenantMatrix({ matrix, failed, onRetry }) {
  let body;
  const notes = [];
  if (failed) {
    body = <Unreadable what="The tenant × queue matrix" claim="Which tenant each open item belongs to is unknown." onRetry={onRetry} />;
  } else if (!matrix) {
    body = <p className="text-[12px] text-axal-muted">Reading the licence ledger…</p>;
  } else if (!matrix.available) {
    body = <Unreadable what="The licence ledger" claim={matrix.reason} onRetry={onRetry} />;
  } else {
    const noteIndex = (reason) => {
      let i = notes.indexOf(reason);
      if (i < 0) { notes.push(reason); i = notes.length - 1; }
      return i + 1;
    };
    body = (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[440px] text-left text-[11.5px]" data-testid="hq-support-matrix">
          <thead>
            <tr className="text-[9.5px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
              <th className="py-1.5 pr-3 font-extrabold">Branch</th>
              {CELLS.map(([, label]) => <th key={label} className="py-1.5 pr-3 font-extrabold">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((r) => (
              <tr key={r.key} className="border-t border-axal-hairline" data-kind={r.kind}>
                <td className="py-1.5 pr-3">
                  <span className="font-semibold text-axal-ink dark:text-gray-100">{r.label}</span>
                  {r.kind === 'licence' && (
                    <span className="block text-[10px] text-axal-faint">
                      {[r.licence_ref, r.status ? r.status.replace(/_/g, ' ') : null, r.branch_code].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </td>
                {CELLS.map(([k]) => {
                  const cell = r[k];
                  if (cell && cell.value !== null && cell.value !== undefined) {
                    const age = fmtAge(cell.oldest_age_hours);
                    return (
                      <td key={k} className="py-1.5 pr-3 tabular-nums text-axal-ink dark:text-gray-100">
                        {cell.value}{age && <span className="text-axal-faint"> · {age}</span>}
                      </td>
                    );
                  }
                  const n = noteIndex(cell?.reason || 'No reason was sent for this cell.');
                  return (
                    <td key={k} className="py-1.5 pr-3">
                      <Unrecorded reason={cell?.reason}>{WHY_WORD[cell?.why] || 'Not recorded'}</Unrecorded>
                      <sup className="ml-0.5 text-[9px] text-axal-faint">{n}</sup>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13.5px] font-extrabold tracking-tight">Tenant × queue</h2>
        <span className="text-[10.5px] text-axal-faint">Open items · oldest in hours</span>
      </div>
      <div className="mt-2">{body}</div>
      {notes.length > 0 && (
        <ol className="mt-3 grid gap-1 text-[10.5px] leading-relaxed text-axal-muted" data-testid="hq-support-matrix-notes">
          {notes.map((n, i) => <li key={n}><sup>{i + 1}</sup> {n}</li>)}
        </ol>
      )}
      {matrix?.available && matrix.omitted_terminated > 0 && (
        <p className="mt-2 text-[10.5px] text-axal-faint" data-testid="hq-support-matrix-omitted">
          {plural(matrix.omitted_terminated, 'terminated licence has', 'terminated licences have')} nothing open and{' '}
          {matrix.omitted_terminated === 1 ? 'is' : 'are'} not listed.
        </p>
      )}
    </Card>
  );
}

/**
 * The mirror strip. Two measured counts over the last day and an average lag
 * that is not recorded, with the server's reason. The canvas links this strip
 * to H16's P2 console; that console is not built, so the link goes to the
 * mirror's settings, which are.
 */
export function SyncStrip({ sync, failed, onRetry }) {
  let body;
  if (failed) {
    body = <Unreadable what="The mirror status" claim="Whether tickets reached GitHub is unknown." onRetry={onRetry} />;
  } else if (!sync) {
    body = <p className="text-[12px] text-axal-muted">Reading the mirror…</p>;
  } else if (!sync.available) {
    body = <Unreadable what="The mirror status" claim={sync.reason} onRetry={onRetry} />;
  } else {
    const stat = (k, v, tone = 'text-axal-ink dark:text-white') => (
      <div className="rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-2">
        <div className="text-[8.5px] font-extrabold uppercase tracking-[.08em] text-axal-faint">{k}</div>
        <div className={`mt-1 text-[15px] font-extrabold tabular-nums ${tone}`}>{v}</div>
      </div>
    );
    body = (
      <>
        <div className="grid grid-cols-3 gap-2" data-testid="hq-support-sync-stats">
          {stat(`Synced · ${sync.window_hours}h`, sync.synced)}
          {stat(`Failed · ${sync.window_hours}h`, sync.failed, sync.failed > 0 ? 'text-red-700 dark:text-red-300' : undefined)}
          {stat('Average lag', <Unrecorded reason={sync.lag?.reason} />)}
        </div>
        {sync.not_configured > 0 && (
          <p className="mt-2 text-[10.5px] text-amber-800 dark:text-amber-300">
            {plural(sync.not_configured, 'attempt', 'attempts')} found no GitHub token configured.
          </p>
        )}
        <p className="mt-2 text-[10.5px] leading-relaxed text-axal-muted">
          Counted from each ticket&apos;s latest mirror attempt, so a ticket retried within the window counts once, as
          its latest outcome. {sync.lag?.reason}
        </p>
      </>
    );
  }
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13.5px] font-extrabold tracking-tight">GitHub sync</h2>
        <Link to="/admin?tab=github" className="text-[11px] font-semibold text-[#881337] underline dark:text-rose-300">
          Mirror settings →
        </Link>
      </div>
      <div className="mt-2">{body}</div>
      <p className="mt-2 text-[10px] text-axal-faint">H16&apos;s P2 console is not built; the settings are on the Admin Console.</p>
    </Card>
  );
}

/** One coverage line per read that answered (D126) — never a line for a read that failed. */
export function supportCoverage(data) {
  if (!data) return [];
  const out = [];
  const e = data.escalations;
  if (e?.available) {
    out.push(e.count === null ? 'Open escalations: more than one read counts' : `${plural(e.count, 'open escalation', 'open escalations')} from hq_escalations`);
  }
  const t = data.tickets;
  if (t?.available) {
    out.push(t.open === null ? 'Open tickets: more than one read counts' : `${plural(t.open, 'open ticket', 'open tickets')}, each sorted by its requester's standing`);
  }
  if (data.matrix?.available) {
    const n = data.matrix.rows.filter((r) => r.kind === 'licence').length;
    out.push(`${plural(n, 'licence', 'licences')} in the tenant × queue matrix`);
  }
  if (data.sync?.available) {
    out.push(`Mirror, last ${data.sync.window_hours}h: ${data.sync.synced} synced, ${data.sync.failed} failed`);
  }
  return out;
}

/** What this page cannot say, each with its reason. [title, detail] pairs. */
export const SUPPORT_UNAVAILABLE = [
  ['Tickets filed on a branch host', 'Once a licence has a branch, its administrators file on that branch’s host, into its own database, and no branch call returns tickets. The matrix marks those cells “On the branch”.'],
  ['A ticket’s queue as filed', 'A ticket is sorted by its requester’s standing now. Nothing stamps it when it is filed, so an administrator demoted since has moved queue.'],
  ['A ticket SLA', 'Tickets carry no due date, so their ages show without a band. Only escalations have one.'],
  ['Answering an escalation', 'No screen records HQ’s answer yet: the route exists and nothing calls it.'],
  ['Support under the overlay', 'Out of scope. Viewing as a branch scopes Home and Team; this page reads HQ’s escalation board and HQ’s own tickets, not one branch’s database.'],
];

export default function HqSupportPage() {
  const [data, setData] = useState(null); // null = loading, UNAVAILABLE = failed
  const load = useCallback(() => {
    setData(null);
    api.hqSupport().then(setData, (e) => {
      reportError('hq-support', e);
      setData(UNAVAILABLE);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const failed = data === UNAVAILABLE;
  const ready = data && !failed ? data : null;
  const coverage = supportCoverage(ready);
  const readAt = ready?.read_at ? String(ready.read_at).slice(11, 16) : null;

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-support-page">
      <div className="min-w-0">
        {/* H22's bar. No switcher caret: there is no switcher here, and a caret
            that opens nothing is a control that lies. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#881337] px-4 py-2.5 text-white">
          <span className="text-[12.5px] font-bold">All subsidiaries</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] opacity-80 tabular-nums">
            <span data-testid="hq-support-band">{supportBandText(ready, failed)}</span>
            {readAt && <span>read {readAt} UTC</span>}
          </span>
        </div>
        {ready && ready.total?.value === null && (
          <p className="mt-2 text-[11px] text-axal-muted" data-testid="hq-support-band-reason">
            <Unrecorded /> — {ready.total.reason}
          </p>
        )}
        {failed && (
          <div className="mt-3">
            <Unreadable what="Support" claim="This is not a claim that nothing is waiting." onRetry={load} />
          </div>
        )}

        <header className="mt-4">
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <Inbox size={13} /> HQ · Support
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Support</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            Three queues: what branches push up, the accounts HQ holds directly, and subsidiary administrators
            filing about the Admin product. A ticket&apos;s queue is read from its requester&apos;s account as it
            stands now, so the two ticket queues and the tickets outside them add up to HQ Home&apos;s Queue backlog.
          </p>
        </header>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <QueueCard {...escalationCardProps(ready, failed)} onRetry={load} />
          <QueueCard {...ticketCardProps(ready, failed, 'hq_held')} onRetry={load} />
          <QueueCard {...ticketCardProps(ready, failed, 'admin_product')} onRetry={load} />
        </div>
        <FootingLine tickets={ready?.tickets} />

        <div className="mt-4 grid gap-3 lg:grid-cols-[1.3fr_1fr]">
          <TenantMatrix matrix={ready?.matrix} failed={failed} onRetry={load} />
          <SyncStrip sync={ready?.sync} failed={failed} onRetry={load} />
        </div>
      </div>
      <WorkerRail
        workspace="Support"
        role="super_admin"
        stance="Read-only summary"
        note="Escalations, both ticket queues, the tenant × queue matrix and the mirror strip are read from HQ's own stores in one request. It takes no action."
        coverage={coverage}
        coverageNote={coverage.length ? undefined : (failed ? 'The Support read could not be completed.' : 'Loading…')}
        unavailable={SUPPORT_UNAVAILABLE}
        data-testid="hq-support-rail"
      />
    </div>
  );
}

/**
 * D5034 (#5034) — HQ › Support v2's four workspaces, header and states, pure
 * over their props (`HqSupportPage.jsx` holds the reads and the writes).
 *
 *   SupportHeader     the task first: HQ · Support, Support, one line, then the
 *                     scope ("Platform-wide support · HQ + all available
 *                     subsidiaries"), the sources, the read time and Refresh.
 *                     No selector-like bar: there is no subsidiary filter.
 *   WorkspaceNav      a `nav` of links with `aria-current="page"`; `?tab=`
 *                     pushes history, so Back and Forward move between them.
 *   QueueWorkspace    All clear, or Action required, HQ escalations in SLA
 *                     bands, HQ-hosted tickets oldest risk first, and the
 *                     subsidiaries folded to one line.
 *   BranchesWorkspace support by subsidiary, the queues-by-subsidiary matrix
 *                     when it compares anything, and each branch's tickets.
 *   DeliveryWorkspace this session's decisions and their delivery, and the
 *                     GitHub mirror, one line while healthy.
 *   PolicyWorkspace   whether the ticket SLA is on every subsidiary, then the
 *                     policy panel (ticket SLA, escalation deadlines, taxonomy).
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Loader2, RefreshCw } from 'lucide-react';
import { Unrecorded, Unreadable } from '../../../ui';
import { StateShape } from '../security/StatusBadge.jsx';
import {
  SUPPORT_WORKSPACES, workspaceHref, figureText, hoursText, queueKindChoices,
  matrixCompares, mirrorLine, deliveryRows, nextUidAfter,
} from './supportWorkspaceModel.js';

// ───────────────────────────────────────────────────────────── badge ──

// Word + shape, colour only as a hint (canvas S: "SLA pills carry text and icon").
const BADGE = {
  past: ['cross', 'border-red-700 bg-red-700 text-white dark:border-red-600 dark:bg-red-600'],
  due_soon: ['triangle', 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'],
  ok: ['check', 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'],
  delivered: ['check', 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'],
  failed: ['cross', 'border-red-700 bg-red-700 text-white dark:border-red-600 dark:bg-red-600'],
  unavailable: ['struck-square', 'border-axal-hairline bg-transparent text-axal-muted dark:border-gray-700 dark:text-gray-300'],
  not_counted: ['question', 'border-dashed border-amber-300 bg-transparent text-amber-900 dark:border-amber-800 dark:text-amber-200'],
  measured_zero: ['zero', 'border-axal-hairline bg-transparent text-axal-muted dark:border-gray-700 dark:text-gray-300'],
  pending: ['clock', 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200'],
  undated: ['dotted-ring', 'border-axal-hairline bg-transparent text-axal-muted dark:border-gray-700 dark:text-gray-300'],
};

export function SupportBadge({ tone, children, 'data-testid': testId }) {
  const [shape, cls] = BADGE[tone] || BADGE.unavailable;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[12px] font-bold leading-tight ${cls}`}
      data-state={tone}
      data-testid={testId}
    >
      <StateShape shape={shape} />
      <span>{children}</span>
    </span>
  );
}

const H2 = 'text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-white';
const META = 'text-[12px] leading-relaxed text-axal-muted dark:text-gray-400';
const SECTION = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-md border border-axal-hairline bg-white px-3 text-[13px] font-semibold text-axal-ink hover:bg-axal-ground focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

// ──────────────────────────────────────────────────────────── header ──

/**
 * The task first, then the scope. `refreshing` keeps the last read on screen
 * and says which one it is showing (canvas SU11 "Quiet refresh"). `actions`
 * is the page's own: the Review queue link and Ask, written where the route
 * walk reads literal links.
 */
export function SupportHeader({ readAt, refreshing = false, onRefresh, sources, actions = null }) {
  return (
    <header data-testid="hq-support-header">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <Inbox size={13} aria-hidden="true" /> HQ · Support
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Support</h1>
          <p className="mt-1 text-[14px] text-axal-muted dark:text-gray-400">Manage support workload across Axal VC.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="hq-support-scope">
        <span className="font-semibold text-axal-ink dark:text-gray-100">Platform-wide support</span>
        <span>HQ + all available subsidiaries</span>
        <span aria-hidden="true">·</span>
        <span data-testid="hq-support-sources">{sources}</span>
        <span aria-hidden="true">·</span>
        <span aria-live="polite" data-testid="hq-support-updated">
          {refreshing
            ? `Refreshing…${readAt ? ` showing the ${readAt} UTC read` : ''}`
            : (readAt ? `Updated ${readAt} UTC` : 'Not read yet')}
        </span>
        {onRefresh && (
          <button type="button" onClick={onRefresh} disabled={refreshing} className={`${BTN} ml-1 min-h-[32px] px-2.5`} data-testid="hq-support-refresh">
            <RefreshCw size={12} aria-hidden="true" className={refreshing ? 'animate-spin' : undefined} /> Refresh
          </button>
        )}
      </p>
    </header>
  );
}

/** The four workspaces as routes, never ARIA tabs (canvas HQS13). */
export function WorkspaceNav({ current, marks = {} }) {
  return (
    <nav aria-label="Support workspaces" className="mt-4 border-b border-axal-hairline dark:border-gray-800" data-testid="hq-support-workspaces">
      <ul className="flex">
        {SUPPORT_WORKSPACES.map((w) => {
          const on = w.key === current;
          const mark = marks[w.key];
          return (
            <li key={w.key} className="min-w-0 flex-1 sm:flex-none">
              <Link
                to={workspaceHref(w.key)}
                aria-current={on ? 'page' : undefined}
                className={`-mb-px flex min-h-[44px] items-center justify-center gap-1.5 border-b-2 px-2 text-[13.5px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:justify-start sm:px-3 ${
                  on
                    ? 'border-violet-600 text-axal-ink dark:border-violet-400 dark:text-white'
                    : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'
                }`}
                data-testid={`hq-support-tab-${w.key}`}
              >
                {w.label}
                {mark && (
                  <span
                    className={`hidden rounded px-1 text-[11.5px] font-bold sm:inline ${mark.tone === 'negative' ? 'bg-red-700 text-white dark:bg-red-600' : 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'}`}
                    data-testid={`hq-support-tab-mark-${w.key}`}
                  >
                    {mark.text}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ───────────────────────────────────────────────────────────── queue ──

/** The four figures. A floor is "18+" with its reasons below, in words. */
export function ActionRequired({ overview }) {
  const cell = (label, f, testId) => (
    <div className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900/40">
      <dt className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">{label}</dt>
      <dd className="mt-1 text-[22px] font-extrabold tabular-nums text-axal-ink dark:text-white" data-testid={testId}>{f}</dd>
    </div>
  );
  const o = overview;
  const oldest = o.oldest === null
    ? <Unrecorded reason="No age could be read for what is open.">Not counted</Unrecorded>
    : (o.oldest.value === null ? 'None' : hoursText(o.oldest.value));
  return (
    <section aria-labelledby="hq-support-action-title" className={SECTION} data-testid="hq-support-action-required">
      <h2 id="hq-support-action-title" className={H2}>Action required</h2>
      <dl className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {cell('Past SLA', figureText(o.pastSla), 'hq-support-ar-past')}
        {cell('Due soon', figureText(o.dueSoon), 'hq-support-ar-due')}
        {cell('Open · escalations + HQ tickets', figureText(o.open), 'hq-support-ar-open')}
        {cell('Oldest', oldest, 'hq-support-ar-oldest')}
      </dl>
      {o.reasons?.length > 0 && (
        <ul className="mt-2 grid gap-0.5" data-testid="hq-support-ar-reasons">
          {o.reasons.map((r) => (
            <li key={r} className={META}><SupportBadge tone="not_counted">Not counted</SupportBadge> {r}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The healthy queue (canvas SU01a, the production state): one block, its read
 * time, the two HQ sources at zero and the subsidiaries' one line. `hq_clear`
 * says HQ's own queues are empty without claiming the subsidiaries are.
 */
export function AllClear({ overview, readAt }) {
  const whole = overview.state === 'clear';
  const subs = overview.subsidiaries;
  return (
    <section aria-labelledby="hq-support-clear-title" className={SECTION} data-testid="hq-support-all-clear" data-state={overview.state}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">✓</span>
        <div className="min-w-0">
          <h2 id="hq-support-clear-title" className={H2}>{whole ? 'All clear' : 'Nothing waiting at HQ'}</h2>
          <p className="mt-0.5 text-[14px] text-axal-ink dark:text-gray-100">
            {whole
              ? 'No support items currently require HQ attention.'
              : 'HQ’s escalations and HQ-hosted tickets are empty. The subsidiaries are not all measured — see below.'}
          </p>
          <p className={`mt-1 ${META}`}>
            {readAt ? `Measured at ${readAt} UTC` : 'Measured'}
            {whole ? ' · every source answered' : ''}
          </p>
        </div>
      </div>
      <dl className="mt-4 grid gap-2 sm:grid-cols-3">
        {[
          ['Escalations', '0 open', 'escalations'],
          ['HQ tickets', '0 open', 'tickets'],
        ].map(([k, v, id]) => (
          <div key={id} className="rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-700" data-testid={`hq-support-clear-${id}`}>
            <dt className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">{k}</dt>
            <dd className="mt-0.5 text-[14px] font-bold text-axal-ink dark:text-white">{v}</dd>
          </div>
        ))}
        <div className="rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-700" data-testid="hq-support-clear-subsidiaries" data-state={subs.state}>
          <dt className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">Subsidiaries</dt>
          <dd className="mt-0.5 text-[13px] font-semibold text-axal-ink dark:text-gray-100">
            {subs.state === 'none' || subs.state === 'zero' ? subs.text : (
              <Link to={workspaceHref('branches')} className="underline">{subs.text}</Link>
            )}
          </dd>
        </div>
      </dl>
      <p className={`mt-3 ${META}`}>Branches, Delivery and Policy are one click away above. Nothing else is shown while nothing is waiting.</p>
    </section>
  );
}

/** The Queue's kind filter: active kinds visible, the rest behind More filters. */
export function QueueKindFilter({ choices, value, onChange }) {
  if (!choices.length) return null;
  const { all, active, more } = queueKindChoices(choices, value);
  const pill = (f) => (
    <button
      key={f.kind || 'all'}
      type="button"
      onClick={() => onChange(f.kind)}
      aria-pressed={value === f.kind}
      data-kind={f.kind || 'all'}
      className={`inline-flex min-h-[32px] items-center gap-1 rounded-full border px-3 text-[12.5px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${value === f.kind
        ? 'border-slate-400 bg-slate-100 text-slate-800 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100'
        : 'border-axal-hairline bg-white text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:text-gray-100'}`}
    >
      {f.label}{' '}
      {f.count === null
        ? <span className="italic">not counted</span>
        : <span className="tabular-nums">{f.count}</span>}
    </button>
  );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter escalations by kind" data-testid="hq-support-queue-kinds">
      {all && pill(all)}
      {active.map(pill)}
      {more.length > 0 && (
        <details className="relative" data-testid="hq-support-more-kinds">
          <summary className="inline-flex min-h-[32px] cursor-pointer list-none items-center rounded-full border border-dashed border-axal-hairline px-3 text-[12.5px] font-semibold text-axal-muted dark:border-gray-700 dark:text-gray-300">
            More filters ▾
          </summary>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{more.map(pill)}</div>
        </details>
      )}
      <p className={`basis-full ${META}`}>Kind counts are the board’s own totals, not the rows shown.</p>
    </div>
  );
}

/**
 * One escalation, an action row: who and what, the request's first line, who
 * raised it, the SLA in words, the deadline, and Review. Review opens the
 * decision sheet over the queue (D5034 part 2), which keeps its place; its
 * name says which escalation it opens, and focus comes back to it on close.
 */
function EscalationRow({ row, decide, nextUid }) {
  const open = Boolean(decide) && decide.openUid === row.uid;
  return (
    <li className="border-t border-axal-hairline py-3 first:border-t-0 dark:border-gray-800" data-testid="hq-support-escalation-row" data-band={row.sla.band}>
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-axal-ink dark:text-gray-100">
            {row.title}
            {row.showKind && <span className="font-semibold text-axal-muted dark:text-gray-400"> · {row.kind}</span>}
          </p>
          <p className="mt-0.5 text-[13px] text-axal-ink dark:text-gray-200">
            {row.preview || <Unrecorded reason="The branch raised it with a subject and no detail.">No detail recorded</Unrecorded>}
          </p>
          <p className={`mt-0.5 ${META}`}>
            Raised by {row.raisedBy || <Unrecorded reason="The branch did not record who raised it.">Not recorded</Unrecorded>}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 md:flex-row md:items-center md:gap-3">
          <div className="flex flex-col items-start gap-0.5 md:items-end">
            <SupportBadge tone={row.sla.band}>{row.sla.text}</SupportBadge>
            {row.deadline && <span className={META}>{row.deadline}</span>}
          </div>
          {decide && (
            <button
              type="button"
              ref={decide.refFor ? decide.refFor(row.uid) : undefined}
              onClick={(e) => decide.onOpen(row.item, e.currentTarget, nextUid)}
              aria-haspopup="dialog"
              aria-label={`Review ${row.title}`}
              className={`${BTN} w-full md:w-auto ${open ? 'ring-2 ring-violet-500' : ''}`}
              data-testid="hq-support-review"
            >
              Review
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * HQ escalations, the dominant list: the only queue HQ decides here. Banded
 * Past SLA, Due soon, Open; a cut list says it is cut.
 */
export function EscalationQueue({ escalations, groups, count, kindFilter, decide, onRetry }) {
  let body;
  if (!escalations) {
    body = <p className={`mt-3 ${META}`} role="status">Reading the escalations…</p>;
  } else if (!escalations.available) {
    body = <div className="mt-3"><Unreadable what="HQ escalations" claim={escalations.reason || 'What branches have raised is unknown — not none.'} onRetry={onRetry} /></div>;
  } else if (!groups.length) {
    body = <p className={`mt-3 ${META}`} data-testid="hq-support-escalations-empty"><SupportBadge tone="measured_zero">Nothing is waiting</SupportBadge> No open escalation{kindFilter ? ' of this kind' : ''}.</p>;
  } else {
    const listed = groups.reduce((s, g) => s + g.rows.length, 0);
    body = (
      <>
        {groups.map((g) => (
          <div key={g.band} className="mt-4" data-testid={`hq-support-band-${g.band}`}>
            <h3 className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">{g.title} · {g.rows.length}</h3>
            <ul className="mt-1">{g.rows.map((r) => <EscalationRow key={r.uid} row={r} decide={decide} nextUid={nextUidAfter(groups, r.uid)} />)}</ul>
          </div>
        ))}
        {(count === null || count === undefined || count > listed) && (
          <p className={`mt-2 ${META}`} data-testid="hq-support-escalations-cut">
            {count === null || count === undefined
              ? `The ${listed} oldest are listed; the rest are more than one read counts.`
              : `The ${listed} oldest of ${count} are listed.`}
          </p>
        )}
      </>
    );
  }
  return (
    <section aria-labelledby="hq-support-esc-title" className={SECTION} data-testid="hq-support-escalations">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="hq-support-esc-title" className={H2}>HQ escalations</h2>
        {escalations?.available && (
          <span className="text-[13px] font-bold tabular-nums text-axal-ink dark:text-white" data-testid="hq-support-escalations-count">
            {count === null || count === undefined ? <Unrecorded reason="More open escalations than one read counts.">Not counted</Unrecorded> : `${count} open`}
          </span>
        )}
      </div>
      {kindFilter}
      {body}
    </section>
  );
}

/**
 * HQ-hosted tickets: customer tickets on HQ and subsidiary admin tickets, one
 * table oldest risk first (a stacked list on a phone). The bucket arithmetic
 * that foots it to HQ Home is behind "How this total is calculated".
 */
export function HqTicketsSection({ tickets, rows, count, footing, onRetry, limit = 10 }) {
  let body;
  if (!tickets) {
    body = <p className={`mt-3 ${META}`} role="status">Reading HQ tickets…</p>;
  } else if (!tickets.available) {
    body = <div className="mt-3"><Unreadable what="HQ tickets" claim={tickets.reason || 'Escalations above are unaffected.'} onRetry={onRetry} /></div>;
  } else if (!rows.length) {
    body = <p className={`mt-3 ${META}`} data-testid="hq-support-tickets-empty"><SupportBadge tone="measured_zero">Nothing is waiting</SupportBadge> No open HQ-hosted ticket.</p>;
  } else {
    const shown = rows.slice(0, limit);
    const sla = (r) => (r.sla
      ? <SupportBadge tone={r.sla.band}>{r.sla.text}{r.sla.detail ? ` · ${r.sla.detail}` : ''}</SupportBadge>
      : <SupportBadge tone="undated">Not banded</SupportBadge>);
    body = (
      <>
        <table className="mt-3 hidden w-full text-left text-[13px] md:table" data-testid="hq-support-tickets-table">
          <caption className="sr-only">HQ-hosted tickets, oldest risk first</caption>
          <thead>
            <tr className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">
              {['Ticket', 'Requester', 'Context', 'Priority', 'Age', 'SLA'].map((h) => <th key={h} scope="col" className="py-1.5 pr-3">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className="border-t border-axal-hairline align-top dark:border-gray-800" data-testid="hq-support-ticket-row" data-band={r.band || 'none'}>
                <th scope="row" className="py-2 pr-3 font-semibold"><Link to={r.to} className="text-axal-ink underline-offset-2 hover:underline dark:text-gray-100">{r.title}</Link></th>
                <td className="py-2 pr-3">{r.requester || <Unrecorded>Not recorded</Unrecorded>}</td>
                <td className="py-2 pr-3">{r.context}{r.licence ? <span className="block text-[12px] text-axal-faint">{r.licence}</span> : null}</td>
                <td className="py-2 pr-3">{r.priority || <Unrecorded>Not recorded</Unrecorded>}</td>
                <td className="py-2 pr-3 tabular-nums">{r.age || <Unrecorded>Undated</Unrecorded>}</td>
                <td className="py-2 pr-3">{sla(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-3 grid gap-2 md:hidden" data-testid="hq-support-tickets-list">
          {shown.map((r) => (
            <li key={r.key} className="rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-700">
              <Link to={r.to} className="text-[14px] font-semibold text-axal-ink underline-offset-2 hover:underline dark:text-gray-100">{r.title}</Link>
              <p className={META}>{[r.requester, r.context, r.priority].filter(Boolean).join(' · ')}</p>
              <div className="mt-1">{sla(r)}</div>
            </li>
          ))}
        </ul>
        {rows.length > shown.length && (
          <p className={`mt-2 ${META}`} data-testid="hq-support-tickets-more">{shown.length} of {rows.length} listed, the most at risk first.</p>
        )}
      </>
    );
  }
  return (
    <section aria-labelledby="hq-support-tk-title" className={SECTION} data-testid="hq-support-hq-tickets">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="hq-support-tk-title" className={H2}>HQ-hosted tickets</h2>
        {tickets?.available && count && (
          <span className="text-[13px] font-bold tabular-nums text-axal-ink dark:text-white" data-testid="hq-support-tickets-count">{figureText(count)} open</span>
        )}
      </div>
      {body}
      {tickets?.available && footing && (
        <details className="mt-3" data-testid="hq-support-footing-disclosure">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-axal-muted dark:text-gray-300">How this total is calculated</summary>
          {footing}
        </details>
      )}
    </section>
  );
}

/** The subsidiaries, folded to one line that links to Branches. */
export function SubsidiariesLine({ line }) {
  return (
    <section aria-labelledby="hq-support-subs-title" className={`${SECTION} flex flex-wrap items-center justify-between gap-2`} data-testid="hq-support-subsidiaries" data-state={line.state}>
      <div className="min-w-0">
        <h2 id="hq-support-subs-title" className="text-[14px] font-extrabold text-axal-ink dark:text-white">Subsidiaries</h2>
        <p className="text-[13px] text-axal-muted dark:text-gray-300" role={line.state === 'loading' ? 'status' : undefined}>{line.text}</p>
      </div>
      <Link to={workspaceHref('branches')} className="text-[13px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Support by subsidiary →</Link>
    </section>
  );
}

// ────────────────────────────────────────────────────────── branches ──

function BranchCard({ card, onRetry, busy }) {
  if (card.state !== 'connected') {
    return (
      <li className={SECTION} data-testid={`hq-support-branch-card-${card.code}`} data-state={card.state}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[14px] font-extrabold text-axal-ink dark:text-white">{card.label}</h3>
          <SupportBadge tone="unavailable">{card.state === 'not_deployed' ? 'Not bound' : 'Unavailable'}</SupportBadge>
        </div>
        <p className={`mt-1 ${META}`}>{card.reason || 'This branch did not answer the support read.'}</p>
        <p className={`mt-1 ${META}`}>Its branch-hosted tickets are not counted; its escalations are held at HQ and still shown.</p>
        {onRetry && (
          <button type="button" onClick={onRetry} disabled={busy} className={`${BTN} mt-2`}>{busy ? 'Asking…' : 'Retry'}</button>
        )}
      </li>
    );
  }
  const fig = (k, v) => (
    <div>
      <dt className="text-[12px] text-axal-muted dark:text-gray-400">{k}</dt>
      <dd className="text-[16px] font-extrabold tabular-nums text-axal-ink dark:text-white">{v}</dd>
    </div>
  );
  return (
    <li className={SECTION} data-testid={`hq-support-branch-card-${card.code}`} data-state="connected">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-extrabold text-axal-ink dark:text-white">{card.label}</h3>
        <SupportBadge tone="ok">Connected</SupportBadge>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2">
        {fig('Open tickets', card.open === null ? <Unrecorded reason="More open tickets than one read counts.">Not counted</Unrecorded> : card.open)}
        {fig('Past SLA', card.past === null ? <Unrecorded reason="The branch's tickets were not banded.">Not counted</Unrecorded> : card.past)}
        {fig('Oldest', card.oldest || 'None')}
      </dl>
      {card.split && <p className={`mt-1 ${META}`}>{card.split}</p>}
    </li>
  );
}

/**
 * Support by subsidiary (canvas SU04a/SU04b). With no subsidiary there is
 * nothing to compare, so neither cards nor matrix are drawn.
 */
export function BranchesWorkspace({ data, cards, branchState, busy, onRetry, matrix, branchTickets }) {
  if (branchState === 'loading') {
    return <section className={SECTION} data-testid="hq-support-branches" data-state="loading"><p className={META} role="status">Asking each subsidiary… HQ’s own queues do not wait for it.</p></section>;
  }
  if (branchState === 'failed') {
    return (
      <section className={SECTION} data-testid="hq-support-branches" data-state="failed">
        <Unreadable what="The subsidiary sources" claim="Whether they have tickets waiting is unknown — not none. HQ’s escalations are held at HQ and are on the Queue." onRetry={busy ? undefined : onRetry} />
      </section>
    );
  }
  if (!cards.length) {
    return (
      <section aria-labelledby="hq-support-br-title" className={SECTION} data-testid="hq-support-branches" data-state="none">
        <h2 id="hq-support-br-title" className={H2}>Support by subsidiary</h2>
        <p className="mt-2 text-[14px] font-semibold text-axal-ink dark:text-gray-100">No subsidiary support sources connected</p>
        <p className={`mt-1 ${META}`}>Only HQ’s own queues exist today, so there is nothing to compare. The queue table appears once a subsidiary answers.</p>
      </section>
    );
  }
  const unread = cards.filter((c) => c.state !== 'connected').length;
  return (
    <div className="grid gap-4" data-testid="hq-support-branches" data-state="ready">
      <section aria-labelledby="hq-support-br-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="hq-support-br-title" className={H2}>Support by subsidiary</h2>
          {unread > 0 && <SupportBadge tone="not_counted">Ticket totals: Not counted while {unread === 1 ? 'a subsidiary is' : `${unread} subsidiaries are`} unavailable</SupportBadge>}
        </div>
        <ul className="mt-3 grid gap-3 md:grid-cols-3">
          {cards.map((c) => <BranchCard key={c.code} card={c} onRetry={onRetry} busy={busy} />)}
        </ul>
      </section>
      {matrixCompares(data?.matrix) && matrix}
      {branchTickets}
    </div>
  );
}

// ────────────────────────────────────────────────────────── delivery ──

/**
 * Decision delivery and the GitHub mirror (canvas SU05a/SU05b). Durable
 * delivery history is #5035 and not built, so the list is this session's
 * decisions and says so; failures lead.
 */
export function DeliveryWorkspace({ recorded, renderRecorded, sync, mirror }) {
  const rows = deliveryRows(recorded);
  const failedN = rows.filter((r) => !(r.pushed && r.pushed.ok === true)).length;
  const line = mirrorLine(sync);
  return (
    <div className="grid gap-4" data-testid="hq-support-delivery">
      <section aria-labelledby="hq-support-dl-title" className={SECTION}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="hq-support-dl-title" className={H2}>
            {failedN > 0 ? `${failedN} ${failedN === 1 ? 'decision' : 'decisions'} not delivered` : 'Decision delivery'}
          </h2>
          {rows.length > 0 && failedN === 0 && <SupportBadge tone="delivered">All decisions recorded here were delivered</SupportBadge>}
        </div>
        <p className={`mt-1 ${META}`} data-testid="hq-support-delivery-scope">
          This lists the decisions recorded on this page since you opened it. HQ does not yet keep a history of past
          deliveries to read back (#5035), so a decision recorded earlier is not shown here.
        </p>
        {rows.length ? renderRecorded(rows) : (
          <p className="mt-2 text-[13px] text-axal-muted dark:text-gray-300" data-testid="hq-support-delivery-empty">No decision has been recorded in this session.</p>
        )}
      </section>
      <section aria-labelledby="hq-support-gh-title" data-testid="hq-support-mirror" data-state={line ? 'quiet' : 'detail'}>
        {line ? (
          <div className={`${SECTION} flex flex-wrap items-center justify-between gap-2`}>
            <p className="text-[13px] text-axal-ink dark:text-gray-100">
              <span id="hq-support-gh-title" className="font-extrabold">GitHub mirror</span> — {line}
            </p>
            <Link to="/admin/integration-keys#github" className="text-[13px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Mirror settings →</Link>
          </div>
        ) : (
          <>
            <h2 id="hq-support-gh-title" className="sr-only">GitHub mirror</h2>
            {mirror}
          </>
        )}
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────── policy ──

/** Whether the ticket SLA is on every subsidiary, above the policy itself. */
export function DistributionBanner({ distribution }) {
  const d = distribution;
  if (d.state === 'none' || d.state === 'complete') {
    return (
      <p className={`${SECTION} text-[13px] text-axal-ink dark:text-gray-100`} data-testid="hq-support-distribution" data-state={d.state}>
        {d.state === 'none'
          ? 'No subsidiary is deployed, so HQ’s ticket SLA has no branch to reach. It applies to HQ-hosted tickets.'
          : <><SupportBadge tone="ok">Current</SupportBadge> HQ’s ticket SLA is applied on all {d.total} {d.total === 1 ? 'subsidiary' : 'subsidiaries'}.</>}
      </p>
    );
  }
  return (
    <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" data-testid="hq-support-distribution" data-state={d.state}>
      <p className="text-[14px] font-extrabold">
        {d.state === 'incomplete'
          ? `SLA policy is not on every subsidiary — applied on ${d.current} of ${d.total}`
          : 'Whether subsidiaries apply HQ’s SLA policy is not known yet'}
      </p>
      <p className="mt-1 text-[13px]">
        {d.state === 'incomplete'
          ? 'HQ’s ticket SLA applies to HQ-hosted tickets. A subsidiary not on the current version bands its own tickets with the policy it last received. Each one is named below.'
          : (d.branchState === 'loading' ? 'The subsidiaries are still being asked.' : 'The subsidiaries could not be read.')}
      </p>
    </div>
  );
}

export const LoadingNote = ({ children }) => (
  <p className={`mt-3 inline-flex items-center gap-2 ${META}`} role="status"><Loader2 size={13} className="animate-spin" aria-hidden="true" /> {children}</p>
);

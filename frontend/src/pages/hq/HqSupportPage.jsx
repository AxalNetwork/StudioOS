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
 * EVERY PART ANSWERS FOR ITSELF. The route makes six reads and each carries its
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
 * TICKET SLA (D455). Escalations carry `due_at`; tickets inherit P1/P2/P3 from
 * filing priority and age against HQ's fixed hours. The policy panel names the
 * bands; queue cards show the derived band on each ticket row.
 *
 * D205 — HQ ANSWERS HERE. `PATCH /api/admin/escalations/:uid` (D112) had no
 * caller, so an escalation sat on HQ's board until its SLA passed and D143's
 * sweep emailed HQ a link to a list with no control on it. Each open
 * escalation now opens a decision panel on `DsrClose`'s shape. What comes back
 * is two facts, never one: the decision is recorded at HQ, and the branch did
 * or did not receive it. The second is shown only for this session, because the
 * board keeps the decision and not whether it arrived.
 *
 * THE HQ SUPPORT AUDIT (#5030–#5033).
 *   · D5030 — a filtered escalation count and its pills come from the server's
 *     measurement of the whole board (`escalations.kinds`), never the 25 rows
 *     listed; a ticket stays in the queue it was FILED in, with today's
 *     standing beside it where the two differ.
 *   · D5031 — HQ's own desk (`GET /local`) and the branch hosts (`GET /`) are
 *     read at once and drawn as each lands: a slow branch costs its own
 *     section, never HQ's queues.
 *   · D5032 — the ticket SLA policy carries a version, travels to every branch
 *     in its licence copy, and each branch's applied version is shown.
 *   · D5033 — Send again and the SLA save each say where they are: in flight,
 *     done, refused, or not known.
 *
 * D5034 (#5034) — SUPPORT V2. The one long page is four workspaces at
 * `?tab=` (Queue, the default; Branches; Delivery; Policy), built in
 * `./support/`. The Queue leads with what needs a decision: All clear when
 * every source answered with nothing open, otherwise Action required, HQ
 * escalations in SLA bands, HQ-hosted tickets oldest risk first, and the
 * subsidiaries in one line. Diagnostics (the matrix, the mirror) and the
 * policy sit in their own workspaces. The pieces above stay exported and
 * tested; the workspaces compose them.
 *
 * Super Admin stays on axal.vc. This page configures nothing but the ticket SLA hours.
 */
import React, { useCallback, useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, RailFrame, WorkerRail, Unrecorded, Unreadable } from '../../ui';
import useRecordCrumb from '../admin/useRecordCrumb';
import { escalationKindLabel, filterByKind, kindFilters } from '../../lib/escalationKinds';
import HeaderAsk from '../../ui/HeaderAsk.jsx';
import {
  workspaceFromSearch, queueOverview, distributionState, workspaceMarks, escalationGroups, kindHoursOf,
  hqTicketRows, hqTicketCount, branchCards, sourcesText, branchLabelOf,
} from './support/supportWorkspaceModel.js';
import {
  SupportHeader, WorkspaceNav, ActionRequired, AllClear, QueueKindFilter, EscalationQueue, HqTicketsSection,
  SubsidiariesLine, BranchesWorkspace, DeliveryWorkspace, DistributionBanner, LoadingNote,
} from './support/SupportWorkspaces.jsx';
import { DecisionSheetView, EMPTY_TEXT } from './support/DecisionSheet.jsx';

/** A read that failed, as the page holds it. Exported so `mergeSupport` is tested with the page's own value. */
export const UNAVAILABLE = Symbol('unavailable');

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
  // D485 — a branch's queue is named by its branch.
  if (String(o.queue).startsWith('branch:')) {
    const code = String(o.queue).slice('branch:'.length);
    const line = data.branch_tickets?.lines?.find((l) => l.code === code);
    return `admin on ${line?.label || code}`;
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

// "Due soon" is the last 24 hours of a limit, or its last half when the limit
// is shorter (D459): a 24-hour P1 is due soon for 12 hours. The panel below
// gives each limit's window.
const SLA_WORD = { past: 'past SLA', due_soon: 'due soon', ok: 'on time' };

/**
 * One queue. Pure over its props so every state renders in a test.
 *
 * `state` is 'loading' | 'unreadable' | 'ready'. `count` null on a ready queue
 * means the read hit its ceiling: the items are still the oldest, exactly, but
 * how many there are is not known, and the card says that rather than a number.
 */
export function QueueCard({
  queue, title: titleProp, who, state, reason, count, items = [], bands = null, basisNote = null, onRetry, testId,
}) {
  const title = titleProp || QUEUE_TITLES[queue];
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
            {bands.ok} on time · {bands.due_soon} due soon · {bands.past} past SLA
            {bands.undated > 0 ? ` · ${bands.undated} undated` : ''}
          </p>
        )}

        {state === 'ready' && basisNote && (
          <p className="mt-1 text-[10.5px] leading-relaxed text-axal-muted" data-testid={`${testId}-basis`}>{basisNote}</p>
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
                    {it.note && <span className="block text-[10px] font-normal text-axal-muted" data-testid="hq-support-standing">{it.note}</span>}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold tabular-nums ${PILL[it.band || 'none']}`}
                    title={it.band ? SLA_WORD[it.band] : 'Age could not be banded.'}
                  >
                    {age || <Unrecorded>undated</Unrecorded>}
                  </span>
                </>
              );
              const row = 'flex items-center justify-between gap-2 rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5';
              // Three kinds of row: a link to the item's own page, a row that
              // opens a panel under itself (an escalation HQ can answer), or
              // plain text. The panel sits beside the button, never inside it.
              let head;
              if (it.to) {
                head = <Link to={it.to} className={`${row} hover:border-[#881337]/40`}>{body}</Link>;
              } else if (it.onToggle) {
                head = (
                  <button
                    type="button"
                    onClick={it.onToggle}
                    aria-expanded={Boolean(it.expanded)}
                    className={`${row} w-full text-left hover:border-[#881337]/40`}
                  >
                    {body}
                  </button>
                );
              } else {
                head = <div className={row}>{body}</div>;
              }
              return (
                <li key={it.key}>
                  {head}
                  {it.expanded && it.panel}
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

/**
 * D5030 (#5030) — the kind filter's choices, from the server's measurement of
 * the WHOLE board (`escalations.kinds`), never from the oldest rows the card
 * lists. A count the server could not make is null, and the pill says
 * "not counted" rather than a number.
 *
 * A payload without `kinds` (an older Worker) counts from the listed rows only
 * when they are the whole board — the board's count equals the rows listed;
 * otherwise every per-kind count is null.
 */
export function escalationKindChoices(escalations) {
  const e = escalations;
  if (!e?.available) return [];
  if (Array.isArray(e.kinds)) {
    return [
      { kind: '', label: 'All', count: e.count ?? null },
      ...e.kinds.map((k) => ({ kind: k.kind, label: kindLabel(k.kind), count: k.count ?? null })),
    ];
  }
  const whole = e.count !== null && e.count !== undefined && (e.items || []).length >= e.count;
  return kindFilters(e.items).map((f) => ({ ...f, count: whole ? f.count : null }));
}

const kindLabel = (k) => String(escalationKindLabel(k)).replace(/^./, (c) => c.toUpperCase());

/**
 * D801 — the escalation queue's kind filter: All, then each kind on the board
 * with its count, D799's four request kinds always offered. Drawn only when the
 * board was read; an unreadable board has nothing to filter.
 */
export function EscalationKindFilter({ escalations, value, onChange }) {
  if (!escalations?.available) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter escalations by kind" data-testid="hq-support-kind-filter">
      {escalationKindChoices(escalations).map((f) => (
        <button key={f.kind || 'all'} type="button" onClick={() => onChange(f.kind)} aria-pressed={value === f.kind}
          data-kind={f.kind || 'all'}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${value === f.kind
            ? 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
            : 'border-axal-hairline bg-white text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:hover:text-gray-100'}`}>
          {f.label}{' '}
          {f.count === null
            ? <span className="italic" title="More open escalations than one read counts, so this kind is not counted.">not counted</span>
            : <span className="tabular-nums">{f.count}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * The escalation queue's props, from the payload. `decide`, when the page
 * passes it, makes each row open its decision panel —
 * `{ openUid, onToggle(uid), panelFor(item) }`. Without it the rows are plain
 * text, which is how the queue renders on its own.
 */
/** An escalation as its card and the rail's record name it: branch · subject, or its kind. */
export const escalationTitle = (x) => `${x.branch_code} · ${x.subject || escalationKindLabel(x.kind)}`;

export function escalationCardProps(data, failed, decide) {
  // D801 — the kind filter rides on `decide`, the page's own handle on the queue.
  const kind = decide?.kind || '';
  const base = {
    queue: 'escalations',
    who: 'What a branch pushes up to HQ: moderation, content for brand approval, a seat increase, or other; and a licence Administrator\'s requests: renewal, a change of terms, a delegate, or notice of non-renewal.',
    testId: 'hq-support-queue-escalations',
  };
  if (failed) return { ...base, state: 'unreadable', reason: 'The Support read failed, so this queue is unknown — not empty.' };
  if (!data) return { ...base, state: 'loading' };
  const e = data.escalations;
  if (!e?.available) return { ...base, state: 'unreadable', reason: e?.reason };
  // D5030 (#5030) — a filtered count and its rows come from the server's
  // measurement of the whole board, the same one the pills read: never the
  // length of the oldest rows the card happens to list.
  let count = e.count;
  let rows = e.items || [];
  if (kind) {
    const choice = escalationKindChoices(e).find((f) => f.kind === kind);
    const k = Array.isArray(e.kinds) ? e.kinds.find((x) => x.kind === kind) : null;
    count = choice ? choice.count : (e.count === null ? null : 0);
    rows = k ? (k.items || []) : filterByKind(e.items, kind);
  }
  return {
    ...base,
    state: 'ready',
    count,
    // The bands are the whole board's; a filtered card does not show them as its own.
    bands: kind ? null : e.bands,
    items: rows.map((x) => {
      const open = Boolean(decide) && decide.openUid === x.uid;
      return {
        key: x.uid,
        title: escalationTitle(x),
        meta: `${escalationKindLabel(x.kind)}${x.raised_by_name ? ` · raised by ${x.raised_by_name}` : ''}`,
        age_hours: x.age_hours,
        band: x.sla,
        ...(decide ? {
          onToggle: () => decide.onToggle(x.uid),
          expanded: open,
          panel: open ? decide.panelFor(x) : null,
        } : {}),
      };
    }),
  };
}

/**
 * The two decisions HQ records here. Never `withdrawn` — taking a request back
 * is the branch's act, not HQ's — and never `open`, which the server refuses:
 * an answer that left the row open would read as decided at HQ and undecided
 * on the branch.
 */
export const DECISION_OUTCOMES = [
  ['answered', 'Record as answered'],
  ['declined', 'Record as declined'],
];

/**
 * What each outcome tells the branch, said before it is sent. A declined
 * escalation reaches the branch as HQ's decision with its reason: the branch's
 * copy has no declined state (D112's collapse, `branchOps.ts`), so the words
 * the operator types ARE the refusal the branch reads.
 */
const OUTCOME_COPY = {
  answered: (code) => `This records HQ’s answer with your reason and sends it to ${code}. Recording it again later replaces it.`,
  declined: (code) => `This records a refusal with your reason and sends it to ${code}. The branch has no separate declined state: it shows this as HQ’s decision, with your reason as its words.`,
};
const OUTCOME_SUBMIT = { answered: 'Record the answer', declined: 'Record the refusal' };
const OUTCOME_PLACEHOLDER = {
  answered: 'What HQ decided, in the words the branch will read.',
  declined: 'Why HQ is declining, in the words the branch will read.',
};

/**
 * A refusal in words, and whether reloading is the next step.
 *
 * The sentence is read from `err.data.message` first: it is what the route
 * wrote, whatever builds the thrown error. Before D258 it was also the only
 * place the sentence survived, because `request()` put a string `error` code
 * into `err.message`. Since D258 `err.message` carries the body's sentence and
 * `err.code` carries the code, so the two reads agree whenever the body sends a
 * `message` — and the code is still never shown as the reason.
 *
 * A FAILURE WITH NO STATUS, OR A 5xx, IS NOT A REFUSAL. A timeout, a dropped
 * connection, or a server failure after the write can each leave the decision
 * recorded with no answer coming back, so the page says it does not know and
 * says to reload before recording again: a second answer replaces the first,
 * which is harmless only when it is meant. That is also why the timeout's own
 * "Nothing was changed." is never shown for this write — for a write it may be
 * false. A 400 or 403 is refused before the UPDATE, so its sentence stands.
 */
export function decisionError(err) {
  const status = err?.status;
  if (!status || status >= 500) {
    return {
      text: 'Whether HQ recorded this is not known: no answer came back. Reload the queue before recording it again — a second answer replaces the first.',
      reload: true,
    };
  }
  if (status === 404) {
    return { text: 'This escalation is no longer on HQ’s board, so there is nothing to answer.', reload: true };
  }
  return { text: String(err?.data?.message || err?.message || 'The decision was refused.'), reload: false };
}

/**
 * The decision panel, pure over its props so both phases render in a test.
 * `DsrClose`'s shape (`SecurityPage.jsx`): two outcomes, then a form whose
 * reason is required — mirroring the server's "a decision needs its reason" —
 * with a Cancel that goes back to the choice.
 */
export function EscalationDecisionView({
  item, outcome, reason, busy, error, onChoose, onReason, onSubmit, onCancel, onReload,
}) {
  const code = item.branch_code;
  const age = fmtAge(item.age_hours);
  const facts = [
    item.kind ? escalationKindLabel(item.kind) : null,
    item.raised_by_name ? `raised by ${item.raised_by_name}` : null,
    age ? `${age} old` : null,
    item.sla ? SLA_WORD[item.sla] : null,
  ].filter(Boolean).join(' · ');
  const btn = 'rounded-md border border-axal-hairline bg-white px-2 py-1 text-[11px] font-semibold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
  return (
    <div
      className="mt-1.5 rounded-lg border border-axal-hairline bg-white px-2.5 py-2 dark:border-gray-700 dark:bg-gray-900"
      data-testid="hq-support-decision"
    >
      {facts && <p className="text-[10.5px] text-axal-faint">{facts}</p>}
      {item.subject_ref && (
        <p className="mt-1 text-[10.5px] text-axal-muted">
          About <span className="font-mono">{item.subject_ref}</span>
          {item.relation
            ? <> · {item.relation === 'localises' ? 'localises' : 'changes'} it</>
            : <> · <Unrecorded reason="The branch did not record whether this localises or changes the subject." /></>}
        </p>
      )}
      {item.detail
        ? <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-axal-ink dark:text-gray-100">{item.detail}</p>
        : (
          <p className="mt-1 text-[11px] text-axal-muted">
            <Unrecorded reason="The branch raised it with a subject and no detail.">No detail</Unrecorded>
          </p>
        )}

      {!outcome ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="hq-support-decision-actions">
          {DECISION_OUTCOMES.map(([o, label]) => (
            <button key={o} type="button" onClick={() => onChoose(o)} className={btn}>{label}</button>
          ))}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-2 space-y-1.5" data-testid="hq-support-decision-form" data-outcome={outcome}>
          <p className="text-[11px] leading-relaxed text-axal-muted">{OUTCOME_COPY[outcome](code)}</p>
          <label className="block text-[11px] font-semibold text-axal-muted">
            Reason · required, stored with the decision and sent to {code}
            <textarea
              value={reason}
              onChange={(e) => onReason(e.target.value)}
              maxLength={4000}
              rows={3}
              disabled={busy}
              placeholder={OUTCOME_PLACEHOLDER[outcome]}
              className="mt-1 w-full rounded-md border border-axal-hairline bg-white px-2.5 py-1.5 text-[12px] font-normal text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </label>
          {error && (
            <div role="alert" className="text-[11.5px] text-red-700 dark:text-red-300" data-testid="hq-support-decision-error">
              <p>{error.text}</p>
              {error.reload && (
                <button type="button" onClick={onReload} className="mt-1 font-semibold underline">Reload the queue</button>
              )}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <button
              type="submit"
              disabled={busy || !reason.trim()}
              className="inline-flex items-center gap-1.5 rounded-md border-[1.5px] border-[#881337] bg-white px-2.5 py-1 text-[11px] font-bold text-[#881337] hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-400 dark:bg-gray-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : null}
              {busy ? 'Recording…' : OUTCOME_SUBMIT[outcome]}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-md px-2 py-1 text-[11px] font-semibold text-axal-faint hover:text-axal-ink dark:hover:text-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * D5034 part 2 — what a failed write means in the sheet: the request is gone
 * (404, refused before any write), the outcome is unknown (no status or a
 * 5xx: the decision may have been recorded), or it was refused (any other
 * 4xx: nothing written, the server's sentence stands).
 */
export function sheetFailure(err) {
  const status = err?.status;
  if (status === 404) return { phase: 'gone' };
  if (!status || status >= 500) return { phase: 'unknown' };
  return { phase: 'decide', refusal: String(err?.data?.message || err?.message || 'The decision was refused.') };
}

/**
 * The panel's state and its one write. `variant="sheet"` draws Support v2's
 * decision sheet (D5034) over the queue; the default is the inline panel the
 * licence page still uses. Either way this is the one place the escalation
 * becomes the rail's record.
 */
export function EscalationDecision({ item, onRecorded, onReload, variant = 'panel', record = null, onResend, onClose, returnFocusTo, branchLabel, readAt, kindHours }) {
  // D775 (#2101): the escalation being answered is the rail's record while its panel is open.
  useRecordCrumb(escalationTitle(item), 'escalation', item.uid);
  const [outcome, setOutcome] = useState(variant === 'sheet' ? 'answered' : '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sheet, setSheet] = useState({ phase: 'decide', invalid: null, refusal: null });
  const firstOutcome = useRef(null);
  // The one write, for the panel and the sheet alike: reported as recorded
  // only after it succeeded, and a failure rendered in words.
  const writeDecision = async (onFailed) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.escalationAnswer(item.uid, { answer: reason.trim(), status: outcome });
      onRecorded?.(item, outcome, res);
      return true;
    } catch (err) {
      reportError('hq-support:answer', err);
      setError(decisionError(err));
      onFailed?.(err);
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (variant === 'sheet') {
    const submitSheet = async (e) => {
      e.preventDefault();
      if (busy) return;
      // Refused here, in words tied to the field: an empty decision is never sent.
      if (!reason.trim()) { setSheet({ phase: 'decide', invalid: EMPTY_TEXT[outcome], refusal: null }); return; }
      setSheet({ phase: 'recording', invalid: null, refusal: null });
      const ok = await writeDecision((err) => setSheet({ invalid: null, refusal: null, ...sheetFailure(err) }));
      if (ok) setSheet({ phase: 'recorded', invalid: null, refusal: null });
    };
    return (
      <DecisionSheetView
        item={item}
        branchLabel={branchLabel}
        readAt={readAt}
        kindHours={kindHours}
        phase={sheet.phase === 'recorded' && !record ? 'recording' : sheet.phase}
        outcome={outcome}
        reason={reason}
        invalid={sheet.invalid}
        refusal={sheet.refusal}
        record={record}
        copy={OUTCOME_COPY[outcome](branchLabel || item.branch_code)}
        onChoose={(o) => { setOutcome(o); setSheet((s) => ({ ...s, invalid: null, refusal: null })); }}
        onReason={(v) => { setReason(v); if (sheet.invalid && v.trim()) setSheet((s) => ({ ...s, invalid: null })); }}
        onSubmit={submitSheet}
        onClose={() => onClose?.(sheet.phase === 'recorded')}
        onResend={onResend}
        onReread={onReload}
        initialFocus={firstOutcome}
        returnFocusTo={returnFocusTo}
      />
    );
  }
  const submit = async (e) => {
    e.preventDefault();
    if (busy || !reason.trim()) return;
    await writeDecision();
  };
  return (
    <EscalationDecisionView
      item={item}
      outcome={outcome}
      reason={reason}
      busy={busy}
      error={error}
      onChoose={(o) => { setOutcome(o); setError(null); }}
      onReason={setReason}
      onSubmit={submit}
      onCancel={() => { setOutcome(''); setError(null); }}
      onReload={onReload}
    />
  );
}

/** One session record, from the PATCH's answer and the item it answered. */
export function recordOf(item, outcome, res) {
  return {
    uid: item.uid,
    branch_code: res?.branch_code || item.branch_code,
    subject: res?.subject || item.subject,
    status: res?.status || outcome,
    answered_at: res?.answered_at || null,
    pushed: res?.pushed,
  };
}

const hhmm = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? iso.slice(11, 16) : null);

/**
 * D5033 (#5033) — a failed "Send again" in words. The resend re-pushes a
 * decision HQ already holds, so whatever happens HQ's record is unchanged; what
 * is unknown is only whether the branch received it.
 *
 * NO STATUS, OR A 5xx: the push may have reached the branch with no answer
 * coming back, so the page says it does not know — never "failed". A 4xx was
 * refused before any push, so its sentence stands.
 */
export function resendError(err, code) {
  const status = err?.status;
  if (!status || status >= 500) {
    return {
      state: 'unknown',
      text: `Whether ${code} received it is not known: no answer came back. HQ’s recorded decision is unchanged. Send again to retry.`,
    };
  }
  if (status === 404) {
    return { state: 'failed', text: 'This escalation is no longer on HQ’s board, so there is nothing to send.' };
  }
  return { state: 'failed', text: `Not sent: ${String(err?.data?.message || err?.message || 'the resend was refused.')}` };
}

/**
 * What happened, as two facts that stay two (D112's header): HQ recorded the
 * decision, and the branch did or did not receive it. A push that failed is
 * stated with its reason. Nothing sends it again on its own. Send again
 * re-pushes the decision already stored — not a new one (D243).
 *
 * D5033 — Send again says what it is doing: disabled with "Sending…" while its
 * request is in flight, the delivery line updated in place when it answers,
 * and a request that fails is said inline (`role="alert"`, in words, not only
 * colour) with the button left as the retry.
 */
export function RecordedOutcome({ rec, onResend }) {
  const code = rec.branch_code;
  const at = hhmm(rec.answered_at);
  const p = rec.pushed;
  const sending = rec.resend?.state === 'sending';
  const resendFailed = rec.resend?.state === 'failed' || rec.resend?.state === 'unknown';
  let delivery;
  if (!p || typeof p !== 'object' || typeof p.ok !== 'boolean') {
    delivery = <span data-delivery="unreported">Whether it reached {code} was not reported.</span>;
  } else if (p.ok) {
    delivery = (
      <span data-delivery="received">
        {code} received it.
        {rec.resend?.state === 'delivered' && <span data-testid="hq-support-resend-delivered"> Sent again{hhmm(rec.resend.at) ? ` at ${hhmm(rec.resend.at)} UTC` : ''}.</span>}
      </span>
    );
  } else {
    delivery = (
      <span data-delivery="not_sent" className="text-amber-800 dark:text-amber-300">
        Not on {code}: {p.reason || 'no reason was given.'} Nothing sends it again on its own.
        {onResend && (
          <button
            type="button"
            className="ml-2 inline-flex items-center gap-1 underline font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => onResend(rec.uid)}
            disabled={sending}
            aria-busy={sending || undefined}
            data-testid="hq-support-resend"
          >
            {sending ? <Loader2 size={11} className="animate-spin" aria-hidden="true" /> : null}
            {sending ? 'Sending…' : 'Send again'}
          </button>
        )}
      </span>
    );
  }
  return (
    <li className="rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[11px] leading-relaxed" data-testid="hq-support-recorded-item">
      <span className="font-semibold text-axal-ink dark:text-gray-100">{code} · {rec.subject}</span>
      <span className="block text-axal-muted">
        Recorded at HQ{at ? ` at ${at} UTC` : ''} as {rec.status === 'declined' ? 'declined' : 'answered'}.
      </span>
      <span className="block text-axal-muted">{delivery}</span>
      {resendFailed && (
        <span role="alert" className="block font-semibold text-red-700 dark:text-red-300" data-testid="hq-support-resend-error" data-state={rec.resend.state}>
          {rec.resend.state === 'unknown' ? 'Unknown: ' : 'Failed: '}{rec.resend.text}
        </span>
      )}
    </li>
  );
}

/** This session's decisions. Nothing here is read back from a store. */
export function RecordedList({ recorded, onResend }) {
  if (!recorded?.length) return null;
  return (
    <div className="mt-3" data-testid="hq-support-recorded">
      <Card>
        <h2 className="text-[13.5px] font-extrabold tracking-tight">Recorded this session</h2>
        <p className="mt-1 text-[10.5px] leading-relaxed text-axal-faint">
          Shown until you leave this page. The board keeps each decision, and whether the last push reached the
          branch is stored on that row. Send again sends that stored decision, not a new one.
        </p>
        <ul className="mt-2 grid gap-1.5">
          {recorded.map((r) => (
            <RecordedOutcome key={`${r.uid}-${r.answered_at || 'unstamped'}`} rec={r} onResend={onResend} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

/**
 * D5033 — one resend's state change, pure so a test drives it: `sending` while
 * in flight, then the push's own answer (`delivered` when it reached the
 * branch), or the request's failure in words.
 */
export function resendStep(rec, step, payload) {
  if (step === 'start') return { ...rec, resend: { state: 'sending' } };
  if (step === 'answer') {
    const pushed = payload?.pushed;
    return {
      ...rec,
      pushed,
      resend: pushed && pushed.ok === true ? { state: 'delivered', at: new Date().toISOString() } : { state: 'idle' },
    };
  }
  return { ...rec, resend: resendError(payload, rec.branch_code) };
}

/** D5030 — the words for a ticket's persona, filed or current. */
export const PERSONA_WORD = {
  hq_held: 'HQ-held user',
  admin_product: 'licence administrator',
  hq_staff: 'HQ staff',
  account_closed: 'account closed',
  not_on_record: 'no account on record',
  branch_member: 'branch member',
};

/**
 * D5030 (#5030) — the line under a ticket that says where its queue came from:
 * the filing record, with today's standing beside it when the two differ, or
 * current standing because nothing was recorded at filing. Null when the
 * filing record and today agree, which is the common case.
 */
export function standingNote(x) {
  if (!x || !x.basis) return null;
  if (x.basis === 'current_standing') {
    return 'Queued from current standing: the context it was filed in was not recorded.';
  }
  if (!x.standing_changed) return null;
  const filedLicence = x.licence ? (x.licence.licence_ref || x.licence.brand_name) : null;
  const filed = `${PERSONA_WORD[x.filed?.persona] || x.filed?.persona || 'unknown'}${filedLicence ? ` (${filedLicence})` : ''}`;
  const nowLicence = x.current?.licence_ref || null;
  const now = `${PERSONA_WORD[x.current?.persona] || x.current?.persona || 'unknown'}${nowLicence ? ` (${nowLicence})` : ''}`;
  return `Filed as ${filed} · now ${now}`;
}

/** D5030 — the card's line saying how many of its tickets had no filing record. */
export function basisNoteOf(bucket, snapshotReadable) {
  if (snapshotReadable === false) {
    return 'The filing record could not be read on this database, so every ticket here is queued from its requester’s current standing.';
  }
  const n = bucket?.from_current_standing;
  if (!n) return null;
  return `${plural(n, 'ticket was', 'tickets were')} filed before the filing context was recorded, so ${n === 1 ? 'it is' : 'they are'} queued from current standing.`;
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
    bands: b?.bands ?? null,
    basisNote: basisNoteOf(b, t.snapshot_readable),
    items: (b?.items || []).map((x) => ({
      key: x.id,
      title: x.title || `Ticket #${x.id}`,
      meta: [x.requester, x.licence ? (x.licence.licence_ref || x.licence.brand_name) : null, x.status?.replace('_', ' ')]
        .filter(Boolean).join(' · '),
      note: standingNote(x),
      age_hours: x.age_hours,
      band: x.sla_band,
      to: `/help/tickets/${x.id}`,
    })),
  };
}

/**
 * D485 — one branch's About-Admin queue, as `QueueCard` props: the tickets its
 * administrators filed on its own host, read from its database over RPC and
 * banded with HQ's hours. A branch HQ could not ask, or that did not answer,
 * is Unreadable with the reason — never an empty queue.
 */
export function branchTicketCardProps(line) {
  const base = {
    queue: 'branch',
    title: `Admins on ${line.label}`,
    who: `Filed on ${line.code}’s own host, into its database, and read from there.`,
    testId: `hq-support-branch-${line.code}`,
  };
  if (line.state !== 'ok') return { ...base, state: 'unreadable', reason: line.reason };
  return {
    ...base,
    state: 'ready',
    count: line.count,
    bands: line.bands ?? null,
    items: (line.items || []).map((x) => ({
      key: `${line.code}:${x.id}`,
      title: x.title || `Ticket #${x.id}`,
      meta: [x.requester, x.priority, x.status?.replace('_', ' ')].filter(Boolean).join(' · '),
      age_hours: x.age_hours,
      band: x.sla_band,
    })),
  };
}

/**
 * The branch hosts' queues, one card each. Nothing is drawn when no branch is
 * deployed.
 *
 * D5031 (#5031) — read apart from HQ's own desk, so it has its own states:
 * `loading` while the branches answer (HQ's queues are already drawn above),
 * `failed` when the read did not complete — said here, with a retry that
 * re-reads the branches without blanking HQ's queues.
 */
export function BranchTicketsSection({ branchTickets, state = 'ready', onRetry, busy = false }) {
  if (state === 'loading') {
    return (
      <section className="mt-4" data-testid="hq-support-branch-tickets" data-state="loading">
        <h2 className="text-[13.5px] font-extrabold tracking-tight">Tickets filed on branch hosts</h2>
        <p className="mt-1 text-[11px] text-axal-muted" role="status">Asking each branch host… HQ’s own queues above do not wait for it.</p>
      </section>
    );
  }
  if (state === 'failed') {
    return (
      <section className="mt-4" data-testid="hq-support-branch-tickets" data-state="failed">
        <h2 className="text-[13.5px] font-extrabold tracking-tight">Tickets filed on branch hosts</h2>
        <div className="mt-2">
          <Unreadable
            what="The branch hosts"
            claim="Whether their administrators have tickets waiting is unknown — not none. HQ’s own queues above are unaffected."
            onRetry={busy ? undefined : onRetry}
          />
        </div>
      </section>
    );
  }
  const lines = branchTickets?.lines || [];
  if (!lines.length) return null;
  const cov = branchTickets.coverage || {};
  return (
    <section className="mt-4" data-testid="hq-support-branch-tickets" data-state="ready">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13.5px] font-extrabold tracking-tight">Tickets filed on branch hosts</h2>
        <span className="text-[10.5px] text-axal-faint">
          {cov.answered} of {cov.total} branches answered
          {cov.unreadable?.length ? ` · not read: ${cov.unreadable.join(', ')}` : ''}
          {onRetry && (
            <button type="button" onClick={onRetry} disabled={busy} className="ml-2 font-semibold underline disabled:opacity-60" data-testid="hq-support-branch-refresh">
              {busy ? 'Asking…' : 'Ask again'}
            </button>
          )}
        </span>
      </div>
      <p className="mt-1 text-[10.5px] leading-relaxed text-axal-faint">{branchTickets.whose}</p>
      <div className="mt-2 grid gap-3 md:grid-cols-3">
        {lines.map((l) => <QueueCard key={l.code} {...branchTicketCardProps(l)} onRetry={onRetry} />)}
      </div>
    </section>
  );
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
                        {cell.on_branch !== undefined && (
                          <span className="block text-[10px] text-axal-faint" data-testid="hq-support-matrix-split">
                            {cell.on_branch} on its host · {cell.on_hq} on axal.vc
                          </span>
                        )}
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
 * to H16's P2 console, which is Platform's GitHub Sync panel (D213): the
 * mirror's latest attempts, ticket by ticket. Its settings stay on the Admin
 * Console, so the strip links both, each with a literal path.
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
          {stat('Average lag', syncLagText(sync.lag) ?? <Unrecorded reason={sync.lag?.reason} />)}
        </div>
        {sync.not_configured > 0 && (
          <p className="mt-2 text-[10.5px] text-amber-800 dark:text-amber-300">
            {plural(sync.not_configured, 'attempt', 'attempts')} found no GitHub token configured.
          </p>
        )}
        <p className="mt-2 text-[10.5px] leading-relaxed text-axal-muted">
          Counted from each ticket&apos;s latest mirror attempt, so a ticket retried within the window counts once, as
          its latest outcome. {syncLagNote(sync.lag, sync.window_hours)}
        </p>
      </>
    );
  }
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13.5px] font-extrabold tracking-tight">GitHub sync</h2>
        <Link to="/admin/integration-keys#github" className="text-[11px] font-semibold text-[#881337] underline dark:text-rose-300">
          Mirror settings →
        </Link>
      </div>
      <div className="mt-2">{body}</div>
      <p className="mt-2 text-[10px] text-axal-faint">
        The mirror&apos;s latest attempts, ticket by ticket, are on{' '}
        <Link to="/admin/platform" className="underline">Platform</Link>; its settings are under{' '}
        <Link to="/admin/integration-keys#github" className="underline">Integration keys › GitHub Sync</Link>.
      </p>
    </Card>
  );
}

/** One coverage line per read that answered (D126) — never a line for a read that failed. */
/** The average create-to-mirror lag as a figure, or null when there is none to show (D459). */
export function syncLagText(lag) {
  if (!lag || lag.value === null || lag.value === undefined) return null;
  const s = Number(lag.value);
  return s < 120 ? `${s}s` : `${Math.round(s / 60)} min`;
}

/** The sentence under the strip: how the lag was measured, or why there is none. */
export function syncLagNote(lag, windowHours) {
  if (!lag) return '';
  if (lag.value === null || lag.value === undefined) return lag.reason || '';
  const left = lag.unmeasured
    ? ` ${plural(lag.unmeasured, 'ticket', 'tickets')} filed with no mirror event ${lag.unmeasured === 1 ? 'is' : 'are'} not in the average.`
    : '';
  return `Average lag is from filing to the GitHub issue, over ${plural(lag.measured, 'ticket', 'tickets')} filed in the last ${windowHours}h, to the second; the longest took ${syncLagText({ value: lag.max })}.${left}`;
}

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
  const bt = data.branch_tickets;
  if (bt && bt.lines?.length) {
    const read = bt.lines.filter((l) => l.state === 'ok' && l.count !== null);
    if (read.length) {
      const n = read.reduce((sum, l) => sum + l.count, 0);
      out.push(`${plural(n, 'open ticket', 'open tickets')} on ${read.length} of ${bt.lines.length} branch hosts`);
    }
  }
  if (data.taxonomy?.available) {
    const n = data.taxonomy.items.reduce((sum, t) => sum + Number(t.open), 0);
    out.push(`${plural(n, 'open ticket', 'open tickets')} counted by type`);
  }
  return out;
}

/** What this page cannot say, each with its reason. [title, detail] pairs. */
export const SUPPORT_UNAVAILABLE = [
  ['The filing context of older tickets', 'A ticket keeps the queue it was filed in from #5030 on. One filed before that has no filing record, so it is queued from its requester’s standing now and says so on its row. Nothing fills the record in afterwards.'],
  ['The SLA version of a branch on an older deploy', 'A branch reports which version of HQ’s P1/P2/P3 hours it bands with only from the deploy that carries #5032. An older one is shown as unreported, never as current.'],
  ['A push that has not been tried', 'A decision recorded before the push was stored has no outcome on its row. Send again is offered where this page still shows that decision.'],
  ['Support under the overlay', 'Out of scope. Viewing as a branch scopes Home and Team; this page reads HQ’s escalation board and HQ’s own tickets, not one branch’s database.'],
];

/** The edit form's starting values: the tiers as stored. */
function tierDraft(items) {
  return Object.fromEntries((items || []).map((t) => [t.id, { hours: String(t.hours), description: t.description }]));
}

export const SLA_TIER_IDS = ['P1', 'P2', 'P3'];

/**
 * D5033 (#5033) — the server's own rules, checked before anything is sent:
 * whole hours from 1 to 720, a description of 1 to 200 characters, and
 * P1 ≤ P2 ≤ P3. Returns the problems in words; an empty list submits.
 */
export function validateTierDraft(draft) {
  const errors = [];
  const hours = {};
  for (const id of SLA_TIER_IDS) {
    const t = draft?.[id];
    if (!t) { errors.push(`${id} is missing.`); continue; }
    const raw = String(t.hours ?? '').trim();
    const h = Number(raw);
    if (!/^\d+$/.test(raw) || h < 1 || h > 720) errors.push(`${id} hours must be a whole number from 1 to 720.`);
    else hours[id] = h;
    const d = String(t.description ?? '').trim();
    if (!d || d.length > 200) errors.push(`${id} needs a description of 1 to 200 characters.`);
  }
  if (hours.P1 !== undefined && hours.P2 !== undefined && hours.P1 > hours.P2) errors.push('P1 must not wait longer than P2.');
  if (hours.P2 !== undefined && hours.P3 !== undefined && hours.P2 > hours.P3) errors.push('P2 must not wait longer than P3.');
  return errors;
}

/**
 * D5033 — a failed save in words. A refusal (4xx, or the 503 the route sends
 * when it could not read the tiers before writing) changed nothing. No status,
 * or any other 5xx, may have committed the new hours with no answer coming
 * back: the page says it does not know and asks for a reload before saving
 * again — never that the policy was or was not applied.
 */
export function slaSaveError(err) {
  const status = err?.status;
  const code = err?.code || err?.data?.code || err?.data?.error?.code;
  if (status && (status < 500 || code === 'sla_tiers_unreadable')) {
    return { phase: 'rejected', text: `Not saved: ${String(err?.data?.message || err?.message || 'the tiers were refused.')}` };
  }
  return {
    phase: 'unknown',
    text: 'Whether the new hours were saved is not known: no answer came back. Reload the policy before saving again, and do not treat these hours as applied.',
  };
}

/**
 * D5033 / D5032 — the confirmation after a save, from what the route answered:
 * the version it made, and branch by branch whether the new hours are applied.
 * "Applied everywhere" only when every deployed branch acknowledged them.
 */
export function slaSavedSummary(res) {
  const changed = res?.changed || [];
  if (!changed.length) return { headline: 'Saved. Nothing changed, so no new version was made and nothing was sent.', lines: [] };
  const d = res?.distribution;
  const v = d?.version;
  const head = v ? `Saved as policy v${v}.` : 'Saved. This save carries no version number.';
  if (!d) return { headline: `${head} Whether branches received it was not reported.`, lines: [] };
  if (d.reason && !d.total) return { headline: `${head} ${d.reason}`, lines: [] };
  if (!d.total) return { headline: `${head} No branch is deployed, so there is nothing to send.`, lines: [] };
  const lines = (d.branches || []).filter((b) => b.state !== 'applied').map((b) => ({
    code: b.code, label: b.label, state: b.state, text: b.reason,
  }));
  const tail = d.complete
    ? `Applied on all ${d.total} branches.`
    : `Applied on ${d.applied} of ${d.total} branches; not yet on the rest.`;
  return { headline: `${head} ${tail}${d.reason ? ` ${d.reason}` : ''}`, lines };
}

const SLA_STATE_WORD = {
  current: 'current', stale: 'stale', unreported: 'not reported', unreadable: 'unreadable', not_deployed: 'not bound',
};

/**
 * D5032 — "Policy vN · applied on X of Y branches", and each branch that is not
 * current with its reason. `propagation` null means no branch was asked yet
 * (the HQ-local read), which is said, never shown as applied.
 */
export function SlaPropagation({ version, propagation, branchState }) {
  const v = version?.available ? version.value : null;
  const label = version
    ? (version.available ? (v ? `Policy v${v}` : 'Policy not yet numbered') : 'Policy version unreadable')
    : null;
  let coverage = null;
  if (propagation) {
    coverage = propagation.total
      ? `applied on ${propagation.current} of ${propagation.total} ${propagation.total === 1 ? 'branch' : 'branches'}`
      : 'no branch deployed';
  } else if (branchState === 'loading') {
    coverage = 'asking branches…';
  } else if (branchState === 'failed') {
    coverage = 'branch coverage unreadable';
  }
  const behind = (propagation?.branches || []).filter((b) => b.state !== 'current');
  return (
    <div className="mt-2 text-[10.5px]" data-testid="hq-support-sla-propagation">
      <p className="font-semibold text-axal-ink dark:text-gray-100">
        {label}{coverage ? ` · ${coverage}` : ''}
      </p>
      {version && !version.available && <p className="text-axal-muted">{version.reason}</p>}
      {propagation?.reason && <p className="text-axal-muted">{propagation.reason}</p>}
      {behind.length > 0 && (
        <ul className="mt-1 grid gap-0.5 text-axal-muted" data-testid="hq-support-sla-behind">
          {behind.map((b) => (
            <li key={b.code} data-state={b.state}>
              <span className="font-semibold">{b.label}</span> · {SLA_STATE_WORD[b.state] || b.state}
              {b.version ? ` (v${b.version})` : ''}{b.reason ? ` — ${b.reason}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Canvas Y1 — the response bands HQ sets (D482, a store since migration 333)
 * and open tickets by the canvas's eight categories (D455, D482).
 *
 * D5033 — the save says where it is: checked here first (P1 ≤ P2 ≤ P3 and the
 * bounds), then saving, then saved with its version and branch coverage, or
 * refused with the server's reason, or unknown when no answer came back.
 */
export function SlaPolicyPanel({ slaPolicy, taxonomy, failed, onRetry, onSaved, branchState = 'ready' }) {
  const [draft, setDraft] = useState(null); // null = not editing
  const [phase, setPhase] = useState('idle'); // idle | saving | saved | rejected | unknown
  const [problems, setProblems] = useState([]);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  if (failed) {
    return (
      <Card>
        <Unreadable what="SLA policy and taxonomy" claim="The Support read failed." onRetry={onRetry} />
      </Card>
    );
  }
  const saving = phase === 'saving';
  const tiersRead = slaPolicy?.tiers;
  const tiers = tiersRead?.available ? tiersRead.items : [];
  const kinds = slaPolicy?.escalation_kinds || [];
  // `taxonomy` is undefined until the read answers: that is loading, not unreadable.
  const loading = taxonomy === undefined || taxonomy === null;
  const tax = taxonomy?.available ? taxonomy.items : null;
  const save = async () => {
    const found = validateTierDraft(draft);
    setProblems(found);
    setError(null);
    if (found.length) return;
    setPhase('saving');
    try {
      const body = Object.fromEntries(Object.entries(draft).map(([id, t]) => [id, { hours: Number(t.hours), description: String(t.description).trim() }]));
      const res = await api.hqSupportSetSlaTiers(body);
      setDraft(null);
      setSaved(slaSavedSummary(res));
      setPhase('saved');
      onSaved?.(res);
    } catch (e) {
      reportError('hq-support:sla-tiers', e);
      const err = slaSaveError(e);
      setError(err.text);
      setPhase(err.phase);
    }
  };
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13.5px] font-extrabold tracking-tight">SLA policy and taxonomy</h2>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-axal-faint">Set here · ticket tiers</span>
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[9px] font-extrabold uppercase tracking-wide text-axal-faint">Tickets · response bands</p>
            {tiersRead?.available && !draft && (
              <button
                type="button"
                className="hidden text-[10.5px] font-semibold text-axal-ink underline-offset-2 hover:underline md:inline dark:text-white"
                onClick={() => { setError(null); setProblems([]); setSaved(null); setPhase('idle'); setDraft(tierDraft(tiers)); }}
                data-testid="hq-support-sla-edit"
              >
                Edit hours
              </button>
            )}
          </div>
          {tiersRead?.available && !draft && (
            <p className="mt-1 text-[11.5px] text-axal-faint md:hidden" data-testid="hq-support-sla-phone-note">Editing the policy is on a wider screen; on a phone it reads only.</p>
          )}
          {tiersRead && !tiersRead.available && (
            <p className="mt-2 text-[11px] text-axal-muted" data-testid="hq-support-sla-unreadable">
              <Unrecorded reason={tiersRead.reason}>Unreadable</Unrecorded>
              <span className="ml-1">No ticket is banded until the tiers can be read.</span>
            </p>
          )}
          {phase === 'saved' && saved && !draft && (
            <div role="status" className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200" data-testid="hq-support-sla-saved">
              <p className="font-semibold">{saved.headline}</p>
              {saved.lines.length > 0 && (
                <ul className="mt-1 grid gap-0.5">
                  {saved.lines.map((l) => (
                    <li key={l.code} data-state={l.state}>
                      <span className="font-semibold">{l.label}</span> · {l.state === 'unknown' ? 'not yet known' : 'not applied'} — {l.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {phase === 'unknown' && !draft && error && (
            <div role="alert" className="mt-2 text-[11px] font-semibold text-red-700 dark:text-red-300" data-testid="hq-support-sla-error" data-phase="unknown">
              <p>{error}</p>
            </div>
          )}
          {draft ? (
            <form
              className="mt-2 grid gap-2"
              onSubmit={(e) => { e.preventDefault(); save(); }}
              noValidate
              data-testid="hq-support-sla-form"
              data-phase={phase}
            >
              {tiers.map((b) => (
                <div key={b.id} className="grid grid-cols-[2.5rem_5rem_1fr] items-center gap-2">
                  <span className="text-[10px] font-extrabold tracking-wide text-[#881337] dark:text-rose-300">{b.id}</span>
                  <label className="flex items-center gap-1 text-[11px] text-axal-muted">
                    <input
                      type="number" min="1" max="720" step="1" required
                      aria-label={`${b.id} hours`}
                      disabled={saving}
                      className="w-14 rounded border border-axal-hairline bg-transparent px-1.5 py-1 text-[12px] tabular-nums dark:border-gray-700"
                      value={draft[b.id]?.hours ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [b.id]: { ...d[b.id], hours: e.target.value } }))}
                    />
                    h
                  </label>
                  <input
                    type="text" maxLength={200} required
                    aria-label={`${b.id} description`}
                    disabled={saving}
                    className="min-w-0 rounded border border-axal-hairline bg-transparent px-1.5 py-1 text-[11px] dark:border-gray-700"
                    value={draft[b.id]?.description ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [b.id]: { ...d[b.id], description: e.target.value } }))}
                  />
                </div>
              ))}
              <p className="text-[10.5px] text-axal-faint">Whole hours from 1 to 720, and P1 no longer than P2, nor P2 than P3. Every change is recorded in the audit log, makes a new policy version, and is sent to every deployed branch.</p>
              {problems.length > 0 && (
                <ul role="alert" className="grid gap-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300" data-testid="hq-support-sla-problems">
                  {problems.map((p) => <li key={p}>Not sent: {p}</li>)}
                </ul>
              )}
              {error && (
                <div role="alert" className="text-[11px] font-semibold text-rose-700 dark:text-rose-300" data-testid="hq-support-sla-error" data-phase={phase}>
                  <p>{error}</p>
                  {phase === 'unknown' && onRetry && (
                    <button type="button" className="mt-1 underline" onClick={() => { setDraft(null); onRetry(); }}>Reload the policy</button>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-axal-ink px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-gray-900">
                  {saving ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : null}
                  {saving ? 'Saving and sending to branches…' : 'Save tiers'}
                </button>
                <button type="button" disabled={saving} className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-axal-muted" onClick={() => { setDraft(null); setProblems([]); setError(null); setPhase('idle'); }}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <ul className="mt-2 grid gap-2">
              {tiers.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40"
                  data-testid={`hq-support-sla-${b.id}`}
                >
                  <div className="min-w-0">
                    <span className="text-[10px] font-extrabold tracking-wide text-[#881337] dark:text-rose-300">{b.id}</span>
                    <span className="ml-2 text-[11px] text-axal-muted">{b.description}</span>
                  </div>
                  <span className="shrink-0 text-[12px] font-extrabold tabular-nums text-axal-ink dark:text-white">
                    {b.hours}h{b.due_soon_hours != null && <span className="ml-1 text-[10px] font-semibold text-axal-faint">· due soon last {b.due_soon_hours}h</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {slaPolicy && (slaPolicy.version || slaPolicy.branch_copy) && (
            <SlaPropagation version={slaPolicy.version} propagation={slaPolicy.branch_copy?.propagation || null} branchState={branchState} />
          )}
          {kinds.length > 0 && (
            <>
              <p className="mt-3 text-[9px] font-extrabold uppercase tracking-wide text-axal-faint">Escalations from branches · a second table</p>
              <ul className="mt-2 grid gap-1.5" data-testid="hq-support-sla-escalations">
                {kinds.map((k) => (
                  <li key={k.kind} className="flex items-center justify-between gap-3 text-[11px] text-axal-muted">
                    <span className="capitalize">{escalationKindLabel(k.kind)}</span>
                    <span className="tabular-nums">{k.hours}h · due soon last {k.due_soon_hours}h</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10.5px] text-axal-faint">
                An escalation is due at a time stamped from its kind when the branch raises it; a ticket is banded by its priority tier. The two tables are separate promises, and only the ticket tiers are versioned and sent to branches.
              </p>
            </>
          )}
          {slaPolicy?.note && (
            <p className="mt-2 text-[11px] leading-relaxed text-axal-muted">{slaPolicy.note}</p>
          )}
          {slaPolicy?.branch_copy?.held && (
            <p className="mt-1 text-[10.5px] text-axal-faint" data-testid="hq-support-sla-branch-copy">
              <Unrecorded reason={slaPolicy.branch_copy.reason}>Branch copy held</Unrecorded>
            </p>
          )}
          {slaPolicy?.ticket_mapping && (
            <p className="mt-1 text-[10.5px] text-axal-faint">Tickets: {slaPolicy.ticket_mapping}</p>
          )}
        </div>
        <div>
          <p className="text-[9px] font-extrabold uppercase tracking-wide text-axal-faint">Open tickets by category</p>
          {loading && <p className="mt-2 text-[11px] text-axal-muted">Reading the ticket categories…</p>}
          {!loading && !taxonomy.available && (
            <p className="mt-2 text-[11px] text-axal-muted">
              <Unrecorded reason={taxonomy.reason}>Unreadable</Unrecorded>
            </p>
          )}
          {tax && (
            <ul className="mt-2 grid grid-cols-2 gap-2" data-testid="hq-support-taxonomy">
              {tax.map((t) => (
                <li
                  key={t.category}
                  className="flex items-center justify-between gap-2 rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-2 text-[11px] dark:border-gray-700 dark:bg-gray-900/40"
                >
                  <span className="font-semibold">{t.label}</span>
                  <span className="font-mono text-[10.5px] tabular-nums text-axal-muted">{t.open}</span>
                </li>
              ))}
            </ul>
          )}
          {tax && taxonomy.uncategorised > 0 && (
            <p className="mt-2 text-[11px] text-axal-muted" data-testid="hq-support-uncategorised">
              <Unrecorded reason="Filed before categories were stored, or filed without one. Counted apart, never as Other.">
                {taxonomy.uncategorised} open with no category recorded
              </Unrecorded>
            </p>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-axal-muted">
            Eight categories, fixed. Free-text categories are how a support taxonomy becomes unreadable within a quarter, and the per-tenant read depends on these being comparable.
          </p>
        </div>
      </div>
    </Card>
  );
}

const isRead = (x) => Boolean(x) && x !== UNAVAILABLE && typeof x === 'object';

/**
 * D5031 (#5031) — the page's one view of two reads: `local` (HQ's own desk,
 * `GET /local`, never waiting on a branch) and `full` (the same plus every
 * branch host, `GET /`). Pure, so every arrival order is tested.
 *
 *   · only local has answered: HQ's queues are drawn; the branch parts are
 *     pending (`branchState` 'loading', or 'failed' when the full read failed);
 *   · full has answered and is at least as new: it is the view;
 *   · local is NEWER than full (a quiet refresh after a decision or a save):
 *     local's HQ parts, full's branch parts — and the total is local's, which
 *     withholds itself while branches are deployed, rather than full's stale one.
 *     A propagation figure computed against another policy version is dropped.
 */
export function mergeSupport(local, full) {
  const l = isRead(local) ? local : null;
  const f = isRead(full) ? full : null;
  const branchState = f ? 'ready' : (full === UNAVAILABLE ? 'failed' : 'loading');
  if (!l && !f) return { data: null, branchState };
  if (!f) return { data: { ...l, branch_tickets: undefined, matrix: undefined }, branchState };
  if (!l || String(l.read_at || '') <= String(f.read_at || '')) return { data: f, branchState };
  const sameVersion = l.sla_policy?.version?.value !== undefined
    && l.sla_policy?.version?.value === f.sla_policy?.version?.value;
  return {
    data: {
      ...f,
      read_at: l.read_at,
      total: l.total,
      escalations: l.escalations,
      tickets: l.tickets,
      sync: l.sync,
      taxonomy: l.taxonomy,
      sla_policy: {
        ...l.sla_policy,
        branch_copy: { ...(l.sla_policy?.branch_copy || {}), propagation: sameVersion ? (f.sla_policy?.branch_copy?.propagation ?? null) : null },
      },
    },
    branchState,
  };
}

export default function HqSupportPage() {
  // Each: null = loading, UNAVAILABLE = failed, else the payload.
  const [local, setLocal] = useState(null);
  const [full, setFull] = useState(null);
  const [branchBusy, setBranchBusy] = useState(false);
  // D5034 part 2 — the escalation whose sheet is open: its row and the row after it.
  const [open, setOpen] = useState(null);
  const reviewButtons = useRef(new Map());
  const opener = useRef(null);
  const [focusAfter, setFocusAfter] = useState(null);
  const [recorded, setRecorded] = useState([]);
  // D801 — the escalation queue's kind filter; '' is every kind.
  const [kindFilter, setKindFilter] = useState('');
  // D5031 — two reads at once. `clear` shows the loading state first (a retry
  // after a failed read). After a decision or a save the reload is quiet — the
  // queue stays on screen and changes when the new read lands.
  const fetchLocal = useCallback((clear) => {
    if (clear) setLocal(null);
    return api.hqSupportLocal().then(setLocal, (e) => {
      reportError('hq-support:local', e);
      setLocal(UNAVAILABLE);
    });
  }, []);
  // The branch read never blanks HQ's queues: while it runs, the last good one
  // stays drawn (or the local read does), and a failure costs only its parts.
  const fetchFull = useCallback((clear) => {
    if (clear) setFull(null);
    setBranchBusy(true);
    return api.hqSupport().then(setFull, (e) => {
      reportError('hq-support', e);
      setFull((prev) => (isRead(prev) && !clear ? prev : UNAVAILABLE));
    }).finally(() => setBranchBusy(false));
  }, []);
  const fetchSupport = useCallback((clear) => Promise.allSettled([fetchLocal(clear), fetchFull(clear)]), [fetchLocal, fetchFull]);
  const load = useCallback(() => fetchSupport(true), [fetchSupport]);
  // D5034 — Refresh is quiet: the last read stays drawn and the header says which one it shows.
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => {
    setRefreshing(true);
    fetchSupport(false).finally(() => setRefreshing(false));
  }, [fetchSupport]);
  const retryBranches = useCallback(() => {
    // A failed branch read goes back to "asking"; a good one stays drawn while it is asked again.
    setFull((prev) => (prev === UNAVAILABLE ? null : prev));
    fetchFull(false);
  }, [fetchFull]);
  useEffect(() => { load(); }, [load]);

  // The sheet stays open on its outcome (recorded, delivered or not); the queue
  // re-reads quietly behind it.
  const onRecorded = useCallback((item, outcome, res) => {
    setRecorded((prev) => [recordOf(item, outcome, res), ...prev]);
    fetchSupport(false);
  }, [fetchSupport]);
  // D5033 — Send again, with its state on the record it resends.
  const onResend = useCallback((uid) => {
    let busy = false;
    setRecorded((prev) => prev.map((r) => {
      if (r.uid !== uid) return r;
      if (r.resend?.state === 'sending') { busy = true; return r; }
      return resendStep(r, 'start');
    }));
    if (busy) return;
    api.escalationResend(uid).then((res) => {
      setRecorded((prev) => prev.map((r) => (r.uid === uid ? resendStep(r, 'answer', res) : r)));
    }, (e) => {
      reportError('hq-support:resend', e);
      setRecorded((prev) => prev.map((r) => (r.uid === uid ? resendStep(r, 'error', e) : r)));
    });
  }, []);
  // Review opens the sheet; closing it returns focus to that row's Review,
  // or, after a decision, to the next row's (the canvas's "focus returns to the
  // next row in the queue").
  const decide = {
    openUid: open?.item.uid || null,
    kind: kindFilter,
    onOpen: (item, button, nextUid) => { opener.current = button || null; setOpen({ item, next: nextUid || null }); },
    refFor: (uid) => (el) => { if (el) reviewButtons.current.set(uid, el); else reviewButtons.current.delete(uid); },
  };
  const closeSheet = useCallback((decided) => {
    if (decided && open?.next) setFocusAfter(open.next);
    setOpen(null);
  }, [open]);
  useEffect(() => {
    if (open || !focusAfter) return;
    reviewButtons.current.get(focusAfter)?.focus();
    setFocusAfter(null);
  }, [open, focusAfter]);

  const { data: ready, branchState } = mergeSupport(local, full);
  // The page as a whole failed only when neither read answered.
  const failed = local === UNAVAILABLE && full === UNAVAILABLE;
  const coverage = supportCoverage(ready);
  const readAt = ready?.read_at ? String(ready.read_at).slice(11, 16) : null;

  // D5034 — the workspace is the address (`?tab=`); a link pushes history.
  const [params] = useSearchParams();
  const workspace = workspaceFromSearch(params.get('tab'));
  const overview = queueOverview(ready, { failed, branchState });
  const distribution = distributionState(ready?.sla_policy, branchState);
  const marks = workspaceMarks(overview, recorded, distribution);
  const tiers = ready?.sla_policy?.tiers?.available ? ready.sla_policy.tiers.items : [];
  const groups = escalationGroups(ready?.escalations, {
    kind: kindFilter, readAt: ready?.read_at, kindHours: kindHoursOf(ready?.sla_policy),
  });
  const escCount = kindFilter
    ? (escalationKindChoices(ready?.escalations).find((f) => f.kind === kindFilter)?.count ?? null)
    : ready?.escalations?.count;
  const recordedList = <RecordedList recorded={recorded} onResend={onResend} />;

  let body;
  if (failed) {
    body = <Unreadable what="Support" claim="This is not a claim that nothing is waiting." onRetry={load} />;
  } else if (workspace === 'branches') {
    body = (
      <BranchesWorkspace
        data={ready}
        cards={branchCards(ready)}
        branchState={branchState}
        busy={branchBusy}
        onRetry={retryBranches}
        matrix={<TenantMatrix matrix={ready?.matrix} failed={branchState === 'failed'} onRetry={retryBranches} />}
        branchTickets={<BranchTicketsSection branchTickets={ready?.branch_tickets} state={branchState} busy={branchBusy} onRetry={retryBranches} />}
      />
    );
  } else if (workspace === 'delivery') {
    body = (
      <DeliveryWorkspace
        recorded={recorded}
        renderRecorded={(rows) => (
          <ul className="mt-3 grid gap-1.5">
            {rows.map((r) => <RecordedOutcome key={`${r.uid}-${r.answered_at || 'unstamped'}`} rec={r} onResend={onResend} />)}
          </ul>
        )}
        sync={ready?.sync}
        mirror={<SyncStrip sync={ready?.sync} failed={false} onRetry={refresh} />}
      />
    );
  } else if (workspace === 'policy') {
    body = (
      <div className="grid gap-4">
        <DistributionBanner distribution={distribution} />
        <SlaPolicyPanel
          slaPolicy={ready?.sla_policy}
          taxonomy={ready?.taxonomy}
          failed={false}
          branchState={branchState}
          onRetry={() => fetchSupport(false)}
          onSaved={() => fetchSupport(false)}
        />
      </div>
    );
  } else if (overview.state === 'loading') {
    body = <LoadingNote>Loading support queues…</LoadingNote>;
  } else if (overview.state === 'clear' || overview.state === 'hq_clear') {
    body = (
      <div className="grid gap-4">
        <AllClear overview={overview} readAt={readAt} />
        {recordedList}
      </div>
    );
  } else {
    body = (
      <div className="grid gap-4">
        <ActionRequired overview={overview} />
        <EscalationQueue
          escalations={ready?.escalations}
          groups={groups}
          count={escCount}
          decide={decide}
          onRetry={load}
          kindFilter={(
            <QueueKindFilter
              choices={escalationKindChoices(ready?.escalations)}
              value={kindFilter}
              onChange={setKindFilter}
            />
          )}
        />
        {recordedList}
        <HqTicketsSection
          tickets={ready?.tickets}
          rows={hqTicketRows(ready, { tiers })}
          count={hqTicketCount(ready)}
          footing={<FootingLine tickets={ready?.tickets} />}
          onRetry={load}
        />
        <SubsidiariesLine line={overview.subsidiaries} />
      </div>
    );
  }

  return (
    <RailFrame
      rail={(
        <WorkerRail
          workspace="Support"
          role="super_admin"
          stance="Read-only, except answering an escalation and setting the ticket SLA hours"
          note="Escalations, both ticket queues, the mirror strip and the SLA policy are read from HQ's own stores first, without waiting on any branch. Each branch's administrators' tickets, the tenant × queue matrix and each branch's SLA version are read from the branches beside them. Recording an answer sends it to the branch. Send again resends the decision already stored."
          coverage={coverage}
          coverageNote={coverage.length ? undefined : (failed ? 'The Support read could not be completed.' : 'Loading…')}
          unavailable={SUPPORT_UNAVAILABLE}
          data-testid="hq-support-rail"
        />
      )}
      data-testid="hq-support-page"
    >
      <div className="min-w-0">
        <SupportHeader
          readAt={readAt}
          refreshing={refreshing}
          onRefresh={failed ? load : refresh}
          sources={sourcesText(ready, branchState)}
          actions={(
            <>
              {/* D606 — the Super Admin's review queue, a secondary header action, not part of the task's copy. */}
              <Link to="/hq/review" className="text-[13px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" data-testid="hq-support-review-link">
                Review feature requests →
              </Link>
              <HeaderAsk />
            </>
          )}
        />
        <WorkspaceNav current={workspace} marks={marks} />
        <div className="mt-4" data-testid="hq-support-workspace" data-workspace={workspace}>{body}</div>
        {open && (
          <EscalationDecision
            key={open.item.uid}
            variant="sheet"
            item={open.item}
            record={recorded.find((r) => r.uid === open.item.uid) || null}
            onRecorded={onRecorded}
            onResend={onResend}
            onClose={closeSheet}
            onReload={() => { closeSheet(false); fetchSupport(false); }}
            returnFocusTo={opener}
            branchLabel={branchLabelOf(ready, open.item.branch_code)}
            readAt={ready?.read_at}
            kindHours={kindHoursOf(ready?.sla_policy)}
          />
        )}
      </div>
    </RailFrame>
  );
}

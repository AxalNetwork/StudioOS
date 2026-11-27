/**
 * D8728 (#8728) — Admin Studio's overdue card, the first thing under "Needs a
 * decision" (canvas SAD01, SAD12): how many approvals are overdue · over 72
 * hours, the oldest with its lane, age and owner, and one action, "Review
 * overdue in Approvals", which opens `/admin/approvals?age=past` with router
 * state `{ from: '/studio' }`. Items under 72 hours are one quiet line.
 *
 * ⚑1 OPTION A (owner question open): the card makes the Inbox's own read,
 * `adminApprovalsApi.inbox(1, { age: 'past' })`, so Studio's count and the
 * landing's rows come from one read. It relaxes D512 for this one read; the
 * page itself (`AdminStudioHome.jsx`) still makes none. `read` is passed in by
 * a render test; in production it is undefined and the card reads itself.
 *
 * Nothing here decides or assigns: the action is a link, as on main.
 *
 * D8728 part 3: every link the card has into Approvals is a `StudioLink`,
 * which sends Studio's router state and notes itself on the way out, so Back
 * returns focus to whichever control left (a lane line, Open Approvals), not
 * only to the primary action.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApprovalsApi } from '../../lib/api/adminApprovals';
import { reportError } from '../../lib/log';
import { StateChip, Unreadable } from '../../ui';
import {
  AGE_CHIP, FROM_STUDIO, OVERDUE_TO, OVERDUE_WORDS, laneTo, onTimeLine, overdueView, ownerText,
  partialLabel, reviewLabel, takeStudioExit, rememberStudioExit, unreadLine,
} from './studioOverdue';

export const REVIEW_ID = 'studio-overdue-review';
export const DECIDE_HEADING_ID = 'studio-decide-heading';

const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const SUB = 'text-[12.5px] leading-snug text-axal-muted dark:text-gray-400';
const PRIMARY = 'inline-flex min-h-[44px] w-full items-center justify-center rounded-[9px] bg-axal-violet px-4 text-[13.5px] font-bold text-white hover:bg-axal-violet-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet sm:min-h-[40px] sm:w-auto dark:bg-violet-500 dark:text-white dark:hover:bg-violet-400';
const LINK = 'inline-flex min-h-[44px] items-center text-[12.5px] font-bold text-axal-violet underline-offset-2 hover:underline sm:min-h-0 dark:text-violet-300';
const PILL = 'inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200';

/** The Inbox's read with `age=past`: `{ status, reply, reload }`. */
export function useOverdueRead(read) {
  const [state, setState] = useState({ status: 'loading', reply: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (read !== undefined) return undefined;
    let cancelled = false;
    setState({ status: 'loading', reply: null });
    adminApprovalsApi.inbox(1, { age: 'past' }).then(
      (reply) => { if (!cancelled) setState({ status: 'ready', reply }); },
      (e) => {
        reportError('admin-studio:overdue', e);
        if (!cancelled) setState({ status: 'error', reply: null });
      },
    );
    return () => { cancelled = true; };
  }, [read, tick]);
  return read !== undefined ? { reload: () => {}, ...read } : { ...state, reload };
}

/** SAD04: once the card has drawn, put Studio back where the reader left it. */
function useStudioReturn(ready) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current || typeof document === 'undefined') return;
    done.current = true;
    const note = takeStudioExit();
    if (!note) return;
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, note.y);
    // The control that left, or — when it is gone (the item was decided
    // meanwhile) — the section heading, so focus never falls to the top.
    const el = document.getElementById(note.target) || document.getElementById(DECIDE_HEADING_ID);
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
  }, [ready]);
}

const leave = (id) => rememberStudioExit(id, { scrollY: typeof window !== 'undefined' ? window.scrollY : 0 });

/** The ids of the card's other ways into Approvals, each noted on the way out (SAD04, SAD20). */
export const OPEN_IDS = Object.freeze({
  onTime: 'studio-overdue-on-time-open',
  unavailable: 'studio-overdue-unavailable-open',
  zero: 'studio-overdue-open',
  decided: 'studio-overdue-decided',
});
export const laneLinkId = (key) => `studio-overdue-lane-${key}`;

/**
 * D8728 part 3: a link from the card into Approvals. It sends Studio's router
 * state (so Approvals draws the crumb) and notes its own id and the scroll, so
 * the return puts focus back on this control, whichever one left (SAD20:
 * "focus returns to the control that left").
 */
function StudioLink({ id, to, className, children }) {
  return (
    <Link id={id} to={to} state={FROM_STUDIO} onClick={() => leave(id)} className={className} data-testid={id}>
      {children}
    </Link>
  );
}

function Figure({ figure, words, testId }) {
  return (
    <p className="m-0 flex flex-wrap items-baseline gap-x-2" data-testid={testId}>
      <span className="font-mono text-[28px] font-bold leading-none text-axal-ink dark:text-gray-100">{figure}</span>
      <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{words}</span>
    </p>
  );
}

function OverdueItem({ row }) {
  const owner = ownerText(row);
  return (
    <div className="mt-3 grid gap-2 rounded-lg border border-axal-hairline p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-start sm:gap-4 dark:border-gray-700" data-testid="studio-overdue-item">
      <div className="min-w-0">
        <p className="m-0 text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{row.who}</p>
        <p className={`m-0 ${SUB}`}>{row.what}</p>
        <p className={`m-0 ${SUB}`}>Lane: {row.laneLabel}</p>
      </div>
      <div>
        <p className="m-0 flex items-center gap-2 font-mono text-[13px] font-bold text-axal-ink dark:text-gray-100">
          {row.age}
          <span className={PILL}><span aria-hidden="true">!</span>Overdue</span>
        </p>
      </div>
      {owner ? (
        <div data-testid="studio-overdue-owner">
          <p className="m-0 text-[12.5px] font-bold text-axal-ink dark:text-gray-100">{owner.text}</p>
          {owner.sub ? <p className={`m-0 ${SUB}`}>{owner.sub}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function OnTime({ n }) {
  const line = onTimeLine(n);
  if (!line) return null;
  return (
    <p className={`mt-3 flex flex-wrap items-center gap-x-2 border-t border-axal-hairline pt-3 dark:border-gray-700 ${SUB}`} data-testid="studio-overdue-on-time">
      <span className="font-bold text-axal-ink dark:text-gray-100">{line}</span>
      <span>under 72 hours, not overdue.</span>
      <StudioLink id={OPEN_IDS.onTime} to="/admin/approvals" className={LINK}>Open Approvals</StudioLink>
    </p>
  );
}

/**
 * `read`: undefined in production (the card reads), or `{ status, reply }`.
 * `scope`: the territory the read ran for ("Lisbon Studio", "HQ-held accounts").
 * `frozen`: the licence is suspended — still drawn, deciding is blocked.
 * `othersWaiting`: another exception sits beside this card, so 0 here is not
 * "nothing needs a decision".
 */
export default function StudioOverdueCard({ read: readProp, scope, frozen = false, othersWaiting = false }) {
  const read = useOverdueRead(readProp);
  const view = overdueView(read);
  useStudioReturn(view.state !== 'loading');

  if (view.state === 'loading') {
    return (
      <div className={CARD} data-testid="studio-overdue-reading" aria-busy="true">
        <p className={`m-0 ${SUB}`}>Reading the approval queue…</p>
      </div>
    );
  }
  if (view.state === 'unreadable') {
    return (
      <div className={CARD} data-testid="studio-overdue-unavailable">
        <Unreadable what="Approvals" claim="This is not a claim that nothing is overdue. The rest of Studio read normally." onRetry={read.reload} />
        <StudioLink id={OPEN_IDS.unavailable} to="/admin/approvals" className={LINK}>Open Approvals →</StudioLink>
      </div>
    );
  }

  const partial = view.unreadable.length > 0;
  const partialNote = partial ? (
    <p className={`mt-2 flex flex-wrap items-center gap-2 ${SUB}`} data-testid="studio-overdue-partial">
      <StateChip kind="partial" label={partialLabel(view)} />
      <span>{unreadLine(view.unreadable)}, so there may be more overdue.</span>
      <button type="button" className={LINK} onClick={read.reload}>Try again</button>
    </p>
  ) : null;
  const frozenNote = frozen ? (
    <p className="mt-2 text-[12px] font-semibold text-rose-800 dark:text-rose-200" data-testid="studio-overdue-frozen">
      Suspended · writes are blocked. Reading is never gated. Deciding is blocked until HQ lifts the freeze.
    </p>
  ) : null;

  if (view.kind === 'overdue') {
    const several = view.lanes.length > 1;
    return (
      <div className={CARD} data-testid="studio-overdue" data-kind="overdue">
        <Figure figure={view.figure} words={OVERDUE_WORDS} testId="studio-overdue-count" />
        <p className={`m-0 mt-1 ${SUB}`}>{several ? `in ${view.lanes.length} lanes · ` : ''}in Approvals · {scope}</p>
        {partialNote}
        {frozenNote}
        {several ? (
          <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0" data-testid="studio-overdue-lanes">
            {view.lanes.map((l) => (
              <li key={l.key} className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-axal-ink dark:text-gray-100">
                <span className="font-bold">{l.label}</span>
                <span className={SUB}>· {l.count} overdue{l.oldest ? ` · oldest ${l.oldest}` : ''}</span>
                <StudioLink id={laneLinkId(l.key)} to={laneTo(l.key)} className={LINK}>Lane: {l.label} →</StudioLink>
              </li>
            ))}
          </ul>
        ) : view.oldest ? <OverdueItem row={view.oldest} /> : null}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <StudioLink id={REVIEW_ID} to={OVERDUE_TO} className={PRIMARY}>
            {reviewLabel(view)} →
          </StudioLink>
          <span className={`hidden sm:inline ${SUB}`}>Opens Approvals with <b className="text-axal-ink dark:text-gray-100">{AGE_CHIP}</b> in {scope}.</span>
        </div>
        <OnTime n={view.onTime} />
      </div>
    );
  }

  if (view.kind === 'clear' && !othersWaiting) {
    return (
      <div className={CARD} data-testid="studio-overdue" data-kind="clear">
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-[28px] font-bold leading-none text-axal-ink dark:text-gray-100">0</span>
          <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">nothing needs a decision</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" data-testid="studio-overdue-all-clear">
            <span aria-hidden="true">✓</span>Every lane answered
          </span>
        </p>
        {frozenNote}
        <p className={`mt-2 ${SUB}`}>
          Nothing is waiting in Approvals for {scope}: all {view.lanesAll} lanes answered with 0 open.
        </p>
        <StudioLink id={OPEN_IDS.decided} to="/admin/approvals/decided" className={LINK}>See what was decided</StudioLink>
      </div>
    );
  }

  // 0 overdue: on time only, nothing open but another exception beside it, a
  // count not sent, or a lane that did not answer — never "every lane answered".
  return (
    <div className={CARD} data-testid="studio-overdue" data-kind={view.kind}>
      <p className="m-0 flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-[28px] font-bold leading-none text-axal-ink dark:text-gray-100">0</span>
        <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">
          overdue{view.kind === 'partial-zero' ? ' in the lanes that answered' : ''}
        </span>
        {view.kind === 'quiet' ? <span className={SUB}>· {view.onTime} waiting under 72 hours</span> : null}
      </p>
      {partialNote}
      {frozenNote}
      <p className={`mt-2 ${SUB}`}>
        {view.kind === 'quiet' ? 'Nothing is overdue.'
          : view.kind === 'clear' ? `Nothing is waiting in Approvals for ${scope}.`
            : view.kind === 'partial-zero' ? 'Nothing overdue was read; this is not a claim that nothing is.'
              : 'Nothing is overdue in Approvals.'}
      </p>
      <StudioLink id={OPEN_IDS.zero} to="/admin/approvals" className={LINK}>Open Approvals</StudioLink>
    </div>
  );
}

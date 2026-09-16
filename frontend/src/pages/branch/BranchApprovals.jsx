/**
 * Branch · Approvals — canvas S3, the whole of it (D112 the lane, D130 the board).
 *
 * TWO HALVES THAT ARE DIFFERENT KINDS OF THING, which is why they are two
 * cards and two loads rather than one list. The **board** is the four queues
 * this territory decides, unioned and sorted oldest first. The **To-HQ lane**
 * is what it asked HQ — outbound, decided elsewhere, and its answer comes back
 * as one decision. Folding them together would make either failure blank the
 * other, and would suggest the branch decides its own escalations.
 *
 * THIS PAGE SHIPPED AS HALF OF ITSELF FIRST, and the notice it carried said
 * so. That notice promised the read model as PR 13's work; D130 IS PR 13, so
 * the promise is gone and what remains in the rail's `unavailable` list is the
 * narrower true thing — assignment, history and the AI decision note, each
 * with the reason it does not exist. Narrowing rather than deleting is the
 * D111 pattern, and `frontend/test/branch_approvals_board_d130.test.mjs`
 * refuses the retired sentence.
 *
 * THE BOARD READS; THE CONSOLES DECIDE. It shows four stores it does not own,
 * so each row offers that queue's own console instead of an Approve button.
 * One lane has no console to offer — see `LANE_CONSOLE` — and says so.
 *
 * THE ANSWER IS ONE DECISION, NOT A THREAD, and this page must not suggest
 * otherwise. The canvas says "the answer coming back as a thread with HQ's
 * decision and who made it"; what exists is a single answer with an author and
 * a time. So the drawer renders the decision and no reply box — a reply box
 * that wrote nowhere would be the most expensive kind of lie on this screen,
 * because the person using it would believe they had replied.
 *
 * A SUSPENDED BRANCH CAN STILL RAISE. The frozen banner (D107) names an appeal
 * and the appeal is an escalation, so this form stays live while every other
 * branch write answers 423. Reading the board is likewise never gated: a frozen
 * branch can still see what is waiting, which is what the banner tells it to do.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, Unrecorded, Unreadable } from '../../ui';
import BranchZone from './BranchZone';

const UNAVAILABLE = Symbol('unavailable');

/**
 * The four things a branch cannot decide for itself, with the words the
 * subsidiary canvas uses. A fifth is a product decision, not a new option.
 */
const KINDS = [
  ['moderation', 'Moderation', 'A case you want HQ to take rather than decide here.'],
  ['content', 'Content for brand approval', 'A localised or original piece that needs HQ sign-off.'],
  ['seat_increase', 'Seat increase', 'Seats are set by HQ, so this is a request to make.'],
  ['other', 'Other', 'Anything the three above do not cover.'],
];

const PILL = 'shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[.08em]';
/**
 * `undelivered` IS NOT AN ERROR STYLE BY ACCIDENT. It is the one state a person
 * can act on — retry — and the only one where the branch holds a row HQ does
 * not, so it reads differently from both open and answered.
 */
const STATUS_PILL = {
  open: `${PILL} bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300`,
  answered: `${PILL} bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300`,
  undelivered: `${PILL} bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300`,
};
/** The SLA band the server derived. Never recomputed here — one definition. */
const SLA_LABEL = { ok: null, due_soon: 'due within 24h', past: 'past SLA' };

/**
 * Where each lane is actually decided (D130).
 *
 * THE BOARD READS; THE CONSOLES DECIDE, so each row offers the console rather
 * than an Approve button that would write to a store this page never touches.
 *
 * SPINOUT MODERATION HAS NO CONSOLE, AND THAT IS A FINDING RATHER THAN AN
 * OMISSION HERE. `/api/admin/spinout-moderation/:userId` exists on the Worker
 * and `api.adminSpinoutModeration` / `adminSpinoutModerationDecide` exist in
 * `lib/api.js` — with **zero callers anywhere in `frontend/src`**. So a
 * moderation case is real work that reaches the backlog count, reaches this
 * board, and has nowhere to be decided. The row says that instead of linking
 * to a route that would 404, which is the failure `sidebarConfig.js` names:
 * a destination that looks shipped and is not.
 */
const LANE_CONSOLE = {
  lp: { to: '/admin/lp-applications', label: 'LP applications console' },
  referrals: { to: '/admin/refer-earn', label: 'Referral review' },
  // The cohort panel is rendered INSIDE the Spin-Out Lab admin page rather
  // than routed on its own — checked, not assumed, because a link to
  // `/admin/cohort` would 404.
  cohort: { to: '/admin/spinout-lab', label: 'Spin-Out Lab admin' },
  moderation: null,
};

/** The two views that are pure predicates over what the server already sent. */
const VIEWS = [
  ['all', 'All queues'],
  ['past', 'Past SLA'],
];

export default function BranchApprovals() {
  const [lane, setLane] = useState(null);           // null = loading, UNAVAILABLE = failed
  const [board, setBoard] = useState(null);         // D130 — the four local queues
  const [view, setView] = useState('all');
  const [kind, setKind] = useState('other');
  const [subject, setSubject] = useState('');
  const [detail, setDetail] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const load = useCallback(() => {
    setLane(null);
    api.branchEscalations().then(setLane, (e) => {
      reportError('branch-escalations', e);
      setLane(UNAVAILABLE);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  // SEPARATE FROM THE LANE, AND ITS OWN FAILURE. The outbound lane and the four
  // local queues are different reads against different tables; folding them
  // into one loader would make either failure blank the other half of a page
  // whose whole argument is that the two halves are different things.
  const loadBoard = useCallback(() => {
    setBoard(null);
    api.branchApprovals().then(setBoard, (e) => {
      reportError('BranchApprovals:board', e);
      setBoard(UNAVAILABLE);
    });
  }, []);
  useEffect(() => { loadBoard(); }, [loadBoard]);

  const submit = async (e) => {
    e.preventDefault();
    if (!subject.trim() || sending) return;
    setSending(true);
    setSendError('');
    try {
      await api.branchEscalate({ kind, subject: subject.trim(), detail: detail.trim() || undefined });
      setSubject('');
      setDetail('');
      load();
    } catch (err) {
      reportError('branch-escalate', err);
      setSendError(err?.message || 'The escalation could not be raised.');
    } finally {
      setSending(false);
    }
  };

  const ready = lane && lane !== UNAVAILABLE && lane.available;
  const items = ready ? (lane.items || []) : [];

  const boardReady = board && board !== UNAVAILABLE;
  const boardItems = boardReady ? (board.items || []) : [];
  const shown = view === 'past' ? boardItems.filter((it) => it.sla === 'past') : boardItems;
  const pastCount = boardItems.filter((it) => it.sla === 'past').length;

  // WHAT THE RAIL CAN HONESTLY REPORT (D126): what this page loaded. The count
  // of raised escalations and how many still await an answer are both real
  // reads; the four local queues now contribute their own lines rather than
  // nothing, and a failed read still contributes none — `coverageNote` says
  // which. The rail must never read as "nothing raised" or "nothing waiting".
  const coverage = [
    ...(ready
      ? [
        `${items.length} ${items.length === 1 ? 'escalation' : 'escalations'} raised from this branch`,
        `${items.filter((it) => !it.answer).length} awaiting an answer from HQ`,
      ]
      : []),
    ...(boardReady
      ? [
        `${boardItems.length} open across the four local queues`,
        `${pastCount} past the 72-hour SLA`,
      ]
      : []),
  ];

  return (
    <BranchZone
      workspace="Approvals"
      stance="Read-only summary of the board and the outbound lane"
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (lane === UNAVAILABLE && board === UNAVAILABLE
          ? 'Neither the board nor the outbound lane could be read, so there is nothing to read back — this is not a claim that nothing is waiting.'
          : 'Loading this territory\'s approvals…')}
      unavailable={[
        // NARROWED, NOT DELETED (the D111 pattern). The board exists now, so
        // the old line, which promised the read model as future work,
        // became false the moment this shipped. What is still genuinely
        // missing is smaller, and saying the smaller true thing is the point.
        ['Assignment and history', 'Who a queue item is assigned to, and its history timeline, need a store that does not exist. Nothing records either today, so the board shows neither rather than showing them empty.'],
        ['An AI-drafted decision note', 'The canvas draws one with its cost. There is no per-branch AI cost figure — the gateway metadata that would produce one is not wired — so a cost line here would be invented.'],
        ['A reply to HQ', 'An escalation carries one answer with an author and a time. There is no thread, so there is nothing for a reply to be added to.'],
      ]}
    >
    <div className="space-y-4" data-testid="branch-approvals-page">
      <header>
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
          <Send size={13} /> S3 · Approvals
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">
          To HQ
        </h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
          The outbound lane of the approvals board: the four things this territory cannot decide for
          itself, and what HQ decided. The four local queues are the rest of S3 and are not here yet.
        </p>
      </header>

      <Card className="p-4">
        <h2 className="text-[14.5px] font-extrabold tracking-tight">Raise one</h2>
        <form className="mt-3 space-y-3" onSubmit={submit} data-testid="branch-escalate-form">
          <div className="grid gap-2 sm:grid-cols-2">
            {KINDS.map(([value, label, blurb]) => (
              <label
                key={value}
                className={`flex cursor-pointer gap-2 rounded-xl border p-2.5 text-left ${
                  kind === value
                    ? 'border-slate-700 bg-axal-ground dark:border-slate-300'
                    : 'border-axal-hairline'
                }`}
              >
                <input
                  type="radio"
                  name="escalation-kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-[12px] font-bold">{label}</span>
                  <span className="mt-0.5 block text-[10.5px] text-axal-faint">{blurb}</span>
                </span>
              </label>
            ))}
          </div>
          <input
            className="w-full rounded-xl border border-axal-hairline bg-axal-ground p-2.5 text-[12.5px]"
            placeholder="What is this about?"
            value={subject}
            maxLength={300}
            onChange={(e) => setSubject(e.target.value)}
            data-testid="branch-escalate-subject"
          />
          <textarea
            className="w-full rounded-xl border border-axal-hairline bg-axal-ground p-2.5 text-[12.5px]"
            rows={3}
            placeholder="Anything HQ needs in order to decide (optional)"
            value={detail}
            maxLength={4000}
            onChange={(e) => setDetail(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!subject.trim() || sending}
              className="rounded-xl bg-slate-700 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50 dark:bg-slate-300 dark:text-slate-900"
            >
              {sending ? 'Raising…' : 'Raise to HQ'}
            </button>
            {/* SAID ON THE FORM, because it is the one thing about this screen
                that is different from every other branch write. */}
            <span className="text-[11px] text-axal-faint">
              This stays available while a licence is suspended — it is the appeal path.
            </span>
          </div>
          {sendError && (
            <p className="text-[12px] text-red-700 dark:text-red-300" data-testid="branch-escalate-error">
              {sendError}
            </p>
          )}
        </form>
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-[14.5px] font-extrabold tracking-tight">Raised from here</h2>
          {ready && <span className="text-[11.5px] text-axal-faint">as of {lane.as_of}</span>}
        </div>

        {lane === UNAVAILABLE && (
          <Unreadable
            what="The To-HQ lane"
            claim="This is not a claim that nothing was raised."
            onRetry={load}
          />
        )}
        {lane && lane !== UNAVAILABLE && !lane.available && (
          <p className="text-[12.5px] leading-relaxed text-axal-muted">
            <Unrecorded /> — {lane.reason}
          </p>
        )}
        {ready && items.length === 0 && (
          <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="branch-lane-empty">
            Nothing has been raised from this territory. The store exists and is empty, which is not
            the same as a lane that cannot be read.
          </p>
        )}

        {items.length > 0 && (
          <ul className="space-y-2" data-testid="branch-escalation-list">
            {items.map((it) => (
              <li
                key={it.id}
                className="rounded-xl border border-axal-hairline bg-axal-ground p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12px] font-bold">{it.subject}</div>
                    <div className="mt-0.5 text-[10.5px] text-axal-faint">
                      {it.kind.replace('_', ' ')} · raised {it.created_at}
                      {it.sla && SLA_LABEL[it.sla] ? ` · ${SLA_LABEL[it.sla]}` : ''}
                    </div>
                  </div>
                  <span className={STATUS_PILL[it.status] || STATUS_PILL.open}>{it.status}</span>
                </div>

                {/* NOT DELIVERED IS ITS OWN STATE, with the reason, because the
                    branch holds this row and HQ does not — nothing may count
                    it as an escalation HQ has. */}
                {it.status === 'undelivered' && (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-red-700 dark:text-red-300">
                    This has not reached HQ, so it is not on their queue. {it.delivery_error}
                  </p>
                )}

                {/* `bg-white dark:bg-slate-900`, not an `axal-` token: the
                    declared set is ground/hairline/ink/muted/faint and the
                    first draft invented `axal-surface`, which Tailwind v4
                    mints as nothing at all. The token guard caught it. */}
                {it.answer && (
                  <div className="mt-2 rounded-lg border border-axal-hairline bg-white p-2.5 dark:bg-slate-900">
                    <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
                      HQ&rsquo;s decision
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed">{it.answer}</p>
                    <p className="mt-1 text-[10.5px] text-axal-faint">
                      {it.answered_by_name || 'Axal VC HQ'} · {it.answered_at}
                      {it.pushed_at ? ` · received ${it.pushed_at}` : ''}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* THE SHAPE, STATED. A reader who expects a conversation should learn
            here that there is not one, rather than by looking for a reply box
            that does not exist. */}
        {ready && (
          <p className="mt-3 text-[11px] leading-relaxed text-axal-faint" data-testid="branch-answer-shape">
            {lane.answer_note}
          </p>
        )}
      </Card>

      {/* ── The four local queues, as one board (S3, D130) ── */}
      <Card className="p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14.5px] font-extrabold tracking-tight">The work board</h2>
          {boardReady && (
            <span className="text-[11.5px] text-axal-faint" data-testid="branch-board-summary">
              {boardItems.length} open · {pastCount} past SLA
            </span>
          )}
        </div>
        <p className="mb-3 text-[11.5px] leading-relaxed text-axal-muted">
          Four queues that were four consoles, ordered by what has waited longest. The board reads;
          each decision is still made in that queue&rsquo;s own console.
        </p>

        {board === UNAVAILABLE && (
          <Unreadable
            what="The work board"
            claim="This is not a claim that the queues are empty."
            onRetry={loadBoard}
          />
        )}
        {!board && <p className="text-[12px] text-axal-faint">Loading the queues…</p>}

        {boardReady && (
          <>
            {/* PER-LANE COUNTS, because a lane that answered 0 and a lane that
                could not be read are different facts and must not both render
                as a dash. */}
            <div className="mb-3 flex flex-wrap gap-1.5" data-testid="branch-board-lanes">
              {(board.lanes || []).map((ln) => (
                <span
                  key={ln.key}
                  className="rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-semibold"
                  data-testid={`branch-lane-${ln.key}`}
                >
                  {ln.label}{' '}
                  {ln.count === null
                    ? <Unrecorded reason="This queue could not be read, so its count is unknown rather than zero.">unreadable</Unrecorded>
                    : <span className="tabular-nums text-axal-muted">{ln.count}</span>}
                </span>
              ))}
            </div>

            {board.reason && (
              <p className="mb-3 text-[11.5px] leading-relaxed text-red-700 dark:text-red-300" data-testid="branch-board-gap">
                {board.reason}
              </p>
            )}

            <div className="mb-2 flex gap-1.5" data-testid="branch-board-views">
              {VIEWS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    view === key
                      ? 'bg-slate-700 text-white dark:bg-slate-300 dark:text-slate-900'
                      : 'border border-axal-hairline text-axal-muted'
                  }`}
                >
                  {label}
                  {key === 'past' ? ` (${pastCount})` : ''}
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="branch-board-empty">
                {view === 'past'
                  ? 'Nothing is past the 72-hour SLA.'
                  : 'All four queues are empty. They were read and hold nothing, which is not the same as a queue that could not be read.'}
              </p>
            ) : (
              <ul className="space-y-1.5" data-testid="branch-board-rows">
                {shown.map((it) => {
                  const console_ = LANE_CONSOLE[it.lane];
                  return (
                    <li
                      key={`${it.lane}:${it.id}`}
                      className={`rounded-xl border p-2.5 ${
                        it.sla === 'past'
                          ? 'border-red-300 bg-red-50/60 dark:border-red-500/40 dark:bg-red-500/5'
                          : it.sla === 'due_soon'
                            ? 'border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/5'
                            : 'border-axal-hairline'
                      }`}
                      data-sla={it.sla}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[12px] font-bold">{it.who}</span>
                        <span className="text-[10.5px] tabular-nums text-axal-faint">
                          {it.age_hours === null
                            ? <Unrecorded reason="This row's timestamp would not parse, so its age is unknown. It sorts last rather than first — an unknown age must not read as the most urgent thing here.">age unknown</Unrecorded>
                            : `${Math.round(it.age_hours)}h old`}
                          {SLA_LABEL[it.sla] ? ` · ${SLA_LABEL[it.sla]}` : ''}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-baseline gap-2 text-[11px] text-axal-muted">
                        <span>{it.what}</span>
                        {console_ ? (
                          <Link className="underline" to={console_.to}>{console_.label} →</Link>
                        ) : (
                          // THE LINK IS ABSENT BECAUSE THE PAGE IS. Stated on
                          // the row rather than pointed at a route that 404s.
                          <span className="text-axal-faint" data-testid="branch-board-no-console">
                            no console — the decision surface for moderation has not been built
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Card>
    </div>
    </BranchZone>
  );
}

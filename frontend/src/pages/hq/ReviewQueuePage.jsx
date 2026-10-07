import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ExternalLink, Inbox, RefreshCw } from 'lucide-react';
import { communityTasksApi } from '../../lib/api/communityTasks.js';
import { ticketReviewsApi } from '../../lib/api/ticketReviews.js';
import { reportError } from '../../lib/log';
import { RailFrame, WorkerRail } from '../../ui';
import { dayOf, priorityChip, typeChip } from '../../lib/ticketScreens';
import {
  AUDIENCES, DATE_WINDOWS, NO_QUEUE_FILTERS, QUEUE_TABS, approveCopy, approveLabel, audienceLabel,
  decisionOutcome, decisionRefusal, hasQueueFilters, queueView, reasonHint, reasonReady, rewardNote,
  tabCount, tabFromSearch, taskReward,
} from '../../lib/eadwynTickets';

/**
 * D606 (#1107) — HQ · Review queue, the Eadwyn Tickets canvas's T1 and T1b
 * (`design/canvases/integrated/Eadwyn Tickets Screen.dc.html`, screens
 * `queue-features` and `queue-tasks`). Super Admin only, as D544's routes are.
 *
 *   /hq/review            feature requests (T1)
 *   /hq/review?tab=tasks  suggested tasks, with the audience picker (T1b)
 *
 * WHAT IT READS. Both lists at once, so each tab carries its count: the
 * number waiting (`total`), withheld while loading and when a list cannot be
 * read, never shown as 0. The reward on a task's Approve comes from the
 * credit rules (`GET /api/community-tasks/rewards`), never from code: the
 * Super Admin edits that amount.
 *
 * WHERE IT DEPARTS FROM THE CANVAS, and why (D606):
 *   - Approve asks for a reason too. The Worker records a typed reason of at
 *     least ten characters with every decision, approvals included (D544).
 *   - "Asked by" is a name and an email, not a link: there is no page for
 *     one account to link to. The Team directory is one row away in the
 *     sidebar.
 *   - The confirm panels open on the item they decide, rather than below
 *     the list, so a decision is never made on the wrong row.
 */

function Chip({ chip }) {
  if (!chip) return null;
  return <span className={chip.className}>{chip.text}</span>;
}

const BTN = {
  approve: 'flex-1 rounded-[9px] bg-axal-violet px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50',
  decline: 'flex-1 rounded-[9px] border border-red-200 bg-white px-3 py-2 text-[12.5px] font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/40',
  quiet: 'rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[12.5px] font-semibold text-axal-ink transition-colors hover:border-axal-violet/40 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
  declineSolid: 'rounded-[9px] bg-red-700 px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50',
  approveSolid: 'rounded-[9px] bg-axal-violet px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50',
};
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink placeholder:text-axal-faint focus:outline-none focus:ring-2 focus:ring-axal-violet/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const SELECT = 'rounded-full border border-axal-hairline bg-white px-3 py-1.5 text-[12px] font-medium text-axal-ink focus:outline-none focus:ring-2 focus:ring-axal-violet/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** The canvas's two confirm panels, on the item they decide. */
export function DecisionPanel({ kind, tab, item, audience, reward, busy, error, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const approving = kind === 'approve';
  const hint = reasonHint(reason);
  const ready = reasonReady(reason) && !busy;
  const id = `review-reason-${tab}-${item.id ?? item.ticket_id}`;
  return (
    <div
      data-testid={`review-${kind}-panel`}
      className={`mt-3 overflow-hidden rounded-xl border ${approving ? 'border-violet-200 dark:border-violet-900' : 'border-red-200 dark:border-red-900'}`}
    >
      <div className={`px-4 py-2.5 font-display text-[13.5px] font-bold ${approving ? 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-950/40 dark:text-violet-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>
        {approving ? 'Approve · confirm' : 'Decline · reason required'}
      </div>
      <div className="flex flex-col gap-2.5 px-4 py-3 text-[13px] leading-relaxed">
        {approving ? (
          <>
            <span className="text-axal-ink dark:text-gray-100">{approveCopy(tab, item, { audience, reward })}</span>
            {tab === 'tasks' && (
              <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="review-approve-audience">
                Audience: {audienceLabel(audience)}
                {reward?.state === 'on' ? ` · suggester ${item.asked_by?.name || 'with no name on record'} receives +${reward.credits} credits` : ''}
              </span>
            )}
          </>
        ) : (
          <span className="text-axal-muted dark:text-gray-300">The user sees this reason on their ticket.</span>
        )}
        <label htmlFor={id} className="text-[11px] font-semibold text-axal-muted dark:text-gray-400">
          {approving ? 'Why approve? Recorded with the decision; the requester is not sent it.' : 'Reason'}
        </label>
        <textarea
          id={id}
          rows={3}
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Type the reason…"
          className={`${FIELD} min-h-[60px] resize-y`}
          data-testid="review-reason"
        />
        {hint && <span className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="review-reason-hint">{hint}</span>}
        {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid="review-decision-error">{error}</p>}
        <div className="flex justify-end gap-1.5">
          <button type="button" onClick={onCancel} disabled={busy} className={BTN.quiet}>Cancel</button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => onConfirm(reason.trim())}
            className={approving ? BTN.approveSolid : BTN.declineSolid}
            data-testid={`review-${kind}-confirm`}
          >
            {busy ? 'Saving…' : approving ? approveLabel(tab, reward) : 'Decline'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One waiting request: its text, who asked, and the two decisions. */
export function QueueItem({ tab, item, reward, outcome, onDecide }) {
  const [open, setOpen] = useState(null); // 'approve' | 'decline' | null
  const [audience, setAudience] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const key = item.id ?? item.ticket_id;
  const note = tab === 'tasks' ? rewardNote(reward) : null;
  const decide = async (kind, reason) => {
    setBusy(true);
    setError(null);
    try {
      await onDecide({ kind, item, reason, audience });
      setOpen(null);
    } catch (e) {
      setError(decisionRefusal(e));
    } finally {
      setBusy(false);
    }
  };
  const asker = item.asked_by || {};
  return (
    <article
      data-testid={`review-item-${key}`}
      className="rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex flex-col gap-4 md:flex-row md:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="font-display text-[15px] font-bold text-axal-ink dark:text-gray-100">{item.title || 'Untitled request'}</h3>
            <Chip chip={priorityChip(item.priority)} />
            <Chip chip={typeChip(tab === 'tasks' ? 'task' : 'feature')} />
          </div>
          {item.body
            ? <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-[#4a4553] dark:text-gray-300">{item.body}</p>
            : <p className="text-[13px] italic text-axal-muted dark:text-gray-400">No text was filed with it.</p>}
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-[11.5px] text-axal-muted dark:text-gray-400">
            <span data-testid="review-asked-by">
              Asked by {asker.name || 'an account with no name on record'}
              {asker.email ? ` · ${asker.email}` : ''}
              {!asker.user_id ? ' (no account)' : ''}
            </span>
            <span>{dayOf(item.created_at) || 'Date not recorded'}</span>
            {item.github_issue_url
              ? (
                <a href={item.github_issue_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-axal-violet-deep hover:underline dark:text-violet-300">
                  GitHub {item.github_issue_number ? `#${item.github_issue_number}` : 'issue'} <ExternalLink size={11} aria-hidden="true" />
                </a>
              )
              : <span>Not on the GitHub tracker</span>}
          </div>
        </div>

        <div className="flex flex-col gap-2 md:w-[300px] md:shrink-0">
          {outcome ? (
            <p
              role="status"
              data-testid="review-outcome"
              className={`rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed ${outcome.decision === 'approved'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
            >
              {outcome.text}
            </p>
          ) : (
            <>
              {tab === 'tasks' && (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-axal-muted dark:text-gray-400">Publish to</span>
                  <select
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    disabled={busy}
                    className={FIELD}
                    data-testid="review-audience"
                  >
                    {AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </label>
              )}
              <div className="flex gap-1.5">
                <button type="button" onClick={() => { setOpen('approve'); setError(null); }} disabled={busy} aria-expanded={open === 'approve'} className={BTN.approve} data-testid="review-approve">
                  {approveLabel(tab, reward)}
                </button>
                <button type="button" onClick={() => { setOpen('decline'); setError(null); }} disabled={busy} aria-expanded={open === 'decline'} className={BTN.decline} data-testid="review-decline">
                  Decline…
                </button>
              </div>
              {note && <p className="text-[11.5px] leading-snug text-axal-muted dark:text-gray-400" data-testid="review-reward-note">{note}</p>}
            </>
          )}
        </div>
      </div>
      {open && !outcome && (
        <DecisionPanel
          key={open}
          kind={open}
          tab={tab}
          item={item}
          audience={audience}
          reward={reward}
          busy={busy}
          error={error}
          onCancel={() => { setOpen(null); setError(null); }}
          onConfirm={(reason) => decide(open, reason)}
        />
      )}
    </article>
  );
}

function SkeletonItems() {
  return (
    <div className="flex flex-col gap-3" data-testid="review-loading" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-4 py-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-800" />
          <div className="h-2.5 w-[92%] rounded-full bg-axal-ground dark:bg-gray-800/60" />
        </div>
      ))}
    </div>
  );
}

/** The list for one tab, in every state the canvas draws. */
export function QueueList({ tab, read, reward, filters, page, onPage, onClearFilters, outcomes, onDecide, onRetry, now }) {
  if (!read || read.status === 'loading') return <SkeletonItems />;
  if (read.status !== 'ready') {
    return (
      <div role="alert" data-testid="review-unreadable" className="flex flex-col gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 dark:border-red-900 dark:bg-red-950/40">
        <span className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">Unreadable</span>
        <span className="text-[12.5px] leading-relaxed text-red-700 dark:text-red-300">
          The queue could not be read. The count on the tab is withheld, not zero.
        </span>
        <button type="button" onClick={onRetry} className="inline-flex w-fit items-center gap-1 text-[12px] font-semibold text-red-700 underline dark:text-red-300">
          <RefreshCw size={12} aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }
  const items = read.data?.items || [];
  const view = queueView(items, { filters, page, total: read.data?.total, now });
  if (!items.length) {
    return (
      <div data-testid="review-empty" className="rounded-xl border border-axal-hairline bg-white px-4 py-3.5 text-[12.5px] leading-relaxed text-axal-muted dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
        {tab === 'tasks' ? 'No suggested tasks are waiting for review.' : 'No feature requests are waiting for review.'}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[12px] text-axal-muted dark:text-gray-400">
        <span data-testid="review-count">{view.label}</span>
        {view.partial && <span data-testid="review-partial">{view.partial}</span>}
      </div>
      {!view.rows.length ? (
        <div data-testid="review-no-match" className="rounded-xl border border-axal-hairline bg-white px-4 py-3.5 text-[12.5px] text-axal-muted dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          Nothing waiting matches these filters.{' '}
          <button type="button" onClick={onClearFilters} className="font-semibold text-axal-violet-deep underline dark:text-violet-300">Clear the filters</button>
        </div>
      ) : view.rows.map((item) => {
        const key = item.id ?? item.ticket_id;
        return <QueueItem key={key} tab={tab} item={item} reward={reward} outcome={outcomes[key]} onDecide={onDecide} />;
      })}
      {view.pages > 1 && (
        <nav aria-label="Queue pages" className="flex items-center justify-end gap-2 text-[12px]">
          <button type="button" disabled={view.page <= 1} onClick={() => onPage(view.page - 1)} className={BTN.quiet}>Previous</button>
          <span className="font-mono text-axal-muted dark:text-gray-400">Page {view.page} of {view.pages}</span>
          <button type="button" disabled={view.page >= view.pages} onClick={() => onPage(view.page + 1)} className={BTN.quiet}>Next</button>
        </nav>
      )}
    </div>
  );
}

const READERS = { features: () => ticketReviewsApi.features(), tasks: () => ticketReviewsApi.tasks() };
const LOADING = { status: 'loading' };

export default function ReviewQueuePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = tabFromSearch(location.search);
  const [reads, setReads] = useState({ features: LOADING, tasks: LOADING });
  const [rewards, setRewards] = useState(LOADING);
  const [filters, setFilters] = useState(NO_QUEUE_FILTERS);
  const [page, setPage] = useState(1);
  // A decision stays on its card until the next read, so its outcome is seen.
  const [outcomes, setOutcomes] = useState({ features: {}, tasks: {} });

  const load = useCallback(() => {
    setReads({ features: LOADING, tasks: LOADING });
    setOutcomes({ features: {}, tasks: {} });
    for (const key of Object.keys(READERS)) {
      READERS[key]().then(
        (data) => setReads((r) => ({ ...r, [key]: { status: 'ready', data } })),
        (e) => { reportError(`ReviewQueue:${key}`, e); setReads((r) => ({ ...r, [key]: { status: 'unreadable', message: e?.message || '' } })); },
      );
    }
    setRewards(LOADING);
    communityTasksApi.rewards().then(
      (data) => setRewards({ status: 'ready', data }),
      (e) => { reportError('ReviewQueue:rewards', e); setRewards({ status: 'unreadable' }); },
    );
  }, []);
  useEffect(() => { load(); }, [load]);

  const selectTab = (id) => {
    setPage(1);
    navigate(id === 'tasks' ? '/hq/review?tab=tasks' : '/hq/review');
  };
  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };

  const reward = useMemo(() => taskReward(rewards), [rewards]);

  const onDecide = useCallback(async ({ kind, item, reason, audience }) => {
    const decision = kind === 'approve' ? 'approved' : 'declined';
    let res;
    if (tab === 'tasks') {
      res = kind === 'approve'
        ? await ticketReviewsApi.approveTask(item.id, { audience, reason })
        : await ticketReviewsApi.declineTask(item.id, reason);
    } else {
      res = kind === 'approve'
        ? await ticketReviewsApi.approveFeature(item.ticket_id, reason)
        : await ticketReviewsApi.declineFeature(item.ticket_id, reason);
    }
    const key = item.id ?? item.ticket_id;
    setOutcomes((o) => ({ ...o, [tab]: { ...o[tab], [key]: { decision, text: decisionOutcome(tab, decision, res) } } }));
  }, [tab]);

  // A tab's count is the number still waiting: decided rows leave it at once.
  const count = (id) => {
    const n = tabCount(reads[id]);
    return n === null ? null : Math.max(0, n - Object.keys(outcomes[id] || {}).length);
  };
  const coverage = [
    ...QUEUE_TABS.map((t) => {
      const n = count(t.id);
      return n === null ? null : `${t.label}: ${n} waiting`;
    }),
    reward.state === 'on' ? `An approved task pays ${reward.credits} credits` : null,
  ].filter(Boolean);

  return (
    <RailFrame
      rail={(
        <WorkerRail
          workspace="Review queue"
          role="super_admin"
          stance="Read-only; every decision is yours"
          note="Feature requests and suggested tasks waiting for the Super Admin, read from D544's store. Eadwyn approves or declines nothing."
          coverage={coverage}
          coverageNote={coverage.length ? undefined : 'Loading…'}
          data-testid="review-queue-rail"
        />
      )}
      data-testid="review-queue-page"
    >
      <div className="min-w-0">
        <header>
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <Inbox size={13} aria-hidden="true" /> HQ · Support
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Review queue</h1>
          <p className="mt-1 max-w-[720px] text-[13.5px] leading-relaxed text-axal-muted dark:text-gray-400">
            Feature requests and suggested tasks filed from the Eadwyn chat. Approve sends a feature to the build queue;
            approving a task publishes it and rewards the suggester.{' '}
            <Link to="/admin/hq-support" className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Support queues</Link>
            {' · '}
            <Link to="/admin/credit-rules" className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Credit rules</Link>
          </p>
        </header>

        <div role="tablist" aria-label="Review queue" className="mt-4 flex gap-1 border-b border-axal-hairline dark:border-gray-800">
          {QUEUE_TABS.map((t) => {
            const on = t.id === tab;
            const n = count(t.id);
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on ? 'true' : 'false'}
                onClick={() => selectTab(t.id)}
                data-testid={`review-tab-${t.id}`}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors ${on
                  ? 'border-axal-violet text-axal-violet-deep dark:text-violet-300'
                  : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
              >
                {t.label}
                {n !== null && <span className="ml-1.5 font-mono text-[11px] opacity-75" data-testid={`review-tab-count-${t.id}`}>{n}</span>}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-axal-hairline bg-white px-4 py-2.5 dark:border-gray-800 dark:bg-gray-900">
          <input
            type="search"
            value={filters.query}
            onChange={(e) => setFilter('query', e.target.value)}
            placeholder="Search titles…"
            aria-label="Search titles"
            className={`${FIELD} min-w-[200px] flex-1`}
            data-testid="review-search"
          />
          <select value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)} aria-label="Priority" className={SELECT} data-testid="review-priority">
            <option value="">All priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select value={filters.window} onChange={(e) => setFilter('window', e.target.value)} aria-label="Date" className={SELECT} data-testid="review-date">
            {DATE_WINDOWS.map((w) => <option key={w.id || 'any'} value={w.id}>{w.label}</option>)}
          </select>
          {hasQueueFilters(filters) && (
            <button type="button" onClick={() => { setFilters(NO_QUEUE_FILTERS); setPage(1); }} className="px-2 text-[12px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">
              Clear
            </button>
          )}
        </div>

        <section className="mt-4" aria-live="polite">
          <QueueList
            tab={tab}
            read={reads[tab]}
            reward={reward}
            filters={filters}
            page={page}
            onPage={setPage}
            onClearFilters={() => { setFilters(NO_QUEUE_FILTERS); setPage(1); }}
            outcomes={outcomes[tab] || {}}
            onDecide={onDecide}
            onRetry={load}
          />
        </section>

        <p className="mt-4 text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400">
          A decision is recorded once. A second decision on the same request is refused, never applied twice.
        </p>
      </div>
    </RailFrame>
  );
}

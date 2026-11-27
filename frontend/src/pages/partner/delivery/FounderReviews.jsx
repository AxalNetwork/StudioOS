import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { Unrecorded, Unreadable } from '../../../ui';
import { Section } from '../kit';

/**
 * Delivery · Health — Founder reviews (D390).
 *
 * WHERE THIS CAME FROM. `/partner/operations/performance` and
 * `/partner/operations/portfolio` were the only pages that read
 * `engagement_reviews` for a partner, and both retire (D304). Health is the
 * page that decides whether an engagement is going well, and it already holds
 * the firm's own satisfaction remark; the review is the other side of that —
 * what the FOUNDER recorded — so it belongs beside it rather than on a page of
 * its own.
 *
 * A REVIEW IS THE COUNTERPARTY'S, AND ONLY THEIRS IS SHOWN. `reviewer_role` is
 * on every row; a partner's review of a founder is not evidence about the
 * partner's work, so only `founder` rows count here. Nothing on this page can
 * write one: a founder leaves it after the engagement is delivered.
 *
 * BOUNDED, AND IT SAYS SO. There is no list-all-reviews route, so this reads
 * the most recent completed engagements one by one (`REVIEW_WINDOW` of them) —
 * the same bound the retired page used. When the firm has more, the footnote
 * names the window rather than presenting a partial set as the whole.
 *
 * A FAILED READ IS NOT "NO REVIEWS". If the engagement list fails the section
 * is Unreadable with a retry. If some engagements' reviews fail, the rest
 * still draw and the section counts the ones it could not read, because a
 * silently skipped engagement is a review a reader was told does not exist.
 */

export const REVIEW_WINDOW = 12;
export const COMPLETED = ['delivered', 'reviewed', 'invoiced'];

function formatDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Most recent first, by the day the work was delivered. */
function byDelivered(a, b) {
  return String(b.delivered_at || b.updated_at || '').localeCompare(String(a.delivered_at || a.updated_at || ''));
}

/**
 * Read the reviews for the signed-in firm. Returns `{ reviews, completed, unread }` — `completed` is
 * how many completed engagements the firm has (so the window can be named),
 * `unread` how many of the windowed ones failed to read.
 */
export async function readFounderReviews(client = api) {
  // ONE FIRM'S ENGAGEMENTS, NAMED BY ITS OWN ROW. GET /engagements narrows a
  // partner to `e.partner_id = users.partner_id`, but an admin gets every
  // engagement on the platform — and Health renders for an admin whose sign-in
  // is attached to a firm. So the firm is read first and the list is filtered to
  // it here; without the filter an admin would see every firm's reviews under
  // one firm's heading.
  const [me, eng] = await Promise.all([client.partnerPortal.getProfile(), client.listEngagements()]);
  const firmId = Number(me?.partner?.id);
  const done = (eng?.items || [])
    .filter((e) => Number(e.partner_id) === firmId && COMPLETED.includes(e.status))
    .sort(byDelivered);
  const windowed = done.slice(0, REVIEW_WINDOW);
  const reviews = [];
  let unread = 0;
  for (const e of windowed) {
    try {
      const r = await client.listEngagementReviews(e.id);
      for (const rv of r?.items || []) {
        if (rv.reviewer_role === 'founder') reviews.push({ ...rv, engagement: e });
      }
    } catch {
      unread += 1;
    }
  }
  reviews.sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
  return { reviews, completed: done.length, unread };
}

function Stars({ value }) {
  const n = Math.max(0, Math.min(5, Math.round(Number(value))));
  return (
    <span className="text-amber-500" aria-label={`${value} out of 5`}>
      {'★'.repeat(n)}<span className="text-gray-300 dark:text-gray-600">{'★'.repeat(5 - n)}</span>
    </span>
  );
}

/** The section as it draws, from a load state — no requests. */
export function FounderReviewsView({ state, onRetry }) {
  let body;
  if (state.status === 'loading') {
    body = <p className="text-sm text-gray-500 dark:text-gray-400">Reading founder reviews…</p>;
  } else if (state.status === 'unreadable') {
    body = (
      <Unreadable
        what="Founder reviews"
        claim="This is not a claim that no founder has reviewed your work."
        onRetry={onRetry}
      />
    );
  } else {
    const { reviews, completed, unread } = state.data;
    const rated = reviews.filter((r) => Number.isFinite(Number(r.rating)) && r.rating !== null);
    const average = rated.length ? rated.reduce((a, r) => a + Number(r.rating), 0) / rated.length : null;
    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm" data-testid="founder-reviews-summary">
          <span>
            <span className="text-gray-500 dark:text-gray-400">Average rating </span>
            {average === null
              ? <Unrecorded reason="No founder has left a rated review on these engagements." />
              : <strong className="tabular-nums">{average.toFixed(1)} / 5</strong>}
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            {reviews.length} review{reviews.length === 1 ? '' : 's'} across the {Math.min(completed, REVIEW_WINDOW)} most recent
            completed engagement{Math.min(completed, REVIEW_WINDOW) === 1 ? '' : 's'}
          </span>
        </div>
        {unread > 0 && (
          <p role="alert" className="text-xs text-red-700 dark:text-red-300" data-testid="founder-reviews-unread">
            The reviews on {unread} engagement{unread === 1 ? '' : 's'} could not be read, so they are missing
            from this list rather than absent.
            {onRetry && <button type="button" className="ml-1 underline" onClick={onRetry}>Retry</button>}
          </p>
        )}
        {reviews.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400" data-testid="founder-reviews-none">
            {completed === 0
              ? 'No engagement is completed yet. A founder can review the work once it is marked delivered.'
              : 'No founder has reviewed these engagements yet. Reviews are the founder’s to leave; nothing here can write one.'}
          </p>
        ) : (
          <ul className="space-y-2" data-testid="founder-reviews-list">
            {reviews.map((r) => (
              <li key={r.id ?? r.uid} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">
                    {r.engagement?.need_title || r.engagement?.project_name || <Unrecorded>Untitled engagement</Unrecorded>}
                  </span>
                  <span className="shrink-0">
                    {r.rating === null || r.rating === undefined ? <Unrecorded>Not rated</Unrecorded> : <Stars value={r.rating} />}
                  </span>
                </div>
                {r.comment && <p className="mt-1.5 text-sm text-gray-700 dark:text-gray-300">“{r.comment}”</p>}
                <div className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                  {[r.engagement?.founder_name || r.engagement?.project_name, formatDay(r.created_at)].filter(Boolean).join(' · ')}
                </div>
              </li>
            ))}
          </ul>
        )}
        {completed > REVIEW_WINDOW && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400" data-testid="founder-reviews-window">
            Read from your {REVIEW_WINDOW} most recently delivered engagements of {completed}; older reviews are not shown here.
          </p>
        )}
      </div>
    );
  }
  return (
    <div data-testid="founder-reviews">
      <Section title="Founder reviews">{body}</Section>
    </div>
  );
}

export default function FounderReviews() {
  const [state, setState] = useState({ status: 'loading' });
  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', data: await readFounderReviews() });
    } catch (e) {
      setState({ status: 'unreadable', message: e?.message });
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return <FounderReviewsView state={state} onRetry={load} />;
}

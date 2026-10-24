/**
 * Admin — referral review queue.
 *
 * Replaces the former Stripe Connect payout queue (approve → fire transfer).
 * There is no money to move any more: reviewing a referral means moving it
 * through the pipeline and writing back the three things the referrer actually
 * sees on their side — the next step, the reward label, and the fit notes.
 *
 * Every status change appends a timeline row server-side, so the referrer's
 * detail drawer shows real history rather than a single "last updated".
 *
 * D953 (#2371): the queue now lives at Programs › Refer & Earn › Queue, which
 * mounts `ReferralReviewBody`; `/admin/refer-earn` only redirects there.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../lib/shellRole';
import { NOT_RECORDED } from '../../lib/absence';
import AdminBoardFrame from './AdminBoardFrame';
import {
  CAPS, HQ_READS_COMMISSIONS, NOTHING_WAITING, REFERRALS_EMPTY, openReferrals, refusalText,
} from './programs/programsModel';

const STATUSES = [
  'submitted', 'under_review', 'more_info_needed', 'qualified',
  'in_conversation', 'converted', 'reward_eligible', 'reward_issued',
  'rejected', 'closed',
];

const LABELS = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  more_info_needed: 'More info needed',
  qualified: 'Qualified',
  in_conversation: 'In conversation',
  converted: 'Converted',
  reward_eligible: 'Reward eligible',
  reward_issued: 'Reward issued',
  rejected: 'Rejected',
  closed: 'Closed',
};

/** The open statuses, merged: the Refer & Earn Queue's default view (D953 §3). */
const OPEN = 'open';

export const REVIEW_SAVED = 'Referral updated. The referrer sees it on their page.';

/**
 * The review console's body. Mounted alone by this file's default export, and
 * by Programs › Refer & Earn › Queue (D953), which passes `embedded` (the
 * program header replaces this heading) and `open`: the three open-status
 * reads Overview counts, so the Queue's default rows and the tab's count are
 * one set. Every other chip reads its own status, 200 rows at a time.
 *
 * N6, fixed in both halves: a failed read never also says the queue is empty,
 * and a referrer with no name or email reads "Not recorded", never the
 * submission's id. The commissions door is drawn for a Super Admin only,
 * because that route is `hqOnly`.
 */
export function ReferralReviewBody({ embedded = false, open = null } = {}) {
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  const [own, setOwn] = useState({ loading: true, error: '', rows: [] });
  const [filter, setFilter] = useState(open ? OPEN : '');
  const [openUid, setOpenUid] = useState(null);
  const [done, setDone] = useState('');
  const merged = filter === OPEN && open ? openReferrals(open.sets) : null;

  const load = useCallback(async () => {
    if (filter === OPEN) return;
    setOwn((c) => ({ ...c, loading: true, error: '' }));
    try {
      const data = await api.adminReferralSubmissions({ ...(filter ? { status: filter } : {}), limit: CAPS.referrals });
      if (!Array.isArray(data)) throw new Error('The referrals did not come back as a list.');
      setOwn({ loading: false, error: '', rows: data });
    } catch (e) {
      setOwn({ loading: false, error: e?.message || 'Could not load the review queue.', rows: [] });
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const reload = () => { if (merged) open.reload(); else load(); };
  const loading = merged ? merged.state === 'loading' : own.loading;
  const error = merged
    ? (merged.state === 'unreadable' ? 'One of the open statuses could not be read, so the open referrals are not listed.' : '')
    : own.error;
  const rows = merged ? (merged.state === 'ready' ? merged.rows : []) : own.rows;
  const full = merged ? merged.state === 'ready' && merged.capped : rows.length >= CAPS.referrals;
  const chips = open ? [OPEN, '', ...STATUSES] : ['', ...STATUSES];
  const chipLabel = (s) => (s === OPEN ? 'Open' : s ? LABELS[s] : 'All');
  const emptyLine = filter === OPEN
    ? `${NOTHING_WAITING} ${REFERRALS_EMPTY}`
    : filter ? `No referral is ${LABELS[filter].toLowerCase()} now.` : 'No referral has been submitted yet.';
  const fullLine = filter === OPEN
    ? 'The newest 200 in each open status. Older ones are not listed here.'
    : filter ? 'The newest 200 in this status. Older ones are not listed here.' : 'The newest 200, in every status. Older ones are not listed here.';

  return (
    <div className={embedded ? 'space-y-5' : 'p-6 max-w-6xl mx-auto space-y-5'} data-testid="admin-referral-review">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {embedded ? null : <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Referral review</h1>}
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Move referrals through the pipeline. What you write here is what the referrer sees.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* D569 — the other referral programme's ledger. A sign-up with a
              partner's code accrues commissions there, and its payouts are
              processed there; this queue settles its rewards off-platform.
              D953: that route is hqOnly, so the door is the Super Admin's. */}
          {superAdmin ? (
            <Link
              to="/admin/commissions"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              data-testid="link-admin-commissions"
            >
              Commissions and payouts
            </Link>
          ) : (
            <span className="text-sm text-gray-600 dark:text-gray-400" data-testid="referral-review-commissions-hq">{HQ_READS_COMMISSIONS}</span>
          )}
          <button
            type="button"
            onClick={reload}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {chips.map((s) => (
          <button
            key={s || 'all'}
            type="button"
            aria-pressed={filter === s}
            onClick={() => { setFilter(s); setOpenUid(null); }}
            data-testid={`referral-review-chip-${s || 'all'}`}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              filter === s
                ? 'bg-violet-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {chipLabel(s)}
          </button>
        ))}
      </div>

      {done ? (
        <p role="status" className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm font-semibold text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200" data-testid="referral-review-done">{done}</p>
      ) : null}

      {error ? (
        <div className="flex flex-wrap items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300" role="alert" data-testid="referral-review-error">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error} That is not the same as none.
          <button type="button" onClick={reload} className="font-semibold underline">Try again</button>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 size={16} className="animate-spin" /> Reading…
        </div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400" data-testid="referral-review-empty">
          {emptyLine}
        </p>
      ) : (
        <>
          {full ? <p className="text-xs font-semibold text-amber-800 dark:text-amber-300" data-testid="referral-review-full">{fullLine}</p> : null}
          <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900" data-testid="referral-review-rows">
            {rows.map((r) => (
              <li key={r.uid} className="p-4" data-testid={`referral-review-row-${r.uid}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {r.referred_name}
                      {r.referred_org ? <span className="font-normal text-gray-500 dark:text-gray-400"> · {r.referred_org}</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400" data-testid={`referral-review-row-${r.uid}-meta`}>
                      {r.category_name} · {LABELS[r.status] || r.status} · from {r.referrer_name || r.referrer_email || NOT_RECORDED}
                    </p>
                    {r.context && (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600 dark:text-gray-400">{r.context}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenUid(openUid === r.uid ? null : r.uid)}
                    className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200"
                    data-testid={`referral-review-open-${r.uid}`}
                  >
                    {openUid === r.uid ? 'Close' : 'Review'}
                  </button>
                </div>
                {openUid === r.uid && (
                  <ReviewForm
                    row={r}
                    onDone={() => { setDone(REVIEW_SAVED); setOpenUid(null); reload(); }}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** One referral's review. A refusal is one sentence under its own Save, keyed on its code (D953 §3). */
function ReviewForm({ row, onDone }) {
  const [status, setStatus] = useState(row.status);
  const [nextStep, setNextStep] = useState(row.next_step || '');
  const [rewardLabel, setRewardLabel] = useState(row.reward_label || '');
  const [fitNotes, setFitNotes] = useState(row.fit_notes || '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState('');

  const save = async () => {
    setSaving(true);
    setRefusal('');
    try {
      await api.adminReferralReview(row.uid, { status, nextStep, rewardLabel, fitNotes, note });
      onDone();
    } catch (e) {
      setRefusal(refusalText(e, e?.message || 'Could not update that referral.'));
    } finally {
      setSaving(false);
    }
  };

  const cls =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';

  return (
    <div className="mt-3 space-y-2 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50" data-testid={`referral-review-form-${row.uid}`}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-700 dark:text-gray-300">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={cls}>
            {STATUSES.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-700 dark:text-gray-300">Reward label</span>
          <input value={rewardLabel} onChange={(e) => setRewardLabel(e.target.value)} className={cls} placeholder="Eligible on acceptance" />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-gray-700 dark:text-gray-300">Next step</span>
        <input value={nextStep} onChange={(e) => setNextStep(e.target.value)} className={cls} placeholder="Cohort interview scheduled Aug 14" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-gray-700 dark:text-gray-300">Fit notes (visible to the referrer)</span>
        <textarea value={fitNotes} onChange={(e) => setFitNotes(e.target.value)} rows={2} className={cls} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-gray-700 dark:text-gray-300">Timeline note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={cls} placeholder="Appended to the history the referrer sees" />
      </label>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {refusal ? <p role="alert" className="m-0 text-sm font-semibold text-red-700 dark:text-red-300" data-testid={`referral-review-refusal-${row.uid}`}>{refusal}</p> : null}
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          data-testid={`referral-review-save-${row.uid}`}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// D774 (#2100): S9 drew no rail. The board's page, in the Admin boards' frame.
export default function ReferralReview() {
  return (
    <AdminBoardFrame workspace="Referrals" note="Eadwyn reads the referrals waiting here. A referral is approved or rejected only when you do it." data-testid="admin-board-referrals">
      <ReferralReviewBody />
    </AdminBoardFrame>
  );
}

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
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../components/useToast';

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

export default function ReferralReview() {
  const { showToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [openUid, setOpenUid] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.adminReferralSubmissions(filter ? { status: filter } : {});
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message || 'Could not load the review queue.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5" data-testid="admin-referral-review">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Referral review</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Move referrals through the pipeline. What you write here is what the referrer sees.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {['', ...STATUSES].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              filter === s
                ? 'bg-violet-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {s ? LABELS[s] : 'All'}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
          Nothing in this queue.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
          {rows.map((r) => (
            <li key={r.uid} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {r.referred_name}
                    {r.referred_org ? <span className="font-normal text-gray-500"> · {r.referred_org}</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {r.category_name} · {LABELS[r.status] || r.status} · from {r.referrer_name || r.referrer_email || `user ${r.uid}`}
                  </p>
                  {r.context && (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600 dark:text-gray-400">{r.context}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setOpenUid(openUid === r.uid ? null : r.uid)}
                  className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200"
                >
                  {openUid === r.uid ? 'Close' : 'Review'}
                </button>
              </div>
              {openUid === r.uid && (
                <ReviewForm
                  row={r}
                  onDone={(msg) => { showToast(msg, 'success'); setOpenUid(null); load(); }}
                  onError={(msg) => showToast(msg, 'error')}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewForm({ row, onDone, onError }) {
  const [status, setStatus] = useState(row.status);
  const [nextStep, setNextStep] = useState(row.next_step || '');
  const [rewardLabel, setRewardLabel] = useState(row.reward_label || '');
  const [fitNotes, setFitNotes] = useState(row.fit_notes || '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.adminReferralReview(row.uid, { status, nextStep, rewardLabel, fitNotes, note });
      onDone('Referral updated.');
    } catch (e) {
      onError(e?.message || 'Could not update that referral.');
    } finally {
      setSaving(false);
    }
  };

  const cls =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';

  return (
    <div className="mt-3 space-y-2 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
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
      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

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
 *
 * D962 (#2795, PG9q, PG9d): the Queue reads part 4's paged list with its
 * total (D957), opening on the open statuses, waiting longest first, 25 a
 * page. A row opens the referral as a dialog, which reads its timeline from
 * the single-referral read, offers only D957's allowed moves, sends `status`
 * only when it moved, and shows its result in place. There is no toast.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, PhoneRows, usePhoneWidth } from '../../ui';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../lib/shellRole';
import AdminBoardFrame from './AdminBoardFrame';
import { BlockFailed, CARD, DIALOG_BODY, DialogButtons, EYE, FIELD_LABEL, Field, INPUT, Pill, SUB, Skeleton, TD, TH } from './programs/parts';
import { useRead } from './programs/useProgramReads';
import {
  CATEGORY_WORD, LIMITS, PAGE_SIZE, QUEUE_OPEN, QUEUE_STATUSES, REVIEW_SAVED as SAVED, REVIEW_TOLD, categoryWord, countLine,
  queueParams, queueStatusWord, refusalSentence, reviewPatch, shortDay, statusChoices, statusWord, timelineRow,
} from './programs/programPagesModel';
import { HQ_READS_COMMISSIONS, NOTHING_WAITING, NOT_RECORDED, REFERRALS_EMPTY, ageText, hoursSince, isReady } from './programs/programsModel';

export const REVIEW_SAVED = SAVED;

const STATUS_TONE = { more_info_needed: 'amber', qualified: 'violet', in_conversation: 'violet', converted: 'green', reward_eligible: 'green', reward_issued: 'green', rejected: 'red', closed: 'muted' };

const referrer = (r) => [r.referrer_name || r.referrer_email || NOT_RECORDED, r.your_role].filter(Boolean).join(' · ');
const referred = (r) => [r.referred_name || NOT_RECORDED, r.referred_org].filter(Boolean).join(' · ');

function paged(reply) {
  if (!Array.isArray(reply?.items) || !Number.isFinite(Number(reply?.total))) throw new Error('The referrals did not come back with a total.');
  return reply;
}

/**
 * The review console's body: Programs › Refer & Earn › Queue mounts it with
 * `embedded` (the program header replaces this heading) and `onChanged`,
 * which re-reads the tab's count after a save. The commissions door is drawn
 * for a Super Admin only, because that route is `hqOnly`.
 */
export function ReferralReviewBody({ embedded = false, onChanged } = {}) {
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  const phone = usePhoneWidth();
  const [status, setStatus] = useState(QUEUE_OPEN);
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('oldest');
  const [page, setPage] = useState(0);
  const [tick, setTick] = useState(0);
  const [openUid, setOpenUid] = useState(null);
  const params = queueParams({ status, category, sort, page });
  const what = JSON.stringify(params);
  const list = useRead('referrals:queue', what, tick, true, () => api.adminReferralSubmissions(params).then(paged));
  const reload = () => { setTick((t) => t + 1); onChanged?.(); };
  const now = Date.now();
  const rows = isReady(list) ? list.data.items : [];
  const total = isReady(list) ? Number(list.data.total) : null;
  const pages = total === null ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE));
  const reset = (fn) => (e) => { fn(e.target.value); setPage(0); };
  const emptyLine = status === QUEUE_OPEN ? `${NOTHING_WAITING} ${REFERRALS_EMPTY}` : 'No referral matches these filters.';

  return (
    <div className={embedded ? 'flex flex-col gap-4' : 'mx-auto flex max-w-6xl flex-col gap-4 p-6'} data-testid="admin-referral-review">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {embedded ? null : <h1 className="m-0 text-2xl font-bold text-axal-ink dark:text-gray-100">Referral review</h1>}
          <p className={`m-0 ${SUB}`}>Move referrals through the pipeline. What you write here is what the referrer sees.</p>
        </div>
        {/* D569 — the other referral programme's ledger, which is hqOnly: the door is the Super Admin's. */}
        {superAdmin ? (
          <Link to="/admin/commissions" className="text-[12.5px] font-bold text-axal-violet dark:text-violet-300" data-testid="link-admin-commissions">Commissions and payouts</Link>
        ) : <span className={SUB} data-testid="referral-review-commissions-hq">{HQ_READS_COMMISSIONS}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="referral-review-toolbar">
        <select className={INPUT} value={status} onChange={reset(setStatus)} aria-label="Status" data-testid="referral-review-status">
          {QUEUE_STATUSES.map((x) => <option key={x} value={x}>{`Status: ${queueStatusWord(x)}`}</option>)}
        </select>
        <select className={INPUT} value={category} onChange={reset(setCategory)} aria-label="Category" data-testid="referral-review-category">
          <option value="">Every category</option>
          {Object.entries(CATEGORY_WORD).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
        </select>
        <select className={INPUT} value={sort} onChange={reset(setSort)} aria-label="Sort" data-testid="referral-review-sort">
          <option value="oldest">Sort: Waiting longest</option>
          <option value="newest">Sort: Newest</option>
        </select>
      </div>

      {list.status === 'loading' ? <Skeleton lines={4} testId="referral-review-loading" /> : null}
      {list.status === 'error' ? <BlockFailed what="The referrals" onRetry={reload} testId="referral-review-error" /> : null}
      {isReady(list) ? (
        <>
          <p className="m-0 font-mono text-[12px] font-semibold text-axal-muted dark:text-gray-400" data-testid="referral-review-count">{countLine(page * PAGE_SIZE, rows.length, total)}</p>
          {!rows.length ? <p className={`m-0 ${SUB}`} data-testid="referral-review-empty">{emptyLine}</p> : null}
          {rows.length && phone ? (
            <PhoneRows groups={[{ label: null, rows: rows.map((r) => ({
              key: r.uid, title: referred(r), description: `${categoryWord(r.category)} · ${statusWord(r.status)} · ${ageText(hoursSince(r.created_at, now)) || NOT_RECORDED}`,
              onClick: () => setOpenUid(r.uid), testid: `referral-review-row-${r.uid}`,
            })) }]} />
          ) : null}
          {rows.length && !phone ? (
            <div className={`${CARD} overflow-x-auto`}>
              <table className="w-full min-w-[960px] border-collapse text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="referral-review-rows">
                <thead>
                  <tr className="border-b border-axal-hairline dark:border-gray-700">
                    {['Referred', 'Category', 'Referrer', 'Status', 'Next step', 'Waiting', ''].map((h) => <th key={h || 'open'} className={TH}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const h = hoursSince(r.created_at, now);
                    return (
                      <tr key={r.uid} className="border-b border-axal-hairline last:border-0 dark:border-gray-800" data-testid={`referral-review-row-${r.uid}`}>
                        <td className={`${TD} font-bold`}>{referred(r)}</td>
                        <td className={TD}>{categoryWord(r.category)}</td>
                        <td className={TD} data-testid={`referral-review-row-${r.uid}-meta`}>{referrer(r)}</td>
                        <td className={TD}><Pill tone={STATUS_TONE[r.status] || 'muted'}>{statusWord(r.status)}</Pill></td>
                        <td className={TD}>{r.next_step || '—'}</td>
                        <td className={`${TD} font-mono`}>{ageText(h) || NOT_RECORDED}</td>
                        <td className={`${TD} text-right`}>
                          <button type="button" onClick={() => setOpenUid(r.uid)} className="rounded-[9px] border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold hover:bg-axal-ground dark:border-gray-700 dark:hover:bg-gray-800" data-testid={`referral-review-open-${r.uid}`}>Open</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {pages > 1 ? (
            <div className="flex items-center justify-end gap-2 text-[12px]">
              <button type="button" className="rounded-[9px] border border-axal-hairline px-2.5 py-1 font-semibold disabled:opacity-50 dark:border-gray-700" disabled={page <= 0} onClick={() => setPage(page - 1)}>Previous</button>
              <span className={SUB}>{`Page ${page + 1} of ${pages}`}</span>
              <button type="button" className="rounded-[9px] border border-axal-hairline px-2.5 py-1 font-semibold disabled:opacity-50 dark:border-gray-700" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} data-testid="referral-review-next">Next</button>
            </div>
          ) : null}
          <p className={`m-0 ${SUB}`}>This tab replaces Referral review; the Approvals lane Refer & Earn reviews opens it. A row opens the referral.</p>
        </>
      ) : null}
      {openUid ? <ReferralDialog uid={openUid} onClose={() => setOpenUid(null)} onSaved={reload} /> : null}
    </div>
  );
}

/**
 * PG9d: one referral, opened. Its timeline is the single-referral read's,
 * and a save replaces it with the `history` the PATCH returns.
 */
export function ReferralDialog({ uid, onClose, onSaved }) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => {
    let live = true;
    api.adminReferralSubmission(uid).then(
      (data) => {
        if (!live) return;
        setRead({ status: 'ready', data });
        setDraft({ status: data.status, nextStep: data.next_step || '', rewardLabel: data.reward_label || '', fitNotes: data.fit_notes || '', note: '' });
      },
      (error) => { if (live) setRead({ status: 'error', data: null, error }); },
    );
    return () => { live = false; };
  }, [uid]);
  const row = read.data;
  const patch = row && draft ? reviewPatch(row, draft) : null;
  const set = (k) => (v) => { setDone(''); setDraft((d) => ({ ...d, [k]: v })); };
  const save = async () => {
    if (!patch) return;
    setBusy(true);
    setRefusal('');
    try {
      const next = await api.adminReferralReview(uid, patch);
      // The timeline is replaced with the history the PATCH returns, and the form starts from the saved row.
      setRead({ status: 'ready', data: { ...row, ...next, history: Array.isArray(next?.history) ? next.history : row.history } });
      setDraft({ status: next?.status || draft.status, nextStep: next?.next_step || '', rewardLabel: next?.reward_label || '', fitNotes: next?.fit_notes || '', note: '' });
      setDone(SAVED);
      onSaved?.();
    } catch (e) {
      setRefusal(refusalSentence(e, 'That referral was not saved. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const label = row ? referred(row) : 'Referral';
  const sub = row ? `${categoryWord(row.category)} · referred by ${referrer(row)}` : null;
  return (
    <Lightbox label={label} title={label} sub={sub} onClose={onClose} width={640} testId="referral-dialog"
      footer={read.status === 'ready' ? <DialogButtons onClose={onClose} action="Save changes" busy={busy} disabled={!patch} onAction={save} refusal={refusal} testId="referral-dialog-save" /> : null}>
      <div className={DIALOG_BODY}>
        {read.status === 'loading' ? <Skeleton lines={4} /> : null}
        {read.status === 'error' ? <p role="alert" className="m-0 text-[13px] font-semibold text-red-700 dark:text-red-300" data-testid="referral-dialog-unreadable">{refusalSentence(read.error, 'This referral could not be read. That is not the same as none.')}</p> : null}
        {read.status === 'ready' && draft ? (
          <>
            {done ? <p role="status" className="m-0 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3.5 py-2.5 text-[13px] font-semibold text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="referral-dialog-done">{done}</p> : null}
            <section className="flex flex-col gap-1.5" data-testid="referral-dialog-timeline">
              <span className={EYE}>Timeline</span>
              {(row.history || []).length ? (
                <ul className="m-0 flex list-none flex-col p-0">
                  {row.history.map((e, i) => {
                    const t = timelineRow(e);
                    return (
                      <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-axal-hairline py-1.5 first:border-t-0 dark:border-gray-700" data-testid={`referral-dialog-event-${i}`}>
                        <span className="flex flex-col">
                          <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{t.label}</span>
                          {t.note ? <span className={SUB}>{t.note}</span> : null}
                        </span>
                        <span className="font-mono text-[12px] font-semibold text-axal-muted dark:text-gray-400">{t.when}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : <span className={SUB}>No status has been recorded yet.</span>}
            </section>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Status</span>
              <select className={`${INPUT} w-full`} value={draft.status} onChange={(e) => set('status')(e.target.value)} data-testid="referral-dialog-status">
                {statusChoices(row.status).map((x) => <option key={x} value={x}>{x === row.status ? `${statusWord(x)} · now` : statusWord(x)}</option>)}
              </select>
              {statusChoices(row.status).length === 1 ? <span className={SUB}>This referral is final. Its notes can still be edited.</span> : null}
            </label>
            <Field label="Next step" value={draft.nextStep} onChange={set('nextStep')} max={LIMITS.nextStep} testId="referral-dialog-next" />
            <Field label="Reward · a note, never an amount" value={draft.rewardLabel} onChange={set('rewardLabel')} max={LIMITS.reward} testId="referral-dialog-reward" />
            <Field label="Fit notes · the referrer sees them" value={draft.fitNotes} onChange={set('fitNotes')} max={LIMITS.fitNotes} rows={3} testId="referral-dialog-fit" />
            <Field label="Note to the referrer" value={draft.note} onChange={set('note')} max={LIMITS.note} rows={3} sub="Added to the timeline the referrer sees." testId="referral-dialog-note" />
            <p className={`m-0 ${SUB}`} data-testid="referral-dialog-told">{REVIEW_TOLD}</p>
            {row.created_at ? <p className={`m-0 ${SUB}`}>{`Submitted ${shortDay(row.created_at) || NOT_RECORDED}.`}</p> : null}
          </>
        ) : null}
      </div>
    </Lightbox>
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

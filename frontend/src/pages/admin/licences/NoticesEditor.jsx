/**
 * #4707 — the HQ licence page's compliance notices. Moved out of `AdminLicences.jsx`
 * unchanged when the page was split by domain; the comments below are the
 * original ones.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, Check, X, Send } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { useReasonDialog } from '../LicenceReasonDialog';
import { LICENCE_REASONS } from '../licenceReasonModel';
import { FREEZING_STATUSES, NOTICE_KINDS, daysTo, noticeKindLabel, noticeRank } from '../../../lib/notices';
import { NOTICE_TONE, RESPOND_DAYS, Chip } from './licenceShared';

/* ------------------------------------------------------------------ *
 * Notices — the compliance ladder, from HQ's end                       *
 * ------------------------------------------------------------------ */

// D136 — D135 built the whole ladder and gave it no door: `licenceNotices`,
// `licenceNoticeIssue` and `licenceNoticeReview` shipped with zero callers, so
// issuing a notice meant SQL — and the sweep runs every minute, which means a
// notice issued that way would freeze an account whose only screen said nothing
// about why. This is HQ's end of it.
//
// ACCEPT AND REJECT ARE DISABLED UNTIL THE ADDRESSEE HAS ANSWERED, rather than
// offered and refused. The server answers 409 `not_responded` every time, which
// is D134's `still_an_admin` one route over: a UI that offers a button the
// server always refuses teaches the operator that its buttons are advisory.
//
// AND THE ADDRESSEE IS A PICKER, NOT A TEXT BOX. `POST /notices` resolves the
// email against `licence_admins` and 404s `not_an_administrator` for anyone
// else, so a free-text field would be a field whose wrong answers are only
// discoverable by submitting. The options are this licence's own administrators.
export function NoticesEditor({ licence, onSaved }) {
  // D4707 — reasons are asked for in a labelled dialog, never window.prompt.
  const [reasonDialog, ask] = useReasonDialog();
  const [items, setItems] = useState(undefined);
  const [holders, setHolders] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [admins, setAdmins] = useState(undefined);
  const [form, setForm] = useState({
    email: '', kind: 'renewal_terms', subject: '', body: '', respond_days: String(RESPOND_DAYS.def),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [lastReview, setLastReview] = useState(null);

  const load = useCallback(() => {
    setLoadErr(null);
    api.licenceNotices(licence.uid)
      .then((d) => {
        // `notices_available: false` arrives with a 200 and an empty array, so
        // the UNREADABLE state has to be read off the flag rather than off the
        // length — otherwise a database that has not applied migration 264
        // renders "no notices", which is a claim about the licence that nothing
        // measured. Same null-means-unreadable contract as AdminsEditor.
        if (d?.notices_available === false) {
          setItems(null);
          setLoadErr(d.notices_reason || 'The notices could not be read.');
          setHolders(null);
          return;
        }
        setItems(Array.isArray(d?.items) ? d.items : []);
        setHolders(Number.isFinite(Number(d?.freeze_holders)) ? Number(d.freeze_holders) : null);
      })
      .catch((e) => {
        reportError('AdminLicences:licenceNotices', e);
        setItems(null);
        setLoadErr(e?.message || 'The notices could not be read.');
      });
    // The addressee picker's options. Its own failure is its own state: a
    // notices list that reads fine beside an administrator list that does not
    // is a real combination, and collapsing the two would hide one of them.
    api.licenceAdmins(licence.uid)
      .then((d) => setAdmins(Array.isArray(d?.items) ? d.items : []))
      .catch((e) => { reportError('AdminLicences:noticeAddressees', e); setAdmins(null); });
  }, [licence.uid]);
  useEffect(load, [load]);

  const refresh = () => { load(); onSaved?.(); };

  async function run(fn) {
    setBusy(true); setErr(null);
    try { await fn(); refresh(); }
    catch (e) { reportError('AdminLicences:noticeAction', e); setErr(e?.message || 'That did not go through.'); }
    finally { setBusy(false); }
  }

  // WORST FIRST, and "worst" means frozen rather than newest. A notice holding
  // an account frozen is the only kind anybody has to do something about, so it
  // sorts above one waiting on HQ, which sorts above one waiting on the
  // addressee, which sorts above the closed ones. Inside a band, oldest first:
  // the longest-frozen account is the one furthest down the ladder.
  const sorted = useMemo(() => {
    if (!Array.isArray(items)) return items;
    return [...items].sort((a, b) => {
      const r = noticeRank(a.status) - noticeRank(b.status);
      if (r !== 0) return r;
      return String(a.froze_at || a.respond_by || '')
        .localeCompare(String(b.froze_at || b.respond_by || ''));
    });
  }, [items]);

  const days = Number(form.respond_days);
  const canIssue = form.email.trim().length > 0
    && form.subject.trim().length >= 3
    && form.body.trim().length >= 10
    && Number.isFinite(days) && days >= RESPOND_DAYS.min && days <= RESPOND_DAYS.max;

  return (
    <div data-testid="licence-notices">
      {reasonDialog}
      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Compliance notices</h3>
      <p className="mt-1 text-[11px] text-gray-500">
        A notice is the first rung: the administrator is told what is wrong and by when to answer.
        A deadline that passes unanswered freezes their account and suspends this licence — writes
        stop, reading does not. Answering lifts the freeze; you accept or reject afterwards.
        Terminating is never automatic and is the button at the top of this page.
      </p>

      {items === undefined && <p className="mt-3 text-sm text-gray-500">Loading…</p>}
      {items === null && (
        <p data-testid="licence-notices-unreadable" className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          {loadErr} This is not the same as there being none — nothing was read.
        </p>
      )}
      {Array.isArray(items) && items.length === 0 && (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          No notice has been issued against this licence.
        </p>
      )}

      {holders !== null && holders > 0 && (
        <p data-testid="licence-freeze-holders" className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertTriangle size={13} className="mr-1.5 -mt-0.5 inline" />
          {holders === 1
            ? 'One notice is holding this licence frozen.'
            : `${holders} notices are holding this licence frozen.`}{' '}
          Accepting one is not enough — the freeze lifts when the last of them is answered and accepted.
        </p>
      )}

      {lastReview && (
        <p data-testid="licence-notice-reviewed" className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          Recorded as <strong className="font-semibold">{lastReview.status}</strong>.{' '}
          {lastReview.reinstated
            ? 'That was the last one holding it, so the licence is active again.'
            : `${lastReview.freeze_holders} notice${lastReview.freeze_holders === 1 ? '' : 's'} still holding the freeze.`}
        </p>
      )}

      {Array.isArray(sorted) && sorted.length > 0 && (
        <ul className="mt-3 space-y-2">
          {sorted.map((n) => {
            const reviewable = n.status === 'responded';
            const frozenDays = FREEZING_STATUSES.has(n.status) ? daysTo(n.froze_at) : null;
            const due = daysTo(n.respond_by);
            return (
              <li key={n.uid} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{n.subject}</div>
                    <div className="text-xs text-gray-500">
                      {n.name || n.email} · {noticeKindLabel(n.kind)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={NOTICE_TONE[n.status]}>{String(n.status || '').replace(/_/g, ' ')}</Chip>
                    <button
                      type="button" disabled={busy || !reviewable}
                      onClick={async () => {
                        const note = await ask(LICENCE_REASONS.acceptNotice);
                        if (note === null) return;
                        run(async () => {
                          const res = await api.licenceNoticeReview(licence.uid, n.uid, { decision: 'accept', note });
                          setLastReview(res);
                        });
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-green-300 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-40"
                    >
                      <Check size={12} /> Accept
                    </button>
                    <button
                      type="button" disabled={busy || !reviewable}
                      onClick={async () => {
                        const note = await ask(LICENCE_REASONS.rejectNotice);
                        if (note === null) return;
                        run(async () => {
                          const res = await api.licenceNoticeReview(licence.uid, n.uid, { decision: 'reject', note });
                          setLastReview(res);
                        });
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                    >
                      <X size={12} /> Reject
                    </button>
                  </div>
                </div>

                <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{n.body}</p>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                  <span>
                    Due {String(n.respond_by || '').slice(0, 10)}
                    {due === null ? '' : due < 0 ? ` · ${Math.abs(due)} days overdue` : ` · in ${due} days`}
                  </span>
                  {/* THE ONLY CLOCK ON THIS SCREEN, and it counts UP from the
                      freeze rather than down to anything. There is no second
                      deadline: HQ decides when an account has had long enough,
                      and a countdown would imply the platform decides. */}
                  {frozenDays !== null && (
                    <span data-testid="licence-notice-frozen-for" className="font-medium text-rose-700">
                      Frozen since {String(n.froze_at || '').slice(0, 10)} · {Math.abs(frozenDays)} days
                    </span>
                  )}
                  {n.responded_at && <span>Answered {String(n.responded_at).slice(0, 10)}</span>}
                  {n.reviewed_at && <span>Reviewed {String(n.reviewed_at).slice(0, 10)}</span>}
                </div>

                {n.response
                  ? (
                    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2.5 dark:border-gray-800 dark:bg-gray-900">
                      <div className="text-[11px] font-medium text-gray-500">Their response</div>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">{n.response}</p>
                    </div>
                  )
                  : (
                    <p className="mt-2 text-[11px] text-gray-500">
                      Accept and Reject are available once the administrator has answered — there is
                      nothing to review until they have.
                    </p>
                  )}

                {n.review_note && (
                  <p className="mt-2 text-[11px] text-gray-500">Your note: {n.review_note}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Issue a notice</div>
        {admins === undefined && <p className="mt-1 text-[11px] text-gray-500">Loading administrators…</p>}
        {admins === null && (
          <p data-testid="licence-notice-addressees-unreadable" className="mt-1 text-[11px] text-gray-600">
            The administrator list could not be read, so there is nobody to address. That is not the
            same as this licence having none.
          </p>
        )}
        {Array.isArray(admins) && admins.length === 0 && (
          <p className="mt-1 text-[11px] text-gray-600">
            Nobody administers this licence, so a notice would have nobody to act on it. Appoint an
            administrator first.
          </p>
        )}
        {Array.isArray(admins) && admins.length > 0 && (
          <>
            <p className="mt-1 text-[11px] text-gray-500">
              The addressee has to be an administrator of this licence — the freeze lands on their
              account, so a notice to anyone else would have no remedy behind it.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <select
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
              >
                <option value="">Who is this for…</option>
                {admins.map((a) => (
                  <option key={a.user_id} value={a.email}>{a.name ? `${a.name} — ${a.email}` : a.email}</option>
                ))}
              </select>
              <select
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
              >
                {NOTICE_KINDS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
              {/* A COUNT OF DAYS, NEVER A DATE PICKER. `respond_by` is computed
                  server-side as `datetime('now', '+N days')` so the deadline and
                  the sweep that reads it share one format and one clock; a date
                  input would say the browser sets the deadline, in the reader's
                  own zone, which is the timestamp defect this repo keeps fixing. */}
              <input
                type="number" min={RESPOND_DAYS.min} max={RESPOND_DAYS.max} value={form.respond_days}
                onChange={(e) => setForm((f) => ({ ...f, respond_days: e.target.value }))}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
                aria-label="Days to respond"
              />
            </div>
            <input
              type="text" placeholder="Subject — what this is about, in a line" value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
            />
            <textarea
              rows={4} maxLength={5000}
              placeholder="What is wrong and what would settle it. At least 10 characters — this is what they act on, and what a tribunal reads afterwards."
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
            />
            <button
              type="button" disabled={busy || !canIssue}
              onClick={() => run(async () => {
                await api.licenceNoticeIssue(licence.uid, {
                  email: form.email, kind: form.kind, subject: form.subject.trim(),
                  body: form.body.trim(), respond_days: Number(form.respond_days),
                });
                setForm({
                  email: '', kind: 'renewal_terms', subject: '', body: '',
                  respond_days: String(RESPOND_DAYS.def),
                });
              })}
              className="mt-2 inline-flex items-center gap-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <><Send size={14} /> Issue notice</>}
            </button>
            <p className="mt-2 text-[11px] text-gray-500">
              Between {RESPOND_DAYS.min} and {RESPOND_DAYS.max} days to answer. The clock starts now,
              and the administrator is emailed and told in the app.
            </p>
          </>
        )}
      </div>

      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <p className="mt-3 text-[11px] text-gray-500">
        Issuing and reviewing need a recent TOTP step-up as well as the Super Admin elevation, so a
        403 can mean &quot;step up and try again&quot; rather than &quot;you may not&quot;.
      </p>
    </div>
  );
}

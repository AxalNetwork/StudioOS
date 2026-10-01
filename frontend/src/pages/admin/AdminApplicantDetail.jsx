// D384 — one applicant's application, opened under their row in the Cohort
// Cycles tab (AdminCohortApplications). It shows what the applicant answered,
// schedules or cancels their partner interview, and declines with the note the
// applicant will read.
//
// TWO NOTES, KEPT APART ON PURPOSE. The decision `reason` is required,
// audited and internal — it holds system text too ("Legacy admin decision",
// capacity roll-forwards) and is never shown to the applicant. The applicant
// note and asks are written for them, and are what their status screen prints.
// The form labels both so an admin cannot type one believing it is the other.
import React, { useState } from 'react';
import { ORIGIN_OPTIONS, TTO_OPTIONS, IP_OPTIONS, whenOf, dayOf } from '../../lib/applicationLifecycle';

const nameOf = (list, key) => list.find((o) => o.key === key)?.name || null;
const inputCls = 'w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm text-gray-900 dark:text-gray-100';
const btn = 'px-2.5 py-1 rounded-lg text-xs font-semibold disabled:opacity-50';

/** The applicant's answers, as rows an admin reads; absent answers say why. */
export function answerRows(a) {
  if (a.withdrawn_at) return { note: `Withdrawn ${dayOf(a.withdrawn_at) || ''}. The applicant's answers were deleted.`.replace(' .', '.'), rows: [] };
  if (a.answers_recorded === false) return { note: 'Applied before the form asked about origin, team and traction.', rows: [] };
  if (!a.answers) return { note: 'The answers could not be read.', rows: [] };
  const x = a.answers;
  const rows = [
    ['Origin', nameOf(ORIGIN_OPTIONS, x.origin)],
    ['Institution', [x.institution, x.research_group].filter(Boolean).join(' · ') || null],
    ['Tech-transfer status', nameOf(TTO_OPTIONS, x.tto_status)],
    ['IP', x.ip?.length ? x.ip.map((k) => IP_OPTIONS.find((o) => o.key === k)?.label || k).join(', ') : null],
    ['Team size', x.team_size != null ? String(x.team_size) : null],
    ['Roles', x.team_roles],
    ['Commercial lead', x.commercial_lead == null ? null : x.commercial_lead ? 'Yes' : 'Not yet'],
    ['Traction', x.traction],
    ['Why Axal VC', x.why_axal],
  ];
  return { note: null, rows: rows.map(([k, v]) => [k, v == null || v === '' ? 'Not answered' : v]) };
}

export default function ApplicantDetail({ applicant, canDecide, busy, onSchedule, onCancelInterview, onDeclineWithNote }) {
  const a = applicant;
  const iv = a.interview && a.interview.status === 'scheduled' ? a.interview : null;
  const [when, setWhen] = useState('');
  const [duration, setDuration] = useState('30');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [applicantNote, setApplicantNote] = useState(a.applicant_note || '');
  const [asks, setAsks] = useState((a.applicant_asks || []).join('\n'));
  const { note: answersNote, rows } = answerRows(a);
  const open = ['pending', 'waitlisted'].includes(a.status) && !a.withdrawn_at;

  const schedule = (e) => {
    e.preventDefault();
    const d = when ? new Date(when) : null;
    if (!d || Number.isNaN(d.getTime())) return;
    onSchedule({ scheduled_at: d.toISOString(), duration_min: Number(duration) || 30, location: location.trim(), note: note.trim() });
  };
  const decline = (e) => {
    e.preventDefault();
    if (!reason.trim()) return;
    onDeclineWithNote({
      reason: reason.trim(),
      applicant_note: applicantNote.trim(),
      applicant_asks: asks.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    });
  };

  return (
    <div className="mt-2 mb-1 rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 space-y-4 text-sm" data-testid={`applicant-detail-${a.id}`}>
      <div>
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Answers</div>
        {answersNote ? <div className="mt-1 text-gray-600 dark:text-gray-300" data-testid="applicant-answers-note">{answersNote}</div> : (
          <dl className="mt-1 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1">
            {rows.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
                <dd className="m-0 text-gray-800 dark:text-gray-100 whitespace-pre-line break-words">{v}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
      </div>

      <div>
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Partner interview</div>
        {iv ? (
          <div className="mt-1 text-gray-800 dark:text-gray-100" data-testid="applicant-interview">
            {whenOf(iv.scheduled_at) || iv.scheduled_at} · {iv.duration_min} min{iv.location ? ` · ${iv.location}` : ''}
            {iv.reschedule_requested_at ? (
              <div className="mt-1 text-amber-700 dark:text-amber-300" data-testid="applicant-reschedule-request">
                Asked to move it {dayOf(iv.reschedule_requested_at) || ''}: “{iv.reschedule_reason}”. Schedule a new time below.
              </div>
            ) : null}
            <button type="button" disabled={busy} onClick={onCancelInterview} className={`${btn} mt-2 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30`}>Cancel interview</button>
          </div>
        ) : <div className="mt-1 text-gray-600 dark:text-gray-300">None scheduled.</div>}
        {open ? (
          <form onSubmit={schedule} className="mt-2 grid gap-2 sm:grid-cols-[1fr_90px_1fr]" data-testid="interview-form">
            <input type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} className={inputCls} aria-label="Interview time (your local time)" />
            <input type="number" min={10} max={240} value={duration} onChange={(e) => setDuration(e.target.value)} className={inputCls} aria-label="Minutes" />
            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Video link or place" className={inputCls} maxLength={300} />
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the applicant should know (they will read this)" className={`${inputCls} sm:col-span-3`} maxLength={2000} />
            <button type="submit" disabled={busy || !when} className={`${btn} sm:col-span-3 justify-self-start bg-violet-600 text-white hover:bg-violet-700`}>
              {iv ? 'Replace the interview' : 'Schedule interview'}
            </button>
          </form>
        ) : null}
      </div>

      {canDecide && open ? (
        <form onSubmit={decline} className="space-y-2" data-testid="decline-form">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Decline with a note</div>
          <label className="block">
            <span className="text-xs text-gray-600 dark:text-gray-300">Note to the applicant — they read this on their status screen</span>
            <textarea rows={3} value={applicantNote} onChange={(e) => setApplicantNote(e.target.value)} className={inputCls} maxLength={2000} />
          </label>
          <label className="block">
            <span className="text-xs text-gray-600 dark:text-gray-300">What we would want to see — up to three, one per line (the applicant reads these)</span>
            <textarea rows={3} value={asks} onChange={(e) => setAsks(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-xs text-gray-600 dark:text-gray-300">Internal reason — required, audited, never shown to the applicant</span>
            <input type="text" required value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
          </label>
          <button type="submit" disabled={busy || !reason.trim()} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>Decline</button>
        </form>
      ) : null}
    </div>
  );
}

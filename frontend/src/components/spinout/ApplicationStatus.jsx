import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CalendarPlus, Compass, Loader2 } from 'lucide-react';
import {
  phaseOf, timelineFor, statusLede, dayOf, whenOf, interviewIcs, icsHref,
} from '../../lib/applicationLifecycle';
import { LAB_CONTACT_HREF } from '../../lib/spinoutLab';

/**
 * The Spin-Out Lab application status (D384) — the Apply & Status canvas's P2
 * artboard, drawn from `/state`'s `applicant` block (D383).
 *
 * What the canvas draws that no store holds, and what this does instead:
 *  - The interviewer's name and bio ("Joris van Dijk · Partner"): the
 *    interview row has no interviewer. The card names the time, length,
 *    place and the team's own note — nothing else.
 *  - Screening dates and a "decision by" date: not stored. Those stages carry
 *    no date rather than an invented one.
 *  - "Customer discovery templates · Download the pack": there is no pack.
 *    The one while-you-wait card is the Programme Brief, which exists.
 *  - The application reference ("MERIDIAN-C7-0142"): the application's own
 *    number is printed instead.
 */

const V = {
  done: 'bg-violet-600 text-white border-violet-600',
  now: 'bg-violet-50 text-violet-700 border-violet-600 ring-4 ring-violet-500/10 dark:bg-violet-500/15 dark:text-violet-300',
  next: 'bg-white text-gray-500 border-gray-200 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700',
};

export function ApplicationTimeline({ stages }) {
  return (
    <ol className="grid gap-4 sm:grid-cols-4" data-testid="application-timeline">
      {stages.map((s, i) => (
        <li key={s.key} data-testid={`stage-${s.key}`} data-state={s.state} className="min-w-0">
          <div className="flex items-center">
            <span className={`w-[26px] h-[26px] flex-none rounded-full border-[1.5px] flex items-center justify-center font-mono text-[11px] font-bold ${V[s.state]}`}>
              {s.state === 'done' ? <Check size={13} aria-hidden="true" /> : i + 1}
            </span>
            {i < stages.length - 1 ? (
              <span className={`hidden sm:block flex-1 h-[2px] ml-2 ${s.state === 'done' ? 'bg-violet-600' : 'bg-gray-200 dark:bg-gray-700'}`} aria-hidden="true" />
            ) : null}
          </div>
          <div className={`mt-2 text-[13px] ${s.state === 'now' ? 'font-extrabold text-gray-900 dark:text-gray-50' : 'font-semibold text-gray-600 dark:text-gray-300'}`}>
            {s.name}{s.state === 'now' ? <span className="sr-only"> (current stage)</span> : null}
          </div>
          {s.date ? <div className={`text-[12px] tabular-nums ${s.state === 'now' ? 'text-violet-700 dark:text-violet-300' : 'text-gray-500 dark:text-gray-400'}`}>{s.date}</div> : null}
          {s.note ? <p className="mt-1 mb-0 text-[12px] leading-snug text-gray-500 dark:text-gray-400">{s.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function InterviewCard({ interview, company, onReschedule, busy }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const href = icsHref(interviewIcs(interview, { company }));
  const requested = dayOf(interview.reschedule_requested_at);
  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) return;
    const ok = await onReschedule(reason.trim());
    if (ok) { setAsking(false); setReason(''); }
  };
  return (
    <section data-testid="interview-card" className="rounded-[18px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <div className="text-[11px] font-bold uppercase tracking-[.08em] text-violet-700 dark:text-violet-300">Your interview</div>
      <div className="mt-2 text-[17px] font-extrabold text-gray-900 dark:text-gray-50 tabular-nums">
        {whenOf(interview.scheduled_at) || 'The time could not be read'}
      </div>
      <div className="mt-1 text-[13px] text-gray-600 dark:text-gray-300">
        {interview.duration_min} minutes{interview.location ? ` · ${interview.location}` : ''}
      </div>
      {interview.note ? <p className="mt-3 mb-0 text-[13.5px] leading-relaxed text-gray-700 dark:text-gray-200">{interview.note}</p> : null}
      {requested ? (
        <p className="mt-3 mb-0 text-[13px] text-amber-800 dark:text-amber-300" data-testid="reschedule-requested">
          You asked to move this on {requested}. It stays at this time until the team sends a new one.
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {href ? (
          <a href={href} download="axal-interview.ics" data-testid="interview-ics"
            className="inline-flex items-center gap-2 h-10 px-4 rounded-[10px] bg-violet-600 hover:bg-violet-700 text-white text-[13.5px] font-bold">
            <CalendarPlus size={15} aria-hidden="true" /> Add to calendar
          </a>
        ) : null}
        {!asking ? (
          <button type="button" onClick={() => setAsking(true)} data-testid="interview-reschedule"
            className="h-10 px-4 rounded-[10px] border border-gray-300 dark:border-gray-600 text-[13.5px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
            Reschedule
          </button>
        ) : null}
      </div>
      {asking ? (
        <form onSubmit={submit} className="mt-4" data-testid="reschedule-form">
          <label className="block text-[12.5px] font-semibold text-gray-700 dark:text-gray-300 mb-1.5" htmlFor="reschedule-reason">
            What time would work, or why this one does not
          </label>
          <textarea id="reschedule-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-[10px] text-[14px] bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100" />
          <div className="mt-2 flex gap-2">
            <button type="submit" disabled={busy || !reason.trim()}
              className="h-9 px-4 rounded-[10px] bg-violet-600 text-white text-[13px] font-bold disabled:opacity-60">
              {busy ? <Loader2 className="animate-spin" size={14} /> : 'Ask to move it'}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="h-9 px-3 text-[13px] font-semibold text-gray-600 dark:text-gray-300">Cancel</button>
          </div>
          <p className="mt-2 mb-0 text-[12px] text-gray-500 dark:text-gray-400">This asks the team. The interview does not move until they send a new time.</p>
        </form>
      ) : null}
    </section>
  );
}

export function DeclinedPanel({ applicant }) {
  const note = applicant.note;
  const reapply = applicant.reapply;
  return (
    <section data-testid="declined-panel" className="rounded-[18px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <h2 className="m-0 text-[20px] font-extrabold text-gray-900 dark:text-gray-50">Not this cohort</h2>
      {note ? (
        <>
          <p className="mt-2 mb-0 text-[14px] leading-relaxed text-gray-700 dark:text-gray-200 whitespace-pre-line" data-testid="declined-note">{note.text}</p>
          {note.asks?.length ? (
            <>
              <div className="mt-4 text-[13px] font-bold text-gray-800 dark:text-gray-100">What we would want to see</div>
              <ul className="mt-2 mb-0 pl-5 list-disc text-[13.5px] text-gray-700 dark:text-gray-200 space-y-1" data-testid="declined-asks">
                {note.asks.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </>
          ) : null}
        </>
      ) : (
        <p className="mt-2 mb-0 text-[14px] leading-relaxed text-gray-600 dark:text-gray-300" data-testid="declined-no-note">
          The team did not write a note for you with this decision. Ask a programme manager and they will tell you why.
        </p>
      )}
      <div className="mt-5 rounded-xl bg-violet-50/60 dark:bg-violet-500/10 border border-violet-100 dark:border-violet-500/20 p-4">
        <div className="text-[12px] font-bold uppercase tracking-[.06em] text-violet-700 dark:text-violet-300">Reapply window</div>
        {reapply ? (
          <div className="mt-1 text-[14px] font-semibold text-gray-900 dark:text-gray-100" data-testid="reapply-window">
            {reapply.label} cohort · applications close {dayOf(reapply.closes_at) || reapply.closes_at}
          </div>
        ) : (
          <div className="mt-1 text-[13.5px] text-gray-600 dark:text-gray-300">The next window could not be worked out. Applications open each month.</div>
        )}
        <p className="mt-1 mb-0 text-[12.5px] text-gray-600 dark:text-gray-300">You can apply again. A new application starts from a fresh form.</p>
      </div>
      <a href={LAB_CONTACT_HREF} className="mt-4 inline-flex text-[13px] font-semibold text-violet-700 dark:text-violet-300">Talk to a programme manager →</a>
    </section>
  );
}

function WhileYouWait() {
  return (
    <section data-testid="while-you-wait" className="rounded-[18px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <div className="text-[14px] font-bold text-gray-800 dark:text-gray-100">While you wait</div>
      <div className="mt-3 flex gap-3">
        <span className="w-9 h-9 flex-none rounded-[10px] bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 flex items-center justify-center">
          <Compass size={18} aria-hidden="true" />
        </span>
        <div>
          <div className="text-[13.5px] font-semibold text-gray-900 dark:text-gray-100">Read the Programme Brief</div>
          <p className="mt-0.5 mb-1 text-[12.5px] text-gray-500 dark:text-gray-400">The Lab week by week, and what each week produces.</p>
          <Link to="/spinout-lab/brief" className="text-[13px] font-semibold text-violet-700 dark:text-violet-300">Open the brief →</Link>
        </div>
      </div>
      <p className="mt-3 mb-0 text-[12px] text-gray-500 dark:text-gray-400">Not scored.</p>
    </section>
  );
}

/** The full status screen, on `/spinout-lab/apply` once an application exists. */
export function ApplicationStatusScreen({ applicant, company, onWithdraw, onReschedule, onApplyAgain, busy = false, error = '' }) {
  const [confirming, setConfirming] = useState(false);
  const phase = phaseOf(applicant);
  const stages = timelineFor(applicant);
  const canWithdraw = (phase === 'screening' || phase === 'interview') && typeof onWithdraw === 'function';
  const submitted = whenOf(applicant.submitted_at);

  return (
    <div className="flex flex-col gap-5" data-testid="application-status-screen" data-phase={phase}>
      <section className="rounded-[20px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-7 shadow-sm">
        {applicant.application_id != null ? (
          <div className="text-[12px] font-mono text-gray-500 dark:text-gray-400">Application #{applicant.application_id}</div>
        ) : null}
        <h1 className="mt-1 mb-0 text-[24px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-50">{company || 'Your application'}</h1>
        <p className="mt-2 mb-0 text-[14px] text-gray-600 dark:text-gray-300" data-testid="status-lede">{statusLede(applicant)}</p>
        {submitted ? <p className="mt-1 mb-0 text-[12.5px] text-gray-500 dark:text-gray-400 tabular-nums">Submitted {submitted}</p> : null}
        {phase !== 'withdrawn' ? <div className="mt-6"><ApplicationTimeline stages={stages} /></div> : null}
        {phase === 'withdrawn' ? (
          <p className="mt-3 mb-0 text-[13.5px] text-gray-600 dark:text-gray-300" data-testid="withdrawn-note">
            {dayOf(applicant.withdrawn_at) ? `Withdrawn ${dayOf(applicant.withdrawn_at)}. ` : ''}Your answers and your description of the venture were deleted.
          </p>
        ) : null}
        {applicant.answers_recorded === false && phase !== 'withdrawn' ? (
          <p className="mt-4 mb-0 text-[12.5px] text-gray-500 dark:text-gray-400" data-testid="answers-not-asked">
            This application was made before the form asked about origin, team and traction, so none are on file.
          </p>
        ) : null}
      </section>

      {error ? <div role="alert" className="text-[13px] font-medium text-red-600 dark:text-red-400">{error}</div> : null}

      {phase === 'interview' ? (
        <InterviewCard interview={applicant.interview} company={company} onReschedule={onReschedule} busy={busy} />
      ) : null}
      {phase === 'declined' ? <DeclinedPanel applicant={applicant} /> : null}
      {phase === 'screening' || phase === 'interview' ? <WhileYouWait /> : null}

      {phase === 'withdrawn' || phase === 'declined' ? (
        typeof onApplyAgain === 'function' ? (
          <button type="button" onClick={onApplyAgain} data-testid="apply-again"
            className="self-start h-11 px-5 rounded-[11px] bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-bold">
            Start a new application
          </button>
        ) : null
      ) : null}

      {canWithdraw ? (
        <section className="text-[12.5px] text-gray-500 dark:text-gray-400">
          {!confirming ? (
            <button type="button" onClick={() => setConfirming(true)} data-testid="withdraw-start"
              className="font-semibold underline text-gray-600 dark:text-gray-300">
              Withdraw this application
            </button>
          ) : (
            <div data-testid="withdraw-confirm" className="rounded-xl border border-red-200 dark:border-red-500/30 p-4">
              <p className="m-0 text-[13px] text-gray-700 dark:text-gray-200">
                Withdrawing takes you out of this cohort's review and deletes your answers and your description of the venture. You can apply again later.
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busy} onClick={onWithdraw} data-testid="withdraw-confirm-button"
                  className="h-9 px-4 rounded-[10px] bg-red-600 text-white text-[13px] font-bold disabled:opacity-60">
                  {busy ? <Loader2 className="animate-spin" size={14} /> : 'Withdraw and delete'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="h-9 px-3 text-[13px] font-semibold text-gray-600 dark:text-gray-300">Keep it</button>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

/**
 * The short version on `/spinout-lab`, which used to carry its own status
 * block (`ApplicationStatusSection`, retired in D384). It says where the
 * application stands and links to the full screen, so the two cannot disagree.
 */
export function ApplicationStatusCard({ applicant, company }) {
  const phase = phaseOf(applicant);
  if (!['screening', 'interview', 'declined'].includes(phase)) return null;
  const pending = phase !== 'declined';
  return (
    <section data-testid="application-status" data-status={pending ? 'pending' : 'refused'}
      className={`rounded-[20px] p-8 bg-white dark:bg-gray-800 ring-1 shadow-sm ${pending ? 'ring-amber-300/70 dark:ring-amber-400/30' : 'ring-gray-300/70 dark:ring-gray-600/40'}`}>
      <span className={`text-[11px] font-bold uppercase tracking-[.08em] px-2 py-0.5 rounded-full ${pending ? 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300'}`}>
        {pending ? 'In review' : 'Not this cohort'}
      </span>
      <h2 className="mt-3 mb-0 text-[24px] font-black tracking-[-.02em] text-gray-900 dark:text-gray-50">
        {pending ? 'Your application is in review.' : 'You weren’t selected for this cohort.'}
      </h2>
      <p className="mt-2.5 mb-0 text-[14.5px] leading-relaxed text-gray-600 dark:text-gray-300">
        {pending
          ? <>We have your application{company ? <> for <strong className="font-semibold text-gray-900 dark:text-gray-100">{company}</strong></> : null}. {statusLede(applicant)} You don’t need to apply again.</>
          : <>{applicant.note ? 'The team wrote you a note with this decision. ' : ''}You’re welcome to apply again.</>}
      </p>
      <Link to="/spinout-lab/apply" data-testid="application-status-link"
        className="mt-5 inline-flex items-center h-10 px-4 rounded-[10px] border border-gray-300 dark:border-gray-600 text-[13.5px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50">
        {pending ? 'See your application' : 'See the decision'}
      </Link>
    </section>
  );
}

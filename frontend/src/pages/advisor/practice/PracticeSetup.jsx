/**
 * #4830 (D4830), board PX-01 — "Set up your practice" on `/practice`. While a setup step is known to be missing it
 * takes the place of the board's five section cards, which for a new advisor are five unrelated zeros; once every
 * step is done (or none can be known) the board shows as before. The model is `./practiceSetup.js`.
 *
 * The primary action always advances the next missing step. A step whose read failed says so with Try again, and is
 * neither ticked nor counted.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { PRACTICE_LIFECYCLE, UNREADABLE, setupProgress } from './practiceSetup';

const AVAILABILITY_DAYS = 60;

const READS = {
  profile: () => api.getMyAdvisor(),
  session_type: () => api.listMyAdvisorSessionTypes(),
  availability: () => api.listMyAdvisorSlots({ days: AVAILABILITY_DAYS }),
  booking_link: () => api.listMyAdvisorBookingLinks(),
  payout: () => api.getMyAdvisorPayoutAccount(),
};

/** Each read on its own: a missing profile (404) is "not done", any other failure is unreadable. */
async function readSetup() {
  const keys = Object.keys(READS);
  const answers = await Promise.all(keys.map((k) => READS[k]().catch((e) => (k === 'profile' && e?.status === 404 ? null : UNREADABLE))));
  return Object.fromEntries(keys.map((k, i) => [k, answers[i]]));
}

export function PracticeSetupCard({ progress, onRetry }) {
  const { steps, done, total, next } = progress;
  return (
    <div className="flex flex-col gap-3.5" data-testid="practice-setup">
      <section className="rounded-[12px] border border-emerald-200 bg-white p-5 dark:border-emerald-900 dark:bg-gray-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Set up your practice</h2>
            <p className="m-0 mt-1 text-[13px] text-axal-muted dark:text-gray-400">Get ready to accept your first client.</p>
          </div>
          <span className="font-mono text-[12.5px] font-semibold text-emerald-800 dark:text-emerald-300" data-testid="practice-setup-count">{done} of {total} complete</span>
        </div>
        <ol className="m-0 mt-4 flex list-none flex-col gap-1.5 p-0">
          {steps.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={`practice-setup-step-${s.key}`} data-state={s.state}>
              <span className="flex items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
                <span aria-hidden="true" className={`grid h-5 w-5 place-items-center rounded-full border text-[11px] font-bold ${s.state === 'done' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-axal-hairline text-transparent dark:border-gray-700'}`}>✓</span>
                {s.label}
              </span>
              {s.state === 'done' ? <span className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">Done</span>
                : s.state === 'unreadable' ? (
                  <span className="text-[12px] text-axal-muted dark:text-gray-400">Could not be read · <button type="button" onClick={onRetry} className="font-semibold text-emerald-700 underline dark:text-emerald-300">Try again</button></span>
                ) : (
                  <Link to={s.to} className={s.key === next?.key
                    ? 'rounded-md bg-emerald-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-800'
                    : 'text-[12px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300'}
                  data-testid={s.key === next?.key ? 'practice-setup-next' : undefined}
                  >{s.key === next?.key ? s.action : 'Next'}</Link>
                )}
            </li>
          ))}
        </ol>
      </section>
      <section className="rounded-[12px] border border-axal-hairline bg-white p-5 dark:border-gray-800 dark:bg-gray-900" data-testid="practice-lifecycle">
        <h3 className="m-0 text-[13px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">What happens next</h3>
        <ol className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
          {PRACTICE_LIFECYCLE.map((t, i) => (
            <li key={t} className="flex gap-2 text-[13px] text-axal-muted dark:text-gray-400"><span className="font-mono font-semibold text-emerald-700 dark:text-emerald-300">{i + 1}</span>{t}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** The board's lead: the setup state while a step is known to be missing, otherwise the board (`fallback`). */
export default function PracticeSetup({ fallback = null }) {
  const [reads, setReads] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    readSetup().then((r) => { if (live) setReads(r); });
    return () => { live = false; };
  }, [tick]);
  const retry = useCallback(() => setTick((t) => t + 1), []);
  if (!reads) return fallback;
  const progress = setupProgress(reads);
  return progress.takeOver ? <PracticeSetupCard progress={progress} onRetry={retry} /> : fallback;
}

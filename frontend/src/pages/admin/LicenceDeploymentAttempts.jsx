/**
 * D4706 (#4706) — a deployment's attempts on the Deploy step: the current
 * attempt, the last failure and the last success, a Retry for a failed
 * attempt, and a status check that reads what GitHub did instead of offering
 * a second dispatch. It re-checks by itself while an attempt is open.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { adminDeploymentAttemptsApi } from '../../lib/api/adminDeploymentAttempts';
import { outcomeFromError, outcomeOfError } from '../../lib/mutationOutcome';
import { reportError } from '../../lib/log';
import { utcDay } from '../../lib/utcStamp';
import OutcomeNotice from '../../components/OutcomeNotice';
import { DEPLOY_POLL_MS, attemptLine, deployActions, noticeForCheck, noticeForRetry } from './licenceDeploymentModel';

const DO_CHOICES = [
  { v: 'none', label: 'No jurisdiction' },
  { v: 'eu', label: 'EU' },
  { v: 'us', label: 'US' },
];

function RunLink({ attempt }) {
  if (!attempt?.run_url) return null;
  return (
    <a href={attempt.run_url} target="_blank" rel="noreferrer" className="text-indigo-700 underline dark:text-indigo-300">
      run log
    </a>
  );
}

export function AttemptSummary({ view }) {
  const current = view.current_attempt_row;
  const failure = view.last_failure;
  const success = view.last_success;
  return (
    <dl data-testid="deploy-attempts" className="grid gap-2 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-[11px] uppercase tracking-wide text-gray-500">Current attempt</dt>
        <dd data-testid="deploy-attempt-current">
          {current ? attemptLine(current) : `Attempt ${view.current_attempt}`}{' '}
          <RunLink attempt={current} />
        </dd>
      </div>
      <div>
        <dt className="text-[11px] uppercase tracking-wide text-gray-500">Last failure</dt>
        <dd data-testid="deploy-attempt-failure">
          {failure
            ? <>Attempt {failure.attempt_no}{utcDay(failure.settled_at) ? ` · ${utcDay(failure.settled_at)}` : ''} <RunLink attempt={failure} /></>
            : 'None'}
        </dd>
        {failure?.failure_note && <dd className="mt-1 text-xs text-gray-600 dark:text-gray-400">{failure.failure_note}</dd>}
      </div>
      <div>
        <dt className="text-[11px] uppercase tracking-wide text-gray-500">Last success</dt>
        <dd data-testid="deploy-attempt-success">
          {success
            ? <>Attempt {success.attempt_no}{utcDay(success.settled_at) ? ` · ${utcDay(success.settled_at)}` : ''} <RunLink attempt={success} /></>
            : 'None yet'}
        </dd>
      </div>
    </dl>
  );
}

export default function LicenceDeploymentAttempts({ licence, initialEmail = '', notice: outerNotice = null, onChanged }) {
  const [view, setView] = useState(null);
  const [readErr, setReadErr] = useState(null);
  const [notice, setNotice] = useState(outerNotice);
  const [busy, setBusy] = useState(false);
  // Kept across a failed retry: the operator never retypes what they gave.
  const [email, setEmail] = useState(initialEmail);
  const [doJur, setDoJur] = useState('none');

  useEffect(() => { if (outerNotice) setNotice(outerNotice); }, [outerNotice]);

  const load = useCallback(() => adminDeploymentAttemptsApi.deployment(licence.uid)
    .then((r) => { setView(r?.deployment || null); setReadErr(null); })
    .catch((e) => { reportError('deployment_attempts_load_failed', e); setReadErr(e?.message || 'Could not read this deployment.'); }),
  [licence.uid]);
  useEffect(() => { load(); }, [load]);

  const check = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setBusy(true);
    try {
      const r = await adminDeploymentAttemptsApi.reconcile(licence.uid);
      setView(r.deployment);
      const n = noticeForCheck(r.checked, r.deployment);
      if (n && (!quiet || r.checked === 'succeeded' || r.checked === 'failed' || r.checked === 'no_run')) setNotice(n);
      if (r.checked !== 'running' && r.checked !== 'no_run_yet') onChanged?.();
    } catch (e) {
      reportError('deployment_reconcile_failed', e);
      if (e?.data?.deployment) setView(e.data.deployment);
      if (!quiet) setNotice(outcomeFromError(e, 'The status check was refused.'));
    } finally { if (!quiet) setBusy(false); }
  }, [licence.uid, onChanged]);

  const actions = deployActions(view);

  // An open attempt is re-checked on its own; it stops the moment it settles.
  useEffect(() => {
    if (!actions.poll) return undefined;
    const t = setInterval(() => { check({ quiet: true }); }, DEPLOY_POLL_MS);
    return () => clearInterval(t);
  }, [actions.poll, check]);

  async function retry() {
    setBusy(true); setNotice({ outcome: 'pending', message: `Asking for attempt ${view.current_attempt + 1}…` });
    try {
      const r = await adminDeploymentAttemptsApi.retry(licence.uid, view.current_attempt, {
        principal_email: email,
        ...(actions.needsDoJurisdiction ? { do_jurisdiction: doJur } : {}),
      });
      setView(r.deployment);
      setNotice(noticeForRetry(r));
      onChanged?.();
    } catch (e) {
      reportError('deployment_retry_failed', e);
      setNotice(outcomeFromError(e, 'The retry was refused.'));
      if (e?.data?.deployment) setView(e.data.deployment);
      // Unknown: read the state before offering anything again. The retry
      // names its attempt, so pressing it again could never dispatch twice,
      // but the page shows what happened rather than asking the operator to guess.
      else if (outcomeOfError(e) === 'unknown') load();
    } finally { setBusy(false); }
  }

  if (readErr) return <p role="alert" className="text-sm text-red-600">{readErr}</p>;
  if (!view) return <OutcomeNotice notice={notice} testId="deploy-outcome" />;

  return (
    <div data-testid="deploy-attempts-panel" data-phase={view.phase} className="space-y-3">
      <OutcomeNotice notice={notice} testId="deploy-outcome" onDismiss={() => setNotice(null)} />
      {view.phase === 'partial' && (
        <p data-testid="deploy-partial" className="text-sm text-amber-800 dark:text-amber-200">
          The branch answers, but HQ is not linked to it yet: HQ reaches it once the linking pull request merges and HQ redeploys.
        </p>
      )}
      <AttemptSummary view={view} />
      {actions.canCheck && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button" data-testid="deploy-check" disabled={busy} onClick={() => check()}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            Check status
          </button>
          <span className="text-xs text-gray-500">
            Checked again by itself every {DEPLOY_POLL_MS / 1000} seconds while this attempt is open.
            {view.phase === 'unknown' ? ' GitHub never answered this dispatch, so nothing is sent again until a check finds the run or shows there is none.' : ''}
          </span>
        </div>
      )}
      {actions.canRetry && (
        <div data-testid="deploy-retry-form" className="space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-800">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            A retry is a new attempt under the same branch. Each provisioning step reuses what an earlier attempt already created, so nothing is duplicated and nothing is deleted.
          </p>
          <label className="block text-xs text-gray-600 dark:text-gray-400">
            <span className="block">Licence principal&apos;s email</span>
            <input
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="principal@example.com" type="email"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </label>
          {actions.needsDoJurisdiction && (
            <label className="block text-xs text-gray-600 dark:text-gray-400">
              <span className="block">Realtime residency the first attempt used</span>
              <select value={doJur} onChange={(e) => setDoJur(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900">
                {DO_CHOICES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </label>
          )}
          <button
            type="button" data-testid="deploy-retry" disabled={busy} onClick={retry}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Retry as attempt {view.current_attempt + 1}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * D4706 (#4706) — a deployment's attempts on the Deploy step: the current
 * attempt, the last failure and the last success, a Retry for a failed
 * attempt, and a status check that reads what GitHub did instead of offering
 * a second dispatch. It re-checks by itself while an attempt is open.
 */
import { useConsequenceSheet } from './LicenceConsequenceSheet';
import React, { useCallback, useEffect, useState } from 'react';
import { adminDeploymentAttemptsApi } from '../../lib/api/adminDeploymentAttempts';
import { outcomeFromError, outcomeOfError } from '../../lib/mutationOutcome';
import { reportError } from '../../lib/log';
import { utcDay } from '../../lib/utcStamp';
import OutcomeNotice from '../../components/OutcomeNotice';
import { Unreadable } from '../../ui/Honesty';
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, RefreshCw } from 'lucide-react';
import {
  DEPLOY_POLL_MS, attemptLine, canReconcile, deployActions, noticeForCheck, noticeForRetry, noticeForSettled, provisioningLine,
} from './licenceDeploymentModel';
import { clockText } from './licenceOverviewModel';

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

const LINE_SHAPE = { failed: AlertTriangle, committed: CheckCircle2, pending: Loader2, partial: CircleHelp, unknown: CircleHelp };
const LINE_TONE = {
  failed: 'text-red-700 dark:text-red-300',
  committed: 'text-green-700 dark:text-green-300',
};

/**
 * D5924 (#5924): L15's Provisioning row. A failed provisioning shows the
 * failed attempt's time and code and offers Reconcile deployment beside it,
 * so the record is never a dead end. While an attempt is open, Check status
 * below is the same reconcile, so it is not drawn twice.
 */
export function ProvisioningLine({ view, busy, onReconcile }) {
  const line = provisioningLine(view);
  if (!line) return null;
  const Shape = LINE_SHAPE[line.state] || CircleHelp;
  const offer = canReconcile(view) && view.reconcilable !== true;
  return (
    <div data-testid="deploy-provisioning" data-state={line.state}
      className="flex flex-col gap-2 rounded-md border border-gray-200 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Provisioning</div>
        <div className={`mt-0.5 flex flex-wrap items-center gap-1.5 text-sm font-semibold ${LINE_TONE[line.state] || 'text-gray-800 dark:text-gray-200'}`}>
          <Shape size={14} aria-hidden="true" />
          <span data-testid="deploy-provisioning-word">{line.word}</span>
          {line.state === 'failed' && (
            <span data-testid="deploy-provisioning-failure" className="font-normal text-gray-700 dark:text-gray-300">
              {line.at ? clockText(line.at) : 'at a time not recorded'} · code <span className="font-mono">{line.code || 'not recorded'}</span>
            </span>
          )}
        </div>
      </div>
      {offer && (
        <button
          type="button" data-testid="deploy-reconcile" disabled={busy} onClick={onReconcile}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 sm:min-h-0 sm:w-auto sm:py-1.5 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <RefreshCw size={13} aria-hidden="true" /> Reconcile deployment
        </button>
      )}
    </div>
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
  // D4819 part 21 (#5928): Retry and Reconcile, when the operator presses them, ask in the one consequence sheet
  // (L17) first. Their outcomes stay D4706's notice, which already says pending, done, refused or unknown, and
  // follows the provisioning run as it settles. The quiet re-check while an attempt is open asks nothing.
  const [sheet, ask] = useConsequenceSheet();

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
      // D5924: Reconcile on a settled failure answers 'settled'; say what the record holds.
      const n = noticeForCheck(r.checked, r.deployment)
        || (!quiet && r.checked === 'settled' ? noticeForSettled(r.deployment) : null);
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
    if (!await ask('retryDeploy', licence, { target: { attempt_no: view?.current_attempt } })) return;
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

  // D5924: a failed read is Unreadable with Try again, never an empty record.
  if (readErr) {
    return (
      <div data-testid="deploy-attempts-unreadable">
        <Unreadable what="This deployment's attempts" claim="This is not a sign that there are none." onRetry={() => load()} />
      </div>
    );
  }
  if (!view) return <OutcomeNotice notice={notice} testId="deploy-outcome" />;

  return (
    <div data-testid="deploy-attempts-panel" data-phase={view.phase} className="space-y-3">
      <OutcomeNotice notice={notice} testId="deploy-outcome" onDismiss={() => setNotice(null)} />
      {view.phase === 'partial' && (
        <p data-testid="deploy-partial" className="text-sm text-amber-800 dark:text-amber-200">
          The branch answers, but HQ is not linked to it yet: HQ reaches it once the linking pull request merges and HQ redeploys.
        </p>
      )}
      {sheet}
      <ProvisioningLine view={view} busy={busy} onReconcile={async () => { if (await ask('reconcileDeploy', licence)) check(); }} />
      {canReconcile(view) && !actions.canCheck && (
        <p data-testid="deploy-reconcile-note" className="text-xs text-gray-500 dark:text-gray-400">
          Reconcile reads this deployment&apos;s record again and sends nothing.{actions.canRetry ? ' Retry below starts a new attempt.' : ''}
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

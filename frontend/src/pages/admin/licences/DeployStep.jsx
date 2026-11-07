/**
 * #4707 — the HQ licence page's deployment. Moved out of `AdminLicences.jsx`
 * unchanged when the page was split by domain; the comments below are the
 * original ones.
 */
import React, { useCallback, useEffect, useState } from 'react';
import DeployVersion from '../../../components/DeployVersion';
import { Check, Globe } from 'lucide-react';
import { utcDay } from '../../../lib/utcStamp';
import { api } from '../../../lib/api';
import { DEPLOY_TIMELINE, deployProgress } from '../../../lib/deployTimeline';
import { reportError } from '../../../lib/log';
import { D1_JURISDICTIONS, LOCATION_HINTS, DO_JURISDICTIONS, BRANCH_CODE_RE, Chip } from './licenceShared';
import LicenceDeploymentAttempts from '../LicenceDeploymentAttempts';
import OutcomeNotice from '../../../components/OutcomeNotice';
import { outcomeFromError } from '../../../lib/mutationOutcome';

/* ------------------------------------------------------------------ *
 * H3 step 6 — Deploy                                                   *
 * ------------------------------------------------------------------ */

/**
 * Ask for a branch: residency, the hostname, what gets created, and where the
 * request got to.
 *
 * THE CREDENTIAL IS RENDERED AS A REASON, NOT AS AN ERROR. `dispatch_available`
 * comes back on the registry payload precisely so this button can be disabled
 * with the sentence rather than pressed into a 409 (D110, task #192). The
 * workflow still runs by hand from the Actions tab, and the step says so.
 */
export function DeployStep({ licence }) {
  const [reg, setReg] = useState(null);
  const [code, setCode] = useState('');
  const [d1, setD1] = useState('eu');
  const [hint, setHint] = useState('none');
  const [doJur, setDoJur] = useState('none');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  // D4706 — how the last Deploy ended, in the shared outcome vocabulary.
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    api.deployments()
      .then(setReg)
      .catch((e) => { reportError('deployments_load_failed', e); setReg(false); });
  }, []);
  useEffect(load, [load]);

  if (reg === false) return <p className="text-sm text-red-600">Could not read the deployment registry.</p>;
  if (!reg) return <p className="text-sm text-gray-500">Loading…</p>;

  const mine = (reg.deployments || []).find((d) => d.licence_uid === licence.uid) || null;
  const codeOk = BRANCH_CODE_RE.test(code);

  async function deploy() {
    setBusy(true); setNotice({ outcome: 'pending', message: 'Asking GitHub for the provisioning run…' });
    try {
      const r = await api.licenceDeploy(licence.uid, {
        code, d1_jurisdiction: d1, location_hint: hint, do_jurisdiction: doJur, principal_email: email,
      });
      setNotice({ outcome: 'pending', message: r?.note || 'The provisioning run was asked for.' });
    } catch (e) {
      reportError('licence_deploy_failed', e);
      // Refused, or unknown when no answer came: either way the form keeps
      // what was typed, and the registry is re-read below — a refusal after
      // the row was written shows its attempt and a Retry, and an unknown
      // shows a status check rather than a second Deploy.
      setNotice(outcomeFromError(e, 'The deploy request was refused.'));
    } finally {
      setBusy(false);
      load();
    }
  }

  if (mine) {
    // THREE STATES, BECAUSE TWO WERE THE DEFECT — the derivation and the whole
    // argument for it are `lib/deployTimeline.js`'s, so that a test can put a
    // RUNNING deployment and a FAILED one through it and see them differ. A
    // scan of this file could only ever see that three markers are written,
    // which is not the thing that was broken.
    const { failed, done, total, states, summary } = deployProgress(mine.status);
    return (
      <div data-testid="licence-deploy-step" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Globe size={14} className="text-gray-500" />
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{mine.hostname}</span>
          {/* One definition of failed, shared with the timeline below, so the
              chip and the marks can never disagree about the same row. */}
          <Chip tone={failed
            ? 'bg-red-50 text-red-700 border-red-200'
            : 'bg-indigo-50 text-indigo-700 border-indigo-200'}>{mine.status.replace(/_/g, ' ')}</Chip>
          {/* The live read is its own chip, never folded into the status: a
              deployment that reached `worker_live` and is unreachable right
              now has not regressed to `requested`. */}
          <Chip tone={mine.live_state === 'ok'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-gray-100 text-gray-600 border-gray-200'}>{mine.live_state.replace(/_/g, ' ')}</Chip>
        </div>
        {/* D4706 — the attempts: current, last failure, last success, and
            the Retry or status check the attempt's state allows. */}
        <LicenceDeploymentAttempts licence={licence} initialEmail={email} notice={notice} onChanged={load} />
        {mine.status_note && (
          <div
            data-testid="deploy-status-note"
            className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          >
            {/* The heading says whose sentence this is. The note is written by
                the route that stopped (admin_deployments.ts names the missing
                credential and the 403 scope apart, rather than calling both
                "not configured"), so it is repeated here and never restated —
                a second copy of a server sentence is the thing the credential
                block below already refuses. */}
            <span className="block text-[11px] font-medium uppercase tracking-wide">
              {failed ? 'Why it stopped' : 'Reported by provisioning'}
            </span>
            <span className="mt-1 block">{mine.status_note}</span>
          </div>
        )}
        {mine.live_state !== 'ok' && mine.live_reason && (
          <p className="text-xs text-gray-600 dark:text-gray-400">{mine.live_reason}</p>
        )}
        <p className="text-xs text-gray-600 dark:text-gray-400" data-testid="deploy-last-version">
          Last deployed version:{' '}
          <DeployVersion row={mine} />
          {utcDay(mine.last_health_at) ? ` · health read ${utcDay(mine.last_health_at)}` : ''}
        </p>
        <p data-testid="deploy-summary" className="text-sm text-gray-700 dark:text-gray-300">
          {summary}
        </p>
        <ol data-testid="deploy-timeline" data-done={done} data-total={total} className="space-y-1 text-sm">
          {DEPLOY_TIMELINE.map(([key, label], i) => {
            const state = states[i];
            return (
              <li key={key} data-state={state} className="flex items-center gap-2">
                {state === 'ok' && <Check size={13} className="shrink-0 text-green-600" />}
                {state === 'wait' && (
                  <span className="inline-block h-[13px] w-[13px] shrink-0 rounded-full border border-gray-300 dark:border-gray-700" />
                )}
                {/* Dashed, not a cross: the mark means "not recorded", and a
                    cross would say this step ran and failed, which is a claim
                    the row cannot support for any particular step. */}
                {state === 'unknown' && (
                  <span className="inline-block h-[13px] w-[13px] shrink-0 rounded-full border border-dashed border-amber-500" />
                )}
                <span className={state === 'ok' ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500'}>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
        <p data-testid="deploy-timeline-bound" className="text-[11px] text-gray-500">
          No step carries a time or a note of its own: the deployment row holds one status and one
          note for the whole request, so the note above belongs to the deployment rather than to any
          step of it.
        </p>
        <p className="text-[11px] text-gray-500">
          Residency requested: {mine.residency_requested || 'none'}. Granted:{' '}
          {mine.residency_granted || 'not yet reported by provisioning'}.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="licence-deploy-step" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-gray-600 dark:text-gray-400">
          <span className="block">Branch code</span>
          <input
            value={code} onChange={(e) => setCode(e.target.value)} placeholder="fr"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
          <span className="mt-1 block text-[11px] text-gray-500">
            Lower case, 2–16 characters, starting with a letter. It names the Worker, the database
            and the hostname, so it is refused rather than corrected.
          </span>
        </label>
        <div className="text-xs text-gray-600 dark:text-gray-400">
          <span className="block">Hostname</span>
          <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
            {codeOk ? `${code}.axal.vc` : '—'}
          </div>
        </div>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          <span className="block">Database residency</span>
          <select value={d1} onChange={(e) => setD1(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900">
            {D1_JURISDICTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          <span className="block">Location hint</span>
          <select value={hint} onChange={(e) => setHint(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900">
            {LOCATION_HINTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          <span className="block">Realtime residency</span>
          <select value={doJur} onChange={(e) => setDoJur(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900">
            {DO_JURISDICTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600 dark:text-gray-400">
          <span className="block">Licence principal&apos;s email</span>
          <input
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="principal@example.com"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
          <span className="mt-1 block text-[11px] text-gray-500">
            Seeded as the branch&apos;s only account, with no password — they sign in by magic link.
            Leave empty and the branch is provisioned with nobody able to sign in to it.
          </span>
        </label>
      </div>

      <p data-testid="residency-caveat" className="rounded-md border border-gray-200 p-3 text-xs text-gray-600 dark:border-gray-800 dark:text-gray-400">
        Cloudflare guarantees EU residency and nothing else. A hint keeps the primary near a region;
        it is not a guarantee, and in-country storage outside the EU is not available on this
        platform — a branch that needs it is a different data tier.
      </p>

      <div className="rounded-lg border border-gray-200 p-3 text-xs text-gray-600 dark:border-gray-800 dark:text-gray-400">
        <div className="font-medium text-gray-900 dark:text-gray-100">What provisioning will create</div>
        <ul className="mt-1 space-y-0.5">
          <li>Worker <code>studioos-{codeOk ? code : '<code>'}</code> at <code>{codeOk ? `${code}.axal.vc` : '<code>.axal.vc'}</code></li>
          <li>D1 database, two KV namespaces, three R2 buckets, a queue and its dead-letter queue</li>
          <li>A Vectorize index, the schema from the baseline, and the Worker secrets</li>
          <li>A pull request giving HQ its service binding — HQ reaches the branch on its next deploy</li>
        </ul>
      </div>

      {!reg.dispatch_available && (
        <p data-testid="deploy-credential-reason" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {reg.dispatch_reason}
        </p>
      )}
      <button
        type="button" disabled={busy || !codeOk || !reg.dispatch_available} onClick={deploy}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        Deploy this branch
      </button>
      <OutcomeNotice notice={notice} testId="deploy-outcome" />
    </div>
  );
}

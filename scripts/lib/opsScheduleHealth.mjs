/**
 * D8754 (#8754): whether the scheduled production jobs ran, from GitHub's own run records only.
 *
 * Four consecutive daily D1 backups sat `waiting` on the production-ops reviewer and nothing said so: the Worker reads
 * the D1 heartbeat only for the admin page. This reads each watched workflow's recent `main` runs (`actions: read`, no
 * production credential) and names what is wrong:
 *
 *   approval_pending     a run has waited on an environment approval longer than APPROVAL_GRACE_MS;
 *   backup_stale         the newest successful D1 backup started longer ago than BACKUP_MAX_AGE_MS (the 24-hour
 *                        recovery-point objective plus the 2-hour slack its schedule needs);
 *   schedule_missed      no run of a watched workflow was created within its window;
 *   credentials_missing  the newest finished run failed at the workflow's own credential guard step.
 *
 * Unreadable evidence is `active: null`, never a recovery: an open alert stays open until a read proves it healthy.
 */
export const APPROVAL_GRACE_MS = 60 * 60_000;
export const BACKUP_MAX_AGE_MS = 26 * 60 * 60_000;
export const OPS_REASONS = Object.freeze(['approval_pending', 'backup_stale', 'schedule_missed', 'credentials_missing']);

/** The scheduled jobs this alert watches. `window` is how long a missing run is tolerated; `backup` also needs a success. */
export const WATCHED = Object.freeze([
  // `credentialStep` names the workflow's own guard that fails when an environment secret is absent.
  Object.freeze({ workflow: 'backup-d1.yml', label: 'D1 backup', window: BACKUP_MAX_AGE_MS, backup: true, credentialStep: /assert required secrets/i }),
  Object.freeze({ workflow: 'magic-link-insert-probe.yml', label: 'magic-link probe', window: 9 * 60 * 60_000, backup: false, credentialStep: null }),
  Object.freeze({ workflow: 'admin-drift.yml', label: 'admin drift', window: 8 * 24 * 60 * 60_000, backup: false, credentialStep: /token cannot read/i }),
]);

const time = (value) => Date.parse(value || '');
const scheduled = (run) => run?.head_branch === 'main' && ['schedule', 'workflow_dispatch'].includes(run.event);

/**
 * One watched workflow. `runs` is `GET /actions/workflows/<file>/runs?branch=main` newest first; `failedSteps` names
 * the failed steps of the newest finished run when it failed (null when unread).
 */
export function workflowHealth(spec, runs, failedSteps, now) {
  if (!Array.isArray(runs) || !Number.isFinite(now)) return { workflow: spec.workflow, readable: false, reasons: [] };
  const own = runs.filter(scheduled);
  const reasons = [];
  const waiting = own.filter((run) => run.status === 'waiting' && now - time(run.created_at) > APPROVAL_GRACE_MS);
  if (waiting.length) reasons.push('approval_pending');
  const newest = own.map((run) => time(run.created_at)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (!Number.isFinite(newest) || now - newest > spec.window) reasons.push('schedule_missed');
  let ageHours = null;
  if (spec.backup) {
    const success = own.filter((run) => run.conclusion === 'success').map((run) => time(run.run_started_at || run.created_at))
      .filter(Number.isFinite).sort((a, b) => b - a)[0];
    if (Number.isFinite(success)) ageHours = Math.max(0, Math.floor((now - success) / 3_600_000));
    // The listing is a page: a success older than every listed run is still a stale backup.
    if (!Number.isFinite(success) || now - success > BACKUP_MAX_AGE_MS) reasons.push('backup_stale');
  }
  const finished = own.find((run) => run.status === 'completed');
  let readable = true;
  if (finished && finished.conclusion === 'failure') {
    if (failedSteps === null || failedSteps === undefined) readable = false;
    else if (spec.credentialStep && failedSteps.some((name) => spec.credentialStep.test(name))) reasons.push('credentials_missing');
  }
  return { workflow: spec.workflow, label: spec.label, readable, reasons, waiting: waiting.length, ageHours };
}

/** Every watched workflow together. Active when any has a reason; null when any could not be read and none has one. */
export function opsScheduleHealth(results) {
  if (!Array.isArray(results) || results.length === 0) return { active: null, reasons: [], workflows: [] };
  const failing = results.filter((r) => r.reasons.length);
  const reasons = OPS_REASONS.filter((reason) => failing.some((r) => r.reasons.includes(reason)));
  const backup = results.find((r) => r.workflow === 'backup-d1.yml');
  const facts = { reasons, workflows: failing.map((r) => r.workflow), ageHours: backup?.ageHours ?? null };
  if (failing.length) return { active: true, ...facts };
  if (results.some((r) => !r.readable)) return { active: null, ...facts };
  return { active: false, ...facts };
}

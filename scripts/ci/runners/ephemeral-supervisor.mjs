/** D7889: pure one-job enrollment/drain actions; no registration issuer or process launcher is embedded. */
export function isolatedJobEnvironment(environment) {
  return Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'RUNNER_TEMP', 'GITHUB_WORKSPACE']
    .filter((key) => typeof environment[key] === 'string').map((key) => [key, environment[key]]));
}

/** Callbacks belong to the reviewed bootstrap/lifecycle stage, never candidate-supplied commands. */
export function nextSupervisorAction(state, observed, policy, now) {
  if (!Number.isSafeInteger(now) || now < 0) throw Error('invalid_clock');
  if (!policy.approved || !policy.imageVerified || !policy.issuerVerified) return { action: 'blocked', reason: 'lifecycle_unverified' };
  if (![policy.lastAdmissionAt, policy.maxLifetimeMs, policy.minEnrollmentMs, policy.maxEnrollmentAttempts, state.machineCreatedAt, state.enrollmentAttempts]
    .every((n) => Number.isSafeInteger(n) && n >= 0) || policy.maxLifetimeMs < 1 || policy.minEnrollmentMs < 1
    || policy.maxEnrollmentAttempts < 1 || policy.maxEnrollmentAttempts > 5 || state.machineCreatedAt > now
    || !['none', 'owned', 'unowned', 'unknown'].includes(observed.assignment)) throw Error('invalid_supervisor_contract');
  const drain = policy.killSwitch || policy.draining || now >= policy.lastAdmissionAt || now - state.machineCreatedAt >= policy.maxLifetimeMs;
  if (drain) {
    if (!observed.eligibilityRemoved) return { action: 'remove-eligibility', reEnroll: false };
    if (observed.assignment !== 'none') return { action: 'wait', reason: observed.assignment === 'owned' ? 'owned_job_deadline' : 'unverified_assignment', reEnroll: false };
    if (observed.registered) return { action: 'unregister', reEnroll: false };
    return { action: 'ready-for-provider-teardown', reEnroll: false };
  }
  if (observed.assignment !== 'none') return { action: 'wait', reason: 'active_assignment' };
  if (!observed.registered) {
    if (state.enrollmentAttempts >= policy.maxEnrollmentAttempts) return { action: 'blocked', reason: 'enrollment_retry_limit' };
    if (!Number.isSafeInteger(policy.enrollmentExpiresAt) || policy.enrollmentExpiresAt - now < policy.minEnrollmentMs) return { action: 'request-short-lived-enrollment', nextEnrollmentAttempts: state.enrollmentAttempts + 1 };
    return { action: 'register-ephemeral', jobs: 1, persistCredential: false };
  }
  return { action: 'run-once', jobs: 1, ephemeral: true };
}

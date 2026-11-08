// D4706 (#4706) — a licence's deployment and its provisioning attempts:
// read the identity with every attempt, retry a failed attempt, and check
// what GitHub did with the current one. The first Deploy stays
// `api.licenceDeploy`. Worker: routes/admin_deployments.ts.
import { request } from '../api.js';

const base = (uid) => `/admin/licences/${encodeURIComponent(uid)}`;

export const adminDeploymentAttemptsApi = {
  /** `{ deployment }`: the identity, `attempts` (newest first), `last_failure`, `last_success`, `phase`, `retryable`, `reconcilable` — or null. */
  deployment: (uid) => request(`${base(uid)}/deployment`),
  /**
   * A new attempt for the failed one named by `expectedAttempt`. Sent twice, it
   * dispatches once: the second answer carries `replayed: true` and the state.
   */
  retry: (uid, expectedAttempt, data = {}) => request(`${base(uid)}/deploy/retry`, {
    method: 'POST', body: JSON.stringify({ ...data, expected_attempt: expectedAttempt }),
  }),
  /** Reads GitHub's runs for the current attempt and records the outcome. Never dispatches. */
  reconcile: (uid) => request(`${base(uid)}/deploy/reconcile`, { method: 'POST' }),
};

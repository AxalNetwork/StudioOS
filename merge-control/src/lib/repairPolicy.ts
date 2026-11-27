export const QUIET_MINUTES = 30;
const MAX_ATTEMPTS = 2;

const BREAKER_ALERTS = new Set([
  '[alert] main is red',
  '[alert] the Actions queue is backed up',
  '[alert] merge queue stalled',
]);

interface RepairState {
  digest: {
    event: string;
    verdict: string;
    headSha: string;
    fingerprint: string;
  } | null;
  lastPushAt: number;
  attemptsForFingerprint: number;
  dailyBudgetRemainingCents: number;
  killSwitch: boolean;
  openAlertTitles: readonly string[] | null;
  recentInfraFailures: number;
  infraFailureLimit: number;
}

/**
 * Evaluate a snapshot for one PR and failure fingerprint. Times use epoch
 * milliseconds. The caller supplies counts from the authoritative store
 * and rechecks and reserves capacity under the lease before dispatch.
 */
export function eligible(state: RepairState, now: number): boolean {
  const { digest } = state;
  if (digest?.event !== 'pull_request' || digest.verdict !== 'pr_failure' ||
      typeof digest.headSha !== 'string' || !/^[a-f0-9]{40}$/.test(digest.headSha) ||
      typeof digest.fingerprint !== 'string' || digest.fingerprint.trim() === '') return false;

  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(state.lastPushAt) ||
      state.lastPushAt <= 0 || now - state.lastPushAt < QUIET_MINUTES * 60_000) return false;

  if (!Number.isSafeInteger(state.attemptsForFingerprint) ||
      state.attemptsForFingerprint < 0 || state.attemptsForFingerprint >= MAX_ATTEMPTS ||
      !Number.isSafeInteger(state.dailyBudgetRemainingCents) || state.dailyBudgetRemainingCents <= 0 ||
      state.killSwitch !== false) return false;

  if (!Array.isArray(state.openAlertTitles) ||
      Array.from(state.openAlertTitles).some((title) =>
        typeof title !== 'string' || title.trim() === '' || BREAKER_ALERTS.has(title))) return false;

  return Number.isSafeInteger(state.recentInfraFailures) && state.recentInfraFailures >= 0 &&
    Number.isSafeInteger(state.infraFailureLimit) && state.infraFailureLimit > 0 &&
    state.recentInfraFailures < state.infraFailureLimit;
}

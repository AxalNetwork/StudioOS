// D5667: release metadata is correlated by immutable release ID and target.
// Missing phase receipts stay unknown. A successful workflow cannot prove D1 mutation.
import { validateEvent } from './events-v1.mjs';

const STATES = new Set(['success', 'failure', 'cancelled', 'unknown', 'skipped', 'pending']);
const PHASES = ['approval', 'migration', 'publish', 'smoke', 'parity', 'rollout', 'rollback'];

export function releasePolicy(event) {
  const { sequence, ...canonical } = event;
  validateEvent(canonical);
  if (event.visibility !== 'public' || event.family !== 'delivery' || !event.ids.release || !event.environment) {
    return { schema: 1, role: event.visibility === 'restricted' ? 'security' : 'activity', disposition: 'routine', material: false };
  }
  const target = event.environment;
  if (!/^[A-Za-z0-9_.-]{1,60}$/.test(target)) throw new Error('release_target_invalid');
  return {
    schema: 1, role: 'releases', disposition: event.state === 'failure' ? 'action' : 'routine',
    material: true, subject: `release:${event.ids.release}:${target}`,
  };
}

/** Select latest evidence by run/attempt, independent of receiver arrival order. */
export function releasePhases({ releaseId, target, sha, receipts }) {
  if (!/^[1-9]\d*$/.test(String(releaseId)) || !/^[A-Za-z0-9_.-]{1,60}$/.test(target)
      || !/^[a-f0-9]{40}$/.test(sha) || !Array.isArray(receipts) || receipts.length > 1000) {
    throw new Error('release_receipts_invalid');
  }
  const phases = Object.fromEntries(PHASES.map((phase) => [phase, { state: 'unknown', run: null, attempt: null }]));
  const selected = new Map();
  for (const receipt of receipts) {
    if (String(receipt.releaseId) !== String(releaseId) || receipt.target !== target || receipt.sha !== sha) continue;
    if (!PHASES.includes(receipt.phase) || !STATES.has(receipt.state)
        || !Number.isSafeInteger(receipt.run) || receipt.run < 1
        || !Number.isSafeInteger(receipt.attempt) || receipt.attempt < 1
        || !Number.isFinite(Date.parse(receipt.recordedAt))) throw new Error('release_receipt_invalid');
    const current = selected.get(receipt.phase);
    const order = [receipt.run, receipt.attempt, Date.parse(receipt.recordedAt)];
    const previous = current?.order;
    const newer = !previous || order[0] > previous[0]
      || order[0] === previous[0] && order[1] > previous[1]
      || order[0] === previous[0] && order[1] === previous[1] && order[2] > previous[2];
    if (newer) selected.set(receipt.phase, { receipt, order });
    else if (previous && order.every((value, index) => value === previous[index]) && receipt.state !== current.receipt.state) {
      throw new Error('release_receipt_conflict');
    }
  }
  for (const [phase, { receipt }] of selected) {
    phases[phase] = { state: receipt.state, run: receipt.run, attempt: receipt.attempt };
  }
  return { releaseId: String(releaseId), target, sha, phases };
}

/** Existing PublicationRelay policy callback, with the caller's routine policy retained. */
export function withReleaseRouting(fallback) {
  return async event => {
    const policy = releasePolicy(event);
    return policy.role === 'releases' ? policy : fallback(event);
  };
}

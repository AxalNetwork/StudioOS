/**
 * D5573 (#5573): the six workspace-engine invariants, each a pure function over one normalized observation set, so
 * the same verdict can later be computed for a hosted run (#4594's `RECONCILE` rows enter through
 * `fromReconcileRows`). Counts, synthetic ids and outcomes only; no tokens, file contents or log text.
 *
 * An observation set is `{ runs, events, window }`:
 *   runs   [{ run_id, tenant_id, allowed_regions, probe? }]
 *   events [{ kind, at, ... }] — see EVENT_KINDS
 *   window { ended_at, reconciliation_window_ms }
 *
 * A check that was never exercised is a failure (`not_exercised`), never a pass.
 */

export const RESOURCES = Object.freeze(['file', 'cache', 'ref', 'log', 'credential']);

export const EVENT_KINDS = Object.freeze([
  'enqueued', 'admitted', 'exec_start', 'completed', 'run_final',
  'access', 'policy_probe', 'revoked',
  'execution_created', 'execution_stopped', 'execution_cleaned',
  'checkpoint_ack', 'checkpoint_rejected', 'recovery',
  'charge', 'pr_opened', 'review', 'deploy', 'deploy_refused',
  'provider_call', 'git_op', 'fault', 'stale_callback_refused', 'redelivery_absorbed', 'grant_refused',
]);

const eventsOf = (obs, kind) => (Array.isArray(obs?.events) ? obs.events.filter((e) => e && e.kind === kind) : []);
const result = (name, checked, violations) => ({ name, ok: violations.length === 0, checked, violations });
const malformed = (name) => result(name, 0, [{ code: 'observations_unreadable' }]);
const readable = (obs) => obs && Array.isArray(obs.events) && Array.isArray(obs.runs);

/** 1. Zero cross-tenant access to files, cache, refs, logs or credentials; every resource class must be probed. */
export function checkTenantIsolation(obs) {
  const name = 'tenant_isolation';
  if (!readable(obs)) return malformed(name);
  const violations = [];
  const probed = new Set();
  const cross = eventsOf(obs, 'access').filter((e) => e.actor_tenant !== e.target_tenant);
  for (const e of cross) {
    if (!RESOURCES.includes(e.resource)) { violations.push({ code: 'unknown_resource', run_id: e.run_id }); continue; }
    if (e.outcome !== 'denied') violations.push({ code: 'cross_tenant_access', resource: e.resource, run_id: e.run_id });
    else probed.add(e.resource);
  }
  for (const resource of RESOURCES) if (!probed.has(resource)) violations.push({ code: 'not_exercised', resource });
  return result(name, cross.length, violations);
}

/** 2. Zero unreviewed deploy: every deploy follows an approval of an opened PR for the same run. */
export function checkNoUnreviewedDeploy(obs) {
  const name = 'no_unreviewed_deploy';
  if (!readable(obs)) return malformed(name);
  const violations = [];
  const deploys = eventsOf(obs, 'deploy');
  for (const d of deploys) {
    const pr = eventsOf(obs, 'pr_opened').find((p) => p.run_id === d.run_id && p.pr_ref === d.pr_ref && p.at <= d.at);
    const approved = eventsOf(obs, 'review').some((r) => r.run_id === d.run_id && r.pr_ref === d.pr_ref && r.decision === 'approved' && r.at <= d.at);
    if (!pr) violations.push({ code: 'deploy_without_pr', run_id: d.run_id });
    if (!approved) violations.push({ code: 'unreviewed_deploy', run_id: d.run_id });
  }
  const attempts = deploys.length + eventsOf(obs, 'deploy_refused').length;
  if (!attempts) violations.push({ code: 'not_exercised' });
  return result(name, attempts, violations);
}

/** 3. No double charge or double PR after redelivery or retry, and no PR or charge for a run that ended cancelled. */
export function checkNoDoubleEffect(obs) {
  const name = 'no_double_effect';
  if (!readable(obs)) return malformed(name);
  const violations = [];
  const count = (xs, key) => { const m = new Map(); for (const x of xs) m.set(x[key], (m.get(x[key]) || 0) + 1); return m; };
  const charges = eventsOf(obs, 'charge'), prs = eventsOf(obs, 'pr_opened');
  for (const [key, n] of count(charges, 'idempotency_key')) if (n > 1) violations.push({ code: 'double_charge', idempotency_key: key, count: n });
  for (const [key, n] of count(prs, 'run_key')) if (n > 1) violations.push({ code: 'double_pr', run_key: key, count: n });
  const cancelled = new Set(eventsOf(obs, 'run_final').filter((e) => e.outcome === 'cancelled').map((e) => e.run_id));
  for (const e of [...charges, ...prs]) if (cancelled.has(e.run_id)) violations.push({ code: `${e.kind}_for_cancelled_run`, run_id: e.run_id });
  return result(name, charges.length + prs.length, violations);
}

/** 4. No acknowledged checkpoint lost: a recovery restores the newest checkpoint acknowledged before it, and only an acknowledged one. */
export function checkCheckpointsKept(obs) {
  const name = 'no_acknowledged_checkpoint_lost';
  if (!readable(obs)) return malformed(name);
  const violations = [];
  const acks = eventsOf(obs, 'checkpoint_ack');
  const recoveries = eventsOf(obs, 'recovery');
  for (const r of recoveries) {
    const prior = acks.filter((a) => a.run_id === r.run_id && a.at <= r.at).sort((a, b) => a.at - b.at || a.seq - b.seq);
    const newest = prior.at(-1);
    if (newest && r.restored_ref !== newest.checkpoint_ref) violations.push({ code: 'acknowledged_checkpoint_lost', run_id: r.run_id });
    if (r.restored_ref !== null && !prior.some((a) => a.checkpoint_ref === r.restored_ref)) violations.push({ code: 'restored_unacknowledged_checkpoint', run_id: r.run_id });
  }
  return result(name, recoveries.length, violations);
}

/** 5. No stranded compute: every execution the provider created is stopped and cleaned by the end of the reconciliation window. */
export function checkNoStrandedCompute(obs) {
  const name = 'no_stranded_compute';
  if (!readable(obs)) return malformed(name);
  const w = obs.window;
  if (!w || !Number.isFinite(w.ended_at) || !Number.isFinite(w.reconciliation_window_ms) || w.reconciliation_window_ms < 0) return malformed(name);
  const deadline = w.ended_at + w.reconciliation_window_ms;
  const violations = [];
  const created = eventsOf(obs, 'execution_created');
  const first = (kind, id) => eventsOf(obs, kind).filter((e) => e.execution_id === id).sort((a, b) => a.at - b.at)[0];
  for (const c of created) {
    const stopped = first('execution_stopped', c.execution_id), cleaned = first('execution_cleaned', c.execution_id);
    if (!stopped || stopped.at > deadline) violations.push({ code: 'stranded_compute', execution_id: c.execution_id, run_id: c.run_id });
    else if (!cleaned || cleaned.at > deadline) violations.push({ code: 'cleanup_unconfirmed', execution_id: c.execution_id, run_id: c.run_id });
  }
  return result(name, created.length, violations);
}

/** 6. Revoked permissions and disallowed data regions never execute; both probes must have run. */
export function checkPolicyNeverExecutes(obs) {
  const name = 'revoked_and_disallowed_never_execute';
  if (!readable(obs)) return malformed(name);
  const violations = [];
  const runs = new Map(obs.runs.map((r) => [r.run_id, r]));
  const revokedAt = new Map();
  for (const e of eventsOf(obs, 'revoked')) if (!revokedAt.has(e.run_id) || e.at < revokedAt.get(e.run_id)) revokedAt.set(e.run_id, e.at);
  const executing = [...eventsOf(obs, 'exec_start'), ...eventsOf(obs, 'execution_created')];
  for (const e of executing) {
    const run = runs.get(e.run_id);
    if (!run || !Array.isArray(run.allowed_regions)) { violations.push({ code: 'unregistered_run_executed', run_id: e.run_id }); continue; }
    if (!run.allowed_regions.includes(e.region)) violations.push({ code: 'disallowed_region_executed', run_id: e.run_id });
    if (e.kind === 'exec_start' && revokedAt.has(e.run_id) && e.at >= revokedAt.get(e.run_id)) violations.push({ code: 'revoked_run_executed', run_id: e.run_id });
  }
  const probes = eventsOf(obs, 'policy_probe');
  for (const probe of ['revoked', 'disallowed_region']) {
    const done = probes.filter((p) => p.probe === probe);
    if (!done.length) violations.push({ code: 'not_exercised', probe });
    for (const p of done) if (p.outcome !== 'refused') violations.push({ code: `${probe}_probe_not_refused`, run_id: p.run_id });
  }
  return result(name, executing.length + probes.length, violations);
}

export const INVARIANTS = Object.freeze([
  checkTenantIsolation, checkNoUnreviewedDeploy, checkNoDoubleEffect, checkCheckpointsKept, checkNoStrandedCompute, checkPolicyNeverExecutes,
]);

export function checkAll(obs) {
  return INVARIANTS.map((check) => check(obs));
}

/**
 * The bridge to #4594's hosted Stage A: its `RECONCILE` reads (holds and proposals) become `charge` and `pr_opened`
 * events, so `checkNoDoubleEffect` judges a hosted ledger the way `reconcile()` does. A failed read is unreadable.
 */
export function fromReconcileRows({ holds, proposals }) {
  if (!Array.isArray(holds) || !Array.isArray(proposals)) return null;
  return [
    ...holds.filter((h) => h.status === 'settled').map((h, i) => ({ kind: 'charge', at: i, run_id: null, idempotency_key: h.idempotency_key })),
    ...proposals.map((p, i) => ({ kind: 'pr_opened', at: i, run_id: p.uid, run_key: p.run_key, pr_ref: p.uid })),
  ];
}

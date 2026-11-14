// D5573 (#5573) — the six workspace invariants (`workspaceInvariants.mjs`) on hand-built observation sets:
//   1. a clean set passes all six;
//   2. each targeted violation fails exactly its own invariant, with its own code;
//   3. an unexercised check and an unreadable set fail, never pass;
//   4. #4594's RECONCILE rows become charge/PR observations, so a hosted ledger is judged the same way.
//
// Mutation checked: `checkTenantIsolation` accepting any outcome (drop `e.outcome !== 'denied'`) → test 2 "cross_tenant_access" fails.
// Mutation checked: `checkNoUnreviewedDeploy` ignoring the approval's `at <= d.at` → the "approved after deploy" case fails.
// Mutation checked: `checkNoDoubleEffect` counting `n > 2` → the double charge and double PR cases fail.
// Mutation checked: `checkCheckpointsKept` comparing against the oldest ack (`prior[0]`) → "acknowledged_checkpoint_lost" fails.
// Mutation checked: `checkNoStrandedCompute` ignoring the deadline → the late-stop case fails.
// Mutation checked: `checkPolicyNeverExecutes` dropping the `not_exercised` loop → test 3 fails.
// Mutation checked: `fromReconcileRows` keeping pending holds → test 4's charge count fails.
//
//   node --test scripts/lib/workspaceInvariants.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESOURCES, checkAll, checkCheckpointsKept, checkNoDoubleEffect, checkNoStrandedCompute, checkNoUnreviewedDeploy,
  checkPolicyNeverExecutes, checkTenantIsolation, fromReconcileRows,
} from './workspaceInvariants.mjs';

function clean() {
  const runs = [
    { run_id: 'a1', tenant_id: 1, allowed_regions: ['weur'] }, { run_id: 'b1', tenant_id: 2, allowed_regions: ['weur'] },
    { run_id: 'rv', tenant_id: 1, allowed_regions: ['weur'], probe: true }, { run_id: 'rg', tenant_id: 1, allowed_regions: ['apac'], probe: true },
  ];
  const events = [
    ...RESOURCES.map((resource) => ({ kind: 'access', at: 1, run_id: 'a1', actor_tenant: 1, target_tenant: 2, resource, outcome: 'denied' })),
    { kind: 'access', at: 1, run_id: 'a1', actor_tenant: 1, target_tenant: 1, resource: 'cache', outcome: 'allowed' },
    { kind: 'execution_created', at: 0, execution_id: 'e1', run_id: 'a1', region: 'weur' },
    { kind: 'exec_start', at: 2, run_id: 'a1', region: 'weur' },
    { kind: 'checkpoint_ack', at: 3, run_id: 'a1', checkpoint_ref: 'c1', seq: 1 },
    { kind: 'checkpoint_ack', at: 4, run_id: 'a1', checkpoint_ref: 'c2', seq: 2 },
    { kind: 'recovery', at: 6, run_id: 'a1', restored_ref: 'c2', restore_ms: 5 },
    { kind: 'charge', at: 7, run_id: 'a1', idempotency_key: 'a1:1' },
    { kind: 'pr_opened', at: 7, run_id: 'a1', run_key: 'a1', pr_ref: 'pr-a1' },
    { kind: 'deploy_refused', at: 7, run_id: 'a1' },
    { kind: 'review', at: 8, run_id: 'a1', pr_ref: 'pr-a1', decision: 'approved' },
    { kind: 'deploy', at: 9, run_id: 'a1', pr_ref: 'pr-a1' },
    { kind: 'execution_stopped', at: 10, execution_id: 'e1' }, { kind: 'execution_cleaned', at: 11, execution_id: 'e1' },
    { kind: 'run_final', at: 12, run_id: 'a1', outcome: 'deployed' },
    { kind: 'revoked', at: 0, run_id: 'rv' },
    { kind: 'policy_probe', at: 0, probe: 'revoked', run_id: 'rv', outcome: 'refused' },
    { kind: 'policy_probe', at: 0, probe: 'disallowed_region', run_id: 'rg', outcome: 'refused' },
  ];
  return { runs, events, window: { ended_at: 20, reconciliation_window_ms: 10 } };
}
const codes = (r) => r.violations.map((v) => v.code);
const failing = (obs) => checkAll(obs).filter((r) => !r.ok).map((r) => r.name);

test('a clean observation set passes all six invariants', () => {
  const all = checkAll(clean());
  assert.equal(all.length, 6);
  for (const r of all) assert.ok(r.ok, `${r.name}: ${JSON.stringify(r.violations)}`);
});

test('each violation fails exactly its own invariant', () => {
  const cases = [
    ['tenant_isolation', 'cross_tenant_access', (o) => { o.events[2].outcome = 'allowed'; }],
    ['no_unreviewed_deploy', 'unreviewed_deploy', (o) => { o.events.find((e) => e.kind === 'review').decision = 'rejected'; }],
    ['no_unreviewed_deploy', 'unreviewed_deploy', (o) => { o.events.find((e) => e.kind === 'review').at = 50; }],
    ['no_unreviewed_deploy', 'deploy_without_pr', (o) => { o.events.find((e) => e.kind === 'deploy').pr_ref = 'pr-x'; o.events.push({ kind: 'review', at: 8, run_id: 'a1', pr_ref: 'pr-x', decision: 'approved' }); }],
    ['no_double_effect', 'double_charge', (o) => { o.events.push({ kind: 'charge', at: 8, run_id: 'a1', idempotency_key: 'a1:1' }); }],
    ['no_double_effect', 'double_pr', (o) => { o.events.push({ kind: 'pr_opened', at: 8, run_id: 'a1', run_key: 'a1', pr_ref: 'pr-a1' }); }],
    ['no_double_effect', 'charge_for_cancelled_run', (o) => { o.events.find((e) => e.kind === 'run_final').outcome = 'cancelled'; }],
    ['no_acknowledged_checkpoint_lost', 'acknowledged_checkpoint_lost', (o) => { o.events.find((e) => e.kind === 'recovery').restored_ref = 'c1'; }],
    ['no_acknowledged_checkpoint_lost', 'acknowledged_checkpoint_lost', (o) => { o.events.find((e) => e.kind === 'recovery').restored_ref = null; }],
    ['no_acknowledged_checkpoint_lost', 'restored_unacknowledged_checkpoint', (o) => { o.events = o.events.filter((e) => e.kind !== 'checkpoint_ack'); }],
    ['no_stranded_compute', 'stranded_compute', (o) => { o.events = o.events.filter((e) => e.kind !== 'execution_stopped'); }],
    ['no_stranded_compute', 'stranded_compute', (o) => { o.events.find((e) => e.kind === 'execution_stopped').at = 31; }],
    ['no_stranded_compute', 'cleanup_unconfirmed', (o) => { o.events = o.events.filter((e) => e.kind !== 'execution_cleaned'); }],
    ['revoked_and_disallowed_never_execute', 'revoked_run_executed', (o) => { o.events.push({ kind: 'exec_start', at: 1, run_id: 'rv', region: 'weur' }); }],
    ['revoked_and_disallowed_never_execute', 'disallowed_region_executed', (o) => { o.events.push({ kind: 'execution_created', at: 1, execution_id: 'e9', run_id: 'rg', region: 'weur' }); o.events.push({ kind: 'execution_stopped', at: 2, execution_id: 'e9' }, { kind: 'execution_cleaned', at: 2, execution_id: 'e9' }); }],
    ['revoked_and_disallowed_never_execute', 'unregistered_run_executed', (o) => { o.events.push({ kind: 'exec_start', at: 1, run_id: 'zz', region: 'weur' }); }],
    ['revoked_and_disallowed_never_execute', 'revoked_probe_not_refused', (o) => { o.events.find((e) => e.probe === 'revoked').outcome = 'executed'; }],
  ];
  for (const [name, code, mutate] of cases) {
    const obs = clean(); mutate(obs);
    assert.deepEqual(failing(obs), [name], `${name}/${code}`);
    assert.ok(codes(checkAll(obs).find((r) => r.name === name)).includes(code), `${name}/${code}`);
  }
});

test('an unexercised check and an unreadable observation set fail, never pass', () => {
  const noProbes = clean(); noProbes.events = noProbes.events.filter((e) => e.kind !== 'access' || e.resource !== 'log');
  assert.deepEqual(codes(checkTenantIsolation(noProbes)), ['not_exercised']);
  const noDeploy = clean(); noDeploy.events = noDeploy.events.filter((e) => !['deploy', 'deploy_refused'].includes(e.kind));
  assert.deepEqual(codes(checkNoUnreviewedDeploy(noDeploy)), ['not_exercised']);
  const noPolicy = clean(); noPolicy.events = noPolicy.events.filter((e) => e.kind !== 'policy_probe');
  assert.deepEqual(codes(checkPolicyNeverExecutes(noPolicy)), ['not_exercised', 'not_exercised']);
  for (const bad of [null, {}, { runs: [], events: null }]) {
    for (const check of [checkTenantIsolation, checkNoUnreviewedDeploy, checkNoDoubleEffect, checkCheckpointsKept, checkNoStrandedCompute, checkPolicyNeverExecutes]) {
      assert.deepEqual(codes(check(bad)), ['observations_unreadable']);
    }
  }
  assert.deepEqual(codes(checkNoStrandedCompute({ ...clean(), window: null })), ['observations_unreadable']);
});

test("#4594's RECONCILE rows are judged by the same double-effect check", () => {
  assert.equal(fromReconcileRows({ holds: null, proposals: [] }), null);
  const events = fromReconcileRows({
    holds: [{ idempotency_key: 'k1', status: 'settled' }, { idempotency_key: 'k1', status: 'settled' }, { idempotency_key: 'k2', status: 'pending' }],
    proposals: [{ uid: 'p1', run_key: 'r1' }],
  });
  assert.equal(events.filter((e) => e.kind === 'charge').length, 2);
  assert.deepEqual(codes(checkNoDoubleEffect({ runs: [], events })), ['double_charge']);
});

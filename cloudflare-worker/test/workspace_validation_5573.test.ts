/**
 * D5573 (#5573): LOCAL MOCKED validation harness journeys over the D5565/D5567 contracts and a faultable fake provider.
 * Synthetic ventures only; no network, credential, cloud or production call. Each fault either keeps all six invariants
 * or makes its runs fail closed, and a mocked run can never be reported as hosted, cloud or production capacity proof.
 *
 * Mutation checked: runnerProtocol `complete` answering a replay with `duplicate: false` → lost_callback, queue_redelivery and the default run fail (double_charge, double_pr).
 * Mutation checked: workspaceSecurity `issue` ignoring `current.approved` for integration.publish → the default run fails no_unreviewed_deploy.
 * Mutation checked: workspaceSecurity `objectFor` skipping its tenant/company/project/run ownership comparison → tenant_isolation fails on `ref`.
 * Mutation checked: workspaceSecurity `redeem` skipping the `claims.run_id !== target.run_id` check → tenant_isolation fails on `credential`.
 * Mutation checked: harness `sandboxRead` allowing any `tenants/` path → tenant_isolation fails on `cache` and `log`.
 * Mutation checked: harness recovery restoring no checkpoint (`restored_ref: null`) → forced_termination and missed_heartbeat fail no_acknowledged_checkpoint_lost.
 * Mutation checked: harness retrying an unknown create under a fresh idempotency key → unknown_create_outcome fails no_stranded_compute.
 * Mutation checked: harness skipping `stopAndClean` before recovery → forced_termination and missed_heartbeat fail (old execution not cleaned before its replacement).
 * Mutation checked: the harness's runner policy `authorize` ignoring revocation → the revoked probe leases and revoked_and_disallowed_never_execute fails.
 * Mutation checked: the fake executor's `create` skipping `executorEligibility` → the region probe fails revoked_and_disallowed_never_execute.
 * Mutation checked: runnerProtocol `requestCancel` allowed on a finished run → both race calls succeed, the harness's guard throws and cancel_races_completion fails.
 * Mutation checked: the checkpoint hash comparison removed → partial_upload's rejected-upload assertion fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FAULTS, runValidation, validateConfig, type Fault } from './_workspace_validation_5573.ts';
import { validateReport } from '../../scripts/lib/workspaceReport.mjs';

type Ev = { kind: string; at: number; [k: string]: any };
const failing = (report: any) => report.invariants.filter((i: any) => !i.ok).map((i: any) => i.name);
const ofKind = (events: Ev[], kind: string, probe = false) => events.filter(e => e.kind === kind && (probe || !String(e.run_id).match(/-(seed|revoked|region)$/)));
const perRun = (events: Ev[]) => { const m = new Map<string, number>(); for (const e of events) m.set(e.run_id, (m.get(e.run_id) || 0) + 1); return m; };
const single = (fault: Fault) => runValidation({ tasks: 4, faults: [fault] }, 'abcdef1');
const triggered = (events: Ev[], fault: Fault) => events.filter(e => e.kind === 'fault' && e.fault === fault && e.triggered).length;

test('the default run (10 tasks, 2 ventures, every fault) keeps all six invariants and triggers every fault', async () => {
  const { report, observations } = await runValidation({}, 'abcdef1');
  assert.equal(report.verdict, 'pass', JSON.stringify(report.invariants.filter((i: any) => !i.ok)));
  assert.deepEqual(validateReport(report), []);
  assert.equal(report.evidence_class, 'local_mocked');
  assert.equal(report.capacity_proof, false);
  assert.deepEqual({ tasks: report.config.tasks, tenants: report.config.tenants, concurrency: report.config.concurrency }, { tasks: 10, tenants: 2, concurrency: 10 });
  for (const f of FAULTS) assert.ok(triggered(observations.events as Ev[], f) > 0, f);
  assert.equal(report.cost.value, null);
  assert.equal(new Set(observations.runs.filter((r: any) => !r.probe).map((r: any) => r.tenant_id)).size, 2);
  for (const e of observations.events as Ev[]) assert.ok(!('token' in e) && !JSON.stringify(e).includes('eyJ'), 'no grant material in observations');
});

test('cross-tenant file, ref and credential probes are refused by the contracts; cache and log by the mock sandbox', async () => {
  const { observations } = await runValidation({ faults: [] }, 'abcdef1');
  const access = (observations.events as Ev[]).filter(e => e.kind === 'access');
  const cross = access.filter(e => e.actor_tenant !== e.target_tenant);
  assert.ok(cross.length >= 10);
  const codes = Object.fromEntries(cross.map(e => [e.resource, `${e.outcome}:${e.code}:${e.enforcement}`]));
  assert.deepEqual(codes, { file: 'denied:runner_not_authorized:contract', ref: 'denied:object_not_authorized:contract',
    credential: 'denied:grant_target_denied:contract', cache: 'denied:sandbox_path_denied:mock', log: 'denied:sandbox_path_denied:mock' });
  assert.ok(access.filter(e => e.actor_tenant === e.target_tenant).every(e => e.outcome === 'allowed'), 'the mock sandbox is not deny-all');
});

test('revoked sponsors and disallowed regions never execute', async () => {
  const { observations } = await runValidation({ faults: [] }, 'abcdef1');
  const ev = observations.events as Ev[];
  const probes = ev.filter(e => e.kind === 'policy_probe');
  assert.equal(probes.length, 4);
  for (const p of probes) assert.equal(p.outcome, 'refused');
  assert.deepEqual(probes.filter(p => p.probe === 'revoked').map(p => p.codes), [['sponsor_not_authorized', 'runner_not_authorized'], ['sponsor_not_authorized', 'runner_not_authorized']]);
  assert.deepEqual(probes.filter(p => p.probe === 'disallowed_region').map(p => p.codes), [['capability_denied', 'capability_denied'], ['capability_denied', 'capability_denied']]);
  assert.equal(ev.filter(e => e.kind === 'exec_start' && /-(revoked|region)$/.test(e.run_id)).length, 0);
  assert.equal(ev.filter(e => e.kind === 'execution_created' && /-region$/.test(e.run_id)).length, 0);
});

test('fault: provider 429/5xx is retried without a second physical create', async () => {
  const { report, observations } = await single('provider_429_5xx');
  const ev = observations.events as Ev[];
  assert.equal(report.verdict, 'pass');
  assert.equal(report.provider_quota_incidents, 4);
  assert.ok(ev.some(e => e.kind === 'provider_call' && e.result === 'provider_unavailable'));
  assert.equal(report.retry_amplification, 3);
  for (const n of perRun(ofKind(ev, 'execution_created')).values()) assert.equal(n, 1);
  assert.equal(report.outcomes.deployed, 4);
});

test('fault: an unknown create outcome reconciles to the same execution, never a second one', async () => {
  const { report, observations } = await single('unknown_create_outcome');
  const ev = observations.events as Ev[];
  assert.equal(report.verdict, 'pass');
  assert.equal(ev.filter(e => e.kind === 'provider_call' && e.result === 'create_outcome_unknown').length, 4);
  for (const n of perRun(ofKind(ev, 'execution_created')).values()) assert.equal(n, 1);
  assert.equal(report.outcomes.deployed, 4);
});

test('fault: a lost completion callback is replayed with no second charge or PR', async () => {
  const { report, observations } = await single('lost_callback');
  const ev = observations.events as Ev[];
  assert.equal(report.verdict, 'pass');
  assert.equal(triggered(ev, 'lost_callback'), 4);
  assert.deepEqual([...perRun(ofKind(ev, 'charge')).values()], [1, 1, 1, 1]);
  assert.equal(report.pr_count, 4);
});

test('fault: queue redelivery is absorbed: no new lease, charge, PR or execution', async () => {
  const { report, observations } = await single('queue_redelivery');
  const ev = observations.events as Ev[];
  assert.equal(report.verdict, 'pass');
  assert.deepEqual(ev.filter(e => e.kind === 'redelivery_absorbed').map(e => e.lease), Array(4).fill('lease_unavailable'));
  assert.deepEqual([...perRun(ofKind(ev, 'charge')).values()], [1, 1, 1, 1]);
  assert.equal(report.pr_count, 4);
  assert.equal(report.sample_size.executions, 4);
  assert.equal(report.sample_size.probe_executions, 2, 'the two revoked-sponsor probes provision, then are refused');
});

test('fault: an expired grant fails closed — nothing executes and nothing is stranded', async () => {
  const { report, observations } = await single('expired_grant');
  const ev = observations.events as Ev[];
  assert.deepEqual(report.outcomes, { failed_closed: 4 });
  assert.deepEqual(ev.filter(e => e.kind === 'grant_refused').map(e => e.code), Array(4).fill('grant_expired'));
  assert.equal(ofKind(ev, 'exec_start').length, 0);
  assert.equal(report.pr_count, 0);
  assert.deepEqual(failing(report), ['tenant_isolation', 'no_unreviewed_deploy'], 'only the unexercised checks fail');
  for (const name of failing(report)) assert.ok(report.invariants.find((i: any) => i.name === name).violations.every((v: any) => v.code === 'not_exercised'));
});

test('fault: an unavailable image fails closed with no execution created', async () => {
  const { report, observations } = await single('image_unavailable');
  const ev = observations.events as Ev[];
  assert.deepEqual(report.outcomes, { failed_closed: 4 });
  assert.equal(ofKind(ev, 'execution_created').length, 0);
  assert.equal(ev.filter(e => e.kind === 'provider_call' && e.result === 'image_unavailable').length, 4, 'not retried');
  assert.deepEqual(failing(report), ['tenant_isolation', 'no_unreviewed_deploy']);
});

for (const fault of ['forced_termination', 'missed_heartbeat'] as const) {
  test(`fault: ${fault} recovers on a new generation from the newest acknowledged checkpoint`, async () => {
    const { report, observations } = await single(fault);
    const ev = observations.events as Ev[];
    assert.equal(report.verdict, 'pass', JSON.stringify(failing(report)));
    const recoveries = ev.filter(e => e.kind === 'recovery');
    assert.equal(recoveries.length, 4);
    for (const r of recoveries) {
      const acks = ev.filter(e => e.kind === 'checkpoint_ack' && e.run_id === r.run_id && e.at <= r.at);
      assert.ok(acks.length && r.restored_ref === acks.at(-1)!.checkpoint_ref);
      assert.equal(r.to_generation, 2);
    }
    for (const n of perRun(ofKind(ev, 'execution_created')).values()) assert.equal(n, 2);
    for (const run of new Set(recoveries.map(r => r.run_id))) {
      const [first, second] = ev.filter(e => e.kind === 'execution_created' && e.run_id === run);
      const stop = ev.find(e => e.kind === 'execution_stopped' && e.execution_id === first.execution_id)!;
      const clean = ev.find(e => e.kind === 'execution_cleaned' && e.execution_id === first.execution_id)!;
      assert.ok(stop && clean && clean.at <= second.at && ev.indexOf(clean) < ev.indexOf(second), 'the old execution is stopped and cleaned before its replacement exists');
    }
    assert.deepEqual([...perRun(ofKind(ev, 'charge')).values()], [1, 1, 1, 1]);
    if (fault === 'missed_heartbeat') assert.deepEqual(ev.filter(e => e.kind === 'stale_callback_refused').map(e => e.code), Array(4).fill('stale_generation'));
    assert.ok(report.latency_ms.checkpoint_restore.n === 4 && report.latency_ms.checkpoint_restore.p95 > 0);
  });
}

test('fault: a partial upload is never acknowledged; the full retry is', async () => {
  const { report, observations } = await single('partial_upload');
  const ev = observations.events as Ev[];
  assert.equal(report.verdict, 'pass');
  assert.equal(ev.filter(e => e.kind === 'checkpoint_rejected' && e.reason === 'hash_mismatch').length, 4);
  for (const reject of ev.filter(e => e.kind === 'checkpoint_rejected')) {
    const ack = ev.find(e => e.kind === 'checkpoint_ack' && e.run_id === reject.run_id)!;
    assert.ok(ack.at > reject.at, 'acknowledged only after the full retry');
  }
  assert.equal(ev.filter(e => e.kind === 'checkpoint_ack').length, 4);
});

test('fault: cancellation racing completion has exactly one winner, and a cancelled run is never charged or published', async () => {
  const { report, observations } = await single('cancel_races_completion');
  const ev = observations.events as Ev[];
  assert.equal(report.verdict, 'pass');
  assert.deepEqual(report.outcomes, { deployed: 2, cancelled: 2 }, 'both orders raced');
  const cancelled = new Set(ev.filter(e => e.kind === 'run_final' && e.outcome === 'cancelled').map(e => e.run_id));
  assert.equal(ev.filter(e => ['charge', 'pr_opened', 'deploy'].includes(e.kind) && cancelled.has(e.run_id)).length, 0);
  assert.equal(report.pr_count, 2);
});

test('fault: an integration conflict deploys nothing and opens no second PR', async () => {
  const { report, observations } = await single('integration_conflict');
  const ev = observations.events as Ev[];
  assert.equal(report.verdict, 'pass');
  assert.deepEqual(report.outcomes, { integration_conflict: 4 });
  assert.equal(ev.filter(e => e.kind === 'deploy').length, 0);
  assert.equal(report.pr_count, 4);
  assert.equal(report.git_operations.merge_conflict, 4);
});

test('every deploy waits for review: the publish gate refuses before approval', async () => {
  const { observations } = await runValidation({ faults: [] }, 'abcdef1');
  const ev = observations.events as Ev[];
  const early = ev.filter(e => e.kind === 'deploy_refused' && e.stage === 'before_review');
  assert.equal(early.length, 10);
  assert.ok(early.every(e => e.code === 'sponsor_not_authorized'));
  assert.equal(ev.filter(e => e.kind === 'deploy').length, 10);
});

test('concurrency is enforced: never more live executions than the setting, and tasks queue behind it', async () => {
  const { report, observations } = await runValidation({ tasks: 50, concurrency: 10 }, 'abcdef1');
  assert.equal(report.verdict, 'pass');
  const ev = observations.events as Ev[];
  const points = [...ofKind(ev, 'execution_created').map(e => [e.at, 1] as const), ...ofKind(ev, 'execution_stopped').map(e => [e.at, -1] as const)]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let live = 0, peak = 0;
  for (const [, d] of points) { live += d; peak = Math.max(peak, live); }
  assert.ok(peak <= 10 && peak >= 5, `peak ${peak}`);
  assert.ok(report.latency_ms.queue.p95 > 0);
  assert.equal(report.sample_size.tasks, 50);
});

test('a seed reproduces the report exactly; another seed changes the synthetic timings', async () => {
  const a = await runValidation({ seed: 7 }, 'abcdef1'), b = await runValidation({ seed: 7 }, 'abcdef1'), c = await runValidation({ seed: 8 }, 'abcdef1');
  assert.equal(JSON.stringify(a.report), JSON.stringify(b.report));
  assert.equal(a.markdown, b.markdown);
  assert.notEqual(JSON.stringify(a.report.latency_ms), JSON.stringify(c.report.latency_ms));
  assert.throws(() => validateConfig({ tenants: 1 }), /tenants/);
  assert.throws(() => validateConfig({ faults: ['meteor' as Fault] }), /Unknown fault/);
});

test('the CLI writes JSON and Markdown, labelled local_mocked, and has no way to claim another evidence class', () => {
  const out = mkdtempSync(join(tmpdir(), 'ws5573-'));
  try {
    const run = (args: string[]) => spawnSync(process.execPath, ['scripts/workspace-validation.mjs', ...args], { encoding: 'utf8' });
    const ok = run(['--tasks', '10', '--tenants', '2', '--faults', 'all', '--seed', '5573', '--commit', 'abcdef1', '--out', out]);
    assert.equal(ok.status, 0, ok.stderr);
    const report = JSON.parse(readFileSync(join(out, 'workspace-validation.json'), 'utf8'));
    assert.equal(report.evidence_class, 'local_mocked');
    assert.deepEqual(validateReport(report), []);
    assert.match(readFileSync(join(out, 'workspace-validation.md'), 'utf8'), /^# Workspace validation — local_mocked/);
    assert.match(ok.stdout, /evidence_class=local_mocked/);
    for (const args of [['--evidence-class', 'production'], ['--evidence_class', 'real_cloud'], ['--faults', 'meteor'], ['--tasks']]) assert.equal(run(args).status, 2, args.join(' '));
    assert.equal(run(['--tasks', '2', '--faults', 'expired_grant', '--commit', 'abcdef1']).status, 1, 'an unexercised invariant is not a pass');
  } finally { rmSync(out, { recursive: true, force: true }); }
});

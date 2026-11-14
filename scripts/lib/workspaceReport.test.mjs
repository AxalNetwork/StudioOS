// D5573 (#5573) — the workspace validation report (`workspaceReport.mjs`):
//   1. a mock run is `local_mocked` and can never be labelled hosted, cloud or production capacity proof;
//   2. `validateReport` catches a relabelled mock and a mock cost of 0;
//   3. cost, egress and clone cache hit % are "not measured" (null), never 0; an empty sample is null;
//   4. the Markdown leads with the disclaimer.
//
// Mutation checked: `evidenceClassFor` returning `requested` for a mock → test 1's three refusals fail.
// Mutation checked: `validateReport` dropping the "labelled above local_mocked" rule → test 2's relabel cases fail.
// Mutation checked: `NOT_MEASURED.value` set to 0 → tests 2 and 3 fail.
// Mutation checked: `percentile` returning 0 for an empty sample → test 3 fails.
//
//   node --test scripts/lib/workspaceReport.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE_CLASSES, MOCK_PROVIDER_KIND, buildReport, evidenceClassFor, percentile, renderMarkdown, validateReport } from './workspaceReport.mjs';

const observations = () => ({ source: { provider_kind: MOCK_PROVIDER_KIND }, runs: [{ run_id: 'a', tenant_id: 1, allowed_regions: ['weur'] }],
  events: [{ kind: 'enqueued', at: 0, run_id: 'a' }, { kind: 'admitted', at: 5, run_id: 'a' }, { kind: 'run_final', at: 9, run_id: 'a', outcome: 'deployed' }],
  window: { ended_at: 10, reconciliation_window_ms: 1 } });
const config = { tasks: 1, tenants: 2, concurrency: 1, faults: [], seed: 1 };

test('a mock run is local_mocked and can never be labelled hosted, cloud or production', () => {
  const report = buildReport({ observations: observations(), config, commit: 'abcdef1' });
  assert.equal(report.evidence_class, 'local_mocked');
  assert.equal(report.capacity_proof, false);
  assert.deepEqual(EVIDENCE_CLASSES, ['local_mocked', 'hosted_stubbed', 'real_cloud', 'production']);
  for (const requested of ['hosted_stubbed', 'real_cloud', 'production']) {
    assert.throws(() => buildReport({ observations: observations(), config, commit: 'abcdef1', requested_class: requested }), /cannot be labelled/);
    assert.throws(() => evidenceClassFor({ provider_kind: MOCK_PROVIDER_KIND }, requested), /cannot be labelled/);
  }
  assert.throws(() => evidenceClassFor({ provider_kind: 'cloudflare' }), /in-process mock runs only/);
  assert.throws(() => evidenceClassFor({ provider_kind: MOCK_PROVIDER_KIND }, 'capacity'), /Unknown evidence class/);
  assert.equal(buildReport({ observations: observations(), config, commit: 'not a sha' }).commit, 'unknown');
});

test('validateReport catches a relabelled mock and a mock cost of 0', () => {
  const report = buildReport({ observations: observations(), config, commit: 'abcdef1' });
  assert.deepEqual(validateReport(report), []);
  for (const label of ['hosted_stubbed', 'real_cloud', 'production']) {
    assert.ok(validateReport({ ...report, evidence_class: label }).includes('a mock run is labelled above local_mocked'), label);
  }
  assert.ok(validateReport({ ...report, evidence_class: 'capacity' }).includes('unknown evidence class'));
  assert.ok(validateReport({ ...report, capacity_proof: true }).length);
  assert.ok(validateReport({ ...report, timing_basis: 'measured' }).length);
  for (const field of ['cost', 'egress', 'git_clone_cache_hit_pct']) {
    assert.ok(validateReport({ ...report, [field]: { measured: false, value: 0 } }).length, field);
    assert.ok(validateReport({ ...report, [field]: { measured: true, value: 12 } }).length, field);
  }
  assert.deepEqual(validateReport({}), ['unknown report schema']);
});

test('unmeasured values are null, never 0', () => {
  const report = buildReport({ observations: observations(), config, commit: 'abcdef1' });
  for (const field of ['cost', 'egress', 'git_clone_cache_hit_pct']) assert.deepEqual(report[field], { measured: false, value: null, reason: 'not measured in mock mode' });
  assert.equal(report.latency_ms.queue.p50, 5);
  assert.deepEqual(report.latency_ms.run, { n: 0, p50: null, p95: null });
  assert.equal(report.retry_amplification, null);
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(report.success_pct, 100);
});

test('the Markdown leads with the evidence class and the disclaimer', () => {
  const md = renderMarkdown(buildReport({ observations: observations(), config, commit: 'abcdef1' }));
  assert.match(md.split('\n')[0], /local_mocked/);
  assert.match(md, /not hosted, cloud or production capacity proof/);
  assert.match(md, /not measured in mock mode/);
  assert.match(md, /\| run \| 0 \| no sample \| no sample \|/);
});

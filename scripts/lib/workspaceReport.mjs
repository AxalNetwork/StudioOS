/**
 * D5573 (#5573): the workspace validation result report — evidence class, sample size, config, commit, latency
 * percentiles, success %, retry amplification, PR and Git-operation counts and the six invariant verdicts — as JSON
 * and Markdown. An in-process mock run is always `local_mocked`; this module refuses to label it anything else, and
 * cost in mock mode is "not measured" (null), never 0.
 */
import { checkAll } from './workspaceInvariants.mjs';

export const EVIDENCE_CLASSES = Object.freeze(['local_mocked', 'hosted_stubbed', 'real_cloud', 'production']);
export const MOCK_PROVIDER_KIND = 'in_process_mock';
export const REPORT_SCHEMA = 'workspace-validation-report/v1';
export const MOCK_DISCLAIMER = 'LOCAL MOCKED: an in-process fake provider on a virtual clock. This is not hosted, cloud or production capacity proof; '
  + 'timings are synthetic virtual-clock values, not measurements.';
const NOT_MEASURED = Object.freeze({ measured: false, value: null, reason: 'not measured in mock mode' });

/** Nearest-rank percentile; an empty sample is null ("no sample"), never 0. */
export function percentile(values, p) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  return xs[Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1))];
}
const dist = (values) => ({ n: values.filter(Number.isFinite).length, p50: percentile(values, 50), p95: percentile(values, 95) });

/** The only evidence class a source may claim. A mock may never be relabelled hosted, cloud or production. */
export function evidenceClassFor(source, requested = 'local_mocked') {
  if (!EVIDENCE_CLASSES.includes(requested)) throw new Error(`Unknown evidence class: ${requested}`);
  if (source?.provider_kind !== MOCK_PROVIDER_KIND) throw new Error('This harness reports in-process mock runs only');
  if (requested !== 'local_mocked') throw new Error(`A ${MOCK_PROVIDER_KIND} run cannot be labelled ${requested}`);
  return 'local_mocked';
}

function metrics(obs) {
  const tasks = obs.runs.filter((r) => !r.probe).map((r) => r.run_id);
  const isTask = new Set(tasks);
  const firstAt = (kind, run) => obs.events.filter((e) => e.kind === kind && e.run_id === run).reduce((m, e) => (m === null || e.at < m ? e.at : m), null);
  const span = (a, b) => tasks.map((run) => { const x = firstAt(a, run), y = firstAt(b, run); return x === null || y === null ? NaN : y - x; });
  const finals = new Map(obs.events.filter((e) => e.kind === 'run_final').map((e) => [e.run_id, e.outcome]));
  const outcomes = {};
  for (const run of tasks) { const o = finals.get(run) || 'unfinished'; outcomes[o] = (outcomes[o] || 0) + 1; }
  const creates = obs.events.filter((e) => e.kind === 'provider_call' && e.op === 'create' && isTask.has(e.run_id));
  const logical = new Set(creates.map((e) => `${e.run_id}/${e.generation}`));
  const git = {};
  for (const e of obs.events.filter((x) => x.kind === 'git_op')) git[e.op] = (git[e.op] || 0) + 1;
  return {
    sample_size: { tasks: tasks.length, probes: obs.runs.length - tasks.length,
      executions: obs.events.filter((e) => e.kind === 'execution_created' && isTask.has(e.run_id)).length,
      probe_executions: obs.events.filter((e) => e.kind === 'execution_created' && !isTask.has(e.run_id)).length },
    latency_ms: {
      queue: dist(span('enqueued', 'admitted')), start: dist(span('admitted', 'exec_start')), run: dist(span('exec_start', 'completed')),
      checkpoint_restore: dist(obs.events.filter((e) => e.kind === 'recovery').map((e) => e.restore_ms)),
    },
    success_pct: tasks.length ? Math.round((10000 * (outcomes.deployed || 0)) / tasks.length) / 100 : null,
    outcomes,
    retry_amplification: logical.size ? Math.round((1000 * creates.length) / logical.size) / 1000 : null,
    provider_quota_incidents: creates.filter((e) => e.result === 'provider_rate_limited').length,
    pr_count: obs.events.filter((e) => e.kind === 'pr_opened').length,
    git_operations: git,
  };
}

/** Build the report from one observation set. `requested_class` exists only so a test can pin the refusal. */
export function buildReport({ observations, config, commit, requested_class = 'local_mocked' }) {
  const evidence_class = evidenceClassFor(observations?.source, requested_class);
  const invariants = checkAll(observations);
  const faults = {};
  for (const e of observations.events.filter((x) => x.kind === 'fault')) {
    faults[e.fault] ??= { injected: 0, triggered: 0 };
    faults[e.fault][e.triggered ? 'triggered' : 'injected']++;
  }
  return {
    schema: REPORT_SCHEMA, issue: 5573, evidence_class, capacity_proof: false, disclaimer: MOCK_DISCLAIMER,
    provider_kind: observations.source.provider_kind, timing_basis: 'virtual_clock_synthetic',
    commit: typeof commit === 'string' && /^[0-9a-f]{7,40}$/.test(commit) ? commit : 'unknown', config,
    ...metrics(observations),
    cost: { ...NOT_MEASURED }, egress: { ...NOT_MEASURED }, git_clone_cache_hit_pct: { ...NOT_MEASURED },
    faults, invariants, verdict: invariants.every((i) => i.ok) ? 'pass' : 'fail',
  };
}

/** Problems that make a report dishonest. A mock labelled above `local_mocked`, or a mock cost of 0, is one. */
export function validateReport(report) {
  const problems = [];
  if (!report || report.schema !== REPORT_SCHEMA) return ['unknown report schema'];
  if (!EVIDENCE_CLASSES.includes(report.evidence_class)) problems.push('unknown evidence class');
  if (report.provider_kind === MOCK_PROVIDER_KIND && report.evidence_class !== 'local_mocked') problems.push('a mock run is labelled above local_mocked');
  if (report.evidence_class === 'local_mocked') {
    if (report.capacity_proof !== false) problems.push('a local_mocked report claims capacity proof');
    if (report.timing_basis !== 'virtual_clock_synthetic') problems.push('a local_mocked report claims measured timings');
    for (const field of ['cost', 'egress', 'git_clone_cache_hit_pct']) {
      if (report[field]?.measured !== false || report[field]?.value !== null) problems.push(`${field} must be "not measured" in mock mode, never a number`);
    }
  }
  return problems;
}

const cell = (v) => (v === null || v === undefined ? 'no sample' : String(v));
export function renderMarkdown(report) {
  const lines = [
    `# Workspace validation — ${report.evidence_class} (#5573)`, '',
    `> **${report.disclaimer}**`, '',
    `- Evidence class: \`${report.evidence_class}\` · capacity proof: **no** · provider: \`${report.provider_kind}\``,
    `- Commit: \`${report.commit}\` · seed: \`${report.config.seed}\` · verdict: **${report.verdict}**`,
    `- Config: ${report.config.tasks} tasks, ${report.config.tenants} synthetic ventures, concurrency ${report.config.concurrency}, faults: ${report.config.faults.join(', ') || 'none'}`,
    `- Sample size: ${report.sample_size.tasks} tasks, ${report.sample_size.executions} executions, ${report.sample_size.probes} policy probes`, '',
    '## Latency (virtual clock, ms)', '', '| Stage | n | p50 | p95 |', '| --- | --- | --- | --- |',
    ...Object.entries(report.latency_ms).map(([k, d]) => `| ${k} | ${d.n} | ${cell(d.p50)} | ${cell(d.p95)} |`), '',
    '## Outcomes', '',
    `- Success: ${cell(report.success_pct)}% (deployed after review) · outcomes: ${Object.entries(report.outcomes).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `- Retry amplification (create attempts per logical create): ${cell(report.retry_amplification)} · provider quota incidents: ${report.provider_quota_incidents}`,
    `- PRs: ${report.pr_count} · Git operations: ${Object.entries(report.git_operations).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    `- Cost per completed task, egress, clone cache hit %: **${report.cost.reason}**`, '',
    '## Invariants', '', '| Invariant | Result | Checked | Violations |', '| --- | --- | --- | --- |',
    ...report.invariants.map((i) => `| ${i.name} | ${i.ok ? 'pass' : 'FAIL'} | ${i.checked} | ${i.violations.length} |`), '',
    '## Faults', '', '| Fault | Injected | Triggered |', '| --- | --- | --- |',
    ...Object.entries(report.faults).map(([f, c]) => `| ${f} | ${c.injected} | ${c.triggered} |`), '',
  ];
  return lines.join('\n');
}

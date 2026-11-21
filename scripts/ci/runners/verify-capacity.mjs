#!/usr/bin/env node
/** D7888: bounded, GET-only runner timing evidence; metadata never grants result authority. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { verifiedPlan } from '../runner-execution.mjs';

const REPOSITORY = 'AxalNetwork/StudioOS';
const PROFILES = ['standard-hosted', 'linux-x64', 'macos-arm64'];
const CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', 'stale']);
export class CapacityEvidenceError extends Error {}
const fail = (code) => { throw new CapacityEvidenceError(code); };
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const stamp = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
const duration = (a, b) => a != null && b != null && b >= a ? b - a : null;
const conclusion = (v) => CONCLUSIONS.has(v) ? v : null;
const digest = (v) => createHash('sha256').update(v).digest('hex').slice(0, 16);

export function validateManifest(input) {
  if (!input || input.version !== 1 || input.repository !== REPOSITORY
      || !/^[a-f0-9]{40}$/.test(input.candidate_sha ?? '') || !/^[a-f0-9]{40}$/.test(input.executor_sha ?? '')
      || !/^[a-f0-9]{64}$/.test(input.plan_sha ?? '') || !positive(input.parent?.run_id) || !positive(input.parent?.attempt)) fail('invalid_manifest');
  const allowed = ['version', 'repository', 'candidate_sha', 'executor_sha', 'plan_sha', 'parent', 'requests', 'approved_group_id', 'capability_label', 'profile_contracts', 'controllers'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) fail('unknown_manifest_field');
  if (Object.keys(input.parent).some((key) => !['run_id', 'attempt'].includes(key))) fail('unknown_parent_field');
  if (!Array.isArray(input.requests) || !input.requests.length || input.requests.length > 32) fail('request_bound');
  if (input.approved_group_id != null && !positive(input.approved_group_id)) fail('invalid_group');
  if (input.capability_label != null && !/^studioos-[a-z0-9-]{1,64}$/.test(input.capability_label)) fail('invalid_capability');
  if (Object.hasOwn(input, 'profile_contracts') && (!input.profile_contracts || Array.isArray(input.profile_contracts)
      || typeof input.profile_contracts !== 'object' || Object.entries(input.profile_contracts).some(([profile, contract]) =>
        !['linux-x64', 'macos-arm64'].includes(profile) || !contract || !positive(contract.group_id)
        || !/^studioos-[a-z0-9-]{1,64}$/.test(contract.capability_label ?? '')
        || Object.keys(contract).some((key) => !['group_id', 'capability_label'].includes(key))))) fail('invalid_profile_contracts');
  const seen = new Map(); const requests = [];
  for (const r of input.requests) {
    if (!r || !/^worker-[1-6]-of-6$/.test(r.shard ?? '') || !positive(r.generation) || !positive(r.run_id)
        || !positive(r.attempt) || !positive(r.job_id) || !positive(r.test_step) || !PROFILES.includes(r.profile)) fail('invalid_request');
    if (Object.keys(r).some((key) => !['shard', 'generation', 'run_id', 'attempt', 'job_id', 'test_step', 'profile'].includes(key))) fail('unknown_request_field');
    const key = `${r.run_id}:${r.attempt}:${r.job_id}`;
    if (seen.has(key)) {
      if (JSON.stringify(seen.get(key)) !== JSON.stringify(r)) fail('ambiguous_job_binding');
      continue;
    }
    seen.set(key, r); requests.push({ ...r });
  }
  if (input.controllers != null && (!Array.isArray(input.controllers) || input.controllers.length > 16
      || input.controllers.some((r) => !positive(r.job_id) || (r.wait_steps != null && (!Array.isArray(r.wait_steps) || r.wait_steps.length > 50 || r.wait_steps.some((n) => !positive(n))))))) fail('invalid_controllers');
  if (input.controllers && (new Set(input.controllers.map((r) => r.job_id)).size !== input.controllers.length
      || input.controllers.some((r) => r.wait_steps != null && new Set(r.wait_steps).size !== r.wait_steps.length))) fail('duplicate_controller_phase');
  return { ...input, requests, controllers: input.controllers ?? [] };
}

function assignedProfile(job, spec) {
  const labels = new Set(Array.isArray(job.labels) ? job.labels : []);
  if (!positive(job.runner_id)) return null;
  if (!labels.has('self-hosted')) return labels.has('ubuntu-latest') && labels.size === 1 ? 'standard-hosted' : null;
  const profile = labels.has('Linux') && labels.has('X64') ? 'linux-x64'
    : labels.has('macOS') && labels.has('ARM64') ? 'macos-arm64' : null;
  const contract = spec.profile_contracts?.[profile] ?? { group_id: spec.approved_group_id, capability_label: spec.capability_label };
  if (!profile || !contract.group_id || job.runner_group_id !== contract.group_id
      || !contract.capability_label || !labels.has(contract.capability_label)) return null;
  return profile;
}

/** Completed intervals only; equal end/start timestamps do not prove overlap. */
export function overlapMetrics(intervals) {
  const points = new Map();
  for (const { start, end, profile } of intervals) {
    if (start == null || end == null || end <= start) continue;
    for (const [time, change] of [[start, 1], [end, -1]]) {
      const values = points.get(time) ?? []; values.push({ profile, change }); points.set(time, values);
    }
  }
  const times = [...points.keys()].sort((a, b) => a - b); const active = new Map(); let peak = 0; let threePoolMs = 0;
  for (let i = 0; i < times.length; i++) {
    for (const { profile, change } of points.get(times[i])) active.set(profile, (active.get(profile) ?? 0) + change);
    const next = times[i + 1];
    if (next == null || next <= times[i]) continue;
    peak = Math.max(peak, [...active.values()].reduce((a, b) => a + b, 0));
    if (PROFILES.every((p) => (active.get(p) ?? 0) > 0)) threePoolMs += next - times[i];
  }
  return { peak_completed_job_overlap: peak, three_pool_overlap_ms: threePoolMs };
}

/** All reads use fixed repository paths, one shared request cap and complete attempt pagination. */
export function collectCapacity(read, manifest, { requestCap = 100 } = {}) {
  const spec = validateManifest(manifest);
  if (!Number.isSafeInteger(requestCap) || requestCap < 1 || requestCap > 100) fail('invalid_request_cap');
  const cache = new Map(); let calls = 0;
  const get = (path) => {
    if (cache.has(path)) return cache.get(path);
    if (++calls > requestCap) fail('github_request_cap');
    let value; try { value = read(`repos/${REPOSITORY}/${path}`); } catch { fail('github_read_unavailable'); }
    cache.set(path, value); return value;
  };
  const attempts = new Map();
  const readAttempt = (id, attempt) => {
    const key = `${id}:${attempt}`;
    if (attempts.has(key)) return attempts.get(key);
    const run = get(`actions/runs/${id}/attempts/${attempt}`);
    if (run?.id !== id || run?.run_attempt !== attempt || run.repository?.full_name !== REPOSITORY) fail('run_identity_mismatch');
    const jobs = []; let complete = false;
    for (let page = 1; page <= 50; page++) {
      const batch = get(`actions/runs/${id}/attempts/${attempt}/jobs?per_page=100&page=${page}`);
      if (!Array.isArray(batch?.jobs) || batch.jobs.length > 100) fail('jobs_unavailable');
      for (const j of batch.jobs) {
        if (!positive(j.id) || j.run_id !== id || j.run_attempt !== attempt || jobs.some((old) => old.id === j.id)) fail('job_identity_mismatch');
        jobs.push(j);
      }
      if (jobs.length > 5000) fail('job_bound');
      if (batch.jobs.length < 100) {
        if (!Number.isSafeInteger(batch.total_count) || batch.total_count !== jobs.length) fail('incomplete_job_pages');
        complete = true; break;
      }
    }
    if (!complete) fail('job_page_cap');
    const result = { run, jobs }; attempts.set(key, result); return result;
  };
  const parent = readAttempt(spec.parent.run_id, spec.parent.attempt);
  const rows = spec.requests.map((r) => {
    const { run, jobs } = readAttempt(r.run_id, r.attempt);
    const job = jobs.find((j) => j.id === r.job_id);
    if (!job) fail('requested_job_unavailable');
    const step = job.steps?.find((s) => s.number === r.test_step);
    const start = stamp(job.started_at); const end = stamp(job.completed_at); const queued = stamp(job.created_at);
    const testStart = stamp(step?.started_at); const testEnd = stamp(step?.completed_at);
    const testTiming = start != null && end != null && testStart != null && testEnd != null
      && testStart >= start && testEnd <= end && testEnd >= testStart;
    return {
      logical_shard: r.shard, generation: r.generation, run_id: r.run_id, attempt: r.attempt, job_id: r.job_id,
      run_url: `https://github.com/${REPOSITORY}/actions/runs/${r.run_id}/attempts/${r.attempt}`,
      job_url: `https://github.com/${REPOSITORY}/actions/runs/${r.run_id}/job/${r.job_id}`,
      runner_ref: positive(job.runner_id) ? `runner-${digest(`${REPOSITORY}:${job.runner_id}`)}` : null,
      requested_profile: r.profile, assignment_profile: assignedProfile(job, spec),
      workflow_sha: /^[a-f0-9]{40}$/.test(run.head_sha ?? '') ? run.head_sha : null,
      workflow_revision_matches: run.head_sha === (r.run_id === spec.parent.run_id ? spec.candidate_sha : spec.executor_sha),
      queued_at: queued == null ? null : job.created_at, started_at: start == null ? null : job.started_at, completed_at: end == null ? null : job.completed_at,
      queue_wait_ms: duration(queued, start), execution_ms: duration(start, end),
      test_started_at: testTiming ? step.started_at : null, test_completed_at: testTiming ? step.completed_at : null,
      test_execution_ms: testTiming ? testEnd - testStart : null,
      run_conclusion: conclusion(run.conclusion), job_conclusion: conclusion(job.conclusion), test_conclusion: conclusion(step?.conclusion),
      timing_state: start != null && end != null && end < start ? 'unavailable' : 'recorded_or_pending',
    };
  });
  const controllers = spec.controllers.map((c) => {
    const job = parent.jobs.find((j) => j.id === c.job_id);
    if (!job) fail('controller_unavailable');
    const spans = c.wait_steps == null ? null : c.wait_steps.map((number) => {
      const step = job.steps?.find((s) => s.number === number);
      if (!step || stamp(step.started_at) == null || stamp(step.completed_at) == null || stamp(step.completed_at) < stamp(step.started_at)
          || (stamp(job.started_at) != null && stamp(step.started_at) < stamp(job.started_at))
          || (stamp(job.completed_at) != null && stamp(step.completed_at) > stamp(job.completed_at))) return null;
      return { start: stamp(step.started_at), end: stamp(step.completed_at) };
    });
    return { job_id: c.job_id, execution_ms: duration(stamp(job.started_at), stamp(job.completed_at)),
      wait_spans: spans == null || spans.some((s) => !s) ? null : spans };
  });
  return reportCapacity(spec, rows, controllers, { calls, parentMatches: parent.run.head_sha === spec.candidate_sha, parentConclusion: conclusion(parent.run.conclusion) });
}

function reportCapacity(spec, rows, controllers = [], { calls = 0, parentMatches = false, parentConclusion = null } = {}) {
  const unique = [...new Map(rows.map((r) => [`${r.run_id}:${r.attempt}:${r.job_id}`, r])).values()];
  const compatible = unique.filter((r) => r.assignment_profile === r.requested_profile && r.workflow_revision_matches);
  const jobs = compatible.map((r) => ({ profile: r.assignment_profile, start: stamp(r.started_at), end: stamp(r.completed_at) }));
  const intervals = compatible.map((r) => ({ profile: r.assignment_profile, start: stamp(r.test_started_at), end: stamp(r.test_completed_at) }));
  const overlap = overlapMetrics(intervals);
  const controllerTimings = controllers.map((c) => {
    let knownWait = c.wait_spans == null ? null : 0;
    if (knownWait != null) {
      let end = -Infinity;
      for (const span of [...c.wait_spans].sort((a, b) => a.start - b.start)) {
        knownWait += Math.max(0, span.end - Math.max(span.start, end)); end = Math.max(end, span.end);
      }
    }
    return { job_id: c.job_id, execution_ms: c.execution_ms, declared_wait_ms: knownWait,
      non_wait_execution_ms: c.execution_ms != null && knownWait != null && knownWait <= c.execution_ms ? c.execution_ms - knownWait : null };
  });
  const waitOverlap = controllers.some((c) => c.wait_spans == null) || !controllers.length ? null : controllers.reduce((sum, c) => sum + c.wait_spans.reduce((total, span) => {
    // Union external execution windows before measuring: two children cannot double-count one waiting millisecond.
    const windows = intervals.filter((i) => i.profile !== 'standard-hosted').map((i) => [Math.max(i.start ?? Infinity, span.start), Math.min(i.end ?? -Infinity, span.end)])
      .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
    let end = -Infinity; let covered = 0;
    for (const [a, b] of windows) { covered += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
    return total + covered;
  }, 0), 0);
  const logical = [...new Set(spec.requests.map((r) => r.shard))].sort().map((shard) => {
    const group = unique.filter((r) => r.logical_shard === shard); const generation = Math.max(...spec.requests.filter((r) => r.shard === shard).map((r) => r.generation));
    const current = group.filter((r) => r.generation === generation);
    const failed = group.some((r) => r.test_conclusion === 'failure' || r.job_conclusion === 'failure');
    const success = current.length === 1 && current.every((r) => r.workflow_revision_matches && r.assignment_profile === r.requested_profile && r.run_conclusion === 'success' && r.job_conclusion === 'success' && r.test_conclusion === 'success');
    return { logical_shard: shard, generation, observed_result: failed ? 'failure' : parentConclusion === 'cancelled' ? 'cancelled' : success ? 'success' : 'incomplete', authoritative_result: null };
  });
  return {
    version: 1, repository: REPOSITORY, evidence_scope: 'github_metadata_only', live_capacity_proof: 'not_verified',
    requested_candidate_sha: spec.candidate_sha, requested_executor_sha: spec.executor_sha, requested_plan_sha: spec.plan_sha,
    parent: { run_id: spec.parent.run_id, attempt: spec.parent.attempt, conclusion: parentConclusion }, parent_revision_matches: parentMatches, github_reads: calls, attempts: unique, controllers: controllerTimings, logical_results: logical,
    metrics: { ...overlap, peak_completed_job_overlap: overlapMetrics(jobs).peak_completed_job_overlap,
      peak_completed_test_overlap: overlap.peak_completed_job_overlap,
      known_controller_wait_overlap_ms: waitOverlap, resource_headroom: null, provider_metered_cost: null, controller_availability: null },
    blockers: ['trusted source/plan/receipt binding from #7886/#7887 is not integrated', 'resource headroom and provider metering are not recorded',
      ...(!overlap.three_pool_overlap_ms ? ['no completed three-pool overlap in this observation set'] : []),
      ...(waitOverlap == null ? ['controller wait-phase evidence is incomplete'] : waitOverlap > 0 ? ['observed hosted waiting overlaps external execution'] : [])],
    note: 'Observed metadata is not source admission, an authoritative aggregate, provider capacity, or a throughput prediction. Runner identities are pseudonyms; no runner names, group names, host addresses, raw job names or private configuration are emitted.',
  };
}

/** D7974: structural audit of normalized observations, never receipt authority.
 * The caller must retain private evidence; #7909 owns authenticating/binding it.
 * Plan bytes use the executor's digest and exact-once validation, not commands
 * or a "verified" flag supplied in an observation.
 */
export function assessWorkerPilot(report, { planBytes, scripts, root, records = [], cleanup = [], evidenceKind = 'observed' } = {}) {
  const reasons = new Set();
  const reject = (reason) => reasons.add(reason);
  const expected = Array.from({ length: 6 }, (_, i) => `worker-${i + 1}-of-6`);
  let plan;
  try {
    verifiedPlan({ event: 'push', part: 'worker-1-of-6', expectedDigest: `sha256:${report.requested_plan_sha}`, artifactBytes: planBytes, scripts, sourceRoot: root });
    plan = JSON.parse(Buffer.from(planBytes).toString('utf8'));
  } catch { reject('plan_unavailable_or_invalid'); }
  const rows = report.attempts ?? [];
  if (rows.length !== 6 || expected.some(part => rows.filter(r => r.logical_shard === part).length !== 1)
      || records.length !== 6 || expected.some(part => records.filter(r => r.logicalShard === part).length !== 1)) reject('six_authoritative_parts_required');
  if (!report.parent_revision_matches || report.parent?.conclusion !== 'success') reject('parent_not_successful');
  const intervals = [];
  for (const part of expected) {
    const row = rows.find(r => r.logical_shard === part);
    const record = records.find(r => r.logicalShard === part);
    const profile = expected.indexOf(part) < 2 ? 'linux-x64' : 'standard-hosted';
    if (!row || !record) continue;
    if (row.requested_profile !== profile || row.assignment_profile !== profile) reject('pilot_placement_mismatch');
    if (!row.workflow_revision_matches || record.sourceSha !== report.requested_candidate_sha
        || record.executorSha !== report.requested_executor_sha || record.planDigest !== `sha256:${report.requested_plan_sha}`
        || record.jobId !== row.job_id || record.runId !== row.run_id || record.attempt !== row.attempt
        || record.generation !== row.generation) reject('execution_binding_mismatch');
    const files = plan?.parts.find(p => p.name === part)?.files;
    if (!Array.isArray(files) || !Array.isArray(record.files)
        || JSON.stringify([...record.files].sort()) !== JSON.stringify([...files].sort())) reject('executed_file_coverage_mismatch');
    if ([row.run_conclusion, row.job_conclusion, row.test_conclusion].some(c => c !== 'success')
        || report.logical_results?.find(r => r.logical_shard === part)?.observed_result !== 'success'
        || record.exitCode !== 0) reject('work_not_successful');
    const start = stamp(row.test_started_at); const end = stamp(row.test_completed_at);
    if (start == null || end == null || end <= start) reject('test_interval_unavailable');
    else intervals.push({ part, profile, start, end });
  }
  const linux = rows.filter(r => r.logical_shard === expected[0] || r.logical_shard === expected[1]);
  if (linux.length !== 2 || linux.some(r => !r.runner_ref) || new Set(linux.map(r => r.runner_ref)).size !== 2) reject('distinct_runner_ids_required');
  const machines = expected.slice(0, 2).map(part => records.find(r => r.logicalShard === part)?.machineEvidence);
  const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (machines.some(m => !m || !hex(m.digest) || !hex(m.referenceDigest)
      || !['provider_inventory', 'platform_identity'].includes(m.source))
      || new Set(machines.map(m => m?.digest)).size !== 2) reject('independent_machine_evidence_required');
  let overlapMs = 0;
  const external = intervals.filter(r => r.profile === 'linux-x64');
  if (external.length === 2) for (const hosted of intervals.filter(r => r.profile === 'standard-hosted')) {
    overlapMs = Math.max(overlapMs, Math.max(0, Math.min(...external.map(r => r.end), hosted.end) - Math.max(...external.map(r => r.start), hosted.start)));
  }
  if (!(overlapMs > 0)) reject('no_linux_linux_hosted_test_overlap');
  const levels = ['job', 'runner', 'provider'];
  const complete = r => levels.every(level => r?.[level]?.state === 'complete' && hex(r[level].referenceDigest));
  if (cleanup.length !== 6 || expected.some(part => {
    const items = cleanup.filter(r => r.logicalShard === part);
    const row = rows.find(r => r.logical_shard === part);
    return items.length !== 1 || items[0].jobId !== row?.job_id || !complete(items[0]);
  })) reject('cleanup_incomplete');
  const exercises = records.flatMap(r => r.exercises ?? []);
  if (['cancellation', 'host-loss'].some(kind => !exercises.some(e => e.kind === kind && complete(e)))) reject('recovery_cleanup_unproved');
  if (!['synthetic', 'observed'].includes(evidenceKind)) reject('evidence_kind_invalid');
  return { evidence_scope: 'Worker parallel pilot (6 shards)', evidence_kind: evidenceKind === 'synthetic' ? 'synthetic' : 'observed',
    structural_result: reasons.size ? 'incomplete' : 'consistent', reasons: [...reasons].sort(),
    linux_linux_hosted_overlap_ms: overlapMs, live_capacity_proof: 'not_verified', authoritative_result: null,
    authority_blocker: 'Trusted receipt, machine and lifecycle evidence authentication remains with #7909; observations cannot publish a check.' };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--manifest') fail('usage_manifest_required');
  let manifest; try { manifest = JSON.parse(readFileSync(argv[1], 'utf8')); } catch { fail('manifest_unavailable'); }
  const read = (path) => JSON.parse(execFileSync('gh', ['api', path, '--method', 'GET'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  return collectCapacity(read, manifest);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(main(), null, 2)); }
  catch (error) { console.error(JSON.stringify({ evidence_scope: 'unavailable', reason: error instanceof CapacityEvidenceError ? error.message : 'report_unavailable' })); process.exitCode = 1; }
}

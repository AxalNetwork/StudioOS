#!/usr/bin/env node
/** D7888: bounded, GET-only runner timing evidence; metadata never grants result authority. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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
  const allowed = ['version', 'repository', 'candidate_sha', 'executor_sha', 'plan_sha', 'parent', 'requests', 'approved_group_id', 'capability_label', 'controllers'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) fail('unknown_manifest_field');
  if (Object.keys(input.parent).some((key) => !['run_id', 'attempt'].includes(key))) fail('unknown_parent_field');
  if (!Array.isArray(input.requests) || !input.requests.length || input.requests.length > 32) fail('request_bound');
  if (input.approved_group_id != null && !positive(input.approved_group_id)) fail('invalid_group');
  if (input.capability_label != null && !/^studioos-[a-z0-9-]{1,64}$/.test(input.capability_label)) fail('invalid_capability');
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
  if (!spec.approved_group_id || job.runner_group_id !== spec.approved_group_id || !spec.capability_label || !labels.has(spec.capability_label)) return null;
  if (labels.has('Linux') && labels.has('X64')) return 'linux-x64';
  if (labels.has('macOS') && labels.has('ARM64')) return 'macos-arm64';
  return null;
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
  const intervals = unique.filter((r) => r.assignment_profile === r.requested_profile && r.workflow_revision_matches)
    .map((r) => ({ profile: r.assignment_profile, start: stamp(r.started_at), end: stamp(r.completed_at) }));
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
    metrics: { ...overlap, known_controller_wait_overlap_ms: waitOverlap, resource_headroom: null, provider_metered_cost: null, controller_availability: null },
    blockers: ['trusted source/plan/receipt binding from #7886/#7887 is not integrated', 'resource headroom and provider metering are not recorded',
      ...(!overlap.three_pool_overlap_ms ? ['no completed three-pool overlap in this observation set'] : []),
      ...(waitOverlap == null ? ['controller wait-phase evidence is incomplete'] : waitOverlap > 0 ? ['observed hosted waiting overlaps external execution'] : [])],
    note: 'Observed metadata is not source admission, an authoritative aggregate, provider capacity, or a throughput prediction. Runner identities are pseudonyms; no runner names, group names, host addresses, raw job names or private configuration are emitted.',
  };
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

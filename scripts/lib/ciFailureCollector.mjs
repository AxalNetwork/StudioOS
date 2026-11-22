/** D5502: bounded Actions artifact reads, archive validation and tested-base comparison. */
/** D5502 (#5502): read bounded failure artifacts and compare only the run's recorded base, never latest main. */
import { inflateRawSync, crc32 } from 'node:zlib';
import { readCentralDirectory } from './previewArtifact.mjs';
import { infraFingerprint, classifyEvidence } from './ciClassify.mjs';
import { failureReport } from './ciFailures.mjs';
export const MAX_BYTES = 2 * 1024 * 1024;
export function readFailureArchive(buf) {
  if (buf.length > MAX_BYTES) throw new Error('evidence archive too large');
  const entries = readCentralDirectory(buf);
  if (entries.length !== 1) throw new Error('expected one evidence file');
  const e = entries[0];
  if (e.name !== 'failures.json' || e.size > MAX_BYTES || e.flags & 1 || ![0, 8].includes(e.method) || e.diskStart || e.mode && ![0, 0o100000].includes(e.mode & 0o170000)) throw new Error('invalid evidence archive');
  const at = e.localOffset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) throw new Error('invalid local header');
  const n = buf.readUInt16LE(at + 26), extra = buf.readUInt16LE(at + 28);
  if (buf.subarray(at + 30, at + 30 + n).toString() !== e.name) throw new Error('local name mismatch');
  const start = at + 30 + n + extra;
  if (start + e.compressedSize > buf.length) throw new Error('truncated evidence archive');
  const raw = buf.subarray(start, start + e.compressedSize);
  const data = e.method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) });
  if (data.length !== e.size || (crc32(data) >>> 0) !== e.crc) throw new Error('evidence checksum mismatch');
  const parsed = JSON.parse(data.toString());
  if (!Array.isArray(parsed) || parsed.length > 300) throw new Error('invalid evidence records');
  return parsed;
}
export async function boundedBody(response) {
  if (!response.ok) throw new Error('evidence download failed');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > MAX_BYTES) throw new Error('evidence response too large'); chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel(); }
}
export async function collectEvidence({ api, download, runId, baseSha }) {
  const warnings = [];
  async function pages(path, key) {
    const rows = [];
    for (let page = 1; page <= 3; page++) {
      const data = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(data[key])) throw new Error('missing API inventory');
      rows.push(...data[key]); if (data[key].length < 100) return rows;
    }
    throw new Error('API inventory exceeds page limit');
  }
  async function evidence(run) {
    const result = [], commits = new Map();
    const validCoordinates = async row => {
      if (!/^[a-f0-9]{40}$/.test(row.testedSha || '') || (row.headSha ?? row.testedSha) !== run.head_sha) return false;
      if (row.testedSha === run.head_sha) return true;
      if (run.event !== 'pull_request' || !/^[a-f0-9]{40}$/.test(baseSha || '')) return false;
      if (!commits.has(row.testedSha)) {
        if (commits.size >= 2) return false;
        let valid = false;
        try {
          const commit = await api(`/git/commits/${row.testedSha}`);
          const parents = commit.parents?.map(p => p.sha);
          valid = commit.sha === row.testedSha && parents?.length === 2 && new Set(parents).size === 2 && parents.includes(baseSha) && parents.includes(run.head_sha);
        } catch { warnings.push('Tested merge commit could not be verified; attribution is unknown.'); }
        commits.set(row.testedSha, valid);
      }
      return commits.get(row.testedSha);
    };
    const artifacts = await pages(`/actions/runs/${run.id}/artifacts`, 'artifacts');
    for (const artifact of artifacts.filter(a => /^ci-failures-(?:worker-\d+-of-\d+|frontend-\d+-of-\d+|rest)-attempt-\d+$/.test(a.name) && !a.expired).slice(0, 30)) {
      if (!Number.isSafeInteger(artifact.id) || artifact.id <= 0 || !artifact.name.endsWith(`-attempt-${run.run_attempt}`) || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== run.head_sha || artifact.size_in_bytes > MAX_BYTES) continue;
      try {
        const rows = readFailureArchive(await download(`/actions/artifacts/${artifact.id}/zip`));
        const normalized = [];
        for (const row of rows) {
          if (!row || row.version !== 1 || String(row.runId) !== String(run.id) || String(row.attempt) !== String(run.run_attempt) || !Array.isArray(row.failures) || !Array.isArray(row.files)) throw new Error('invalid evidence record');
          if (!await validCoordinates(row)) throw new Error('unverified evidence coordinates');
          const cleaned = failureReport(row);
          // Never upgrade invalid/truncated external evidence into a complete report.
          if (cleaned.failures.length !== row.failures.length || cleaned.files.length !== row.files.length) cleaned.complete = false;
          normalized.push(cleaned);
        }
        result.push(...normalized);
      } catch { warnings.push('A failure artifact was unreadable; its attribution is unknown.'); }
    }
    if (new Set(result.map(r => r.testedSha)).size > 1) {
      warnings.push('Conflicting tested SHAs in one run attempt; attribution is unknown.');
      return result.map(r => ({ ...r, complete: false }));
    }
    return result;
  }
  const run = await api(`/actions/runs/${runId}`);
  if (!/^[a-f0-9]{40}$/.test(run.head_sha || '') || !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.workflow_id)) throw new Error('invalid run metadata');
  const jobs = await pages(`/actions/runs/${runId}/jobs?filter=latest`, 'jobs');
  let current = [], base = [], baseRun = null;
  try { current = await evidence(run); } catch { warnings.push('Current artifact inventory unavailable; attribution is unknown.'); }
  if (/^[a-f0-9]{40}$/.test(baseSha || '')) try {
    const data = await api(`/actions/workflows/${run.workflow_id}/runs?branch=main&event=push&head_sha=${baseSha}&status=completed&per_page=20`);
    baseRun = data.workflow_runs?.find(r => r.head_sha === baseSha && r.event === 'push' && r.head_branch === 'main' && r.workflow_id === run.workflow_id && ['success', 'failure'].includes(r.conclusion));
    if (baseRun) base = await evidence(baseRun);
    else warnings.push('No completed main run exists for the tested base SHA.');
  } catch { warnings.push('Exact-base API or artifacts unavailable; attribution is unknown.'); }
  const result = classifyEvidence({ current, base, baseSha });
  // Any failed leaf without a complete matching report remains unknown, even if another shard inherited.
  const leaves = jobs.filter(j => ['failure', 'timed_out', 'cancelled'].includes(j.conclusion) && !['landing gate', 'test:drift (full suite)'].includes(j.name));
  for (const job of leaves) {
    const part = /^suite \(([^)]+)\)$/.exec(job.name)?.[1];
    if (part && current.some(r => r.part === part && r.complete && r.failures.length) && !current.some(r => r.part === part && r.status !== 0 && !r.failures.length)) continue;
    const step = job.steps?.find(s => ['failure', 'cancelled'].includes(s.conclusion));
    const clean = s => String(s || 'Not recorded').replace(/[^\w .():/-]/g, '').slice(0, 150);
    result.unknown.push({ kind: 'step', job: clean(job.name), file: 'Not recorded', test: `${clean(job.name)} / ${clean(step?.name)}`, part: clean(part), excerpt: 'Setup, build, guard or cancelled-job evidence unavailable.', repro: 'npm run build && npm run test:guards', jobUrl: /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+\/job\/\d+$/.test(job.html_url || '') ? job.html_url : null });
  }
  for (const group of [result.shared, result.own, result.unknown]) for (const row of group) {
    const job = jobs.find(j => j.name === `suite (${row.part})`);
    if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+\/job\/\d+$/.test(job?.html_url || '')) row.jobUrl = job.html_url;
  }
  if (result.unknown.length && !result.own.length) result.verdict = 'main_health_unknown';
  const fingerprint = infraFingerprint(jobs);
  if (fingerprint) { result.verdict = 'infra_failure'; result.infraFingerprint = fingerprint; }
  return { ...result, failures: result.own, warnings, testedSha: new Set(current.map(r => r.testedSha)).size === 1 ? current[0].testedSha : null, headSha: run.head_sha, runId: run.id, runUrl: run.html_url, baseRunUrl: baseRun?.html_url || null };
}

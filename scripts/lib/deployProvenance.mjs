/**
 * D8073 (#8073): the pure half of deploy provenance — what
 * `scripts/deploy/record-deployment.mjs` records for a deploy, and what
 * `scripts/check-spa-live.mjs` makes of `GET /api/public/version`.
 *
 * No network, no filesystem: every input is passed in, so the tests drive it
 * with a fake environment. The field rules match the Worker's
 * `parseDeployment` (routes/internal_deployments.ts); the test pins both.
 */

export const DEFAULT_RECORD_URL = 'https://axal.vc/api/internal/deployments';
export const VERSION_PATH = '/api/public/version';

const SHA_RE = /^[0-9a-f]{40}$/;
const RUN_ID_RE = /^[0-9]{1,20}$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const VERSION_ID_RE = new RegExp(`^${UUID}$`);
const ATTESTATION_RE = /^https:\/\/github\.com\/AxalNetwork\/StudioOS\/attestations\/[0-9]{1,20}$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * The Worker version id `wrangler deploy` reports. Reads the ND-JSON file
 * wrangler writes to `WRANGLER_OUTPUT_FILE_PATH` first (its `deploy` entry's
 * `version_id`), then the human log's `Current Version ID:` line. Null when
 * neither names one.
 */
export function workerVersionId({ outputNdjson = '', log = '' } = {}) {
  for (const line of String(outputNdjson).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const entry = JSON.parse(t);
      const id = String(entry?.version_id ?? '').toLowerCase();
      if (entry?.type === 'deploy' && VERSION_ID_RE.test(id)) return id;
    } catch { /* not an entry */ }
  }
  const m = String(log).match(new RegExp(`Current Version ID:\\s*(${UUID})`, 'i'));
  return m ? m[1].toLowerCase() : null;
}

/**
 * The record body for this run, from the run's environment. Returns
 * `{ ok: true, record }` or `{ ok: false, problems }` naming each variable
 * that is missing or malformed — never its value.
 */
export function deploymentRecord(env, { versionId = null, now = () => new Date() } = {}) {
  const problems = [];
  const sha = String(env.GITHUB_SHA ?? '').trim().toLowerCase();
  if (!SHA_RE.test(sha)) problems.push('GITHUB_SHA is not a 40-character commit sha');
  const runId = String(env.GITHUB_RUN_ID ?? '').trim();
  if (!RUN_ID_RE.test(runId)) problems.push('GITHUB_RUN_ID is not an Actions run id');
  const vid = (String(env.WORKER_VERSION_ID ?? '').trim() || String(versionId ?? '').trim()).toLowerCase();
  if (!VERSION_ID_RE.test(vid)) problems.push('no Worker version id (WORKER_VERSION_ID, or the wrangler deploy output)');
  const attestation = String(env.ATTESTATION_URL ?? '').trim();
  if (attestation && !ATTESTATION_RE.test(attestation)) problems.push('ATTESTATION_URL is not an attestation of this repository');
  const builtAt = String(env.WORKER_BUILT_AT ?? '').trim();
  if (builtAt && !ISO_UTC_RE.test(builtAt)) problems.push('WORKER_BUILT_AT is not an ISO 8601 UTC time');
  const deployedAt = String(env.DEPLOYED_AT ?? '').trim() || now().toISOString();
  if (!ISO_UTC_RE.test(deployedAt)) problems.push('DEPLOYED_AT is not an ISO 8601 UTC time');
  const rb = String(env.ROLLBACK_OF ?? '').trim();
  if (rb && !/^[1-9][0-9]{0,15}$/.test(rb)) problems.push('ROLLBACK_OF is not a deployment id');
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    record: {
      sha,
      run_id: runId,
      worker_version_id: vid,
      attestation_url: attestation || null,
      built_at: builtAt || null,
      deployed_at: deployedAt,
      rollback_of: rb ? Number(rb) : null,
    },
  };
}

/** The deploy summary's one Markdown line for a record and its outcome. */
export function summaryLine(record, outcome) {
  const att = record.attestation_url ? `[attestation](${record.attestation_url})` : 'no attestation';
  return `- Deployment recorded (${outcome}): \`${record.sha.slice(0, 12)}\` · run ${record.run_id} · Worker version \`${record.worker_version_id}\` · ${att} · built ${record.built_at ?? 'not recorded'} · deployed ${record.deployed_at}`;
}

/**
 * The smoke's verdict on `GET /api/public/version`. Healthy: HTTP 200 JSON
 * whose `sha` is a commit sha, and, when `expectedSha` is given, that very
 * sha. Returns `{ ok, sha, reason }`.
 */
export function versionVerdict(status, body, expectedSha = '') {
  if (status !== 200) return { ok: false, sha: null, reason: `HTTP ${status} (expected 200)` };
  let v = null;
  try { v = typeof body === 'string' ? JSON.parse(body) : body; } catch { /* judged below */ }
  if (!v || typeof v !== 'object') return { ok: false, sha: null, reason: 'body is not JSON' };
  const sha = typeof v.sha === 'string' && SHA_RE.test(v.sha) ? v.sha : null;
  if (!sha) return { ok: false, sha: null, reason: 'the served build carries no commit sha (`sha` is null: WORKER_DEPLOY_VERSION was not stamped)' };
  const want = String(expectedSha || '').trim().toLowerCase();
  if (want && sha !== want) return { ok: false, sha, reason: `served sha ${sha.slice(0, 12)} is not the deployed sha ${want.slice(0, 12)}` };
  return { ok: true, sha, reason: null };
}

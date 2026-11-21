#!/usr/bin/env node
/**
 * D8073 (#8073): record the deploy this run just shipped.
 *
 * Reads the run's environment, writes one row to D1 `deployments` through
 * `POST /api/internal/deployments`, and appends the same line to the deploy
 * summary (`GITHUB_STEP_SUMMARY`). The rules live in
 * `scripts/lib/deployProvenance.mjs`; this file only does the effects.
 *
 * Environment:
 *   DEPLOY_RECORD_TOKEN  bearer token the route checks (required; never printed)
 *   DEPLOY_RECORD_URL    the route (default https://axal.vc/api/internal/deployments)
 *   GITHUB_SHA, GITHUB_RUN_ID   set by Actions; set by hand for a manual record
 *   WORKER_VERSION_ID    the Worker version id, or let it be read from
 *   WRANGLER_OUTPUT_FILE_PATH (wrangler's ND-JSON) or WRANGLER_DEPLOY_LOG (a log file)
 *   ATTESTATION_URL      the actions/attest-build-provenance attestation URL (optional)
 *   WORKER_BUILT_AT      the build's UTC time (optional)
 *   DEPLOYED_AT          the deploy's UTC time (default: now)
 *   ROLLBACK_OF          id of the deployment a rollback undid (optional)
 *
 * Exit 0 when the row is written or was already there; 1 otherwise. A
 * failure here does not undo the deploy — it says the record is missing.
 *
 *   node scripts/deploy/record-deployment.mjs
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DEFAULT_RECORD_URL, deploymentRecord, summaryLine, workerVersionId } from '../lib/deployProvenance.mjs';

function readIf(path) {
  try { return path && existsSync(path) ? readFileSync(path, 'utf8') : ''; } catch { return ''; }
}

/** One run. Every effect is injected so the test drives it with fakes. */
export async function run({
  env = process.env,
  fetchImpl = globalThis.fetch,
  read = readIf,
  appendSummary = (line) => { if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`); },
  log = console.log,
  error = console.error,
} = {}) {
  const token = String(env.DEPLOY_RECORD_TOKEN ?? '').trim();
  if (!token) { error('[record-deployment] DEPLOY_RECORD_TOKEN is not set; nothing recorded.'); return 1; }
  const versionId = workerVersionId({ outputNdjson: read(env.WRANGLER_OUTPUT_FILE_PATH), log: read(env.WRANGLER_DEPLOY_LOG) });
  const built = deploymentRecord(env, { versionId });
  if (!built.ok) {
    for (const p of built.problems) error(`[record-deployment] ${p}`);
    return 1;
  }
  const url = String(env.DEPLOY_RECORD_URL ?? '').trim() || DEFAULT_RECORD_URL;
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(built.record),
    });
  } catch (err) {
    error(`[record-deployment] request failed: ${err?.message || err}`);
    return 1;
  }
  let body = null;
  try { body = await res.json(); } catch { /* reported below */ }
  if (res.status !== 201 && res.status !== 200) {
    error(`[record-deployment] HTTP ${res.status}: ${body?.error || 'no refusal code'}`);
    return 1;
  }
  const outcome = res.status === 201 ? `new, id ${body?.deployment?.id ?? '?'}` : `already recorded, id ${body?.deployment?.id ?? '?'}`;
  const line = summaryLine(built.record, outcome);
  log(line);
  try { appendSummary(line); } catch { /* the summary is a convenience */ }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await run());
}

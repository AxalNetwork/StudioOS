#!/usr/bin/env node
/** D5602: GitHub file inventory, bounded SARIF snapshots and prior-main artifact reads for scan policy. */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { advanceScan, findingSnapshot, readScanAlert, ruleCounts, SCAN_ALERT_TITLE, SCANNERS, scanScope } from './lib/scanScope.mjs';

const MAX_JSON = 8 * 1024 * 1024;
function jsonFile(file) {
  if (statSync(file).size > MAX_JSON) throw new Error('Scan artifact exceeds its size bound');
  return JSON.parse(readFileSync(file, 'utf8'));
}
function gh(args) {
  try { return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: MAX_JSON, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new Error('GitHub scan inventory/artifact request failed'); }
}
const api = path => JSON.parse(gh(['api', path]));
function context(env) {
  const repo = env.GITHUB_REPOSITORY;
  const runId = Number(env.GITHUB_RUN_ID);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !Number.isSafeInteger(runId) || runId < 1) throw new Error('Invalid scan run identity');
  return { repo, runId, runUrl: `https://github.com/${repo}/actions/runs/${runId}` };
}

export async function selectScope(env = process.env, readApi = api) {
  const payload = jsonFile(env.GITHUB_EVENT_PATH);
  const event = env.GITHUB_EVENT_NAME;
  const labels = payload.pull_request?.labels || [];
  if (event !== 'pull_request' || labels.some(label => label?.name === 'security-scan')) return scanScope({ event, labels });
  const { repo } = context(env);
  const number = Number(payload.pull_request?.number || payload.number);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Missing PR identity');
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const rows = await readApi(`repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
    if (!Array.isArray(rows)) throw new Error('Unreadable PR inventory');
    files.push(...rows);
    if (rows.length < 100) break;
  }
  return scanScope({ event, labels, files, truncated: files.length >= 3000
    || (Number.isSafeInteger(payload.pull_request?.changed_files) && payload.pull_request.changed_files > files.length) });
}

function sarifFiles(path) {
  const stat = statSync(path);
  if (stat.isFile()) return path.endsWith('.sarif') ? [path] : [];
  if (!stat.isDirectory()) throw new Error('Invalid SARIF input');
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('SARIF input may not be a symlink');
    return entry.isDirectory() ? sarifFiles(join(path, entry.name)) : entry.name.endsWith('.sarif') ? [join(path, entry.name)] : [];
  });
}

/** Only a completed successful, earlier main-push run from this same workflow supplies a baseline. */
export async function previousState({ scanner, repo, runId, workflowId, readApi, download }) {
  const list = await readApi(`repos/${repo}/actions/workflows/${workflowId}/runs?branch=main&event=push&status=completed&per_page=100`);
  if (!Array.isArray(list?.workflow_runs)) throw new Error('Unreadable prior scan runs');
  const prior = list.workflow_runs.find(run => run.id < runId && run.head_branch === 'main' && run.event === 'push'
    && run.status === 'completed' && run.conclusion === 'success');
  if (!prior) return null;
  const inventory = await readApi(`repos/${repo}/actions/runs/${prior.id}/artifacts?per_page=100`);
  if (!Array.isArray(inventory?.artifacts)) throw new Error('Unreadable scan artifacts');
  const artifact = inventory.artifacts.find(item => item.name === `scan-state-${scanner}` && !item.expired);
  if (!artifact) return null;
  if (!Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes > MAX_JSON) throw new Error('Prior scan artifact too large');
  const state = await download(prior.id, artifact.name);
  if (state.repository !== repo || state.scanner !== scanner || state.run_id !== prior.id) throw new Error('Prior artifact identity mismatch');
  return state;
}

async function incidentExists(repo, scanner, readApi) {
  for (let page = 1; page <= 100; page++) {
    const issues = await readApi(`repos/${repo}/issues?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(issues)) throw new Error('Unreadable incident inventory');
    const issue = issues.find(item => !item.pull_request && item.title === SCAN_ALERT_TITLE);
    if (issue) return Object.keys(readScanAlert(issue.body)[scanner]?.counts || {}).length > 0;
    if (issues.length < 100) return false;
  }
  throw new Error('Incident inventory cap reached');
}

export async function prepareState({ scanner, repo, runId, runUrl, current, readApi = api, download }) {
  const run = await readApi(`repos/${repo}/actions/runs/${runId}`);
  if (run.head_branch !== 'main' || run.event !== 'push' || !Number.isSafeInteger(run.workflow_id)) throw new Error('Only main push runs may report');
  const previous = await previousState({ scanner, repo, runId, workflowId: run.workflow_id, readApi, download });
  const state = advanceScan(current, previous);
  // Losing an incident's artifact is unknown, not a licence to close it on the next run.
  state.history_unknown = Boolean(previous?.history_unknown || (!previous && await incidentExists(repo, scanner, readApi)));
  if (state.history_unknown) state.baseline = false;
  return { state: { ...state, repository: repo, scanner, run_id: runId },
    facts: { scanner, baseline: state.baseline, runUrl, counts: ruleCounts(state.open) } };
}

export async function verifyArtifactRead(env = process.env, readApi = api, fetcher = fetch) {
  const { repo } = context(env);
  const runs = await readApi(`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=1`);
  const run = runs.workflow_runs?.[0];
  if (!Number.isSafeInteger(run?.id)) throw new Error('No prior main CI run for artifact-read proof');
  const inventory = await readApi(`repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`);
  const artifact = inventory.artifacts?.find(item => !item.expired && Number.isSafeInteger(item.id));
  if (!artifact) throw new Error('No retained main artifact for artifact-read proof');
  const response = await fetcher(`https://api.github.com/repos/${repo}/actions/artifacts/${artifact.id}/zip`, {
    headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }, redirect: 'manual',
  });
  if (response.status !== 302) throw new Error('actions:read could not redeem a different run artifact');
  console.log('Verified actions:read can redeem an earlier main-run artifact (redirect only; contents not fetched).');
}

async function main() {
  const [command, scanner, input, output] = process.argv.slice(2);
  if (command === 'scope') {
    // A failed API call fails this admission job rather than silently excluding a scan.
    const scan = await selectScope();
    appendFileSync(process.env.GITHUB_OUTPUT, `scan=${scan}\n`);
    return console.log(`scan=${scan}`);
  }
  if (command === 'verify-artifact-read') return verifyArtifactRead();
  if (!SCANNERS.includes(scanner)) throw new Error('Unknown scanner');
  const ctx = context(process.env);
  if (command === 'snapshot') {
    const current = findingSnapshot(sarifFiles(input).map(jsonFile));
    mkdirSync(resolve(output, '..'), { recursive: true });
    writeFileSync(output, JSON.stringify({ version: 1, scanner, repository: ctx.repo, run_id: ctx.runId, current }));
    return;
  }
  if (command === 'prepare') {
    const dir = mkdtempSync(join(tmpdir(), 'scan-state-'));
    try {
      const snapshots = [];
      const files = readdirSync(input, { recursive: true }).filter(file => file.endsWith('.json'));
      if (files.length !== (scanner === 'codeql' ? 2 : 1)) throw new Error('Incomplete scanner matrix');
      for (const file of files) {
        const snapshot = jsonFile(join(input, file));
        if (snapshot.version !== 1 || snapshot.scanner !== scanner || snapshot.repository !== ctx.repo || snapshot.run_id !== ctx.runId) throw new Error('Current artifact identity mismatch');
        snapshots.push(...snapshot.current);
      }
      const current = [...new Map(snapshots.map(row => [row.fingerprint, row])).values()];
      const result = await prepareState({ scanner, ...ctx, current, download: async (runId, name) => {
        gh(['run', 'download', String(runId), '--repo', ctx.repo, '--name', name, '--dir', dir]);
        return jsonFile(join(dir, 'state.json'));
      } });
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, 'state.json'), JSON.stringify(result.state));
      writeFileSync(join(output, 'facts.json'), JSON.stringify(result.facts));
    } finally { rmSync(dir, { recursive: true, force: true }); }
    return;
  }
  throw new Error('Expected scope, snapshot, prepare or verify-artifact-read');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Scan policy/inventory unavailable; refusing to report a clean scan.'); process.exitCode = 1; });
}

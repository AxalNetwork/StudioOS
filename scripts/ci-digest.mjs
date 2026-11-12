#!/usr/bin/env node
/** D5619: update one CI digest comment using only trusted base scripts; every error exits zero. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { classify } from './lib/ciClassify.mjs';
import { digest, render, MARKER } from './lib/ciDigest.mjs';

export function githubApi({ repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN, fetcher = fetch } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('invalid repository');
  let requests = 0;
  return async (method, path, body) => {
    if (++requests > 150) throw new Error('request cap');
    const res = await fetcher(`https://api.github.com/repos/${repo}/${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
}
async function pages(api, path, key) {
  const result = [];
  for (let page = 1; page <= 30; page++) {
    const data = await api('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const rows = key ? data[key] : data;
    if (!Array.isArray(rows)) throw new Error('invalid GitHub response');
    result.push(...rows);
    if (rows.length < 100) return result;
  }
  throw new Error('pagination cap');
}
export async function publish({ api, pr, d, author = 'github-actions[bot]' }) {
  if (!/^[1-9]\d*$/.test(String(pr))) throw new Error('invalid pull request');
  const comments = await pages(api, `issues/${pr}/comments`);
  const existing = comments.find(c => c.user?.login === author && c.body?.startsWith(MARKER));
  let previous = null;
  try { previous = JSON.parse(/```json\n([\s\S]+?)\n```/.exec(existing?.body ?? '')?.[1]); } catch { /* recreate valid metadata on the same comment */ }
  if (previous && previous.headSha === d.headSha && previous.fingerprint === d.fingerprint) {
    d.count = previous.digestCount;
    if (render(d) === existing.body) return { updated: false, created: false };
  }
  d.count = (Number.isSafeInteger(previous?.digestCount) ? previous.digestCount : 0) + 1;
  const body = render(d);
  if (existing) await api('PATCH', `issues/comments/${existing.id}`, { body });
  else await api('POST', `issues/${pr}/comments`, { body });
  return { updated: Boolean(existing), created: !existing };
}
export async function runDigest({ api, pr, runId, headSha, artifact = null, log = console.log }) {
  try {
    if (!/^[1-9]\d*$/.test(String(runId))) throw new Error('invalid run');
    const run = await api('GET', `actions/runs/${runId}`);
    const pull = await api('GET', `pulls/${pr}`);
    // An older red run must never overwrite a newer push's digest. Forks never write.
    if (run.event !== 'pull_request' || pull.head?.sha !== headSha || pull.head?.repo?.full_name !== pull.base?.repo?.full_name) return 0;
    const jobs = await pages(api, `actions/runs/${runId}/jobs?filter=latest`, 'jobs');
    let main = null, incident = null;
    try {
      const list = await api('GET', 'actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=1');
      const latest = list.workflow_runs?.[0];
      if (latest) main = { conclusion: latest.conclusion, jobs: await pages(api, `actions/runs/${latest.id}/jobs?filter=latest`, 'jobs') };
    } catch { /* classify returns unknown; never invent an inherited verdict */ }
    try {
      const issues = await api('GET', 'issues?state=open&sort=created&direction=desc&per_page=100');
      incident = issues.find(i => !i.pull_request && i.title === '[alert] main is red')?.html_url ?? null;
    } catch { /* optional incident link */ }
    const attempts = [];
    for (let attempt = Math.max(1, (run.run_attempt ?? 1) - 10); attempt < (run.run_attempt ?? 1); attempt++) {
      attempts.push({ headSha: run.head_sha, jobs: await pages(api, `actions/runs/${runId}/attempts/${attempt}/jobs`, 'jobs') });
    }
    const d = digest({ classification: classify({ pr: jobs, main, incident }), jobs, artifact, headSha, attempts });
    await publish({ api, pr, d });
    log(`CI digest: ${d.verdict}, ${d.failures.length} failed jobs`);
  } catch { log('CI digest unavailable; advisory failure has no effect on CI.'); }
  return 0;
}
export async function pushesToGreen({ api, pr }) {
  if (!/^[1-9]\d*$/.test(String(pr))) throw new Error('invalid pull request');
  const pull = await api('GET', `pulls/${pr}`);
  const runs = await pages(api, `actions/workflows/ci.yml/runs?event=pull_request&branch=${encodeURIComponent(pull.head.ref)}`, 'workflow_runs');
  const ordered = runs.filter(r => r.pull_requests?.some(p => p.number === Number(pr))).sort((a,b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const heads = new Set();
  for (const run of ordered) { heads.add(run.head_sha); if (run.conclusion === 'success') return { pr: Number(pr), pushesToGreen: heads.size }; }
  return { pr: Number(pr), pushesToGreen: null, observedPushes: heads.size, reason: 'No green run in the bounded history' };
}
export async function main(argv = process.argv.slice(2)) {
  try {
    const api = githubApi();
    if (argv[0] === '--report') { console.log(JSON.stringify(await pushesToGreen({ api, pr: argv[1] }))); return 0; }
    const artifact = process.env.CI_DIGEST_ARTIFACT ? JSON.parse(readFileSync(process.env.CI_DIGEST_ARTIFACT, 'utf8')) : null;
    return runDigest({ api, pr: process.env.PR_NUMBER, runId: process.env.RUN_ID, headSha: process.env.HEAD_SHA, artifact });
  } catch { console.log('CI digest unavailable; advisory failure has no effect on CI.'); return 0; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 0; });

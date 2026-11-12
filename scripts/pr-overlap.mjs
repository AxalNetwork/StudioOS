#!/usr/bin/env node
/** D5616: bounded GitHub overlap report; PR refs are data, never checked out or executed. */
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { pairs, render, summary, MARKER } from './lib/prOverlap.mjs';

export function mergeTree(a, b, { cwd = process.cwd(), spawn = spawnSync } = {}) {
  if (![a, b].every(s => /^[a-f0-9]{40}$/.test(s))) return 'not checked';
  const r = spawn('git', ['merge-tree', '--write-tree', a, b], { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 60000 });
  return !r.error && r.status === 0 ? 'no' : !r.error && r.status === 1 ? 'yes' : 'not checked';
}
export function makeApi(repo, { maxRequests = 300, minRemaining = 100, exec = execFileSync } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('invalid repository');
  let count = 0, remaining = Infinity;
  const api = async (method, path, body) => {
    if (count >= maxRequests || remaining < minRemaining) throw Object.assign(new Error('request/rate limit cap'), { partial: true });
    count++;
    const raw = exec('gh', ['api', '--include', '--method', method, `repos/${repo}/${path}`,
      ...(body === undefined ? [] : ['--input', '-'])], { encoding: 'utf8', input: body === undefined ? undefined : JSON.stringify(body), maxBuffer: 12 * 1024 * 1024 });
    remaining = Number(/x-ratelimit-remaining:\s*(\d+)/i.exec(raw)?.[1] ?? remaining);
    const start = raw.search(/\r?\n\r?\n/);
    if (start < 0) throw new Error('missing API headers');
    return JSON.parse(raw.slice(start).trim() || 'null');
  };
  return api;
}
export async function upsert(api, number, body, { dryRun = false, create = true, author = 'github-actions[bot]' } = {}) {
  let comments = [];
  for (let page = 1; ; page++) {
    if (page > 30) throw Object.assign(new Error('comment cap'), { partial: true });
    const rows = await api('GET', `issues/${number}/comments?per_page=100&page=${page}`);
    comments.push(...rows);
    if (rows.length < 100) break;
  }
  const existing = comments.find(c => c.body?.startsWith(MARKER) && c.user?.login === author);
  if (existing?.body === body || dryRun || (!existing && !create)) return 0;
  if (existing) await api('PATCH', `issues/comments/${existing.id}`, { body });
  else await api('POST', `issues/${number}/comments`, { body });
  return 1;
}
export async function report({ api, dryRun = true, checkPair, maxPairs = 30, author = 'github-actions[bot]', log = console.log } = {}) {
  const prs = []; let partial = false;
  try {
    for (let page = 1; page <= 10; page++) {
      const rows = await api('GET', `pulls?state=open&per_page=100&page=${page}`);
      prs.push(...rows);
      if (rows.length < 100) break;
      if (page === 10) partial = true;
    }
    for (const pr of prs) {
      pr.files = [];
      for (let page = 1; page <= 30; page++) {
        const rows = await api('GET', `pulls/${pr.number}/files?per_page=100&page=${page}`);
        pr.files.push(...rows);
        if (rows.length < 100) break;
        if (page === 30) partial = true;
      }
    }
  } catch (error) { partial = true; log(`Partial scan: ${error.partial ? error.message : 'GitHub read failed'}`); }
  const overlaps = pairs(prs); let checks = 0;
  for (const pair of overlaps) {
    if (checks >= maxPairs || !checkPair) { partial = true; continue; }
    checks++;
    try { pair.verdict = await checkPair(pair.a, pair.b); } catch { pair.verdict = 'not checked'; }
    if (pair.verdict === 'not checked') partial = true;
  }
  const body = summary(overlaps, { partial }); log(body);
  let writes = 0;
  if (!dryRun) {
    try {
      for (const pr of prs) {
        const create = overlaps.some(p => p.a.number === pr.number || p.b.number === pr.number);
        writes += await upsert(api, pr.number, render(pr, overlaps, { partial }), { create, author });
      }
      writes += await upsert(api, 5600, body, { author });
    } catch { partial = true; log('Partial publication: GitHub refused or capped a write.'); }
  }
  return { overlaps, partial, writes };
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.some(a => !['--dry-run'].includes(a))) throw new Error('usage: pr-overlap.mjs [--dry-run]');
  const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? 'AxalNetwork/StudioOS';
  const fetched = new Map();
  const checkPair = async (a, b) => {
    for (const pr of [a, b]) {
      if (!Number.isSafeInteger(pr.number) || pr.number < 1 || !/^[a-f0-9]{40}$/.test(pr.head?.sha)) return 'not checked';
      if (!fetched.has(pr.number)) {
        execFileSync('git', ['fetch', '--no-tags', 'origin', `refs/pull/${pr.number}/head:refs/remotes/overlap/${pr.number}`], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000 });
        const sha = execFileSync('git', ['rev-parse', `refs/remotes/overlap/${pr.number}`], { encoding: 'utf8' }).trim();
        if (sha !== pr.head.sha) return 'not checked';
        fetched.set(pr.number, sha);
      }
    }
    return mergeTree(fetched.get(a.number), fetched.get(b.number));
  };
  const author = process.env.GITHUB_ACTIONS === 'true' ? 'github-actions[bot]' : JSON.parse(execFileSync('gh', ['api', 'user'], { encoding: 'utf8' })).login;
  return report({ api: makeApi(repo), dryRun: argv.includes('--dry-run'), checkPair, author });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.log('Partial overlap report: GitHub or git unavailable.'); process.exitCode = 0; });

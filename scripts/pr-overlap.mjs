#!/usr/bin/env node
/** D5616: bounded GitHub overlap report; PR refs are data, never checked out or executed. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pairs, render, summary, MARKER } from './lib/prOverlap.mjs';
import { annotate, baseAge, dedupe, isStale, mergeStatus, queueDelay, requiredChecks, requiredFromRules, snapshot, UNMEASURED } from './lib/prRisk.mjs';
import { canonicalSlot } from './lib/notificationRouting.mjs';
import { dependenciesOf, deriveIntents, recommend, unreadableWork, walkClaim, workInFlightText } from './lib/workIntent.mjs';

export function mergeTree(a, b, { cwd = process.cwd(), spawn = spawnSync } = {}) {
  if (![a, b].every(s => /^[a-f0-9]{40}$/.test(s))) return 'not checked';
  const r = spawn('git', ['merge-tree', '--write-tree', a, b], { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 60000 });
  return !r.error && r.status === 0 ? 'no' : !r.error && r.status === 1 ? 'yes' : 'not checked';
}
export function makeApi(repo, { maxRequests = 750, minRemaining = 100, exec = execFileSync } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('invalid repository');
  let count = 0, remaining = Infinity;
  const api = async (method, path, body) => {
    if (count >= maxRequests || remaining < minRemaining) throw Object.assign(new Error('request/rate limit cap'), { partial: true });
    count++;
    let raw;
    try {
      raw = exec('gh', ['api', '--include', '--method', method, `repos/${repo}/${path}`,
        ...(body === undefined ? [] : ['--input', '-'])], { encoding: 'utf8', input: body === undefined ? undefined : JSON.stringify(body), maxBuffer: 12 * 1024 * 1024 });
    } catch (error) {
      const status = Number(/^HTTP\/[\d.]+ (\d{3})/.exec(String(error?.stdout ?? ''))?.[1]);
      throw Object.assign(new Error('GitHub request failed'), Number.isInteger(status) ? { status } : {});
    }
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
const SHA = /^[a-f0-9]{40}$/;
const REF = /^(?!.*\.\.)[\w][\w./-]{0,199}$/;
const gone = error => error?.status === 404 || error?.status === 410;
/** D5580: the four evidence fields for one fresh PR. Each read fails to its own named unknown state. */
export async function evidence(api, pr, { required, now = Date.now() } = {}) {
  const e = UNMEASURED();
  e.merge = mergeStatus(pr.detail);
  const sha = pr.head?.sha;
  if (!SHA.test(sha ?? '')) return e;
  try {
    const runs = [];
    for (let page = 1; page <= 3; page++) {
      const r = await api('GET', `commits/${sha}/check-runs?per_page=100&page=${page}`);
      if (!Array.isArray(r?.check_runs)) throw new Error('unreadable');
      runs.push(...r.check_runs);
      if (r.check_runs.length < 100) break;
      if (page === 3) throw new Error('too many check runs');
    }
    e.checks = requiredChecks(runs, required);
  } catch (error) { if (error.partial) throw error; e.checks = requiredChecks(null, required); }
  try {
    const r = await api('GET', `actions/runs?head_sha=${sha}&per_page=100`);
    const ci = (r?.workflow_runs ?? []).filter(run => run?.path === '.github/workflows/ci.yml' && Number.isSafeInteger(run.id)).sort((a, b) => b.id - a.id)[0];
    if (ci) {
      const jobs = await api('GET', `actions/runs/${ci.id}/jobs?per_page=100`);
      e.queue = queueDelay(Array.isArray(jobs?.jobs) ? jobs.jobs : null, now);
      if (!Array.isArray(jobs?.jobs)) e.queue.reason = 'CI jobs unreadable';
    } else e.queue = queueDelay(null, now);
  } catch (error) { if (error.partial) throw error; e.queue = { status: 'not measured', reason: 'Actions runs unreadable', maxMinutes: null }; }
  try {
    const ref = pr.base?.ref;
    if (!REF.test(ref ?? '')) throw new Error('unsafe base ref');
    e.baseAge = baseAge(await api('GET', `compare/${encodeURIComponent(ref)}...${sha}?per_page=1`), now);
  } catch (error) { if (error.partial) throw error; e.baseAge = baseAge(null, now); }
  return e;
}
/**
 * D5580 part 2: the claim refs (D5617), the open issues labelled as claimed, their trusted STATUS comments, the slot
 * labels and the dependency issues' states, inside its own request budget so the PR comments keep theirs. Only
 * the claim-ref listing is required: if it fails the caller reports the work section Unreadable.
 */
export async function readWork(api, { maxRequests = 150, maxIssues = 40, maxDeps = 20 } = {}) {
  let used = 0, partial = false;
  const notes = [], records = [], depStates = new Map();
  const get = async path => {
    if (used >= maxRequests) throw Object.assign(new Error('work read budget reached'), { partial: true });
    used++;
    return api('GET', path);
  };
  const refs = await get('git/matching-refs/heads/claim/');
  if (!Array.isArray(refs)) throw new Error('claim refs unreadable');
  const refByIssue = new Map();
  for (const r of refs) {
    const m = /^refs\/heads\/claim\/([1-9]\d{0,6})$/.exec(r?.ref ?? '');
    if (m && SHA.test(r?.object?.sha ?? '')) refByIssue.set(Number(m[1]), r.object.sha);
  }
  const issueRows = new Map();
  let knownSlots = null;
  try {
    for (const label of ['state:in-progress', 'state:blocked', 'state:review']) {
      let rows;
      try { rows = await get(`issues?labels=${encodeURIComponent(label)}&state=open&per_page=100`); } catch (error) { if (error.partial) throw error; rows = null; }
      if (!Array.isArray(rows)) { partial = true; notes.push(`issues labelled ${label} unreadable`); continue; }
      if (rows.length >= 100) { partial = true; notes.push(`100 or more issues labelled ${label}; the first 100 read`); }
      for (const row of rows) if (Number.isSafeInteger(row?.number) && !row.pull_request) issueRows.set(row.number, row);
    }
    try {
      const slots = new Set();
      for (let page = 1; page <= 3; page++) {
        const rows = await get(`labels?per_page=100&page=${page}`);
        if (!Array.isArray(rows)) throw new Error('labels unreadable');
        for (const l of rows) { const m = /^slot:(.+)$/i.exec(l?.name ?? ''); const slot = m && canonicalSlot(m[1]); if (slot) slots.add(slot); }
        if (rows.length < 100) { knownSlots = slots; break; }
      }
    } catch (error) { if (error.partial) throw error; }
    const issues = [...new Set([...refByIssue.keys(), ...issueRows.keys()])].sort((a, b) => a - b);
    if (issues.length > maxIssues) { partial = true; notes.push(`${issues.length} claimed issues; the first ${maxIssues} read`); }
    for (const issue of issues.slice(0, maxIssues)) {
      const rec = { issue };
      try {
        if (refByIssue.has(issue)) rec.ref = await walkClaim(issue, refByIssue.get(issue), sha => get(`git/commits/${sha}`));
        rec.issueRow = issueRows.get(issue) ?? await get(`issues/${issue}`);
        rec.comments = [];
        for (let page = 1; page <= 3; page++) {
          const rows = await get(`issues/${issue}/comments?per_page=100&page=${page}`);
          if (!Array.isArray(rows)) throw new Error('comments unreadable');
          rec.comments.push(...rows);
          if (rows.length < 100) break;
          if (page === 3) { partial = true; notes.push(`#${issue}: more than 300 comments; the first 300 read`); }
        }
        if (rec.issueRow?.state) depStates.set(issue, rec.issueRow.state);
        records.push(rec);
      } catch (error) {
        if (error.partial) throw error;
        records.push({ issue, unreadable: gone(error) ? 'issue or claim gone' : 'issue, claim or comments unreadable' });
      }
    }
    const wanted = [...new Set(records.flatMap(r => dependenciesOf(r.issueRow?.body)))].filter(n => !depStates.has(n)).sort((a, b) => a - b);
    for (const n of wanted.slice(0, maxDeps)) {
      try { const row = await get(`issues/${n}`); if (['open', 'closed'].includes(row?.state)) depStates.set(n, row.state); }
      catch (error) { if (error.partial) throw error; }
    }
  } catch (error) {
    if (!error.partial) throw error;
    partial = true; notes.push(error.message === 'work read budget reached' ? 'work read budget reached; later claims not read' : 'request cap reached; later claims not read');
  }
  return { records, knownSlots, depStates, partial, notes };
}
const writeSnapshot = (path, body) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); };
export async function report({ api, dryRun = true, checkPair, maxPairs = 30, author = 'github-actions[bot]', log = console.log, blobAt, now = Date.now(), snapshotPath, repo = 'AxalNetwork/StudioOS', write = writeSnapshot, readClaims = true, isAncestor = () => null } = {}) {
  let prs = []; let partial = false; const notes = [];
  try {
    for (let page = 1; page <= 10; page++) {
      const rows = await api('GET', `pulls?state=open&per_page=100&page=${page}`);
      prs.push(...rows);
      if (rows.length < 100) break;
      if (page === 10) partial = true;
    }
    const listed = prs.length;
    prs = dedupe(prs);
    if (prs.length < listed) notes.push(`${listed - prs.length} duplicate PR row(s) from pagination removed`);
    const kept = [];
    for (const [index, pr] of prs.entries()) {
      try {
        pr.files = [];
        for (let page = 1; page <= 30; page++) {
          const rows = await api('GET', `pulls/${pr.number}/files?per_page=100&page=${page}`);
          pr.files.push(...rows);
          if (rows.length < 100) break;
          if (page === 30) partial = true;
        }
        const detail = await api('GET', `pulls/${pr.number}`);
        if (detail && !Array.isArray(detail) && typeof detail === 'object') {
          if (detail.state && detail.state !== 'open') { notes.push(`#${pr.number} closed during the scan; dropped`); continue; }
          pr.detail = detail;
          if (isStale(pr, detail)) { pr.stale = true; notes.push(`#${pr.number} head changed during the scan; marked stale, not classified`); }
        }
        kept.push(pr);
      } catch (error) {
        if (gone(error)) { notes.push(`#${pr.number} disappeared during the scan; dropped`); continue; }
        kept.push(...prs.slice(index)); prs = kept; throw error;
      }
    }
    prs = kept;
    const rules = new Map();
    for (const pr of prs) {
      if (pr.stale) continue;
      const ref = pr.base?.ref;
      if (REF.test(ref ?? '') && !rules.has(ref)) {
        try { rules.set(ref, requiredFromRules(await api('GET', `rules/branches/${encodeURIComponent(ref)}`))); }
        catch (error) { if (error.partial) throw error; rules.set(ref, null); }
      }
      pr.evidence = await evidence(api, pr, { required: rules.get(ref) ?? null, now });
    }
  } catch (error) { partial = true; log(`Partial scan: ${error.partial ? error.message : 'GitHub read failed'}`); }
  const fresh = prs.filter(pr => !pr.stale);
  const overlaps = annotate(pairs(fresh), { blobAt }); let checks = 0;
  for (const pair of overlaps) {
    if (checks >= maxPairs || !checkPair) { partial = true; continue; }
    checks++;
    try { pair.verdict = await checkPair(pair.a, pair.b); } catch { pair.verdict = 'not checked'; }
    if (pair.verdict === 'not checked') partial = true;
  }
  let work = null;
  if (readClaims) {
    try {
      const raw = await readWork(api);
      const derived = deriveIntents({ ...raw, prs, isAncestor, now, scanPartial: partial });
      recommend(derived.intents, { prs, overlaps });
      work = { status: 'read', partial: raw.partial, intents: derived.intents, refused: derived.refused, notes: [...raw.notes, ...derived.notes] };
    } catch (error) { work = unreadableWork(error?.partial ? 'request cap reached before the claim refs were read' : 'claim refs unreadable'); }
  }
  const body = summary(overlaps, { partial, notes, sections: work ? [workInFlightText(work)] : [] }); log(body);
  if (snapshotPath) {
    try {
      write(snapshotPath, JSON.stringify(snapshot({ generatedAt: new Date(now).toISOString(), repo, prs, overlaps, notes, partial, work }), null, 2) + '\n');
    } catch { log('Snapshot not written.'); }
  }
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
  return { overlaps, partial, writes, prs, notes, work };
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.some(a => a !== '--dry-run' && !/^--snapshot=[\w./-]+\.json$/.test(a))) throw new Error('usage: pr-overlap.mjs [--dry-run] [--snapshot=<path>.json]');
  const snapshotPath = argv.find(a => a.startsWith('--snapshot='))?.slice('--snapshot='.length);
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
  // D5580: base file identity at a merge base, read from the checked-out main history; null when unreadable.
  const blobAt = (sha, path) => {
    if (!/^[a-f0-9]{40}$/.test(sha) || typeof path !== 'string' || !/^[^\0-\x1f:]{1,400}$/.test(path)) return null;
    const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${sha}:${path}`], { encoding: 'utf8', timeout: 30000 });
    if (r.status === 0) return r.stdout.trim();
    const c = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { timeout: 30000 });
    return c.status === 0 ? 'absent' : null;
  };
  // D5580 part 2: whether a claim's base is on main, from the checked-out main history; null when not checkable.
  const isAncestor = sha => {
    if (!/^[a-f0-9]{40}$/.test(sha ?? '')) return null;
    const r = spawnSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { timeout: 30000 });
    return r.status === 0 ? true : r.status === 1 ? false : null;
  };
  return report({ api: makeApi(repo), dryRun: argv.includes('--dry-run'), checkPair, author, blobAt, snapshotPath, repo, isAncestor });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.log('Partial overlap report: GitHub or git unavailable.'); process.exitCode = 0; });

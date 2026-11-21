#!/usr/bin/env node
/** D8075 (#8075): read-only, advisory-first overlap check from active issues' explicit Files owned sections. */
import { readFileSync, appendFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const positive = n => Number.isSafeInteger(Number(n)) && Number(n) > 0;
const activeLabels = new Set(['state:in-progress', 'state:review']);
const labelName = label => typeof label === 'string' ? label : label?.name;

function patternOf(input, issue) {
  const value = input.replaceAll('<issue>', String(issue)).replaceAll('<this issue>', String(issue)).replace(/^\.\//, '');
  // A deliberately bounded POSIX glob subset: literals, *, **, ?, classes and flat brace alternatives.
  // No URL, shell syntax, traversal, negation, extglob or numeric/nested brace expansion.
  if (!value || value.length > 256 || !/^[\w./*?{},\[\]@-]+$/.test(value) || value.startsWith('/') || value.includes('..') || value.startsWith('!')) return null;
  if (value.split('/').some(p => !p) && !value.endsWith('/')) return null;
  if ((value.match(/\*/g) || []).length > 20) return null;
  const braces = value.match(/\{[^{}]*\}/g) || [];
  if (braces.length > 2 || value.replace(/\{[^{}]*\}/g, '').match(/[{}]/) || braces.some(b => b.split(',').length > 10)) return null;
  if (!value.includes('/') && !/\.[a-z0-9*?]+$/i.test(value)) return null;
  return value;
}

/** Only ownership sections count. Fenced examples, subsequent peer sections and explicit exclusions do not. */
export function ownedPatterns(body = '', issue) {
  if (typeof body !== 'string' || body.length > 1024 * 1024 || !positive(issue)) throw new Error('invalid ownership body');
  const patterns = new Set();
  let level = null, fence = null, excluding = false;
  for (const line of body.split(/\r?\n/)) {
    const code = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (code) { if (!fence) fence = code[1][0]; else if (fence === code[1][0]) fence = null; continue; }
    if (fence) continue;
    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const name = heading[2].replace(/[*_`]/g, '').replace(/:$/, '').trim().toLowerCase();
      if (['files owned', 'owned files'].includes(name)) { level = heading[1].length; excluding = false; }
      else if (level !== null && heading[1].length <= level) level = null;
      else if (level !== null && ['exclusions', 'excluded files', 'not owned', 'out of scope'].includes(name)) excluding = true;
      continue;
    }
    if (level === null) continue;
    if (/^\s*(?:[-*+]\s+)?(?:not(?:\s+owned)?|except|excluding|exclusions|out of scope)\s*:?\s*$/i.test(line)
      || /^\s*(?:not|except|excluding)\b.*:\s*$/i.test(line)) { excluding = true; continue; }
    if (/^\s*(?:also\s+)?owned(?:\s+files)?\s*:\s*$/i.test(line)) { excluding = false; continue; }
    if (excluding) continue;
    const included = line.split(/\b(?:not|except|excluding)\s+/i)[0];
    const add = token => { const pattern = patternOf(token, issue); if (pattern) patterns.add(pattern); };
    for (const match of included.matchAll(/`([^`\n]+)`/g)) add(match[1]);
    const plain = included.replace(/`[^`\n]*`/g, '');
    for (const token of plain.split(/\s+/)) add(token.replace(/^["'•-]+|[,;:"'.]+$/g, ''));
    if (patterns.size > 500) throw new Error('ownership pattern limit exceeded');
  }
  return [...patterns].sort();
}

/** Branch identity wins over incidental dependencies in prose; otherwise use title, closing link, then body reference. */
export function taskIssue(pr) {
  const n = /^agent\/[\w.-]+\/([1-9]\d*)-/.exec(pr.head?.ref || '')?.[1]
    || /#([1-9]\d*)\b/.exec(pr.title || '')?.[1]
    || /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part\s+of)\s+#([1-9]\d*)\b/i.exec(pr.body || '')?.[1]
    || /#([1-9]\d*)\b/.exec(pr.body || '')?.[1];
  return positive(n) ? Number(n) : null;
}

/** Match changed filenames directly, so new/deleted files and both sides of renames need no local filesystem expansion. */
export function overlaps(issue, files, issues) {
  const paths = [...new Set(files.flatMap(f => typeof f === 'string' ? [f] : [f.filename, f.previous_filename]).filter(Boolean))].sort();
  const rows = [], owners = new Map(issues.map(i => [i.number, i]));
  let comparisons = 0;
  for (const owner of [...owners.values()].sort((a, b) => a.number - b.number)) {
    if (owner.number === issue || owner.pull_request || owner.state !== 'open' || !owner.labels?.some(l => activeLabels.has(labelName(l)))) continue;
    const patterns = ownedPatterns(owner.body || '', owner.number);
    for (const file of paths) {
      const matches = patterns.filter(pattern => {
        if (++comparisons > 2000000) throw new Error('ownership comparison limit exceeded');
        return posix.matchesGlob(file, pattern.endsWith('/') ? `${pattern}**` : pattern)
          || (!posix.extname(pattern) && posix.matchesGlob(file, `${pattern}/**`));
      });
      if (matches.length) rows.push({ issue, owner: owner.number, file, patterns: matches });
    }
  }
  return rows;
}

/** Scan results exist only in this invocation. No cross-run cache may hide newly claimed ownership. */
export async function checkOwnership({ api, prNumber, expectedHead }) {
  let issue = null;
  const cache = new Map();
  const read = path => { if (!cache.has(path)) cache.set(path, Promise.resolve().then(() => api(path))); return cache.get(path); };
  async function pages(path, maxPages = 100) {
    const rows = [];
    for (let page = 1; page <= maxPages; page++) {
      const values = await read(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(values) || values.length > 100) throw new Error('invalid API inventory');
      rows.push(...values);
      if (values.length < 100) return rows;
    }
    throw new Error('API inventory page limit exceeded');
  }
  try {
    if (!positive(prNumber)) throw new Error('invalid PR');
    const pr = await read(`/pulls/${prNumber}`);
    if (expectedHead !== undefined && (!/^[a-f0-9]{40}$/.test(expectedHead || '') || pr.head?.sha !== expectedHead)) throw new Error('stale PR head');
    issue = taskIssue(pr);
    if (!issue) return { status: 'skipped', issue: null, overlaps: [], note: 'No linked task issue; ownership scan skipped.' };
    const files = await pages(`/pulls/${prNumber}/files`, 30);
    if (!Number.isSafeInteger(pr.changed_files) || pr.changed_files !== files.length || files.some(f => typeof f?.filename !== 'string' || (f.previous_filename != null && typeof f.previous_filename !== 'string'))) throw new Error('incomplete changed-file list');
    const issues = new Map();
    for (const label of activeLabels) for (const row of await pages(`/issues?state=open&labels=${encodeURIComponent(label)}`)) {
      if (!positive(row?.number) || typeof row.body !== 'string' && row.body !== null || !Array.isArray(row.labels) || row.state !== 'open') throw new Error('invalid issue inventory');
      issues.set(row.number, row);
    }
    const matches = overlaps(issue, files, [...issues.values()]);
    if (expectedHead !== undefined) {
      // Re-read identity, not the cached inventory: a push during pagination invalidates this run.
      const latest = await api(`/pulls/${prNumber}`);
      if (latest.head?.sha !== expectedHead || latest.base?.sha !== pr.base?.sha) throw new Error('PR changed during scan');
    }
    return { status: matches.length ? 'overlap' : 'clear', issue, overlaps: matches, scannedIssues: issues.size, changedFiles: files.length };
  } catch {
    // Never echo request errors: they may include credentials or an untrusted response body.
    return { status: 'unknown', issue, overlaps: [], note: 'Ownership unavailable: PR, changed files or active-issue inventory could not be read completely and safely.' };
  }
}

export const exitStatus = (report, mode) => !mode || mode === 'advisory' || ['clear', 'skipped'].includes(report.status) ? 0 : 1;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replaceAll('`', '&#96;').replace(/[\u0000-\u001f\u007f]/g, ' ');
export function renderReport(report, mode) {
  const lines = [`## Ownership (${!mode || mode === 'advisory' ? 'advisory' : 'enforced'})`, '', `Result: **${report.status}**.`, ''];
  if (report.note) lines.push(report.note, '');
  if (report.issue) lines.push(`Task: #${report.issue}. Active issues scanned: ${report.scannedIssues ?? 'Unavailable'}. Changed files: ${report.changedFiles ?? 'Unavailable'}.`, '');
  if (report.overlaps.length) {
    lines.push('| PR task | Other owning issue | Changed path | Ownership pattern |', '|---|---|---|---|');
    for (const r of report.overlaps.slice(0, 200)) lines.push(`| #${r.issue} | #${r.owner} | ${escape(r.file)} | ${r.patterns.map(escape).join(', ')} |`);
    if (report.overlaps.length > 200) lines.push('', `Showing 200 of ${report.overlaps.length} overlaps.`);
  } else if (report.status === 'clear') lines.push('No overlap with the explicit paths in active issues’ ownership sections. Undeclared or prose-only ownership is not inferred.');
  lines.push('', 'This check creates no reservation, grants no editing permission, and changes no repository settings.');
  return lines.join('\n') + '\n';
}

export function githubApi({ repository, token, fetcher = globalThis.fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || repository.split('/').some(p => ['.', '..'].includes(p))) throw new Error('invalid repository');
  if (!token) throw new Error('read-only GitHub token required');
  return async path => {
    if (!/^\/[\w/?=&%:.-]+$/.test(path) || path.includes('..') || path.startsWith('//')) throw new Error('invalid API path');
    const response = await fetcher(`https://api.github.com/repos/${repository}${path}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!response.ok) throw new Error(`GitHub read failed: HTTP ${response.status}`);
    return response.json();
  };
}

export async function main({ env = process.env, api, log = console.log } = {}) {
  let report;
  try {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    report = await checkOwnership({ api: api || githubApi({ repository: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN }), prNumber: event.pull_request?.number, expectedHead: event.pull_request?.head?.sha || null });
  } catch { report = { status: 'unknown', issue: null, overlaps: [], note: 'Ownership unavailable: event or read-only GitHub access unavailable.' }; }
  const markdown = renderReport(report, env.LANDING_OWNERSHIP_CHECK);
  log(markdown);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  return exitStatus(report, env.LANDING_OWNERSHIP_CHECK);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();

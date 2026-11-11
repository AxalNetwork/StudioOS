#!/usr/bin/env node
// D5610: advisory selection records only. CI still executes the full suite.
import { readFileSync, writeFileSync, readdirSync, existsSync, globSync } from 'node:fs';
import { resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { select, score, report, ALWAYS } from './lib/selectTests.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const runGit = (args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('git evidence unavailable');
  return r.stdout.trim();
};

export function testFiles() {
  const { scripts } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  return [...new Set(['test:frontend', 'test:worker', 'test:meeting-bot', 'test:retention'].flatMap((key) => {
    const cmd = scripts[key];
    const part = cmd.slice(cmd.indexOf(' --test ') + 8).split(' && ')[0];
    const patterns = part.match(/'[^']*'|"[^"]*"|\S+/g) || [];
    return patterns.flatMap((p) => [...globSync(p.replace(/^['"]|['"]$/g, ''), { cwd: root })]);
  }))].sort();
}

export function importGraph(tests) {
  const graph = {};
  const visit = (file) => {
    if (Object.hasOwn(graph, file)) return;
    graph[file] = [];
    let src;
    try { src = readFileSync(resolve(root, file), 'utf8'); } catch { return; }
    const re = /(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;
    for (const match of src.matchAll(re)) {
      if (!match[1].startsWith('.')) continue;
      const path = posix.normalize(posix.join(posix.dirname(file), match[1]));
      if (path.startsWith('../') || posix.isAbsolute(path)) continue;
      const dependency = [path, `${path}.mjs`, `${path}.js`, `${path}.jsx`, `${path}.ts`, `${path}.tsx`, `${path}/index.js`, `${path}/index.ts`].find((p) => existsSync(resolve(root, p))) || path;
      graph[file].push(dependency);
      if (/\.[cm]?[jt]sx?$/.test(dependency)) visit(dependency);
    }
  };
  for (const t of tests) visit(t);
  return graph;
}

function recordsIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? recordsIn(resolve(dir, d.name)) : d.name.endsWith('.json') ? [json(resolve(dir, d.name))].filter(Boolean) : []);
}

export function main(argv) {
  const value = (key, fallback) => { const i = argv.indexOf(key); return i < 0 ? fallback : argv[i + 1]; };
  if (argv.includes('--report')) {
    console.log(JSON.stringify(report(recordsIn(value('--report', '.')).filter((r) => r.kind === 'selection-shadow')), null, 2));
    return;
  }
  if (argv.includes('--backtest')) {
    const fixture = json(resolve(root, 'scripts/lib/fixtures/red_main_episodes.json'));
    const evidenceDir = value('--evidence', null);
    for (const original of fixture.episodes) {
      const evidence = evidenceDir ? json(resolve(evidenceDir, `${original.firstRedCommit}.json`)) : null;
      const episode = { ...original, ...evidence };
      if (!episode.deps || !episode.failingFiles?.length) {
        console.log(`${episode.firstRedCommit}: unscored (historic trace or failing-file evidence unavailable)`);
        continue;
      }
      const selection = select(episode);
      const result = score(selection, { verdict: 'pr_failure', failures: episode.failingFiles.map((file) => ({ file })) });
      console.log(`${episode.firstRedCommit}: ${result.misses.length ? 'MISS' : 'PASS'} ${JSON.stringify(result.misses)}`);
    }
    return;
  }
  const tests = testFiles();
  let selection = { mode: 'full', reason: 'shadow-evidence-unavailable', files: tests, fraction: 1 };
  const deps = json(resolve(root, value('--deps', 'test-deps.json')));
  let changed = [];
  try {
    const base = process.env.BASE_SHA;
    if (!/^[a-f0-9]{40}$/.test(base || '')) throw new Error('missing base');
    const fields = runGit(['diff', '--name-status', '-z', '--no-renames', `${base}...HEAD`]).split('\0');
    for (let i = 0; i + 1 < fields.length; i += 2) changed.push({ status: fields[i], path: fields[i + 1] });
    let ageCommits;
    if (/^[a-f0-9]{40}$/.test(deps?.sha || '')) {
      runGit(['merge-base', '--is-ancestor', deps.sha, base]);
      ageCommits = Number(runGit(['rev-list', '--count', `${deps.sha}..HEAD`]));
    }
    const trace = deps && { ...deps, generatedAt: deps.generatedAt || process.env.TRACE_CREATED_AT };
    selection = select({ changed, deps: trace, tests, graph: deps ? importGraph(tests) : {}, meta: { now: Date.now(), ageCommits } });
  } catch { /* a missing base, stale commit or failed read never narrows execution */ }
  const failureFiles = recordsIn(resolve(root, value('--failures', 'ci-failures')));
  // Only the agreed machine-readable contract can score. Missing/unknown schema remains unscored.
  const evidence = failureFiles.filter((f) => f.verdict === 'pr_failure' && Array.isArray(f.failures));
  const failure = evidence.length ? { verdict: 'pr_failure', failures: evidence.flatMap((f) => f.failures) } : null;
  const record = { kind: 'selection-shadow', version: 1, run: process.env.GITHUB_RUN_ID || null, sha: process.env.GITHUB_SHA || null, always: ALWAYS, ...selection, ...score(selection, failure) };
  writeFileSync(resolve(root, value('--output', 'selection-shadow.json')), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ mode: record.mode, reason: record.reason, scoring: record.scoring, misses: record.misses, selected: record.files.length, total: tests.length }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch {
    // Even an unexpected diagnostic error creates one explicitly unscored record.
    writeFileSync(resolve(root, 'selection-shadow.json'), `${JSON.stringify({ kind: 'selection-shadow', version: 1, mode: 'full', reason: 'shadow-error', scoring: 'unscored', misses: null, failing: null })}\n`);
    console.log('selection shadow: evidence unavailable; full, unscored');
  }
}

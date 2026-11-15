#!/usr/bin/env node
/**
 * #6326: the preflight for the `add-worker-endpoint` skill. It reads what this
 * branch adds or changes against `origin/main` and says which house rules a new
 * Worker route and its client method trip, before CI does.
 *
 *   node scripts/add-worker-endpoint.mjs                 report findings and the checks to run
 *   node scripts/add-worker-endpoint.mjs --base <ref>    compare against another ref (default origin/main)
 *   node scripts/add-worker-endpoint.mjs --files a,b     check these paths instead of the whole diff: a path git
 *                                                        tracks is read as changed (its lines added since the
 *                                                        merge base with --base), an untracked one as new
 *   node scripts/add-worker-endpoint.mjs --run           also run the guards and tests it names, one by one
 *   node scripts/add-worker-endpoint.mjs --json          findings and plan as JSON
 *
 * Exit code: 1 when a finding is `fail` (or, with --run, a command failed), else 0.
 * The rules are in scripts/lib/addWorkerEndpoint.mjs. It reads the working
 * tree and git only: it never reads GitHub, writes no file, and never commits
 * or pushes.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endpointFindings, exportNames, planChecks, render, HUBS } from './lib/addWorkerEndpoint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const flag = (name) => process.argv.includes(`--${name}`);

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim().slice(0, 200)}`);
  return r.stdout;
}
const read = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };

/** The lines `path` adds since `mb`, the working tree included. */
const addedLines = (mb, path) => git(['diff', '-U0', mb, '--', path]).split('\n')
  .filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));

/**
 * The named paths. One git tracks is an existing file (status M, so the new-route and
 * new-module rules do not apply to a router `index.ts` mounts by hand); its added lines
 * are those since the merge base with `base`, or none when there is no base here.
 */
function namedFiles(paths, base) {
  const tracked = new Set(git(['ls-files']).split('\n'));
  let mb = null;
  try { mb = git(['merge-base', base, 'HEAD']).trim(); } catch { /* no base: no added lines */ }
  return paths.map((path) => {
    if (!existsSync(join(ROOT, path))) return { path, status: 'D' };
    const text = read(path);
    if (!tracked.has(path)) return { path, status: 'A', text };
    return { path, status: 'M', text, added: mb ? addedLines(mb, path) : [] };
  });
}

/** Changed files against the merge base with `base`, plus uncommitted and untracked ones. */
function changedFiles(base) {
  const mb = git(['merge-base', base, 'HEAD']).trim();
  const status = new Map();
  for (const line of git(['diff', '--name-status', '--no-renames', mb]).split('\n').filter(Boolean)) {
    const [s, p] = line.split('\t');
    status.set(p, s[0]);
  }
  for (const p of git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) status.set(p, 'A');
  return [...status].map(([path, s]) => {
    if (s === 'D') return { path, status: 'D' };
    const text = read(path);
    if (s === 'A') return { path, status: 'A', text };
    return { path, status: 'M', text, added: addedLines(mb, path) };
  });
}

/** The test files and the shared `_*` helpers beside them, each with its source. */
function testSources() {
  const tests = new Map();
  const helpers = new Map();
  for (const dir of ['frontend/test', 'cloudflare-worker/test']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (/\.test\.(?:mjs|ts)$/.test(f)) tests.set(`${dir}/${f}`, read(`${dir}/${f}`));
      else if (/^_.*\.(?:mjs|ts)$/.test(f)) helpers.set(`${dir}/${f}`, read(`${dir}/${f}`));
    }
  }
  return { tests, helpers };
}

async function hubProblems() {
  try {
    const { readFreeze, freezeProblems } = await import('./lib/hubFreeze.mjs');
    const f = readFreeze(ROOT);
    return { problems: freezeProblems(f.lists, f.sources, f.hubsDoc), apiSrc: f.sources['frontend/src/lib/api.js'] };
  } catch (e) {
    console.error(`note: the hub freeze could not be read here (${String(e.message).slice(0, 120)}); run its test instead.`);
    return { problems: [], apiSrc: read('frontend/src/lib/api.js') };
  }
}

async function main() {
  const list = arg('files');
  const base = arg('base') || 'origin/main';
  const files = list ? namedFiles(list.split(',').filter(Boolean), base) : changedFiles(base);
  const { problems, apiSrc } = await hubProblems();
  const tracked = git(['ls-files']).split('\n');
  const findings = endpointFindings({ files, tracked, apiExports: exportNames(apiSrc), hubProblems: problems });
  const { tests, helpers } = testSources();
  const plan = planChecks(files.filter((f) => f.status !== 'D').map((f) => f.path), tests, helpers);

  if (flag('json')) console.log(JSON.stringify({ hubs: HUBS, files: files.map((f) => `${f.status} ${f.path}`), findings, plan }, null, 1));
  else {
    console.log(`Changed: ${files.length} file(s).`);
    console.log(render(findings, plan));
  }
  let failed = findings.some((f) => f.level === 'fail');

  if (flag('run')) {
    console.log('\nRunning:');
    for (const cmd of plan.commands) {
      const r = spawnSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 30 * 60 * 1000 });
      const tail = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-3).join(' | ');
      console.log(`  EXIT=${r.status ?? 'killed'}  ${cmd.slice(0, 120)}\n      ${tail.slice(0, 300)}`);
      if (r.status !== 0) failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(2); });

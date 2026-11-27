// D8314 (#8314, #8312) — a job that checks out part of the repository must check out every file the
// scripts it runs import. GitHub alerts' queue-stalled, main-red and queue jobs checked out `scripts`
// only; `scripts/merge-policy.mjs` (#8104) imports `merge-control/src/lib/classify.mjs`, so each run
// on main failed with ERR_MODULE_NOT_FOUND before it read anything.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/workflow_sparse_imports_8314.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';

const ROOT = process.cwd();
const WORKFLOWS = '.github/workflows';
const IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/gm;

/** Every repository file a script loads through relative imports, itself included. */
export function importClosure(entry, root = ROOT) {
  const seen = new Set();
  const walk = (file) => {
    const rel = relative(root, file);
    if (seen.has(rel) || !existsSync(file)) return;
    seen.add(rel);
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) walk(resolve(dirname(file), m[1] || m[2] || m[3]));
  };
  walk(resolve(root, entry));
  return [...seen];
}

/** Cone-mode sparse checkout: everything under each listed directory, plus the files directly in
 * each of its parent directories (the root's own files among them). */
export function coveredBy(file, sparse) {
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  return sparse.some((raw) => {
    const p = raw.replace(/\/+$/, '');
    return file === p || file.startsWith(`${p}/`) || dir === '' || p === dir || p.startsWith(`${dir}/`);
  });
}

/** Each job's sparse checkout of this repository at the workspace root, with the node scripts it runs. */
export function sparseJobs(workflow) {
  const out = [];
  for (const [id, job] of Object.entries(workflow?.jobs || {})) {
    const steps = job?.steps || [];
    const checkout = steps.find((s) => /^actions\/checkout@/.test(s?.uses || '') && s?.with?.['sparse-checkout'] && !s?.with?.path && !s?.with?.repository);
    if (!checkout) continue;
    const sparse = String(checkout.with['sparse-checkout']).split('\n').map((x) => x.trim()).filter(Boolean);
    const scripts = steps.flatMap((s) => [...String(s?.run || '').matchAll(/\bnode\s+(?:--[\w-]+(?:=\S+)?\s+)*([\w./-]+\.m?js)\b/g)].map((m) => m[1]));
    out.push({ id, sparse, scripts });
  }
  return out;
}

const workflows = readdirSync(resolve(ROOT, WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f));

test('every script a sparse-checkout job runs finds each file it imports in that checkout', () => {
  const missing = [];
  let checked = 0;
  for (const f of workflows) {
    for (const job of sparseJobs(parse(readFileSync(resolve(ROOT, WORKFLOWS, f), 'utf8')))) {
      for (const script of job.scripts) {
        if (!existsSync(resolve(ROOT, script))) continue;
        checked += 1;
        for (const file of importClosure(script)) if (!coveredBy(file, job.sparse)) missing.push(`${f} › ${job.id}: ${script} imports ${file}, outside ${job.sparse.join(', ')}`);
      }
    }
  }
  assert.ok(checked >= 7, `the scan reached the GitHub alerts jobs (${checked} scripts)`);
  assert.deepEqual(missing, []);
});

test('GitHub alerts: each job that runs github-alerts.mjs checks out merge-control/src/lib', () => {
  const jobs = sparseJobs(parse(readFileSync(resolve(ROOT, WORKFLOWS, 'github-alerts.yml'), 'utf8')));
  const running = jobs.filter((j) => j.scripts.includes('scripts/github-alerts.mjs'));
  assert.deepEqual(running.map((j) => j.id).sort(), ['file-backup', 'future-clock', 'main-red', 'ops-schedules', 'queue', 'queue-deadline', 'queue-stalled']);
  for (const j of running) assert.ok(j.sparse.includes('merge-control/src/lib'), j.id);
  assert.ok(importClosure('scripts/github-alerts.mjs').includes('merge-control/src/lib/classify.mjs'), 'the import this guards');
});

test('the scan: cone-mode coverage and the import walk', () => {
  assert.equal(coveredBy('package.json', ['scripts']), true, 'root files are always in a cone checkout');
  assert.equal(coveredBy('scripts/lib/a.mjs', ['scripts']), true);
  assert.equal(coveredBy('scriptsx/a.mjs', ['scripts']), false);
  assert.equal(coveredBy('merge-control/src/lib/classify.mjs', ['scripts']), false);
  assert.equal(coveredBy('merge-control/src/lib/classify.mjs', ['scripts', 'merge-control/src/lib/']), true);
  assert.equal(coveredBy('scripts/merge-policy.mjs', ['scripts/landing-bot']), true, 'a parent directory\'s own files are in the cone');
  assert.equal(coveredBy('scripts/lib/a.mjs', ['scripts/landing-bot']), false, 'a sibling directory is not');
  assert.equal(coveredBy('scripts/a.mjs', ['scriptsx/b']), false, 'a name that only starts the same is not a parent');
  const jobs = sparseJobs({ jobs: {
    a: { steps: [{ uses: 'actions/checkout@abc', with: { 'sparse-checkout': 'scripts\nlib\n' } }, { run: 'node --no-warnings scripts/x.mjs go && node scripts/y.mjs' }] },
    b: { steps: [{ uses: 'actions/checkout@abc', with: { 'sparse-checkout': 'scripts', path: 'control' } }, { run: 'node control/scripts/x.mjs' }] },
    c: { steps: [{ uses: 'actions/checkout@abc' }, { run: 'node scripts/x.mjs' }] },
  } });
  assert.deepEqual(jobs, [{ id: 'a', sparse: ['scripts', 'lib'], scripts: ['scripts/x.mjs', 'scripts/y.mjs'] }]);
});

test('this file is the one D8314 names', () => {
  assert.match(readFileSync(join(ROOT, 'documentation/architecture/decisions/D8314.md'), 'utf8'), /workflow_sparse_imports_8314\.test\.mjs/);
});

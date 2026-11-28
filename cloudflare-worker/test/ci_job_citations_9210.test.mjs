/**
 * #9210 — a Worker test or script may not say a CI job runs it when no
 * workflow defines that job.
 *
 * `api_drift_runtime.test.mjs` and `scripts/drift-runtime-probe.mjs` said
 * CI's `playwright-smoke` job ran the runtime drift probe. No workflow under
 * `.github/workflows/` has ever defined that job, the test was skipped unless
 * RUN_RUNTIME_DRIFT was set and failed when it was, and the PR preview it
 * would have probed has no API (`/api/*` is a JSON 404 by design, D7146). Both
 * files were removed; the static checker (`scripts/check-api-drift.mjs`,
 * `api_drift.test.mjs`) covers the same drift method-aware and against a
 * baseline. This guard keeps the suite from claiming that coverage again:
 * it fails when any file under `cloudflare-worker/test` or
 * `cloudflare-worker/scripts` names a cited CI job that no workflow defines.
 *
 * Run: node --test cloudflare-worker/test/ci_job_citations_9210.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SELF), '..', '..');

// CI job names that Worker tests and scripts have cited as running them.
// A name here must be defined by a workflow whenever a scanned file names it.
const CITED_JOBS = ['playwright-smoke'];
const SCANNED_DIRS = ['cloudflare-worker/test', 'cloudflare-worker/scripts'];
const TEXT_FILE = /\.(?:[cm]?[jt]s|json|md|sh|sql|toml|ya?ml)$/;

/** Every job id defined under a top-level `jobs:` key of a workflow file. */
export function workflowJobIds(root) {
  const dir = join(root, '.github', 'workflows');
  const ids = new Set();
  if (!existsSync(dir)) return ids;
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    let inJobs = false;
    let indent = null;
    for (const line of readFileSync(join(dir, f), 'utf8').split(/\r?\n/)) {
      if (/^\S/.test(line)) {
        inJobs = /^jobs:\s*(?:#.*)?$/.test(line);
        indent = null;
        continue;
      }
      if (!inJobs) continue;
      const m = line.match(/^( +)([A-Za-z_][A-Za-z0-9_-]*):\s*(?:#.*)?$/);
      if (!m) continue;
      if (indent === null) indent = m[1].length;
      if (m[1].length === indent) ids.add(m[2]);
    }
  }
  return ids;
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (ent.isFile() && TEXT_FILE.test(ent.name)) yield p;
  }
}

/** `<file>: <job>` for each scanned file naming a cited job no workflow defines. */
export function undefinedJobCitations(root, { jobs = CITED_JOBS, dirs = SCANNED_DIRS, exclude = [] } = {}) {
  const defined = workflowJobIds(root);
  const missing = jobs.filter((j) => !defined.has(j));
  const out = [];
  if (!missing.length) return out;
  const skip = new Set(exclude.map((p) => resolve(p)));
  for (const d of dirs) {
    for (const file of walk(join(root, d))) {
      if (skip.has(resolve(file))) continue;
      const src = readFileSync(file, 'utf8');
      for (const j of missing) if (src.includes(j)) out.push(`${relative(root, file)}: ${j}`);
    }
  }
  return out.sort();
}

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'ci-job-citations-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  return root;
}

test('#9210 — no Worker test or script cites a CI job that no workflow defines', () => {
  const found = undefinedJobCitations(REPO_ROOT, { exclude: [SELF] });
  assert.deepEqual(
    found,
    [],
    `these files say a CI job runs them, and no workflow under .github/workflows defines it:\n  ${found.join('\n  ')}\n` +
      'Remove the claim, or add the job to a workflow.',
  );
});

test('#9210 — a citation fails while the job is undefined and passes once a workflow defines it', () => {
  const cite = { 'cloudflare-worker/test/x.test.mjs': '// CI runs this on the playwright-smoke job\n' };
  const undefinedRoot = fixture({
    ...cite,
    '.github/workflows/ci.yml': 'on: push\ndefaults:\n  playwright-smoke:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    services:\n      playwright-smoke:\n        image: node\n    steps:\n      - run: echo playwright-smoke\n',
  });
  const definedRoot = fixture({
    ...cite,
    '.github/workflows/ci.yml': 'on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n  playwright-smoke: # browser smoke\n    runs-on: ubuntu-latest\n',
  });
  try {
    // A name in a step, under a key other than `jobs:`, or nested deeper than
    // the job ids defines no job.
    assert.deepEqual(undefinedJobCitations(undefinedRoot), ['cloudflare-worker/test/x.test.mjs: playwright-smoke']);
    assert.deepEqual(undefinedJobCitations(definedRoot), []);
    assert.deepEqual([...workflowJobIds(definedRoot)].sort(), ['build', 'playwright-smoke']);
  } finally {
    rmSync(undefinedRoot, { recursive: true, force: true });
    rmSync(definedRoot, { recursive: true, force: true });
  }
});

test('#9210 — scripts are scanned too, and a file outside the scanned folders is not', () => {
  const root = fixture({
    '.github/workflows/ci.yml': 'jobs:\n  build:\n    runs-on: ubuntu-latest\n',
    'cloudflare-worker/scripts/probe.mjs': '// from CI\'s playwright-smoke job\n',
    'frontend/test/y.test.mjs': '// playwright-smoke\n',
  });
  try {
    assert.deepEqual(undefinedJobCitations(root), ['cloudflare-worker/scripts/probe.mjs: playwright-smoke']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

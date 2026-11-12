/**
 * D5612 (#5612) — the route registry, the API index and the skill library are
 * generated, not committed, so every CI job that compiles, bundles or tests
 * the code builds them first.
 *
 * A job "needs" them when a step runs, directly:
 *   - `tsc`                       (the Worker and frontend typechecks),
 *   - `node … --test`             (the node test runner),
 *   - `wrangler deploy|dev|versions` (anything that bundles the Worker; `wrangler
 *                                  d1`, `r2`, `tail`, `secret` and the like read
 *                                  no source and are not counted),
 *   - `vite`                      (the SPA bundle),
 *   - `playwright test`           (its `webServer` starts vite, and its specs
 *                                  import the source; the preview smokes have
 *                                  no server but are counted too, so the rule
 *                                  stays one line).
 * Such a step must come after a step that generates them in the same job:
 * `node scripts/build-generated.mjs` (or `../scripts/…` from a subfolder), or
 * `npm run build`, whose `scripts/build-frontend.mjs` (root) and `prebuild`
 * hook (`frontend/`) both run it. `npm run test:*` and `test-drift-parts.mjs`
 * are not raw commands: their own hooks generate, so they are not counted.
 *
 * Workflows are read as text, as `workflow_security_4571.test.mjs` reads them:
 * jobs are the keys under `jobs:`, steps the `- ` items under each `steps:`,
 * and a step's command is its `run:` value or block, shell comments dropped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const DIR = new URL('.github/workflows/', ROOT);
const FILES = readdirSync(DIR).filter((n) => /\.ya?ml$/.test(n)).sort();

const indentOf = (l) => l.length - l.trimStart().length;
const isComment = (l) => l.trimStart().startsWith('#');

/** What a command needs built first, or null. */
export function needsGenerated(cmd) {
  if (/(?:^|[\s;&|(])(?:npx\s+(?:--no-install\s+)?)?tsc(?:\s|$)/m.test(cmd)) return 'tsc';
  if (/(?:^|[\s;&|(])node\b[^\n]*\s--test(?:\s|=|$)/m.test(cmd)) return 'node --test';
  if (/(?:^|[\s;&|(])(?:npx\s+(?:--no-install\s+)?)?wrangler(?:@\S+)?\s+(?:deploy|dev|versions|publish)\b/m.test(cmd)) return 'wrangler';
  if (/(?:^|[\s;&|(])(?:npx\s+(?:--no-install\s+)?)?vite(?:\s|$)/m.test(cmd)) return 'vite';
  if (/(?:^|[\s;&|(])(?:npx\s+(?:--no-install\s+)?)?playwright\s+test\b/m.test(cmd)) return 'playwright test';
  return null;
}

/** Whether a command builds the generated modules. */
export function generates(cmd) {
  return /(?:^|[\s;&|(])node\s+(?:\.\.\/)?scripts\/build-generated\.mjs\b/m.test(cmd)
    || /(?:^|[\s;&|(])npm\s+run\s+build(?:\s|$)/m.test(cmd);
}

/** `[{ job, steps: [{ name, run }] }]` for one workflow's text. */
export function jobsOf(src) {
  const lines = src.split('\n');
  const at = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (at < 0) return [];
  const jobs = [];
  let job = null;
  let stepsIndent = -1;
  let step = null;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || isComment(line)) continue;
    const ind = indentOf(line);
    if (ind === 0) break;
    if (ind === 2 && /^\s{2}[\w-]+:\s*$/.test(line)) {
      job = { job: line.trim().slice(0, -1), steps: [] };
      jobs.push(job);
      stepsIndent = -1;
      step = null;
      continue;
    }
    if (!job) continue;
    if (/^\s*steps:\s*$/.test(line)) { stepsIndent = ind; step = null; continue; }
    if (stepsIndent < 0) continue;
    if (ind <= stepsIndent && !line.trimStart().startsWith('- ')) { stepsIndent = -1; step = null; continue; }
    const t = line.trim();
    if (t.startsWith('- ') && ind <= stepsIndent + 2) {
      step = { name: '', run: '' };
      job.steps.push(step);
    }
    if (!step) continue;
    const kv = /^(?:- )?([\w-]+):\s?(.*)$/.exec(t);
    if (!kv) continue;
    if (kv[1] === 'name' && !step.name) step.name = kv[2].replace(/^['"]|['"]$/g, '');
    if (kv[1] !== 'run') continue;
    const body = [];
    if (/^[|>][-+]?\s*$/.test(kv[2])) {
      const keyIndent = ind + (t.startsWith('- ') ? 2 : 0);
      for (const next of lines.slice(i + 1)) {
        if (next.trim() && indentOf(next) <= keyIndent) break;
        body.push(next.trim());
      }
    } else {
      body.push(kv[2]);
    }
    step.run = body.filter((l) => l && !l.startsWith('#')).join('\n');
  }
  return jobs;
}

/** `["file › job › step: what"]` for every step that needs the generated modules before any step builds them. */
export function ungenerated(files) {
  const out = [];
  for (const [file, src] of files) {
    for (const { job, steps } of jobsOf(src)) {
      let built = false;
      for (const s of steps) {
        const need = needsGenerated(s.run);
        // A step that generates and then runs counts as generated when the generate comes first.
        const gi = s.run.search(/node\s+(?:\.\.\/)?scripts\/build-generated\.mjs|npm\s+run\s+build(?:\s|$)/);
        if (need && !built && !(generates(s.run) && gi >= 0 && gi < s.run.search(/tsc|--test|wrangler|vite|playwright/))) {
          out.push(`${file} › ${job} › ${s.name || s.run.split('\n')[0]}: runs ${need} before the generated modules are built`);
        }
        if (generates(s.run)) built = true;
      }
    }
  }
  return out;
}

const REAL = FILES.map((f) => [f, readFileSync(new URL(f, DIR), 'utf8')]);

test('every job that runs tsc, node --test, wrangler, vite or playwright test builds the generated modules first', () => {
  assert.deepEqual(ungenerated(REAL), [], 'add a step `run: node scripts/build-generated.mjs` (or `node ../scripts/build-generated.mjs` under a working-directory) before it');
  // The parser still sees the jobs it guards: a reader that found nothing would pass vacuously.
  const ci = jobsOf(REAL.find(([f]) => f === 'ci.yml')[1]);
  const worker = ci.find((j) => j.job === 'worker');
  assert.ok(worker && worker.steps.some((s) => needsGenerated(s.run) === 'tsc'), 'ci.yml worker no longer reads as a tsc job');
  const drift = ci.find((j) => j.job === 'drift');
  assert.ok(drift && drift.steps.some((s) => /check-api-drift\.mjs/.test(s.run)), 'ci.yml drift no longer reads as a job');
  const guarded = REAL.flatMap(([, src]) => jobsOf(src)).filter((j) => j.steps.some((s) => needsGenerated(s.run))).length;
  assert.ok(guarded >= 5, `only ${guarded} job(s) read as needing the generated modules`);
});

test('ci.yml drift builds the generated modules before check-api-drift.mjs reads the API index', () => {
  const drift = jobsOf(REAL.find(([f]) => f === 'ci.yml')[1]).find((j) => j.job === 'drift');
  const gen = drift.steps.findIndex((s) => generates(s.run));
  const check = drift.steps.findIndex((s) => /check-api-drift\.mjs/.test(s.run));
  assert.ok(gen >= 0 && gen < check, 'ci.yml drift: add `run: node scripts/build-generated.mjs` before the drift checker');
});

test('the guard flags a job with no generate step, and passes one with it', () => {
  const wf = (steps) => `name: x\non: push\njobs:\n  worker:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;
  const checkout = '      - uses: actions/checkout@0000000000000000000000000000000000000000\n';
  const tsc = '      - name: TypeScript check\n        run: npx --no-install tsc --noEmit\n';
  const gen = '      - run: node ../scripts/build-generated.mjs\n';
  assert.deepEqual(ungenerated([['x.yml', wf(checkout + tsc)]]), ['x.yml › worker › TypeScript check: runs tsc before the generated modules are built']);
  assert.deepEqual(ungenerated([['x.yml', wf(checkout + gen + tsc)]]), []);
  assert.deepEqual(ungenerated([['x.yml', wf(checkout + tsc + gen)]]).length, 1, 'a generate step after the tsc is too late');
  const block = '      - name: tests\n        run: |\n          # vite and tsc in a comment are not commands\n          node --experimental-strip-types --test a.test.ts\n';
  assert.deepEqual(ungenerated([['x.yml', wf(block)]]), ['x.yml › worker › tests: runs node --test before the generated modules are built']);
  const build = '      - run: npm run build\n      - run: npx wrangler deploy --dry-run\n';
  assert.deepEqual(ungenerated([['x.yml', wf(build)]]), []);
  assert.deepEqual(ungenerated([['x.yml', wf('      - run: npx wrangler deploy --env production\n')]]).length, 1);
  assert.deepEqual(ungenerated([['x.yml', wf('      - run: wrangler d1 export studioos-db --remote\n')]]), [], 'wrangler d1 reads no source');
  assert.deepEqual(ungenerated([['x.yml', wf('      - run: npm run test:worker\n')]]), [], 'npm run test:* generates through its pre hook');
  const pw = '      - name: visual\n        run: npx --no-install playwright test -c playwright.visual.config.js\n';
  assert.deepEqual(ungenerated([['x.yml', wf(pw)]]), ['x.yml › worker › visual: runs playwright test before the generated modules are built'], 'playwright test starts vite');
  assert.deepEqual(ungenerated([['x.yml', wf(gen + pw)]]), []);
});

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
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

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

for (const generated of [true, false]) {
  test(`fast guards load from a trusted base ${generated ? 'with' : 'without'} D5612's helper`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'trusted-fast-guards-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const put = (rel, text) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    const files = ['scripts/migration-immutability-gate.mjs', 'scripts/lib/migrationImmutability.mjs',
      'scripts/lfs-size-gate.mjs', 'scripts/check-api-drift.mjs', 'scripts/lib/apiModules.mjs', 'scripts/lib/routeRegistry.mjs'];
    for (const file of files) {
      // Older standalone helpers deliberately have no generated-output dependency.
      put(file, !generated && /lib\/(apiModules|routeRegistry)\.mjs$/.test(file)
        ? 'export const legacy = true;\n' : readFileSync(new URL(file, ROOT), 'utf8'));
    }
    if (generated) put('scripts/lib/generatedOutput.mjs', readFileSync(new URL('scripts/lib/generatedOutput.mjs', ROOT), 'utf8'));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '--quiet');
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'trusted base');
    const base = git('rev-parse', 'HEAD');
    // Working-tree content must never substitute for the archived trusted base.
    put('scripts/lib/generatedOutput.mjs', 'throw new Error("untrusted working tree");\n');
    const ci = jobsOf(REAL.find(([f]) => f === 'ci.yml')[1]);
    const run = ci.find((j) => j.job === 'fast').steps.find((s) => s.name === 'Load static checkers from the trusted base').run;
    const archive = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', run], {
      cwd: root, encoding: 'utf8', env: { ...process.env, EVENT: 'pull_request', BASE_SHA: base,
        RUNNER_TEMP: join(root, 'runner'), GITHUB_WORKSPACE: root },
    });
    assert.equal(archive.status, 0, archive.stderr);
    const trusted = join(root, 'runner/fast-guards/scripts/lib');
    const load = spawnSync(process.execPath, ['--input-type=module', '-e',
      `await import(${JSON.stringify(pathToFileURL(join(trusted, 'apiModules.mjs')).href)}); await import(${JSON.stringify(pathToFileURL(join(trusted, 'routeRegistry.mjs')).href)});`],
    { encoding: 'utf8' });
    assert.equal(load.status, 0, load.stderr);
  });
}

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


test('focused contract jobs retain generation and contracts; the required sharded CI owns full-suite coverage', () => {
  const ci = REAL.find(([file]) => file === 'ci.yml')[1];
  for (const [workflow, contracts] of [
    ['form-lightbox-contracts.yml', ['add_lightbox_d695.test.mjs', 'lightbox_d685.test.mjs']],
    ['record-page-contracts.yml', ['record_page_d696.test.mjs', 'persona_pdf_d696.test.mjs']],
  ]) {
    const source = REAL.find(([file]) => file === workflow)[1];
    const check = (contractSource, ciSource) => {
      const job = jobsOf(contractSource).find(j => j.job === 'contracts');
      assert.ok(job, workflow);
      const commands = job.steps.map(s => s.run).join('\n');
      for (const file of contracts) assert.ok(commands.includes(file), `${workflow}: ${file}`);
      assert.deepEqual(ungenerated([[workflow, contractSource]]), []);
      assert.match(commands, /check-folder-docs\.mjs/);
      assert.match(commands, /check-decision-ids\.mjs/);
      assert.match(commands, /check-dark-mode\.mjs/);
      assert.match(commands, /npm\s+run\s+build\b/);
      assert.doesNotMatch(commands, /npm\s+run\s+test:drift\b/, 'the serial duplicate suite times out; required sharded coverage stays in CI');
      assert.match(ciSource, /name: test:drift \(full suite\)/);
      assert.match(ciSource, /node scripts\/test-drift-parts\.mjs/);
    };
    check(source, ci);
    assert.throws(() => check(`${source}      - run: npm run test:drift\n`, ci));
    assert.throws(() => check(source.replace(`frontend/test/${contracts[0]}`, ''), ci));
    for (const command of ['check-folder-docs', 'check-decision-ids', 'check-dark-mode']) {
      assert.throws(() => check(source.replace(`node scripts/${command}.mjs`, 'true'), ci));
    }
    assert.throws(() => check(source.replace('run: npm run build', 'run: true'), ci));
    assert.throws(() => check(source, ci.replace('name: test:drift (full suite)', 'name: incomplete suite')));
  }
});

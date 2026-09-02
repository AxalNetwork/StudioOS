#!/usr/bin/env node
/**
 * Fails the build when the frontend does not build.
 *
 * WHY THIS EXISTS, and it is not hypothetical. `npm run test:drift` is the gate
 * a contributor runs before pushing, and every one of its twenty-odd checks is
 * a STATIC TEXT SCAN. Not one of them parses a `.jsx` file. So a change can
 * pass the whole suite — 893 frontend tests, every guard script, `tsc --noEmit`
 * on the worker — while `vite build` cannot parse the tree at all, and the only
 * thing that says so is the `frontend (build)` job in CI, one push later.
 *
 * That is exactly how two parse errors reached CI in one commit:
 *
 *   1. Renaming `FounderWorkerRail` to `WorkerRail` collided with the local
 *      `function WorkerRail(…)` that ten founder pages declare to assemble
 *      their own rail props — "Identifier `WorkerRail` has already been
 *      declared". Every test still passed, because every test reads the files
 *      as text.
 *   2. A `{/* … *\/}` comment written inside a JSX ATTRIBUTE list, where the
 *      parser expects a spread. esbuild accepts that one; rolldown, which Vite
 *      8 actually uses, does not — so even a second parser would not have
 *      caught it. Only the real bundler does.
 *
 * The lesson in both is the same: the build is the contract, and a suite that
 * never runs it is checking the wrong thing. `ci.yml` says so in as many words
 * above its `frontend` job — "if Vite can't produce docs/, the deploy is broken
 * regardless of unit tests". This puts that contract in front of the push
 * instead of after it.
 *
 * IT NEVER WRITES TO `docs/`. `frontend/vite.config.js` sets
 * `outDir: ../docs` with `emptyOutDir: true`, and `docs/` is a COMMITTED build
 * artifact — a check that rewrote 602 tracked files as a side effect of
 * checking would be worse than the bug it catches. So the output goes to a
 * fresh temp directory outside the repository, the path is asserted to be
 * outside it before the build runs, and the directory is removed afterwards.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = path.join(ROOT, 'frontend');

if (!fs.existsSync(path.join(FRONTEND, 'node_modules', 'vite'))) {
  console.error('✖ check-frontend-builds: frontend/node_modules/vite is missing.');
  console.error('  Run `npm ci` in frontend/ first — this check runs the real');
  console.error('  bundler, because a second parser is not the same contract.');
  process.exit(1);
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'studioos-buildcheck-'));

// Guard the guard. If this ever resolved inside the repo, `emptyOutDir` would
// delete tracked files before writing over them.
if (!path.relative(ROOT, out).startsWith('..')) {
  console.error(`✖ check-frontend-builds: refusing to build into ${out} — it is inside the repository.`);
  process.exit(1);
}

const started = Date.now();
const result = spawnSync(
  'npx',
  ['--no-install', 'vite', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'],
  { cwd: FRONTEND, encoding: 'utf8' },
);

fs.rmSync(out, { recursive: true, force: true });

if (result.status !== 0) {
  console.error('✖ check-frontend-builds: `vite build` failed.\n');
  console.error('  Every other check in this suite reads the source as text, so this is');
  console.error('  the only one that can see a parse error. The bundler output:\n');
  console.error([result.stdout, result.stderr].filter(Boolean).join('\n').trimEnd());
  console.error('\n  Fix the source. Do NOT run `npm run build` to reproduce it — that');
  console.error('  rewrites the committed docs/ bundle. This check builds to a temp');
  console.error('  directory; run it directly instead:');
  console.error('    node scripts/check-frontend-builds.mjs');
  process.exit(1);
}

console.log(`✓ check-frontend-builds: the frontend builds (${((Date.now() - started) / 1000).toFixed(1)}s, output discarded).`);

/**
 * D7108 (#7108): the worker-* parts of the sharded suite skip the frontend
 * install and the root SPA build.
 *
 * A worker-N-of-6 part runs only test:worker (cloudflare-worker/test/*.test.
 * {ts,mjs}). Those tests import frontend *source*, whose packages (react,
 * lucide-react, jspdf) resolve from the root node_modules, and none of them
 * reads the built docs/ or frontend/node_modules. The root `npm run build`
 * needs vite from frontend/node_modules, so both steps are skipped together.
 * The frontend-* parts and rest, which hold every test that opens docs/,
 * install everything and build.
 *
 * This file pins:
 *   1. the exact `if` on 'Install frontend deps' and 'Build the SPA' in
 *      ci.yml's suite job and runner-benchmark.yml's benchmark job;
 *   2. no `if` on 'Install worker deps' and 'Install root deps' (the root
 *      install's line after its name stays `run: npm ci`, #5972);
 *   3. no worker test names the root docs/ or frontend/node_modules, so a
 *      soft `existsSync(docs)` skip cannot pass a worker part silently.
 * Each assertion has a mutation case below.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const ci = read('.github/workflows/ci.yml');
const benchmark = read('.github/workflows/runner-benchmark.yml');

const SKIP_WORKER = "${{ !startsWith(matrix.part, 'worker') }}";

/** The text of one top-level job. */
export function jobText(src, id) {
  const lines = src.split('\n');
  const start = lines.indexOf(`  ${id}:`);
  assert.ok(start >= 0, `missing ${id} job`);
  const next = lines.findIndex((l, i) => i > start && /^ {2}\S/.test(l));
  return lines.slice(start, next < 0 ? undefined : next).join('\n') + '\n';
}

/** `{ if, next }` for the named step: its `if:` values and the line after `name:`. */
export function stepOf(job, name) {
  const block = job.split(/^ {6}- /m).find((b) => b.startsWith(`name: ${name}\n`));
  assert.ok(block, `missing step ${name}`);
  return {
    ifs: [...block.matchAll(/^ {8}if: (.+)$/gm)].map((m) => m[1]),
    next: block.split('\n')[1].trim(),
  };
}

export function assertWorkerPartsShape(src, id) {
  const job = jobText(src, id);
  assert.deepEqual(stepOf(job, 'Install frontend deps').ifs, [SKIP_WORKER], `${id}: frontend deps skip only the worker parts`);
  assert.deepEqual(stepOf(job, 'Build the SPA').ifs, [SKIP_WORKER], `${id}: the SPA build skips only the worker parts`);
  assert.deepEqual(stepOf(job, 'Install worker deps').ifs, [], `${id}: every part installs the worker deps`);
  const root = stepOf(job, 'Install root deps');
  assert.deepEqual(root.ifs, [], `${id}: every part installs the root deps`);
  assert.equal(root.next, 'run: npm ci', `${id}: the root install stays a plain lockfile install (#5972)`);
}

// Paths that name the root docs/ build or the frontend's installed packages.
const FORBIDDEN = [
  /frontend\/node_modules/,
  /['"`]frontend['"`]\s*,\s*['"`]node_modules['"`]/,
  /(?:\.\.\/)+docs(?:\/|['"`])/,
  /(?:join|resolve)\([^)\n]*['"`]docs['"`]/,
  /['"`]docs\/(?:index\.html|assets|_headers|\.assetsignore)/,
];

/** `["file: pattern"]` for every worker test that names the root docs/ or frontend/node_modules. */
export function workerTestsReadingFrontendBuild(files) {
  const out = [];
  for (const [file, text] of files) {
    for (const re of FORBIDDEN) if (re.test(text)) out.push(`${file}: ${re}`);
  }
  return out;
}

const TEST_DIR = new URL('cloudflare-worker/test/', ROOT);
const WORKER_TESTS = readdirSync(TEST_DIR)
  .filter((n) => /\.test\.(?:ts|mjs)$/.test(n))
  .sort()
  .map((n) => [`cloudflare-worker/test/${n}`, readFileSync(new URL(n, TEST_DIR), 'utf8')]);

test('ci.yml: the worker-* suite parts skip the frontend install and the SPA build, and nothing else', () => {
  assertWorkerPartsShape(ci, 'suite');
  const frontendDeps = "        run: npm ci\n        if: ${{ !startsWith(matrix.part, 'worker') }}\n";
  const build = "        run: npm run build\n        if: ${{ !startsWith(matrix.part, 'worker') }}\n";
  assert.ok(ci.includes(frontendDeps) && ci.includes(build));
  // Mutations: the build skipped for rest too, the condition dropped, the
  // worker or root install skipped, the root install given a fallback.
  assert.throws(() => assertWorkerPartsShape(ci.replace(build, "        run: npm run build\n        if: ${{ startsWith(matrix.part, 'frontend') }}\n"), 'suite'));
  assert.throws(() => assertWorkerPartsShape(ci.replace(frontendDeps, '        run: npm ci\n'), 'suite'));
  assert.throws(() => assertWorkerPartsShape(ci.replace(
    'name: Install worker deps\n        working-directory: cloudflare-worker\n        run: npm ci\n',
    `name: Install worker deps\n        working-directory: cloudflare-worker\n        run: npm ci\n        if: ${SKIP_WORKER}\n`), 'suite'));
  assert.throws(() => assertWorkerPartsShape(ci.replace(
    'name: Install root deps\n        run: npm ci\n',
    `name: Install root deps\n        run: npm ci\n        if: ${SKIP_WORKER}\n`), 'suite'));
});

test('runner-benchmark.yml carries the same two conditions, so its steps match the suite (D5611)', () => {
  assertWorkerPartsShape(benchmark, 'benchmark');
  assert.throws(() => assertWorkerPartsShape(benchmark.replace(
    "        run: npm run build\n        if: ${{ !startsWith(matrix.part, 'worker') }}\n", '        run: npm run build\n'), 'benchmark'));
});

test('no worker test reads the root docs/ build or frontend/node_modules', () => {
  assert.ok(WORKER_TESTS.length > 100, 'the worker tests were read');
  assert.deepEqual(workerTestsReadingFrontendBuild(WORKER_TESTS), []);
  // Mutations: each shape of the dependency a worker part could no longer meet.
  for (const line of [
    "const docs = join(ROOT, 'docs'); if (!existsSync(docs)) return;",
    "readFileSync(new URL('../../docs/index.html', import.meta.url))",
    "import('../../frontend/node_modules/vite/dist/node/index.js')",
    "resolve(ROOT, 'frontend', 'node_modules', '.bin', 'vite')",
    "const html = 'docs/index.html';",
  ]) {
    assert.equal(workerTestsReadingFrontendBuild([['cloudflare-worker/test/x.test.ts', line]]).length > 0, true, line);
  }
  // A repository path in a fixture (another repo's docs/ folder) is not the build.
  assert.deepEqual(workerTestsReadingFrontendBuild([['x.test.ts', "designProposals('docs/adr/0001-ledger.md', ADR, true)"]]), []);
});

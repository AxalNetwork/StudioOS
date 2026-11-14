/**
 * #6326: the mutation check's decisions, apart from the file system and the
 * test runner. Which spec is valid, what a mutation does to a file's text,
 * which command runs a test file (with the loader its suite needs), which
 * tests a TAP report says failed, whether a mutation was caught, and the one
 * summary line that goes into STATUS and the PR's Testing section
 * ("N mutations, N caught, N equivalent (why)"). AGENTS.md § House rules
 * (**Tests**): "Mutation-check every new assertion both ways."
 * Owned by `../mutation-check.mjs`; tested in `mutationCheck.test.mjs`.
 */

import { createHash } from 'node:crypto';

/**
 * Each test folder and the argv its package.json script runs it with (one
 * file at a time). Order matters: the first prefix that matches wins.
 */
export const RUNNERS = [
  { prefix: 'cloudflare-worker/test/', exts: ['.test.ts', '.test.mjs'],
    argv: ['--experimental-strip-types', '--no-warnings', '--import', './cloudflare-worker/test/_ts-loader.mjs', '--test'],
    script: 'test:worker' },
  { prefix: 'frontend/test/', exts: ['.test.mjs'],
    argv: ['--import', './frontend/test/_deck-loader.mjs', '--test'],
    script: 'test:frontend' },
  { prefix: 'meeting-bot/test/', exts: ['.test.ts'],
    argv: ['--experimental-strip-types', '--no-warnings', '--test'],
    script: 'test:meeting-bot' },
  { prefix: 'merge-control/test/', exts: ['.test.ts'],
    argv: ['--experimental-strip-types', '--no-warnings', '--import', './merge-control/test/runtime-loader.mjs', '--test'],
    script: 'test:merge-control' },
  { prefix: 'scripts/lib/', exts: ['.test.mjs'], argv: ['--test'], script: 'test:retention' },
  // Other scripts/** tests (scripts/claude-review/review.test.mjs) run in their
  // own workflow (.github/workflows/claude-review.yml), not a package.json script.
  { prefix: 'scripts/', exts: ['.test.mjs'], argv: ['--test'], script: null },
];

/** Paths a mutation may never touch: build output, dependencies, git itself. */
const FORBIDDEN = [/^docs\//, /(^|\/)node_modules\//, /^\.git\//];

/** A repository-relative path with no `..`, no leading `/` and no backslash. */
export function isRepoPath(p) {
  if (typeof p !== 'string' || !p || p.startsWith('/') || p.includes('\\')) return false;
  return !p.split('/').some((seg) => seg === '..' || seg === '' || seg === '.');
}

/** A test file is one a runner above knows; anything else → null. */
export function runnerFor(testPath) {
  for (const r of RUNNERS) {
    if (testPath.startsWith(r.prefix) && r.exts.some((e) => testPath.endsWith(e))) return r;
  }
  return null;
}

/** `node` argv for one test file, TAP output so failures can be named. */
export function testArgv(testPath) {
  const r = runnerFor(testPath);
  if (!r) return null;
  return [...r.argv, '--test-reporter=tap', testPath];
}

/** The same command as a copy-paste shell line (no TAP flag: for a person). */
export function testCommandLine(testPath) {
  const r = runnerFor(testPath);
  return r ? ['node', ...r.argv, testPath].join(' ') : null;
}

/** Of a list of changed paths, the test files a runner knows, sorted. */
export function changedTests(paths) {
  return [...new Set(paths.filter((p) => runnerFor(p)))].sort();
}

/**
 * Validate a spec: `[{ id?, file, find, replace, test, expect?, equivalent? }]`
 * or `{ mutations: [...] }`. Returns `{ mutations, errors }`; every mutation
 * gets an id (`m1`, `m2`, … when none is given).
 */
export function parseSpec(json) {
  const list = Array.isArray(json) ? json : json && Array.isArray(json.mutations) ? json.mutations : null;
  if (!list) return { mutations: [], errors: ['the spec is a JSON array, or an object with a "mutations" array'] };
  const errors = [];
  const ids = new Set();
  const mutations = list.map((m, i) => {
    const id = m && typeof m.id === 'string' && m.id ? m.id : `m${i + 1}`;
    const where = `mutation ${id}`;
    if (!m || typeof m !== 'object') { errors.push(`${where}: not an object`); return null; }
    if (ids.has(id)) errors.push(`${where}: id used twice`);
    ids.add(id);
    for (const k of ['file', 'find', 'test']) {
      if (typeof m[k] !== 'string' || !m[k]) errors.push(`${where}: "${k}" is a non-empty string`);
    }
    if (typeof m.replace !== 'string') errors.push(`${where}: "replace" is a string (empty deletes "find")`);
    if (typeof m.find === 'string' && m.find === m.replace) errors.push(`${where}: "replace" equals "find", so nothing changes`);
    for (const k of ['file', 'test']) {
      if (typeof m[k] === 'string' && m[k] && !isRepoPath(m[k])) errors.push(`${where}: "${k}" is not a repository-relative path`);
      if (typeof m[k] === 'string' && FORBIDDEN.some((re) => re.test(m[k]))) errors.push(`${where}: "${k}" is under docs/, node_modules/ or .git/`);
    }
    if (typeof m.test === 'string' && m.test && !runnerFor(m.test)) errors.push(`${where}: no known runner for test "${m.test}"`);
    if (m.file && m.file === m.test) errors.push(`${where}: mutates the test itself; break the code it protects`);
    if (m.expect !== undefined && (typeof m.expect !== 'string' || !m.expect)) errors.push(`${where}: "expect" is a non-empty string`);
    if (m.equivalent !== undefined && (typeof m.equivalent !== 'string' || !m.equivalent.trim())) errors.push(`${where}: "equivalent" is the reason, a non-empty string`);
    return { id, file: m.file, find: m.find, replace: m.replace, test: m.test, expect: m.expect, equivalent: m.equivalent };
  }).filter(Boolean);
  return { mutations, errors };
}

/** Count non-overlapping occurrences of `needle` in `hay`. */
export function countOccurrences(hay, needle) {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** Apply one mutation to a file's text. `find` must occur exactly once. */
export function applyMutation(text, m) {
  const n = countOccurrences(text, m.find);
  if (n === 0) return { ok: false, error: `"find" is not in ${m.file}` };
  if (n > 1) return { ok: false, error: `"find" occurs ${n} times in ${m.file}; quote more of the line so it occurs once` };
  const i = text.indexOf(m.find);
  return { ok: true, text: text.slice(0, i) + m.replace + text.slice(i + m.find.length) };
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Undo the TAP reporter's escaping of a test name (`\\#` → `#`, `\\\\` → `\\`). */
export function unescapeTapName(name) {
  return name.replace(/\\([\\#])/g, '$1');
}

/**
 * Names of the tests a TAP report marks `not ok` (any depth), in order,
 * unescaped. A `#` comment is only a SKIP/TODO directive when the `#` is
 * unescaped; an escaped `\#` is part of the name.
 */
export function failedTests(tap) {
  const out = [];
  for (const line of String(tap).split('\n')) {
    const m = /^\s*not ok \d+ - ((?:[^\\#]|\\.)*?)(?:\s+#\s+(?:SKIP|TODO)\b.*)?\s*$/.exec(line);
    if (m) out.push(unescapeTapName(m[1].trim()));
  }
  return out;
}

/**
 * Whether a failing name is the file-level entry node --test writes when a
 * test file fails as a whole (it does not load, or exits early): the name is
 * the file's path, relative or absolute. Such a failure names no test.
 */
export function isFileEntry(name, testPath) {
  return name === testPath || name.endsWith(`/${testPath}`);
}

/** TAP's summary counts (`# pass 3`, `# fail 1`), or null when it has none. */
export function tapCounts(tap) {
  const get = (k) => { const m = new RegExp(`^# ${k} (\\d+)$`, 'm').exec(String(tap)); return m ? Number(m[1]) : null; };
  const pass = get('pass'); const fail = get('fail');
  return pass === null && fail === null ? null : { pass: pass ?? 0, fail: fail ?? 0 };
}

/**
 * The verdict for one mutated run.
 * - `caught`: the test failed, and (with `expect`) a failing test's name contains it.
 * - `wrong_failure`: it failed, but not in the test `expect` names: another
 *   test, or only the file-level entry (named after the test file's path) that
 *   node writes when the file does not load.
 * - `equivalent`: it passed, and the spec gave a reason it cannot be told apart.
 * - `survived`: it passed and no reason was given. Strengthen the test.
 * - `timeout`: the run was stopped; not counted as caught.
 */
export function verdict(m, run) {
  if (run.timedOut) return 'timeout';
  if (run.code !== 0) {
    if (!m.expect) return 'caught';
    return failedTests(run.output).some((name) => !isFileEntry(name, m.test) && name.includes(m.expect))
      ? 'caught' : 'wrong_failure';
  }
  return m.equivalent ? 'equivalent' : 'survived';
}

/**
 * The one line for STATUS `tests:` and the PR's Testing section:
 * `N mutations, N caught, N equivalent (why)`, plus what failed the run.
 */
export function summaryLine(results) {
  const by = (v) => results.filter((r) => r.verdict === v);
  const eq = by('equivalent');
  const why = eq.length ? ` (${eq.map((r) => `${r.id}: ${r.equivalent}`).join('; ')})` : '';
  let line = `${results.length} mutations, ${by('caught').length} caught, ${eq.length} equivalent${why}`;
  for (const v of ['survived', 'wrong_failure', 'timeout', 'error']) {
    const rs = by(v);
    if (rs.length) line += `, ${rs.length} ${v.replace('_', ' ')} (${rs.map((r) => r.id).join(', ')})`;
  }
  return line;
}

/** The run passes only when every mutation was caught or is a named equivalent. */
export function runPassed(results, baselineOk, restoredOk) {
  return baselineOk && restoredOk && results.length > 0
    && results.every((r) => r.verdict === 'caught' || r.verdict === 'equivalent');
}

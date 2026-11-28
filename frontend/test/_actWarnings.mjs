// D9211 (#9211): React's "not wrapped in act(...)" warnings, held to a baseline.
//
// A warning means a state update landed after the test's last act-wrapped
// flush: the test asserted, or unmounted, before the work it started had
// finished. Under machine load the same race turns into a failed assertion
// (the data room flake of #9211), so the count is kept from rising.
//
// `_deck-loader.mjs` imports this, so it runs in every frontend test file's
// own process (node:test runs each file in a child, NODE_TEST_CONTEXT=child…).
// It counts the console.error calls whose text says "not wrapped in act" and,
// when the process exits, fails the file if it printed more than
// `act-warnings-baseline.json` allows it (a file not listed is allowed none).
// The count is per file, so it holds in each CI shard alone.
//
// The baseline only goes down: `act_warnings_baseline_9211.test.mjs` holds its
// total to a ceiling written in that test. After fixing a file's warnings,
// lower or remove its entry. To re-measure the whole suite:
//   ACT_WARNINGS_RECORD=/abs/counts.jsonl npm run test:frontend
//   node frontend/test/_actWarnings.mjs --write /abs/counts.jsonl [more.jsonl …]
// (--write keeps the highest count each file printed across the runs given).
import { format } from 'node:util';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARK = 'not wrapped in act';
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const BASELINE_PATH = fileURLToPath(new URL('./act-warnings-baseline.json', import.meta.url));

/** The file's key in the baseline: its path from the repository root, with forward slashes. */
export function fileKey(path, root = ROOT) {
  return relative(root, path).split(sep).join('/');
}

/** The baseline's `files` map; a missing or malformed file is an error, never "no limit". */
export function readBaseline(path = BASELINE_PATH) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data || typeof data.files !== 'object' || Array.isArray(data.files)) throw new Error(`${path}: expected { "files": { … } }`);
  return data.files;
}

/** Whether one console.error call is an act warning. */
export function isActWarning(args) {
  return format(...args).includes(MARK);
}

/** null when `count` is within what the baseline allows the file, else the failure message. */
export function verdict(key, count, files) {
  const allowed = Number.isInteger(files[key]) ? files[key] : 0;
  if (count <= allowed) return null;
  return `act warnings: ${key} printed ${count} "${MARK}" warning${count === 1 ? '' : 's'}; ` +
    `frontend/test/act-warnings-baseline.json allows it ${allowed}. Wait for the update inside act ` +
    "before asserting or unmounting (frontend/test/_waitUntil.mjs's waitForAct), never raise the baseline.";
}

/** Install the counter in a node:test child running a test file; returns null anywhere else. */
export function watch({ env = process.env, argv = process.argv, root = ROOT, target = console } = {}) {
  if (!String(env.NODE_TEST_CONTEXT || '').startsWith('child')) return null;
  const file = argv[1];
  if (!file) return null;
  const key = fileKey(file, root);
  const baselinePath = env.ACT_WARNINGS_BASELINE || BASELINE_PATH;
  // A frontend test file; ACT_WARNINGS_BASELINE (another baseline) is the guard test's hook for its fixture.
  if (!env.ACT_WARNINGS_BASELINE && !(key.startsWith('frontend/test/') && /\.test\.m?[jt]s$/.test(key))) return null;
  const state = { key, count: 0 };
  const original = target.error;
  target.error = function error(...args) {
    if (isActWarning(args)) state.count += 1;
    return original.apply(this, args);
  };
  process.on('exit', () => {
    if (env.ACT_WARNINGS_RECORD && state.count > 0) appendFileSync(env.ACT_WARNINGS_RECORD, `${JSON.stringify({ file: key, count: state.count })}\n`);
    let message;
    try { message = verdict(key, state.count, readBaseline(baselinePath)); }
    catch (error) { message = `act warnings: the baseline could not be read (${error.message})`; }
    if (!message) return;
    process.stderr.write(`\n${message}\n`);
    process.exitCode = 1;
  });
  return state;
}

/** --write: the highest count per file across the recorded runs, sorted, as the baseline. */
export function baselineFrom(lines) {
  const files = {};
  for (const line of lines) {
    if (!line.trim()) continue;
    const { file, count } = JSON.parse(line);
    if (typeof file !== 'string' || !Number.isInteger(count) || count < 1) throw new Error(`bad record: ${line}`);
    files[file] = Math.max(files[file] || 0, count);
  }
  const sorted = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
  return { total: Object.values(sorted).reduce((a, b) => a + b, 0), files: sorted };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv[2] === '--write') {
  const lines = process.argv.slice(3).flatMap((p) => readFileSync(p, 'utf8').split('\n'));
  const data = baselineFrom(lines);
  writeFileSync(BASELINE_PATH, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`wrote ${fileKey(BASELINE_PATH)}: ${data.total} warnings in ${Object.keys(data.files).length} files`);
} else {
  watch();
}

// D9211 (#9211): React's "not wrapped in act(...)" warnings may not rise.
//
// `_actWarnings.mjs` (imported by `_deck-loader.mjs`, so in every frontend test
// file's process) counts them per file and fails a file that prints more than
// `act-warnings-baseline.json` allows it. This holds the baseline itself: its
// total may not pass CEILING, so it only goes down. Lower CEILING with the
// baseline when a fix removes warnings; never raise either.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/act_warnings_baseline_9211.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE_PATH, ROOT, baselineFrom, fileKey, readBaseline, verdict } from './_actWarnings.mjs';
import { readCounter, waitForAct } from './_waitUntil.mjs';

/** The suite's act-warning total after #9211. It may only be lowered. */
const CEILING = 66;

const FIXTURE = fileURLToPath(new URL('./act_warning_9211.fixture.mjs', import.meta.url));
const LOADER = fileURLToPath(new URL('./_deck-loader.mjs', import.meta.url));

test('the baseline: sorted, positive, each an existing frontend test file, its total stated and within the ceiling', () => {
  // Mutation checked: CEILING raised above the total is allowed (≤, not ===); a total that disagrees with its files fails.
  const data = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const keys = Object.keys(data.files);
  assert.deepEqual(keys, [...keys].sort(), 'files are listed in sorted order');
  for (const [key, n] of Object.entries(data.files)) {
    assert.match(key, /^frontend\/test\/[\w.-]+\.test\.mjs$/, key);
    assert.ok(existsSync(join(ROOT, key)), `${key} is listed but does not exist; remove its entry`);
    assert.ok(Number.isInteger(n) && n > 0, `${key}: ${n} (a file with none is left out)`);
  }
  assert.equal(data.total, Object.values(data.files).reduce((a, b) => a + b, 0), 'total is the sum of the files');
  assert.ok(data.total <= CEILING, `the baseline total ${data.total} is above the ceiling ${CEILING}: fix the warnings instead`);
});

test('the verdict: within the allowance passes, one more fails naming the file and both counts', () => {
  // Mutation checked: `count <= allowed` → `<` fails the at-baseline case; an unlisted file allowed any → the 0 case passes;
  // the last run's count kept instead of the highest → b is 1.
  assert.equal(verdict('frontend/test/a.test.mjs', 2, { 'frontend/test/a.test.mjs': 2 }), null);
  assert.match(verdict('frontend/test/a.test.mjs', 3, { 'frontend/test/a.test.mjs': 2 }), /a\.test\.mjs printed 3 .*allows it 2/);
  assert.equal(verdict('frontend/test/b.test.mjs', 0, {}), null);
  assert.match(verdict('frontend/test/b.test.mjs', 1, {}), /printed 1 "not wrapped in act" warning; .*allows it 0/);
  assert.equal(fileKey(join(ROOT, 'frontend/test/x.test.mjs')), 'frontend/test/x.test.mjs');
  assert.deepEqual(baselineFrom(['{"file":"frontend/test/b.test.mjs","count":3}', '{"file":"frontend/test/a.test.mjs","count":2}', '{"file":"frontend/test/b.test.mjs","count":1}', '']),
    { total: 5, files: { 'frontend/test/a.test.mjs': 2, 'frontend/test/b.test.mjs': 3 } }, 'the highest count per file, sorted');
  assert.throws(() => readBaseline(FIXTURE), /./, 'an unreadable baseline is an error, never "no limit"');
});

function run(count, allowed) {
  const dir = mkdtempSync(join(tmpdir(), 'act-9211-'));
  try {
    const baseline = join(dir, 'baseline.json');
    const record = join(dir, 'counts.jsonl');
    writeFileSync(baseline, JSON.stringify({ total: allowed, files: allowed ? { [fileKey(FIXTURE)]: allowed } : {} }));
    const env = { ...process.env, ACT_WARNINGS_BASELINE: baseline, ACT_WARNINGS_RECORD: record, ACT_WARNING_COUNT: String(count) };
    delete env.NODE_TEST_CONTEXT; // a fresh node:test run, not a child of this one
    const r = spawnSync(process.execPath, ['--import', LOADER, '--test', FIXTURE], { cwd: ROOT, env, encoding: 'utf8', timeout: 60_000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, recorded: existsSync(record) ? readFileSync(record, 'utf8') : '' };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a real React act warning is counted in the test file\'s own process, and one over the baseline fails the file', () => {
  // Mutation checked: console.error not wrapped → nothing counted, the over-baseline run passes; exitCode not set → the same.
  const at = run(2, 2);
  assert.equal(at.status, 0, at.out);
  assert.deepEqual(JSON.parse(at.recorded), { file: fileKey(FIXTURE), count: 2 }, 'both warnings counted, under its key');
  const over = run(2, 1);
  assert.equal(over.status, 1, over.out);
  assert.match(over.out, /printed 2 "not wrapped in act" warnings; .*allows it 1/);
  const none = run(0, 0);
  assert.equal(none.status, 0, none.out);
  assert.equal(none.recorded, '', 'a file with no warning records nothing');
});

test('readCounter holds a read as out until it settles, and waitForAct waits for it rather than for a number of turns', async () => {
  // Mutation checked: the counter not counting a promise → out is 0 while the read is still open; waitForAct returning before ready → done is false.
  const reads = readCounter();
  let answer;
  const read = reads.wrap(() => new Promise((resolve) => { answer = resolve; }));
  const sync = reads.wrap(() => 'now');
  assert.equal(sync(), 'now', 'a plain value is passed through and not counted');
  const pending = read();
  assert.equal(reads.out, 1, 'the open read is counted');
  let done = false;
  const timer = setTimeout(() => answer('late'), 30);
  await waitForAct(() => reads.out === 0, { label: 'the read', timeoutMs: 5000 }).then(() => { done = true; });
  clearTimeout(timer);
  assert.equal(done, true);
  assert.equal(await pending, 'late');
  const failing = reads.wrap(async () => { throw new Error('refused'); });
  await assert.rejects(failing(), /refused/, 'a refusal still reaches the caller');
  assert.equal(reads.out, 0, 'and is no longer out');
  await assert.rejects(waitForAct(() => false, { label: 'never', timeoutMs: 20, describe: () => 'still out' }), /Timed out waiting for never: still out/);
});

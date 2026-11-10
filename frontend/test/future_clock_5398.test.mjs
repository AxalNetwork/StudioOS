/**
 * D5398: the nightly future-clock run moves every clock a test reads, not only
 * JavaScript's `Date` (scripts/future-clock.mjs, scripts/future-clock-check.mjs,
 * .github/workflows/github-alerts.yml).
 *
 * On 2026-11-10 the run moved `Date` alone and reported 817 failures. Most
 * were the harness: a fixture seeds `datetime('now')` in SQLite, which kept
 * the real clock, so a step-up minted "now" looked a week old. A test that
 * runs a script with its own env (only PATH) ran that script on the real
 * clock too. In production D1 and the Worker read one clock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clockVars, withClock } from '../../scripts/future-clock.mjs';
import { clockReport } from '../../scripts/future-clock-check.mjs';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const DAY = 86_400_000;

test('clockVars carries libfaketime and nothing else', () => {
  assert.deepEqual(
    clockVars({ LD_PRELOAD: '/x/libfaketime.so.1', FAKETIME: '+7d', FAKETIME_DONT_RESET: '1', PATH: '/bin', HOME: '/h' }),
    { LD_PRELOAD: '/x/libfaketime.so.1', FAKETIME: '+7d', FAKETIME_DONT_RESET: '1' },
  );
});

test('withClock puts the clock back into an env a test set itself, and leaves every other argument alone', () => {
  const vars = { LD_PRELOAD: '/x/libfaketime.so.1', FAKETIME: '+7d' };
  const [cmd, args, opts] = withClock(['bash', ['drill.sh'], { env: { PATH: '/bin' }, encoding: 'utf8' }], vars);
  assert.equal(cmd, 'bash');
  assert.deepEqual(args, ['drill.sh']);
  assert.deepEqual(opts, { env: { LD_PRELOAD: '/x/libfaketime.so.1', FAKETIME: '+7d', PATH: '/bin' }, encoding: 'utf8' });
  // exec(cmd, opts, cb): the options sit second, the callback is untouched.
  const cb = () => {};
  const [, o2, c2] = withClock(['date', { env: {} }, cb], vars);
  assert.deepEqual(o2.env, vars);
  assert.equal(c2, cb);
  // No env of its own: the child inherits process.env, which already has the clock.
  const plain = { cwd: '/tmp' };
  assert.equal(withClock(['bash', ['x'], plain], vars)[2], plain);
  // A test that sets the clock on purpose keeps its own value.
  assert.equal(withClock(['bash', [], { env: { FAKETIME: '+1d' } }], vars)[2].env.FAKETIME, '+1d');
  // The command itself is never treated as options, even an object-looking one.
  const first = { env: { PATH: '/bin' } };
  assert.equal(withClock([first], vars)[0], first);
});

test('clockReport passes only when JavaScript, SQLite and a clean-env shell all lead by the same days', () => {
  const real = Date.parse('2026-11-10T13:00:00Z');
  const ahead = real + 7 * DAY;
  assert.equal(clockReport({ days: 7, real, js: ahead, sqlite: ahead + 1000, shell: ahead - 1000 }).ok, true);
  // The 2026-11-10 run: Date moved, SQLite and the shell did not.
  const dateOnly = clockReport({ days: 7, real, js: ahead, sqlite: real, shell: real });
  assert.equal(dateOnly.ok, false);
  assert.deepEqual(dateOnly.clocks.sqlite, { lead_days: 0, ok: false });
  // libfaketime without the loader: a script started with only PATH kept the real clock.
  assert.equal(clockReport({ days: 7, real, js: ahead, sqlite: ahead, shell: real }).ok, false);
  // A shell that could not run is not a pass.
  assert.equal(clockReport({ days: 7, real, js: ahead, sqlite: ahead, shell: NaN }).clocks.shell.ok, false);
  // Ten minutes either side is the clock; more is not.
  assert.equal(clockReport({ days: 7, real, js: ahead + 11 * 60_000, sqlite: ahead, shell: ahead }).ok, false);
});

test('the nightly job preloads libfaketime, proves the clock moved, then runs the part', () => {
  const wf = read('.github/workflows/github-alerts.yml');
  const job = wf.slice(wf.indexOf('  future-clock-part:'), wf.indexOf('  future-clock:\n'));
  assert.match(job, /apt-get install -y -qq age faketime/);
  assert.match(job, /FAKETIME: '\+7d'/);
  assert.match(job, /FAKETIME_DONT_FAKE_MONOTONIC: '1'/, 'test timers keep the real monotonic clock');
  assert.match(job, /export LD_PRELOAD=\/usr\/lib\/x86_64-linux-gnu\/faketime\/libfaketime\.so\.1/);
  assert.match(job, /export NODE_OPTIONS="--import=\$GITHUB_WORKSPACE\/scripts\/future-clock\.mjs"/);
  const check = job.indexOf('node scripts/future-clock-check.mjs');
  const runPart = job.indexOf('node scripts/test-drift-parts.mjs');
  assert.ok(check > 0 && check < runPart, 'the clock is proved before any test runs');
  // The check is not swallowed: only the part's own exit is.
  assert.doesNotMatch(job, /future-clock-check\.mjs[^\n]*\|\| true/);
});

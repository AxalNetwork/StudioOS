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
import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { RUNS_UNSHIFTED, clockVars, withClock, withoutPreload, wrapForClock } from '../../scripts/future-clock.mjs';
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

test('workerd alone starts without the preload: it dies under libfaketime and wrangler waits forever', () => {
  assert.ok(RUNS_UNSHIFTED.test('/repo/node_modules/@cloudflare/workerd-linux-64/bin/workerd'));
  assert.ok(RUNS_UNSHIFTED.test('workerd'));
  for (const cmd of ['bash', 'node', '/x/wrangler', '/x/workerd-helper', 'workerd.sh']) assert.equal(RUNS_UNSHIFTED.test(cmd), false, cmd);
  const inherited = { LD_PRELOAD: '/x/libfaketime.so.1', FAKETIME: '+7d', PATH: '/bin' };
  // spawn(cmd, args, opts) with an env of its own: only LD_PRELOAD goes.
  const [, a1, o1] = withoutPreload(['workerd', ['serve'], { env: { ...inherited, A: '1' }, stdio: 'pipe' }], inherited);
  assert.deepEqual(a1, ['serve']);
  assert.deepEqual(o1, { env: { FAKETIME: '+7d', PATH: '/bin', A: '1' }, stdio: 'pipe' });
  // No options: the inherited env, without the preload, becomes its env.
  assert.deepEqual(withoutPreload(['workerd', ['serve']], inherited)[2], { env: { FAKETIME: '+7d', PATH: '/bin' } });
  // spawn(cmd, opts): the options sit second.
  assert.deepEqual(withoutPreload(['workerd', { cwd: '/w' }], inherited)[1], { cwd: '/w', env: { FAKETIME: '+7d', PATH: '/bin' } });
});

test('a wrapped execFile or exec still promisifies to { stdout, stderr }, with the clock in a child that set its own env (#7664)', async () => {
  // On the nightly, cached_route_fixtures_5503's two child-process tests read
  // `(await promisify(execFile)(...)).stdout` as undefined: the bare wrapper
  // had lost util.promisify.custom, so the promise resolved stdout alone.
  const vars = { FAKETIME: '+7d' };
  const print = 'process.stdout.write(String(process.env.FAKETIME)); process.stderr.write("e")';
  const runFile = promisify(wrapForClock(execFile, vars));
  const pending = runFile(process.execPath, ['-e', print], { env: { PATH: process.env.PATH } });
  assert.equal(typeof pending.child?.pid, 'number', 'the promise carries its child, as Node\'s does');
  assert.deepEqual(await pending, { stdout: '+7d', stderr: 'e' });
  const runShell = promisify(wrapForClock(exec, vars));
  assert.deepEqual(await runShell(`"${process.execPath}" -e 'process.stdout.write(String(process.env.FAKETIME))'`, { env: { PATH: process.env.PATH } }), { stdout: '+7d', stderr: '' });
  // A failing child rejects with its output attached, as the unwrapped one does.
  const failure = await runFile(process.execPath, ['-e', 'process.stdout.write("out"); process.exit(3)']).then(() => null, (error) => error);
  assert.equal(failure?.code, 3);
  assert.equal(failure.stdout, 'out');
  // A function without a custom promisify gets none.
  assert.equal(wrapForClock(function plain() {}, vars)[promisify.custom], undefined);
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
  assert.match(job, /needs: future-clock-plan/);
  assert.match(job, /--plan-file suite-plan\.json/);
  const check = job.indexOf('node scripts/future-clock-check.mjs');
  const runPart = job.indexOf('node scripts/future-clock-producer.mjs');
  assert.ok(check > 0 && check < runPart, 'the clock is proved before any test runs');
  // The check is not swallowed: only the part's own exit is.
  assert.doesNotMatch(job, /future-clock-check\.mjs[^\n]*\|\| true/);
});

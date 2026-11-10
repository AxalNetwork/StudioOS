/**
 * Moves the clock ahead for a whole test run, to find date-bound tests before
 * their date arrives (2026-11-09: D5052 and D5039 broke every PR at noon and
 * 14:30 UTC, each a fixture with a fixed date beside a component reading
 * `Date.now()`; 2026-11-10: D976's booking slot, #5466).
 *
 * Loaded with `--import`, through NODE_OPTIONS so every test process gets it.
 *
 * Two modes:
 *
 *   1. libfaketime (what the nightly job runs, D5398). The job preloads
 *      libfaketime with FAKETIME='+7d', so the operating system's clock moves
 *      for the whole process: `Date`, node:sqlite's `datetime('now')` and a
 *      shell's `date` all agree, as D1 and the Worker agree in production. This
 *      loader shifts nothing itself here. It only puts the libfaketime
 *      variables back into a child process that a test starts with an env of
 *      its own (`spawnSync('bash', [script], { env: { PATH } })`), which would
 *      otherwise run on the real clock and disagree with its parent.
 *
 *   2. No libfaketime (a quick local look):
 *        FUTURE_CLOCK_DAYS=7 NODE_OPTIONS="--import=$PWD/scripts/future-clock.mjs" node scripts/test-drift-parts.mjs frontend-1-of-2
 *      `Date.now()` and `new Date()` read real time plus the offset; `new Date(x)`
 *      is unchanged. SQLite and child processes still read the real clock, so a
 *      test that seeds `datetime('now')` and reads it back through `Date.now()`
 *      fails here and nowhere else. On 2026-11-10 that was most of the 817
 *      "failures" the alert named. Use mode 1 before calling a test date-bound.
 *
 * A test that freezes the clock with `mock.timers` sees its own frozen time in
 * both modes, which is the point: those tests are already safe. With neither
 * set, it does nothing.
 */
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

/** The variables that carry libfaketime into a process. */
export const clockVars = (env) => Object.fromEntries(
  Object.entries(env).filter(([k]) => k === 'LD_PRELOAD' || k.startsWith('FAKETIME')),
);

/** Each options argument (after the command) that sets its own env, with the clock variables it lacks put back. */
export const withClock = (args, vars) => args.map((a, i) => (
  i > 0 && a && typeof a === 'object' && !Array.isArray(a) && a.env && typeof a.env === 'object'
    ? { ...a, env: { ...vars, ...a.env } }
    : a
));

if (process.env.FAKETIME && /faketime/.test(process.env.LD_PRELOAD || '')) {
  const vars = clockVars(process.env);
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    const real = childProcess[name];
    childProcess[name] = function (...args) { return real.apply(this, withClock(args, vars)); };
  }
  syncBuiltinESMExports();
} else {
  const days = Number(process.env.FUTURE_CLOCK_DAYS || 0);
  if (Number.isFinite(days) && days !== 0) {
    const offset = days * 86_400_000;
    const RealDate = globalThis.Date;
    class ShiftedDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(RealDate.now() + offset);
        else super(...args);
      }
      static now() { return RealDate.now() + offset; }
    }
    globalThis.Date = ShiftedDate;
  }
}

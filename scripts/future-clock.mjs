/**
 * Moves the clock ahead for a whole test run, to find date-bound tests before
 * their date arrives (2026-11-09: D5052 and D5039 broke every PR at noon and
 * 14:30 UTC, each a fixture with a fixed date beside a component reading
 * `Date.now()`).
 *
 * Loaded with `--import`, through NODE_OPTIONS so every test process gets it:
 *   FUTURE_CLOCK_DAYS=7 NODE_OPTIONS="--import=$PWD/scripts/future-clock.mjs" node scripts/test-drift-parts.mjs frontend-1-of-2
 *
 * `Date.now()` and `new Date()` read real time plus the offset; `new Date(x)`
 * is unchanged. A test that freezes the clock with `mock.timers` still sees
 * its own frozen time, which is the point: those tests are already safe.
 * Unset or 0, it does nothing.
 */
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

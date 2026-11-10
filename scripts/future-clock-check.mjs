#!/usr/bin/env node
/**
 * Proves the nightly future-clock job's clock really moved before it runs a
 * test (D5398). Run under libfaketime and scripts/future-clock.mjs, exactly as
 * the job runs its parts. It fails the job unless all three clocks a test can
 * read sit FUTURE_CLOCK_DAYS ahead of the real one:
 *   - JavaScript's `Date.now()`;
 *   - node:sqlite's `datetime('now')`, which fixtures seed rows with;
 *   - `date` in a shell started with an env of its own (only PATH), as a
 *     test that runs a script does.
 * The real clock is a new file's modification time, which the kernel stamps
 * and libfaketime does not touch. A clock that did not move would report
 * "nothing breaks in 7 days" for a run that never looked; one that moved for
 * JavaScript only reported 817 false failures on 2026-11-10.
 */
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const DAY = 86_400_000;
const TOLERANCE = 10 * 60_000;

/** Each clock's lead over the real one, in days, and whether it is within ten minutes of `days`. */
export function clockReport({ days, real, js, sqlite, shell }) {
  const lead = (t) => (t - real) / DAY;
  const rows = { js, sqlite, shell };
  const out = {};
  for (const [name, t] of Object.entries(rows)) {
    out[name] = { lead_days: Number.isFinite(t) ? Number(lead(t).toFixed(3)) : null, ok: Number.isFinite(t) && Math.abs(t - real - days * DAY) <= TOLERANCE };
  }
  return { days, ok: Object.values(out).every((r) => r.ok), clocks: out };
}

function readClocks() {
  const dir = mkdtempSync(join(tmpdir(), 'future-clock-'));
  try {
    const file = join(dir, 'stamp');
    writeFileSync(file, '');
    const real = statSync(file).mtimeMs;
    const js = Date.now();
    const sqlite = Date.parse(`${new DatabaseSync(':memory:').prepare("SELECT datetime('now') AS t").get().t.replace(' ', 'T')}Z`);
    const r = spawnSync('bash', ['-c', 'date -u +%s'], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    const shell = r.status === 0 ? Number(r.stdout.trim()) * 1000 : NaN;
    return { real, js, sqlite, shell };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const days = Number(process.env.FUTURE_CLOCK_DAYS || 0);
  const report = clockReport({ days, ...readClocks() });
  console.log(JSON.stringify(report));
  if (!(days > 0) || !report.ok) {
    console.error(`::error::the clock did not move ${days} day(s) for every reader; the future-clock run would not test what it reports`);
    process.exit(1);
  }
}

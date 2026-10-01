/**
 * D201 — the scheduler's record tells the truth.
 *
 * HQ · Platform showed five of the six declared cron triggers as silent while
 * their work ran. Three causes, each guarded here:
 *
 *   1. A tick that found the queue lease held returned WITHOUT A ROW, so when
 *      two expressions fired in one minute the record showed which one won
 *      the lease, not whether the minute ran. It now records `deduped` or
 *      `skipped`.
 *   2. The reader aged every trigger against one 26-hour window, cut off with
 *      an ISO string, over rows stored as `YYYY-MM-DD HH:MM:SS`. It now reads
 *      each declared trigger against its own schedule, at minute granularity,
 *      in the store's format.
 *   3. The declared list was a comment, "must be kept in sync". It is now
 *      compared against both wrangler tables by a test.
 *
 * And one the build found: Cloudflare numbers weekdays 1 = Sunday, so the
 * "Monday" weekly trigger fired on Sundays. The matcher speaks that dialect.
 *
 * Fixtures are real `node:sqlite` over the baseline's own DDL, and rows are
 * written by the production writers, never hand-typed in a format the writer
 * does not use: the old test aged its rows as ISO strings, which is how it
 * came to agree with the bug.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

import { nextCronRun, parseCron, prevCronRun, sqlStamp } from '../src/util/cronSchedule.ts';
import {
  CRON_TRIGGERS, FAILED_STATUSES, STALE_GRACE_MINUTES, TRIGGER_STATES,
  classifyLeaseHeld, latestRunPerTrigger, leaseHolderValue, parseLeaseHolder,
  recordLeaseHeldFire, triggerState, writeCronRunHistory,
} from '../src/util/cronHistory.ts';
import { BRANCH_CRONS } from '../../scripts/lib/branchConfig.mjs';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const SQL_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const at = (iso: string) => new Date(iso);

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
  };
}

/** `cron_run_history` exactly as the baseline declares it, index included. */
function historyDb() {
  const baseline = read('cloudflare-worker/sql/schema_baseline.sql');
  const start = baseline.indexOf('CREATE TABLE cron_run_history (');
  assert.ok(start >= 0, 'cron_run_history is no longer defined in schema_baseline.sql');
  const db = new DatabaseSync(':memory:');
  db.exec(baseline.slice(start, baseline.indexOf(');', start) + 2));
  db.exec('CREATE INDEX idx_crh_trigger_time ON cron_run_history(trigger_name, started_at)');
  return db;
}

const rows = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare('SELECT * FROM cron_run_history ORDER BY id').all() as any[];

/* ── The matcher: Cloudflare's dialect ─────────────────────────────────── */

test('weekdays are Cloudflare\'s: 1 is Sunday, 2 is Monday', () => {
  // The production fact this was built from: the trigger declared as
  // `0 9 * * 1` recorded 2026-08-23 09:00:24, and that date is a Sunday.
  assert.equal(at('2026-08-23T00:00:00Z').getUTCDay(), 0, 'the fixture date is not a Sunday');
  assert.equal(prevCronRun('0 9 * * 1', at('2026-08-23T09:00:24Z')), '2026-08-23 09:00:00');
  // From a Wednesday, the last `1` is the Sunday and the last `2` the Monday.
  assert.equal(prevCronRun('0 9 * * 1', at('2026-09-23T10:00:00Z')), '2026-09-20 09:00:00');
  assert.equal(prevCronRun('0 9 * * 2', at('2026-09-23T10:00:00Z')), '2026-09-21 09:00:00');
  assert.equal(nextCronRun('0 9 * * 2', at('2026-09-23T10:00:00Z')), '2026-09-28 09:00:00');
  assert.equal(nextCronRun('0 0 * * 7', at('2026-09-23T10:00:00Z')), '2026-09-26 00:00:00', '7 is Saturday');
});

test('a range reads as a range and a step as a step', () => {
  // The copy this replaced ran `parseInt` on each field, so `2-6` read as 2.
  assert.equal(prevCronRun('0 9 * * 2-6', at('2026-09-20T12:00:00Z')), '2026-09-18 09:00:00',
    'a weekday range read from a Sunday lands on the Friday before');
  assert.equal(prevCronRun('0 */6 * * *', at('2026-09-23T05:59:59Z')), '2026-09-23 00:00:00');
  assert.equal(prevCronRun('0 */6 * * *', at('2026-09-23T06:00:00Z')), '2026-09-23 06:00:00');
  assert.equal(nextCronRun('15-45/15 * * * *', at('2026-09-23T10:31:00Z')), '2026-09-23 10:45:00');
  assert.equal(nextCronRun('0 3,15 * * *', at('2026-09-23T03:00:00Z')), '2026-09-23 15:00:00');
});

test('next is strictly after, previous is at or before, across day and year edges', () => {
  assert.equal(nextCronRun('* * * * *', at('2026-09-23T10:00:30Z')), '2026-09-23 10:01:00');
  assert.equal(prevCronRun('* * * * *', at('2026-09-23T10:00:30Z')), '2026-09-23 10:00:00');
  assert.equal(prevCronRun('0 3 * * *', at('2026-09-23T03:00:00Z')), '2026-09-23 03:00:00');
  assert.equal(prevCronRun('0 3 * * *', at('2026-09-23T02:59:59Z')), '2026-09-22 03:00:00');
  assert.equal(prevCronRun('59 23 31 12 *', at('2026-01-01T00:00:00Z')), '2025-12-31 23:59:00');
  assert.equal(prevCronRun('0 0 1 * *', at('2026-03-15T00:00:00Z')), '2026-03-01 00:00:00');
  assert.equal(prevCronRun('0 0 29 2 *', at('2026-09-23T00:00:00Z')), '2024-02-29 00:00:00');
  // Both directions answer in the store's own format.
  for (const v of [nextCronRun('0 4 * * *', at('2026-09-23T10:00:00Z')),
                   prevCronRun('0 4 * * *', at('2026-09-23T10:00:00Z'))]) {
    assert.match(String(v), SQL_FORMAT);
  }
});

test('anything the matcher does not read is refused, never guessed', () => {
  for (const expr of [
    '0 9 * * MON', '0 9 * JAN *', '0 9 * * 0', '0 9 * * 8', '0 9 L * *', '0 9 * * 6L',
    '0 9 * * 2#1', '0 9 ? * 2', '5/15 * * * *', '0 9 1 * 2', '* * * *', '* * * * * *',
    '60 * * * *', '*/0 * * * *', '1,,2 * * * *', '3-1 * * * *', '',
  ]) {
    assert.equal(parseCron(expr), null, `"${expr}" was read rather than refused`);
    assert.equal(prevCronRun(expr, at('2026-09-23T10:00:00Z')), null);
    assert.equal(nextCronRun(expr, at('2026-09-23T10:00:00Z')), null);
  }
});

test('every declared trigger parses', () => {
  for (const t of CRON_TRIGGERS) {
    assert.ok(parseCron(t.expr), `the declared trigger ${t.name} (${t.expr}) cannot be read`);
  }
});

/* ── The lease-held tick leaves a row ──────────────────────────────────── */

const SCHEDULED = Date.parse('2026-09-23T03:00:00Z');
const CLOCK = () => new Date('2026-09-23T03:00:41Z');

test('a tick that finds the lease held by the SAME minute records deduped', async () => {
  const db = historyDb();
  const holder = leaseHolderValue('uuid-a', SCHEDULED, '* * * * *');
  const status = await recordLeaseHeldFire({ DB: makeD1(db) } as any,
    { triggerName: '0 3 * * *', scheduledTime: SCHEDULED + 812, holder }, { now: CLOCK });
  assert.equal(status, 'deduped');
  const [row] = rows(db);
  assert.equal(row.trigger_name, '0 3 * * *');
  assert.equal(row.status, 'deduped');
  assert.equal(row.started_at, '2026-09-23 03:00:00', 'the row stands for the scheduled minute');
  assert.equal(row.finished_at, '2026-09-23 03:00:41');
  assert.match(row.started_at, SQL_FORMAT);
  assert.match(row.finished_at, SQL_FORMAT);
  assert.match(String(row.summary), /'\* \* \* \* \*' tick scheduled for the same minute holds the lease/);
  assert.equal(row.error, null, 'a deduped minute is not an error');
});

test('a tick that finds the lease held by an EARLIER minute records skipped, and says so', async () => {
  const db = historyDb();
  const holder = leaseHolderValue('uuid-b', SCHEDULED - 60_000, '* * * * *');
  const status = await recordLeaseHeldFire({ DB: makeD1(db) } as any,
    { triggerName: '* * * * *', scheduledTime: SCHEDULED, holder }, { now: CLOCK });
  assert.equal(status, 'skipped');
  const [row] = rows(db);
  assert.equal(row.status, 'skipped');
  assert.match(String(row.error), /scheduled for 02:59 UTC, which had not finished; this tick ran nothing/);
  assert.equal(row.summary, null);
  assert.ok(FAILED_STATUSES.has(row.status), 'a skipped minute must read as work that did not run');
});

test('a holder from a LATER minute, or one that recorded no minute, is skipped too', () => {
  const later = classifyLeaseHeld({
    triggerName: '0 3 * * *', scheduledTime: SCHEDULED,
    holder: leaseHolderValue('u', SCHEDULED + 60_000, '* * * * *'),
  });
  assert.equal(later.status, 'skipped');
  assert.match(later.text, /a later minute than this one; this tick ran nothing/);

  // A bare UUID is what the handler wrote before D201. It can only be read in
  // the lease's 90 seconds after the deploy, and it cannot say which minute
  // it holds, so the honest reading is that this minute is not known to run.
  const legacy = classifyLeaseHeld({ triggerName: '0 3 * * *', scheduledTime: SCHEDULED, holder: 'b7c1-uuid' });
  assert.equal(legacy.status, 'skipped');
  assert.match(legacy.text, /scheduled time was not recorded/);
});

test('the lease value round-trips, and the id alone still decides who releases it', () => {
  const v = leaseHolderValue('id-1', SCHEDULED, '0 */6 * * *');
  assert.deepEqual(parseLeaseHolder(v), { scheduledTime: SCHEDULED, cron: '0 */6 * * *' });
  assert.notEqual(v, leaseHolderValue('id-2', SCHEDULED, '0 */6 * * *'),
    'two ticks in one minute would each think they hold the lease');
  assert.deepEqual(parseLeaseHolder('bare-uuid'), { scheduledTime: null, cron: null });
});

test('recording a lease-held tick never throws', async () => {
  const broken = { DB: { prepare() { throw new Error('no such table: cron_run_history'); } } };
  const status = await recordLeaseHeldFire(broken as any,
    { triggerName: '0 3 * * *', scheduledTime: SCHEDULED, holder: leaseHolderValue('u', SCHEDULED, '* * * * *') },
    { now: CLOCK, retries: 0, baseDelayMs: 1 });
  assert.equal(status, null);
});

/* ── Reading a trigger against its own schedule ────────────────────────── */

const row = (started_at: string, status = 'completed') =>
  ({ trigger_name: 'x', started_at, finished_at: started_at, status, error: null });

test('the same-date boundary reads by time, not by where the ISO "T" sorts', () => {
  // A daily run 7 hours ago, stored in the writer's format. The old reader
  // compared it to an ISO cutoff: on the same date ' ' sorts before 'T', so a
  // fresh run read as stale for part of every day.
  const s = triggerState('0 3 * * *', row('2026-09-23 03:00:36'), at('2026-09-23T10:00:00Z'));
  assert.equal(s.state, 'ok');
  assert.equal(s.expected_at, '2026-09-23 03:00:00');
  // And a stray ISO row (the retired /cron-log route bound whatever it was
  // sent) is read by its time too, in BOTH directions. The second assertion
  // is the one that needs the normalisation: on the same date 'T' sorts above
  // ' ', so without it an ISO row from BEFORE the scheduled minute reads as
  // after it, and a missed 03:00 run looks fresh. The first passes either way.
  assert.equal(triggerState('0 3 * * *', row('2026-09-23T03:00:36.000Z'), at('2026-09-23T10:00:00Z')).state, 'ok');
  assert.equal(triggerState('0 3 * * *', row('2026-09-23T02:59:00.000Z'), at('2026-09-23T10:00:00Z')).state, 'stale',
    'an ISO row from before the scheduled minute read as after it');
});

test('a weekly trigger is fresh six days out, and stale once its next Monday passes', () => {
  const monday = row('2026-09-21 09:00:40', 'deduped');
  assert.equal(triggerState('0 9 * * 2', monday, at('2026-09-27T08:00:00Z')).state, 'ok', 'day 6 read as silent');
  assert.equal(triggerState('0 9 * * 2', monday, at('2026-09-28T09:10:00Z')).state, 'ok', 'inside the grace');
  const late = triggerState('0 9 * * 2', monday, at('2026-09-28T09:20:00Z'));
  assert.equal(late.state, 'stale', 'a missed Monday was not noticed');
  assert.equal(late.expected_at, '2026-09-28 09:00:00');
});

test('the every-minute trigger is fresh at 7 minutes and stale at 17', () => {
  const now = at('2026-09-23T10:30:00Z');
  assert.equal(triggerState('* * * * *', row('2026-09-23 10:23:05'), now).state, 'ok');
  assert.equal(triggerState('* * * * *', row('2026-09-23 10:13:05'), now).state, 'stale',
    'a scheduler dead for 17 minutes read as healthy');
});

test('a long tick still inside its sixteen minutes is not silent, and one past it is', () => {
  // Today's 03:00 tick was dispatched 50s late and is still running at
  // 03:15:30 — a scheduled invocation may run 15 minutes and writes its row
  // only as it ends. The newest row is yesterday's.
  const yesterday = row('2026-09-22 03:00:40');
  assert.equal(triggerState('0 3 * * *', yesterday, at('2026-09-23T03:15:30Z')).state, 'ok',
    'a tick inside its time limit was called silent');
  assert.equal(triggerState('0 3 * * *', yesterday, at('2026-09-23T03:17:00Z')).state, 'stale',
    'a tick past its time limit and dispatch lag was still trusted');
});

test('the four states, in precedence: never, stale, failed, ok', () => {
  assert.deepEqual([...TRIGGER_STATES], ['never', 'stale', 'failed', 'ok']);
  const now = at('2026-09-23T10:00:00Z');
  assert.equal(triggerState('0 3 * * *', null, now).state, 'never');
  assert.equal(triggerState('0 3 * * *', row('2026-09-20 03:00:30', 'failed'), now).state, 'stale',
    'a trigger that stopped firing is newer news than the failure of its last run');
  for (const st of ['failed', 'skipped', 'error']) {
    assert.equal(triggerState('0 3 * * *', row('2026-09-23 03:00:30', st), now).state, 'failed', st);
  }
  for (const st of ['completed', 'deduped']) {
    assert.equal(triggerState('0 3 * * *', row('2026-09-23 03:00:30', st), now).state, 'ok', st);
  }
  // No writer leaves a row without finished_at, so nothing reads as running.
  assert.ok(!(TRIGGER_STATES as readonly string[]).includes('running'));
});

test('an expression the matcher cannot read is never called stale', () => {
  const s = triggerState('0 9 * * MON', row('2020-01-01 00:00:00'), at('2026-09-23T10:00:00Z'));
  assert.equal(s.expected_at, null);
  assert.equal(s.state, 'ok', 'nothing says when it should have fired, so it cannot be late');
});

test('the latest row per trigger is read per trigger, newest first', async () => {
  const db = historyDb();
  const env = { DB: makeD1(db) } as any;
  await writeCronRunHistory(env, { triggerName: '0 3 * * *', startedAt: '2026-09-21 03:00:30', cronError: null, summary: [] });
  await writeCronRunHistory(env, { triggerName: '0 3 * * *', startedAt: '2026-09-23 03:00:30', cronError: 'boom', summary: [] });
  await writeCronRunHistory(env, { triggerName: '0 3 * * *', startedAt: '2026-09-22 03:00:30', cronError: null, summary: [] });
  const latest = await latestRunPerTrigger(env, ['0 3 * * *', '0 4 * * *']);
  assert.equal(latest.get('0 3 * * *')?.started_at, '2026-09-23 03:00:30');
  assert.equal(latest.get('0 3 * * *')?.status, 'failed');
  assert.equal(latest.get('0 4 * * *'), null, 'a trigger with no row must come back as no row');
});

test('a row dated in the future is not a run, so it cannot keep a stopped trigger reading ok', async () => {
  const db = historyDb();
  const env = { DB: makeD1(db) } as any;
  await writeCronRunHistory(env, { triggerName: '0 3 * * *', startedAt: '2026-09-22 03:00:30', cronError: null, summary: [] });
  // Hand-written on purpose: no tick can produce this row. It is what the
  // retired POST /api/infra/cron-log would bind for any admin who sent it.
  db.prepare(`INSERT INTO cron_run_history (trigger_name, started_at, finished_at, status)
              VALUES ('0 3 * * *', '2030-01-01 00:00:00', '2030-01-01 00:00:01', 'completed')`).run();
  const now = at('2026-09-23T10:00:00Z');
  const latest = await latestRunPerTrigger(env, ['0 3 * * *'], now);
  assert.equal(latest.get('0 3 * * *')?.started_at, '2026-09-22 03:00:30',
    'the future-dated row was read as the newest run');
  // And the trigger reads as what it is: its 03:00 run today never landed.
  assert.equal(triggerState('0 3 * * *', latest.get('0 3 * * *') ?? null, now).state, 'stale');
  // A row a minute ahead of the reader's clock is skew, not a forgery, and still counts.
  await writeCronRunHistory(env, { triggerName: '0 3 * * *', startedAt: '2026-09-23 10:00:40', cronError: null, summary: [] });
  assert.equal((await latestRunPerTrigger(env, ['0 3 * * *'], now)).get('0 3 * * *')?.started_at,
    '2026-09-23 10:00:40', 'a row inside the minute of clock skew was dropped');
});

/* ── One module owns the table ─────────────────────────────────────────── */

function workerSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(name)) out.push(p);
    }
  };
  walk(resolve(ROOT, 'cloudflare-worker/src'));
  return out;
}

test('only util/cronHistory writes cron_run_history, and nothing reads the whole table per trigger', () => {
  const writers: string[] = [];
  for (const file of workerSources()) {
    const src = readFileSync(file, 'utf8');
    if (/INSERT\s+INTO\s+cron_run_history/i.test(src)) writers.push(relative(ROOT, file));
    assert.doesNotMatch(src, /FROM\s+cron_run_history\s+GROUP\s+BY\s+trigger_name/i,
      `${relative(ROOT, file)} reads the whole table to find the newest row per trigger`);
  }
  // The retired POST /api/infra/cron-log let any admin insert a row with any
  // status and any started_at: one future-dated row would have read `ok` for ever.
  assert.deepEqual(writers, ['cloudflare-worker/src/util/cronHistory.ts']);
  assert.doesNotMatch(read('cloudflare-worker/src/routes/infra.ts'), /['"]\/cron-log['"]/,
    'the cron-log route is back');
});

test('the scheduled handler records the tick that finds the lease held, before returning', () => {
  const idx = read('cloudflare-worker/src/index.ts');
  const start = idx.indexOf('async scheduled(event: ScheduledEvent');
  const end = idx.indexOf('const cronStartedAt', start);
  assert.ok(start > 0 && end > start, 'the scheduled handler could not be found');
  const head = idx.slice(start, end);
  assert.doesNotMatch(head, /\(event as any\)/, 'ScheduledEvent types cron and scheduledTime; no cast is needed');
  assert.match(head, /leaseHolderValue\(crypto\.randomUUID\(\), event\.scheduledTime, triggerKey\)/);
  const acquire = head.indexOf('await env.RATE_LIMITS.get(LEASE_KEY)');
  const caught = head.indexOf("console.error('[cron] lease acquire failed'", acquire);
  const record = head.indexOf('await recordLeaseHeldFire(');
  const leave = head.indexOf('return;', record);
  assert.ok(acquire > 0 && caught > acquire, 'the lease acquire block moved');
  // OUTSIDE the acquire's try/catch: a throw there must never fall through
  // into running the batch beside the tick that holds the lease.
  assert.ok(record > caught, 'the lease-held record is missing, or sits inside the acquire try/catch');
  assert.ok(leave > record, 'the handler no longer returns after recording a lease-held tick');
});

test('the Cron tab colours exactly the failed statuses red, and deduped as done', () => {
  const tab = read('frontend/src/pages/CronTab.jsx');
  // A literal scan, not a pattern built from the name: `const DONE` is not a
  // substring of `const NOT_DONE`, so each anchor finds only its own set.
  const set = (name: string) => {
    const anchor = `const ${name} = new Set([`;
    const i = tab.indexOf(anchor);
    assert.ok(i >= 0, `CronTab no longer declares ${name}`);
    const body = tab.slice(i + anchor.length, tab.indexOf('])', i));
    return [...body.matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  };
  assert.deepEqual(set('NOT_DONE'), [...FAILED_STATUSES].sort());
  assert.ok(set('DONE').includes('deduped'), 'a deduped minute renders as neither done nor failed');
});

/* ── The declared list is the deployed list ────────────────────────────── */

/**
 * The quoted crons of one wrangler table. `parseSections` in
 * check-wrangler-binding-parity records one line per key, so it sees `crons = [`
 * and nothing else; this reads from the header to the closing bracket.
 */
function cronsOf(toml: string, header: string): string[] {
  const lines = toml.split('\n');
  const h = lines.findIndex((l) => l.trim() === header);
  assert.ok(h >= 0, `${header} is no longer in wrangler.toml`);
  const body = lines.slice(h + 1).join('\n');
  const open = body.indexOf('crons = [');
  const nextHeader = body.search(/^\[/m);
  assert.ok(open >= 0 && (nextHeader < 0 || open < nextHeader), `${header} declares no crons`);
  const inside = body.slice(open + 'crons = ['.length, body.indexOf(']', open))
    .split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');
  return [...inside.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

test('CRON_TRIGGERS is what both deployed tables declare, and a branch fires nothing it does not know', () => {
  const toml = read('wrangler.toml');
  const declared = CRON_TRIGGERS.map((t) => t.expr).sort();
  const top = cronsOf(toml, '[triggers]');
  const prod = cronsOf(toml, '[env.production.triggers]');
  assert.deepEqual([...top].sort(), declared, '[triggers] and CRON_TRIGGERS disagree');
  assert.deepEqual([...prod].sort(), declared, '[env.production.triggers] and CRON_TRIGGERS disagree');
  assert.equal(new Set(declared).size, declared.length, 'a cron is declared twice');
  for (const c of [...BRANCH_CRONS, ...cronsOf(toml, '[env.preview.triggers]')]) {
    assert.ok(declared.includes(c), `a deployment fires ${c}, which HQ's list does not know`);
  }
  // No weekly line in Sunday's number: the digests go out on Monday.
  assert.ok(!declared.includes('0 9 * * 1'), 'the weekly trigger is back on Cloudflare\'s Sunday');
});

test('the grace is the documented wall-time limit plus a minute of dispatch lag', () => {
  // The two long-tick cases above admit a grace of 16 or 17; this names the
  // one chosen and why. 15 is Cloudflare's "Duration" limit for a Cron
  // Trigger; the extra minute is dispatch lag (the 06:00 tick started 06:00:52).
  assert.equal(STALE_GRACE_MINUTES, 15 + 1);
  assert.equal(sqlStamp(Date.parse('2026-09-23T06:00:52.900Z')), '2026-09-23 06:00:52',
    'a stamp is truncated to the second, never rounded into the next one');
});

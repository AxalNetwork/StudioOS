/**
 * D4559 (#4559) part 2 — capacity history, projection and alert episodes.
 *
 *   1. A level that stays raised is one episode, notified once per severity;
 *      a measured recovery clears it once; an outage never clears it.
 *   2. Hysteresis comes from the open episode: a value just under a threshold
 *      holds the level, one clear of it moves it.
 *   3. A source measured recently that stops answering opens `unavailable`;
 *      one never measured opens nothing.
 *   4. The projection fits measured days only, names a month with its window
 *      and confidence, and declines with too few points or no growth.
 *   5. A snapshot stores only the fixed deployment metrics; unavailable is
 *      NULL, never 0; no tenant, secret or SQL reaches the rows.
 *   6. A mute stops notices, not tracking or clearing.
 *   7. The routes are Super Admin only, validate their input, and an
 *      unreadable store is 503, never an empty list.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/platform_capacity_history_d4559.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { makeD1 } from './_d1_sqlite.mjs';
import { GB, type Metric } from '../src/services/platformCapacity.ts';
import {
  evaluateAlerts, projectLimit, snapshotRows, sweepPlatformCapacity, readCapacityHistory, readCapacityAlerts,
  muteCapacityAlert, SNAPSHOT_KEY,
} from '../src/services/platformCapacityHistory.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MIGRATION = readFileSync(join(ROOT, 'cloudflare-worker/sql/migrations/202611072340_platform_capacity_history.sql'), 'utf8');
const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, is_active INTEGER, role TEXT, notification_prefs TEXT);
  CREATE TABLE super_admins (user_id INTEGER);
  CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, kind TEXT, title TEXT, body TEXT,
    link TEXT, meta TEXT, dedupe_key TEXT, UNIQUE (user_id, kind, dedupe_key));
  CREATE TABLE notifications_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT,
    link TEXT, payload TEXT, channel TEXT, category TEXT);
  ${MIGRATION}
`;
const SEED = `
  INSERT INTO users VALUES (1, 1, 'admin', NULL), (2, 1, 'admin', '{"platform_capacity":{"in_app":false}}'), (3, 1, 'founder', NULL);
  INSERT INTO super_admins VALUES (1), (2);
`;

const D1T = { warning: 5 * GB, critical: 7.5 * GB, hysteresis: 0.25 * GB, basis: '' };
const m = (key: string, value: number | null, extra: Partial<Metric> = {}): Metric => ({
  key, label: key, source: 's', unit: 'bytes', scope: 'deployment', value,
  availability: value === null ? 'unavailable' : 'measured', reason: value === null ? 'down' : null,
  level: value === null ? 'unknown' : value >= D1T.critical ? 'critical' : value >= D1T.warning ? 'warning' : 'ok',
  thresholds: D1T, ...extra,
});
const NOW = new Date('2026-11-07T12:00:00Z');

// 1, 2, 3 ─────────────────────────────────────────────────────────────────────
test('evaluateAlerts: open once, touch while held, change severity in place, clear on measured ok, hold through an outage', () => {
  // Mutations checked: touch replaced by a second open; clear on unknown; hysteresis not fed the open severity.
  assert.deepEqual(evaluateAlerts([], [m('d1.size_bytes', 8 * GB)], {}, NOW), [{ kind: 'open', key: 'd1.size_bytes', severity: 'critical', value: 8 * GB }]);
  const open = [{ id: 7, metric_key: 'd1.size_bytes', severity: 'critical' as const, muted_until: null }];
  assert.deepEqual(evaluateAlerts(open, [m('d1.size_bytes', 8.1 * GB)], {}, NOW).map((a) => a.kind), ['touch'], 'a level that stays raised is the same episode');
  // Hysteresis: 7.4 GB is inside 0.25 GB of the 7.5 GB critical line, so it holds; 7.2 GB is clear of it.
  assert.deepEqual(evaluateAlerts(open, [m('d1.size_bytes', 7.4 * GB)], {}, NOW).map((a) => a.kind), ['touch']);
  assert.deepEqual(evaluateAlerts(open, [m('d1.size_bytes', 7.2 * GB)], {}, NOW),
    [{ kind: 'change', id: 7, key: 'd1.size_bytes', from: 'critical', severity: 'warning', value: 7.2 * GB }]);
  assert.deepEqual(evaluateAlerts(open, [m('d1.size_bytes', 1 * GB)], {}, NOW).map((a) => a.kind), ['clear']);
  assert.deepEqual(evaluateAlerts(open, [m('d1.size_bytes', null)], {}, NOW), [{ kind: 'touch', id: 7, key: 'd1.size_bytes', value: null }],
    'an unreadable source is not a recovery');
  // An empty queue is a measured recovery for its age.
  const age = { key: 'queue.job.oldest_age_seconds', label: 'age', source: 's', unit: 'seconds' as const, scope: 'deployment' as const,
    value: null, availability: 'none_waiting' as const, reason: 'No message is waiting.', level: 'ok' as const,
    thresholds: { warning: 900, critical: 3600, hysteresis: 60, basis: '' } };
  assert.deepEqual(evaluateAlerts([{ id: 9, metric_key: age.key, severity: 'warning', muted_until: null }], [age], {}, NOW).map((a) => a.kind), ['clear']);
  // A metric without thresholds is never alerted on.
  assert.deepEqual(evaluateAlerts([], [m('d1.size_ratio', 0.99, { thresholds: null, unit: 'ratio' })], {}, NOW), []);
});

test('evaluateAlerts: a recently measured source that stops answering opens unavailable; one never measured does not', () => {
  // Mutations checked: the freshness window ignored; an unknown metric opening with no history.
  const down = m('d1.size_bytes', null);
  assert.deepEqual(evaluateAlerts([], [down], { 'd1.size_bytes': '2026-11-06T13:00:00Z' }, NOW),
    [{ kind: 'open', key: 'd1.size_bytes', severity: 'unavailable', value: null }]);
  assert.deepEqual(evaluateAlerts([], [down], { 'd1.size_bytes': '2026-11-04T00:00:00Z' }, NOW), [], 'older than 48 hours');
  assert.deepEqual(evaluateAlerts([], [down], {}, NOW), [], 'never measured: listed as unavailable only');
  // When it answers again within its threshold, the unavailable episode clears; above it, it becomes a level episode.
  const un = [{ id: 3, metric_key: 'd1.size_bytes', severity: 'unavailable' as const, muted_until: null }];
  assert.deepEqual(evaluateAlerts(un, [m('d1.size_bytes', 1 * GB)], {}, NOW).map((a) => a.kind), ['clear']);
  assert.deepEqual(evaluateAlerts(un, [m('d1.size_bytes', 6 * GB)], {}, NOW).map((a) => [a.kind, (a as any).severity]), [['change', 'warning']]);
});

// 4 ───────────────────────────────────────────────────────────────────────────
const days = (n: number, f: (i: number) => number | null, start = '2026-08-01') =>
  Array.from({ length: n }, (_, i) => ({ day: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), value: f(i) }));

test('projectLimit: names a month with its window and confidence, and declines when it cannot', () => {
  // Mutations checked: null days counted as zero; the minimum-points rule removed; confidence above medium.
  const grow = days(30, (i) => 3 * GB + i * 0.1 * GB);
  const p = projectLimit(grow, 10 * GB, 90) as any;
  assert.equal(p.state, 'projected');
  // 5.9 GB on 2026-08-30, 0.1 GB a day: 41 days to 10 GB → 2026-10-10.
  assert.equal(p.projected_month, '2026-10');
  assert.deepEqual([p.points_used, p.window_days, p.from, p.to, p.confidence, p.r2], [30, 90, '2026-08-01', '2026-08-30', 'medium', 1]);
  assert.match(p.basis, /not a forecast/);
  // Gaps are skipped, not zeros: the same line with every third day unreadable projects the same month.
  const gappy = days(30, (i) => (i % 3 === 1 ? null : 3 * GB + i * 0.1 * GB));
  assert.equal((projectLimit(gappy, 10 * GB, 90) as any).projected_month, '2026-10');
  assert.equal((projectLimit(gappy, 10 * GB, 90) as any).points_used, 20);
  assert.equal((projectLimit(days(6, (i) => GB + i), 10 * GB, 90)).state, 'insufficient');
  assert.equal((projectLimit(days(10, () => 2 * GB), 10 * GB, 90)).state, 'not_growing');
  assert.equal((projectLimit(days(10, (i) => 2 * GB + i * 1000), 10 * GB, 90)).state, 'beyond_horizon');
  assert.equal((projectLimit(days(10, (i) => 10 * GB + i), 10 * GB, 90)).state, 'at_limit');
  // Too few points, or a noisy fit, is low confidence.
  assert.equal((projectLimit(days(10, (i) => 3 * GB + i * 0.1 * GB), 10 * GB, 90) as any).confidence, 'low');
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('snapshotRows: only the fixed deployment metrics, unavailable stored as NULL, nothing else in the row', () => {
  // Mutations checked: unavailable stored as 0; the key filter removed.
  const rows = snapshotRows({
    observed_at: '2026-11-07T04:11:00Z', scope: 'hq',
    metrics: [m('d1.size_bytes', null), m('queue.job.backlog_messages', 0, { unit: 'messages', thresholds: null, level: 'ok' }),
      m('tenant.acme.usage', 5, { thresholds: null })],
  });
  assert.deepEqual(rows.map((r) => [r.metric_key, r.value, r.availability]), [
    ['d1.size_bytes', null, 'unavailable'], ['queue.job.backlog_messages', 0, 'measured'],
  ], 'a measured zero is 0; an unreadable value is null; an unknown key is not stored');
  assert.deepEqual(Object.keys(rows[0]).sort(), ['availability', 'day', 'level', 'metric_key', 'observed_at', 'scope', 'unit', 'value']);
  for (const k of ['d1.size_bytes', 'd1.size_ratio', 'queue.agent.oldest_age_seconds']) assert.ok(SNAPSHOT_KEY.test(k));
  assert.ok(!SNAPSHOT_KEY.test('queue.job.oldest_age_seconds.acme'));
});

// 1, 6 (the sweep against a real SQLite) ──────────────────────────────────────
function envWith(db: any, size: () => number | 'throw' | null) {
  const DB = new Proxy(db, {
    get(t, k) {
      if (k !== 'prepare') { const v = (t as any)[k]; return typeof v === 'function' ? v.bind(t) : v; }
      return (sql: string) => sql === 'SELECT 1'
        ? { run: async () => { const v = size(); if (v === 'throw') throw new Error('D1 down'); return { meta: { size_after: v } }; } }
        : t.prepare(sql);
    },
  });
  return { DB } as any;
}
const rowsOf = async (q: any) => ((await q.all()).results as any[]).map((r) => ({ ...r }));
const notices = async (db: any) => (await rowsOf(db.prepare(`SELECT user_id, title FROM notifications_inbox ORDER BY id`)));

test('the sweep: one episode and one notice per severity, an outage holds it, a recovery clears it once', async () => {
  // Mutations checked: the open INSERT without OR IGNORE / the partial unique index; notices without dedupe; the mute ignored.
  const db = makeD1(SCHEMA, SEED).DB;
  let size: number | 'throw' | null = 8 * GB;
  const env = envWith(db, () => size);
  const t = (h: number) => new Date(Date.parse('2026-11-07T04:11:00Z') + h * 3_600_000);

  await sweepPlatformCapacity(env, t(0), { snapshot: true });
  await sweepPlatformCapacity(env, t(1));
  let alerts = (await rowsOf(db.prepare(`SELECT metric_key, severity, state FROM platform_capacity_alerts`)));
  assert.deepEqual(alerts, [{ metric_key: 'd1.size_bytes', severity: 'critical', state: 'open' }]);
  assert.deepEqual(await notices(db), [{ user_id: 1, title: 'Critical: D1 database size' }],
    'one notice, to the Super Admin who has not turned it off; never to a non-admin');

  size = 'throw';
  await sweepPlatformCapacity(env, t(2));
  alerts = (await rowsOf(db.prepare(`SELECT severity, state FROM platform_capacity_alerts`)));
  assert.deepEqual(alerts, [{ severity: 'critical', state: 'open' }], 'an outage does not clear the episode');

  size = 1 * GB;
  await sweepPlatformCapacity(env, t(3));
  await sweepPlatformCapacity(env, t(4));
  alerts = (await rowsOf(db.prepare(`SELECT state, cleared_at FROM platform_capacity_alerts`)));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].state, 'cleared');
  assert.deepEqual((await notices(db)).map((n: any) => n.title), ['Critical: D1 database size', 'Cleared: D1 database size']);

  // A later breach is a new episode with its own notice.
  size = 6 * GB;
  await sweepPlatformCapacity(env, t(5));
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM platform_capacity_alerts`).first()).n, 2);
  const open = await db.prepare(`SELECT id FROM platform_capacity_alerts WHERE state = 'open'`).first();
  // Muted: escalation and clearing are tracked but say nothing.
  await muteCapacityAlert(env, open.id, 24, 'Planned migration this week', 1, t(5));
  size = 8 * GB;
  await sweepPlatformCapacity(env, t(6));
  size = 1 * GB;
  await sweepPlatformCapacity(env, t(7));
  assert.equal((await db.prepare(`SELECT state, severity FROM platform_capacity_alerts WHERE id = ?`).bind(open.id).first()).state, 'cleared');
  assert.deepEqual((await notices(db)).map((n: any) => n.title),
    ['Critical: D1 database size', 'Cleared: D1 database size', 'Warning: D1 database size']);
});

test('the snapshot keeps one row per metric per day, with the unreadable day as NULL, and the history reads it back', async () => {
  // Mutations checked: the snapshot written on every sweep; an unreadable day stored as 0; history empty on a failed read.
  const db = makeD1(SCHEMA, SEED).DB;
  let size: number | 'throw' = 2 * GB;
  const env = envWith(db, () => size);
  await sweepPlatformCapacity(env, new Date('2026-11-05T04:11:00Z'), { snapshot: true });
  size = 'throw';
  await sweepPlatformCapacity(env, new Date('2026-11-06T04:11:00Z'), { snapshot: true });
  size = 2.1 * GB;
  await sweepPlatformCapacity(env, new Date('2026-11-07T04:11:00Z'), { snapshot: true });
  await sweepPlatformCapacity(env, new Date('2026-11-07T04:26:00Z'));
  // A sweep that is not the daily one keeps no row.
  size = 2.2 * GB;
  await sweepPlatformCapacity(env, new Date('2026-11-08T10:11:00Z'));
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM platform_capacity_snapshots WHERE day = '2026-11-08'`).first()).n, 0);
  const rows = (await rowsOf(db.prepare(`SELECT day, value, availability FROM platform_capacity_snapshots WHERE metric_key = 'd1.size_bytes' ORDER BY day`)));
  assert.deepEqual(rows, [
    { day: '2026-11-05', value: 2 * GB, availability: 'measured' },
    { day: '2026-11-06', value: null, availability: 'unavailable' },
    { day: '2026-11-07', value: 2.1 * GB, availability: 'measured' },
  ]);
  const h = await readCapacityHistory(env, 'hq', 90, 10 * GB, new Date('2026-11-07T12:00:00Z')) as any;
  assert.equal(h.state, 'ok');
  assert.equal(h.d1_projection.state, 'insufficient', 'two measured days do not make a projection');
  assert.match(h.d1_projection.basis, /^2 measured days/);
  // No tenant, secret or SQL in what was stored.
  const all = JSON.stringify((await rowsOf(db.prepare(`SELECT * FROM platform_capacity_snapshots`))));
  assert.doesNotMatch(all, /D1 down|SELECT|acme|@/);

  const broken = { DB: { prepare: () => { throw new Error('no such table'); } } } as any;
  assert.equal((await readCapacityHistory(broken, 'hq', 90, 10 * GB)).state, 'unreadable');
  assert.equal((await readCapacityAlerts(broken, 'hq')).state, 'unreadable');
  assert.equal((await readCapacityHistory({ DB: makeD1(SCHEMA, SEED).DB } as any, 'hq', 90, 10 * GB)).state, 'not_recorded');
});

test('a branch Worker keeps no history and alerts no one', async () => {
  const db = makeD1(SCHEMA, SEED).DB;
  const env = { ...envWith(db, () => 9 * GB), BRANCH_CODE: 'acme', DEPLOYMENT_TIER: 'branch' } as any;
  const r = await sweepPlatformCapacity(env, NOW, { snapshot: true });
  assert.equal((r as any).skipped, 'branch');
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM platform_capacity_alerts`).first()).n, 0);
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM platform_capacity_snapshots`).first()).n, 0);
});

test('two sweeps that race open one episode and send one notice', async () => {
  // Mutations checked: the open INSERT without OR IGNORE; the partial unique index widened or dropped.
  const db = makeD1(SCHEMA, SEED).DB;
  const env = envWith(db, () => 9 * GB);
  await Promise.all([sweepPlatformCapacity(env, NOW), sweepPlatformCapacity(env, NOW), sweepPlatformCapacity(env, NOW)]);
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM platform_capacity_alerts WHERE state = 'open'`).first()).n, 1);
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM notifications_inbox`).first()).n, 1);
  // The store itself refuses a second open episode for the same metric.
  await assert.rejects(db.prepare(`INSERT INTO platform_capacity_alerts (scope, metric_key, severity, opened_at, last_seen_at)
    VALUES ('hq', 'd1.size_bytes', 'warning', 'x', 'x')`).run());
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('the routes are Super Admin only, validate their input, and refuse an unreadable store with 503', () => {
  // Mutations checked: requireSuperAdmin dropped from a read; the mute's write bar or reason dropped.
  const src = readFileSync(join(ROOT, 'cloudflare-worker/src/routes/admin_platform.ts'), 'utf8');
  const block = (path: string) => src.slice(src.indexOf(path), src.indexOf('});', src.indexOf(path)));
  assert.match(block("r.get('/capacity/history'"), /await requireSuperAdmin\(c\)/);
  assert.match(block("r.get('/capacity/history'"), /days < 1 \|\| days > HISTORY_DAYS_MAX/);
  assert.match(block("r.get('/capacity/history'"), /, 503\)/);
  assert.match(block("r.get('/capacity/alerts'"), /await requireSuperAdmin\(c\)/);
  assert.match(block("r.get('/capacity/alerts'"), /, 503\)/);
  const mute = src.slice(src.indexOf("r.post('/capacity/alerts/:id/mute'"), src.indexOf('export default r'));
  assert.match(mute, /await requireSuperAdminWriteBar\(c\)/);
  assert.match(mute, /reason\.length < 5/);
  assert.match(mute, /hours > MUTE_MAX_HOURS/);
  assert.match(mute, /logAdminAction\(c\.env, actor\.id, actor\.email, 'platform_capacity_alert_muted'/);
  const cron = readFileSync(join(ROOT, 'cloudflare-worker/src/index.ts'), 'utf8');
  assert.match(cron, /hqCadences && now\.getUTCMinutes\(\) % 15 === 11\)[\s\S]{0,300}sweepPlatformCapacity\(env, now, \{ snapshot: now\.getUTCHours\(\) === 4 && now\.getUTCMinutes\(\) === 11 \}\)/);
});

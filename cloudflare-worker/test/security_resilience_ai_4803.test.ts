/**
 * D4803 (#4803, Security v2 slice 2, canvas SE08 AI Safety and SE09 Resilience):
 * the Worker half.
 *
 *   · the drill marker's failure reason, recovery point, migration and table
 *     count reach the page, each checked for its kind; the reason is one line
 *     and at most DRILL_REASON_MAX characters; a marker without them still
 *     reads (they are optional), one with a wrong kind is invalid, not trusted;
 *   · /overview's backup_dr carries the KV heartbeat beside the D1 one;
 *   · the recent guard verdicts are the newest guard rows with their run's
 *     outcome (delivered, blocked before the model, withheld, guard
 *     unavailable, or unknown when the run row is gone), never a prompt, an
 *     output or an account, and an unreadable store is `available: false`.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/security_resilience_ai_4803.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DRILL_REASON_MAX, readRestoreDrill, validateDrillMarker } from '../src/services/backup.ts';
import { loadRecentGuardVerdicts, RECENT_GUARD_LIMIT } from '../src/services/aiRouter.ts';

const NOW = Date.UTC(2026, 10, 7, 12);
const FAILED = {
  schema_version: 1, at: '2026-11-01T03:10:00Z', outcome: 'failed', duration_s: 252, source: 'gha', step: 'restore',
  exit_code: 1, backup_key: 'd1/studioos-db/backup-2026-11-01.sql', run_id: '18822', rpo_met: null, rto_met: true,
  reason: 'restore failed at chunk 2/7 (data);\n wrangler error codes: D1_RESET_DO', recovery_point: '2026-11-01T02:00:00Z',
  migration: '202611072219_security_events_support_actor.sql', tables: 214,
};
const bucket = (objects: Record<string, unknown>) => ({
  async get(k: string) {
    if (!(k in objects)) return null;
    const v = objects[k];
    return { async json() { return typeof v === 'string' ? JSON.parse(v) : v; } };
  },
});

test('the drill\'s reason, recovery point, migration and table count reach the page; the reason is one line', async () => {
  const r = await readRestoreDrill({ BACKUPS: bucket({ 'drill-d1.json': FAILED }) } as any, NOW) as any;
  assert.equal(r.state, 'last_run_failed');
  assert.equal(r.reason, 'restore failed at chunk 2/7 (data); wrangler error codes: D1_RESET_DO');
  assert.equal(r.recovery_point, '2026-11-01T02:00:00Z');
  assert.equal(r.migration, '202611072219_security_events_support_actor.sql');
  assert.equal(r.tables, 214);
  assert.equal(r.step, 'restore');
  assert.equal(r.exit_code, 1);
});

test('a long reason is cut to DRILL_REASON_MAX and says so; an older marker without the fields still reads', () => {
  const long = validateDrillMarker({ ...FAILED, reason: 'x'.repeat(900) }, NOW);
  assert.ok(long.ok);
  if (long.ok) {
    assert.equal(long.value.reason!.length, DRILL_REASON_MAX);
    assert.ok(long.value.reason!.endsWith('…'));
  }
  const { reason, recovery_point, migration, tables, ...older } = FAILED;
  void reason; void recovery_point; void migration; void tables;
  const old = validateDrillMarker(older, NOW);
  assert.ok(old.ok);
  if (old.ok) assert.deepEqual([old.value.reason, old.value.recovery_point, old.value.migration, old.value.tables], [null, null, null, null]);
  const blank = validateDrillMarker({ ...FAILED, reason: '   ' }, NOW);
  assert.ok(blank.ok && blank.value.reason === null, 'a blank reason read as a reason');
});

test('a field of the wrong kind makes the marker invalid evidence, never a trusted value', () => {
  for (const [field, value] of [['reason', 42], ['migration', {}], ['recovery_point', 'yesterday'], ['tables', -1], ['tables', 'many']] as const) {
    const r = validateDrillMarker({ ...FAILED, [field]: value }, NOW);
    assert.equal(r.ok, false, `${field}=${JSON.stringify(value)} was accepted`);
  }
});

test('/overview serves the KV heartbeat beside the D1 one, and the recent verdicts in the AI block', () => {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_security.ts'), 'utf8');
  assert.match(src, /backup: await readBackupHeartbeat\(env, 'd1'\),[\s\S]{0,300}kv: await readBackupHeartbeat\(env, 'kv'\),/);
  assert.match(src, /recent_verdicts: await loadRecentGuardVerdicts\(env, AI_SAFETY_WINDOW_DAYS\)/);
});

// ───────────────────────────────────────────────── recent guard verdicts ──

function d1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: unknown[] = [];
      const api: any = {
        bind: (...x: unknown[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return db.prepare(sql).get(...(b as any[])) ?? null; },
        async all() { return { results: db.prepare(sql).all(...(b as any[])) }; },
        async run() { db.prepare(sql).run(...(b as any[])); return { meta: {} }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); },
    async batch(x: any[]) { return Promise.all(x.map((s) => s.run())); },
  };
}
const ago = (mins: number) => new Date(NOW - mins * 60_000).toISOString().slice(0, 19).replace('T', ' ');

test('recent verdicts: newest first, each with its run\'s outcome, and nothing but time, page, verdict and delivery', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const db = new DatabaseSync(':memory:');
  const env = { DB: d1(db) } as any;
  // The schema the router itself creates, so the read is against the real table.
  await loadRecentGuardVerdicts(env, 7);
  const run = db.prepare("INSERT INTO ai_usage_logs (task, model, refusal, created_at, rail_page, user_id) VALUES ('chat', 'm', ?, ?, ?, 42)");
  const guard = db.prepare("INSERT INTO ai_usage_logs (task, model, safety_score, created_at, rail_page, guard_for, user_id) VALUES ('safety', 'guard', ?, ?, ?, ?, 42)");
  const r1 = Number(run.run(null, ago(60), 'memo').lastInsertRowid);
  guard.run(0.98, ago(59), 'memo', r1);
  const r2 = Number(run.run('guard_blocked_output', ago(40), 'diligence').lastInsertRowid);
  guard.run(0.1, ago(39), 'diligence', r2);
  const r3 = Number(run.run('guard_blocked', ago(20), 'deck').lastInsertRowid);
  guard.run(null, ago(19), 'deck', r3);
  guard.run(0.9, ago(10), 'orphan', 99999);
  guard.run(0.9, ago(60 * 24 * 9), 'too old', r1);

  const got = await loadRecentGuardVerdicts(env, 7) as any;
  assert.equal(got.available, true);
  assert.deepEqual(got.rows.map((x: any) => [x.page, x.verdict, x.delivery]), [
    ['orphan', 'safe', 'unknown'],
    ['deck', 'no_verdict', 'blocked_input'],
    ['diligence', 'unsafe', 'withheld_output'],
    ['memo', 'safe', 'delivered'],
  ]);
  for (const row of got.rows) assert.deepEqual(Object.keys(row).sort(), ['at', 'delivery', 'page', 'verdict'], 'a row carried more than the table draws');
  assert.ok(RECENT_GUARD_LIMIT >= 4);
});

test('an unreadable store is available: false with its reason, never an empty list', async () => {
  const env = { DB: { prepare() { throw new Error('no such table'); }, async exec() { throw new Error('down'); } } } as any;
  const got = await loadRecentGuardVerdicts(env, 7) as any;
  assert.equal(got.available, false);
  assert.match(got.reason, /not a claim that none ran/);
  assert.equal(got.rows, undefined);
});

/**
 * D691 (S19-A, #1698), test 8 — Grow's daily step (decision 3): obligation
 * reminders and KPI alerts, sent in the app only, each once.
 *
 *   - A reminder is sent once the day `due_date` − N has come, to the
 *     obligation's owner, else the venture's founder; a second run sends
 *     nothing, and a completed obligation sends nothing.
 *   - A KPI write that crosses an alert makes one notification, and a second
 *     crossing makes none until the alert re-arms by crossing back.
 *   - A Stripe row that crosses an alert is caught by the daily run.
 *
 * THE DATABASE IS THE BASELINE PLUS EVERY NUMBERED MIGRATION ABOVE THE CUTOFF,
 * IN ORDER, with foreign keys on, as D1 runs them. Every name is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_daily_d691.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { runGrowDaily, remindOn } from '../src/services/growDaily.ts';
import { enterKpi } from '../src/services/growKpis.ts';
import { setKpiAlert } from '../src/services/growWriters.ts';
import { ensureProjectMetricsSchema } from '../src/routes/progress.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = process.cwd();
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);

const FOUNDER = 10, OWNER = 11;
const A = 1;
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-18T05:35:00Z');
const day = (offset: number) => new Date(NOW + offset * DAY).toISOString().slice(0, 10);

const BUILT = join(mkdtempSync(join(tmpdir(), 'grow-daily-')), 'built.db');
function fixture() {
  if (!existsSync(BUILT)) {
    const db = new DatabaseSync(BUILT, { enableDoubleQuotedStringLiterals: true });
    db.exec(BASELINE);
    for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
    db.close();
  }
  const copy = join(mkdtempSync(join(tmpdir(), 'grow-daily-')), 'test.db');
  copyFileSync(BUILT, copy);
  const db = new DatabaseSync(copy, { enableDoubleQuotedStringLiterals: true });
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`INSERT INTO founders (id, name, email) VALUES (${FOUNDER}, 'Ana Wren', 'ana@example.test')`);
  db.exec(`INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES
    (${FOUNDER}, 'founder', 'Ana Wren', 'ana@example.test', ${FOUNDER}, 1), (${OWNER}, 'founder', 'Cai Moreno', 'cai@example.test', NULL, 1)`);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER})`);
  return { db, env: { DB: d1Over(db) } as any };
}

const inbox = (db: DatabaseSync, type: string) =>
  (db.prepare('SELECT user_id, type, title, link FROM notifications_inbox WHERE type = ? ORDER BY id').all(type) as any[]).map((r) => ({ ...r }));
/** Every channel a notification went out on: the inbox only, never the outbox's email or Slack. */
const outbox = (db: DatabaseSync) => {
  try { return (db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get() as any).n as number; } catch { return 0; }
};

function obligation(db: DatabaseSync, id: number, opts: { due: string; remind: number[]; owner?: number | null; completion?: string; title?: string }) {
  db.prepare(`INSERT INTO compliance_events (id, project_id, jurisdiction, event_type, title, due_date, kind, recurrence, completion_status,
      remind_days_json, owner_user_id) VALUES (?, ?, 'Unspecified', ?, ?, ?, 'governance', 'quarterly', ?, ?, ?)`)
    .run(id, A, `type_${id}`, opts.title ?? `Obligation ${id}`, opts.due, opts.completion ?? 'pending', JSON.stringify(opts.remind), opts.owner ?? null);
}

test('8: a reminder is sent once its day has come, in the app, to the owner else the founder', async () => {
  const { db, env } = fixture();
  assert.equal(remindOn('2026-11-01', 14), '2026-10-18');
  obligation(db, 71, { due: day(14), remind: [14], title: 'Board meeting' }); // due today: the founder
  obligation(db, 72, { due: day(14), remind: [14], owner: OWNER }); // due today: the owner
  obligation(db, 73, { due: day(15), remind: [14] }); // tomorrow, not yet
  obligation(db, 74, { due: day(14), remind: [14], completion: 'completed' }); // done: never
  obligation(db, 75, { due: day(3), remind: [14, 7] }); // both days missed: caught now
  const first = await runGrowDaily(env, NOW);
  const sent = inbox(db, 'grow_obligation_reminder');
  assert.deepEqual(sent.map((n) => n.user_id).sort(), [FOUNDER, FOUNDER, FOUNDER, OWNER]);
  assert.equal(first.reminders, 4);
  assert.deepEqual(sent.find((n) => n.link.includes('/71?'))!, {
    user_id: FOUNDER, type: 'grow_obligation_reminder', title: `Board meeting is due ${day(14)}`,
    link: `/grow/durable-company-building/71?project_id=${A}`,
  });
  assert.equal(outbox(db), 0, 'a reminder is in the app only');
  assert.deepEqual(JSON.parse((db.prepare('SELECT reminders_sent_json AS j FROM compliance_events WHERE id = 75').get() as any).j), [14, 7]);
  assert.equal((db.prepare('SELECT reminders_sent_json AS j FROM compliance_events WHERE id = 73').get() as any).j, '[]');
  // A second run the same day sends nothing.
  const second = await runGrowDaily(env, NOW);
  assert.equal(second.reminders, 0);
  assert.equal(inbox(db, 'grow_obligation_reminder').length, 4);
  // The next day, the one that was not yet due is.
  await runGrowDaily(env, NOW + DAY);
  assert.equal(inbox(db, 'grow_obligation_reminder').length, 5);
});

test('8: a KPI write that crosses an alert notifies its creator once, until it re-arms', async () => {
  const { db, env } = fixture();
  await ensureProjectMetricsSchema(env);
  const founder = { id: FOUNDER, role: 'founder' } as any;
  await setKpiAlert(env, A, founder, 'mrr', { op: 'below', threshold_cents: 500000 });
  const enter = (value: number, asOf: string) => enterKpi(env, A, FOUNDER, { kpi: 'mrr', value, as_of: asOf });
  await enter(6000, day(-3)); // above $5,000: nothing
  assert.equal(inbox(db, 'grow_kpi_alert').length, 0);
  await enter(4000, day(-2)); // below: one notification
  assert.deepEqual(inbox(db, 'grow_kpi_alert'), [{ user_id: FOUNDER, type: 'grow_kpi_alert', title: 'Alert: MRR below $5,000',
    link: `/grow/revenue-and-traction/mrr?project_id=${A}` }]);
  assert.ok((db.prepare('SELECT last_crossed_at FROM kpi_alerts').get() as any).last_crossed_at);
  await enter(3000, day(-1)); // still below: no second notification
  assert.equal(inbox(db, 'grow_kpi_alert').length, 1);
  await enter(5500, day(0)); // crossed back: re-armed
  assert.equal((db.prepare('SELECT last_crossed_at FROM kpi_alerts').get() as any).last_crossed_at, null);
  assert.equal(inbox(db, 'grow_kpi_alert').length, 1);
  await enter(4500, day(0)); // below again: notifies again
  assert.equal(inbox(db, 'grow_kpi_alert').length, 2);
  assert.equal(outbox(db), 0, 'an alert is in the app only');
});

test('8: a Stripe row that crosses an alert is caught by the daily run', async () => {
  const { db, env } = fixture();
  await ensureProjectMetricsSchema(env);
  await setKpiAlert(env, A, { id: FOUNDER, role: 'founder' } as any, 'mrr', { op: 'below', threshold_cents: 500000 });
  // The Stripe import writes the row directly; no KPI write checks it.
  db.prepare("INSERT INTO project_metrics (project_id, snapshot_date, mrr, source) VALUES (?, ?, 1200, 'stripe')").run(A, day(-1));
  assert.equal(inbox(db, 'grow_kpi_alert').length, 0);
  const r = await runGrowDaily(env, NOW);
  assert.equal(r.alerts, 1);
  assert.equal(inbox(db, 'grow_kpi_alert').length, 1);
  assert.equal((await runGrowDaily(env, NOW)).alerts, 0);
  assert.equal(inbox(db, 'grow_kpi_alert').length, 1);
});

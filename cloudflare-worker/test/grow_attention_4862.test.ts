/** #4862: focus evidence uses real stores, preserves zero and never treats a failed read as missing setup. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { growAttention } from '../src/services/growAttention';
import type { Ctx } from '../src/services/growCycle';
import type { Card, Figure } from '../src/services/cycleCards';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE reporting_reminder_settings (project_id INTEGER, offsets_json TEXT);
    CREATE TABLE reporting_duties (id INTEGER, project_id INTEGER, kind TEXT, status TEXT);
    CREATE TABLE reporting_periods (id INTEGER, duty_id INTEGER, period_label TEXT, due_on TEXT, met_update_id INTEGER, waived_at TEXT);`);
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER); INSERT INTO projects VALUES (1,11,101), (2,22,202); CREATE TABLE user_company_links (company_id INTEGER, user_id INTEGER); CREATE TABLE growth_channels (project_id INTEGER); CREATE TABLE waitlist_signups (project_id INTEGER, created_at TEXT, invited_at TEXT, followed_up_at TEXT, promoted_at TEXT); CREATE TABLE mercury_partner_proposals (project_id INTEGER, state TEXT);');
  for (const [name, table] of [['173_metrics_board_reporting.sql', 'metric_targets'], ['249_project_metrics.sql', 'project_metrics']]) {
    const sql = readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
    const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
    assert.ok(start >= 0);
    db.exec(sql.slice(start, sql.indexOf(');', start) + 2));
  }
  db.exec(readFileSync(new URL('../sql/migrations/384_metric_target_focus.sql', import.meta.url), 'utf8'));
  const x = (projectId = 1): Ctx => ({ env: { DB: d1Over(db) } as Ctx['env'], projectId, now: Date.parse('2026-11-13T12:00:00Z'), href: (slug) => `/grow/${slug}?project_id=${projectId}` });
  const focus = (pid = 1, key = 'mrr', value = 100) => db.prepare('INSERT INTO metric_targets (project_id, metric_key, target_value, direction, is_focus) VALUES (?, ?, ?, ?, 1)').run(pid, key, value, 'up');
  const snapshot = (pid = 1, value: number | null = 0, date = '2026-11-12') => db.prepare('INSERT INTO project_metrics (project_id, snapshot_date, mrr, source) VALUES (?, ?, ?, ?)').run(pid, date, value, 'manual');
  return { db, x, focus, snapshot };
}

test('a sparse venture gets Set focus metric; another venture cannot supply its focus', async () => {
  const f = fixture();
  try {
    f.focus(2); f.snapshot(2, 900);
    const r = await growAttention(f.x(), true);
    assert.equal(r.focus.state, 'not_recorded');
    assert.equal(r.primary?.key, 'set_focus');
    assert.equal(r.primary?.href, '/grow/focus?project_id=1');
    assert.deepEqual(r.items.map((i) => i.key), ['set_focus', 'set_target', 'record_kpi', 'add_channel']);
    assert.equal((await growAttention(f.x(2), true)).primary?.key, 'review_growth');
  } finally { f.db.close(); }
});

test('a chosen target needs its first value; a real zero changes the action to Review growth', async () => {
  const f = fixture();
  try {
    f.focus(1, 'mrr', 0);
    assert.equal((await growAttention(f.x(), true)).primary?.key, 'record_metric');
    f.snapshot();
    const r = await growAttention(f.x(), true);
    assert.equal(r.primary?.key, 'review_growth');
    assert.deepEqual(r.measurement, { state: 'recorded', value: { value: 0, as_of: '2026-11-12', source: 'manual' } });
    assert.equal(r.focus.value?.target_value, 0);
  } finally { f.db.close(); }
});

test('reporting signals respect the reminder window, urgency, failure and write access', async () => {
  const f = fixture();
  try {
    f.db.exec(`INSERT INTO reporting_reminder_settings VALUES (1, '[3]');
      INSERT INTO reporting_duties VALUES (1, 1, 'quarterly_update', 'active'), (2, 2, 'quarterly_update', 'active');
      INSERT INTO reporting_periods VALUES (1, 1, 'Q4', '2026-11-17', NULL, NULL), (2, 2, 'Other', '2026-11-10', NULL, NULL);`);
    const get = (writable = true) => growAttention(f.x(), writable);
    assert.equal((await get()).items.some((i) => i.key === 'report_due'), false);
    f.db.exec("UPDATE reporting_periods SET due_on = '2026-11-16' WHERE id = 1");
    const due = await get();
    assert.equal(due.primary?.label, 'Share an update');
    assert.equal(due.items[0]?.href, '/grow/reporting?project_id=1');
    assert.match(due.items[0].label, /Q4/);
    assert.equal(due.items.length, 4);
    f.db.exec("UPDATE reporting_periods SET due_on = '2026-11-10' WHERE id = 1");
    assert.match((await get()).items[0].why, /Late since/);
    assert.equal((await get(false)).signals.reporting.state, 'restricted');
    assert.equal((await growAttention(f.x(), true, { user: { id: 9, role: 'admin', founder_id: null } })).signals.reporting.state, 'restricted');
    f.db.exec('UPDATE reporting_periods SET met_update_id = 9 WHERE id = 1');
    assert.equal((await get()).signals.reporting.value, 0);
    f.db.exec('DROP TABLE reporting_periods');
    assert.equal((await get()).state, 'partial');
    assert.equal((await get()).signals.reporting.state, 'unreadable');
  } finally { f.db.close(); }
});

test('a newer snapshot of another metric does not erase the focus metric evidence', async () => {
  const f = fixture();
  try {
    f.focus(); f.snapshot(1, 40, '2026-11-10'); f.snapshot(1, null, '2026-11-12'); f.snapshot(2, 9999, '2026-11-13');
    const r = await growAttention(f.x(), true);
    assert.equal(r.primary?.key, 'review_growth');
    assert.equal(r.measurement.value?.value, 40);
    assert.equal(r.measurement.value?.as_of, '2026-11-10');
  } finally { f.db.close(); }
});

test('an unreadable focus source never offers Set focus metric', async () => {
  const f = fixture();
  try {
    f.db.exec('DROP TABLE metric_targets');
    const r = await growAttention(f.x(), true);
    assert.equal(r.state, 'unreadable');
    assert.equal(r.focus.state, 'unreadable');
    assert.equal(r.primary, null);
    assert.equal(r.items.some((i) => ['set_focus', 'record_metric', 'record_kpi'].includes(i.key)), false);
    assert.equal(r.items[0]?.key, 'focus_unreadable');
  } finally { f.db.close(); }
});

test('an unreadable metric source never offers Record the first value', async () => {
  const f = fixture();
  try {
    f.focus(); f.db.exec('DROP TABLE project_metrics');
    const r = await growAttention(f.x(), true);
    assert.equal(r.state, 'unreadable');
    assert.equal(r.measurement.state, 'unreadable');
    assert.equal(r.primary, null);
    assert.equal(r.items.some((i) => ['set_focus', 'record_metric', 'record_kpi'].includes(i.key)), false);
    assert.equal(r.items[0]?.key, 'focus_unreadable');
  } finally { f.db.close(); }
});

test('read-only viewers get evidence without setup or operating actions', async () => {
  const f = fixture();
  try {
    assert.equal((await growAttention(f.x(), false)).primary, null);
    f.focus(); f.snapshot();
    const r = await growAttention(f.x(), false);
    assert.equal(r.measurement.value?.value, 0);
    assert.equal(r.primary, null);
    assert.deepEqual(r.items, []);
  } finally { f.db.close(); }
});

test('unsupported stored focus keys fail explicitly without becoming missing evidence', async () => {
  const f = fixture();
  try {
    f.focus(1, 'notes');
    const r = await growAttention(f.x(), true);
    assert.equal(r.focus.state, 'unreadable');
    assert.equal(r.primary, null);
  } finally { f.db.close(); }
});


test('saved proposals stay behind the Mercury team boundary and remain scoped to their venture', async () => {
  const f = fixture();
  try {
    f.db.exec("INSERT INTO mercury_partner_proposals VALUES (1,'pending'),(1,'accepted'),(2,'pending'),(2,'pending')");
    f.focus(); f.snapshot();
    const own = await growAttention(f.x(), true, { user: { id: 1, founder_id: 11 } });
    assert.deepEqual(own.signals.partner_proposals, { state: 'recorded', value: 1 });
    assert.equal(own.items[0].key, 'partner_proposal');
    assert.equal(own.items[0].href, '/grow/partner-network?project_id=1');
    const outsider = await growAttention(f.x(), true, { user: { id: 9, founder_id: null } });
    assert.deepEqual(outsider.signals.partner_proposals, { state: 'restricted', value: null });
    assert.equal(outsider.items.some((i) => i.key === 'partner_proposal'), false);
    const other = await growAttention(f.x(2), true, { user: { id: 1, founder_id: 11 } });
    assert.deepEqual(other.signals.partner_proposals, { state: 'restricted', value: null });
  } finally { f.db.close(); }
});

test('stalled customers use the latest valid touch; recent activity and invalid stamps never create a stalled action', async () => {
  const f = fixture();
  try {
    f.focus(); f.snapshot();
    f.db.exec("INSERT INTO waitlist_signups VALUES (1,'2026-09-01','2026-11-12',NULL,NULL),(1,'2026-10-01',NULL,NULL,NULL),(1,'bad','bad',NULL,NULL),(2,'2026-09-01',NULL,NULL,NULL)");
    const r = await growAttention(f.x(), true);
    assert.deepEqual(r.signals.stalled_customers, { state: 'recorded', value: 1 });
    assert.equal(r.items[0].key, 'stalled_customers');
    assert.equal(r.items[0].href, '/grow/customers?project_id=1');
    f.db.exec("UPDATE waitlist_signups SET followed_up_at='2026-11-13' WHERE project_id=1");
    const recovered = await growAttention(f.x(), true);
    assert.deepEqual(recovered.signals.stalled_customers, { state: 'recorded', value: 0 });
    assert.equal(recovered.items.some((i) => i.key === 'stalled_customers'), false);
  } finally { f.db.close(); }
});

test('a failed channel read does not become Add your first channel or erase known focus evidence', async () => {
  const f = fixture();
  try {
    f.focus(); f.snapshot(); f.db.exec('DROP TABLE growth_channels');
    const r = await growAttention(f.x(), true);
    assert.equal(r.state, 'partial');
    assert.equal(r.primary?.key, 'review_growth');
    assert.equal(r.signals.channels.state, 'unreadable');
    assert.equal(r.items.some((i) => i.key === 'add_channel'), false);
  } finally { f.db.close(); }
});

test('existing source failures, proposals, offers and stalled records retain their operational ordering', async () => {
  const f = fixture();
  try {
    f.focus(); f.snapshot();
    f.db.exec("INSERT INTO mercury_partner_proposals VALUES (1,'pending'); INSERT INTO waitlist_signups VALUES (1,'2026-10-01',NULL,NULL,NULL)");
    const options = {
      user: { id: 1, founder_id: 11 },
      figures: [{ key: 'mrr', state: 'unreadable' }] as Figure[],
      cards: [{ slug: 'team-expansion', series: { roles_by_stage: [{ stage: 'offer', count: 2 }] } }] as Card[],
    };
    const r = await growAttention(f.x(), true, options);
    assert.deepEqual(r.items.map((i) => i.key), ['focus_unreadable', 'partner_proposal', 'offers', 'stalled_customers']);
    assert.equal(r.items[2].href, '/grow/talent?project_id=1');
    assert.equal(r.items[2].why, '2 applications at the offer stage.');
    const cleared = await growAttention(f.x(), true, { ...options, figures: [], cards: [] });
    assert.equal(cleared.items.some((i) => ['focus_unreadable', 'offers'].includes(i.key)), false);
  } finally { f.db.close(); }
});

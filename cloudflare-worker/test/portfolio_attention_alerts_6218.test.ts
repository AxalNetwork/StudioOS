/**
 * D6218 (#6218): a company that turns to Attention on a health recompute tells
 * its holders once, and only its holders.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { ATTENTION_TYPE, raiseAttentionAlerts } from '../src/services/portfolioAttentionAlerts.ts';

const HOLDER = 10, SEAT = 11, WATCHER = 12, PENDING = 13, OTHER_CO = 14, FOUNDER = 15, INACTIVE = 16;
const P = 1, Q = 2;
const project = { id: P, uid: 'proj-p-uid', name: 'Acme Robotics' };

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`
    INSERT INTO users (id, email, name, role, is_active, investor_seat_primary_user_id) VALUES
      (${HOLDER}, 'h@example.invalid', 'Holder', 'investor', 1, NULL),
      (${SEAT}, 's@example.invalid', 'Seat member', 'investor', 1, ${HOLDER}),
      (${WATCHER}, 'w@example.invalid', 'Watcher', 'investor', 1, NULL),
      (${PENDING}, 'p@example.invalid', 'Pending', 'investor', 1, NULL),
      (${OTHER_CO}, 'o@example.invalid', 'Other company', 'investor', 1, NULL),
      (${FOUNDER}, 'f@example.invalid', 'Founder', 'founder', 1, NULL),
      (${INACTIVE}, 'i@example.invalid', 'Inactive seat', 'investor', 0, ${HOLDER});
    INSERT INTO projects (id, uid, name) VALUES (${P}, 'proj-p-uid', 'Acme Robotics'), (${Q}, 'proj-q-uid', 'Other Co');
    INSERT INTO deals (id, project_id) VALUES (100, ${P}), (200, ${Q});
    INSERT INTO investor_introductions (uid, investor_user_id, project_id, status, quarter) VALUES
      ('i1', ${HOLDER}, ${P}, 'accepted', '2026-Q4'), ('i2', ${WATCHER}, ${P}, 'accepted', '2026-Q4'),
      ('i3', ${PENDING}, ${P}, 'accepted', '2026-Q4'), ('i4', ${OTHER_CO}, ${Q}, 'accepted', '2026-Q4');
    -- Holder: a confirmed commitment. Pending: only a pending one. Other company: confirmed, on another company.
    -- Founder: a confirmed row but no investor licence. Watcher: related, no commitment.
    INSERT INTO commitments (deal_id, investor_user_id, amount, status) VALUES
      (100, ${HOLDER}, 1000, 'confirmed'), (100, ${PENDING}, 500, 'pending'), (200, ${OTHER_CO}, 700, 'confirmed'),
      (100, ${FOUNDER}, 1, 'confirmed');
    INSERT INTO portfolio_health_snapshots (uid, project_id, snapshot_date, score, badge, intervention) VALUES
      ('s-old', ${P}, '2026-11-01', 58, 'yellow', 0),
      ('s-new', ${P}, '2026-11-08', 31, 'red', 1);
  `);
  const env = { DB: d1Over(db) } as any;
  const inbox = () => db.prepare(`SELECT user_id, type, title, body, link FROM notifications_inbox ORDER BY user_id, id`).all() as any[];
  return { db, env, inbox };
}
const red = { uid: 's-new', project_id: P, snapshot_date: '2026-11-08', score: 31, badge: 'red' };

test('a change into Attention notifies each holder and their seat once, naming the evidence, its date and the company link', async () => {
  const f = fixture();
  assert.equal(await raiseAttentionAlerts(f.env, project, red), 2);
  const rows = f.inbox();
  assert.deepEqual(rows.map((r) => r.user_id), [HOLDER, SEAT]);
  for (const r of rows) {
    assert.equal(r.type, ATTENTION_TYPE);
    assert.equal(r.title, 'Acme Robotics needs attention');
    assert.equal(r.body, 'Health turned to Attention on 2026-11-08: score 31, from Watch (58) on 2026-11-01. Source: Health.');
    assert.equal(r.link, '/portfolio/companies/proj-p-uid');
  }
});

test('the same snapshot, or a later recompute still red, never notifies again', async () => {
  const f = fixture();
  await raiseAttentionAlerts(f.env, project, red);
  assert.equal(await raiseAttentionAlerts(f.env, project, red), 0);
  f.db.exec(`INSERT INTO portfolio_health_snapshots (uid, project_id, snapshot_date, score, badge) VALUES ('s-later', ${P}, '2026-11-15', 25, 'red')`);
  assert.equal(await raiseAttentionAlerts(f.env, project, { ...red, uid: 's-later', snapshot_date: '2026-11-15', score: 25 }), 0);
  assert.equal(f.inbox().length, 2);
  // A recovery and a new fall is a new change, and notifies again.
  f.db.exec(`INSERT INTO portfolio_health_snapshots (uid, project_id, snapshot_date, score, badge) VALUES ('s-ok', ${P}, '2026-11-20', 75, 'green'), ('s-fall', ${P}, '2026-11-22', 20, 'red')`);
  assert.equal(await raiseAttentionAlerts(f.env, project, { ...red, uid: 's-fall', snapshot_date: '2026-11-22', score: 20 }), 2);
  assert.match(f.inbox().at(-1).body, /from Healthy \(75\) on 2026-11-20/);
});

test('only holders: not a related watcher, a pending commitment, another company\'s holder, a founder or an inactive seat', async () => {
  const f = fixture();
  await raiseAttentionAlerts(f.env, project, red);
  const users = new Set(f.inbox().map((r) => r.user_id));
  for (const u of [WATCHER, PENDING, OTHER_CO, FOUNDER, INACTIVE]) assert.equal(users.has(u), false, `user ${u}`);
});

test('no change, no notice: a first snapshot, a red-to-red snapshot and a snapshot that is not red', async () => {
  const f = fixture();
  // Watch after Watch is a snapshot, not a change into Attention.
  assert.equal(await raiseAttentionAlerts(f.env, project, { ...red, badge: 'yellow', score: 45 }), 0);
  f.db.exec(`DELETE FROM portfolio_health_snapshots WHERE uid = 's-old'`);
  assert.equal(await raiseAttentionAlerts(f.env, project, red), 0);
  f.db.exec(`INSERT INTO portfolio_health_snapshots (uid, project_id, snapshot_date, score, badge) VALUES ('s-red-before', ${P}, '2026-11-01', 30, 'red')`);
  assert.equal(await raiseAttentionAlerts(f.env, project, red), 0);
  assert.equal(await raiseAttentionAlerts(f.env, project, { ...red, badge: 'yellow', score: 50 }), 0);
  assert.equal(f.inbox().length, 0);
});

test('a holder who turned the type off in Settings gets no inbox row, and is not asked again for this change', async () => {
  const f = fixture();
  f.db.prepare(`UPDATE users SET notification_prefs = ? WHERE id = ?`).run(JSON.stringify({ [ATTENTION_TYPE]: { in_app: false, inapp: false, email: false } }), HOLDER);
  assert.equal(await raiseAttentionAlerts(f.env, project, red), 2);
  assert.deepEqual(f.inbox().map((r) => r.user_id), [SEAT]);
});

test('a failed read raises nothing and throws to the recompute, which logs it and answers as before', async () => {
  const f = fixture();
  f.db.exec('DROP TABLE commitments');
  await assert.rejects(raiseAttentionAlerts(f.env, project, red));
  assert.equal(f.inbox().length, 0);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM portfolio_attention_alerts').get() as any).n, 0);
  // The route raises only for a snapshot it wrote (an unmeasurable health read writes none), inside a catch.
  const src = readFileSync(new URL('../src/routes/portfolio.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('async function upsertSnapshot'), src.indexOf("r.get('/health'"));
  assert.ok(body.indexOf('if (!scorable(scored)) return { row: null, scored };') < body.indexOf('raiseAttentionAlerts'));
  assert.match(body, /if \(row\) \{\s*try \{ await raiseAttentionAlerts\(env, project, row\); \}\s*catch \(e\)/);
});

test('migration: one alert per company, holder and change', () => {
  const f = fixture();
  const idx = f.db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'portfolio_attention_alerts'`).get() as any;
  assert.match(idx.sql, /UNIQUE \(project_id, user_id, changed_on\)/);
  f.db.exec(`INSERT INTO portfolio_attention_alerts (project_id, user_id, changed_on, snapshot_uid) VALUES (1, 10, '2026-11-08', 'x')`);
  assert.throws(() => f.db.exec(`INSERT INTO portfolio_attention_alerts (project_id, user_id, changed_on, snapshot_uid) VALUES (1, 10, '2026-11-08', 'y')`), /UNIQUE/);
});

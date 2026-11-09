/**
 * D4814 (#4814, part 5, AP-18f) — a decision on one of Approvals' boards is
 * recorded before anyone is told, so a notice that does not go out is
 * reported, never thrown. Each decision route answers `notified`: true when
 * the inbox row was written, false when it was not. A route that threw after
 * committing would have answered 500 and invited a second decision that the
 * store then refuses.
 *
 * Delivery is made to fail here by a test-only trigger that refuses every
 * inbox insert; `notify` catches that and answers null, which is what a full
 * inbox store or a member who turned every channel off also look like.
 * The database is the baseline plus every migration, built once per run (D4133).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import comarketing from '../src/routes/comarketing.ts';
import wellbeing from '../src/routes/wellbeing.ts';
import testers from '../src/routes/admin_product_testers.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { copySchemaTo } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'approvals-4814-notified-'));
const seed = copySchemaTo(join(scratch, 'chain.sqlite'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const SECRET = 'x'.repeat(48);
let serial = 0;
function fixture({ deliver }: { deliver: boolean }) {
  const file = join(scratch, `${++serial}.sqlite`); copyFileSync(seed, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  db.exec(`DELETE FROM experts;
    INSERT INTO users(id,role,name,email,is_active,email_verified,partner_id) VALUES
    (1,'admin','Synthetic admin','admin@example.invalid',1,1,NULL),
    (3,'partner','Synthetic expert','expert@example.invalid',1,1,7),
    (4,'founder','Synthetic tester','tester@example.invalid',1,1,NULL);
    INSERT INTO partners(id,name,company,email) VALUES(7,'Synthetic partner','Synthetic agency','partner@example.invalid');
    INSERT INTO experts(uid,user_id,name,created_at) VALUES('expert-a',3,'Synthetic expert','2026-10-01 00:00:00');
    INSERT INTO comarketing_pitches(id,uid,partner_id,submitter_user_id,title,summary,asset_type,status,created_at,updated_at)
      VALUES(1,'pitch-1',7,3,'Synthetic pitch','Synthetic summary','webinar','proposed','2026-10-01 00:00:00','2026-10-01 00:00:00');
    INSERT INTO product_testers(id,user_id,status,applied_at) VALUES(1,4,'applied','2026-10-01 00:00:00');`);
  // The inbox store exists before the first notice, so the trigger has a table to sit on.
  db.exec(`CREATE TABLE IF NOT EXISTS notifications_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT,
    link TEXT, payload TEXT, channel TEXT, category TEXT, severity TEXT, cta_url TEXT, template_key TEXT, read_at TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  if (!deliver) db.exec("CREATE TRIGGER refuse_inbox BEFORE INSERT ON notifications_inbox BEGIN SELECT RAISE(ABORT, 'inbox refused for the test'); END;");
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>();
  app.route('/api/comarketing', comarketing); app.route('/api/wellbeing', wellbeing); app.route('/api/admin/product-testers', testers);
  app.onError((e, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] ?? 500));
  return { db, env, app };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, path: string, body: any) {
  const token = await new SignJWT({ user_id: 1 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await f.app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, f.env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const one = (f: F, sql: string) => f.db.prepare(sql).get() as any;

test('a co-marketing approval is recorded and says whether the partner was told', async () => {
  const ok = fixture({ deliver: true });
  const sent = await call(ok, '/api/comarketing/admin/pitches/pitch-1/approve', {});
  assert.equal(sent.status, 200);
  assert.equal(sent.body.notified, true);
  const quiet = fixture({ deliver: false });
  const r = await call(quiet, '/api/comarketing/admin/pitches/pitch-1/approve', {});
  assert.equal(r.status, 200, 'a notice that did not go out is never a failed decision');
  assert.equal(r.body.notified, false);
  assert.equal(r.body.status, 'approved');
  assert.equal(one(quiet, "SELECT status FROM comarketing_pitches WHERE uid='pitch-1'").status, 'approved', 'the decision was recorded');
});

test('a wellbeing verification is recorded and says whether the expert was told', async () => {
  const body = { verified: true, credentials_checked: true, expected_version: 0 };
  const ok = fixture({ deliver: true });
  assert.equal((await call(ok, '/api/wellbeing/admin/experts/expert-a/verify', body)).body.notified, true);
  const quiet = fixture({ deliver: false });
  const r = await call(quiet, '/api/wellbeing/admin/experts/expert-a/verify', body);
  assert.equal(r.status, 200);
  assert.equal(r.body.notified, false);
  assert.equal(one(quiet, "SELECT verified FROM experts WHERE uid='expert-a'").verified, 1, 'the decision was recorded');
});

test('a product tester approval is recorded and says whether the member was told', async () => {
  const ok = fixture({ deliver: true });
  const sent = await call(ok, '/api/admin/product-testers/1/approve', {});
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.notified, true);
  const quiet = fixture({ deliver: false });
  const r = await call(quiet, '/api/admin/product-testers/1/approve', {});
  assert.equal(r.status, 200);
  assert.equal(r.body.notified, false);
  assert.equal(one(quiet, 'SELECT status FROM product_testers WHERE id=1').status, 'active', 'the decision was recorded');
});

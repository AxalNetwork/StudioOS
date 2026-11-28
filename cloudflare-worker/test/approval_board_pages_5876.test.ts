/** D5876: real scoped summaries and server-paged rows over the migrated Approval stores.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): Mounted summary and active-page queries
 * across the three approval lanes (#5876).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { Env } from '../src/types';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors';
import testers from '../src/routes/admin_product_testers';
import comarketing from '../src/routes/comarketing';
import wellbeing from '../src/routes/wellbeing';
import { SAMPLE_EXPERT_UID_PREFIX } from '../src/services/wellbeing/seedExperts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

after(removeMigratedDatabases);

test('summary counts include off-page rows and keep the same visibility as each list', async (t) => {
  const db = migratedDatabase();
  t.after(() => db.close());
  db.exec(`INSERT INTO users(id, role, name, email, is_active, email_verified) VALUES
    (1,'admin','Reviewer','reviewer@example.invalid',1,1),
    (2,'admin','Other admin','other-admin@example.invalid',1,1),
    (3,'founder','Zed Sample','zed@example.invalid',1,1),
    (4,'founder','Bea Sample','bea@example.invalid',1,0),
    (5,'investor','Al Sample','al@example.invalid',1,0);
    INSERT INTO product_testers(id,user_id,status,applied_at,consent_email_at,consent_version,decided_at) VALUES
    (1,3,'applied',datetime('now', '-5 days'),datetime('now', '-5 days'),'v1',NULL),
    (2,4,'applied',datetime('now', '-2 days'),NULL,NULL,NULL),
    (3,5,'active',datetime('now', '-100 days'),NULL,NULL,datetime('now', '-99 days'));
    INSERT INTO experts(uid,user_id,name,profile_completion_pct,verified,hidden_by_admin,decision_state) VALUES
    ('verify-a',3,'Verify A',70,0,0,'pending'),
    ('verify-b',4,'Verify B',95,0,0,'pending'),
    ('verify-admin',2,'Other admin',95,0,0,'pending'),
    ('incomplete',5,'Incomplete',69,0,0,'pending'),
    ('hidden',NULL,'Hidden',85,1,1,'verified'),
    ('declined',NULL,'Declined',85,1,0,'declined');
    INSERT INTO partners(id,name,company,email) VALUES(7,'Partner','Synthetic firm','partner@example.invalid');
    INSERT INTO comarketing_pitches(id,uid,partner_id,submitter_user_id,title,summary,asset_type,status,reviewed_at) VALUES
    (1,'pitch-1',7,3,'Pitch A','Sample','webinar','proposed',NULL),
    (2,'pitch-2',7,3,'Pitch B','Sample','webinar','proposed',NULL),
    (3,'pitch-3',7,3,'Approved','Sample','webinar','approved','2026-09-13 12:00:00'),
    (4,'pitch-4',7,3,'Published','Sample','webinar','published','2026-09-13 12:00:00');`);
  db.prepare('INSERT INTO experts(uid,name,profile_completion_pct) VALUES(?,?,90)').run(`${SAMPLE_EXPERT_UID_PREFIX}fixture`, 'Sample');
  const secret = 's'.repeat(48);
  const env = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/admin/product-testers', testers);
  app.route('/api/comarketing', comarketing);
  app.route('/api/wellbeing', wellbeing);
  app.onError((error, c) => c.json({ detail: error.message }, AUTH_ERROR_STATUSES[error.message] ?? 500));
  const token = (uid: number) => new SignJWT({ user_id: uid }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const admin = await token(1);
  const get = (path: string, credential = admin) => app.request(path, { headers: { Authorization: `Bearer ${credential}` } }, env);
  const read = async (path: string): Promise<any> => {
    const res = await get(path);
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    return body;
  };

  const testerPath = '/api/admin/product-testers';
  const expertPath = '/api/wellbeing/admin/experts';
  const pitchPath = '/api/comarketing/admin/queue';
  const member = await token(3);
  for (const path of [testerPath, expertPath, pitchPath]) {
    assert.equal((await get(`${path}/summary`, member)).status, 403);
  }
  const testerCounts = await read(`${testerPath}/summary`);
  assert.equal(testerCounts.counts.applied, 2);
  assert.deepEqual(testerCounts.recent_by_role, [{ role: 'founder', n: 2 }]);
  const testerFirst = await read(`${testerPath}?status=applied&page_size=1&sort=name`);
  assert.equal(testerFirst.matching, 2);
  assert.deepEqual(testerFirst.rows.map((row: any) => row.id), [2]);
  const testerSecond = await read(`${testerPath}?status=applied&page_size=1&sort=name&page=2`);
  assert.deepEqual(testerSecond.rows.map((row: any) => row.id), [1]);
  for (const filter of ['q=zed', 'email_verified=yes', 'email_consent=yes', 'role=founder&q=%25zed']) {
    const page = await read(`${testerPath}?status=applied&page_size=1&${filter}`);
    const ids = filter.includes('%25') ? [] : [1];
    assert.equal(page.matching, ids.length);
    assert.deepEqual(page.rows.map((row: any) => row.id), ids);
  }

  const expertCounts = await read(`${expertPath}/summary`);
  assert.deepEqual(expertCounts.counts, { verify: 2, incomplete: 1, verified: 0, declined: 1, hidden: 1 });
  const verify = await read(`${expertPath}?board_tab=verify&limit=1&offset=1`);
  assert.equal(verify.total, 2);
  assert.deepEqual(verify.items.map((row: any) => row.uid), ['verify-b']);

  const pitchCounts = await read(`${pitchPath}/summary`);
  assert.deepEqual(pitchCounts.counts, { proposed: 2, approved: 1, published: 1, rejected: 0, withdrawn: 0 });
  assert.equal(pitchCounts.oldest_approved_at, '2026-09-13 12:00:00');
  const proposed = await read(`${pitchPath}?status=proposed&limit=1&offset=1`);
  assert.equal(proposed.total, 2);
  assert.deepEqual(proposed.items.map((row: any) => row.uid), ['pitch-2']);
});

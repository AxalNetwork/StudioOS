/** D4439 (#4439): member role refusals precede every read/write; HQ keeps historical pitches. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import comarketing from '../src/routes/comarketing.ts';
import { d1Over, makeD1 } from './_d1_sqlite.mjs';
import publicRoutes from '../src/routes/public.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const roles = ['investor', 'founder', 'partner', 'admin'];
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['users', 'partners', 'comarketing_pitches', 'comarketing_attributions', 'user_company_links']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, name)));
  }
  db.exec('CREATE TABLE activity_logs (id INTEGER PRIMARY KEY, user_id INTEGER, project_id INTEGER, action TEXT, details TEXT, actor TEXT)');
  roles.forEach((role, i) => db.prepare('INSERT INTO users (id,email,name,role,partner_id,subscription_tier) VALUES (?,?,?,?,7,?)')
    .run(i + 1, role + '@synthetic.example', role, role, 'studio'));
  db.exec("INSERT INTO partners (id,name,company,email) VALUES (7,'Synthetic partner','Synthetic agency','partner@synthetic.example')");
  // A historical investor submission is deliberately retained. Its author loses
  // access, while the unchanged HQ board can still read and review the record.
  db.exec(`INSERT INTO comarketing_pitches (id,uid,partner_id,submitter_user_id,title,summary,asset_type,status,attribution_code,created_at,updated_at)
    VALUES (1,'historical-investor',7,1,'Historical pitch','An existing investor pitch','webinar','proposed',NULL,'2026-10-01','2026-10-01'),
    (2,'published-partner',7,3,'Published piece','An existing published pitch','blog','published','live-code','2026-10-02','2026-10-02')`);
  const app = new Hono<any>();
  app.route('/api/comarketing', comarketing);
  async function call(role: string | null, method: string, path: string, body?: unknown) {
    const token = role ? await new SignJWT({ user_id: roles.indexOf(role) + 1, role })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET)) : null;
    const res = await app.request('/api/comarketing' + path, {
      method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { DB: d1Over(db), JWT_SECRET } as any);
    return { status: res.status, body: await res.json() as any };
  }
  return { db, call };
}

test('an investor is refused on all member routes, including aliases, before data or a write', async () => {
  const { db, call } = fixture();
  const before = db.prepare('SELECT * FROM comarketing_pitches ORDER BY id').all();
  for (const [method, path] of [
    ['GET', '/published'], ['GET', '/campaigns'], ['GET', '/me/pitches'], ['GET', '/me/attributions'],
    ['GET', '/me/pitches/historical-investor'], ['GET', '/founder/by-project/77'],
    ['PATCH', '/me/pitches/historical-investor'], ['POST', '/me/pitches/historical-investor/withdraw'],
    ['POST', '/me/pitches'], ['POST', '/pitches'], ['POST', '/campaigns'], ['POST', '/track'],
  ]) {
    const result = await call('investor', method, path, method === 'GET' ? undefined : {
      title: 'Changed title', summary: 'An attempted submission', code: 'live-code', event_kind: 'visit',
    });
    assert.equal(result.status, 403, method + ' ' + path);
    assert.equal(result.body.error, 'comarketing_role_required');
    assert.ok(!JSON.stringify(result.body).includes('Historical pitch'));
  }
  assert.deepEqual(db.prepare('SELECT * FROM comarketing_pitches ORDER BY id').all(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comarketing_attributions').get()!.n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get()!.n, 0);
  db.close();
});

test('partners and founders retain the published feed and visit recording', async () => {
  const { db, call } = fixture();
  for (const role of ['partner', 'founder']) {
    for (const path of ['/published']) {
      const result = await call(role, 'GET', path);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.items.map((p: any) => p.uid), ['published-partner']);
    }
    assert.equal((await call(role, 'POST', '/track', { code: 'live-code', event_kind: 'visit' })).status, 200);
  }
  assert.deepEqual(db.prepare('SELECT user_id,lead_email FROM comarketing_attributions ORDER BY id').all()
    .map((row) => [row.user_id, row.lead_email]), [[3, null], [2, null]]);
  assert.equal((await call('partner', 'GET', '/me/pitches')).status, 200);
  // Moving the founder's feed does not turn a founder into a partner writer.
  assert.equal((await call('founder', 'GET', '/me/pitches')).status, 403);
  assert.equal((await call('founder', 'POST', '/me/pitches', { title: 'Founder pitch', summary: 'A long enough summary' })).status, 403);
  assert.equal((await call(null, 'GET', '/published')).status, 401);
  db.close();
});

test('HQ keeps the investor history and its requireAdmin gates on every board action', async () => {
  const { db, call } = fixture();
  for (const role of ['investor', 'founder', 'partner']) {
    for (const [method, path] of [['GET', '/admin/queue'], ['GET', '/admin/pitches/historical-investor'],
      ['POST', '/admin/pitches/historical-investor/approve'], ['POST', '/admin/pitches/historical-investor/reject'],
      ['POST', '/admin/pitches/historical-investor/publish']]) {
      assert.equal((await call(role, method, path, method === 'GET' ? undefined : {})).status, 403, role + ' ' + path);
    }
  }
  const queue = await call('admin', 'GET', '/admin/queue?status=all');
  assert.equal(queue.status, 200);
  assert.deepEqual(queue.body.items.map((p: any) => p.uid), ['historical-investor', 'published-partner']);
  const history = await call('admin', 'GET', '/admin/pitches/historical-investor');
  assert.equal(history.status, 200);
  assert.equal(history.body.submitter_user_id, 1);
  assert.equal(history.body.title, 'Historical pitch');
  db.close();
});

test('the founder forward persists its D2301 counter while an ordinary partner pageview is ignored', async () => {
  const env = makeD1('CREATE TABLE public_pageviews (day TEXT NOT NULL,path TEXT NOT NULL,views INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,path))');
  for (const path of ['redirect:/comarketing', 'redirect:/comarketing', '/comarketing']) {
    const result = await publicRoutes.request('/analytics/pageview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }),
    }, env);
    assert.equal(result.status, 204);
  }
  assert.deepEqual(env.db.prepare('SELECT path,views FROM public_pageviews').all().map((r: any) => [r.path, r.views]), [['redirect:/comarketing', 2]]);
  env.db.close();
});

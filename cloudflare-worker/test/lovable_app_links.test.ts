/**
 * D1083 (#2948, Lovable part 3 of #2398) — the founder's Lovable app address
 * on an experiment or on Prototype / MVP, and its founder-pressed live check.
 *
 * `fetch` is stubbed in every test: no test reaches a real host. The table is
 * migration 585's, applied for real.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lovable_app_links.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import routes from '../src/routes/lovable_app_links.ts';
import { checkAppUrl, lovablePart, plainTitle, linkView } from '../src/services/lovableAppLinks.ts';
import { hostOf, liveLineOwner } from '../src/services/liveHost.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1;
const OTHER = 2;
const ADMIN = 3;
const SUPER = 4;
const ROLES: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder', [ADMIN]: 'admin', [SUPER]: 'admin' };
const APP = 'https://harbor-ledger-waitlist.lovable.app/';
const PAGE = '<html><head><title>Harbor <b>Ledger</b> &lt;script&gt;alert(1)&lt;/script&gt; waitlist</title></head><body>Join the waitlist</body></html>';

const migration = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT, founder_id INTEGER)`);
  db.exec(`CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT)`);
  db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER, deleted_at TEXT)`);
  db.exec(`CREATE TABLE hypothesis_experiments (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, hypothesis_id INTEGER, title TEXT)`);
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, user_id INTEGER, entity_type TEXT,
                                       entity_id TEXT, action TEXT, details TEXT, actor TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE competitor_cached_fetches (url_hash TEXT PRIMARY KEY, url TEXT, status INTEGER, title TEXT, description TEXT,
                                                   text TEXT, headings_json TEXT, pricing_json TEXT, fetched_at TEXT, expires_at TEXT)`);
  const u = db.prepare('INSERT INTO users (id, uid, role, name, email, founder_id) VALUES (?, ?, ?, ?, ?, ?)');
  u.run(FOUNDER, 'u-f', 'founder', 'Fay Founder', 'f@x.test', 11);
  u.run(OTHER, 'u-o', 'founder', 'Otto Other', 'o@x.test', 12);
  u.run(ADMIN, 'u-a', 'admin', 'Alex Admin', 'a@x.test', null);
  u.run(SUPER, 'u-s', 'admin', 'Sam Super', 's@x.test', null);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare('INSERT INTO projects (id, founder_id) VALUES (1, 11), (2, 12)').run();
  db.prepare(`INSERT INTO hypothesis_experiments (id, uid, project_id, hypothesis_id, title) VALUES
              (5, 'e5', 1, 9, 'Landing page test'), (6, 'e6', 1, 9, 'Pricing page'), (7, 'e7', 2, 10, 'Someone else')`).run();
  for (const st of splitStatements(migration('585_lovable_app_links.sql'))) db.exec(st);
  return db;
}

const env = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: d1Over(db) }) as any;

const ERRORS = { Unauthorized: 401, 'Admin required': 403 } as Record<string, 401 | 403>;
const appFor = () => {
  const a = new Hono<any>();
  a.onError((err: any, c) => c.json({ detail: err?.message }, ERRORS[err?.message] ?? 500));
  a.route('/', routes);
  return a;
};
const app = appFor();

async function call(db: DatabaseSync, method: string, path: string, as: number, body?: unknown, opts: { impersonated?: boolean } = {}) {
  const jwt = await new SignJWT({ user_id: as, role: ROLES[as], ...(opts.impersonated ? { impersonated_by: SUPER } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env(db));
  let json: any = null;
  try { json = await res.json(); } catch { /* status says it */ }
  return { status: res.status, body: json };
}

/** The stubbed network: every request is recorded; the answer is per host. */
type Answer = { status: number; body?: string; type?: string } | 'throw';
function stubNetwork(answers: Record<string, Answer>) {
  const seen: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(typeof input === 'string' ? input : input.url);
    seen.push(url);
    const a = answers[new URL(url).hostname] ?? { status: 404, body: 'nope' };
    if (a === 'throw') throw new Error('connection refused');
    return new Response(a.body ?? '', { status: a.status, headers: { 'content-type': a.type ?? 'text/html; charset=utf-8' } });
  }) as any;
  return { seen, restore: () => { globalThis.fetch = original; } };
}

const rows = (db: DatabaseSync) => db.prepare('SELECT * FROM lovable_app_links ORDER BY id').all() as any[];
const acts = (db: DatabaseSync) => db.prepare('SELECT entity_type, entity_id, action, details FROM activity_logs ORDER BY id').all() as any[];

test('the address: https only, a public host, no credentials; refused addresses store nothing and are never echoed', async () => {
  const db = freshDb();
  const net = stubNetwork({});
  try {
    const refused: Array<[string, string]> = [
      ['http://harbor.lovable.app', 'app_url_not_https'],
      ['https://localhost/app', 'app_url_not_public'],
      ['https://127.0.0.1/', 'app_url_not_public'],
      ['https://10.0.0.8/', 'app_url_not_public'],
      ['https://192.168.1.4/', 'app_url_not_public'],
      ['https://169.254.169.254/latest', 'app_url_not_public'],
      ['https://intranet.internal/', 'app_url_not_public'],
      ['https://user:pw@harbor.lovable.app/', 'app_url_invalid'],
      ['ftp://harbor.lovable.app/', 'app_url_not_https'],
      ['', 'app_url_required'],
    ];
    for (const [url, code] of refused) {
      const r = await call(db, 'PUT', '/build/lovable/app-link?project=1', FOUNDER, { app_url: url });
      assert.equal(r.status, 400, url);
      assert.equal(r.body.code, code, url);
      if (url) assert.ok(!JSON.stringify(r.body).includes(url), `the refusal does not echo ${url}`);
    }
    assert.equal(rows(db).length, 0);
    assert.equal(net.seen.length, 0, 'linking never fetches');
  } finally { net.restore(); }
  assert.deepEqual(checkAppUrl('https://Harbor.lovable.app/x#frag'), { ok: true, url: 'https://harbor.lovable.app/x' });
});

test('link: the venture\'s own or an admin\'s, never another member\'s or a support session\'s; logged without the address', async () => {
  const db = freshDb();
  const net = stubNetwork({});
  try {
    const other = await call(db, 'PUT', '/build/lovable/app-link?project=1', OTHER, { app_url: APP });
    assert.equal(other.status, 403);
    const support = await call(db, 'PUT', '/build/lovable/app-link?project=1', FOUNDER, { app_url: APP }, { impersonated: true });
    assert.equal(support.status, 403);
    assert.equal(support.body.code, 'support_session_refused');
    const badCycle = await call(db, 'PUT', '/raise/lovable/app-link?project=1', FOUNDER, { app_url: APP });
    assert.equal(badCycle.status, 404);
    assert.equal(badCycle.body.detail, 'No such cycle');
    assert.equal(rows(db).length, 0);

    const ok = await call(db, 'PUT', '/build/lovable/app-link?project=1', FOUNDER, { app_url: APP });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.link.status, 'not_checked', 'a new link has no check yet');
    assert.equal(ok.body.link.host, 'harbor-ledger-waitlist.lovable.app');
    const [row] = rows(db);
    assert.deepEqual({ module: row.module, record_table: row.record_table, record_id: row.record_id, created_by: row.created_by, lovable_project_id: row.lovable_project_id },
      { module: 'prototype-mvp', record_table: 'projects', record_id: 1, created_by: FOUNDER, lovable_project_id: null });

    const byAdmin = await call(db, 'PUT', '/validate/lovable/app-link?project=1', ADMIN, { record_id: 5, app_url: APP });
    assert.equal(byAdmin.status, 200, 'an admin may write, as canWrite allows');

    const log = acts(db);
    assert.deepEqual(log.map((a) => [a.entity_type, a.entity_id, a.action]), [
      ['build.prototype-mvp', null, 'lovable_app_linked'], ['validate.experiments', '9', 'lovable_app_linked']]);
    assert.ok(!JSON.stringify(log).includes('lovable.app'), 'the address is never in the activity row');
    assert.equal(net.seen.length, 0);
  } finally { net.restore(); }
});

test('an experiment must be this venture\'s; one link per record; a new address forgets the old check', async () => {
  const db = freshDb();
  const net = stubNetwork({ 'harbor-ledger-waitlist.lovable.app': { status: 200, body: PAGE } });
  try {
    for (const record_id of [7, 999, 'x', undefined]) {
      const r = await call(db, 'PUT', '/validate/lovable/app-link?project=1', FOUNDER, { record_id, app_url: APP });
      assert.equal(r.status, 404, String(record_id));
    }
    const first = await call(db, 'PUT', '/validate/lovable/app-link?project=1', FOUNDER, { record_id: 5, app_url: APP });
    await call(db, 'POST', `/validate/lovable/app-link/${first.body.link.uid}/check?project=1`, FOUNDER);
    const same = await call(db, 'PUT', '/validate/lovable/app-link?project=1', FOUNDER, { record_id: 5, app_url: APP });
    assert.equal(same.body.link.status, 'live', 'the same address keeps its check');
    assert.equal(same.body.link.uid, first.body.link.uid);
    const moved = await call(db, 'PUT', '/validate/lovable/app-link?project=1', FOUNDER, { record_id: 5, app_url: 'https://harbor-v2.lovable.app/' });
    assert.equal(moved.body.link.status, 'not_checked');
    assert.equal(moved.body.link.checked_at, null);
    assert.equal(moved.body.link.title, null);
    assert.equal(rows(db).length, 1, 'one link per record');

    const del = await call(db, 'DELETE', '/validate/lovable/app-link?project=1&record_id=5', FOUNDER);
    assert.equal(del.status, 200);
    assert.equal(rows(db).length, 0);
    const again = await call(db, 'DELETE', '/validate/lovable/app-link?project=1&record_id=5', FOUNDER);
    assert.equal(again.status, 404);
    assert.equal((await call(db, 'DELETE', '/validate/lovable/app-link?project=1&record_id=5', OTHER)).status, 403);
  } finally { net.restore(); }
});

test('Check now: one fetch, only when pressed; Live stores the title as text; a failure reads Not reachable with its time', async () => {
  const db = freshDb();
  const net = stubNetwork({
    'harbor-ledger-waitlist.lovable.app': { status: 200, body: PAGE },
    'private-app.lovable.app': { status: 403, body: '<title>Sign in</title>' },
    'down.lovable.app': 'throw',
  });
  try {
    const link = (await call(db, 'PUT', '/build/lovable/app-link?project=1', FOUNDER, { app_url: APP })).body.link;
    assert.equal(net.seen.length, 0, 'nothing fetches until Check now');
    // A Competitors cache row for the same address must not answer a live check.
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(APP))))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    db.prepare(`INSERT INTO competitor_cached_fetches (url_hash, url, status, title, description, text, headings_json, pricing_json, fetched_at, expires_at)
                VALUES (?, ?, 500, 'Stale', '', 'stale', '[]', '[]', '2026-01-01T00:00:00Z', '2999-01-01T00:00:00Z')`).run(hash, APP);

    const live = await call(db, 'POST', `/build/lovable/app-link/${link.uid}/check?project=1`, FOUNDER);
    assert.equal(live.status, 200);
    assert.equal(net.seen.length, 1, 'one fetch per press');
    assert.equal(live.body.link.status, 'live');
    assert.equal(live.body.link.title, 'Harbor Ledger alert(1) waitlist', 'tags and angle brackets gone: text, never HTML');
    assert.ok(!/[<>]/.test(rows(db)[0].last_title));
    assert.match(live.body.link.checked_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM competitor_cached_fetches WHERE title != 'Stale'").get() as any).n, 0, 'the app\'s page is not cached as a competitor\'s');

    for (const host of ['private-app', 'down']) {
      await call(db, 'PUT', '/build/lovable/app-link?project=1', FOUNDER, { app_url: `https://${host}.lovable.app/` });
      const uid = rows(db)[0].uid;
      const r = await call(db, 'POST', `/build/lovable/app-link/${uid}/check?project=1`, FOUNDER);
      assert.equal(r.status, 200, host);
      assert.equal(r.body.link.status, 'not_reachable', host);
      assert.equal(r.body.link.title, null, host);
      assert.ok(r.body.link.checked_at, `${host}: Not reachable carries its time`);
    }
    assert.equal(net.seen.length, 3);

    // Another member, a support session and an unknown link all refuse, and fetch nothing.
    const uid = rows(db)[0].uid;
    assert.equal((await call(db, 'POST', `/build/lovable/app-link/${uid}/check?project=1`, OTHER)).status, 403);
    assert.equal((await call(db, 'POST', `/build/lovable/app-link/${uid}/check?project=1`, FOUNDER, undefined, { impersonated: true })).status, 403);
    assert.equal((await call(db, 'POST', `/build/lovable/app-link/${uid}/check?project=2`, OTHER)).status, 404, 'another venture\'s link is not found');
    assert.equal((await call(db, 'POST', `/build/lovable/app-link/not-a-uid/check?project=1`, FOUNDER)).status, 404);
    assert.equal(net.seen.length, 3);
    const checks = acts(db).filter((a) => a.action === 'lovable_app_checked').map((a) => a.details);
    assert.deepEqual(checks, ['Lovable app checked: Live', 'Lovable app checked: Not reachable', 'Lovable app checked: Not reachable']);
    assert.ok(checks.every((d) => !d.includes('lovable.app')), 'no address in a check\'s activity row');

    // An experiment's check lands on its claim's activity.
    const exp = (await call(db, 'PUT', '/validate/lovable/app-link?project=1', FOUNDER, { record_id: 6, app_url: APP })).body.link;
    await call(db, 'POST', `/validate/lovable/app-link/${exp.uid}/check?project=1`, FOUNDER);
    assert.deepEqual({ ...acts(db).at(-1) }, { entity_type: 'validate.experiments', entity_id: '9', action: 'lovable_app_checked', details: 'Lovable app checked: Live' });
  } finally { net.restore(); }
});

test('the part: one slot per record; a link or none; unreadable is a state, never an empty list', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO lovable_app_links (uid, project_id, module, record_table, record_id, app_url, last_status, last_title, checked_at)
              VALUES ('u1', 1, 'experiments', 'hypothesis_experiments', 5, ?, 'not_reachable', NULL, '2026-10-23T14:05:00Z')`).run(APP);
  const part = await lovablePart(env(db), 1, 'validate', [{ id: 5, label: 'Landing page test' }, { id: 6, label: 'Pricing page' }]);
  assert.equal(part.state, 'ok');
  assert.deepEqual((part as any).slots.map((s: any) => [s.record_id, s.label, s.link?.status ?? null, s.link?.checked_at ?? null]),
    [[5, 'Landing page test', 'not_reachable', '2026-10-23T14:05:00Z'], [6, 'Pricing page', null, null]]);
  const build = await lovablePart(env(db), 1, 'build', [{ id: 1, label: 'Prototype / MVP' }]);
  assert.deepEqual((build as any).slots[0].link, null, 'an experiment\'s link is not Prototype / MVP\'s');
  const other = await lovablePart(env(db), 2, 'validate', [{ id: 5, label: 'Landing page test' }]);
  assert.equal((other as any).slots[0].link, null, 'another venture never reads this one\'s link');

  db.exec('DROP TABLE lovable_app_links');
  const broken = await lovablePart(env(db), 1, 'validate', [{ id: 5, label: 'Landing page test' }]);
  assert.deepEqual(broken, { state: 'unreadable' });
});

test('liveHost: an exact host match is Vercel\'s line, drawn once; a sub-domain or a name never matches', () => {
  assert.equal(liveLineOwner('app.acme.example', ['app.acme.example']), 'vercel');
  assert.equal(liveLineOwner('https://APP.acme.example:443/path', ['app.acme.example.']), 'vercel', 'case, port, path and a trailing dot do not matter');
  assert.equal(liveLineOwner('www.app.example', ['app.example']), 'lovable', 'www.app.example is a different host');
  assert.equal(liveLineOwner('app.example', ['www.app.example']), 'lovable');
  assert.equal(liveLineOwner('acme', ['acme']), 'lovable', 'a name is never matched');
  assert.equal(liveLineOwner('acme.lovable.app', ['acme']), 'lovable');
  assert.equal(liveLineOwner('acme.lovable.app', []), 'lovable', 'until Vercel part 3 lands the list is empty');
  assert.equal(liveLineOwner(null, ['app.example']), 'lovable');
  assert.equal(hostOf('https://Harbor.lovable.app/x'), 'harbor.lovable.app');
  assert.equal(hostOf('not a host'), null);
  const row = { uid: 'u', record_id: 1, app_url: 'https://app.acme.example/', last_status: 'live', last_title: 't', checked_at: 'c' };
  assert.equal(linkView(row, ['app.acme.example']).hosted_on, 'vercel', 'From Lovable reads "Hosted on Vercel"');
  assert.equal(linkView(row, ['www.app.acme.example']).hosted_on, null);
  assert.equal(plainTitle('<b>  A   b </b>'), 'A b');
  assert.equal(plainTitle(''), null);
  assert.equal(plainTitle('x'.repeat(300))!.length, 120);
});

test('the reads carry parts.lovable: Prototype / MVP\'s and the experiment record\'s', () => {
  const build = readFileSync(new URL('../src/routes/cycle_build.ts', import.meta.url), 'utf8');
  // D1082 (#2947) keeps this part as the key's body and adds Build in Lovable's launch beside it.
  assert.match(build, /lovable: \{ \.\.\.\(await lovablePart\(env, p\.id, 'build', \[\{ id: p\.id, label: 'Prototype \/ MVP' \}\]\)\), launch: await prototypeLovable\(env, p, viewer\) \}/);
  const validate = readFileSync(new URL('../src/services/records/validate.ts', import.meta.url), 'utf8');
  assert.match(validate, /parts: \{ lovable: await lovableExperiments\(ctx, id\) \}/);
  assert.match(validate, /lovablePart\(ctx\.env, ctx\.projectId, 'validate'/);
});

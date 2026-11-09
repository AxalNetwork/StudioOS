/**
 * D4811 (#4811) part 4 — cross-object legal search (board CT-13) on
 * `GET /api/admin/contracts/search`: templates, agreements and governance in
 * one ranked list with type, context, status and version; current versions
 * first and earlier ones counted, then shown only on request; a confidential
 * governance record invisible (not even counted) to anyone but the Super
 * Admin; governance absent on a branch; an unreadable store named, never
 * read as no match. Real baseline schema; made-up rows.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/contracts_search_4811.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import contracts from '../src/routes/admin_contracts.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { likeOf, rank, scoreOf, searchQuery } from '../src/services/contractSearch.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'unit-test-secret-4811-search-012345678901234';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const SUPER = 1, ADMIN = 2;

function fixture({ governance = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const name of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'documents',
    'projects', 'founders', 'deals', 'esign_envelopes', 'esign_recipients', 'esign_audit_events', 'pairwise_ndas', 'partner_deals', 'partner_referral_redemptions', 'legal_templates', 'legal_template_versions']) {
    db.exec(tableFromBaseline(baseline, name));
  }
  db.exec(readFileSync('cloudflare-worker/sql/migrations/434_contract_template_publications.sql', 'utf8'));
  if (governance) db.exec(readFileSync('cloudflare-worker/sql/migrations/202611062154_governance_documents.sql', 'utf8'));
  db.exec("INSERT INTO users(id,role,name,email,is_active) VALUES(1,'admin','Super','super@example.test',1),(2,'admin','Plain','admin@example.test',1); INSERT INTO super_admins(user_id) VALUES(1)");
  db.exec("INSERT INTO projects(id,name) VALUES(10,'Helvetia Capital')");
  db.exec(`INSERT INTO legal_templates(id,slug,title,category,body_md,version,is_active) VALUES
    (1,'initial_lpa','Initial Limited Partnership Agreement','gp','text',3,1),
    (2,'ar_lpa','Amended and Restated LPA','gp','',1,1),
    (3,'mutual_nda','Mutual NDA','nda','text',1,1)`);
  db.exec(`INSERT INTO legal_template_versions(template_id,slug,version,title,category,body_md) VALUES
    (1,'initial_lpa',1,'Initial Limited Partnership Agreement','gp','old'),(1,'initial_lpa',2,'Initial Limited Partnership Agreement','gp','older'),(1,'initial_lpa',3,'Initial Limited Partnership Agreement','gp','text')`);
  db.exec("INSERT INTO legal_template_publications(template_id,slug,version,title,category,body_md,published_at,published_by) VALUES(1,'initial_lpa',3,'Initial Limited Partnership Agreement','gp','text','2026-10-01',1)");
  db.prepare("INSERT INTO documents(uid,title,doc_type,status,template_name,project_id,created_at) VALUES('doc-lpa','Subscription Booklet & LPA','subscription','signed','initial_lpa',10,'2026-10-02T10:00:00Z')").run();
  db.prepare("INSERT INTO documents(uid,title,doc_type,status,template_name,project_id,created_at) VALUES('doc-other','Service Agreement','service','sent','service',10,'2026-10-03T10:00:00Z')").run();
  if (governance) {
    const g = db.prepare("INSERT INTO governance_documents(uid,entity_key,category,title,status,confidential) VALUES(?,?,?,?,?,?)");
    g.run('00000000-0000-4000-8000-0000000000a1', 'gp', 'operating_agreement', 'GP LLC Operating Agreement (LPA side letter)', 'approved', 0);
    g.run('00000000-0000-4000-8000-0000000000a2', 'holdings', 'member_register', 'Secret LPA register', 'approved', 1);
    const v = db.prepare("INSERT INTO governance_document_versions(document_uid,version,signed,r2_key,file_sha256,file_bytes,content_type) VALUES(?,?,0,'k',?,10,'application/pdf')");
    v.run('00000000-0000-4000-8000-0000000000a1', 1, 'a'.repeat(64)); v.run('00000000-0000-4000-8000-0000000000a1', 2, 'b'.repeat(64));
    v.run('00000000-0000-4000-8000-0000000000a2', 1, 'c'.repeat(64)); v.run('00000000-0000-4000-8000-0000000000a2', 2, 'd'.repeat(64));
  }
  return db;
}
const app = new Hono<any>();
app.route('/contracts', contracts);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function call(db: DatabaseSync, path: string, who = ADMIN, extraEnv = {}) {
  const jwt = await new SignJWT({ user_id: who, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/contracts${path}`, { headers: { Authorization: `Bearer ${jwt}` } }, { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extraEnv });
  return { status: res.status, body: await res.json() as any };
}

test('the rules: a usable query, an escaped pattern, and a score that prefers the title', () => {
  assert.equal(searchQuery('  LPA  '), 'LPA');
  assert.equal(searchQuery('a'), null, 'one character is not a search');
  assert.equal(searchQuery('x'.repeat(201)), null);
  assert.equal(likeOf('50%_\\'), '%50\\%\\_\\\\%', 'the query reaches SQL as data, never as a pattern');
  assert.equal(scoreOf('mutual nda', 'Mutual NDA'), 4);
  assert.equal(scoreOf('mutual', 'Mutual NDA'), 3);
  assert.equal(scoreOf('lpa', 'Amended and Restated LPA'), 2);
  assert.equal(scoreOf('lpa', 'Something', ['initial_lpa']), 1, 'a match outside the title ranks below any title match');
  assert.equal(scoreOf('zzz', 'Mutual NDA', ['nda']), 0);
  const base = { type: 'template' as const, title: 'Initial LPA', context: null, status: null, score: 3 };
  const ranked = rank([
    { ...base, key: 'old', version: 1, historical: true, updated_at: '2026-11-01' },
    { ...base, key: 'current', version: 3, historical: false, updated_at: '2026-01-01' },
  ]);
  assert.deepEqual(ranked.map((r) => r.key), ['current', 'old'], 'a current version ranks before a historical one even when the old one was touched later');
});

test('one list across the three stores, each result naming its type, context, status and version; current versions only by default', async () => {
  const db = fixture();
  const r = await call(db, '/search?q=LPA');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const types = r.body.items.map((x: any) => x.type);
  assert.ok(types.includes('template') && types.includes('agreement') && types.includes('governance'));
  const initial = r.body.items.find((x: any) => x.key === 'template:initial_lpa');
  assert.deepEqual([initial.version, initial.historical, initial.template.published_version, initial.context], [3, false, 3, 'gp']);
  const ar = r.body.items.find((x: any) => x.key === 'template:ar_lpa');
  assert.equal(ar.template.safety.incomplete, true, 'an empty template carries its overlay into the result');
  const booklet = r.body.items.find((x: any) => x.type === 'agreement');
  assert.deepEqual([booklet.title, booklet.status, booklet.context, booklet.version], ['Subscription Booklet & LPA', 'signed', 'Helvetia Capital', null]);
  const gov = r.body.items.find((x: any) => x.type === 'governance');
  assert.deepEqual([gov.context, gov.version, gov.governance.entity_key], ['Axal VC GP LLC', 2, 'gp']);
  assert.equal(r.body.items.some((x: any) => x.historical), false, 'no historical version in the default list');
  assert.equal(r.body.hidden_historical, 3, 'two older template versions and one older governance file are counted, not listed');
  assert.deepEqual(r.body.unreadable, []);
  assert.equal(r.body.items.some((x: any) => x.key === 'agreement:documents:doc-other'), false, 'a row that does not match is not listed');
});

test('historical=true adds the earlier versions, tagged, after the current ones', async () => {
  const r = await call(fixture(), '/search?q=initial&historical=true');
  const keys = r.body.items.map((x: any) => x.key);
  assert.deepEqual(keys.filter((k: string) => k.startsWith('template:initial_lpa')), ['template:initial_lpa', 'template:initial_lpa:v2', 'template:initial_lpa:v1']);
  const v1 = r.body.items.find((x: any) => x.key === 'template:initial_lpa:v1');
  assert.deepEqual([v1.historical, v1.status, v1.version], [true, 'superseded', 1]);
  assert.equal(r.body.hidden_historical, 0);
});

test('a confidential governance record is the Super Admin\'s alone: not listed and not counted for anyone else', async () => {
  const db = fixture();
  const admin = await call(db, '/search?q=secret', ADMIN);
  assert.deepEqual([admin.body.total, admin.body.hidden_historical], [0, 0]);
  assert.doesNotMatch(JSON.stringify(admin.body), /Secret LPA register/);
  const lpa = await call(db, '/search?q=LPA', ADMIN);
  assert.equal(lpa.body.counts.governance, 1, 'only the record this admin may open');
  const sup = await call(db, '/search?q=secret', SUPER);
  assert.equal(sup.body.items[0].title, 'Secret LPA register');
});

test('governance is HQ\'s; a store that cannot be read is named, never treated as no match; a bad query is refused', async () => {
  const branch = await call(fixture(), '/search?q=LPA', ADMIN, { BRANCH_CODE: 'north' });
  assert.equal(branch.body.governance_scope, 'branch');
  assert.equal(branch.body.counts.governance, 0);
  const broken = await call(fixture({ governance: false }), '/search?q=LPA');
  assert.deepEqual(broken.body.unreadable, ['governance']);
  assert.ok(broken.body.counts.template > 0, 'the other stores still answer');
  assert.equal((await call(fixture(), '/search?q=a')).status, 400);
  assert.equal((await call(fixture(), '/search')).status, 400);
});

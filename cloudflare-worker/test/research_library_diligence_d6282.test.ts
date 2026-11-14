/**
 * D6282: the Library keeps an investor's `diligence` kind and still has no
 * `benchmark` kind. Mounted route against the canonical Library migrations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { d1Over } from './_d1_sqlite.mjs';
import research from '../src/routes/research.ts';

const app = new Hono().route('/api/research', research);
app.onError((error, c) => c.json({ detail: error.message }, 500));
const SECRET = 'unit-research-secret-01234567890123456789';
const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = sql('schema_baseline.sql');
  db.exec(baseline.match(/CREATE TABLE users \([\s\S]*?;/)![0]);
  db.exec(baseline.match(/CREATE TABLE projects \([\s\S]*?;/)![0]);
  db.exec(baseline.match(/CREATE TABLE activity_logs \([\s\S]*?;/)![0]);
  db.exec(sql('migrations/213_research_library.sql'));
  db.exec(sql('migrations/221_research_ask_sessions.sql'));
  db.exec(sql('migrations/385_research_disposition_collections.sql'));
  db.exec("INSERT INTO users (id,email,name,role) VALUES (801,'investor@example.test','Investor','investor')");
  db.exec("INSERT INTO research_documents (id,uid,owner_user_id,title,r2_key,index_state) VALUES (1,'memo',801,'IC memo','r/memo','indexed')");
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}

async function patch(f: ReturnType<typeof fixture>, body: unknown) {
  const token = await new SignJWT({ user_id: 801, role: 'investor' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const response = await app.request('/api/research/documents/memo', {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, f.env);
  return { status: response.status, body: await response.json() as any };
}
const kindOf = (f: ReturnType<typeof fixture>) => (f.db.prepare("SELECT kind FROM research_documents WHERE uid='memo'").get() as any).kind;

test('D6282: an investor can file a document as diligence', async () => {
  const f = fixture();
  const saved = await patch(f, { kind: 'diligence' });
  assert.deepEqual([saved.status, saved.body.item.kind, kindOf(f)], [200, 'diligence', 'diligence']);
});

test('D6282: there is no benchmark kind, and an unknown kind is still refused', async () => {
  const f = fixture();
  for (const kind of ['benchmark', 'Diligence', 'unknown']) {
    assert.equal((await patch(f, { kind })).status, 400, kind);
  }
  assert.equal(kindOf(f), 'document');
});

test('D6282: the upload coerces a kind outside the set to document', () => {
  const route = readFileSync(new URL('../src/routes/research.ts', import.meta.url), 'utf8');
  const kinds = route.match(/const KINDS = new Set\(\[([^\]]*)\]\)/)![1].split(',').map((k) => k.trim().replace(/'/g, ''));
  assert.deepEqual(kinds, ['playbook', 'client', 'document', 'report', 'primary', 'legal', 'diligence']);
  assert.match(route, /const kind = typeof kindRaw === 'string' && KINDS\.has\(kindRaw\) \? kindRaw : 'document';/);
});

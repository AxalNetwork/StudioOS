import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import founderValidate from '../src/routes/founder_validate.ts';
import { serializePainMapCsv } from '../src/routes/_founder_validate_exports.ts';
import { getPainGroupsView } from '../src/services/painGroups.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const BASE = readFileSync(resolve('cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const KEY = ['fixture', 'key', 'for', 'd690', 'tests'].join('-');
const role: Record<number, string> = { 10: 'founder', 20: 'founder', 30: 'admin', 40: 'partner', 50: 'investor', 60: 'exploring' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities',
    'pain_groups', 'pain_group_aliases']) db.exec(tableFromBaseline(BASE, t));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?, ?)');
  for (const [id, type, founder] of [[10, 'founder', 1001], [20, 'founder', 1002], [30, 'admin', null],
    [40, 'partner', null], [50, 'investor', null], [60, 'exploring', 1001]] as const) {
    u.run(id, type, `User ${id}`, `user${id}@example.test`, founder, id === 60 ? 1 : 0);
  }
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Fixture Venture', 1001), (2, 'Other Venture', 1002)");
  const iv = db.prepare('INSERT INTO discovery_interviews (id, project_id, interviewee_name, quote_consent, pains_json, notes) VALUES (?, 1, ?, ?, ?, ?)');
  iv.run(1, 'Fixture Person One', 1, '["Consent pain"]', 'Note one');
  iv.run(2, 'Fixture Person Two', 0, '["Private pain two"]', 'Note two');
  iv.run(3, 'Fixture Person Three', null, '["Private pain three"]', 'Note three');
  iv.run(4, 'Fixture Person Four', null, '[]', 'Note four');
  return db;
}

async function call(db: DatabaseSync, who: number, path: string) {
  const app = new Hono<any>();
  app.route('/founder/validate', founderValidate);
  app.onError((error: Error, c) => c.json({ detail: error.message }, 500));
  const token = await new SignJWT({ user_id: who, role: role[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(KEY));
  const res = await app.request(`/founder/validate${path}`, { headers: { Authorization: `Bearer ${token}` } },
    { DB: d1Over(db), JWT_SECRET: KEY, ENVIRONMENT: 'development' } as any);
  return { status: res.status, body: await res.text() };
}

test('D690 both CSV exports refuse partners, investors and another venture while writers can export', async () => {
  const db = fixture();
  for (const path of ['/interviews/1/export.csv', '/pain-map/1/export.csv']) {
    for (const who of [10, 30, 60]) assert.equal((await call(db, who, path)).status, 200, `${who} ${path}`);
    for (const who of [20, 40, 50]) assert.equal((await call(db, who, path)).status, 403, `${who} ${path}`);
  }
});

test('D690 exported pains obey quote consent while every note remains', async () => {
  const db = fixture();
  const { status, body } = await call(db, 10, '/interviews/1/export.csv');
  assert.equal(status, 200);
  const lines = body.trim().split('\r\n').map((line) => line.split(','));
  const header = lines[0];
  const pains = header.indexOf('pains'), notes = header.indexOf('notes');
  assert.ok(pains >= 0 && notes >= 0);
  const byId = new Map(lines.slice(1).map((line) => [Number(line[0]), line]));
  assert.equal(byId.get(1)?.[pains], 'Consent pain');
  assert.equal(byId.get(2)?.[pains], 'Withheld (no consent to quote)');
  assert.equal(byId.get(3)?.[pains], 'Withheld (no consent to quote)');
  assert.equal(byId.get(4)?.[pains], '');
  assert.deepEqual([1, 2, 3, 4].map((id) => byId.get(id)?.[notes]), ['Note one', 'Note two', 'Note three', 'Note four']);
  assert.equal(body.includes('Private pain two'), false);
  assert.equal(body.includes('Private pain three'), false);
});

test('D690 pain-map export remains byte-for-byte its existing serializer for a writer', async () => {
  const db = fixture();
  const result = await call(db, 10, '/pain-map/1/export.csv');
  assert.equal(result.status, 200);
  const expected = serializePainMapCsv(await getPainGroupsView({ DB: d1Over(db) } as any, 1));
  assert.equal(result.body, expected);
});

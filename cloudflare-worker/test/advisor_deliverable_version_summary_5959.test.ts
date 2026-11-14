/**
 * #5959 (D5959) — a deliverable version's optional summary, stored apart from
 * its change note.
 *
 *   · given on create or on a new version, it comes back on the advisor's list
 *     and on the client's received list; not given, it is null, never '';
 *   · the change-note rule is unchanged (422 `empty_version`);
 *   · a row written before the migration reads null with its note untouched;
 *   · nothing changes it on a version that already exists.
 *
 * On the migrated schema, synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_deliverable_version_summary_5959.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import advisors from '../src/routes/advisors.ts';
import { ensureAdvisorStoresSchema } from '../src/services/advisorStoresSchema.ts';

const SECRET = 'test'.repeat(16);
test.after(() => removeMigratedDatabases());
const ADVISOR = 21;
const CLIENT = 22;

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active) VALUES (21,'Advisor One','a@example.test','advisor',1);
    INSERT INTO users(id,name,email,role,is_active) VALUES (22,'Client','c@example.test','founder',1);
    INSERT INTO advisors(id,uid,user_id,display_name,email,is_active) VALUES (201,'a-1',21,'Advisor One','a@example.test',1);
    UPDATE users SET advisor_id = 201 WHERE id = 21;
    INSERT INTO advisor_engagements(id, uid, advisor_id, founder_user_id, client_name, lane, shape, cycles, created_at, updated_at)
      VALUES (301, 'e-1', 201, 22, 'Client Co', 'signed', 'retainer', 1, '2026-01-01', '2026-01-01');
  `);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const ctx: any = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const app = new Hono<any>();
  app.route('/api/advisors', advisors);
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/advisors${path}`, {
      method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env, ctx);
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`); }
  };
  const create = async (extra: Record<string, unknown> = {}) => {
    const d = await call(ADVISOR, 'POST', '/me/deliverables', { title: 'Synthetic memo', engagement_id: 301, link_url: 'https://example.test/v1', summary: 'First draft', ...extra });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    return d.body;
  };
  const listedVersion = async (id: number) => {
    const list = (await call(ADVISOR, 'GET', '/me/deliverables')).body;
    return list.items.find((i: any) => i.id === id).latest_version;
  };
  const stored = (id: number, v: number) => db.prepare('SELECT * FROM advisor_deliverable_versions WHERE deliverable_id = ? AND version = ?').get(id, v) as any;
  return { db, call, create, listedVersion, stored };
}

// Mutation checked: versionDto dropping the field (fails); the INSERT binding summary into it (fails);
// '' stored for an absent field (fails).
test('a version created with a summary returns it on the advisor list and the client\'s received list; without one, null', async () => {
  const f = fixture();
  const d = await f.create({ version_summary: '  Two-tier pricing, annual prepay.  ' });
  assert.equal(f.stored(d.id, 1).version_summary, 'Two-tier pricing, annual prepay.', 'trimmed');
  assert.equal(f.stored(d.id, 1).summary, 'First draft', 'the change note is its own field');
  assert.equal((await f.listedVersion(d.id)).version_summary, 'Two-tier pricing, annual prepay.');

  const v2 = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, { summary: 'Fees revised', link_url: 'https://example.test/v2' });
  assert.equal(v2.status, 201, JSON.stringify(v2.body));
  assert.equal(v2.body.version_summary, null, 'not given: null, never an empty string');
  assert.equal(f.stored(d.id, 2).version_summary, null);
  assert.equal(v2.body.summary, 'Fees revised');

  const v3 = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, { summary: 'Final', link_url: 'https://example.test/v3', version_summary: 'Signed-off structure' });
  assert.equal(v3.body.version_summary, 'Signed-off structure');
  const blank = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, { summary: 'Typo fix', link_url: 'https://example.test/v4', version_summary: '   ' });
  assert.equal(blank.body.version_summary, null, 'whitespace is no summary');

  for (const v of [1, 3]) {
    const sent = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/${v}/send`);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
  }
  const received = (await f.call(CLIENT, 'GET', '/received/deliverables')).body;
  const item = received.items.find((i: any) => i.uid === d.uid);
  assert.deepEqual(item.versions.map((v: any) => [v.version, v.version_summary]), [[3, 'Signed-off structure'], [1, 'Two-tier pricing, annual prepay.']]);
});

test('the summary is capped at 2000 characters, as the change note is', async () => {
  const f = fixture();
  const d = await f.create({ version_summary: 'x'.repeat(2500) });
  assert.equal(f.stored(d.id, 1).version_summary.length, 2000);
});

// Mutation checked: the note check reading version_summary instead (fails).
test('the change-note rule is unchanged: a new version without its note or its document is refused 422 empty_version', async () => {
  const f = fixture();
  const d = await f.create();
  const noNote = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, { link_url: 'https://example.test/v2', version_summary: 'A summary is not a change note' });
  assert.equal(noNote.status, 422);
  assert.equal(noNote.body.code, 'empty_version');
  const noLink = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, { summary: 'Changed', version_summary: 'Summary' });
  assert.equal(noLink.status, 422);
  assert.equal(noLink.body.code, 'empty_version');
  assert.equal(f.stored(d.id, 2), undefined, 'nothing was written');
});

test('a row written before the migration reads back null, its note unchanged', async () => {
  const f = fixture();
  f.db.exec(`
    INSERT INTO advisor_deliverables(id, uid, advisor_id, engagement_id, client_name, title, created_at, updated_at)
      VALUES (901, 'd-old', 201, 301, 'Client Co', 'Older memo', '2026-01-02', '2026-01-02');
    INSERT INTO advisor_deliverable_versions(uid, deliverable_id, version, label, summary, link_url, created_at, updated_at)
      VALUES ('v-old', 901, 1, NULL, 'Original note', 'https://example.test/old', '2026-01-02', '2026-01-02');
  `);
  const v = await f.listedVersion(901);
  assert.equal(v.summary, 'Original note');
  assert.equal(v.version_summary, null);
  assert.ok('version_summary' in v, 'the field is there, null');
});

// Mutation checked: the trigger dropped from the migration (fails); PATCH writing the field (fails).
test('no route changes the summary on a version that exists, and the database refuses it too', async () => {
  const f = fixture();
  const d = await f.create({ version_summary: 'As sent' });
  const patched = await f.call(ADVISOR, 'PATCH', `/me/deliverables/${d.id}`, { title: 'Renamed', version_summary: 'Rewritten' });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/1/ready`, { version_summary: 'Rewritten' });
  await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/1/send`, { version_summary: 'Rewritten' });
  assert.equal(f.stored(d.id, 1).version_summary, 'As sent');
  assert.throws(
    () => f.db.prepare("UPDATE advisor_deliverable_versions SET version_summary = 'Rewritten' WHERE deliverable_id = ?").run(d.id),
    /version_summary_immutable/,
  );
  // Other columns still update: the send stamped its own.
  assert.ok(f.stored(d.id, 1).sent_at);
});

// Mutation checked: the bootstrap's column or trigger dropped (fails), and the migration's trigger dropped (fails).
test('a database that never ran the migration is healed with the same column and the same trigger', async () => {
  const sql = readFileSync(new URL('../sql/migrations/202611141017_5959_deliverable_version_summary.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE advisor_deliverable_versions ADD COLUMN version_summary TEXT;/);
  assert.match(sql, /CREATE TRIGGER IF NOT EXISTS advisor_deliverable_versions_summary_immutable\s+BEFORE UPDATE OF version_summary ON advisor_deliverable_versions\s+WHEN OLD\.version_summary IS NOT NEW\.version_summary/);

  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const m239 = readFileSync(new URL('../sql/migrations/239_advisor_deliverables.sql', import.meta.url), 'utf8');
  db.exec(m239.match(/CREATE TABLE IF NOT EXISTS advisor_deliverable_versions[\s\S]*?;/)![0]);
  await ensureAdvisorStoresSchema({ DB: d1Over(db) } as any);
  const cols = (db.prepare('PRAGMA table_info(advisor_deliverable_versions)').all() as any[]).map((r) => r.name);
  assert.ok(cols.includes('version_summary'));
  db.exec("INSERT INTO advisor_deliverable_versions(uid, deliverable_id, version, summary, version_summary) VALUES ('v-h', 1, 1, 'Note', 'Kept')");
  assert.throws(() => db.exec("UPDATE advisor_deliverable_versions SET version_summary = 'Changed' WHERE uid = 'v-h'"), /version_summary_immutable/);
});

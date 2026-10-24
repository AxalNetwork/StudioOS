/**
 * D905 (#2684) — notes on a venture's pitch deck, through the real mounted
 * routes on SQLite (migration 538 applied from its file).
 *
 *   1. An Admin and the Super Admin post; the founders read and answer; each
 *      note carries its version, card and author kind.
 *   2. An advisor member, an investor, an Explorer and another venture's founder
 *      read nothing and post nothing: not found, and nothing is written.
 *   3. The input is checked: an empty or long note, a card outside the version.
 *   4. One `raise.pitch-deck` activity row per note, never the note's words.
 *   5. The thread spans the deck's versions.
 *   6. A note never leaves through the deck's own read, a share or an export.
 *   7. Only the Super Admin on HQ sets the default template by sector and stage.
 *
 * Every principal and line is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_notes_d905.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import decks from '../src/routes/decks.ts';
import deckNotes, { NOTE_MAX } from '../src/routes/deck_notes.ts';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const MIGRATION = readFileSync(new URL('../sql/migrations/538_deck_notes.sql', import.meta.url), 'utf8');
const SECRET = 'synthetic-deck-notes-secret-d905'.repeat(2);
const SLIDES = [1, 2, 3].map((n) => ({ title: `Synthetic card ${n}`, method_id: 'yc_seed', spec_id: 'problem', fields: [] }));
const LINE = 'SYNTHETIC-NOTE the market figure on card 2 has no record';

// [id, role, founder_id]
const SUPER = 1, ADMIN = 21, OWNER = 2, COFOUNDER = 6, ADVISOR = 11, INVESTOR = 3, EXPLORER = 9, OTHER_FOUNDER = 10;
const principals = [[SUPER, 'admin', null], [ADMIN, 'admin', null], [OWNER, 'founder', 20], [COFOUNDER, 'founder', 60],
  [ADVISOR, 'advisor', null], [INVESTOR, 'investor', null], [EXPLORER, 'explorer', null], [OTHER_FOUNDER, 'founder', 30]] as const;

async function call(f: any, who: number | null, method: string, path: string, body?: unknown, env = f.env) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await f.app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const text = await res.text();
  let value: any; try { value = JSON.parse(text); } catch { value = text; }
  return { status: res.status, body: value };
}

async function fixture() {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec('PRAGMA foreign_keys=OFF; ALTER TABLE users ADD COLUMN founder_id INTEGER; ALTER TABLE activity_logs ADD COLUMN project_id INTEGER; ALTER TABLE activity_logs ADD COLUMN entity_type TEXT; ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;');
  for (const table of ['projects', 'pitch_decks']) f.db.exec(stripForeignKeys(tableFromBaseline(BASELINE, table)));
  f.db.exec(stripForeignKeys(MIGRATION));
  f.db.exec(`CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    INSERT OR IGNORE INTO super_admins(user_id) VALUES(${SUPER});
    INSERT INTO user_company_links VALUES(${OWNER},101),(${OTHER_FOUNDER},102);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'Synthetic venture',20,101),(2,'Synthetic other venture',30,102);`);
  for (const [id, role, founder] of principals) {
    f.db.prepare("INSERT OR IGNORE INTO users(id,email,name,role) VALUES(?,?,?,?)").run(id, `synthetic${id}@example.test`, `Synthetic ${id}`, role);
    f.db.prepare("UPDATE users SET name = ?, role = ?, founder_id = ?, subscription_tier = 'studio', is_active = 1 WHERE id = ?").run(`Synthetic ${id}`, role, founder, id);
  }
  const env: any = { DB: f.DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/decks', deckNotes).route('/api/decks', decks);
  // index.ts maps requireAuth's refusal to 401; the fixture does the same.
  app.onError((err: any, c: any) => c.json({ error: err?.message === 'Unauthorized' ? 'unauthorized' : 'error' }, err?.message === 'Unauthorized' ? 401 : 500));
  const out = { ...f, app, env };
  assert.equal((await call(out, OWNER, 'GET', '/api/decks/by-project/1')).status, 200, 'the deck tables exist');
  f.db.prepare('INSERT INTO pitch_decks(id,project_id,version,slides,title,is_current,created_by) VALUES(10,1,1,?,?,1,?),(11,2,1,?,?,1,?)')
    .run(JSON.stringify(SLIDES), 'Synthetic deck', OWNER, JSON.stringify(SLIDES), 'Synthetic other deck', OTHER_FOUNDER);
  await ensureProjectMembershipSchema(env);
  f.db.exec(`INSERT INTO project_members(project_id,user_id,role,status) VALUES(1,${OWNER},'owner','accepted'),(1,${COFOUNDER},'cofounder','accepted'),(1,${ADVISOR},'advisor','accepted')`);
  return out;
}
const notesIn = (f: any) => (f.db.prepare('SELECT * FROM deck_notes ORDER BY id').all() as any[]).map((r) => ({ ...r }));
const noteLogs = (f: any) => (f.db.prepare("SELECT project_id, user_id, entity_type, entity_id, action, details, actor FROM activity_logs WHERE action = 'deck_note_posted' ORDER BY id").all() as any[]).map((r) => ({ ...r }));

test('an Admin and the Super Admin post; the founders read and answer; each note carries its version, card and author', async () => {
  const f = await fixture();
  const a = await call(f, ADMIN, 'POST', '/api/decks/10/notes', { body: `  ${LINE}  `, card_index: 1 });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.deepEqual({ ...a.body.note, id: 0, created_at: '' }, {
    id: 0, deck_id: 10, deck_version: 1, card_index: 1, body: LINE, author: { name: `Synthetic ${ADMIN}`, kind: 'admin' }, created_at: '',
  });
  const s = await call(f, SUPER, 'POST', '/api/decks/10/notes', { body: 'Synthetic: the whole deck reads well.' });
  assert.deepEqual([s.status, s.body.note.author.kind, s.body.note.card_index], [201, 'super_admin', null]);
  const reply = await call(f, COFOUNDER, 'POST', '/api/decks/10/notes', { body: 'Synthetic: pulling the record this week.', card_index: 1 });
  assert.deepEqual([reply.status, reply.body.note.author.kind], [201, 'founder']);

  for (const who of [OWNER, COFOUNDER, ADMIN, SUPER]) {
    const read = await call(f, who, 'GET', '/api/decks/10/notes');
    assert.equal(read.status, 200, String(who));
    assert.deepEqual(read.body.notes.map((n: any) => [n.author.kind, n.card_index, n.deck_version]), [['admin', 1, 1], ['super_admin', null, 1], ['founder', 1, 1]]);
  }
  assert.equal((await call(f, OWNER, 'GET', '/api/decks/10/notes')).body.viewer, 'founder');
  assert.equal((await call(f, SUPER, 'GET', '/api/decks/10/notes')).body.viewer, 'super_admin');
  // On a branch nobody is the Super Admin: the same account posts as the branch's Admin.
  const onBranch = await call(f, SUPER, 'POST', '/api/decks/10/notes', { body: 'Synthetic branch note.' }, { ...f.env, BRANCH_CODE: 'lisbon' });
  assert.deepEqual([onBranch.status, onBranch.body.note.author.kind], [201, 'admin']);
  // A cofounder's post is a write by a non-owner: the authorization is recorded first.
  assert.equal(Number((f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'project_content_write_authorized' AND user_id = ?").get(COFOUNDER) as any).n), 1);
});

test('an advisor member, an investor, an Explorer and another venture\'s founder read nothing and post nothing', async () => {
  const f = await fixture();
  await call(f, ADMIN, 'POST', '/api/decks/10/notes', { body: LINE });
  for (const who of [ADVISOR, INVESTOR, EXPLORER, OTHER_FOUNDER]) {
    const read = await call(f, who, 'GET', '/api/decks/10/notes');
    assert.deepEqual([read.status, read.body.error], [404, 'deck_not_found'], String(who));
    assert.equal(JSON.stringify(read.body).includes('SYNTHETIC-NOTE'), false);
    const post = await call(f, who, 'POST', '/api/decks/10/notes', { body: 'Synthetic intrusion.' });
    assert.deepEqual([post.status, post.body.error], [404, 'deck_not_found'], String(who));
  }
  assert.equal((await call(f, null, 'GET', '/api/decks/10/notes')).status, 401);
  assert.equal(notesIn(f).length, 1, 'nothing was written');
  // D895 now refuses advisor deck reads too; merging notes must retain that boundary.
  assert.equal((await call(f, ADVISOR, 'GET', '/api/decks/10')).status, 403);
  // Another venture's deck is not this founder's to read.
  assert.equal((await call(f, OWNER, 'GET', '/api/decks/11/notes')).status, 404);
  assert.equal((await call(f, OWNER, 'GET', '/api/decks/999/notes')).status, 404);
});

test('the input is checked: an empty or long note, a card outside the version', async () => {
  const f = await fixture();
  const bad = async (body: unknown) => (await call(f, ADMIN, 'POST', '/api/decks/10/notes', body)).body.error;
  assert.equal(await bad({ body: '   ' }), 'note_required');
  assert.equal(await bad({}), 'note_required');
  assert.equal(await bad({ body: 'x'.repeat(NOTE_MAX + 1) }), 'note_too_long');
  for (const card_index of [3, -1, 1.5, 'one']) assert.equal(await bad({ body: 'Synthetic.', card_index }), 'invalid_card', String(card_index));
  assert.equal((await call(f, ADMIN, 'POST', '/api/decks/10/notes', { body: 'x'.repeat(NOTE_MAX), card_index: 2 })).status, 201, 'the limit itself is allowed');
  assert.equal(notesIn(f).length, 1);
});

test('one raise.pitch-deck activity row per note, naming the card and version, never the words', async () => {
  const f = await fixture();
  await call(f, ADMIN, 'POST', '/api/decks/10/notes', { body: LINE, card_index: 1 });
  await call(f, OWNER, 'POST', '/api/decks/10/notes', { body: 'SYNTHETIC-REPLY agreed.' });
  assert.deepEqual(noteLogs(f), [
    { project_id: 1, user_id: ADMIN, entity_type: 'raise.pitch-deck', entity_id: '10', action: 'deck_note_posted', details: 'Note posted on card 2, v1', actor: `user:${ADMIN}` },
    { project_id: 1, user_id: OWNER, entity_type: 'raise.pitch-deck', entity_id: '10', action: 'deck_note_posted', details: 'Note posted on the deck, v1', actor: `user:${OWNER}` },
  ]);
  const dump = JSON.stringify(f.db.prepare('SELECT * FROM activity_logs').all());
  assert.equal(dump.includes('SYNTHETIC-NOTE') || dump.includes('SYNTHETIC-REPLY'), false);
  // A refused post writes no row.
  await call(f, ADVISOR, 'POST', '/api/decks/10/notes', { body: LINE });
  await call(f, ADMIN, 'POST', '/api/decks/10/notes', { body: '' });
  assert.equal(noteLogs(f).length, 2);
});

test('the thread spans the deck\'s versions; a note keeps the version it was written on', async () => {
  const f = await fixture();
  await call(f, ADMIN, 'POST', '/api/decks/10/notes', { body: 'Synthetic note on v1.', card_index: 0 });
  f.db.exec('UPDATE pitch_decks SET is_current = 0 WHERE id = 10');
  f.db.prepare('INSERT INTO pitch_decks(id,project_id,version,slides,title,is_current,created_by) VALUES(12,1,2,?,?,1,?)').run(JSON.stringify(SLIDES.slice(0, 2)), 'Synthetic deck', OWNER);
  await call(f, OWNER, 'POST', '/api/decks/12/notes', { body: 'Synthetic answer on v2.', card_index: 1 });
  const read = await call(f, ADMIN, 'GET', '/api/decks/12/notes');
  assert.deepEqual(read.body.notes.map((n: any) => [n.deck_id, n.deck_version, n.card_index]), [[10, 1, 0], [12, 2, 1]]);
  assert.equal((await call(f, ADMIN, 'POST', '/api/decks/12/notes', { body: 'Synthetic.', card_index: 2 })).body.error, 'invalid_card', "v2 has two cards");
});

test("a note never leaves through the deck's own read, a share or an export: only routes/deck_notes.ts reads deck_notes", async () => {
  const f = await fixture();
  await call(f, ADMIN, 'POST', '/api/decks/10/notes', { body: LINE });
  const deck = await call(f, OWNER, 'GET', '/api/decks/10');
  assert.equal(deck.status, 200);
  assert.equal(JSON.stringify(deck.body).includes('SYNTHETIC-NOTE'), false);
  const versions = await call(f, OWNER, 'GET', '/api/decks/by-project/1');
  assert.equal(JSON.stringify(versions.body).includes('SYNTHETIC-NOTE'), false);
  const src = new URL('../src/', import.meta.url).pathname;
  const readers: string[] = [];
  const walk = (dir: string) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.isFile() && /\.ts$/.test(p) && /deck_notes/.test(readFileSync(p, 'utf8'))) readers.push(p.slice(src.length)); } };
  walk(src);
  assert.deepEqual(readers.sort(), ['index.ts', 'routes/deck_notes.ts'], 'index.ts only mounts it');
  assert.equal(/FROM\s+deck_notes|JOIN\s+deck_notes/i.test(readFileSync(join(src, 'index.ts'), 'utf8')), false);
});

test('only the Super Admin on HQ sets the default template by sector and stage; an Admin still reads it', async () => {
  const f = await fixture();
  const body = { sector: 'Synthetic sector', stage: 'Seed', method_id: 'yc_seed' };
  const plain = await call(f, ADMIN, 'PUT', '/api/decks/admin/recommend-overrides', body);
  assert.deepEqual([plain.status, plain.body.error], [403, 'super_admin_required']);
  const hq = await call(f, SUPER, 'PUT', '/api/decks/admin/recommend-overrides', body);
  assert.equal(hq.status, 200, JSON.stringify(hq.body));
  const branch = await call(f, SUPER, 'PUT', '/api/decks/admin/recommend-overrides', body, { ...f.env, BRANCH_CODE: 'lisbon' });
  assert.deepEqual([branch.status, branch.body.error], [403, 'super_admin_required'], 'no Super Admin on a branch');
  const del = await call(f, ADMIN, 'DELETE', '/api/decks/admin/recommend-overrides?sector=Synthetic%20sector&stage=Seed');
  assert.deepEqual([del.status, del.body.error], [403, 'super_admin_required']);
  const read = await call(f, ADMIN, 'GET', '/api/decks/admin/recommend-overrides');
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.overrides.map((o: any) => [o.sector, o.stage, o.method_id]), [['Synthetic sector', 'seed', 'yc_seed']]);
  assert.equal((await call(f, OWNER, 'PUT', '/api/decks/admin/recommend-overrides', body)).status, 403);
});

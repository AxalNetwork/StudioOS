/**
 * D312 — the fund dossier's pre-meeting brief, and what its Accept writes.
 *
 * The `research/funds` draft surface reads one fund row the caller owns and
 * nothing else; Accept appends the brief to that row's note, after the
 * founder's own words, and stamps `updated_at`. Run against real SQLite with
 * `research_funds` and `research_zone_drafts` cut from their migrations
 * (216 and 221), so the route's own SQL decides every row that comes back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

import research from '../src/routes/research.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const OWNER = 1;
const OTHER = 2;

/** The CREATE TABLE for `table`, cut from the migration numbered `prefix`. */
function tableFrom(prefix: string, table: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`)) as string;
  const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(start >= 0, `migration ${prefix} no longer declares ${table}`);
  return stripForeignKeys(sql.slice(start, sql.indexOf(');', start) + 2));
}

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
  );`);
  db.exec(tableFrom('216', 'research_funds'));
  db.exec(tableFrom('221', 'research_zone_drafts'));
  const u = db.prepare('INSERT INTO users (id, role, founder_id) VALUES (?, ?, ?)');
  u.run(OWNER, 'founder', 10);
  u.run(OTHER, 'founder', 20);
  const f = db.prepare(
    `INSERT INTO research_funds (uid, owner_user_id, name, thesis, note, status, cheque_min_cents, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'researching', ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  );
  f.run('f-mine', OWNER, 'Mine Capital', 'We lead seed rounds in tooling.', 'Met them at demo day.', 50_000_000);
  f.run('f-bare', OWNER, 'Bare Partners', null, null, null);
  f.run('f-theirs', OTHER, 'Theirs Ventures', 'A private thesis.', 'A private note.', null);
  return db;
}

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: any, userId: number, method: string, path: string, body?: any, onPrompt?: (p: string) => void) {
  const AI = {
    run: async (_model: string, payload: any) => {
      const messages = payload?.messages || [];
      onPrompt?.(String(messages[messages.length - 1]?.content ?? ''));
      return { response: 'Ask who will be in the room.' };
    },
  };
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(userId)}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await research.fetch(
    new Request(`http://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI } as any,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

const note = (db: any, uid: string) => (db.prepare('SELECT note, updated_at FROM research_funds WHERE uid = ?').get(uid) as any);

test('the dossier read carries updated_at for the Last updated tile', async () => {
  const db = freshDb();
  const r = await call(db, OWNER, 'GET', '/funds/f-mine');
  assert.equal(r.status, 200);
  assert.equal(r.body.updated_at, '2026-09-01T00:00:00.000Z');
});

test('a brief is drafted only over a fund the caller owns that holds something to brief from', async () => {
  const db = freshDb();
  for (const [who, uid] of [[OWNER, 'f-theirs'], [OWNER, 'f-bare'], [OWNER, ''], [OTHER, 'f-mine']] as const) {
    let reached = false;
    const r = await call(db, who, 'POST', '/drafts', { surface: 'research/funds', scope_key: uid }, () => { reached = true; });
    assert.equal(r.status, 409, `a brief was drafted over ${uid || 'no fund'} for user ${who}`);
    assert.equal(reached, false, 'the model was reached with nothing the caller may brief from');
  }
});

test('the brief is drafted from this row alone, with every gap marked for a question', async () => {
  const db = freshDb();
  let prompt = '';
  const r = await call(db, OWNER, 'POST', '/drafts', { surface: 'research/funds', scope_key: 'f-mine' }, (p) => { prompt = p; });
  assert.equal(r.status, 201);
  assert.match(prompt, /"We lead seed rounds in tooling\."/, 'the thesis is not quoted back');
  assert.match(prompt, /Met them at demo day\./);
  assert.match(prompt, /Cheque range: \$500,000 to not recorded/, 'a missing end must read as not recorded, never 0');
  assert.match(prompt, /Partner who will be in the room: not recorded/);
  assert.ok(!prompt.includes('A private'), 'another founder’s fund reached the model');
});

test('Accept appends the brief to the note, after the founder’s words, and stamps the row', async () => {
  const db = freshDb();
  const drafted = await call(db, OWNER, 'POST', '/drafts', { surface: 'research/funds', scope_key: 'f-mine' });
  const accepted = await call(db, OWNER, 'PATCH', `/drafts/${drafted.body.item.uid}`, {});
  assert.equal(accepted.status, 200);
  assert.ok(accepted.body.item.accepted_at || accepted.body.item.accepted, 'the draft was not stamped');
  const row = note(db, 'f-mine');
  assert.equal(row.note, 'Met them at demo day.\n\nPre-meeting brief:\nAsk who will be in the room.');
  assert.notEqual(row.updated_at, '2026-09-01T00:00:00.000Z', 'the Last updated tile would not move');

  // An edited brief is what gets written, not the drafted one.
  const again = await call(db, OWNER, 'POST', '/drafts', { surface: 'research/funds', scope_key: 'f-mine' });
  await call(db, OWNER, 'PATCH', `/drafts/${again.body.item.uid}`, { body: 'My own edit.' });
  assert.match(note(db, 'f-mine').note, /Pre-meeting brief:\nMy own edit\.$/);
});

test('a brief that would overflow the note is refused, and nothing is written or stamped', async () => {
  const db = freshDb();
  db.prepare('UPDATE research_funds SET note = ? WHERE uid = ?').run('x'.repeat(1990), 'f-mine');
  const drafted = await call(db, OWNER, 'POST', '/drafts', { surface: 'research/funds', scope_key: 'f-mine' });
  const refused = await call(db, OWNER, 'PATCH', `/drafts/${drafted.body.item.uid}`, {});
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'note_full');
  assert.match(refused.body.message, /over 2,000 characters/);
  assert.equal(note(db, 'f-mine').note, 'x'.repeat(1990), 'the note was changed by a refused accept');
  const d = db.prepare('SELECT accepted_at FROM research_zone_drafts WHERE uid = ?').get(drafted.body.item.uid) as any;
  assert.equal(d.accepted_at, null, 'a draft was stamped accepted over a note that was not written');
});

test('another founder cannot accept a brief into a note, and other surfaces accept as before', async () => {
  const db = freshDb();
  const drafted = await call(db, OWNER, 'POST', '/drafts', { surface: 'research/funds', scope_key: 'f-mine' });
  const theirs = await call(db, OTHER, 'PATCH', `/drafts/${drafted.body.item.uid}`, {});
  assert.equal(theirs.status, 404);
  assert.equal(note(db, 'f-mine').note, 'Met them at demo day.');

  // A surface with no accept hook still only stamps.
  db.prepare(`INSERT INTO research_zone_drafts (uid, owner_user_id, surface, scope_key, body) VALUES ('d-ask', ?, 'research/ask', NULL, 'a brief')`).run(OWNER);
  const plain = await call(db, OWNER, 'PATCH', '/drafts/d-ask', {});
  assert.equal(plain.status, 200);
  assert.equal(note(db, 'f-mine').note, 'Met them at demo day.');
});

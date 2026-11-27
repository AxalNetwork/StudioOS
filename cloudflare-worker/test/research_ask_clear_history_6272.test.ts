/**
 * D6272 (#6272) — Ask's Clear history hides; it never deletes.
 *
 * The owner's answer on #6274 (question 4, option B): clearing stamps
 * `cleared_at` on the caller's sessions, `scope=cleared` reads them back, and
 * Restore returns them. These drive the real routes over the real migrations.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_ask_clear_history_6272.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import research from '../src/routes/research.ts';
import { AI_LOG_SCHEMA, AI_BUDGET_MIGRATION } from './_ai_budget_fixture.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const app = new Hono().route('/api/research', research);
app.onError((error, c) => c.json({ detail: error.message }, 500));
const SECRET = 'unit-research-clear-history-6272-secret-0123456789';
const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');

const READER = 941;   // the investor clearing their own history
const OTHER = 942;    // another reader whose history must not move

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = sql('schema_baseline.sql');
  for (const t of ['users', 'projects', 'activity_logs']) {
    const at = baseline.indexOf(`CREATE TABLE ${t} (`);
    db.exec(baseline.slice(at, baseline.indexOf(';', at) + 1));
  }
  db.exec(sql('migrations/213_research_library.sql'));
  db.exec(sql('migrations/221_research_ask_sessions.sql'));
  db.exec(sql('migrations/385_research_disposition_collections.sql'));
  db.exec(sql('migrations/202611151315_6272_ask_history_cleared.sql'));
  db.exec(AI_LOG_SCHEMA + AI_BUDGET_MIGRATION);
  db.exec(`INSERT INTO users (id,email,name,role) VALUES
    (${READER},'reader@example.test','Reader','investor'),
    (${OTHER},'other@example.test','Other','investor')`);
  // Two sessions for the reader (one saved answer in the older), one for the other.
  db.exec(`INSERT INTO research_ask_sessions (id,uid,owner_user_id,created_at) VALUES
    (1,'s-old',${READER},'2026-11-01 09:00:00'),
    (2,'s-new',${READER},'2026-11-02 09:00:00'),
    (3,'s-other',${OTHER},'2026-11-02 09:00:00')`);
  const answer = (id: number, session: number, owner: number, saved = 0) =>
    `(${id},'a-${id}',${session},${owner},'Question fixture ${id}','Answer fixture ${id}','answered',0.9,0.5,'[]',${saved})`;
  db.exec(`INSERT INTO research_ask_answers
    (id,uid,session_id,owner_user_id,question,answer,reason,best_score,score_floor,citations,saved) VALUES
    ${[answer(1, 1, READER, 1), answer(2, 1, READER), answer(3, 2, READER), answer(4, 3, OTHER)].join(',')}`);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  return { db, env };
}

async function call(f: ReturnType<typeof fixture>, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: 'investor' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
  const response = await app.request(`/api/research${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  return { status: response.status, body: await response.json() as any };
}

const uids = (r: { body: any }) => (r.body.items || []).map((i: any) => i.uid).sort();

test('Clear history hides every session of the caller and deletes nothing', async () => {
  const f = fixture();
  const cleared = await call(f, READER, 'POST', '/ask/history/clear', {});
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.cleared, 2);
  // Nothing removed: every answer row is still there, the other reader's too.
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM research_ask_answers').get() as any).n, 4);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM research_ask_sessions').get() as any).n, 3);
  // All and This session are empty; their totals agree.
  const all = await call(f, READER, 'GET', '/ask/sessions?scope=all');
  assert.deepEqual(uids(all), []);
  assert.equal(all.body.totals.asked, 0);
  const session = await call(f, READER, 'GET', '/ask/sessions?scope=session');
  assert.equal(session.body.session, null, 'a cleared session is still the default thread');
  assert.deepEqual(uids(session), []);
  // Show cleared reads every hidden answer back, with whole-scope totals.
  const shown = await call(f, READER, 'GET', '/ask/sessions?scope=cleared');
  assert.deepEqual(uids(shown), ['a-1', 'a-2', 'a-3']);
  assert.equal(shown.body.totals.asked, 3);
  // Saved is the reader's own disposition and stays where it was.
  assert.deepEqual(uids(await call(f, READER, 'GET', '/ask/sessions?scope=saved')), ['a-1']);
  // A second press clears nothing more and says so.
  assert.equal((await call(f, READER, 'POST', '/ask/history/clear', {})).body.cleared, 0);
});

test('another reader’s history does not move', async () => {
  const f = fixture();
  await call(f, READER, 'POST', '/ask/history/clear', {});
  assert.deepEqual(uids(await call(f, OTHER, 'GET', '/ask/sessions?scope=all')), ['a-4']);
  assert.deepEqual(uids(await call(f, OTHER, 'GET', '/ask/sessions?scope=cleared')), []);
  const other = f.db.prepare('SELECT cleared_at FROM research_ask_sessions WHERE id = 3').get() as any;
  assert.equal(other.cleared_at, null);
  // And the other reader's Restore cannot reach the first reader's sessions.
  assert.equal((await call(f, OTHER, 'POST', '/ask/history/restore', {})).body.restored, 0);
  assert.deepEqual(uids(await call(f, READER, 'GET', '/ask/sessions?scope=all')), []);
});

test('the next question after a clear starts a fresh thread, not the hidden one', async () => {
  const f = fixture();
  await call(f, READER, 'POST', '/ask/history/clear', {});
  // A new session is open, and it is the default the page reads.
  const started = await call(f, READER, 'POST', '/ask/sessions', {});
  assert.equal(started.status, 201);
  const session = await call(f, READER, 'GET', '/ask/sessions?scope=session');
  assert.equal(session.body.session.uid, started.body.session.uid);
  assert.notEqual(session.body.session.uid, 's-new');
});

test('Restore brings every cleared session back into All', async () => {
  const f = fixture();
  await call(f, READER, 'POST', '/ask/history/clear', {});
  const restored = await call(f, READER, 'POST', '/ask/history/restore', {});
  assert.equal(restored.status, 200);
  assert.equal(restored.body.restored, 2);
  const all = await call(f, READER, 'GET', '/ask/sessions?scope=all');
  assert.deepEqual(uids(all), ['a-1', 'a-2', 'a-3']);
  assert.equal(all.body.totals.asked, 3);
  assert.deepEqual(uids(await call(f, READER, 'GET', '/ask/sessions?scope=cleared')), []);
  assert.equal((await call(f, READER, 'GET', '/ask/sessions?scope=session')).body.session.uid, 's-new');
});

test('All pages walk only the history that is not cleared', async () => {
  const f = fixture();
  // Clear, then ask into a fresh session: only that answer is in All, across pages.
  await call(f, READER, 'POST', '/ask/history/clear', {});
  f.db.exec(`INSERT INTO research_ask_sessions (id,uid,owner_user_id) VALUES (4,'s-fresh',${READER})`);
  f.db.exec(`INSERT INTO research_ask_answers (id,uid,session_id,owner_user_id,question,answer,reason,citations)
             VALUES (5,'a-5',4,${READER},'Question fixture 5','Answer fixture 5','answered','[]'),
                    (6,'a-6',4,${READER},'Question fixture 6','Answer fixture 6','answered','[]')`);
  const first = await call(f, READER, 'GET', '/ask/sessions?scope=all&limit=1');
  assert.deepEqual(uids(first), ['a-6']);
  assert.equal(first.body.has_more, true);
  const second = await call(f, READER, 'GET', `/ask/sessions?scope=all&limit=1&cursor=${encodeURIComponent(first.body.next_cursor)}`);
  assert.deepEqual(uids(second), ['a-5']);
  assert.equal(second.body.has_more, false, 'a cleared answer is reachable by paging All');
});

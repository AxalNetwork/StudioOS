/**
 * D1590 (#3837, deck v2 F11) — the recorded walkthrough.
 *
 *   1. Captions match the audio's timing within 0.5 s: the Listen job's
 *      segments become the take's cues, in milliseconds from the take's start.
 *   2. A retake of one card leaves every other card's takes intact; that
 *      card's earlier take goes, row and stored file.
 *   3. Delete removes the stored file, not only the row (owner decision W = A).
 *   4. The captions run is the Listen job's (WALKTHROUGH_CAPTIONS) through
 *      run(): one charged usage row on the rail option; a budget refusal stores
 *      nothing; a model that cannot be reached keeps the take, captions null.
 *   5. Attach to a link of this version; another member never reads the takes;
 *      the switch off answers "Not switched on yet"; a card outside the deck refuses.
 *   6. The daily sweep removes an object whose row left by a cascade, a day after upload, and keeps the rest.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_recordings_d1590.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckRecordings, { RECORD_OPTION } from '../src/routes/deck_recordings.ts';
import { KEY_PREFIX, ORPHAN_AGE_MS, sweepOrphanRecordings } from '../src/services/decks/recordings.ts';
import { WALKTHROUGH_CAPTIONS } from '../src/services/ai/speechJobs.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d1590-walkthrough-0123456';
const FOUNDER = 1; const OTHER = 2; const PID = 7; const DECK = 41;
const SLIDES = [{ title: 'Kestrel' }, { title: 'Problem' }, { title: 'Traction' }];

function fixture(balance = 5_000_000) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations)) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test'), (20, 'Founder B', 'fb@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES (${FOUNDER}, 'founder@example.test', 'Fay Founder', 'founder', 10), (${OTHER}, 'other@example.test', 'Oz Other', 'founder', 20);
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Kestrel Labs', 10);`);
  db.prepare('INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (?, ?), (?, ?)').run(FOUNDER, balance, OTHER, 5_000_000);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, 1, ?, ?, 1)').run(DECK, PID, 'Seed deck', JSON.stringify(SLIDES));
  return db;
}

function bucket() {
  const store = new Map<string, { bytes: Uint8Array; uploaded: Date }>();
  return {
    store,
    async put(k: string, v: Uint8Array) { store.set(k, { bytes: v, uploaded: new Date() }); },
    async get(k: string) { const v = store.get(k); return v ? { body: v.bytes, arrayBuffer: async () => v.bytes.buffer.slice(0) } : null; },
    async head(k: string) { const v = store.get(k); return v ? { size: v.bytes.byteLength } : null; },
    async delete(k: string) { store.delete(k); },
    async list({ prefix }: { prefix: string }) {
      return { objects: [...store].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, uploaded: v.uploaded, size: v.bytes.byteLength })), truncated: false };
    },
  };
}

// Whisper's segments, in seconds from the take's start.
const SEGMENTS = [
  { start: 0.32, end: 2.9, text: 'This is the problem we solve.' },
  { start: 3.4, end: 7.15, text: 'Freight teams reconcile by hand.' },
];

type Ai = 'ok' | 'down';
async function call(db: any, FILES: any, method: string, path: string, body?: any, { user = FOUNDER, ai = 'ok' as Ai } = {}) {
  const AI = withGuard({
    run: async () => {
      if (ai === 'down') throw new Error('model unreachable');
      return { text: SEGMENTS.map((s) => s.text).join(' '), transcription_info: { language: 'en' }, segments: SEGMENTS };
    },
  });
  const app = new Hono<any>().route('/api/decks', deckRecordings);
  const token = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let payload: any = body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await withThrownResponses(() => app.fetch(new Request(`http://t/api/decks${path}`, { method, headers, body: payload }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI, FILES } as any, { waitUntil() {}, passThroughOnException() {} } as any));
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

function take(card: number, over: Record<string, any> = {}) {
  const fd = new FormData();
  fd.append('card', String(card));
  fd.append('duration_ms', String(over.duration_ms ?? 8000));
  fd.append('media', new Blob([new Uint8Array(over.bytes ?? 96).fill(7)], { type: over.mediaType ?? 'video/webm' }), 'take.webm');
  fd.append('audio', new Blob([new Uint8Array(48).fill(3)], { type: 'audio/webm' }), 'take-audio.webm');
  return fd;
}
const rows = (db: any) => db.prepare('SELECT uid, card, take, media_r2_key FROM deck_recordings ORDER BY card, take').all() as any[];

// ── 1. Captions ───────────────────────────────────────────────────────────

test('1. captions match the audio\'s timing within 0.5 s', async () => {
  // Mutation checked: storing seconds as milliseconds (no ×1000) → every cue is off by seconds.
  const db = fixture(); const FILES = bucket();
  const r = await call(db, FILES, 'POST', `/${DECK}/recordings`, take(2));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const cues = r.body.take.captions;
  assert.equal(cues.length, SEGMENTS.length);
  SEGMENTS.forEach((s, i) => {
    assert.ok(Math.abs(cues[i].start_ms - s.start * 1000) <= 500, `cue ${i} starts at ${cues[i].start_ms}`);
    assert.ok(Math.abs(cues[i].end_ms - s.end * 1000) <= 500, `cue ${i} ends at ${cues[i].end_ms}`);
    assert.equal(cues[i].text, s.text);
  });
  assert.deepEqual([r.body.take.card, r.body.take.take], [2, 1]);
  assert.deepEqual(r.body.walkthrough.cards.map((t: any) => t && t.card), [null, 2, null]);
});

// ── 2. Retake ─────────────────────────────────────────────────────────────

test('2. a retake of one card leaves every other card\'s takes intact; that card\'s earlier take goes, row and file', async () => {
  // Mutation checked: supersede without `card = ?` → the retake of card 2 deletes cards 1 and 3.
  const db = fixture(); const FILES = bucket();
  for (const card of [1, 2, 3]) assert.equal((await call(db, FILES, 'POST', `/${DECK}/recordings`, take(card))).status, 201);
  const before = rows(db);
  const oldTwo = before.find((x) => x.card === 2);
  const retake = await call(db, FILES, 'POST', `/${DECK}/recordings`, take(2));
  assert.equal(retake.status, 201, JSON.stringify(retake.body));
  assert.equal(retake.body.take.take, 2, 'Slide 2 · Take 2');
  const after = rows(db);
  assert.deepEqual(after.map((x) => [x.card, x.take]), [[1, 1], [2, 2], [3, 1]]);
  for (const card of [1, 3]) {
    const was = before.find((x) => x.card === card); const now = after.find((x) => x.card === card);
    assert.deepEqual(now, was, `card ${card} is untouched`);
    assert.ok(FILES.store.has(now.media_r2_key), `card ${card}'s file is still stored`);
  }
  assert.equal(FILES.store.has(oldTwo.media_r2_key), false, 'the earlier take of card 2 left R2');
  assert.equal(FILES.store.size, 3);
});

// ── 3. Delete ─────────────────────────────────────────────────────────────

test('3. delete removes the stored file, not only the row', async () => {
  // Mutation checked: deleteTake skipping FILES.delete → the object is still in the bucket.
  const db = fixture(); const FILES = bucket();
  const r = await call(db, FILES, 'POST', `/${DECK}/recordings`, take(1));
  const [row] = rows(db);
  assert.ok(FILES.store.has(row.media_r2_key));
  const del = await call(db, FILES, 'DELETE', `/${DECK}/recordings/${r.body.take.uid}`);
  assert.deepEqual([del.status, del.body], [200, { deleted: true }]);
  assert.equal(FILES.store.has(row.media_r2_key), false, 'the file is gone');
  assert.equal(rows(db).length, 0, 'and the row');
  assert.equal((await call(db, FILES, 'GET', `/${DECK}/recordings/${r.body.take.uid}/media`)).status, 404);
  // A file that cannot be deleted keeps its row, so it is never lost track of.
  const again = await call(db, FILES, 'POST', `/${DECK}/recordings`, take(1));
  const failing = { ...FILES, async delete() { throw new Error('r2 down'); } };
  const stuck = await call(db, failing, 'DELETE', `/${DECK}/recordings/${again.body.take.uid}`);
  assert.equal(stuck.status, 503);
  assert.equal(rows(db).length, 1);
});

// ── 4. The captions run ───────────────────────────────────────────────────

test('4. the captions are the Listen job\'s run: one charged usage row on the rail option', async () => {
  const db = fixture(); const FILES = bucket();
  assert.equal(WALKTHROUGH_CAPTIONS, 'DK11C');
  const q = await call(db, FILES, 'POST', `/${DECK}/recordings/quote`, { duration_ms: 60_000 });
  assert.equal(q.status, 200, JSON.stringify(q.body));
  // Mutation checked: no speechJob on the run → the quote names no job.
  assert.equal(q.body.job, 'DK11', 'the Listen job chose the model');
  assert.ok(q.body.hold_microusd > 0);
  assert.deepEqual(q.body.balance, { ok: true });
  const r = await call(db, FILES, 'POST', `/${DECK}/recordings`, take(1));
  const usage = db.prepare("SELECT task, model, surface, rail_option, record_ref, charged_microusd FROM ai_usage_logs WHERE guard_for IS NULL AND task = 'transcribe'").all() as any[];
  assert.equal(usage.length, 1);
  assert.deepEqual([usage[0].surface, usage[0].rail_option, usage[0].record_ref], ['/raise/pitch', RECORD_OPTION, `deck:${DECK}`]);
  assert.match(usage[0].model, /whisper/);
  assert.equal(r.body.take.caption_model, usage[0].model);
});

test('4. a budget refusal stores nothing; a model that cannot be reached keeps the take with captions Not recorded', async () => {
  const broke = fixture(0); db_noplan(broke); const F1 = bucket();
  const refused = await call(broke, F1, 'POST', `/${DECK}/recordings`, take(1));
  assert.equal(refused.status, 402, JSON.stringify(refused.body));
  assert.equal(F1.store.size, 0); assert.equal(rows(broke).length, 0);
  const db = fixture(); const F2 = bucket();
  const down = await call(db, F2, 'POST', `/${DECK}/recordings`, take(1), { ai: 'down' });
  assert.equal(down.status, 201, JSON.stringify(down.body));
  assert.equal(down.body.take.captions, null, 'Not recorded, never an empty list');
  assert.equal(F2.store.size, 1);
});
function db_noplan(db: any) { db.prepare('DELETE FROM member_subscription_amounts').run(); }

// ── 5. Access, attach, the switch ─────────────────────────────────────────

test('5. attach to a live link of this version; another member never reads the takes; a card outside the deck refuses', async () => {
  // Mutation checked: attach without the deck check → another version's link attaches.
  const db = fixture(); const FILES = bucket();
  db.prepare("INSERT INTO pitch_deck_share_tokens (id, deck_id, token_hash, expires_at) VALUES (501, ?, 'h1', datetime('now', '+7 days')), (502, 99, 'h2', datetime('now', '+7 days'))").run(DECK);
  db.prepare("INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (99, ?, 2, 'Other', '[]', 0)").run(PID);
  assert.deepEqual([(await call(db, FILES, 'PUT', `/${DECK}/recordings/links/501`, { attach: true })).body?.error], ['nothing_recorded']);
  await call(db, FILES, 'POST', `/${DECK}/recordings`, take(1));
  const on = await call(db, FILES, 'PUT', `/${DECK}/recordings/links/501`, { attach: true });
  assert.deepEqual([on.status, on.body.links], [200, [501]]);
  assert.equal((await call(db, FILES, 'PUT', `/${DECK}/recordings/links/502`, { attach: true })).status, 404, 'another version\'s link');
  assert.deepEqual((await call(db, FILES, 'GET', `/${DECK}/recordings`)).body.links, [501]);
  assert.deepEqual((await call(db, FILES, 'PUT', `/${DECK}/recordings/links/501`, { attach: false })).body.links, []);
  assert.ok([403, 404].includes((await call(db, FILES, 'GET', `/${DECK}/recordings`, undefined, { user: OTHER })).status));
  assert.equal((await call(db, FILES, 'POST', `/${DECK}/recordings`, take(4))).status, 400, 'card 4 of 3');
});

test('5. the deck:walkthrough switch off answers "Not switched on yet"', async () => {
  const db = fixture(); const FILES = bucket();
  db.prepare("INSERT INTO feature_flags (key, scope, scope_id, enabled) VALUES ('deck:walkthrough', 'global', '', 0)").run();
  const r = await call(db, FILES, 'GET', `/${DECK}/recordings`);
  assert.deepEqual([r.status, r.body?.error], [404, 'not_switched_on']);
});

// ── 6. The sweep ──────────────────────────────────────────────────────────

test('6. the sweep removes an object whose row left by a cascade, a day after upload, and keeps the rest', async () => {
  // Mutation checked: no age check → the object uploaded a minute ago is swept.
  const db = fixture(); const FILES = bucket();
  await call(db, FILES, 'POST', `/${DECK}/recordings`, take(1));
  const [kept] = rows(db);
  const orphan = `${KEY_PREFIX}${PID}/00000000-0000-4000-8000-000000000001.webm`;
  const fresh = `${KEY_PREFIX}${PID}/00000000-0000-4000-8000-000000000002.webm`;
  FILES.store.set(orphan, { bytes: new Uint8Array(4), uploaded: new Date(Date.now() - ORPHAN_AGE_MS - 1000) });
  FILES.store.set(fresh, { bytes: new Uint8Array(4), uploaded: new Date() });
  // The kept take is old too, but its row is there.
  FILES.store.get(kept.media_r2_key)!.uploaded = new Date(Date.now() - ORPHAN_AGE_MS - 1000);
  const out = await sweepOrphanRecordings({ DB: d1Over(db), FILES } as any);
  assert.deepEqual([out.deleted, out.failed], [1, 0]);
  assert.equal(FILES.store.has(orphan), false);
  assert.ok(FILES.store.has(fresh), 'an upload whose row may still be on its way is left');
  assert.ok(FILES.store.has(kept.media_r2_key), 'a take with its row is kept');
});

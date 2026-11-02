/**
 * #3938 part 2 (D1478 task 4, owner answer G = b) — the data room's search index.
 *
 *   1. Passages are bounded and overlap.
 *   2. Indexing writes passages and vectors; a wrong-length vector refuses
 *      (`dimension_mismatch`) and writes nothing; a file with no text says so.
 *   3. Search keeps only hits D1 still holds and the reader may see (an
 *      investor never gets a file outside their listing), in the reranker's
 *      order; a stale vector is dropped; an unbound index is "not switched on".
 *   4. The routes: unbound answers available:false; an outsider gets 404.
 *   5. No embed selector on the index-backed page: the data room has no rail
 *      option, and `retrieve_index` is not selectable.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/data_room_search_3938.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import dataRoom from '../src/routes/data_room.ts';
import {
  DIMENSIONS, MAX_PASSAGES_PER_FILE, PASSAGE_CHARS, REASONS, forgetFile, indexFile, passagesOf, searchRoom, vectorId,
  type SearchDeps, type SearchIndex,
} from '../src/services/dataRoomSearch.ts';
import { USE_KINDS } from '../src/services/ai/modelUseCases.ts';
import { FOUNDER_OPTIONS } from '../../frontend/src/lib/railOptions/founder.js';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-3938-dataroom-0123456789';
const PID = 7;

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES (1, 'founder@example.test', 'Fay Founder', 'founder', 10), (2, 'inv@example.test', 'Ivy Investor', 'investor', NULL);
    INSERT INTO projects (id, uid, name, founder_id) VALUES (${PID}, 'proj-uid-7', 'Kestrel Labs', 10);`);
  const add = db.prepare('INSERT INTO data_room_files (id, uid, project_id, name, r2_key, content_type, size_bytes, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  add.run(1, 'file-open', PID, 'Pilot results.pdf', 'data-room/proj-uid-7/a', 'application/pdf', 100, 'open');
  add.run(2, 'file-nda', PID, 'Term sheet.pdf', 'data-room/proj-uid-7/b', 'application/pdf', 100, 'nda');
  return db;
}

const vec = (seed: number, n = DIMENSIONS) => Array.from({ length: n }, (_, i) => ((i * 7 + seed) % 13) / 13);

function memoryIndex() {
  const store = new Map<string, { values: number[]; metadata: Record<string, number> }>();
  const index: SearchIndex & { store: typeof store } = {
    store,
    async upsert(vs) { for (const v of vs) store.set(v.id, { values: v.values, metadata: v.metadata }); },
    async deleteByIds(ids) { for (const id of ids) store.delete(id); },
    async query(_v, opts) {
      return { matches: [...store.entries()].filter(([, x]) => x.metadata.project_id === opts.filter.project_id).map(([id], i) => ({ id, score: 1 - i / 100 })) };
    },
  };
  return index;
}

function deps(over: Partial<SearchDeps> = {}, texts: Record<number, string> = {}): SearchDeps & { index: ReturnType<typeof memoryIndex> } {
  return {
    index: memoryIndex(),
    extract: async (f) => texts[f.id] ?? null,
    embed: async (t) => vec(t.length),
    rerank: async (_q, contexts) => contexts.map((_, i) => i).reverse(),
    ...over,
  } as any;
}
const fileRow = (db: any, id: number) => db.prepare('SELECT id, uid, name, r2_key, content_type, size_bytes FROM data_room_files WHERE id = ?').get(id) as any;

// ── 1. Passages ──────────────────────────────────────────────────────────

test('1. passages are bounded, overlap, and an empty text has none', () => {
  assert.deepEqual(passagesOf(''), []);
  const text = Array.from({ length: 60 }, (_, i) => `Sentence ${i} about the pilot customers and their revenue.`).join(' ');
  const ps = passagesOf(text);
  assert.ok(ps.length > 1);
  assert.ok(ps.every((p) => p.length <= PASSAGE_CHARS), 'no passage is longer than the cap');
  assert.ok(ps[1].startsWith(ps[0].slice(-60).trim().split(' ').slice(-1)[0]) || ps[0].slice(-150).includes(ps[1].slice(0, 20)), 'consecutive passages overlap');
  assert.ok(passagesOf('x '.repeat(400_000)).length <= MAX_PASSAGES_PER_FILE);
});

// ── 2. Indexing ──────────────────────────────────────────────────────────

test('2. a file is indexed: one vector and one passage row per passage, with its venture and file in the metadata', async () => {
  const db = fixture();
  const d = deps({}, { 1: 'The pilot ran with three logistics customers. Revenue grew to $40k a month.' });
  const r = await indexFile({ DB: d1Over(db) } as any, d, PID, fileRow(db, 1));
  assert.deepEqual(r, { available: true, value: { passages: 1, status: 'indexed' } });
  assert.deepEqual([...d.index.store.keys()], [vectorId(1, 0)]);
  assert.deepEqual(d.index.store.get(vectorId(1, 0))!.metadata, { project_id: PID, file_id: 1 });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM data_room_passages WHERE file_id = 1').get() as any).n, 1);
  assert.equal((db.prepare('SELECT status FROM data_room_search_state WHERE file_id = 1').get() as any).status, 'indexed');
});

test('2. a vector of the wrong length refuses dimension_mismatch and writes nothing', async () => {
  // Mutation checked: drop the length check → the 768-long vector is upserted and this fails.
  const db = fixture();
  const d = deps({ embed: async () => vec(1, 768) }, { 1: 'Some text about the pilot.' });
  const r = await indexFile({ DB: d1Over(db) } as any, d, PID, fileRow(db, 1));
  assert.deepEqual(r, { available: false, reason: REASONS.dimension_mismatch, code: 'dimension_mismatch' });
  assert.equal(d.index.store.size, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM data_room_passages').get() as any).n, 0);
  const s = await searchRoom({ DB: d1Over(db) } as any, d, PID, 'pilot', null);
  assert.equal((s as any).code, 'dimension_mismatch', 'a search refuses the same way');
});

test('2. a file with no text is recorded as such, and re-indexing replaces its earlier passages', async () => {
  const db = fixture();
  const d = deps({}, { 1: 'First version of the pilot memo.' });
  const env = { DB: d1Over(db) } as any;
  await indexFile(env, d, PID, fileRow(db, 1));
  const none = await indexFile(env, deps({ index: d.index }, {}), PID, fileRow(db, 1));
  assert.deepEqual(none, { available: true, value: { passages: 0, status: 'no_text' } });
  assert.equal(d.index.store.size, 0, 'the earlier vectors are gone');
  await forgetFile(env, d, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM data_room_search_state').get() as any).n, 0);
});

// ── 3. Search ────────────────────────────────────────────────────────────

test('3. search keeps only what the reader may see, in the reranker\'s order; stale vectors are dropped', async () => {
  const db = fixture();
  const env = { DB: d1Over(db) } as any;
  const d = deps({}, { 1: 'Pilot results: three logistics customers renewed.', 2: 'Term sheet: $2M at a $10M pre-money valuation.' });
  await indexFile(env, d, PID, fileRow(db, 1));
  await indexFile(env, d, PID, fileRow(db, 2));
  d.index.store.set('drf:999:0', { values: vec(3), metadata: { project_id: PID, file_id: 999 } });

  const founder = await searchRoom(env, d, PID, 'valuation', null);
  assert.equal(founder.available, true);
  const fHits = (founder as any).value.hits;
  assert.deepEqual(fHits.map((h: any) => h.file_uid).sort(), ['file-nda', 'file-open'], 'the stale vector (no passage row) is dropped');
  assert.deepEqual(fHits.map((h: any) => h.score), [1, 2]);

  // Mutation checked: ignore `allowed` → the term sheet reaches the investor and this fails.
  const investor = await searchRoom(env, d, PID, 'valuation', new Set([1]));
  assert.deepEqual((investor as any).value.hits.map((h: any) => h.file_uid), ['file-open'], 'an NDA file outside the listing never reaches the investor');

  const reversed = await searchRoom(env, deps({ index: d.index, rerank: async (_q, c) => c.map((_, i) => i) }), PID, 'valuation', null);
  assert.notDeepEqual((reversed as any).value.hits.map((h: any) => h.file_uid), fHits.map((h: any) => h.file_uid), 'the reranker\'s order decides');
});

test('3. an unbound index answers "not switched on yet", and an empty query asks for one', async () => {
  const db = fixture();
  const env = { DB: d1Over(db) } as any;
  assert.deepEqual(await searchRoom(env, deps({ index: null }), PID, 'x', null), { available: false, reason: REASONS.not_set_up });
  assert.equal(((await searchRoom(env, deps(), PID, '   ', null)) as any).code, 'no_query');
});

// ── 4. Routes ────────────────────────────────────────────────────────────

async function call(db: any, method: string, path: string, user: { id: number; role: string }, body?: any) {
  const app = new Hono<any>().route('/api/data-room', dataRoom);
  const token = await new SignJWT({ user_id: user.id, role: user.role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t/api/data-room${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('4. with no index bound, the founder\'s search and index answer "not switched on yet"; an outsider gets 404', async () => {
  const db = fixture();
  const s = await call(db, 'POST', '/proj-uid-7/search', { id: 1, role: 'founder' }, { q: 'pilot' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual(s.body, { available: false, reason: REASONS.not_set_up });
  const i = await call(db, 'POST', '/proj-uid-7/search/index', { id: 1, role: 'founder' });
  assert.deepEqual(i.body, { available: false, reason: REASONS.not_set_up });
  const shared = await call(db, 'POST', '/shared/proj-uid-7/search', { id: 2, role: 'investor' }, { q: 'pilot' });
  assert.equal(shared.status, 404, 'an investor with no grant learns nothing, not even that the room exists');
});

// ── 5. No embed selector on an index-backed page ─────────────────────────

test('5. the data room offers no model to pick: no rail option, and retrieve_index is not selectable', () => {
  assert.deepEqual(FOUNDER_OPTIONS.filter((o: any) => o.page === 'Founder · Raise · Data room'), []);
  const ri = (USE_KINDS as any).retrieve_index;
  assert.equal(ri.selectable, false);
  assert.ok(ri.models.includes('@cf/qwen/qwen3-embedding-0.6b'));
  const src = readFileSync(resolve(here, '../src/services/dataRoomSearch.ts'), 'utf8');
  assert.match(src, /export const EMBED_MODEL = '@cf\/qwen\/qwen3-embedding-0\.6b';/);
  assert.match(src, /export const DIMENSIONS = 1024;/);
});

/**
 * D1539 (#3789, deck v2 B13) — a deck version as a list of card hashes.
 *
 *   1. Hash stability: the same card hashes the same whatever its key order;
 *      the hash is the SHA-256 of the canonical JSON.
 *   2. A 60-card deck's tenth version adds only its changed cards (blob rows
 *      counted), and `slides` is still written in full.
 *   3. Restore round-trips, from a hashed version and from a legacy one, and
 *      the reply is byte for byte what the version's own `slides` would give;
 *      the versions list keeps its reply shape, `proposal` included.
 *   4. Legacy versions (written before 730) still read; a hashed version reads
 *      from its blobs, and from `slides` when a blob is missing.
 *   5. Pruning never deletes a referenced blob, nor one inside its grace window;
 *      a stale save writes no blob.
 *   6. Renditions are not switched on: the seam answers 404 with switched_on false.
 *
 * In-memory SQLite: the baseline and every post-cutoff migration (730 included),
 * then 730 again through the runtime bootstrap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import decks, { ensureSchema, insertVersion, rowToDeck } from '../src/routes/decks.ts';
import { MODEL_VERSION } from '../src/services/decks/slideModel.ts';
import {
  canonicalJson, cardHash, cardBlobsOf, pruneCardBlobs, renditionKey, RENDITIONS_SWITCHED_ON, ensureCardBlobSchema,
} from '../src/services/decks/cardBlobs.ts';

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const NAMES = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations).filter((n) => migrationNumber(n) > BASELINE_CUTOFF);
const MIGRATIONS = NAMES.map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));
const SECRET = 'synthetic-deck-card-blobs-d1539-secret-'.repeat(2);
const FOUNDER = 1, OTHER = 2, P = 10, LEGACY = 100;

const cards = (n: number, tag = 'v1') => Array.from({ length: n }, (_, i) => ({ uid: `c${i + 1}`, title: `Card ${i + 1} ${tag}` }));

async function world() {
  assert.ok(NAMES.includes('730_pitch_card_blobs.sql'), 'migration 730 is a post-cutoff migration the fresh build applies');
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: true });
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(BASELINE);
  for (const m of MIGRATIONS) { try { db.exec(m); } catch { /* a view naming an object replayed later */ } }
  const legacySlides = JSON.stringify(cards(60));
  db.prepare(`INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, 'founder', ?, ?, ?, 1)`).run(FOUNDER, 'Synthetic founder', 'blobs1539@example.test', 1001);
  db.prepare(`INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, 'founder', ?, ?, ?, 1)`).run(OTHER, 'Other founder', 'other1539@example.test', 1002);
  db.prepare('INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)').run(P, 'Blob fixture', 1001);
  // A version saved before 730: no card hashes, its cards only in `slides`.
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (?, ?, 1, ?, ?, 1, ?)')
    .run(LEGACY, P, legacySlides, 'Legacy deck', FOUNDER);
  db.exec('PRAGMA foreign_keys = ON');
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  await ensureSchema(env);
  assert.equal(await ensureCardBlobSchema(env), true, '730 applied, then the runtime bootstrap on top, is a no-op that finds both objects');
  const app = new Hono<any>();
  app.route('/api/decks', decks);
  const tokenOf = (id: number) => new SignJWT({ user_id: id, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  async function call(method: string, path: string, { as = FOUNDER, body }: { as?: number; body?: unknown } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${await tokenOf(as)}` };
    const res = await withThrownResponses(() => app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env));
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, text, body: json };
  }
  const blobCount = () => Number((db.prepare('SELECT COUNT(*) AS n FROM pitch_card_blobs').get() as any).n);
  const current = () => db.prepare('SELECT * FROM pitch_decks WHERE project_id = ? AND is_current = 1').get(P) as any;
  async function save(slides: any[]) {
    const cur = current();
    const r = await call('PUT', `/api/decks/${cur.id}`, { body: { title: 'Blob deck', slides, model_version: MODEL_VERSION } });
    assert.equal(r.status, 200, r.text);
    return r.body;
  }
  return { db, env, call, save, blobCount, current };
}

test('hash stability: same card JSON gives the same hash in any key order; the hash is SHA-256 of canonical JSON', async () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: null }], c: 'x' } }), '{"a":{"c":"x","d":[2,{"y":null,"z":1}]},"b":1}');
  const a = await cardHash({ uid: 'c1', title: 'Problem', fields: [{ key: 'k', value: 'v' }] });
  const b = await cardHash({ fields: [{ value: 'v', key: 'k' }], title: 'Problem', uid: 'c1' });
  assert.equal(a.hash, b.hash, 'key order never changes a hash');
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.equal(a.hash, createHash('sha256').update('{"fields":[{"key":"k","value":"v"}],"title":"Problem","uid":"c1"}').digest('hex'));
  assert.equal(a.json, '{"uid":"c1","title":"Problem","fields":[{"key":"k","value":"v"}]}', 'the blob keeps the card as written');
  assert.notEqual((await cardHash({ uid: 'c1', title: 'Problem.' })).hash, (await cardHash({ uid: 'c1', title: 'Problem' })).hash);
  assert.equal((await cardHash({ uid: 'c1', title: 'Problem' })).hash, (await cardHash({ uid: 'c1', title: 'Problem' })).hash, 'stable across calls');
  const { hashes, blobs } = await cardBlobsOf([{ t: 1 }, { t: 2 }, { t: 1 }]);
  assert.equal(hashes.length, 3);
  assert.equal(hashes[0], hashes[2]);
  assert.equal(blobs.length, 2, 'a repeated card is one blob');
});

test('a 60-card deck\'s tenth version adds only its changed cards; slides is still written in full', async () => {
  const f = await world();
  let deck = cards(60);
  // Version 2: the first save after 730 stores all 60 cards once.
  await f.save(deck);
  assert.equal(f.blobCount(), 60);
  // Versions 3 to 9: one card changed each time, one blob row each.
  for (let v = 3; v <= 9; v++) {
    deck = deck.map((c, i) => (i === v ? { ...c, title: `Card ${i + 1} edit ${v}` } : c));
    const before = f.blobCount();
    await f.save(deck);
    assert.equal(f.blobCount() - before, 1, `version ${v} changed one card`);
  }
  assert.equal(f.current().version, 9);
  // The tenth version: two cards changed.
  deck = deck.map((c, i) => (i === 20 || i === 41 ? { ...c, title: `Card ${i + 1} tenth` } : c));
  const before = f.blobCount();
  const ninth = JSON.parse(f.current().card_hashes);
  await f.save(deck);
  const tenth = f.current();
  assert.equal(tenth.version, 10);
  assert.equal(f.blobCount() - before, 2, 'the tenth version added exactly its two changed cards');
  assert.equal(f.blobCount(), 60 + 7 + 2, '69 blob rows hold ten versions, not 600 cards');
  const hashes = JSON.parse(tenth.card_hashes);
  assert.equal(hashes.length, 60);
  assert.equal(hashes.filter((h: string, i: number) => h === ninth[i]).length, 58, 'the 58 unchanged cards keep their hashes');
  assert.equal(JSON.parse(tenth.slides).length, 60, 'pitch_decks.slides is still written in full during the transition');
  // Saving the same deck again adds no blob at all.
  await f.save(deck);
  assert.equal(f.blobCount(), 69);
});

test('restore round-trips from a hashed and a legacy version; the reply is byte for byte the slides read; the list keeps its shape', async () => {
  const f = await world();
  const v1 = await f.call('GET', `/api/decks/${LEGACY}`);
  assert.equal(v1.status, 200);
  const deck = cards(60).map((c, i) => (i < 3 ? { ...c, title: `${c.title} saved` } : c));
  const v2 = await f.save(deck);
  await f.save(deck.map((c, i) => (i === 59 ? { ...c, title: 'Moved on' } : c)));
  const blobs = f.blobCount();

  // From the hashed version 2.
  const r2 = await f.call('POST', `/api/decks/${v2.id}/restore`);
  assert.equal(r2.status, 200, r2.text);
  assert.equal(f.blobCount(), blobs, 'restoring stored cards adds no blob');
  assert.deepEqual(r2.body.slides, v2.slides, 'restore round-trips the hashed version');
  const row2 = f.db.prepare('SELECT * FROM pitch_decks WHERE id = ?').get(r2.body.id) as any;
  assert.equal(row2.card_hashes, (f.db.prepare('SELECT card_hashes FROM pitch_decks WHERE id = ?').get(v2.id) as any).card_hashes);
  const fromSlides = rowToDeck({ ...row2, card_hashes: null, created_by_name: 'Synthetic founder', round_name: null });
  assert.equal(r2.text, JSON.stringify(fromSlides), 'the restore reply is byte for byte what the version\'s own slides give');
  assert.ok(!('card_hashes' in r2.body), 'the reply shape is unchanged: no storage field leaks');

  // From the legacy version 1.
  const r1 = await f.call('POST', `/api/decks/${LEGACY}/restore`);
  assert.equal(r1.status, 200, r1.text);
  // A restore has always passed the cards through sanitizeSlides, which fills a
  // bare legacy card's empty fields; what the founder wrote is unchanged.
  assert.deepEqual(r1.body.slides.map((s: any) => [s.uid, s.title]), v1.body.slides.map((s: any) => [s.uid, s.title]), 'restore round-trips a version written before 730');
  const row1 = f.db.prepare('SELECT * FROM pitch_decks WHERE id = ?').get(r1.body.id) as any;
  assert.equal(JSON.parse(row1.card_hashes).length, 60, 'the restored legacy version is written as hashes');
  assert.equal(r1.text, JSON.stringify(rowToDeck({ ...row1, card_hashes: null, created_by_name: 'Synthetic founder', round_name: null })));
  const again = await f.call('POST', `/api/decks/${r1.body.id}/restore`);
  assert.deepEqual(again.body.slides, r1.body.slides, 'and restoring that copy round-trips exactly');

  // The versions list: the same keys as before 730, `proposal` included.
  const list = await f.call('GET', `/api/decks/by-project/${P}`);
  assert.equal(list.status, 200);
  assert.deepEqual(Object.keys(list.body), ['versions', 'shared_links_readable', 'proposal']);
  assert.equal(list.body.proposal, null);
  assert.deepEqual(Object.keys(list.body.versions[0]), [
    'id', 'project_id', 'version', 'title', 'is_current', 'created_at', 'audience', 'round', 'theme', 'content_hash', 'by', 'model_version', 'shared_links',
  ]);
  assert.deepEqual(list.body.versions.map((v: any) => v.version), [6, 5, 4, 3, 2, 1]);
});

test('a legacy version reads from slides; a hashed version reads from its blobs, and from slides when a blob is missing', async () => {
  const f = await world();
  const legacy = await f.call('GET', `/api/decks/${LEGACY}`);
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.slides.length, 60);
  assert.equal(legacy.body.slides[0].title, 'Card 1 v1');

  const saved = await f.save(cards(60, 'hashed'));
  // Blank the slides column: the read must come from the blobs.
  f.db.prepare("UPDATE pitch_decks SET slides = '[]' WHERE id = ?").run(saved.id);
  const fromBlobs = await f.call('GET', `/api/decks/${saved.id}`);
  assert.equal(fromBlobs.body.slides.length, 60, 'reassembled from the card hashes');
  assert.deepEqual(fromBlobs.body.slides, saved.slides);

  // A missing blob: the version reads from its own slides instead.
  f.db.prepare('UPDATE pitch_decks SET slides = ? WHERE id = ?').run(JSON.stringify(cards(60, 'column')), saved.id);
  const first = JSON.parse((f.db.prepare('SELECT card_hashes FROM pitch_decks WHERE id = ?').get(saved.id) as any).card_hashes)[0];
  f.db.prepare('DELETE FROM pitch_card_blobs WHERE hash = ?').run(first);
  const fallback = await f.call('GET', `/api/decks/${saved.id}`);
  assert.equal(fallback.status, 200);
  assert.equal(fallback.body.slides[0].title, 'Card 1 column', 'a hashed version with a missing blob falls back to slides');
});

test('pruning removes only old unreferenced blobs; a referenced blob and a young one are never deleted; a stale save writes no blob', async () => {
  const f = await world();
  await f.save(cards(60, 'a'));
  await f.save(cards(60, 'a').map((c, i) => (i === 0 ? { ...c, title: 'only in v3' } : c)));
  const orphanOld = 'a'.repeat(64), orphanYoung = 'b'.repeat(64);
  f.db.prepare("INSERT INTO pitch_card_blobs (hash, json, created_at) VALUES (?, '{}', '2000-01-01 00:00:00')").run(orphanOld);
  f.db.prepare("INSERT INTO pitch_card_blobs (hash, json) VALUES (?, '{}')").run(orphanYoung);
  // Age every blob, so only the reference rule protects them.
  f.db.prepare("UPDATE pitch_card_blobs SET created_at = '2000-01-01 00:00:00' WHERE hash <> ?").run(orphanYoung);
  const referenced = () => new Set((f.db.prepare('SELECT card_hashes FROM pitch_decks WHERE card_hashes IS NOT NULL').all() as any[]).flatMap((r) => JSON.parse(r.card_hashes)));
  const present = () => new Set((f.db.prepare('SELECT hash FROM pitch_card_blobs').all() as any[]).map((r) => r.hash));
  const before = present().size;
  const r = await pruneCardBlobs(f.env);
  assert.equal(r.deleted, 1, 'only the old orphan goes');
  assert.ok(!present().has(orphanOld));
  assert.ok(present().has(orphanYoung), 'a blob inside its grace window stays, referenced or not');
  assert.equal(present().size, before - 1);
  for (const h of referenced()) assert.ok(present().has(h), `referenced blob ${h.slice(0, 8)} survives`);
  // With no grace at all, the young orphan goes and every referenced blob still stays.
  assert.equal((await pruneCardBlobs(f.env, { minAgeMinutes: 0 })).deleted, 1);
  for (const h of referenced()) assert.ok(present().has(h));
  // Removing the version that alone named a card frees that card's blob.
  const v3 = f.current();
  const onlyV3 = JSON.parse(v3.card_hashes)[0];
  f.db.prepare('DELETE FROM pitch_decks WHERE id = ?').run(v3.id);
  assert.equal((await pruneCardBlobs(f.env, { minAgeMinutes: 0 })).deleted, 1);
  assert.ok(!present().has(onlyV3));
  for (const h of referenced()) assert.ok(present().has(h));
  // The limit bounds one run.
  for (let i = 0; i < 5; i++) f.db.prepare("INSERT INTO pitch_card_blobs (hash, json, created_at) VALUES (?, '{}', '2000-01-01')").run(String(i).repeat(64));
  assert.equal((await pruneCardBlobs(f.env, { limit: 3 })).deleted, 3);

  // A stale save: its version is refused, so it writes no blob either.
  const blobs = f.blobCount();
  await assert.rejects(
    insertVersion(f.env, P, cards(60, 'stale'), 'Stale', FOUNDER, {}, { id: LEGACY, version: 1 }),
    (e: any) => e instanceof Response && e.status === 409,
  );
  assert.equal(f.blobCount(), blobs, 'a refused save leaves no orphan blob');
});

test('renditions are not switched on: the seam answers 404 with switched_on false, and checks the size, the card and the reader', async () => {
  assert.equal(RENDITIONS_SWITCHED_ON, false);
  const h = 'c'.repeat(64);
  assert.equal(renditionKey(h, 256), `deck-cards/renditions/256/${h}.png`);
  assert.equal(renditionKey(h, 1024), `deck-cards/renditions/1024/${h}.png`);
  assert.throws(() => renditionKey('nope', 256 as any));
  const f = await world();
  const saved = await f.save(cards(3));
  const first = JSON.parse(f.current().card_hashes)[0];
  for (const size of ['256', '1024']) {
    const r = await f.call('GET', `/api/decks/${saved.id}/cards/${first}/rendition/${size}`);
    assert.equal(r.status, 404);
    assert.equal(r.body.code ?? r.body.error, 'rendition_not_available');
    assert.equal(r.body.switched_on, false);
  }
  assert.equal((await f.call('GET', `/api/decks/${saved.id}/cards/${first}/rendition/512`)).status, 400);
  assert.equal((await f.call('GET', `/api/decks/${saved.id}/cards/${'d'.repeat(64)}/rendition/256`)).body.error, 'not found');
  assert.equal((await f.call('GET', `/api/decks/${saved.id}/cards/${first}/rendition/256`, { as: OTHER })).status, 403);
});

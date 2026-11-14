/**
 * D1569 (#3816, deck v2 D8) — an AI voice-over per card, always labelled "AI voice".
 *
 *   1. The audio is stored in R2 and listed in the retention inventory: the
 *      run writes the clip under `deck-audio/<project>/<uid>.mp3` through the
 *      one writer, which checks storage room first (the R2 writer inventory),
 *      and DATA_RETENTION.md names `deck-audio/`. While proposed, the deck is
 *      unchanged and one `ai_rail_proposals` row holds the key.
 *   2. Quoted and held before the run: the quote names MeloTTS through DK10 and
 *      a hold; the run is one charged usage row on `deck:voice`; a balance that
 *      cannot cover the hold stores nothing and proposes nothing; a card with
 *      no script runs nothing.
 *   3. Accept writes one new version whose card carries
 *      `voice: { key, model, label: 'AI voice' }`; the voice read gives a link
 *      that plays the clip; a reader gets the label and model, never the key;
 *      a card naming another venture's clip gets no link.
 *   4. Discard deletes the clip, then the row; a decided voice-over is not decided twice.
 *   5. The player plays only a clip's own token: a share token, a forged one or
 *      an expired one plays nothing.
 *   6. The daily cleanup: a voice-over nobody decides is deleted after seven
 *      days and withdrawn; a younger one stays; an old clip no version or
 *      proposal names is deleted, one a version names stays.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_voice_d1569.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckVoice, { VOICE_JOB, VOICE_MODEL } from '../src/routes/deck_voice.ts';
import { mintSignedToken, publicDeckOf, sanitizeSlides, withVoiceLinks } from '../src/routes/decks.ts';
import { AUDIO_PREFIX, ORPHAN_AGE_MS, PENDING_DAYS, VOICE_OPTION, audioKey, sweepOrphanAudio, sweepPendingVoice } from '../src/services/decks/cardAudio.ts';
import { MELOTTS } from '../src/services/ai/speechJobs.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d1569-voice-over-012345678';
const FOUNDER = 1; const OTHER = 2; const PID = 7; const OTHER_PID = 8; const DECK = 41;
const SLIDES = [
  { uid: 'c-cover', title: 'Kestrel', notes: 'We make freight reconciliation automatic.' },
  { uid: 'c-problem', title: 'Problem' },
  { uid: 'c-traction', title: 'Traction', notes: 'Forty teams pay us today.' },
];
// An MP3 frame header, as MeloTTS answers.
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, ...new Array(200).fill(1)]);

function fixture(balance = 5_000_000) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations)) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test'), (20, 'Founder B', 'fb@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES (${FOUNDER}, 'founder@example.test', 'Fay Founder', 'founder', 10), (${OTHER}, 'other@example.test', 'Oz Other', 'founder', 20);
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Kestrel Labs', 10), (${OTHER_PID}, 'Other Co', 20);`);
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

type Ai = 'ok' | 'down';
async function call(db: any, FILES: any, method: string, path: string, body?: any, { user = FOUNDER, ai = 'ok' as Ai, seen = [] as any[] } = {}) {
  const AI = withGuard({
    run: async (model: string, input: any) => {
      seen.push({ model, input });
      if (ai === 'down') throw new Error('model unreachable');
      return { audio: Buffer.from(MP3).toString('base64') };
    },
  });
  const app = new Hono<any>().route('/api/decks', deckVoice);
  const headers: Record<string, string> = {};
  if (user) headers.Authorization = `Bearer ${await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  let payload: any = body;
  if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await withThrownResponses(() => app.fetch(new Request(`http://t/api/decks${path}`, { method, headers, body: payload }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI, FILES } as any, { waitUntil() {}, passThroughOnException() {} } as any));
  const type = res.headers.get('content-type') || '';
  if (type.startsWith('audio/')) return { status: res.status, type, bytes: new Uint8Array(await res.arrayBuffer()), body: null as any };
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, type, bytes: null as any, body: parsed };
}

const proposals = (db: any) => db.prepare('SELECT uid, status, rail_option, payload_json, created_at FROM ai_rail_proposals ORDER BY id').all() as any[];
const versions = (db: any) => db.prepare('SELECT id, version, is_current, slides FROM pitch_decks WHERE project_id = ? ORDER BY version').all(PID) as any[];
const current = (db: any) => versions(db).find((v) => v.is_current === 1);
const make = (db: any, FILES: any, card = 'c-cover', opts = {}) => call(db, FILES, 'POST', `/${DECK}/cards/${card}/voice`, {}, opts);

// ── 1. R2 and the retention inventory ─────────────────────────────────────

test('1. the audio is stored in R2, through the one guarded writer, and listed in the retention inventory', async () => {
  const db = fixture(); const FILES = bucket();
  const r = await make(db, FILES);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const keys = [...FILES.store.keys()];
  assert.equal(keys.length, 1, 'one clip');
  assert.match(keys[0], new RegExp(`^deck-audio/${PID}/[0-9a-f-]{36}\\.mp3$`));
  assert.deepEqual([...FILES.store.get(keys[0])!.bytes], [...MP3], 'the voice the model returned');
  const [p] = proposals(db);
  assert.deepEqual([p.status, p.rail_option], ['proposed', VOICE_OPTION]);
  const payload = JSON.parse(p.payload_json);
  assert.deepEqual([payload.key, payload.card_uid, payload.label, payload.model], [keys[0], 'c-cover', 'AI voice', MELOTTS]);
  assert.equal(versions(db).length, 1, 'nothing is saved on the deck without Accept');
  assert.equal(JSON.parse(current(db).slides)[0].voice, undefined);
  assert.equal(r.body.label, 'AI voice');
  assert.match(r.body.url, /^\/api\/decks\/voice\/[^/]+$/, 'the founder hears it before deciding');

  const writer = readFileSync(resolve(here, '../src/services/decks/cardAudio.ts'), 'utf8');
  const put = writer.indexOf('await env.FILES.put(key, a.bytes');
  const guard = writer.indexOf('assertStorageRoom(', writer.indexOf('export async function putCardAudio'));
  assert.ok(guard > 0 && guard < put, 'storage room is checked before the write');
  assert.match(readFileSync(resolve(here, 'storage_room_d1170.test.ts'), 'utf8'), /\['services\/decks\/cardAudio\.ts', 'export async function putCardAudio', 'await env\.FILES\.put\(key, a\.bytes'\]/, 'one row in the R2 writer inventory');
  const retention = readFileSync(resolve(here, '../../documentation/operations/DATA_RETENTION.md'), 'utf8');
  assert.match(retention, /\| per-card audio \(`deck-audio\/`, no table of its own\) \|[^\n]*AI voice[^\n]*`deck-audio\/<project>\/<uid>\.mp3`[^\n]*seven days/, 'listed in the retention inventory');
  assert.equal(AUDIO_PREFIX, 'deck-audio/');
});

// ── 2. Quote, hold, the model ─────────────────────────────────────────────

test('2. quoted and held first: MeloTTS through DK10, one charged row on deck:voice; a short balance or no script stores nothing', async () => {
  const db = fixture(); const FILES = bucket();
  const q = await call(db, FILES, 'POST', `/${DECK}/cards/c-cover/voice/quote`, {});
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.deepEqual([q.body.ai, q.body.model, q.body.job, q.body.label], [true, MELOTTS, VOICE_JOB, 'AI voice']);
  assert.ok(q.body.hold_microusd > 0, 'a hold before the run');
  assert.equal(q.body.chars, SLIDES[0].notes.length);
  assert.equal(VOICE_MODEL, MELOTTS);

  const seen: any[] = [];
  const r = await make(db, FILES, 'c-traction', { seen });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const spoke = seen.filter((s) => s.model === MELOTTS);
  assert.equal(spoke.length, 1);
  assert.equal(spoke[0].input.prompt, SLIDES[2].notes, 'the card\'s script is what is spoken');
  const usage = db.prepare('SELECT rail_option, model, charged_microusd FROM ai_usage_logs').all() as any[];
  const mine = usage.filter((u) => u.model === MELOTTS);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].rail_option, VOICE_OPTION);

  const poor = fixture(0); const empty = bucket();
  const refused = await make(poor, empty);
  assert.equal(refused.status, 402, JSON.stringify(refused.body));
  assert.equal(empty.store.size, 0, 'nothing stored');
  assert.equal(proposals(poor).length, 0, 'nothing proposed');

  const none = await make(db, FILES, 'c-problem');
  assert.equal(none.status, 422);
  assert.equal(none.body.error, 'no_script');
  const down = await make(fixture(), bucket(), 'c-cover', { ai: 'down' });
  assert.notEqual(down.status, 201, 'a voice that cannot be reached stores nothing');
  assert.equal((await call(db, FILES, 'POST', `/${DECK}/cards/c-cover/voice`, {}, { user: OTHER })).status, 403, 'another venture\'s founder runs nothing');
  assert.equal((await call(db, FILES, 'POST', `/${DECK}/cards/nope/voice`, {})).status, 404);
});

// ── 3. Accept ─────────────────────────────────────────────────────────────

test('3. Accept writes one version whose card carries the voice; Present gets a link; readers never get the key', async () => {
  const db = fixture(); const FILES = bucket();
  const r = await make(db, FILES);
  const key = [...FILES.store.keys()][0];
  const a = await call(db, FILES, 'POST', `/${DECK}/voice/${r.body.proposal.uid}/accept`, {});
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(versions(db).length, 2, 'one new version');
  const cards = JSON.parse(current(db).slides);
  assert.deepEqual(cards[0].voice, { key, model: MELOTTS, label: 'AI voice', chars: SLIDES[0].notes.length });
  assert.equal(cards[2].voice, undefined, 'only that card');
  assert.equal(proposals(db)[0].status, 'accepted');
  assert.equal((await call(db, FILES, 'POST', `/${DECK}/voice/${r.body.proposal.uid}/accept`, {})).status, 409, 'a decided voice-over is not accepted twice');

  const newId = current(db).id;
  const read = await call(db, FILES, 'GET', `/${newId}/voice`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.model, { id: MELOTTS, name: 'melotts', label: 'AI voice' });
  assert.equal(read.body.cards.length, 1);
  assert.equal(read.body.cards[0].card_uid, 'c-cover');
  const played = await call(db, FILES, 'GET', read.body.cards[0].url.replace('/api/decks', ''), undefined, { user: 0 as any });
  assert.equal(played.status, 200);
  assert.equal(played.type, 'audio/mpeg');
  assert.deepEqual([...played.bytes], [...MP3]);

  const pub = publicDeckOf(current(db));
  assert.deepEqual(pub.slides[0].voice, { label: 'AI voice', model: MELOTTS }, 'a reader gets the label and the model');
  assert.doesNotMatch(JSON.stringify(pub), /deck-audio\//, 'never the key');
  const env = { JWT_SECRET } as any;
  const shared = await withVoiceLinks(env, sanitizeSlides(cards), PID);
  assert.equal(shared[0].voice.label, 'AI voice');
  assert.match(shared[0].voice.url, /^\/api\/decks\/voice\//);
  assert.doesNotMatch(JSON.stringify(shared), /deck-audio\//);
  const foreign = sanitizeSlides([{ uid: 'x', title: 'X', voice: { key: audioKey(OTHER_PID, '00000000-0000-4000-8000-000000000000', 'mp3'), model: MELOTTS } }]);
  assert.ok(foreign[0].voice, 'the shape is sound');
  const out = await withVoiceLinks(env, foreign, PID);
  assert.equal(out[0].voice, undefined, 'another venture\'s clip gets no link');
  assert.equal(sanitizeSlides([{ title: 'Y', voice: { key: 'files/7/x.mp3', model: MELOTTS } }])[0].voice, undefined, 'a key outside deck-audio is not kept');
  assert.equal(sanitizeSlides([{ title: 'Z', voice: { key, model: MELOTTS, label: 'Your voice' } }])[0].voice.label, 'AI voice', 'always labelled AI voice');
});

// ── 4. Discard ────────────────────────────────────────────────────────────

test('4. Discard deletes the clip, then the row; a decided voice-over is not decided twice', async () => {
  const db = fixture(); const FILES = bucket();
  const r = await make(db, FILES);
  const d = await call(db, FILES, 'POST', `/${DECK}/voice/${r.body.proposal.uid}/discard`, {});
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(FILES.store.size, 0, 'the clip left R2');
  assert.equal(proposals(db)[0].status, 'discarded');
  assert.equal(versions(db).length, 1, 'the deck is unchanged');
  assert.equal((await call(db, FILES, 'POST', `/${DECK}/voice/${r.body.proposal.uid}/accept`, {})).status, 409);
  assert.equal((await call(db, FILES, 'POST', `/${DECK}/voice/${r.body.proposal.uid}/discard`, {}, { user: OTHER })).status, 403);
});

// ── 5. The player ─────────────────────────────────────────────────────────

test('5. the player plays only a clip\'s own token', async () => {
  const db = fixture(); const FILES = bucket();
  await make(db, FILES);
  const key = [...FILES.store.keys()][0];
  const env = { JWT_SECRET } as any;
  const play = (t: string) => call(db, FILES, 'GET', `/voice/${t}`, undefined, { user: 0 as any });
  assert.equal((await play(await mintSignedToken(env, key, 60, null))).status, 200);
  assert.equal((await play(await mintSignedToken(env, `deck:${DECK}:v1`, 60, null))).status, 404, 'a share token is not a clip');
  await FILES.put('deck-recordings/7/x.webm', MP3);
  assert.equal((await play(await mintSignedToken(env, 'deck-recordings/7/x.webm', 60, null))).status, 404, 'another store is not a clip, even when the object is there');
  const good = await mintSignedToken(env, key, 60, null);
  assert.equal((await play(`${good.slice(0, -2)}xx`)).status, 404, 'a forged signature plays nothing');
  // An hour-old link, signed as the Worker signs (the minter never makes one already past).
  const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
  const hmac = await crypto.subtle.importKey('raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = async (exp: number) => {
    const body = b64(new TextEncoder().encode(JSON.stringify({ k: key, exp })));
    return `${body}.${b64(new Uint8Array(await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(body))))}`;
  };
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await play(await signed(now + 3600))).status, 200, 'the hand-signed control plays, so the next 404 is the expiry');
  assert.equal((await play(await signed(now - 3600))).status, 404, 'an expired link plays nothing');
});

// ── 6. The daily cleanup ──────────────────────────────────────────────────

test('6. the daily cleanup: undecided after seven days goes; younger stays; an orphan goes; a named clip stays', async () => {
  const db = fixture(); const FILES = bucket();
  const old = await make(db, FILES);
  const young = await make(db, FILES, 'c-traction');
  const [oldKey, youngKey] = proposals(db).map((p) => JSON.parse(p.payload_json).key);
  db.prepare("UPDATE ai_rail_proposals SET created_at = datetime('now', ?) WHERE uid = ?").run(`-${PENDING_DAYS + 1} days`, old.body.proposal.uid);
  db.prepare("UPDATE ai_rail_proposals SET created_at = datetime('now', ?) WHERE uid = ?").run(`-${PENDING_DAYS - 1} days`, young.body.proposal.uid);
  const swept = await sweepPendingVoice({ DB: d1Over(db), FILES } as any);
  assert.deepEqual(swept, { deleted: 1, kept: 0 });
  assert.equal(FILES.store.has(oldKey), false);
  assert.equal(FILES.store.has(youngKey), true);
  assert.deepEqual(proposals(db).map((p) => p.status), ['withdrawn', 'proposed']);

  // Accept the young one, then age every object: the named clip stays, an unnamed one goes.
  assert.equal((await call(db, FILES, 'POST', `/${DECK}/voice/${young.body.proposal.uid}/accept`, {})).status, 200);
  const orphan = audioKey(PID, '11111111-1111-4111-8111-111111111111', 'mp3');
  await FILES.put(orphan, MP3);
  const fresh = audioKey(PID, '22222222-2222-4222-8222-222222222222', 'mp3');
  await FILES.put(fresh, MP3);
  for (const [k, v] of FILES.store) if (k !== fresh) v.uploaded = new Date(Date.now() - ORPHAN_AGE_MS - 1000);
  const o = await sweepOrphanAudio({ DB: d1Over(db), FILES } as any);
  assert.equal(o.deleted, 1);
  assert.equal(FILES.store.has(orphan), false, 'nothing names it');
  assert.equal(FILES.store.has(youngKey), true, 'a version names it');
  assert.equal(FILES.store.has(fresh), true, 'too new to be taken');
  const jobs = readFileSync(resolve(here, '../src/models/jobs.ts'), 'utf8');
  assert.match(jobs, /await sweepPendingVoice\(env\);\n\s+\/\/[^\n]*\n\s+await sweepOrphanAudio\(env\);/, 'both run in the daily cleanup');
});

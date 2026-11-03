/**
 * D1580 part 2b (#3827) — Rehearse's live words a minute: the live quote, the
 * socket's refusals, and the stream's settle.
 *
 *   1. The live quote names the member's pick for `transcribe:rehearsal-live`
 *      (Flux by default) and holds one block at the pitch deck's rate, which is
 *      not the interview's Deepgram opt-out rate.
 *   2. The socket: not an upgrade → 426; the deck:rehearsal switch off → 404; another member's deck → refused; a
 *      model the live job does not offer → 409, before any hold; a balance that
 *      cannot hold the first block → 402 with the budget's own code.
 *   3. The settle: the minutes and the guard over the streamed text against
 *      the holds, one usage row on the pitch deck's page naming the rail option
 *      and the deck; no live text is written anywhere.
 *   4. The relay is shared: the interview wrapper hands `relayLive` its own
 *      surface, and the rehearsal route its own.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_rehearsal_live_d1580.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckRehearsals, { LIVE_OPTION, REHEARSE_PAGE } from '../src/routes/deck_rehearsals.ts';
import { LIVE_DEFAULT, LIVE_REHEARSAL_SURFACE, liveText, settleRehearsalLive } from '../src/services/decks/rehearsalLive.ts';
import { LIVE_BLOCK_MINUTES, LIVE_SURFACE, blockHoldMicro, holdBlock, livePerMinute } from '../src/services/liveTranscription.ts';
import { __resetForTest, PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET } from '../src/services/aiRouter.ts';
import { usdToMicro } from '../src/services/aiBudget.ts';
import { FOUNDER_OPTIONS } from '../../frontend/src/lib/railOptions/founder.js';
import { d1Over } from './_d1_sqlite.mjs';
import { GUARD_MODEL } from './_guard_stub.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d1580-live-0123456789abc';
const FOUNDER = 1; const OTHER = 2; const PID = 7; const DECK = 41;
const FLUX = '@cf/deepgram/flux';
const NOVA = '@cf/deepgram/nova-3';

function fixture(balance = 5_000_000) {
  __resetForTest();
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations)) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test'), (20, 'Founder B', 'fb@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES (${FOUNDER}, 'founder@example.test', 'Fay Founder', 'founder', 10), (${OTHER}, 'other@example.test', 'Oz Other', 'founder', 20);
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Kestrel Labs', 10);`);
  db.prepare('INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (?, ?), (?, ?)').run(FOUNDER, balance, OTHER, 5_000_000);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, 1, ?, ?, 1)').run(DECK, PID, 'Seed deck', JSON.stringify([{ title: 'Kestrel' }]));
  return db;
}

const pick = (db: any, model: string) => db.prepare("INSERT INTO ai_rail_preferences (uid, user_id, section, task, model) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)").run(FOUNDER, REHEARSE_PAGE.trim().toLowerCase(), LIVE_OPTION, model);
const holds = (db: any) => (db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get() as any).n;

async function call(db: any, method: string, path: string, { user = FOUNDER, upgrade = false } = {}) {
  const AI = { run: async () => { throw new Error('no model runs before the socket opens'); } };
  const app = new Hono<any>().route('/api/decks', deckRehearsals);
  const token = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (upgrade) headers.Upgrade = 'websocket';
  const res = await withThrownResponses(() => app.fetch(new Request(`http://t/api/decks${path}`, { method, headers, body: method === 'POST' ? '{}' : undefined }),
    { JWT_SECRET, ENVIRONMENT: 'development', AI_PARTNER_MODELS: 'on', DB: d1Over(db), AI } as any, { waitUntil() {}, passThroughOnException() {} } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

// ── 1. The quote ──────────────────────────────────────────────────────────

test('1. the live quote: Flux by default, one block, at the pitch deck\'s rate', async () => {
  // Mutation checked: the quote using the interview surface's rate → hold_microusd is the opt-out block (twice the minutes).
  const db = fixture();
  const q = await call(db, 'POST', `/${DECK}/rehearsals/live/quote`);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.model, LIVE_DEFAULT);
  assert.equal(LIVE_DEFAULT, FLUX);
  assert.equal(q.body.block_minutes, LIVE_BLOCK_MINUTES);
  assert.equal(q.body.hold_microusd, blockHoldMicro(FLUX, 1, LIVE_REHEARSAL_SURFACE));
  assert.deepEqual(q.body.balance, { ok: true });
  assert.equal(holds(db), 0, 'a quote holds nothing');
  // The member's pick is the model.
  pick(db, NOVA);
  assert.equal((await call(db, 'POST', `/${DECK}/rehearsals/live/quote`)).body.model, NOVA);
});

test('1. a rehearsal is not interview audio: Nova-3 streams at its published rate here, at the opt-out rate in an interview', () => {
  assert.equal(LIVE_REHEARSAL_SURFACE, '/raise/pitch');
  assert.equal(livePerMinute(NOVA, LIVE_REHEARSAL_SURFACE), PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET[NOVA]);
  assert.ok(livePerMinute(NOVA, LIVE_SURFACE) > livePerMinute(NOVA, LIVE_REHEARSAL_SURFACE));
  assert.ok(blockHoldMicro(NOVA, 1, LIVE_REHEARSAL_SURFACE) < blockHoldMicro(NOVA));
});

// ── 2. The socket's refusals ─────────────────────────────────────────────

test('2. the socket: 426 unless an upgrade; another member\'s deck refused; an unoffered model 409 before any hold', async () => {
  // Mutation checked: liveModelOk not called on the socket → the unoffered model gets a hold (and a 502), not 409.
  const db = fixture();
  const plain = await call(db, 'GET', `/${DECK}/rehearsals/live`);
  assert.deepEqual([plain.status, plain.body?.error ?? plain.body?.code], [426, 'websocket_required'], JSON.stringify(plain.body));
  assert.ok([403, 404].includes((await call(db, 'GET', `/${DECK}/rehearsals/live`, { user: OTHER, upgrade: true })).status));
  assert.ok([403, 404].includes((await call(db, 'POST', `/${DECK}/rehearsals/live/quote`, { user: OTHER })).status));
  pick(db, '@cf/openai/whisper-large-v3-turbo');
  const off = await call(db, 'GET', `/${DECK}/rehearsals/live`, { upgrade: true });
  assert.equal(off.status, 409, JSON.stringify(off.body));
  assert.equal(off.body?.error ?? off.body?.code, 'model_not_offered');
  assert.equal(holds(db), 0, 'refused before any hold');
  assert.equal((await call(db, 'POST', `/${DECK}/rehearsals/live/quote`)).status, 409);
});

test('2. a balance that cannot hold the first block: 402 with the budget\'s code; the quote says so first', async () => {
  const db = fixture(0);
  db.prepare('DELETE FROM member_subscription_amounts').run();
  const q = await call(db, 'POST', `/${DECK}/rehearsals/live/quote`);
  assert.equal(q.status, 200);
  assert.equal(q.body.balance.ok, false);
  const s = await call(db, 'GET', `/${DECK}/rehearsals/live`, { upgrade: true });
  assert.equal(s.status, 402, JSON.stringify(s.body));
  assert.ok(s.body?.error ?? s.body?.code);
  assert.equal(typeof s.body?.message, 'string', 'the budget\'s own message');
});

test('2. the deck:rehearsal switch answers for the live words too (#4189)', async () => {
  // Mutation checked: the flag check removed from the socket → the switched-off socket reaches the hold (402), not 404.
  const db = fixture(0);
  db.prepare('DELETE FROM member_subscription_amounts').run();
  db.prepare("INSERT INTO feature_flags (key, scope, scope_id, enabled) VALUES ('deck:rehearsal', 'global', '', 0)").run();
  for (const [method, path, upgrade] of [['POST', `/${DECK}/rehearsals/live/quote`, false], ['GET', `/${DECK}/rehearsals/live`, true]] as const) {
    const r = await call(db, method, path, { upgrade });
    assert.deepEqual([r.status, r.body?.error ?? r.body?.code], [404, 'not_switched_on'], `${method} ${path}`);
  }
});

test('2. the read route\'s uid is a uid, so it never answers /live', () => {
  const route = readFileSync(resolve(here, '../src/routes/deck_rehearsals.ts'), 'utf8');
  assert.match(route, /deckRehearsals\.get\('\/:id\{\[0-9\]\+\}\/rehearsals\/:uid\{\[0-9a-f-\]\{36\}\}'/);
});

// ── 3. The settle ─────────────────────────────────────────────────────────

test('3. the settle: minutes and the guard against the holds, one row on the pitch deck naming the option and the deck', async () => {
  // Mutation checked: recordUsage without railOption → the row's rail_option is null.
  const db = fixture();
  const guardCalls: string[] = [];
  const env: any = { DB: d1Over(db), ENVIRONMENT: 'development', AI: { run: async (model: string, input: any) => {
    assert.equal(model, GUARD_MODEL);
    guardCalls.push(String(input?.messages?.at(-1)?.content ?? ''));
    return { response: 'safe', usage: { prompt_tokens: 200, completion_tokens: 2 } };
  } } };
  const h = await holdBlock(env, FOUNDER, NOVA, LIVE_REHEARSAL_SURFACE);
  assert.equal(h.ok, true);
  const said = liveText();
  said.add('Let me introduce the team.');
  said.add('  ');
  said.add('Our pilot customers love it.');
  assert.equal(said.text, 'Let me introduce the team.\nOur pilot customers love it.');
  const out = await settleRehearsalLive(env, { userId: FOUNDER, model: NOVA, railPage: REHEARSE_PAGE, deckId: DECK }, [(h as any).reservation], 90_000, said.text);
  assert.equal(out.minutes, 2);
  assert.equal(out.guard, 'passed');
  assert.equal(guardCalls.length, 1);
  assert.match(guardCalls[0], /pilot customers/);
  const rows = db.prepare('SELECT id, task, model, surface, rail_page, rail_option, record_ref, charged_microusd, guard_for, units_json FROM ai_usage_logs ORDER BY id').all() as any[];
  const [stream, ...guards] = rows;
  assert.deepEqual([stream.task, stream.model, stream.surface, stream.rail_option, stream.record_ref], ['transcribe', NOVA, '/raise/pitch', LIVE_OPTION, `deck:${DECK}`]);
  assert.equal(stream.rail_page, REHEARSE_PAGE);
  assert.deepEqual(JSON.parse(stream.units_json), { audio_minutes_websocket: 2 });
  assert.equal(stream.charged_microusd, usdToMicro(2 * PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET[NOVA]), 'the published rate, not the opt-out rate');
  assert.deepEqual(guards.map((g) => g.guard_for), [stream.id]);
  const [res] = db.prepare('SELECT status, actual_included_microusd + actual_topup_microusd AS charged FROM ai_budget_reservations').all() as any[];
  assert.equal(res.charged, out.cost_microusd);
  assert.equal(res.charged, stream.charged_microusd + guards[0].charged_microusd);
});

test('3. a stream with no text settles its minutes and calls no guard', async () => {
  const db = fixture();
  const env: any = { DB: d1Over(db), ENVIRONMENT: 'development', AI: { run: async () => { throw new Error('no guard for no text'); } } };
  const h = await holdBlock(env, FOUNDER, FLUX, LIVE_REHEARSAL_SURFACE);
  const out = await settleRehearsalLive(env, { userId: FOUNDER, model: FLUX, railPage: REHEARSE_PAGE, deckId: DECK }, [(h as any).reservation], 20_000, '');
  assert.deepEqual([out.minutes, out.guard], [1, 'passed']);
  assert.equal(out.cost_microusd, usdToMicro(PRICE_USD_PER_AUDIO_MINUTE_WEBSOCKET[FLUX]));
});

// ── 4. The shared relay ───────────────────────────────────────────────────

test('4. one relay: the interview and the rehearsal each hand relayLive their own surface; the next block is held at it', () => {
  // Mutation checked: the next block's holdBlock without owner.surface → this test fails.
  const live = readFileSync(resolve(here, '../src/services/liveTranscription.ts'), 'utf8');
  assert.match(live, /holdBlock\(env, userId, model, owner\.surface\)/);
  assert.match(live, /liveInputFor\(model, owner\.language, mipOptOut\(model, owner\.surface\)\)/);
  assert.match(live, /surface: LIVE_SURFACE, userId,/);
  const route = readFileSync(resolve(here, '../src/routes/deck_rehearsals.ts'), 'utf8');
  assert.match(route, /surface: LIVE_REHEARSAL_SURFACE, userId,/);
  assert.match(route, /holdBlock\(c\.env, userId, live\.model, LIVE_REHEARSAL_SURFACE\)/);
  const row = FOUNDER_OPTIONS.find((o: any) => o.key === LIVE_OPTION) as any;
  assert.deepEqual([row.kind, row.task, row.label], ['live', 'transcribe', 'Count words live']);
  assert.deepEqual(row.at, [['frontend/src/pages/raise/pitch/RehearsePanel.jsx', 'deckRehearsalsApi.liveUrl(']]);
});

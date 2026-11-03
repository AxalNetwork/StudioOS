/**
 * D1561 (#3808, deck v2 C13): Replace all images. One quote for every image
 * area of the deck, one hold, each area through #3756's pipeline with one
 * redraw, a refused image charged zero. Synthetic data, the mounted route and
 * the real migrated schema; `env.AI` is #3756's pipeline stand-in.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_replace_images_d1561.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckImages from '../src/routes/deck_images.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { replaceAreasOf, REPLACE_MAX_AREAS } from '../src/services/decks/deckActions.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { pipelineAI, type PipelineAnswers } from './_pipeline_ai.ts';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { contractErrors } from '../src/contracts/validate.ts';
import { readFileSync } from 'node:fs';
const QUOTE = JSON.parse(readFileSync(new URL('../src/contracts/deckReplaceImages.schema.json', import.meta.url), 'utf8'));

const JWT_SECRET = 'synthetic-d1561-images-only-not-a-real-credential'.repeat(2);
const ORIGIN = 'https://axal.vc';
const img = (id: string, grid: Record<string, number>, alt?: string) => ({ id, kind: 'image', grid, ...(alt ? { alt } : {}) });
const heading = (text: string) => ({ id: 'h', kind: 'text', style: 'heading', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, text });
/** Three image areas on two cards, and a words-only card. */
const SLIDES = [
  { uid: 'c-a', title: 'Solution', blocks: [heading('The close in one afternoon'), img('i1', { c1: 1, c2: 6, r1: 2, r2: 6 }, 'A tidy desk at month end'), img('i2', { c1: 7, c2: 12, r1: 2, r2: 3 })] },
  { uid: 'c-b', title: 'Team', blocks: [heading('Who builds it'), img('i3', { c1: 1, c2: 12, r1: 2, r2: 6 })] },
  { uid: 'c-c', title: 'Market', blocks: [heading('A large market')] },
];

test('replaceAreasOf: every image block, its area, the nearest aspect, and a description with no figure', () => {
  const areas = replaceAreasOf(SLIDES);
  assert.deepEqual(areas.map((a) => [a.card, a.block, a.card_uid]), [[0, 'i1', 'c-a'], [0, 'i2', 'c-a'], [1, 'i3', 'c-b']]);
  assert.equal(areas[0].description, 'A tidy desk at month end', 'the block\'s own alt text first');
  assert.equal(areas[1].description, 'An illustration for: The close in one afternoon', 'else the card\'s heading');
  assert.equal(areas[1].aspect, '16:9', 'a wide, short block draws wide');
  assert.ok(areas.every((a) => a.area), 'each block sits in an area of its card');
  const figures = replaceAreasOf([{ blocks: [heading('We grew 40% to $1.2M'), img('x', { c1: 1, c2: 4, r1: 2, r2: 6 })] }]);
  assert.doesNotMatch(figures[0].description, /\d|%|\$/, 'no figure reaches an image prompt');
  assert.equal(figures[0].aspect, '3:4', 'a tall block draws tall');
  const many = [{ blocks: Array.from({ length: 30 }, (_, i) => img(`m${i}`, { c1: 1, c2: 1, r1: 1, r2: 1 })) }];
  assert.equal(replaceAreasOf(many).length, REPLACE_MAX_AREAS);
  assert.deepEqual(replaceAreasOf('not slides'), []);
});

async function fixture(o: { slides?: unknown[]; answers?: PipelineAnswers; balance?: number } = {}) {
  __resetForTest();
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const add = db.prepare("INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, 'founder', ?, ?, ?, 1, 'studio')");
  add.run(2, 100, 'Synthetic founder', 'synthetic-2@example.invalid');
  add.run(3, 300, 'Other founder', 'synthetic-3@example.invalid');
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100), (2,'Other venture',300)");
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (7, 1, 3, ?, 1)').run(JSON.stringify(o.slides ?? SLIDES));
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2, ?)').run(o.balance ?? 5000000);
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,2)').run(key);
  const ai = pipelineAI(o.answers ?? {});
  const r2 = new Map<string, Uint8Array>();
  const FILES = { put: async (key: string, bytes: Uint8Array) => { r2.set(key, new Uint8Array(bytes)); }, get: async () => null };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI: withGuard({ run: ai.run }), FILES };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckImages);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const holds = () => db.prepare('SELECT uid, included_microusd + topup_microusd AS quote_microusd, status FROM ai_budget_reservations WHERE user_id = 2 ORDER BY rowid').all() as any[];
  const rows = () => db.prepare('SELECT state, card, card_uid FROM deck_images ORDER BY id').all() as any[];
  const balance = () => (db.prepare('SELECT balance_microusd AS n FROM ai_topup_accounts WHERE user_id = 2').get() as any).n as number;
  return { db, env, app, ai, r2, holds, rows, balance, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function post(f: F, path: string, who = 2, headers: Record<string, string> = {}) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(ORIGIN + path, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...headers }, body: '{}' }, f.env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('one quote for the whole deck: every image area priced, the hold covering one redraw each, nothing run', async () => {
  const f = await fixture();
  try {
    const q = await post(f, '/api/decks/7/images/replace-all/quote');
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.ai, true);
    assert.equal(q.body.count, 3, 'every image area of the deck');
    assert.deepEqual(contractErrors(QUOTE, q.body), [], 'the reply matches replaceImages\' contract');
    assert.notDeepEqual(contractErrors(QUOTE, { ...q.body, areas: [{ ...q.body.areas[0], aspect: '2:1' }] }), [], 'and the contract refuses what it must');
    assert.deepEqual(q.body.areas.map((a: any) => [a.card, a.block]), [[0, 'i1'], [0, 'i2'], [1, 'i3']]);
    const sum = q.body.areas.reduce((n: number, a: any) => n + a.per_image_microusd, 0);
    assert.ok(sum > 0);
    assert.equal(q.body.total_microusd, sum, 'one figure, summed over the areas');
    assert.equal(q.body.hold_microusd, sum * 2, 'the hold covers one redraw each');
    assert.deepEqual(q.body.balance, { ok: true });
    assert.equal(f.ai.calls.length, 0, 'a quote runs nothing');
    assert.equal(f.holds().length, 0, 'and holds nothing');
  } finally { f.close(); }
});

test('the press: one hold for every area, each drawn through the pipeline, proposals only, settled once', async () => {
  const f = await fixture();
  try {
    const before = f.balance();
    const r = await post(f, '/api/decks/7/images/replace-all');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.images.length, 3);
    assert.deepEqual(f.rows().map((x) => [x.state, x.card]), [['proposed', 0], ['proposed', 0], ['proposed', 1]], 'proposals, kept card by card');
    assert.equal(f.ai.draws().length, 3, 'one draw per area');
    const holds = f.holds();
    assert.equal(holds.length, 1, 'ONE hold for the whole deck');
    assert.equal(holds[0].quote_microusd, r.body.hold_microusd);
    assert.notEqual(holds[0].status, 'pending', 'the hold is settled');
    assert.ok(r.body.charged_microusd > 0 && r.body.charged_microusd <= r.body.hold_microusd);
    assert.equal(before - f.balance(), r.body.charged_microusd, 'the member paid what the images cost, not the hold');
    assert.equal(f.r2.size, 3);
  } finally { f.close(); }
});

test('a refused image is redrawn once, then left out at zero; the rest of the deck still draws', async () => {
  const f = await fixture({ answers: { text: 'YES' } });
  try {
    const before = f.balance();
    const r = await post(f, '/api/decks/7/images/replace-all');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.images.length, 0);
    assert.equal(r.body.refused.length, 6, 'each of the 3 areas: the first draw and its one redraw');
    assert.ok(r.body.refused.every((x: any) => x.charged_microusd === 0));
    assert.equal(f.ai.draws().length, 6, 'never more than one redraw');
    assert.equal(r.body.charged_microusd, 0);
    assert.equal(f.balance(), before, 'nothing paid for refused images');
    assert.equal(f.holds().length, 1);
  } finally { f.close(); }
});

test('an area whose words are refused is left out and named; a deck with no image area, a short balance and a stranger are refused', async () => {
  const f = await fixture({ slides: [SLIDES[0], { uid: 'c-x', blocks: [img('i9', { c1: 1, c2: 12, r1: 1, r2: 6 }, 'A pie chart of revenue by region')] }] });
  try {
    const q = await post(f, '/api/decks/7/images/replace-all/quote');
    assert.equal(q.body.count, 2);
    assert.deepEqual(q.body.left_out.map((x: any) => [x.card, x.block, x.code]), [[1, 'i9', 'not_illustrative']]);
    assert.deepEqual(contractErrors(QUOTE, q.body), [], 'a reply with an area left out matches too');
    assert.equal((await post(f, '/api/decks/7/images/replace-all/quote', 3)).status, 403, 'another venture\'s founder');
  } finally { f.close(); }
  const none = await fixture({ slides: [SLIDES[2]] });
  try {
    const r = await post(none, '/api/decks/7/images/replace-all');
    assert.deepEqual([r.status, r.body.error], [409, 'no_image_areas']);
    assert.equal(none.holds().length, 0);
  } finally { none.close(); }
  const poor = await fixture({ balance: 0 });
  try {
    poor.db.exec("UPDATE ai_licence_caps SET daily_microusd = 1, monthly_microusd = 1");
    const r = await post(poor, '/api/decks/7/images/replace-all');
    assert.equal(r.status, 402, JSON.stringify(r.body));
    assert.equal(poor.ai.draws().length, 0, 'nothing drawn past the balance');
    assert.equal(poor.holds().length, 0);
  } finally { poor.close(); }
});

test('the same Idempotency-Key twice: one hold, one set of draws', async () => {
  const f = await fixture();
  try {
    const key = { 'Idempotency-Key': 'synthetic-key-0001' };
    assert.equal((await post(f, '/api/decks/7/images/replace-all', 2, key)).status, 200);
    const again = await post(f, '/api/decks/7/images/replace-all', 2, key);
    assert.deepEqual([again.status, again.body.error], [409, 'already_pressed']);
    assert.equal(f.holds().length, 1);
    assert.equal(f.ai.draws().length, 3);
  } finally { f.close(); }
});

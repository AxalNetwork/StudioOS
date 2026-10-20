// D766 (#2094) PR 2 — the system calls that used to call env.AI.run directly
// now go through the router as system runs (userId 0): the monitoring summary,
// the X image screen and alt text (moved off llava-1.5-7b-hf to Llama 4
// Scout), and the axal-search embeddings. Each writes one usage row with
// user_id 0 and its page, and charges no member; a refused run falls back as
// the call did. Real SQLite (`_ai_budget_fixture.mjs`); env.AI is stubbed with
// the guard stub, so nothing calls Workers AI. Each case names the mutations
// it was checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/ai_system_calls_d766.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard, GUARD_MODEL } from './_guard_stub.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { ensureXSchema } from '../src/services/xSchema.ts';
import { embedText, upsertEntity } from '../src/services/vectorize.ts';
import { ROUTE, PRICE_USD_PER_1M_TOKENS, __resetForTest } from '../src/services/aiRouter.ts';
import { SEARCH_INDEX_MODEL } from '../src/services/ai/shapes.ts';
import monitoring from '../src/routes/monitoring.ts';
import x from '../src/routes/admin_x.ts';

// D780 part 2 (#2105): the alt-text caption is stored as a rail proposal, so the X route needs the table.
const PROPOSALS = readFileSync(new URL('../sql/migrations/506_ai_rail_proposals.sql', import.meta.url), 'utf8');
const SCOUT = '@cf/meta/llama-4-scout-17b-16e-instruct';
const SUPER = 1;
// A real 1x1 PNG: the upload route sniffs the magic bytes.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

function makeKV() {
  const store = new Map<string, string>();
  return { store, async get(k: string, t?: string) { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k: string, v: string) { store.set(k, String(v)); } };
}
function makeAI(handler: (model: string, payload: any) => any) {
  const calls: Array<{ model: string; payload: any }> = [];
  return { calls, async run(model: string, payload: any) { calls.push({ model, payload }); return handler(model, payload); } };
}

async function world(ai: any, extra: Record<string, unknown> = {}) {
  const f = aiBudgetFixture();
  f.db.exec(PROPOSALS);
  f.db.exec(`CREATE TABLE system_metrics(id INTEGER PRIMARY KEY, metric_name TEXT, labels TEXT, value REAL, timestamp TEXT);
             CREATE TABLE rate_limit_logs(id INTEGER PRIMARY KEY, blocked INTEGER, created_at TEXT);
             CREATE TABLE error_logs(id INTEGER PRIMARY KEY, user_id INTEGER, created_at TEXT);
             CREATE TABLE admin_audit_log(id INTEGER PRIMARY KEY, admin_id INTEGER, admin_email TEXT, action TEXT, filters TEXT, created_at TEXT DEFAULT (datetime('now')));`);
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const FILES = {
    async put(k: string, v: Uint8Array, o: any) { files.set(k, { bytes: v, contentType: o?.httpMetadata?.contentType }); },
    async get(k: string) { const o = files.get(k); return o ? { httpMetadata: { contentType: o.contentType }, async arrayBuffer() { return o.bytes.buffer; } } : null; },
  };
  const env: any = { DB: f.DB, AI: withGuard(ai), AI_SPEND: makeKV(), FILES, JWT_SECRET: 'd766-fixture-only-secret', ENVIRONMENT: 'development', ...extra };
  await ensureXSchema(env);
  f.db.prepare("INSERT INTO x_accounts(id,handle) VALUES(1,'axal')").run();
  f.db.prepare("INSERT INTO x_posts(id,account_id,body,created_by) VALUES(7,1,'A post',1)").run();
  return { f, env, files };
}
function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/monitoring', monitoring);
  a.route('/api/admin/x', x);
  return a;
}
async function call(w: any, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: SUPER }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  return { status: r.status, body: await r.json().catch(() => null) };
}
/** The router's rows (Llama Guard's own rows aside). */
const rows = (w: any) => w.f.db.prepare('SELECT user_id, task, model, surface, charged_microusd, reservation_uid FROM ai_usage_logs WHERE guard_for IS NULL ORDER BY id').all().map((r: any) => ({ ...r }));
const reply = (text: string) => ({ response: text, usage: { prompt_tokens: 40, completion_tokens: 3 } });
const dataUri = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`;

test.afterEach(() => __resetForTest());

// 1 ───────────────────────────────────────────────────────────────────────────
test('monitoring: the summary runs as ops_summary, one row for user 0 on /monitoring, no hold', async () => {
  // Mutations checked: userId 1 passed; the surface dropped; the output ignored.
  const ai = makeAI(() => reply('System nominal; 0 anomalies.'));
  const w = await world(ai);
  // D765 (#2090): the GET the page polls is heuristic; the summary is the admin's press, POST.
  const read = await call(w, 'GET', '/api/monitoring/anomalies');
  assert.equal(read.body.ai_summary, 'System nominal. No anomalies detected in the last hour.');
  assert.equal(ai.calls.length, 0, 'the GET runs no model');
  const r = await call(w, 'POST', '/api/monitoring/anomalies');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ai_summary, 'System nominal; 0 anomalies.');
  assert.deepEqual(ai.calls.map((c) => c.model), [ROUTE.ops_summary.model]);
  assert.equal(ai.calls[0].payload.max_tokens, 250);
  assert.deepEqual(rows(w), [{ user_id: 0, task: 'ops_summary', model: ROUTE.ops_summary.model, surface: '/monitoring', charged_microusd: 0, reservation_uid: null }]);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('monitoring: a refused or failed run falls back to the heuristic text', async () => {
  // Mutation checked: a refused run's empty output kept as the summary.
  const ai = makeAI(() => { throw new Error('5007: model unavailable'); });
  const w = await world(ai);
  const r = await call(w, 'POST', '/api/monitoring/anomalies');
  assert.equal(r.body.ai_summary, 'System nominal. No anomalies detected in the last hour.');
  const killed = await world(makeAI(() => reply('x')));
  const now = new Date();
  await killed.env.AI_SPEND.put(`ai_killswitch:org:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`, '1');
  const k = await call(killed, 'POST', '/api/monitoring/anomalies');
  assert.equal(k.status, 200);
  assert.equal(k.body.ai_summary, 'System nominal. No anomalies detected in the last hour.', 'the org kill switch refuses a system run too');
  assert.deepEqual(rows(killed).map((x: any) => x.user_id), [0]);
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('X upload: the screen runs on Llama 4 Scout with the image as a content part; YES blocks it', async () => {
  // Mutations checked: the image left out; a YES let through; the old llava model kept.
  const ai = makeAI(() => reply('YES'));
  const w = await world(ai);
  const r = await call(w, 'POST', '/api/admin/x/posts/7/media', { data_uri: dataUri });
  assert.equal(r.status, 422);
  assert.equal(r.body.error, 'nsfw_blocked');
  assert.equal(ai.calls[0].model, SCOUT);
  const parts = ai.calls[0].payload.messages.at(-1).content;
  assert.deepEqual(parts[1], { type: 'image_url', image_url: { url: dataUri } });
  assert.equal(ai.calls[0].payload.max_tokens, 8);
  assert.deepEqual(rows(w).map((x: any) => [x.user_id, x.task, x.model, x.surface]), [[0, 'image_screen', SCOUT, '/admin/x']]);
  assert.equal(w.files.size, 0, 'nothing stored');
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('X upload: NO stores it; a failed screen passes through, as before; an image too large to screen is refused', async () => {
  // Mutations checked: the too-large refusal dropped (an unscreened image stored).
  const ok = await world(makeAI(() => reply('NO')));
  assert.equal((await call(ok, 'POST', '/api/admin/x/posts/7/media', { data_uri: dataUri })).status, 200);
  assert.equal(ok.files.size, 1);
  const down = await world(makeAI(() => { throw new Error('3040: capacity'); }));
  assert.equal((await call(down, 'POST', '/api/admin/x/posts/7/media', { data_uri: dataUri })).status, 200, 'a flaky model cannot lock admins out');
  // 4.5 MB: within X's 5 MB, over the router's 4 MB vision limit.
  const big = new Uint8Array(4.5 * 1024 * 1024); big.set(PNG.subarray(0, 16));
  const ai = makeAI(() => reply('NO'));
  const w = await world(ai);
  const r = await call(w, 'POST', '/api/admin/x/posts/7/media', { data_uri: `data:image/png;base64,${Buffer.from(big).toString('base64')}` });
  assert.equal(r.status, 413);
  assert.equal(r.body.error, 'too_large_to_screen');
  assert.equal(ai.calls.length, 0);
  assert.equal(w.files.size, 0);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('X alt text: image_alt_text on Scout, the stored image as a data URI, one row for user 0', async () => {
  // Mutations checked: the stored content type ignored; a refused run saved as an empty caption.
  const ai = makeAI(() => reply('A team at a whiteboard.'));
  const w = await world(ai);
  w.files.set('x/1/7/a.png', { bytes: PNG, contentType: 'image/png' });
  w.f.db.prepare("UPDATE x_posts SET media_r2_keys = '[\"x/1/7/a.png\"]' WHERE id = 7").run();
  const r = await call(w, 'POST', '/api/admin/x/posts/7/alt-text', { index: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.body.alt_text, 'A team at a whiteboard.');
  assert.equal(ai.calls[0].model, SCOUT);
  assert.equal(ai.calls[0].payload.messages.at(-1).content[1].image_url.url, dataUri);
  assert.deepEqual(rows(w).map((x: any) => [x.user_id, x.task, x.surface]), [[0, 'image_alt_text', '/admin/x']]);
  // D780: the caption is the Super Admin's to keep, not the post's (rail_x_alt_text_d780.test.ts).
  assert.equal(w.f.db.prepare('SELECT alt_texts FROM x_posts WHERE id = 7').get().alt_texts, null);
  // The stored content type wins over the key's extension.
  const typed = makeAI(() => reply('A logo.'));
  const t = await world(typed);
  t.files.set('x/1/7/b.png', { bytes: PNG, contentType: 'image/webp' });
  t.f.db.prepare("UPDATE x_posts SET media_r2_keys = '[\"x/1/7/b.png\"]' WHERE id = 7").run();
  await call(t, 'POST', '/api/admin/x/posts/7/alt-text', { index: 0 });
  assert.match(typed.calls[0].payload.messages.at(-1).content[1].image_url.url, /^data:image\/webp;base64,/);
  const down = await world(makeAI(() => { throw new Error('3040: capacity'); }));
  down.files.set('x/1/7/a.png', { bytes: PNG, contentType: 'image/png' });
  down.f.db.prepare("UPDATE x_posts SET media_r2_keys = '[\"x/1/7/a.png\"]' WHERE id = 7").run();
  const failed = await call(down, 'POST', '/api/admin/x/posts/7/alt-text', { index: 0 });
  assert.equal(failed.status, 502);
  assert.equal(failed.body.code ?? failed.body.error, 'ai_failed');
  assert.equal(down.f.db.prepare('SELECT alt_texts FROM x_posts WHERE id = 7').get().alt_texts, null, 'nothing saved');
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('embeddings: embed as a system run on /admin/platform, BGE Base only, the guard not called', async () => {
  // Mutations checked: the model check dropped (another model's vector accepted); userId 1 passed.
  const ai = makeAI(() => ({ data: [new Array(768).fill(0.1)], usage: { prompt_tokens: 3 } }));
  const w = await world(ai);
  const v = await embedText(w.env, 'index me');
  assert.equal(v?.length, 768);
  assert.deepEqual(ai.calls.map((c) => [c.model, c.payload]), [[SEARCH_INDEX_MODEL, { text: 'index me' }]]);
  assert.ok(!ai.calls.some((c) => c.model === GUARD_MODEL));
  assert.deepEqual(rows(w), [{ user_id: 0, task: 'embed', model: SEARCH_INDEX_MODEL, surface: '/admin/platform', charged_microusd: 0, reservation_uid: null }]);
  // The same text again is the router's cache: no second call.
  await embedText(w.env, 'index me');
  assert.equal(ai.calls.length, 1);
  const wrong = await world(makeAI(() => ({ data: [new Array(1024).fill(0.1)] })));
  assert.equal(await embedText(wrong.env, 'x'), null);
  const upserts: unknown[] = [];
  const idx = await world(makeAI(() => ({ data: [new Array(768).fill(0.2)] })), { VECTORIZE: { async upsert(v: unknown[]) { upserts.push(...v); } } });
  assert.equal(await upsertEntity(idx.env, { type: 'project', id: 1, text: 'A venture.', title: 'V', url: '/v' }), true);
  assert.equal(upserts.length, 1);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('the new tasks are routed and priced, and llava is gone from these files', () => {
  // Mutation checked: Scout's price row removed.
  for (const t of ['ops_summary', 'image_screen', 'image_alt_text'] as const) {
    assert.ok(PRICE_USD_PER_1M_TOKENS[ROUTE[t].model], `${t} bills as zero`);
  }
  assert.deepEqual(PRICE_USD_PER_1M_TOKENS[SCOUT], { in: 0.269995, out: 0.850003 }, 'the catalogue\'s neuron price (D760)');
  for (const f of ['routes/monitoring.ts', 'routes/admin_x.ts', 'services/vectorize.ts']) {
    const src = readFileSync(join('cloudflare-worker/src', f), 'utf8');
    assert.doesNotMatch(src, /\benv\.AI\.run\(/, `${f} still calls env.AI.run`);
    assert.doesNotMatch(src, /['"`]@cf\/llava/, `${f} still calls llava`);
  }
});

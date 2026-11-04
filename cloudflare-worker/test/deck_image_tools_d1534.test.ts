/**
 * D1534 (#3778 phase 2, deck builder v2 B2): background removal through AI
 * Gateway (Bria RMBG 2.0, owner decision M = B). The mounted Worker routes on
 * the real migrated schema in memory; `env.AI` is a stub, R2 a map, and the
 * cutout's URL is answered by a stubbed fetch.
 *
 *   1. The switch off means no call: the tool reads "Coming later", the quote
 *      answers `ai: false`, a press is 503 `image_tool_off`; nothing is held,
 *      called or recorded.
 *   2. Removal is quoted and charged: the quote is the printed $0.018 at the
 *      member's billed multiplier; the run holds it, calls Bria once with the
 *      parent, stores a proposed child that names its parent and its tool, and
 *      settles the hold at the quote with one usage row.
 *   3. A refusal holds nothing: a member without tokens is 402 before any call.
 *   4. A failed call releases the hold and stores nothing.
 *   5. Upscale has its own switch (D4316): off while only Bria's is on.
 *   6. Reverting a tool's child restores the parent; another venture's image is 404.
 *
 * D4316 (#4316): Upscale through Pruna P-Image-Upscale, behind `AI_PROVIDER_PRUNA`.
 *   7. The catalogue row and its own switch; Bria's switch never turns it on.
 *   8. Upscale is quoted and charged: Pruna runs once with 4× the area (capped
 *      at 8 MP), in the original's format, without enhancement; the child records
 *      its own, larger pixel size and keeps the parent's alt text.
 *   9. An image already at 8 MP is refused before any hold, quote included.
 *  10. A JPEG stays a JPEG; a failed upscale releases the hold.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckImageEdits, { __setToolDepsForTest } from '../src/routes/deck_image_edits.ts';
import deckImages from '../src/routes/deck_images.ts';
import decks from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { GATEWAY_IMAGE_MODELS, IMAGE_TOOL_SWITCH, UPSCALE_TOOL_SWITCH, gatewayImageModelFor } from '../src/services/ai/catalogue.ts';
import { OFF_MESSAGE, OFF_MESSAGES, UPSCALE_TOO_LARGE_MESSAGE, resultUrl, toolInput, toolQuoteMicro, upscaleTarget } from '../src/services/decks/imageTools.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { CONTRACTS } from '../src/contracts/index.ts';
import { contractErrors } from '../src/contracts/validate.ts';
import { imageLookParts } from '../src/services/decks/pptxEditable.ts';
import * as browserLook from '../../frontend/src/pages/raise/pitch/imageLook.js';

const TOOLS_SCHEMA = JSON.parse(readFileSync(new URL('../src/contracts/' + CONTRACTS.imageEditAi.schema, import.meta.url), 'utf8'));

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations)
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const JWT_SECRET = 'synthetic-d1534-only-not-a-real-credential'.repeat(2);
const ORIGIN = 'https://axal.vc';
const BRIA = 'bria/remove-background';
const FOUNDER = 2, OTHER = 3;
const P_PHOTO = '00000000-0000-4000-8000-000000000011';
const P_OTHER = '00000000-0000-4000-8000-000000000014';
const CUT_URL = 'https://bria-results.example/cutout.png';
const PRUNA = 'pruna/p-image-upscale';
const UP_URL = 'https://pruna-results.example/upscaled.png';
const UP_JPG_URL = 'https://pruna-results.example/upscaled.jpg';

/** A JPEG that reads as `w` × `h` (SOI, then an SOF0 segment). */
function jpegOf(w: number, h: number): Uint8Array {
  const b = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  return b;
}

/** A PNG header that reads as `w` × `h`. */
function pngOf(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}

async function fixture({ on = false, balance = 5_000_000, bria = 'ok' as 'ok' | 'throws' | 'no_url', pruna = false, prunaAnswer = 'ok' as 'ok' | 'throws',
  size = [1024, 768] as [number, number], parentMime = 'image/png' as 'image/png' | 'image/jpeg' } = {}) {
  __resetForTest();
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(baseline); for (const sql of migrations) db.exec(sql);
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  insert.run(FOUNDER, 'founder', 100, 'Ada Quill', 'synthetic-2@example.invalid', 'studio');
  insert.run(OTHER, 'founder', 300, 'Synthetic other', 'synthetic-3@example.invalid', 'studio');
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Other venture',300)");
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (7, 1, 3, ?, 1)').run(JSON.stringify([{ title: 'Team' }]));
  for (const u of [FOUNDER, OTHER]) db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,?)').run(u, balance);
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,2)').run(key);
  const r2 = new Map<string, Uint8Array>();
  const img = db.prepare(`INSERT INTO deck_images (id, uid, project_id, deck_id, card, r2_key, mime, width, height, source, style, aspect, use, state, alt)
    VALUES (?, ?, ?, 7, 0, ?, ?, ?, ?, 'upload', 'flat', '4:3', 'content', 'kept', 'The founding team at the bench')`);
  for (const [id, uid, project] of [[1, P_PHOTO, 1], [4, P_OTHER, 3]] as const) {
    const key = `deck-images/${project}/${uid}.${parentMime === 'image/jpeg' ? 'jpg' : 'png'}`;
    img.run(id, uid, project, key, parentMime, size[0], size[1]);
    r2.set(key, parentMime === 'image/jpeg' ? jpegOf(size[0], size[1]) : pngOf(size[0], size[1]));
  }
  const calls: Array<{ model: string; input: any; opts: any }> = [];
  const AI = withGuard({
    run: async (model: string, input: any, opts: any) => {
      calls.push({ model, input, opts });
      if (model === PRUNA) {
        if (prunaAnswer === 'throws') throw new Error('pruna 500');
        return { image: input.output_format === 'jpg' ? UP_JPG_URL : UP_URL };
      }
      if (model !== BRIA) throw new Error(`unexpected model ${model}`);
      if (bria === 'throws') throw new Error('bria 500');
      return bria === 'no_url' ? { state: 'Failed' } : { image: CUT_URL };
    },
  });
  const fetched: string[] = [];
  __setToolDepsForTest({ fetch: (async (url: string) => {
    fetched.push(url);
    if (url === UP_URL) return new Response(pngOf(size[0] * 2, size[1] * 2));
    if (url === UP_JPG_URL) return new Response(jpegOf(size[0] * 2, size[1] * 2));
    return new Response(pngOf(1024, 768));
  }) as any });
  const FILES = {
    put: async (key: string, bytes: Uint8Array) => { r2.set(key, new Uint8Array(bytes)); },
    get: async (key: string) => (r2.has(key) ? { body: new Blob([r2.get(key)!]).stream() } : null),
  };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI, FILES, ...(on ? { [IMAGE_TOOL_SWITCH]: 'on' } : {}), ...(pruna ? { [UPSCALE_TOOL_SWITCH]: 'on' } : {}) };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckImageEdits).route('/api/decks', deckImages).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const close = () => { __setToolDepsForTest(undefined); db.close(); };
  const runs = (model = BRIA) => db.prepare("SELECT model, task, est_cost_usd, charged_microusd, refusal, surface, units_json AS units FROM ai_usage_logs WHERE model = ? ORDER BY id").all(model) as any[];
  const holds = () => db.prepare('SELECT status, COALESCE(actual_included_microusd, 0) + COALESCE(actual_topup_microusd, 0) AS charged FROM ai_budget_reservations').all() as any[];
  const children = () => db.prepare('SELECT * FROM deck_images WHERE parent_uid IS NOT NULL ORDER BY id').all() as any[];
  const row = (uid: string) => db.prepare('SELECT * FROM deck_images WHERE uid = ?').get(uid) as any;
  return { db, env, app, calls, fetched, r2, runs, holds, children, row, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

const token = (who: number) => new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function call(f: F, who: number, path: string, json?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(who)}` };
  if (json !== undefined) headers['content-type'] = 'application/json';
  const res = await f.app.request(ORIGIN + path, { method: json !== undefined ? 'POST' : 'GET', headers, body: json !== undefined ? JSON.stringify(json) : undefined }, f.env);
  return { status: res.status, body: await res.json() as any };
}
const briaCalls = (f: F) => f.calls.filter((c) => c.model === BRIA);

test('the catalogue rows: Bria RMBG 2.0 at $0.018 behind AI_PROVIDER_BRIA; Pruna upscale at $0.005 behind its own AI_PROVIDER_PRUNA', () => {
  assert.deepEqual(GATEWAY_IMAGE_MODELS.map((m) => [m.id, m.provider, m.tool, m.switch, m.usdPerImage]),
    [[BRIA, 'bria', 'remove_background', 'AI_PROVIDER_BRIA', '0.018'], [PRUNA, 'pruna', 'upscale', 'AI_PROVIDER_PRUNA', '0.005']]);
  assert.equal(gatewayImageModelFor('upscale')!.id, PRUNA);
  assert.equal(resultUrl({ image: CUT_URL }), CUT_URL);
  assert.equal(resultUrl({ state: 'Completed', result: { image: CUT_URL } }), CUT_URL);
  assert.equal(resultUrl({ image: 'http://insecure.example/x.png' }), null, 'only an https result is fetched');
});

test('the switch off means no call: "Coming later", the quote is not ai, a press is 503; nothing held, called or recorded', async () => {
  // Mutation checked: the switch check dropped (Bria called with the switch unset).
  const f = await fixture({ on: false });
  try {
    const tools = await call(f, FOUNDER, '/api/decks/images/tools');
    assert.deepEqual(contractErrors(TOOLS_SCHEMA, tools.body), [], 'the adapter\'s imageEditAi contract (D1511)');
    assert.deepEqual(tools.body.tools.map((t: any) => [t.tool, t.on, t.message]),
      [['remove_background', false, OFF_MESSAGE], ['upscale', false, OFF_MESSAGES.upscale]]);
    const q = await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/remove_background/quote`, {});
    assert.deepEqual([q.status, q.body.ai, q.body.reason], [200, false, 'image_tool_off']);
    const run = await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/remove_background`, {});
    assert.deepEqual([run.status, run.body.error], [503, 'image_tool_off']);
    assert.deepEqual([briaCalls(f).length, f.holds().length, f.runs().length, f.children().length], [0, 0, 0, 0]);
  } finally { f.close(); }
});

test('removal is quoted and charged: the quote holds, Bria runs once, a proposed child names its parent and tool, the hold settles at the quote', async () => {
  // Mutations checked: the charge left at 0 (settled as a refund); the child written with edit_op; the parent overwritten.
  const f = await fixture({ on: true });
  try {
    const quoteMicro = await toolQuoteMicro(f.env, FOUNDER, gatewayImageModelFor('remove_background')!);
    assert.ok(quoteMicro >= 18_000, 'at least the printed $0.018');
    const q = await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/remove_background/quote`, {});
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.deepEqual([q.body.ai, q.body.model, q.body.model_label, q.body.hold_microusd, q.body.balance.ok], [true, BRIA, 'Bria RMBG 2.0', quoteMicro, true]);
    assert.equal(briaCalls(f).length, 0, 'a quote calls nothing');
    const before = { ...f.row(P_PHOTO) };
    const r = await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/remove_background`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [one] = briaCalls(f);
    assert.equal(briaCalls(f).length, 1);
    assert.match(one.input.image, /^data:image\/png;base64,/);
    assert.equal(one.input.preserve_alpha, true);
    assert.deepEqual(f.fetched, [CUT_URL], 'the cutout is fetched once');
    const [child] = f.children();
    assert.deepEqual([child.parent_uid, child.image_tool, child.edit_op, child.state, child.mime, child.model, child.alt],
      [P_PHOTO, 'remove_background', null, 'proposed', 'image/png', BRIA, 'The founding team at the bench']);
    assert.ok(f.r2.has(child.r2_key), 'the cutout is stored');
    assert.deepEqual({ ...f.row(P_PHOTO) }, before, 'the parent is unchanged');
    assert.deepEqual([r.body.tool, r.body.image.image_tool, r.body.cost.hold_microusd, r.body.cost.charged_microusd], ['remove_background', 'remove_background', quoteMicro, quoteMicro]);
    assert.deepEqual(f.holds().map((h) => [h.status, h.charged]), [['settled', quoteMicro]]);
    assert.deepEqual(f.runs().map((u) => [u.est_cost_usd, u.charged_microusd, u.refusal, u.surface]), [[0.018, quoteMicro, null, '/raise/pitch']]);
    assert.equal(child.charged_microusd, quoteMicro);
  } finally { f.close(); }
});

test('a refusal holds nothing: a member without tokens is 402 before Bria is called', async () => {
  // Mutation checked: the call made before the hold (Bria called for a member who cannot pay).
  const f = await fixture({ on: true, balance: 0 });
  try {
    const q = await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/remove_background/quote`, {});
    assert.equal(q.body.balance.ok, false, 'the quote says the balance does not cover it');
    const r = await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/remove_background`, {});
    assert.equal(r.status, 402, JSON.stringify(r.body));
    assert.deepEqual([briaCalls(f).length, f.children().length], [0, 0]);
    assert.equal(f.holds().filter((h) => h.status === 'pending' || h.charged > 0).length, 0, 'nothing held or charged');
  } finally { f.close(); }
});

test('a failed call releases the hold and stores nothing', async () => {
  for (const bria of ['throws', 'no_url'] as const) {
    const f = await fixture({ on: true, bria });
    try {
      const r = await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/remove_background`, {});
      assert.deepEqual([r.status, r.body.error], [503, 'image_tool_failed'], bria);
      assert.equal(f.children().length, 0);
      assert.ok(f.holds().every((h) => h.charged === 0 && h.status !== 'pending'), `${bria}: released`);
      assert.deepEqual(f.runs().map((u) => [u.charged_microusd, u.refusal]), [[0, 'all_models_failed']]);
    } finally { f.close(); }
  }
});

test('upscale has its own switch: off while only Bria\'s is on (D4316)', async () => {
  // Mutation checked: Upscale read from Bria's switch → Pruna is offered and called with only AI_PROVIDER_BRIA set.
  const f = await fixture({ on: true });
  try {
    const tools = await call(f, FOUNDER, '/api/decks/images/tools');
    assert.deepEqual(tools.body.tools.map((t: any) => [t.tool, t.on]), [['remove_background', true], ['upscale', false]]);
    const q = await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/upscale/quote`, {});
    assert.deepEqual([q.body.ai, q.body.message], [false, OFF_MESSAGES.upscale]);
    assert.equal((await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/upscale`, {})).status, 503);
    assert.equal((await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/crop`, {})).status, 404, 'an unknown tool');
    assert.equal(briaCalls(f).length, 0);
    assert.equal(f.calls.filter((c) => c.model === PRUNA).length, 0);
  } finally { f.close(); }
});

test('reverting a tool\'s child restores the parent; another venture\'s image is 404 with nothing run', async () => {
  const f = await fixture({ on: true });
  try {
    const r = await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/remove_background`, {});
    const back = await call(f, FOUNDER, `/api/decks/images/${r.body.image.uid}/revert`, {});
    assert.deepEqual([back.status, back.body.parent.uid, back.body.discarded], [200, P_PHOTO, r.body.image.uid]);
    assert.equal(f.row(r.body.image.uid).state, 'discarded');
    const theirs = await call(f, FOUNDER, `/api/decks/images/${P_OTHER}/tools/remove_background`, {});
    assert.equal(theirs.status, 404);
    assert.equal(briaCalls(f).length, 1, 'only the founder\'s own image ran');
  } finally { f.close(); }
});

// ── D4316 (#4316): Upscale through Pruna ───────────────────────────────────
const prunaCalls = (f: F) => f.calls.filter((c) => c.model === PRUNA);

test('7. the upscale target: 4× the area, capped at 8 MP; at the cap, none', () => {
  assert.equal(upscaleTarget({ width: 1024, height: 768 }), 4);
  assert.equal(upscaleTarget({ width: 640, height: 480 }), 2);
  assert.equal(upscaleTarget({ width: 2000, height: 1500 }), 8, 'capped');
  assert.equal(upscaleTarget({ width: 4000, height: 2000 }), null, 'already 8 MP');
  assert.equal(upscaleTarget(null), null);
  assert.deepEqual(toolInput('upscale', 'data:x', 'image/png', 4),
    { image: 'data:x', upscale_mode: 'target', target: 4, enhance_details: false, enhance_realism: false, output_format: 'png' });
  assert.equal(toolInput('upscale', 'data:x', 'image/jpeg', 4).output_format, 'jpg');
  assert.deepEqual(toolInput('remove_background', 'data:x', 'image/png', null), { image: 'data:x', preserve_alpha: true });
  assert.equal(resultUrl(UP_URL), UP_URL, 'an upscaler may answer with the URL alone');
});

test('8. upscale is quoted and charged: Pruna once at 4× the area, a child with its own size, the hold settled at the quote', async () => {
  // Mutations checked: the child stored with the parent's size (the PowerPoint would crop the wrong pixels); the usage row's provider left as bria.
  const f = await fixture({ pruna: true });
  try {
    const quoteMicro = await toolQuoteMicro(f.env, FOUNDER, gatewayImageModelFor('upscale')!);
    assert.ok(quoteMicro >= 5_000, 'at least the printed $0.005');
    const q = await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/upscale/quote`, {});
    assert.deepEqual([q.status, q.body.ai, q.body.model, q.body.model_label, q.body.label, q.body.hold_microusd], [200, true, PRUNA, 'Pruna P-Image-Upscale', 'Upscale', quoteMicro]);
    assert.equal(prunaCalls(f).length, 0, 'a quote calls nothing');
    const before = { ...f.row(P_PHOTO) };
    const r = await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/upscale`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(prunaCalls(f).length, 1);
    assert.equal(briaCalls(f).length, 0, 'Bria is not called for an upscale');
    const [one] = prunaCalls(f);
    assert.match(one.input.image, /^data:image\/png;base64,/);
    assert.deepEqual([one.input.upscale_mode, one.input.target, one.input.output_format, one.input.enhance_details, one.input.enhance_realism], ['target', 4, 'png', false, false]);
    assert.deepEqual(f.fetched, [UP_URL], 'the result is fetched once');
    const [child] = f.children();
    assert.deepEqual([child.parent_uid, child.image_tool, child.edit_op, child.state, child.mime, child.model, child.alt, child.width, child.height],
      [P_PHOTO, 'upscale', null, 'proposed', 'image/png', PRUNA, 'The founding team at the bench', 2048, 1536]);
    assert.ok(f.r2.has(child.r2_key));
    assert.deepEqual({ ...f.row(P_PHOTO) }, before, 'the parent is unchanged');
    assert.deepEqual(f.holds().map((h) => [h.status, h.charged]), [['settled', quoteMicro]]);
    const [usage] = f.runs(PRUNA);
    assert.deepEqual([usage.est_cost_usd, usage.charged_microusd, usage.refusal, usage.task], [0.005, quoteMicro, null, 'rail_edit_image']);
    assert.equal(JSON.parse(usage.units).provider, 'pruna');
    // Revert discards the child, as for a cutout.
    const back = await call(f, FOUNDER, `/api/decks/images/${child.uid}/revert`, {});
    assert.deepEqual([back.status, back.body.parent.uid], [200, P_PHOTO]);
  } finally { f.close(); }
});

test('9. an image already at 8 MP is refused before any hold: the quote says so, a press is 422 and calls nothing', async () => {
  // Mutation checked: the cap dropped → Pruna is called (and charged) for an image it cannot enlarge.
  const f = await fixture({ pruna: true, size: [4000, 2000] });
  try {
    const q = await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/upscale/quote`, {});
    assert.deepEqual([q.body.ai, q.body.reason, q.body.message], [false, 'image_large_enough', UPSCALE_TOO_LARGE_MESSAGE]);
    const r = await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/upscale`, {});
    assert.deepEqual([r.status, r.body.error], [422, 'image_large_enough']);
    assert.deepEqual([prunaCalls(f).length, f.holds().length, f.children().length], [0, 0, 0]);
  } finally { f.close(); }
});

test('10. a JPEG stays a JPEG; a failed upscale releases the hold and stores nothing', async () => {
  // Mutation checked: the result format fixed to PNG → a JPEG's upscale is refused as unreadable and never stored.
  const f = await fixture({ pruna: true, parentMime: 'image/jpeg', size: [800, 600] });
  try {
    const r = await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/upscale`, {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(prunaCalls(f)[0].input.output_format, 'jpg');
    const [child] = f.children();
    assert.deepEqual([child.mime, child.width, child.height], ['image/jpeg', 1600, 1200]);
    assert.match(child.r2_key, /\.jpg$/);
  } finally { f.close(); }
  const g = await fixture({ pruna: true, prunaAnswer: 'throws' });
  try {
    const r = await call(g, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/upscale`, {});
    assert.deepEqual([r.status, r.body.error, r.body.message], [503, 'image_tool_failed', 'The image could not be upscaled this time. Nothing was charged.']);
    assert.equal(g.children().length, 0);
    assert.ok(g.holds().every((h) => h.charged === 0 && h.status !== 'pending'), 'released');
  } finally { g.close(); }
});

test('11. Bria\'s switch and Pruna\'s are independent: Pruna on alone leaves background removal off', async () => {
  const f = await fixture({ pruna: true });
  try {
    const tools = await call(f, FOUNDER, '/api/decks/images/tools');
    assert.deepEqual(tools.body.tools.map((t: any) => [t.tool, t.on]), [['remove_background', false], ['upscale', true]]);
    assert.equal((await call(f, FOUNDER, `/api/decks/images/${P_PHOTO}/tools/remove_background`, {})).status, 503);
    assert.equal(briaCalls(f).length, 0);
  } finally { f.close(); }
});

test('12. the upscaled child draws the same as its parent: the editable PowerPoint crops the same window, and the browser\'s look is the block\'s own', () => {
  // The block keeps its crop, filter and fit (placedResult); only its image changes. The PDF and the
  // PowerPoint download are taken from the print page, which draws with the browser's look below.
  const block = { id: 'i1', kind: 'image', grid: { c1: 1, r1: 1, c2: 6, r2: 4 }, image_url: 'x', alt: 'A desk', fit: 'cover', crop: { x: 40, y: 50, rect: { x: 10, y: 0, w: 80, h: 80 } }, filter: 'warm' };
  const frame = { x: 0, y: 0, w: 800, h: 450 };
  const parent = imageLookParts(block, frame, { kind: 'png', bytes: pngOf(1024, 768) });
  const child = imageLookParts(block, frame, { kind: 'png', bytes: pngOf(2048, 1536) });
  assert.ok(parent.src, 'a window shows');
  assert.deepEqual(child, parent, 'the same srcRect, effects and wash');
  const jpeg = imageLookParts(block, frame, { kind: 'jpeg', bytes: jpegOf(2048, 1536) });
  assert.equal(jpeg.src, parent.src, 'an upscaled JPEG too');
  assert.deepEqual(browserLook.imageLookStyle({ ...block, image_url: 'child' }), browserLook.imageLookStyle(block), 'the browser draws the block\'s look, whatever the image');
});

/**
 * D903 (#2682, part 9 of #2434): images for the pitch deck's cards and
 * backgrounds. Synthetic data, the mounted Worker routes and the real migrated
 * schema in memory; `env.AI` is a stub, R2 is a map and `fetch` throws.
 *
 *   · a real person is refused before any quote or hold, in the canvas's
 *     words; a figure and a chart too;
 *   · the quote names the model and its price per image, and checks the
 *     balance before the hold; a short balance is 402 with nothing run;
 *   · every image keeps its usage row and its charge, lives in R2 and is read
 *     at an https app URL that passes `sanitizeImageUrl`, never a data: URL;
 *   · a proposal is the venture's own; a kept image is readable by its URL;
 *   · "Keep as background" waits until the text reads at 4.5:1;
 *   · an upload showing a person needs their agreement recorded.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckImages, { imageUrl } from '../src/routes/deck_images.ts';
import decks, { sanitizeImageUrl } from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import {
  IMAGE_MODEL, REAL_PERSON_MESSAGE, askOf, overlayContrast, personIn, promptOf, readable, sniffMime,
} from '../src/services/decks/images.ts';
import { sanitizeBlocks, sanitizeModel } from '../src/services/decks/slideModel.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { overlayContrast as panelContrast } from '../../frontend/src/pages/raise/pitch/imageContrast.js';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const JWT_SECRET = 'synthetic-d903-only-not-a-real-credential'.repeat(2);
const ORIGIN = 'https://axal.vc';
// A 1 × 1 PNG, as FLUX's `{ image: base64 }` would carry it.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const BODY = { use: 'content', description: 'A calm month-end close at a tidy desk', style: 'flat', palette: 'brand', aspect: '4:3', count: 2, card: 0 };

async function fixture({ balance = 5_000_000 } = {}) {
  __resetForTest();
  // In memory: nothing is copied to disk per case.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(baseline); for (const sql of migrations) db.exec(sql);
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid, name] of [[2, 'founder', 100, 'Ada Quill'], [3, 'founder', 300, 'Synthetic other'], [6, 'investor', null, 'Synthetic investor']] as const) {
    insert.run(id, role, fid, name, `synthetic-${id}@example.invalid`, 'studio');
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Other venture',300)");
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (7, 1, 3, ?, 1)').run(JSON.stringify([{ title: 'Solution' }]));
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,?)').run(balance);
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,2)').run(key);
  const calls: Array<{ model: string; prompt: string }> = [];
  const AI = withGuard({
    run: async (model: string, input: any) => { calls.push({ model, prompt: String(input?.prompt ?? '') }); return { image: PNG }; },
  });
  const r2 = new Map<string, Uint8Array>();
  const FILES = {
    put: async (key: string, bytes: Uint8Array) => { r2.set(key, new Uint8Array(bytes)); },
    get: async (key: string) => (r2.has(key) ? { body: new Blob([r2.get(key)!]).stream() } : null),
  };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI, FILES };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckImages).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT id, user_id, task, rail_option, charged_microusd FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  const holds = () => (db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get() as any).n as number;
  const rows = () => db.prepare('SELECT * FROM deck_images ORDER BY id').all() as any[];
  const audits = () => (db.prepare("SELECT action FROM activity_logs WHERE entity_type = 'raise.pitch-deck' ORDER BY id").all() as any[]).map((r) => r.action);
  return { db, env, app, calls, r2, runs, holds, rows, audits, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

const token = (who: number) => new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function call(f: F, who: number | null, path: string, init: { method?: string; json?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = who ? { Authorization: `Bearer ${await token(who)}` } : {};
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  const res = await f.app.request(ORIGIN + path, { method: init.method ?? (init.json !== undefined || init.form ? 'POST' : 'GET'), headers, body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined) }, f.env);
  const type = res.headers.get('content-type') || '';
  const body = type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, body: body as any, headers: res.headers };
}

// ─────────────────────────────────────────────────────────── pure

test('the request, the prompt and what a description is refused for', () => {
  assert.equal(personIn('A portrait of a nurse', []), 'face');
  assert.equal(personIn('our team at the whiteboard', []), 'face');
  assert.equal(personIn('Ada Quill closing the books', ['Ada Quill']), 'name');
  assert.equal(personIn('a desk where Quill works', ['Ada Quill']), 'name', 'a surname as a name is written');
  assert.equal(personIn('a quill pen on paper', ['Ada Quill']), null, 'a word that is also a surname, lower case, is not a name');
  assert.equal(personIn('A calm month-end close', ['Ada Quill']), null);
  assert.deepEqual('error' in askOf({ description: 'x' }), true);
  assert.deepEqual('error' in askOf({ description: 'a desk', count: 5 }), true);
  const read = askOf({ ...BODY, points: ['Pain theme: manual reconciliation', 7] });
  assert.ok('ask' in read);
  const prompt = promptOf((read as any).ask, ['#0f2a3d']);
  assert.match(prompt, /^A calm month-end close at a tidy desk\. About: Pain theme: manual reconciliation\./);
  assert.match(prompt, /no identifiable people, no faces, no text, no letters, no numbers, no charts or graphs\.$/);
  assert.equal(sniffMime(Buffer.from(PNG, 'base64')), 'image/png');
  assert.equal(sniffMime(new Uint8Array([1, 2, 3])), null);
});

test('the overlay rule: the worst case reaches 4.5:1 or Keep as background waits, and the panel reads the same figure', () => {
  assert.equal(readable('none'), false, 'with no overlay the image could be white under the text (PD12c)');
  assert.equal(readable('light'), true);
  assert.equal(readable('strong'), true);
  assert.equal(readable('strong', '#c4b5fd'), false, 'a light brand ink cannot carry light text');
  for (const ink of ['#0f2a3d', '#09090b', '#7c3aed', '#c4b5fd', '#ffffff']) {
    for (const o of ['none', 'light', 'strong'] as const) assert.equal(panelContrast(o, ink), overlayContrast(o, ink), `${o} ${ink}`);
  }
});

test('the slide model keeps an image block\'s id, fit and crop, and a background\'s id and overlay', () => {
  const uid = '0b6a2c1e-3f4d-4a5b-8c9d-0e1f2a3b4c5d';
  const url = imageUrl(`${ORIGIN}/api/decks/7/images`, uid);
  assert.equal(sanitizeImageUrl(url), url, 'the app URL passes the image guard');
  const [b] = sanitizeBlocks([{ id: 'i1', kind: 'image', grid: { c1: 1, c2: 6, r1: 1, r2: 4 }, image_url: url, image_id: uid, alt: 'A desk', tag: 'illustration', fit: 'contain', crop: { x: 120, y: 30.4 } }], sanitizeImageUrl);
  assert.deepEqual(b, { id: 'i1', kind: 'image', grid: { c1: 1, c2: 6, r1: 1, r2: 4 }, image_url: url, alt: 'A desk', tag: 'illustration', image_id: uid, fit: 'contain', crop: { x: 100, y: 30 } });
  const m = sanitizeModel({ background: { image_url: url, image_id: uid, overlay: 'light' } }, sanitizeImageUrl);
  assert.deepEqual(m.background, { color: null, image_url: url, image_id: uid, overlay: 'light' });
  assert.deepEqual(sanitizeModel({ background: { image_url: 'data:image/png;base64,AAAA', overlay: 'light' } }, sanitizeImageUrl), {}, 'a data: URL is never kept');
  assert.equal(sanitizeBlocks([{ kind: 'image', grid: { c1: 1, c2: 2, r1: 1, r2: 1 }, image_url: url, image_id: 'not-an-id' }], sanitizeImageUrl)[0].image_id, undefined);
});

// ─────────────────────────────────────────────────────────── refused before anything runs

test('a real person, a figure or a chart is refused before any quote or hold, and nothing runs', async () => {
  const f = await fixture();
  try {
    for (const [description, code] of [
      ['A portrait of our founder at work', 'real_person'], ['Ada Quill presenting to investors', 'real_person'],
      ['A desk with 42 happy customers', 'figure_in_prompt'], ['A bar chart of revenue growth', 'not_illustrative'],
    ] as const) {
      for (const path of ['/api/decks/7/images/quote', '/api/decks/7/images']) {
        const r = await call(f, 2, path, { json: { ...BODY, description } });
        assert.equal(r.status, 422, `${path} ${description}`);
        assert.equal(r.body.error, code, description);
        if (code === 'real_person') assert.equal(r.body.message, REAL_PERSON_MESSAGE);
      }
    }
    assert.equal(f.calls.length, 0, 'no model was called');
    assert.deepEqual(f.runs(), [], 'no usage row');
    assert.equal(f.holds(), 0, 'no hold');
    assert.deepEqual(f.rows(), []);
  } finally { f.close(); }
});

test('the quote names the model and its price per image, and a short balance is refused before the hold', async () => {
  const f = await fixture({ balance: 0 });
  try {
    const q = await call(f, 2, '/api/decks/7/images/quote', { json: BODY });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.ai, true);
    assert.equal(q.body.model, IMAGE_MODEL); assert.equal(q.body.model_label, 'FLUX.1 Schnell');
    assert.ok(q.body.per_image_microusd > 0);
    assert.deepEqual(q.body.models, [{ id: IMAGE_MODEL, label: 'FLUX.1 Schnell', per_image_microusd: q.body.per_image_microusd }]);
    assert.equal(q.body.total_microusd, q.body.per_image_microusd * 2);
    assert.equal(q.body.balance.ok, false, 'no allowance and no balance');
    const r = await call(f, 2, '/api/decks/7/images', { json: BODY });
    assert.equal(r.status, 402); assert.equal(r.body.error, 'budget_user_month');
    assert.equal(f.calls.length, 0); assert.equal(f.holds(), 0); assert.deepEqual(f.rows(), []);
  } finally { f.close(); }
});

test('the balance must cover every image asked for before the first one runs, not just the next one', async () => {
  const f = await fixture();
  try {
    const per = (await call(f, 2, '/api/decks/7/images/quote', { json: { ...BODY, count: 1 } })).body.per_image_microusd;
    f.db.prepare('UPDATE ai_topup_accounts SET balance_microusd = ? WHERE user_id = 2').run(Math.floor(per * 1.5));
    const q = await call(f, 2, '/api/decks/7/images/quote', { json: BODY });
    assert.equal(q.body.balance.ok, false, 'one and a half images cannot pay for two');
    const r = await call(f, 2, '/api/decks/7/images', { json: BODY });
    assert.equal(r.status, 402);
    assert.equal(f.calls.length, 0, 'not even the first image ran');
    assert.equal(f.holds(), 0); assert.deepEqual(f.rows(), []);
    const one = await call(f, 2, '/api/decks/7/images', { json: { ...BODY, count: 1 } });
    assert.equal(one.status, 200, 'one image is covered'); assert.equal(one.body.images.length, 1);
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── the run

test('every image keeps its usage row and its charge, lives in R2, and is read at an https app URL', async () => {
  const f = await fixture();
  try {
    const r = await call(f, 2, '/api/decks/7/images', { json: BODY });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.images.length, 2);
    assert.equal(f.calls.filter((x) => x.model === IMAGE_MODEL).length, 2, 'one run per image');
    assert.match(f.calls.find((x) => x.model === IMAGE_MODEL)!.prompt, /no identifiable people/);
    const runs = f.runs().filter((x) => x.task === 'deck_image');
    assert.equal(runs.length, 2);
    assert.ok(runs.every((x) => x.user_id === 2 && x.rail_option === 'deck:image'));
    const rows = f.rows();
    assert.deepEqual(rows.map((x) => x.ai_usage_log_id), runs.map((x) => x.id), 'each image names its own run');
    assert.deepEqual(rows.map((x) => x.charged_microusd), runs.map((x) => x.charged_microusd), 'and keeps what it was charged');
    assert.ok(rows.every((x) => x.state === 'proposed' && x.source === 'generated' && x.mime === 'image/png' && x.use === 'content' && x.card === 0));
    assert.ok(rows.every((x) => f.r2.has(x.r2_key) && x.r2_key.startsWith('deck-images/1/')));
    for (const image of r.body.images) {
      assert.equal(sanitizeImageUrl(image.url), image.url);
      assert.match(image.url, /^https:\/\/axal\.vc\/api\/decks\/images\/[0-9a-f-]{36}\/file$/);
      assert.doesNotMatch(JSON.stringify(image), /data:image/);
      assert.equal(image.model_label, 'FLUX.1 Schnell');
    }
    assert.equal(f.holds(), 2, 'each image was held before it ran, as every charged run is');
    assert.deepEqual(f.audits(), ['deck_image_proposed'], 'one cycle row for the run, with no figure');
  } finally { f.close(); }
});

test('a proposal is the venture\'s own; Keep makes it readable by its URL; a discarded image is read by nobody', async () => {
  const f = await fixture();
  try {
    const [a, b] = (await call(f, 2, '/api/decks/7/images', { json: BODY })).body.images;
    const file = (uid: string) => `/api/decks/images/${uid}/file`;
    assert.equal((await call(f, null, file(a.uid))).status, 404, 'a proposal is not public');
    assert.equal((await call(f, 3, file(a.uid))).status, 404, 'nor another venture\'s');
    const own = await call(f, 2, file(a.uid));
    assert.equal(own.status, 200); assert.equal(own.headers.get('content-type'), 'image/png');
    assert.equal(own.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual([...own.body], [...Buffer.from(PNG, 'base64')]);
    assert.equal((await call(f, 3, `/api/decks/images/${a.uid}/keep`, { json: {} })).status, 404, 'another founder cannot keep it');
    const kept = await call(f, 2, `/api/decks/images/${a.uid}/keep`, { json: { alt: 'A tidy desk at month end' } });
    assert.equal(kept.status, 200); assert.equal(kept.body.image.state, 'kept'); assert.equal(kept.body.image.alt, 'A tidy desk at month end');
    const anyone = await call(f, null, file(a.uid));
    assert.equal(anyone.status, 200, 'a kept image is in shares and exports');
    assert.equal(anyone.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(anyone.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await call(f, 2, `/api/decks/images/${a.uid}/discard`, { json: {} })).status, 409, 'a kept image stays');
    assert.equal((await call(f, 2, `/api/decks/images/${b.uid}/discard`, { json: {} })).status, 200);
    assert.equal((await call(f, 2, file(b.uid))).status, 404);
    assert.equal((await call(f, 2, `/api/decks/images/${b.uid}/keep`, { json: {} })).status, 409);
    const list = await call(f, 2, '/api/decks/7/images');
    assert.deepEqual(list.body.images.map((x: any) => x.uid), [a.uid], 'the Design list reads kept images');
    assert.deepEqual(f.audits(), ['deck_image_proposed', 'deck_image_kept']);
  } finally { f.close(); }
});

test('"Keep as background" waits until the text reads at 4.5:1', async () => {
  const f = await fixture();
  try {
    const [a] = (await call(f, 2, '/api/decks/7/images', { json: { ...BODY, use: 'card', count: 1 } })).body.images;
    const none = await call(f, 2, `/api/decks/images/${a.uid}/keep`, { json: { use: 'card', overlay: 'none' } });
    assert.equal(none.status, 422); assert.equal(none.body.error, 'contrast_low');
    assert.match(none.body.message, /^The text reads at 1\.04:1 on this overlay\. Choose an overlay that reaches 4\.5:1\.$/);
    assert.equal((await call(f, 2, `/api/decks/images/${a.uid}/keep`, { json: { use: 'deck', overlay: 'strong', ink: '#c4b5fd' } })).status, 422, 'a light ink fails even strong');
    assert.equal(f.rows()[0].state, 'proposed', 'nothing was kept');
    const light = await call(f, 2, `/api/decks/images/${a.uid}/keep`, { json: { use: 'card', overlay: 'light' } });
    assert.equal(light.status, 200); assert.equal(light.body.image.overlay, 'light'); assert.equal(light.body.image.use, 'card');
  } finally { f.close(); }
});

test('an upload showing a person needs that person\'s agreement recorded; the table refuses a row without it', async () => {
  const f = await fixture();
  try {
    const form = (fields: Record<string, string>) => {
      const fd = new FormData();
      fd.append('file', new Blob([Buffer.from(PNG, 'base64')], { type: 'image/png' }), 'team.png');
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      return fd;
    };
    const refused = await call(f, 2, '/api/decks/7/images/upload', { form: form({ use: 'content', shows_person: '1' }) });
    assert.equal(refused.status, 422); assert.equal(refused.body.error, 'person_consent_required');
    assert.equal(f.r2.size, 0, 'nothing was stored');
    const ok = await call(f, 2, '/api/decks/7/images/upload', { form: form({ use: 'content', card: '2', alt: 'The founding team', shows_person: '1', consent: '1' }) });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.image.state, 'kept'); assert.equal(ok.body.image.source, 'upload'); assert.equal(ok.body.image.shows_person, true);
    const [row] = f.rows();
    assert.ok(row.person_consent_at); assert.equal(row.person_consent_by, 2); assert.equal(row.ai_usage_log_id, null); assert.equal(row.charged_microusd, null);
    assert.equal(f.calls.length, 0, 'an upload runs no model');
    const notImage = new FormData(); notImage.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'x.png');
    assert.equal((await call(f, 2, '/api/decks/7/images/upload', { form: notImage })).status, 415);
    assert.throws(() => f.db.prepare("INSERT INTO deck_images(uid,project_id,r2_key,mime,source,use,shows_person) VALUES ('u1',1,'k1','image/png','upload','content',1)").run(), /CHECK/);
    assert.throws(() => f.db.prepare("INSERT INTO deck_images(uid,project_id,r2_key,mime,source,use,shows_person,person_consent_at) VALUES ('u2',1,'k2','image/png','generated','content',1,'now')").run(), /CHECK/, 'a generated image never shows a person');
    assert.deepEqual(f.audits(), ['deck_image_uploaded']);
  } finally { f.close(); }
});

test('only the venture\'s writers ask for images', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, 3, '/api/decks/7/images', { json: BODY })).status, 403);
    assert.equal((await call(f, 6, '/api/decks/7/images/quote', { json: BODY })).status, 403);
    assert.equal((await call(f, 2, '/api/decks/999/images', { json: BODY })).status, 404);
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

// D903 §10 (#3660): the artwork plan is a proposal only, and says when this Worker cannot draw.
test('the image plan: words-only cards, one art direction, nothing run or charged; without the AI binding it proposes nothing', async () => {
  const f = await fixture();
  try {
    f.db.prepare('UPDATE pitch_decks SET slides = ? WHERE id = 7').run(JSON.stringify([
      { spec_id: 'new:title', title: 'Title', blocks: [{ id: 'h', kind: 'text', grid: { c1: 1, c2: 12, r1: 2, r2: 3 }, style: 'heading', text: 'Close the books in a day' }] },
      { spec_id: 'new:traction', title: 'Traction', blocks: [] },
    ]));
    const r = await call(f, 2, '/api/decks/7/images/plan');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.capability.available, true);
    assert.deepEqual(r.body.cards.map((c: any) => c.card), ['title']);
    assert.match(r.body.direction.suffix, /No text, no numbers/);
    assert.deepEqual([f.runs().length, f.holds(), f.rows().length], [0, 0, 0], 'a plan runs, holds and stores nothing');
    assert.equal((await call(f, 3, '/api/decks/7/images/plan')).status, 403, 'another venture');
    delete f.env.AI;
    const off = await call(f, 2, '/api/decks/7/images/plan');
    assert.deepEqual([off.body.capability.available, off.body.cards], [false, []]);
  } finally { f.close(); }
});

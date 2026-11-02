/**
 * D1544 (#3784, deck builder v2 B8): an edit of a deck image is a child image.
 * The mounted Worker routes on the real migrated schema in memory; `env.AI` is
 * a stub, R2 a map, Cloudflare Images a stub that answers a 512 × 384 JPEG,
 * and `fetch` throws.
 *
 *   1. The hold includes the input images: an edit's quote prices the parent it
 *      sends (resized to fit 512 × 512), and an erase's prices its mask too.
 *   2. An edit runs DK5 (FLUX.2 Klein 4B) with the parent as its first
 *      reference, checks the result, and stores a proposed child that names its
 *      parent and its op; the parent row is unchanged.
 *   3. Reverting an edit restores the parent: the child is discarded, the
 *      parent answered as it was, its file still served.
 *   4. No edit to a person without consent: an image that shows a person is
 *      refused before any quote, hold or run; an instruction asking for one too.
 *   5. With the partner switch off DK5 cannot run: an edit runs nothing; a vary
 *      of a drawn image redraws its own description on DK4 without a reference.
 *   6. No Images binding, no resize: 503 with nothing run, unless the parent
 *      already fits.
 *   7. The deck's art direction is inherited by every image request: the
 *      style, the seed family and the note.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckImageEdits from '../src/routes/deck_image_edits.ts';
import deckImages from '../src/routes/deck_images.ts';
import decks from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { FACE_MODEL } from '../src/services/ai/postDraw.ts';
import { PERSON_EDIT_MESSAGE, editAskOf, editPrompt, EditRefusal } from '../src/services/decks/imageEdits.ts';
import { sanitizeArtDirection, artDirectionOfTheme, seedFor } from '../src/services/decks/artDirection.ts';
import { seedOf } from '../src/services/decks/pipelines.ts';
import { sanitizeTheme } from '../src/services/decks/slideModel.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, compareMigrations, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { CONTRACTS } from '../src/contracts/index.ts';
import { contractErrors } from '../src/contracts/validate.ts';

const VARY_SCHEMA = JSON.parse(readFileSync(new URL('../src/contracts/' + CONTRACTS.imageVary.schema, import.meta.url), 'utf8'));

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations)
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const JWT_SECRET = 'synthetic-d1544-only-not-a-real-credential'.repeat(2);
const ORIGIN = 'https://axal.vc';
const SCHNELL = '@cf/black-forest-labs/flux-1-schnell';
const KLEIN4 = '@cf/black-forest-labs/flux-2-klein-4b';
const SCOUT = '@cf/meta/llama-4-scout-17b-16e-instruct';
const FOUNDER = 2, OTHER = 3;
// A 1 × 1 PNG, as FLUX answers.
const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A PNG header that reads as `w` × `h` (the bytes after it are never decoded here). */
function pngOf(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}
/** A JPEG whose frame header reads as `w` × `h`: what the Images stub answers. */
function jpegOf(w: number, h: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const MASK = `data:image/png;base64,${b64(pngOf(512, 384))}`;

const P_DRAWN = '00000000-0000-4000-8000-000000000001';
const P_PERSON = '00000000-0000-4000-8000-000000000002';
const P_SMALL = '00000000-0000-4000-8000-000000000003';
const P_OTHER = '00000000-0000-4000-8000-000000000004';

async function fixture({ partner = true, images = true, theme = null as any, face = 'NO' } = {}) {
  __resetForTest();
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(baseline); for (const sql of migrations) db.exec(sql);
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  insert.run(FOUNDER, 'founder', 100, 'Ada Quill', 'synthetic-2@example.invalid', 'studio');
  insert.run(OTHER, 'founder', 300, 'Synthetic other', 'synthetic-3@example.invalid', 'studio');
  // The founder pays a plan: a partner model (Klein) runs on a paid plan only (C (b)).
  db.prepare(`INSERT INTO member_subscription_amounts(subscription_id, user_id, plan_family, amount_cents, currency, interval, interval_count, status)
    VALUES ('sub_test_d1544', ?, 'founder', 4900, 'usd', 'month', 1, 'active')`).run(FOUNDER);
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Other venture',300)");
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current, theme_json) VALUES (7, 1, 3, ?, 1, ?)')
    .run(JSON.stringify([{ title: 'Solution' }]), theme ? JSON.stringify(theme) : null);
  for (const u of [FOUNDER, OTHER]) db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,?)').run(u, 5_000_000);
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,2)').run(key);
  const r2 = new Map<string, Uint8Array>();
  const img = db.prepare(`INSERT INTO deck_images (id, uid, project_id, deck_id, card, r2_key, mime, width, height, source, prompt, style, aspect, use, state,
      shows_person, person_consent_at, person_consent_by, model) VALUES (?, ?, ?, 7, 0, ?, 'image/png', ?, ?, ?, ?, 'flat', '4:3', 'content', 'kept', ?, ?, ?, ?)`);
  const put = (id: number, uid: string, project: number, w: number, h: number, source: string, prompt: string | null, person: boolean) => {
    const key = `deck-images/${project}/${uid}.png`;
    img.run(id, uid, project, key, w, h, source, prompt, person ? 1 : 0, person ? '2026-11-01 10:00:00' : null, person ? FOUNDER : null, source === 'generated' ? SCHNELL : null);
    r2.set(key, w === 1 ? new Uint8Array(Buffer.from(PNG1, 'base64')) : pngOf(w, h));
  };
  put(1, P_DRAWN, 1, 1024, 768, 'generated', 'A calm month-end close at a tidy desk', false);
  put(2, P_PERSON, 1, 1024, 768, 'upload', null, true);
  put(3, P_SMALL, 1, 1, 1, 'upload', null, false);
  put(4, P_OTHER, 3, 1024, 768, 'generated', 'Another venture\'s picture', false);
  const calls: Array<{ model: string; what: string; input: any }> = [];
  const AI = withGuard({
    run: async (model: string, input: any) => {
      if (model === FACE_MODEL) { calls.push({ model, what: 'face', input }); return { answer: face }; }
      if (model === SCOUT) {
        // D1505 (#3756): a drawn deck image also asks the style check (YES: on the deck's style).
        const text = JSON.stringify(input ?? {});
        const what = /nudity/.test(text) ? 'screen' : /illustration, in /.test(text) ? 'style' : 'alt';
        calls.push({ model, what, input });
        return { response: what === 'screen' ? 'NO' : what === 'style' ? 'YES' : 'A tidy desk at dusk.', usage: { prompt_tokens: 40, completion_tokens: 8 } };
      }
      // D1505: the pipeline's expand run is a text model; an empty rewrite draws the description as written.
      if (!/flux|phoenix|lucid|stable-diffusion/i.test(model)) { calls.push({ model, what: 'expand', input }); return { response: '' }; }
      calls.push({ model, what: 'draw', input });
      return { image: PNG1 };
    },
  });
  const FILES = {
    put: async (key: string, bytes: Uint8Array) => { r2.set(key, new Uint8Array(bytes)); },
    get: async (key: string) => (r2.has(key) ? { body: new Blob([r2.get(key)!]).stream() } : null),
  };
  const resizes: any[] = [];
  const IMAGES = {
    input: (_stream: ReadableStream) => {
      const t: any = {
        transform: (x: any) => { resizes.push(x); return t; },
        output: async (_o: any) => ({ response: () => new Response(jpegOf(512, 384)), contentType: () => 'image/jpeg' }),
      };
      return t;
    },
  };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI, FILES, ...(images ? { IMAGES } : {}), ...(partner ? { AI_PARTNER_MODELS: 'on' } : {}) };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckImageEdits).route('/api/decks', deckImages).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT user_id, task FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  const holds = () => (db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get() as any).n as number;
  const row = (uid: string) => db.prepare('SELECT * FROM deck_images WHERE uid = ?').get(uid) as any;
  const children = () => db.prepare('SELECT * FROM deck_images WHERE parent_uid IS NOT NULL ORDER BY id').all() as any[];
  return { db, env, app, calls, r2, resizes, runs, holds, row, children, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

const token = (who: number) => new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function call(f: F, who: number, path: string, json?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(who)}` };
  if (json !== undefined) headers['content-type'] = 'application/json';
  const res = await f.app.request(ORIGIN + path, { method: json !== undefined ? 'POST' : 'GET', headers, body: json !== undefined ? JSON.stringify(json) : undefined }, f.env);
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: (type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer())) as any };
}
const draws = (f: F) => f.calls.filter((c) => c.what === 'draw');

// ─────────────────────────────────────────────────────────── pure

test('the request: four ops, an edit needs words, an erase a mask, an expand a frame; the prompt keeps the guard', () => {
  assert.ok(editAskOf({ op: 'crop' }) instanceof EditRefusal);
  assert.equal((editAskOf({ op: 'edit' }) as EditRefusal).code, 'invalid_input');
  assert.equal((editAskOf({ op: 'erase' }) as EditRefusal).code, 'invalid_mask');
  assert.equal((editAskOf({ op: 'erase', mask: `data:image/png;base64,${b64(pngOf(1024, 768))}` }) as EditRefusal).code, 'invalid_mask', 'a mask larger than 512 is refused');
  assert.equal((editAskOf({ op: 'expand', aspect: '5:4' }) as EditRefusal).code, 'invalid_input');
  const erase = editAskOf({ op: 'erase', mask: MASK }) as any;
  assert.deepEqual([erase.mask.width, erase.mask.height, erase.mask.mime], [512, 384, 'image/png']);
  assert.match(editPrompt(editAskOf({ op: 'edit', instruction: 'Make the lamp warmer' }) as any, { note: 'Muted watercolour' }),
    /^Make the lamp warmer\. Keep everything else in the first image as it is\. Art direction: Muted watercolour\. No identifiable people, no faces/);
});

test('the deck\'s art direction: a sentence or a checked object; an empty one is not kept; the seed family', () => {
  assert.equal(sanitizeArtDirection('  Warm, quiet light '), 'Warm, quiet light');
  assert.deepEqual(sanitizeArtDirection({ style: 'line', palette: 'neutral', seed_base: 100, reference_uid: P_DRAWN, note: 'Muted', junk: 1 }),
    { style: 'line', palette: 'neutral', seed_base: 100, reference_uid: P_DRAWN, note: 'Muted' });
  assert.deepEqual(sanitizeArtDirection({ style: 'oil', seed_base: -1, reference_uid: 'x' }), null);
  const url = (u: string) => u;
  assert.equal('art_direction' in (sanitizeTheme({ kind: 'neutral_light' }, url as any) ?? {}), false, 'a theme without it hashes as it did');
  assert.deepEqual(artDirectionOfTheme({ art_direction: 'Warm light' }), { note: 'Warm light' });
  assert.deepEqual([seedFor({ seed_base: 100 }, 0), seedFor({ seed_base: 100 }, 1), seedFor({}, 3)], [100, 101, undefined]);
});

// ─────────────────────────────────────────────────────────── 1. the hold includes the input images

test('the hold includes the input images: the parent is resized and priced; an erase prices its mask too', async () => {
  const f = await fixture();
  try {
    const edit = await call(f, FOUNDER, `/api/decks/images/${P_DRAWN}/edit/quote`, { op: 'edit', instruction: 'Make the lamp warmer' });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal(edit.body.ai, true);
    assert.equal(edit.body.model, KLEIN4, 'DK5\'s Default');
    assert.deepEqual(edit.body.references, [{ width: 512, height: 384 }], 'the parent, resized to fit 512 × 512');
    assert.deepEqual(f.resizes, [{ width: 512, height: 512, fit: 'scale-down' }]);
    const erase = await call(f, FOUNDER, `/api/decks/images/${P_DRAWN}/edit/quote`, { op: 'erase', mask: MASK });
    assert.equal(erase.status, 200, JSON.stringify(erase.body));
    assert.deepEqual(erase.body.references, [{ width: 512, height: 384 }, { width: 512, height: 384 }], 'the parent and the mask');
    assert.ok(erase.body.draw_microusd > edit.body.draw_microusd, `an erase's mask is a second input image, held: ${erase.body.draw_microusd} > ${edit.body.draw_microusd}`);
    assert.equal(edit.body.hold_microusd, edit.body.draw_microusd + edit.body.checks_microusd, 'one figure: the edit and its checks');
    assert.equal(f.calls.length, 0, 'a quote runs nothing');
    for (const reply of [edit.body, erase.body]) assert.deepEqual(contractErrors(VARY_SCHEMA, reply), [], 'the adapter\'s imageVary contract (D1511)');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── 2. an edit is a child

test('an edit runs DK5 with the parent as its first reference, is checked, and is stored as a proposed child; the parent is unchanged', async () => {
  const f = await fixture();
  try {
    const before = f.row(P_DRAWN);
    const r = await call(f, FOUNDER, `/api/decks/images/${P_DRAWN}/edit`, { op: 'edit', instruction: 'Make the lamp warmer' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(f.calls.map((c) => c.what), ['draw', 'face', 'screen', 'alt'], 'the edit, then the three checks');
    assert.equal(draws(f)[0].model, KLEIN4);
    assert.equal(r.body.image.parent_uid, P_DRAWN);
    assert.equal(r.body.image.edit_op, 'edit');
    assert.equal(r.body.image.state, 'proposed', 'nothing reaches a card until the founder keeps it');
    assert.equal(r.body.image.alt, 'A tidy desk at dusk.');
    const [child] = f.children();
    assert.deepEqual([child.parent_uid, child.edit_op, child.deck_id, child.card, child.source], [P_DRAWN, 'edit', 7, 0, 'generated']);
    assert.deepEqual(f.row(P_DRAWN), before, 'the parent row is untouched');
    assert.ok(f.r2.has(child.r2_key), 'the child\'s bytes are in R2');
    assert.ok(f.runs().every((x) => x.user_id === FOUNDER));
    // Another venture's founder cannot edit it, and cannot edit their own image through this venture.
    assert.equal((await call(f, OTHER, `/api/decks/images/${P_DRAWN}/edit/quote`, { op: 'vary' })).status, 404);
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── 3. revert restores the parent

test('reverting an edit restores the parent: the child is discarded, the parent answered as it was and still served', async () => {
  const f = await fixture();
  try {
    const before = f.row(P_DRAWN);
    const made = await call(f, FOUNDER, `/api/decks/images/${P_DRAWN}/edit`, { op: 'expand', aspect: '16:9' });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.equal(made.body.image.edit_op, 'expand');
    const back = await call(f, FOUNDER, `/api/decks/images/${made.body.image.uid}/revert`, {});
    assert.equal(back.status, 200, JSON.stringify(back.body));
    assert.equal(back.body.parent.uid, P_DRAWN);
    assert.equal(back.body.discarded, made.body.image.uid);
    assert.equal(f.row(made.body.image.uid).state, 'discarded');
    assert.deepEqual(f.row(P_DRAWN), before, 'the parent is exactly as before the edit');
    const file = await call(f, FOUNDER, `/api/decks/images/${P_DRAWN}/file`);
    assert.equal(file.status, 200, 'the parent\'s file is still served');
    assert.equal((await call(f, FOUNDER, `/api/decks/images/${P_DRAWN}/revert`, {})).body.error, 'not_an_edit', 'an image that is not an edit has nothing to go back to');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── 4. never a person

test('no edit to a person without consent: an image showing a person, or an instruction asking for one, is refused before anything runs', async () => {
  const f = await fixture();
  try {
    for (const op of [{ op: 'vary' }, { op: 'edit', instruction: 'Brighten it' }, { op: 'erase', mask: MASK }, { op: 'expand', aspect: '16:9' }]) {
      for (const path of ['edit/quote', 'edit']) {
        const r = await call(f, FOUNDER, `/api/decks/images/${P_PERSON}/${path}`, op);
        assert.deepEqual([r.status, r.body.error, r.body.message], [422, 'person_edit_refused', PERSON_EDIT_MESSAGE], `${op.op} ${path}`);
      }
    }
    const asked = await call(f, FOUNDER, `/api/decks/images/${P_DRAWN}/edit`, { op: 'edit', instruction: 'Add a portrait of a nurse at the desk' });
    assert.deepEqual([asked.status, asked.body.error], [422, 'real_person']);
    const named = await call(f, FOUNDER, `/api/decks/images/${P_DRAWN}/edit`, { op: 'edit', instruction: 'Put Ada Quill at the desk' });
    assert.deepEqual([named.status, named.body.error], [422, 'real_person'], 'the founder\'s own name is a person');
    assert.deepEqual([f.calls.length, f.holds(), f.children().length], [0, 0, 0], 'nothing ran, nothing was held, nothing stored');
  } finally { f.close(); }
});

test('an edit that comes back showing a face is refused and nothing is stored', async () => {
  const f = await fixture({ face: 'YES' });
  try {
    const r = await call(f, FOUNDER, `/api/decks/images/${P_DRAWN}/edit`, { op: 'vary' });
    assert.deepEqual([r.status, r.body.error], [422, 'real_person']);
    assert.deepEqual(f.calls.map((c) => c.what), ['draw', 'face'], 'nothing runs after the face check');
    assert.deepEqual(f.children(), [], 'no child is stored');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── 5. the gate

test('with the partner switch off DK5 cannot run: an edit runs nothing; a vary of a drawn image redraws its description on DK4', async () => {
  const f = await fixture({ partner: false });
  try {
    const q = await call(f, FOUNDER, `/api/decks/images/${P_DRAWN}/edit/quote`, { op: 'edit', instruction: 'Make the lamp warmer' });
    assert.deepEqual([q.status, q.body.ai, q.body.reason], [200, false, 'model_not_offered']);
    assert.deepEqual(contractErrors(VARY_SCHEMA, q.body), [], 'a refusal matches the contract too');
    const e = await call(f, FOUNDER, `/api/decks/images/${P_DRAWN}/edit`, { op: 'edit', instruction: 'Make the lamp warmer' });
    assert.notEqual(e.status, 200);
    assert.equal(f.calls.length, 0, 'nothing ran');
    const v = await call(f, FOUNDER, `/api/decks/images/${P_DRAWN}/edit`, { op: 'vary' });
    assert.equal(v.status, 200, JSON.stringify(v.body));
    assert.equal(v.body.redraw, true);
    assert.equal(draws(f)[0].model, SCHNELL, 'DK4\'s model');
    assert.match(String(draws(f)[0].input?.prompt ?? ''), /^A calm month-end close at a tidy desk\./, 'the parent\'s own description');
    assert.equal(f.children()[0].edit_op, 'vary');
    // An upload has no description to redraw: its vary needs DK5.
    const up = await call(f, FOUNDER, `/api/decks/images/${P_SMALL}/edit/quote`, { op: 'vary' });
    assert.deepEqual([up.body.ai, up.body.reason], [false, 'model_not_offered']);
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── 6. no resize, no edit

test('no Images binding: an edit of a large image is 503 with nothing run; an image that already fits still edits', async () => {
  const f = await fixture({ images: false });
  try {
    const r = await call(f, FOUNDER, `/api/decks/images/${P_DRAWN}/edit/quote`, { op: 'edit', instruction: 'Make the lamp warmer' });
    assert.deepEqual([r.status, r.body.error], [503, 'resize_unavailable']);
    const small = await call(f, FOUNDER, `/api/decks/images/${P_SMALL}/edit/quote`, { op: 'edit', instruction: 'Make it warmer' });
    assert.equal(small.status, 200, JSON.stringify(small.body));
    assert.deepEqual(small.body.references, [{ width: 1, height: 1 }], 'sent as it is');
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── 7. art direction inherited

test('every image request inherits the deck\'s art direction: its style, its seed family and its note', async () => {
  const f = await fixture({ theme: { kind: 'neutral_light', art_direction: { style: 'line', seed_base: 100, note: 'Muted watercolour' } } });
  try {
    const r = await call(f, FOUNDER, '/api/decks/7/images', { use: 'content', description: 'A calm month-end close at a tidy desk', count: 2, card: 0 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.images.map((i: any) => i.style), ['line', 'line'], 'the request named no style');
    const ds = draws(f);
    // D1505 (#3756): a deck image's seed is hash(seed base, card, area, variant), from the theme's seed_base.
    const rows = f.db.prepare("SELECT seed, card_uid, variant_index FROM deck_images WHERE source = 'generated' AND pipeline_uid IS NOT NULL ORDER BY id").all() as any[];
    assert.deepEqual(ds.map((d) => d.input?.seed), rows.map((r) => seedOf('seed:100', r.card_uid, null, r.variant_index)), 'each image draws with the seed its pipeline records');
    assert.equal(new Set(ds.map((d) => d.input?.seed)).size, 2, 'two images, two seeds');
    assert.ok(ds.every((d) => /Art direction: Muted watercolour\./.test(String(d.input?.prompt ?? ''))));
    const own = await call(f, FOUNDER, '/api/decks/7/images', { use: 'content', description: 'A calm month-end close at a tidy desk', count: 1, card: 0, style: 'flat' });
    assert.equal(own.body.images[0].style, 'flat', 'a request\'s own style wins');
  } finally { f.close(); }
});

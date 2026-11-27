/**
 * D1505 (#3756, deck v2 A12): the deck image pipeline. Synthetic data, the
 * mounted Worker routes and the real migrated schema in memory; `env.AI` is
 * the pipeline stub in `_pipeline_ai.ts`, R2 is a map and `fetch` throws.
 *
 *   · a picture with text, a face or a flagged screen is refused, kept as a
 *     discarded row with its checks' answers, and settles at zero;
 *   · a check that cannot run refuses the image: the pipeline fails closed;
 *   · every structure's every area, on every model that takes a size, is
 *     drawn at a size it upscales from by at most 1.25×;
 *   · the seed reproduces: the same deck, card, area and variant draw the
 *     same seed, and the deck's seed base is written once;
 *   · the stored file names itself machine-made (XMP DigitalSourceType), and
 *     the packet survives R2;
 *   · the one-click run's image step is the same pipeline under its parent
 *     hold: a refused image is redrawn once, then left out, never unchecked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckImages from '../src/routes/deck_images.ts';
import { __resetForTest, type RunOptions, type RunResult } from '../src/services/aiRouter.ts';
import {
  AI_SOURCE_TYPE, aiXmpPacket, withXmp, xmpOf,
} from '../src/services/decks/imageBytes.ts';
import {
  TEXT_IN_IMAGE_MESSAGE, UPSCALE_MAX, promptFrom, runPipeline, seedOf, sizeFor, type PipelineInput,
} from '../src/services/decks/pipelines.ts';
import { STRUCTURES, ASPECTS, boxOfAt } from '../src/services/decks/structures.ts';
import { IMAGE_SPECS, MIN_SIDE_PX } from '../src/services/ai/shapes.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { stepExecutor } from '../src/services/decks/stepExecutor.ts';
import { stepRecordRef } from '../src/services/decks/genRuntime.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { PIPELINE_PNG, pipelineAI, type PipelineAnswers } from './_pipeline_ai.ts';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'synthetic-d1505-only-not-a-real-credential'.repeat(2);
const ORIGIN = 'https://axal.vc';
const BODY = { use: 'content', description: 'A calm month-end close at a tidy desk', style: 'flat', palette: 'brand', aspect: '4:3', count: 1, card: 0 };

async function fixture(answers: PipelineAnswers = {}) {
  __resetForTest();
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.prepare("INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (2, 'founder', 100, 'Synthetic founder', 'synthetic-2@example.invalid', 1, 'studio')").run();
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100)");
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (7, 1, 3, ?, 1)').run(JSON.stringify([{ title: 'Solution' }]));
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2, 5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,2)').run(key);
  const ai = pipelineAI(answers);
  const r2 = new Map<string, Uint8Array>();
  const FILES = {
    put: async (key: string, bytes: Uint8Array) => { r2.set(key, new Uint8Array(bytes)); },
    get: async (key: string) => (r2.has(key) ? { body: new Blob([r2.get(key)!]).stream() } : null),
  };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI: withGuard({ run: ai.run }), FILES };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckImages);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const charged = (uid: string) => (db.prepare("SELECT COALESCE(SUM(charged_microusd), 0) AS n FROM ai_usage_logs WHERE record_ref = ? AND guard_for IS NULL AND task <> 'safety'").get(`deckimg:${uid}`) as any).n as number;
  const balance = () => (db.prepare('SELECT balance_microusd AS n FROM ai_topup_accounts WHERE user_id = 2').get() as any).n as number;
  const rows = () => db.prepare('SELECT * FROM deck_images ORDER BY id').all() as any[];
  const audits = () => (db.prepare("SELECT action FROM activity_logs WHERE entity_type = 'raise.pitch-deck' ORDER BY id").all() as any[]).map((r) => r.action);
  return { db, env, app, ai, r2, charged, balance, rows, audits, close };
}

const token = () => new SignJWT({ user_id: 2 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function press(f: Awaited<ReturnType<typeof fixture>>, body: unknown = BODY) {
  const res = await f.app.request(ORIGIN + '/api/decks/7/images', { method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, f.env);
  return { status: res.status, body: await res.json() as any };
}

// ─────────────────────────────────────────────────────────── refused, at zero

for (const [label, answers, code] of [
  ['text in the picture', { text: 'YES' }, 'text_in_image'],
  ['a face', { face: 'YES' }, 'real_person'],
  ['a logo or anything the screen flags', { screen: 'YES' }, 'image_blocked'],
] as const) {
  test(`${label} is refused, kept as discarded with its checks' answers, and settles at zero`, async () => {
    const f = await fixture(answers);
    try {
      const before = f.balance();
      const r = await press(f);
      assert.equal(r.status, 422, JSON.stringify(r.body));
      assert.equal(r.body.images, undefined, 'nothing is proposed');
      assert.equal(r.body.error, code, 'the press answers as the refused card, in its words');
      assert.equal(r.body.charged_microusd, 0);
      assert.equal(r.body.refused.length, 1);
      const [no] = r.body.refused;
      assert.equal(no.code, code);
      assert.equal(no.charged_microusd, 0);
      assert.equal(no.redraw, true, 'the press offers one redraw');
      if (code === 'text_in_image') assert.equal(r.body.message, TEXT_IN_IMAGE_MESSAGE, 'pd15: "Not used: … You were not charged for it."');
      assert.ok(no.steps.every((s: any) => s.charged_microusd === 0), 'every step line reads zero');
      assert.equal(f.charged(no.pipeline_uid), 0, 'every run of the refused pipeline settled at zero');
      assert.equal(f.balance(), before, 'the member paid nothing for it');
      const [row] = f.rows();
      assert.equal(row.state, 'discarded');
      assert.ok(row.r2_key.startsWith('refused/1/'), 'the refused bytes are never stored');
      assert.equal(f.r2.size, 0);
      assert.equal(JSON.parse(row.qa_json).code, code, 'the discarded row keeps why');
      assert.ok(f.audits().includes('deck_image_refused_zero'), 'the zeroing is audited');
      assert.equal(f.ai.calls.filter((c) => c.step === 'alt').length, 0, 'nothing after the refusing check ran');
    } finally { f.close(); }
  });
}

test('a check that cannot run refuses the image: the pipeline fails closed', async () => {
  for (const step of ['face', 'text', 'screen', 'style'] as const) {
    const f = await fixture({ [step]: 'throw' });
    try {
      const r = await press(f);
      assert.equal(r.status, 422, JSON.stringify(r.body));
      assert.equal(r.body.images, undefined, `${step}: an image whose check errored is never proposed`);
      assert.equal(r.body.refused[0].code, 'check_unavailable', step);
      assert.equal(f.charged(r.body.refused[0].pipeline_uid), 0, `${step}: and costs nothing`);
    } finally { f.close(); }
  }
});

test('an answer that is neither YES nor NO is not a pass either', async () => {
  const f = await fixture({ text: 'maybe' });
  try {
    const r = await press(f);
    assert.equal(r.status, 422);
    assert.equal(r.body.error, 'check_unavailable');
  } finally { f.close(); }
});

test('a passed image is proposed with its steps, seed, prompt hash, QA and provenance', async () => {
  const f = await fixture();
  try {
    const r = await press(f);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [img] = r.body.images;
    assert.deepEqual(img.steps.map((s: any) => [s.step, s.status]),
      [['expand', 'done'], ['draw', 'done'], ['check', 'done'], ['style', 'done'], ['alt', 'done'], ['provenance', 'done']]);
    assert.equal(img.alt, 'A tidy desk at month end in soft light.');
    const [row] = f.rows();
    assert.equal(row.state, 'proposed');
    assert.match(row.prompt_sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(JSON.parse(row.qa_json), { face: false, text: false, screen: false, on_style: true });
    assert.equal(row.charged_microusd, f.charged(row.pipeline_uid), 'the row keeps the whole pipeline\'s charge');
    assert.ok(row.charged_microusd > 0);
    const prov = JSON.parse(row.provenance_json);
    assert.equal(prov.seed, row.seed);
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── the pipeline, alone

function input(): PipelineInput {
  return {
    userId: 2, surface: '/raise/pitch', rail: { page: 'founder · raise · pitch deck', option: 'deck:image' } as any,
    base: 'A desk.', draw: { task: 'deck_image', userId: 2, text: 'A desk.' } as RunOptions,
    size: { width: 1024, height: 768 }, seed: 7, art: { style: 'flat', palette: 'brand', colours: ['#0f2a3d'] },
  };
}
const ok = (output: string): RunResult => ({ ok: true, output, usageLogId: 1 } as any);

test('mutation guard: letting the image through when a check errors turns this red', async () => {
  // The pipeline is driven directly, so a change to its fail-closed rule — an
  // errored check read as "no" — is caught here, not only by the route.
  const runs: RunOptions[] = [];
  const res = await runPipeline(input(), {
    run: async (o) => {
      runs.push(o);
      if (o.task === 'deck_image') return { ok: true, image: { bytes: new Uint8Array([1]), mime: 'image/png', width: 1, height: 1 }, usageLogId: 2 } as any;
      if (/written text/.test(String(o.text))) return { ok: false, error: 'synthetic outage' } as any;
      return ok('NO');
    },
    quoteRun: async () => ({ ok: true, hold_microusd: 1 } as any),
    charged: async () => 1,
  });
  assert.equal(res.ok, false);
  assert.equal((res as any).code, 'check_unavailable');
  assert.ok(!runs.some((o) => o.task === 'image_alt_text'), 'no step after the failed check ran');
});

test('the draw carries the seed and the size, and an expansion that names a number is not used', async () => {
  const seen: RunOptions[] = [];
  await runPipeline(input(), {
    run: async (o) => { seen.push(o); return o.task === 'deck_image' ? { ok: true, image: { bytes: new Uint8Array([1]), mime: 'image/png', width: 1, height: 1 }, usageLogId: 2 } as any : ok('NO'); },
    quoteRun: async () => ({ ok: true } as any), charged: async () => 0,
  });
  const draw = seen.find((o) => o.task === 'deck_image')!;
  assert.deepEqual(draw.draw, { width: 1024, height: 768, seed: 7 });
  assert.equal(promptFrom('A desk.', 'A desk with 3 lamps').expanded, false);
  assert.equal(promptFrom('A desk.', 'A desk with ٣ lamps').expanded, false, 'a digit in any script');
  assert.equal(promptFrom('A desk.', 'A desk with lamps').expanded, true);
});

// ─────────────────────────────────────────────────────────── size and seed

test('every structure\'s every area, on every model that takes a size, upscales by at most 1.25×', () => {
  const sized = Object.entries(IMAGE_SPECS).filter(([, s]) => s.maxSide != null).map(([m]) => m);
  assert.ok(sized.length >= 4, 'the sized models were found');
  let checked = 0;
  for (const s of STRUCTURES) {
    for (const a of s.areas) {
      for (const aspect of ASPECTS) {
        const box = boxOfAt(a, aspect);
        for (const model of sized) {
          const size = sizeFor(model, aspect, box)!;
          assert.ok(size.width % 16 === 0 && size.height % 16 === 0, `${model} ${s.id}/${a.id}: on the 16-pixel grid`);
          assert.ok(size.width >= MIN_SIDE_PX || size.width * UPSCALE_MAX >= box.w, `${model}: at least the minimum`);
          assert.ok(Math.max(size.width, size.height) <= IMAGE_SPECS[model].maxSide!, `${model} ${s.id}/${a.id}: within the model's side`);
          assert.ok(box.w / size.width <= UPSCALE_MAX + 1e-9 && box.h / size.height <= UPSCALE_MAX + 1e-9,
            `${model} ${s.id}/${a.id} at ${aspect}: ${box.w}×${box.h} from ${size.width}×${size.height} upscales more than 1.25×`);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 100, `only ${checked} cases`);
  assert.equal(sizeFor('@cf/black-forest-labs/flux-1-schnell', '16:9', { w: 1920, h: 1080 }), null, 'Schnell takes no size');
});

test('the seed reproduces: the same deck, card, area and variant draw the same seed', async () => {
  assert.equal(seedOf('base', 'card-1', 'a1', 0), seedOf('base', 'card-1', 'a1', 0));
  assert.notEqual(seedOf('base', 'card-1', 'a1', 0), seedOf('base', 'card-1', 'a1', 1), 'a variant is a new seed');
  assert.notEqual(seedOf('base', 'card-1', 'a1', 0), seedOf('other', 'card-1', 'a1', 0), 'another deck is a new seed');
  assert.ok(Number.isInteger(seedOf('base', null, null, 0)) && seedOf('base', null, null, 0) >= 0);
  const f = await fixture();
  try {
    await press(f); await press(f);
    const [a, b] = f.rows();
    assert.deepEqual([a.variant_index, b.variant_index], [0, 1], 'a second press is the next variant: "draw one more" is not the same picture');
    assert.notEqual(a.seed, b.seed);
    for (const row of [a, b]) {
      // No seed base on the theme: the venture's own id is the base, so nothing is stored a second time.
      assert.equal(row.seed, seedOf('venture:1', row.card_uid, null, row.variant_index), 'each row\'s seed is hash(seed base, card, area, its variant)');
    }
    // D1544's art direction keeps a seed base on the theme: every seed starts from it.
    f.db.prepare('UPDATE pitch_decks SET theme_json = ? WHERE id = 7').run(JSON.stringify({ kind: 'neutral_light', art_direction: { seed_base: 42, style: 'flat' } }));
    await press(f);
    const c = f.rows()[2];
    assert.equal(c.seed, seedOf('seed:42', c.card_uid, null, c.variant_index), 'the theme\'s seed base');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── provenance (V = A)

test('the stored file names itself machine-made, and the packet survives R2', async () => {
  const png = Uint8Array.from(Buffer.from(PIPELINE_PNG, 'base64'));
  const packet = aiXmpPacket('@cf/black-forest-labs/flux-1-schnell');
  const tagged = withXmp(png, 'image/png', packet)!;
  assert.ok(xmpOf(tagged)!.includes(AI_SOURCE_TYPE));
  assert.match(xmpOf(tagged)!, /flux-1-schnell/);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
  assert.ok(xmpOf(withXmp(jpeg, 'image/jpeg', packet)!)!.includes(AI_SOURCE_TYPE), 'a JPEG carries it too (APP1)');
  assert.equal(xmpOf(png), null, 'an untagged file has none');
  const f = await fixture();
  try {
    await press(f);
    const [row] = f.rows();
    const stored = f.r2.get(row.r2_key)!;
    assert.ok(xmpOf(stored)!.includes(AI_SOURCE_TYPE), 'what R2 holds says trainedAlgorithmicMedia');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── the one-click run's image step

test('the one-click run\'s image step runs the pipeline under its parent hold: one redraw, then left out', async () => {
  const f = await fixture();
  try {
    const governor = { acquire: async () => ({ ok: true, lease: { id: 'lease-1' } } as any), release: async () => {} };
    const drive = (textAnswers: string[]) => {
      const seen: RunOptions[] = [];
      let texts = 0;
      const x = stepExecutor(f.env, {
        governor, sleep: async () => {},
        run: (async (_e: any, o: RunOptions) => {
          seen.push(o);
          if (o.task === 'deck_image') return { ok: true, image: { bytes: Uint8Array.from(Buffer.from(PIPELINE_PNG, 'base64')), mime: 'image/png', width: 1, height: 1 }, usageLogId: null, usage: { model: '@cf/black-forest-labs/flux-1-schnell' } };
          if (/written text/.test(String(o.text))) return ok(textAnswers[texts++] ?? 'NO');
          if (/illustration, in /.test(String(o.text))) return ok('YES');
          if (o.task === 'image_alt_text') return ok('A desk.');
          return ok('NO');
        }) as any,
      });
      const step: any = { batch_uid: '00000000-0000-4000-8000-0000000000aa', seq: 3, card_uid: 'card-9', area_id: 'a1', element: 'image', kind: 'image', task: 'deck_image', model: null, input: JSON.stringify({ text: 'A calm desk.' }) };
      const ctx: any = { batch: { created_by: 2, uid: 'r', project_id: 1 }, parentHold: { uid: 'hold-1505', userId: 2 } };
      return { go: () => x(step, ctx), seen };
    };
    const once = drive(['YES', 'NO']);
    const r = await once.go();
    assert.equal(r.ok, true, JSON.stringify(r));
    const v: any = r.variant;
    assert.equal(v.variant_index, 1, 'the refused first draw was redrawn at the next variant');
    assert.equal(v.refused.length, 1); assert.equal(v.refused[0].code, 'text_in_image');
    assert.ok(once.seen.every((o) => o.parentHold?.uid === 'hold-1505'), 'every run is under the parent hold');
    assert.ok(once.seen.every((o) => o.rail?.record === stepRecordRef('00000000-0000-4000-8000-0000000000aa', 3)), 'and names the step');
    assert.equal(new Set(once.seen.map((o) => o.idempotencyKey)).size, once.seen.length, 'each run its own idempotency key');
    const twice = drive(['YES', 'YES']);
    const no = await twice.go();
    assert.equal(no.ok, false, 'a second refusal leaves the area out');
    assert.equal(no.error_code, 'text_in_image');
    assert.equal(twice.seen.filter((o) => o.task === 'deck_image').length, 2, 'one redraw, not more');
    assert.equal(twice.seen.filter((o) => o.task === 'image_alt_text').length, 0, 'nothing unchecked was described or placed');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── D1512: a run's image is a stored proposal

test('D1512: an area run\'s image step keeps what it drew as a proposed deck image, at the variant\'s own seeds, and returns no bytes', async () => {
  // Mutation checked: return the raw image in the step's variant → the JSON check fails; ignore `variant` → the seed pair is 0/1 and this fails.
  const f = await fixture();
  try {
    const governor = { acquire: async () => ({ ok: true, lease: { id: 'lease-1512' } } as any), release: async () => {} };
    const x = stepExecutor(f.env, {
      governor, sleep: async () => {},
      run: (async (_e: any, o: RunOptions) => {
        if (o.task === 'deck_image') return { ok: true, image: { bytes: Uint8Array.from(Buffer.from(PIPELINE_PNG, 'base64')), mime: 'image/png', width: 1, height: 1 }, usageLogId: null, usage: { model: '@cf/black-forest-labs/flux-1-schnell' } };
        if (/illustration, in /.test(String(o.text))) return ok('YES');
        if (o.task === 'image_alt_text') return ok('A desk.');
        return ok('NO');
      }) as any,
    });
    const step: any = {
      batch_uid: '00000000-0000-4000-8000-0000000015aa', seq: 1, card_uid: 'card-9', area_id: 'a1', element: 'illustration', kind: 'image', task: 'deck_image', model: null,
      input: JSON.stringify({ text: 'A calm desk.', variant: 1, store: { card: 0, ask: { description: 'A calm desk', style: 'flat', aspect: '16:9', use: 'content' } } }),
    };
    const r = await x(step, { batch: { created_by: 2, uid: 'r', project_id: 1, deck_id: null }, parentHold: { uid: 'hold-1512', userId: 2 } } as any);
    assert.equal(r.ok, true, JSON.stringify(r));
    const v: any = r.variant;
    assert.equal(v.variant_index, 2, 'variant 1 draws at seeds 2 and 3');
    assert.ok(v.image?.uid && v.image.url === `/api/decks/images/${v.image.uid}/file`, 'the stored proposal is named');
    assert.ok(JSON.stringify(v).length < 4000, 'no bytes ride in the run\'s result');
    const row = f.rows().find((x: any) => x.uid === v.image.uid) as any;
    assert.deepEqual([row.state, row.use, row.variant_index, row.card_uid], ['proposed', 'content', 2, 'card-9']);
    assert.ok(f.r2.get(row.r2_key), 'the bytes are in R2');
    // A step that asks for no store still returns no bytes: its image is null, never the drawn image.
    const bare = await x({ ...step, seq: 2, input: JSON.stringify({ text: 'A calm desk.' }) }, { batch: { created_by: 2, uid: 'r', project_id: 1, deck_id: null }, parentHold: { uid: 'hold-1512', userId: 2 } } as any);
    assert.equal(bare.ok, true);
    assert.equal((bare.variant as any).image, null);
    assert.ok(JSON.stringify(bare.variant).length < 4000);
  } finally { f.close(); }
});

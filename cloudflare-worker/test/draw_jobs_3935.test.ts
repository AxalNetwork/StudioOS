/**
 * #3935 (D1478 task 1, part 1): the draw jobs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/draw_jobs_3935.test.ts
 *
 * - `drawRequest` sends a true size for an aspect ratio to a model that takes a size;
 * - `imageUnits` prices reference images in each model's input unit;
 * - `drawChoice` runs each job's Default with the gate on and its fallback with the gate off;
 * - the plan lock refuses a named or stored model, and the fallback's receipt says why;
 * - the post-draw chain withholds a face with `REAL_PERSON_MESSAGE`, in one quote;
 * - no image option lists a reader.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ASPECTS, aspectSize, drawRefusal, drawRequest, imageUnits, type DrawReference } from '../src/services/ai/shapes.ts';
import { DRAW_JOBS, DRAW_JOB_STEPS, drawChoice, lockAllows } from '../src/services/ai/drawJobs.ts';
import { LEGAL_HOLD, MODEL_LOCKS, jobStep } from '../src/services/ai/modelUseCases.ts';
import { DRAW_PAGES, MODEL_CONNECTIONS, connectionOnPage, withModuleModels } from '../src/services/ai/moduleConnections.ts';
import { railOptionRows } from '../src/services/ai/railMatrix.ts';
import { quoteRun, estimateCostUsd } from '../src/services/aiRouter.ts';
import { REAL_PERSON_MESSAGE } from '../src/services/aiImages.ts';
import { CHECK_UNAVAILABLE_MESSAGE, FACE_MODEL, SCREEN_BLOCKED_MESSAGE, drawPressQuote, postDrawCheck, postDrawQuote } from '../src/services/ai/postDraw.ts';

const SCHNELL = '@cf/black-forest-labs/flux-1-schnell';
const KLEIN4 = '@cf/black-forest-labs/flux-2-klein-4b';
const KLEIN9 = '@cf/black-forest-labs/flux-2-klein-9b';
const DEV = '@cf/black-forest-labs/flux-2-dev';
const LUCID = '@cf/leonardo/lucid-origin';
const ON = { AI_PARTNER_MODELS: 'on' };
const OFF = {};
const NONE = new Set<string>();
const ref = (w = 512, h = 512): DrawReference => ({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', width: w, height: h });

// 1 ── sizes ──────────────────────────────────────────────────────────────────
test('drawRequest: an aspect ratio is a true size on Klein and dev, the caller\'s size wins, and Schnell takes none', () => {
  assert.deepEqual(aspectSize('16:9'), { width: 1024, height: 576 });
  assert.deepEqual(aspectSize('3:4'), { width: 768, height: 1024 });
  assert.deepEqual(aspectSize('1:1'), { width: 1024, height: 1024 });
  for (const a of ASPECTS) {
    const s = aspectSize(a);
    assert.equal(s.width % 16, 0, a); assert.equal(s.height % 16, 0, a);
    assert.equal(Math.max(s.width, s.height), 1024, a);
  }
  for (const m of [KLEIN4, KLEIN9, DEV]) {
    const r = drawRequest(m, 'a harbour at dawn', { aspect: '16:9' })!;
    assert.deepEqual([r.fields.width, r.fields.height], [1024, 576], m);
    assert.deepEqual([r.sent.width, r.sent.height], [1024, 576], m);
    const own = drawRequest(m, 'x', { aspect: '16:9', width: 800, height: 800 })!;
    assert.deepEqual([own.sent.width, own.sent.height], [800, 800], `${m}: a size given wins over the ratio`);
    const plain = drawRequest(m, 'x', {})!;
    assert.deepEqual([plain.sent.width, plain.sent.height], [1024, 768], `${m}: no ratio keeps the model's default`);
  }
  const s = drawRequest(SCHNELL, 'x', { aspect: '16:9' })!;
  assert.equal('width' in s.fields, false, 'Schnell is sent no size');
  assert.equal(drawRefusal({ aspect: '5:4' as any }, 'x'), `the aspect is one of ${ASPECTS.join(', ')}`);
});

// 2 ── references ─────────────────────────────────────────────────────────────
test('imageUnits: each reference adds its model\'s input unit, and a model that takes none is sent none', () => {
  const two = [ref(), ref(256, 256)];
  assert.deepEqual(imageUnits(KLEIN4, 1024, 576, 4, two), { output_tiles: 4, input_tiles: 2 });
  assert.deepEqual(imageUnits(KLEIN4, 1024, 576, 4), { output_tiles: 4 }, 'no reference, no input unit');
  assert.deepEqual(imageUnits(DEV, 1024, 1024, 25, two), { output_tile_steps: 100, input_tile_steps: 50 });
  assert.deepEqual(imageUnits(KLEIN9, 1024, 1024, 4, two), { first_megapixels: 1, subsequent_megapixels: 1, input_image_megapixels: 1 });
  assert.deepEqual(imageUnits(SCHNELL, 1024, 1024, 4, two), { tiles: 4, steps: 4 }, 'Schnell has no input unit');
  // The price moves with the references, at the catalogue's input rate.
  const bare = estimateCostUsd(KLEIN4, 0, 0, 0, 0, 0, imageUnits(KLEIN4, 1024, 576, 4));
  const withRefs = estimateCostUsd(KLEIN4, 0, 0, 0, 0, 0, imageUnits(KLEIN4, 1024, 576, 4, two));
  assert.ok(withRefs > bare, 'two references cost more than none');
  // The wire: each reference under its own name; a model that takes none draws nothing.
  const r = drawRequest(KLEIN4, 'restyle', { references: two })!;
  assert.deepEqual(r.files.map((f) => f.name), ['input_image_0', 'input_image_1']);
  assert.deepEqual(r.sent.references, [{ width: 512, height: 512 }, { width: 256, height: 256 }]);
  assert.equal(drawRequest(SCHNELL, 'restyle', { references: [ref()] }), null);
  assert.equal(drawRequest(DEV, 'restyle', { references: [ref(), ref(), ref(), ref()] }), null, 'dev takes three');
  assert.equal(drawRefusal({ references: [ref(), ref(), ref(), ref(), ref()] }, 'x'), 'at most 4 reference images');
  assert.equal(drawRefusal({ references: [ref(600, 400)] }, 'x'), 'a reference image is at most 512 by 512');
});

// 3 ── the gate ───────────────────────────────────────────────────────────────
test('every draw job runs its Default with the gate on and its fallback with the gate off', () => {
  assert.equal(DRAW_JOBS.length, Object.keys(DRAW_JOB_STEPS).length, 'every job step exists in the table');
  for (const job of DRAW_JOBS) {
    assert.ok(job.kind === 'draw' || job.kind === 'edit_image', `${job.id} draws`);
    // Legal cleared (an empty hold) and a paid plan: the Default runs.
    const on = drawChoice(job.id, { switches: ON, tier: 'paid', held: NONE });
    assert.ok(on.ok && on.model === job.default && on.source === 'default', `${job.id}: ${JSON.stringify(on)}`);
    // The gate off: every Default here is a partner model, so the fallback runs, or the press is hidden.
    const off = drawChoice(job.id, { switches: OFF, tier: 'paid', held: NONE });
    if (job.fallback) {
      assert.ok(off.ok && off.model === job.fallback && off.source === 'fallback', `${job.id}: ${JSON.stringify(off)}`);
      assert.deepEqual(off.ok && off.skipped, { model: job.default, reason: 'not_offered' }, 'the receipt says why');
    } else {
      assert.ok(!off.ok && off.code === 'press_hidden', `${job.id} has no fallback`);
    }
  }
});

test('while Legal holds them, only Schnell and Klein 4B ever run', () => {
  for (const job of DRAW_JOBS) {
    for (const tier of ['free', 'paid'] as const) {
      for (const switches of [ON, OFF]) {
        const c = drawChoice(job.id, { switches, tier });
        if (c.ok) assert.ok([SCHNELL, KLEIN4].includes(c.model), `${job.id} ran ${c.model}`);
      }
    }
  }
  // The deck's images: Klein 9B is held, so the fallback runs and the receipt says so.
  const dk4 = drawChoice('DK4', { switches: ON, tier: 'paid' });
  assert.deepEqual(dk4, { ok: true, model: SCHNELL, source: 'fallback', job: 'DK4', skipped: { model: KLEIN9, reason: 'legal_hold' } });
  // The course cover's Default is Klein 4B, which Legal has not held.
  assert.deepEqual(drawChoice('LE8', { switches: ON, tier: 'paid' }), { ok: true, model: KLEIN4, source: 'default', job: 'LE8', skipped: null });
  // A caller who names a held model is refused, never given another.
  const held = drawChoice('DK4', { switches: ON, tier: 'paid', caller: KLEIN9 });
  assert.ok(!held.ok && held.code === 'model_not_offered');
  assert.ok(LEGAL_HOLD.has(LUCID) && LEGAL_HOLD.has(DEV));
});

// 4 ── the plan lock ──────────────────────────────────────────────────────────
test('the plan lock: a named or stored model the plan does not run is refused in the plan\'s words; the automatic choice falls back', () => {
  assert.equal(MODEL_LOCKS[KLEIN4], 'lowest_paid');
  assert.equal(lockAllows('lowest_paid', 'free'), false);
  assert.equal(lockAllows('lowest_paid', 'paid'), true);
  assert.equal(lockAllows('top_paid', 'paid'), false, 'no top-plan signal yet: locked');
  assert.equal(lockAllows('all', 'free'), true);
  const named = drawChoice('LE8', { switches: ON, tier: 'free', caller: KLEIN4 });
  assert.deepEqual(named, { ok: false, code: 'plan_locked', model: KLEIN4, label: 'Paid plans', message: 'This model is on Paid plans. Pick another model, or change your plan.' });
  const stored = drawChoice('LE8', { switches: ON, tier: 'free', pick: KLEIN4 });
  assert.ok(!stored.ok && stored.code === 'plan_locked', 'a stored pick is not swapped either');
  // No pick: the Default is locked, so the fallback runs and the receipt names why.
  assert.deepEqual(drawChoice('LE8', { switches: ON, tier: 'free' }),
    { ok: true, model: SCHNELL, source: 'fallback', job: 'LE8', skipped: { model: KLEIN4, reason: 'plan_locked' } });
  // A paid member's pick runs; a model outside the job is refused.
  assert.deepEqual(drawChoice('LE8', { switches: ON, tier: 'paid', pick: SCHNELL }), { ok: true, model: SCHNELL, source: 'pick', job: 'LE8', skipped: null });
  const outside = drawChoice('LE8', { switches: ON, tier: 'paid', caller: '@cf/meta/llama-4-scout-17b-16e-instruct' });
  assert.ok(!outside.ok && outside.code === 'model_not_offered');
  // A press takes what its selector shows: the logo lists Klein 4B (the draw kind's list), so a paid member may pick it.
  assert.deepEqual(drawChoice('GR3', { switches: ON, tier: 'paid', caller: KLEIN4 }), { ok: true, model: KLEIN4, source: 'caller', job: 'GR3', skipped: null });
  // The edit job has no fallback: on the free plan its press is hidden.
  assert.ok(!drawChoice('DK5', { switches: ON, tier: 'free' }).ok);
});

test('the router: a draw job\'s quote names the model that will run and the receipt carries why', async () => {
  const env = { AI_PARTNER_MODELS: 'on' } as any;
  const q = await quoteRun(env, { task: 'deck_image', drawJob: 'DK4', userId: 0, text: 'a harbour at dawn', draw: {} });
  assert.ok(q.ok, JSON.stringify(q));
  assert.equal(q.model, SCHNELL);
  assert.deepEqual(q.draw, { job: 'DK4', source: 'fallback', skipped: { model: KLEIN9, reason: 'legal_hold' } });
  // A system run is on no plan: Klein 4B is locked, so the course cover falls back too.
  const le8 = await quoteRun(env, { task: 'deck_image', drawJob: 'LE8', userId: 0, text: 'a course cover', draw: { aspect: '16:9' } });
  assert.ok(le8.ok && le8.model === SCHNELL && le8.draw?.skipped?.reason === 'plan_locked', JSON.stringify(le8));
  const locked = await quoteRun(env, { task: 'deck_image', drawJob: 'LE8', userId: 0, model: KLEIN4, text: 'x', draw: {} });
  assert.deepEqual(locked.ok ? null : locked.refusal, 'plan_locked');
});

// 5 ── the post-draw chain ────────────────────────────────────────────────────
const stubRun = (answers: Record<string, any>) => {
  const calls: any[] = [];
  return {
    calls,
    run: async (_env: any, opts: any) => {
      calls.push(opts);
      const a = answers[opts.task];
      return a === 'fail' ? { ok: false, refusal: 'all_models_failed', error: 'down', usage: {} } : { ok: true, output: a, usage: {}, usageLogId: calls.length };
    },
    quoteRun: async (_env: any, opts: any) => ({ ok: true, hold_microusd: { module_vision: 300, image_screen: 200, image_alt_text: 400, deck_image: 1000 }[opts.task as string] ?? 0, model: opts.model ?? 'm' }),
  } as any;
};
const IMG = 'data:image/png;base64,AAAA';
const BASE = { userId: 2, surface: '/events' };

test('the post-draw chain: a face is withheld with REAL_PERSON_MESSAGE before the screen runs', async () => {
  const d = stubRun({ module_vision: 'Yes.', image_screen: 'NO', image_alt_text: 'A person.' });
  const r = await postDrawCheck({} as any, IMG, BASE, d);
  assert.deepEqual(r, { ok: false, code: 'real_person', message: REAL_PERSON_MESSAGE, usage_log_ids: [1] });
  assert.deepEqual(d.calls.map((c: any) => [c.task, c.model ?? null]), [['module_vision', FACE_MODEL]], 'Moondream asked, nothing after');
  assert.equal(d.calls[0].userId, 2, 'charged to the member who pressed');
});

test('the post-draw chain: no face, a clean screen, then the alt text; a flagged screen or a check that cannot run withholds', async () => {
  const clean = stubRun({ module_vision: 'no', image_screen: 'No', image_alt_text: '  A lighthouse on a cliff at dawn.  ' });
  assert.deepEqual(await postDrawCheck({} as any, IMG, BASE, clean),
    { ok: true, alt: 'A lighthouse on a cliff at dawn.', alt_reason: null, usage_log_ids: [1, 2, 3] });
  assert.deepEqual(clean.calls.map((c: any) => c.task), ['module_vision', 'image_screen', 'image_alt_text']);
  const flagged = stubRun({ module_vision: 'no', image_screen: 'YES' });
  assert.deepEqual(await postDrawCheck({} as any, IMG, BASE, flagged), { ok: false, code: 'image_blocked', message: SCREEN_BLOCKED_MESSAGE, usage_log_ids: [1, 2] });
  // A face check that cannot run, or answers neither yes nor no, withholds the image on its own: nothing after it runs.
  for (const face of ['fail', 'maybe']) {
    const d = stubRun({ module_vision: face, image_screen: 'no', image_alt_text: 'A harbour.' });
    const r = await postDrawCheck({} as any, IMG, BASE, d);
    assert.ok(!r.ok && r.code === 'check_unavailable' && r.message === CHECK_UNAVAILABLE_MESSAGE, face);
    assert.deepEqual(d.calls.map((c: any) => c.task), ['module_vision'], `${face}: the screen did not run`);
  }
  const screenDown = stubRun({ module_vision: 'no', image_screen: 'fail', image_alt_text: 'A harbour.' });
  const sd = await postDrawCheck({} as any, IMG, BASE, screenDown);
  assert.ok(!sd.ok && sd.code === 'check_unavailable');
  assert.deepEqual(screenDown.calls.map((c: any) => c.task), ['module_vision', 'image_screen'], 'no alt text for an unscreened image');
  const noAlt = await postDrawCheck({} as any, IMG, BASE, stubRun({ module_vision: 'no', image_screen: 'no', image_alt_text: 'fail' }));
  assert.deepEqual(noAlt, { ok: true, alt: null, alt_reason: 'the describer could not run', usage_log_ids: [1, 2] });
});

test('one quote: the press shows the draw plus its three checks, summed', async () => {
  const d = stubRun({});
  assert.deepEqual(await postDrawQuote({} as any, BASE, d), { ok: true, hold_microusd: 900, models: [FACE_MODEL, 'm', 'm'] });
  const q = await drawPressQuote({} as any, { task: 'deck_image', drawJob: 'DK4', userId: 2, text: 'x', draw: {} }, d);
  assert.deepEqual(q, { ok: true, model: 'm', draw: null, draw_microusd: 1000, checks_microusd: 900, hold_microusd: 1900 });
  const refused = { ...d, quoteRun: async (_e: any, o: any) => (o.task === 'image_screen' ? { ok: false, refusal: 'model_unpriced', error: 'x' } : { ok: true, hold_microusd: 1, model: 'm' }) };
  assert.deepEqual(await drawPressQuote({} as any, { task: 'deck_image', userId: 2, text: 'x', draw: {} }, refused), { ok: false, refusal: 'model_unpriced', error: 'x' });
});

// 6 ── connections and the rail ───────────────────────────────────────────────
test('the draw rule reaches Events, Articles, Grow campaigns, Narrative and Build, and not a writing page', () => {
  const on = (pageKey: string) => connectionOnPage(SCHNELL, { pageKey, kind: 'write' });
  for (const p of ['Admin · Community · Events', 'Super Admin · Content · Content queue', 'Super Admin · Content · Publications',
    'Founder · Grow · Distribution', 'Founder · Grow · Revenue and traction', 'Founder · Raise · Investor narrative',
    'Founder · Build · Prototype / MVP', 'Founder · Build · Solution design', 'Founder · Raise · Pitch deck']) assert.ok(on(p), p);
  for (const p of ['Founder · Validate · Problem discovery', 'Founder · Raise · Fundraising', 'Founder · Build · Founding team']) assert.ok(!on(p), p);
  assert.ok(DRAW_PAGES.test('Founder · Learning · Courses'), 'Learning, once its page exists');
});

test('no image option lists a reader or a chat model: only draw models, none Legal holds', () => {
  const rows = railOptionRows().filter((r) => r.kind === 'image');
  assert.deepEqual(rows.map((r) => r.optionKey).sort(), ['deck:image', 'draft:logo']);
  for (const r of rows) {
    const w = withModuleModels(r);
    const ids = [...w.models.map((m) => m.id), ...w.more.map((m) => m.id)];
    assert.ok(ids.length > 0, `${r.optionKey} lists a model`);
    for (const id of ids) {
      assert.equal(MODEL_CONNECTIONS[id]?.operation, 'draw', `${r.optionKey} lists ${id}`);
      assert.ok(!LEGAL_HOLD.has(id), `${r.optionKey} lists ${id}, which Legal holds`);
    }
    assert.equal(w.models[0].id, SCHNELL, `${r.optionKey}'s Default is what runs while Legal holds the rest`);
  }
  assert.equal(jobStep('GR3')!.default, LUCID, 'the logo\'s planned Default stays in the table');
});

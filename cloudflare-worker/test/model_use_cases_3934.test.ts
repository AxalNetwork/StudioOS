/**
 * #3934 (task 0 of #3721's model use-case plan) — `modelUseCases.ts`, the
 * job table, and the rail reading it.
 *
 *   - §1's set: every current catalogue id is covered exactly once;
 *   - every job step has exactly one Default, in its kind's list, and its
 *     three are distinct and of its kind;
 *   - the rail: each page and option row reads its kind's job step (≤ 3
 *     suggested, the rest under All models), nothing hidden or held by
 *     Legal is listed, and a locked model carries its plan label;
 *   - snapshots: Record a Session, the Pitch deck and Distribution;
 *   - every `deckV2Model.js` element group and item has a job id.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/model_use_cases_3934.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE } from '../src/services/ai/catalogue.ts';
import {
  COVERAGE, DECK_ELEMENT_JOBS, JOBS, LEGAL_HOLD, MODEL_LOCKS, RAIL_KIND_JOBS, SCOPED_MODELS, USE_KINDS, jobStep, lockLabel, offerable, selectorFor,
} from '../src/services/ai/modelUseCases.ts';
import { MODEL_CONNECTIONS } from '../src/services/ai/moduleConnections.ts';
import { railOptionRows, railOptionsOn, railRows, resolveRail } from '../src/services/ai/railMatrix.ts';
import { CANVAS_RAIL_KINDS, RAIL_KINDS, ROUTE } from '../src/services/aiRouter.ts';
import { ELEMENT_GROUPS } from '../../frontend/src/pages/raise/pitch/deckV2Model.js';

const ids = (xs: readonly { id: string }[] | undefined) => (xs ?? []).map((m) => m.id);
const short = (id: string) => id.split('/').pop();

test('§1: every current catalogue id is in the set exactly once, and nothing else is', () => {
  const current = CATALOGUE.filter((m) => m.status !== 'deprecated').map((m) => m.id).sort();
  const covered = [...COVERAGE.offered, ...Object.keys(COVERAGE.notOffered)];
  assert.equal(new Set(covered).size, covered.length, 'no id is covered twice');
  assert.deepEqual([...covered].sort(), current);
  assert.equal(COVERAGE.offered.length, 60);
  for (const id of COVERAGE.offered) assert.ok(MODEL_LOCKS[id], `${short(id)} has a lock`);
  // Beta and unpriced models are never offered (B (c)); v4.1 flash waits on the owner's spend approval.
  for (const m of CATALOGUE.filter((x) => x.status === 'beta' || !Object.keys(x.prices).length)) assert.ok(!COVERAGE.offered.includes(m.id), `${short(m.id)} is not offered`);
  assert.match(COVERAGE.notOffered['@cf/deepseek-ai/deepseek-v4.1-flash-1017'], /spend approval/);
});

test('every job step has exactly one Default, in its kind\'s list; its choices are of its kind and distinct', () => {
  assert.ok(JOBS.length >= 225, `the plan's 174 jobs, by step (${JOBS.length})`);
  const keys = JOBS.map((j) => `${j.id}#${j.step}`);
  assert.equal(new Set(keys).size, keys.length, 'one row per job step');
  for (const j of JOBS) {
    const kind = USE_KINDS[j.kind];
    assert.ok(kind, `${j.id}: kind ${j.kind}`);
    assert.equal(typeof j.default, 'string', `${j.id}#${j.step} has a Default`);
    assert.ok(kind.models.includes(j.default), `${j.id}#${j.step}: ${short(j.default)} is in ${j.kind}'s list`);
    const choices = [j.alternative, j.deeper, ...j.more].filter(Boolean) as string[];
    assert.equal(new Set([j.default, ...choices]).size, choices.length + 1, `${j.id}#${j.step}: Default, Alternative, Deeper and more are distinct`);
    for (const id of choices) assert.ok(kind.models.includes(id), `${j.id}#${j.step}: ${short(id)} is in ${j.kind}'s list`);
    if (j.fixed) assert.deepEqual([j.alternative, j.deeper, j.more.length, j.presets], [null, null, 0, null], `${j.id}#${j.step} is fixed`);
    if (j.deeper) assert.ok(j.alternative, `${j.id}#${j.step}: a Deeper comes after an Alternative`);
    assert.equal(j.lock, MODEL_LOCKS[j.default] ?? 'all');
  }
  // The plan's own checks: no reader under Draw, no text model under Listen, no code model as a form fill's Default.
  const op = (id: string) => MODEL_CONNECTIONS[id]?.operation;
  for (const id of USE_KINDS.draw.models) assert.equal(op(id), 'draw', `${short(id)} draws`);
  for (const id of USE_KINDS.listen_file.models) assert.equal(op(id), 'transcribe', `${short(id)} transcribes`);
  assert.equal(jobStep('BU4')!.kind, 'plan', 'form fills are Plan, never Code');
  // Revision 2 and 3: never "Fill"; DK4 is card and area images.
  assert.equal(jobStep('DK3')!.job, 'One-click build from records');
  assert.equal(jobStep('DK4')!.job, 'Card and area images');
});

test('the rail reads the table: one selector per kind for each page, at most 3 suggested, the rest under All models', () => {
  for (const row of [...railRows(), ...railOptionRows()]) {
    if ((row as any).noModel || row.kind === 'image' || (row as any).handler === 'transcribe') continue;
    const ref = RAIL_KIND_JOBS[row.kind];
    assert.ok(ref, `${row.pageKey}: kind ${row.kind} reads a job`);
    const job = jobStep(ref.id, ref.step)!;
    assert.ok(row.models.length >= 1 && row.models.length <= 3, row.pageKey);
    assert.deepEqual(row.models.map((m) => m.role), ['Default', 'Alternative', 'Deeper'].slice(0, row.models.length));
    assert.equal(row.models[0].id, job.default, `${row.pageKey}: the Default is ${job.id}'s`);
    const listed = [...ids(row.models), ...ids(row.more)];
    assert.equal(new Set(listed).size, listed.length, `${row.pageKey}: a model is listed once`);
    for (const id of listed) {
      assert.ok(offerable(id), `${row.pageKey}: ${short(id)} is hidden or waiting on Legal`);
      assert.ok(id === job.default || USE_KINDS[job.kind].models.includes(id), `${row.pageKey}: ${short(id)} is of ${job.kind}`);
    }
  }
  for (const id of LEGAL_HOLD) assert.ok(!railRows().some((r) => [...ids(r.models), ...ids(r.more)].includes(id)), `${short(id)} is on no page row`);
  // A scoped model appears only where a job names it.
  const chat = resolveRail(railRows().find((r) => r.kind === 'chat')!.pageKey)!;
  assert.ok(ids(chat.more).includes('@cf/aisingapore/gemma-sea-lion-v4-27b-it'), 'ST1 names sea-lion');
  const reason = railRows().find((r) => r.kind === 'reason')!;
  assert.ok(![...ids(reason.models), ...ids(reason.more)].some((id) => SCOPED_MODELS.has(id) && !jobStep('DK8')!.more.includes(id)), 'r1-distill is Learning only');
});

test('selectorFor: roles go by position, so a Deeper moves up when the Alternative cannot run; a fixed step suggests one', () => {
  const st1 = jobStep('ST1')!;
  const noAlt = selectorFor(st1, (id) => id !== st1.alternative);
  assert.deepEqual(noAlt.models.map((m) => [m.role, m.id]), [['Default', st1.default], ['Alternative', st1.deeper]]);
  assert.ok(!noAlt.more.some((m) => m.id === st1.alternative), 'a model the run cannot do is listed nowhere');
  const fixed = selectorFor(jobStep('ST12')!, () => true);
  assert.deepEqual([fixed.models.map((m) => m.role), fixed.more], [['Default'], []]);
});

test('§4: glm-5.2 and the 3.1 70B are hidden; r1-distill is Reason only and phonellm Voice turn only', () => {
  for (const id of ['@cf/zai-org/glm-5.2', '@cf/meta/llama-3.1-70b-instruct-fp8-fast']) {
    assert.equal(MODEL_LOCKS[id], 'hidden');
    assert.equal(MODEL_CONNECTIONS[id], undefined, `${short(id)} has no module connection`);
    assert.ok(![...railRows(), ...railOptionRows()].some((r) => [...ids(r.models), ...ids(r.more)].includes(id)), `${short(id)} is on no row`);
  }
  assert.deepEqual(MODEL_CONNECTIONS['@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'].kinds, ['reason']);
  assert.deepEqual(MODEL_CONNECTIONS['@cf/daily-co/phonellm-mini-alpha-2'].kinds, ['voice_turn']);
});

test('A (c): a locked model carries its plan label; B and C: partner models are paid, betas never listed', () => {
  assert.equal(lockLabel('@cf/zai-org/glm-4.7-flash'), null);
  assert.equal(lockLabel('@cf/zai-org/glm-5.3-flash'), 'Paid plans');
  assert.equal(lockLabel('@cf/moonshotai/kimi-k2.6'), 'Top paid plan');
  assert.equal(MODEL_LOCKS['@cf/black-forest-labs/flux-2-klein-4b'], 'lowest_paid', 'a partner model runs on paid plans (C (b))');
  assert.equal(MODEL_LOCKS['@cf/deepgram/nova-3'], 'all', 'nova-3 and Flux are always offered');
  assert.deepEqual([...LEGAL_HOLD].map(short).sort(), ['flux-2-dev', 'flux-2-klein-9b', 'llama-3.2-11b-vision-instruct', 'lucid-origin', 'phoenix-1.0']);
});

test('RAIL_KINDS: the canvas\'s fourteen and the plan\'s seven, each with a route and a job', () => {
  assert.equal(CANVAS_RAIL_KINDS.length, 14);
  assert.deepEqual(RAIL_KINDS.slice(14), ['draw', 'edit_image', 'voice_turn', 'agent', 'decide', 'sentiment', 'translate']);
  for (const kind of RAIL_KINDS) {
    assert.ok(`rail_${kind}` in ROUTE, `rail_${kind} is a route`);
    const ref = RAIL_KIND_JOBS[kind];
    assert.ok(ref && jobStep(ref.id, ref.step), `${kind} reads a job step`);
  }
  // D (a): Draw lists Schnell and Klein 4B only while Legal reads the vendors' terms.
  assert.deepEqual((ROUTE as any).rail_draw.alternates.map(short), ['flux-1-schnell', 'flux-2-klein-4b']);
});

test('snapshot: Record a Session shows exactly turbo, nova-3 and whisper; its structuring is a Synth selector', () => {
  const page = resolveRail('Founder · Validate · Customer research')!;
  assert.equal(page.kind, 'speech');
  assert.deepEqual([page.models.map((m) => `${m.role}:${short(m.id)}`), ids(page.more).map(short)], [['Default:whisper-large-v3-turbo', 'Alternative:nova-3'], ['whisper']]);
  const options = Object.fromEntries(railOptionsOn(page.pageKey).map((o) => [o.optionKey, [ids(o.models).map(short), ids(o.more).map(short)]]));
  for (const key of ['transcribe:interview', 'transcribe:session', 'transcribe:recording']) assert.deepEqual(options[key], [['whisper-large-v3-turbo', 'nova-3', 'whisper'], []]);
  assert.deepEqual(options['structure:transcript'][0], ['llama-3.3-70b-instruct-fp8-fast', 'glm-4.7-flash', 'mistral-small-3.1-24b-instruct']);
  assert.ok(![...Object.entries(options)].some(([k, [m, x]]) => k.startsWith('transcribe:') && [...m, ...x].some((id) => /llama|phonellm/.test(id!))), 'no text model under Listen');
});

test('snapshot: the Pitch deck', () => {
  const page = resolveRail('Founder · Raise · Pitch deck')!;
  assert.deepEqual([page.kind, page.models.map((m) => short(m.id)), ids(page.more).map(short)],
    ['vision', ['gemma-4-26b-a4b-it', 'qwen3.8-27b', 'glm-5.3-flash'], ['llama-4-scout-17b-16e-instruct', 'kimi-k2.6']]);
  const options = Object.fromEntries(railOptionsOn(page.pageKey).map((o) => [o.optionKey, ids(o.models).map(short)]));
  assert.deepEqual(options['deck:rewrite'], ['llama-3.3-70b-instruct-fp8-fast', 'mistral-small-3.1-24b-instruct']);
  assert.deepEqual(options['review:deck-text'], ['gpt-oss-120b', 'gpt-oss-20b', 'nemotron-3-120b-a12b']);
  // The image options keep D1478's draw list until #3935 replaces them.
  assert.deepEqual(options['deck:image'][0], 'flux-1-schnell');
});

test('snapshot: Distribution', () => {
  const page = resolveRail('Founder · Grow · Distribution')!;
  assert.deepEqual([page.kind, page.models.map((m) => short(m.id)), ids(page.more).map(short)],
    ['write', ['llama-3.3-70b-instruct-fp8-fast', 'mistral-small-3.1-24b-instruct'], ['glm-4.7-flash', 'llama-3.2-3b-instruct', 'granite-4.0-h-micro', 'llama-3.2-1b-instruct', 'llama-3.1-8b-instruct-fp8']]);
  const options = Object.fromEntries(railOptionsOn(page.pageKey).map((o) => [o.optionKey, ids(o.models).map(short)]));
  assert.deepEqual(options['draft:taglines'], ['llama-3.3-70b-instruct-fp8-fast', 'mistral-small-3.1-24b-instruct']);
});

test('every deck element group and item has a job id (revision 4), so #3754 can route per element', () => {
  const groups = ELEMENT_GROUPS as Array<{ id: string; items: Array<{ id: string; free?: boolean }> }>;
  assert.deepEqual(Object.keys(DECK_ELEMENT_JOBS).sort(), groups.map((g) => g.id).sort(), 'one entry per group on main');
  for (const g of groups) {
    const entry = DECK_ELEMENT_JOBS[g.id];
    assert.ok(jobStep(entry.job), `${g.id}: ${entry.job} is a job`);
    assert.deepEqual(Object.keys(entry.items).sort(), g.items.map((i) => i.id).sort(), `${g.id}: every item is mapped`);
    for (const item of g.items) {
      const job = entry.items[item.id];
      if (job === null) continue;
      assert.ok(jobStep(job), `${g.id}.${item.id}: ${job} is a job`);
      assert.ok(!item.free || item.id === 'upload', `${g.id}.${item.id}: a free placement runs no model`);
    }
  }
});

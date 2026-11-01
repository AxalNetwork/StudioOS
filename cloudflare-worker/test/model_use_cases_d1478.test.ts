/**
 * D1478 (#3934, task 0 of the #3721 plan): the model use-case table.
 *
 * `services/ai/modelUseCases.ts` holds the plan's §1 catalogue split and §2
 * job table as data. These tests hold it to the plan's acceptance for task 0:
 *
 *   - each current catalogue model is in exactly one of §1's sets: on a
 *     kind's list, never offered (§1.5), or hidden (§1 rows 14 and 15);
 *   - each job step has one Default, and it is on its kind's list;
 *   - `GET /api/ai/rail` returns one selector per kind of work for a page,
 *     and Record a session shows exactly turbo, nova-3 and whisper;
 *   - a kind pick round-trips, is per member, and a stale one is cleared;
 *   - every Pitch deck element group names a job.
 *
 * Task 0 changes what the rail lists, never what a press runs: the automatic
 * chains are held by `ai_module_connections_3626.test.ts` test 2.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import ai from '../src/routes/ai.ts';
import { CATALOGUE } from '../src/services/ai/catalogue.ts';
import { railOptionRows, railOptionsOn, railRows } from '../src/services/ai/railMatrix.ts';
import { MODEL_CONNECTIONS } from '../src/services/ai/moduleConnections.ts';
import { CANVAS_RAIL_KINDS, RAIL_KINDS } from '../src/services/aiRouter.ts';
import {
  ELEMENT_GROUP_JOBS, HIDDEN_MODELS, MODEL_JOBS, MODEL_LOCK, NOT_OFFERED, OPTION_JOBS, PAGE_JOBS, RAIL_KIND_USE, USE_CASE_KINDS,
  jobById, jobForOption, jobsOnPage, kindList, lockOf, selectorsFor, suggestionsFor,
} from '../src/services/ai/modelUseCases.ts';
import { ELEMENT_GROUPS } from '../../frontend/src/pages/raise/pitch/deckV2Model.js';

const ROOT = new URL('../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, ROOT), 'utf8');
const cf = (s: string) => `@cf/${s}`;
const TURBO = cf('openai/whisper-large-v3-turbo'), NOVA = cf('deepgram/nova-3'), WHISPER = cf('openai/whisper');
const RESEARCH = 'Founder · Validate · Customer research';
const SAFE_FALLBACK = cf('meta/llama-3.1-8b-instruct-fp8');

// ─────────────────────────────────────────────── the table

test('each current catalogue model is in exactly one of §1\'s sets: listed, never offered, or hidden', () => {
  const listed = new Set(Object.values(USE_CASE_KINDS).flatMap((k) => k.list));
  const current = CATALOGUE.filter((m) => m.status !== 'deprecated');
  for (const m of current) {
    const sets = [listed.has(m.id) && 'listed', NOT_OFFERED.includes(m.id) && 'not offered', HIDDEN_MODELS.includes(m.id) && 'hidden'].filter(Boolean);
    assert.equal(sets.length, 1, `${m.id} is in ${sets.length ? sets.join(' and ') : 'no set'}`);
  }
  for (const id of [...listed, ...NOT_OFFERED, ...HIDDEN_MODELS]) {
    const m = CATALOGUE.find((x) => x.id === id);
    assert.ok(m, `${id} is not a catalogue row`);
    assert.notEqual(m.status, 'deprecated', `${id} is deprecated`);
  }
  // Answer B (c): a beta model is never offered; the GA v4.1 Flash is listed.
  for (const m of current.filter((x) => x.status === 'beta')) assert.ok(!listed.has(m.id), `${m.id} is beta`);
  assert.ok(listed.has(cf('deepseek-ai/deepseek-v4.1-flash-1017')));
  assert.deepEqual([...HIDDEN_MODELS].sort(), [cf('meta/llama-3.1-70b-instruct-fp8-fast'), cf('zai-org/glm-5.2')]);
  for (const kind of Object.keys(USE_CASE_KINDS) as Array<keyof typeof USE_CASE_KINDS>) {
    assert.ok(kindList(kind).every((id) => !HIDDEN_MODELS.includes(id) && !NOT_OFFERED.includes(id)), kind);
  }
});

test('each job step has one Default on its kind\'s list, and its alternatives and fallback are on it too', () => {
  const ids = MODEL_JOBS.map((j) => j.id);
  assert.equal(new Set(ids).size, ids.length, 'a job id is used twice');
  assert.equal(ids.length, 174);
  for (const job of MODEL_JOBS) {
    assert.ok(job.steps.length > 0, `${job.id} has no step`);
    for (const s of job.steps) {
      const list = USE_CASE_KINDS[s.kind]?.list;
      assert.ok(list, `${job.id}: ${s.kind} is not a kind`);
      assert.equal(typeof s.default, 'string', `${job.id}: one Default`);
      assert.ok(list.includes(s.default), `${job.id}: Default ${s.default} is not on ${s.kind}`);
      for (const a of s.alternatives ?? []) {
        assert.ok(list.includes(a), `${job.id}: alternative ${a} is not on ${s.kind}`);
        assert.notEqual(a, s.default, `${job.id}: the Default is not its own alternative`);
      }
      // §1 row 12: the 8B FP8 is the safe fallback of every chain, on a list or not.
      if (s.fallback) assert.ok(list.includes(s.fallback) || s.fallback === SAFE_FALLBACK, `${job.id}: fallback ${s.fallback} is not on ${s.kind}`);
    }
    for (const step of job.steps.filter((x) => !x.fixed)) {
      const cards = suggestionsFor(job, step);
      assert.equal(cards.filter((c) => c.role === 'Default').length, 1, job.id);
      assert.equal(cards[0].id, step.default, `${job.id}: the Default card leads`);
      assert.equal(new Set(cards.map((c) => c.id)).size, cards.length, `${job.id}: a card twice`);
    }
  }
});

test('every option that runs a model maps to a job, and every mapping names a real job', () => {
  for (const v of Object.values(OPTION_JOBS)) if (v) assert.ok(jobById(v), `${v} is not a job`);
  for (const jobs of Object.values(PAGE_JOBS)) for (const j of jobs) assert.ok(jobById(j), `${j} is not a job`);
  const unmapped = railOptionRows().filter((o) => !jobForOption(o.pageKey, o.optionKey));
  assert.deepEqual(unmapped.map((o) => `${o.pageKey}|${o.optionKey}`), ['Advisor · Practice · Sessions|sessions:block']);
  assert.ok(unmapped.every((o) => (o as { noModel?: boolean }).noModel), 'only a no-model option has no job');
  // A key two pages share can still name a different job on each.
  assert.equal(jobForOption('Operating Partner · Delivery · Health', 'draft:renewal-risk')?.id, 'IN13');
  assert.equal(jobForOption('Operating Partner · Pipeline · Retainers', 'draft:renewal-risk')?.id, 'GR16');
});

test('the seven new rail kinds read the table; the fourteen canvas kinds stay first', () => {
  assert.deepEqual([...RAIL_KINDS.slice(0, 14)], [...CANVAS_RAIL_KINDS]);
  for (const kind of RAIL_KINDS) assert.ok(RAIL_KIND_USE[kind], `${kind} maps to a use-case kind`);
  for (const id of Object.keys(MODEL_LOCK)) assert.ok(Object.values(USE_CASE_KINDS).some((k) => k.list.includes(id)), `${id} is locked but listed nowhere`);
  // Answer A (c): the top models wait for the top paid plan.
  assert.equal(lockOf(cf('deepseek-ai/deepseek-v4-pro-0813'))?.lock, 'top_paid');
  assert.equal(lockOf(cf('deepseek-ai/deepseek-v4.1-flash-1017'))?.lock, 'lowest_paid');
  assert.equal(lockOf(cf('meta/llama-3.3-70b-instruct-fp8-fast')), null);
});

test('every Pitch deck element group and element names a job, and the job exists', () => {
  for (const g of ELEMENT_GROUPS as Array<{ id: string; items: Array<{ id: string }> }>) {
    const entry = ELEMENT_GROUP_JOBS[g.id];
    assert.ok(entry, `group ${g.id} has no job`);
    assert.ok(jobById(entry.job), `${g.id}: ${entry.job}`);
    for (const item of g.items) {
      assert.ok(Object.prototype.hasOwnProperty.call(entry.elements, item.id), `${g.id}.${item.id} is not in the table`);
      const j = entry.elements[item.id];
      if (j !== null) assert.ok(jobById(j), `${g.id}.${item.id}: ${j}`);
    }
  }
  // The plan's Stock group is ahead of the lightbox, which has seven groups today.
  const groups = (ELEMENT_GROUPS as Array<{ id: string }>).map((g) => g.id);
  assert.deepEqual(Object.keys(ELEMENT_GROUP_JOBS).filter((g) => !groups.includes(g)), ['stock']);
});

test('a row lists under All models only what its run reads: chat, draw on an image option, or what the canvas listed', () => {
  const matrix = JSON.parse(read('cloudflare-worker/src/services/ai/railMatrix.json'));
  const canvasMore = new Map<string, Set<string>>();
  for (const r of [...matrix.rows, ...matrix.options]) canvasMore.set(`${r.pageKey}|${r.optionKey ?? ''}`, new Set((r.more ?? []).map((m: any) => m.id)));
  const rows = [...railRows().map((r) => ({ ...r, optionKey: '' })), ...railOptionRows()];
  for (const r of rows) {
    const runs = r.kind === 'image' ? 'draw' : 'chat';
    for (const m of r.more ?? []) {
      const ok = canvasMore.get(`${r.pageKey}|${r.optionKey}`)!.has(m.id) || MODEL_CONNECTIONS[m.id]?.operation === runs;
      assert.ok(ok, `${r.pageKey} ${r.optionKey}: ${m.id} is a pick its run never reads`);
      assert.ok(!HIDDEN_MODELS.includes(m.id) && !NOT_OFFERED.includes(m.id), `${r.pageKey} ${r.optionKey}: ${m.id}`);
    }
  }
  // The embedding models are on the Retrieve list, but a match row's run is chat.
  const match = railRows().find((r) => r.pageKey === 'Founder · Raise · Capital relationships')!;
  assert.ok(!(match.more ?? []).some((m) => m.id === cf('qwen/qwen3-embedding-0.6b')));
});

// ─────────────────────────────────────────────── the read and the pick

const JWT_SECRET = 'd1478-s17-fixture-only-signing-secret-0123456789';
const A = 2, B = 3;
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');

function world() {
  const { DB, db } = makeD1('PRAGMA foreign_keys=ON;' + stripForeignKeys(tableFromBaseline(BASELINE, 'users')) + ';');
  db.exec(read('cloudflare-worker/sql/migrations/465_ai_rail_preferences.sql'));
  const add = db.prepare('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)');
  add.run(A, 'ana.founder@example.test', 'Ana Founder', 'founder');
  add.run(B, 'ben.founder@example.test', 'Ben Founder', 'founder');
  const env: any = { DB, ENVIRONMENT: 'development', JWT_SECRET, AI_PARTNER_MODELS: 'on' };
  const prefs = (user: number) => db.prepare('SELECT section, task, model FROM ai_rail_preferences WHERE user_id = ? ORDER BY task').all(user).map((r: any) => ({ ...r }));
  return { env, db, prefs };
}

const app = (() => {
  const a = new Hono();
  a.route('/api/ai', ai as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    if (st) return c.json({ detail: err.message }, st);
    console.error(err);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(env: any, user: number, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`http://x/api/ai${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const q = (page: string) => `/rail?page=${encodeURIComponent(page)}`;
const short = (id: string) => id.replace(/^@cf\/[^/]+\//, '');
const snapshot = (selectors: any[]) => selectors.map((s) => `${s.kind} ${s.jobs.join(',')} | ${s.models.map((m: any) => `${m.role[0]}:${short(m.id)}`).join(' ')} | ${s.more.map((m: any) => short(m.id)).join(' ')}`);

test('Record a session shows exactly turbo, nova-3 and whisper; each card is named, priced, locked and marked wired', async () => {
  const { env, db } = world();
  try {
    const r = await call(env, A, 'GET', q(RESEARCH));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const listen = r.body.selectors.find((s: any) => s.kind === 'listen_file');
    assert.deepEqual(listen.jobs, ['VA1']);
    assert.deepEqual(listen.models.map((m: any) => [m.id, m.role]), [[TURBO, 'Default'], [NOVA, 'Alternative'], [WHISPER, 'Deeper']]);
    assert.deepEqual(listen.more, []);
    assert.equal(listen.pick, null);
    const automatic = new Set([...r.body.models, ...r.body.options.flatMap((o: any) => o.models)].map((m: any) => m.id));
    for (const s of r.body.selectors) {
      assert.equal(s.label, USE_CASE_KINDS[s.kind as keyof typeof USE_CASE_KINDS].label);
      for (const m of [...s.models, ...s.more]) {
        assert.ok(m.name, `${m.id} has a name`);
        assert.ok(m.price && Object.keys(m.price.billed).length > 0, `${m.id} is priced`);
        assert.deepEqual(m.lock, lockOf(m.id));
        assert.equal(m.offered, true, `${m.id} is offered with the partner gate open`);
      }
      for (const m of s.models) assert.equal(m.wired, automatic.has(m.id), `${s.kind}: ${m.id}`);
    }
    // Whisper large v3 turbo is what Record a session runs today.
    assert.equal(listen.models[0].wired, true);
  } finally { db.close(); }
});

test('selector snapshots: Customer research, the Pitch deck and Distribution', async () => {
  const { env, db } = world();
  try {
    const got = async (page: string) => {
      const r = await call(env, A, 'GET', q(page));
      assert.equal(r.status, 200);
      assert.deepEqual(snapshot(r.body.selectors), snapshot(selectorsFor(jobsOnPage(page, railOptionsOn(page).map((o) => o.optionKey))).map((s) => ({ ...s, more: s.more.map((id) => ({ id })) }))));
      return snapshot(r.body.selectors);
    };
    assert.deepEqual(await got(RESEARCH), [
      'listen_file VA1 | D:whisper-large-v3-turbo A:nova-3 D:whisper | ',
      'synth VA5 | D:llama-3.3-70b-instruct-fp8-fast A:llama-3.1-8b-instruct-fp8-fast D:mistral-small-3.1-24b-instruct | nemotron-3-120b-a12b deepseek-v4-flash-0731 kimi-k2.6 glm-4.7-flash llama-3.2-3b-instruct llama-3.1-8b-instruct-fp8 deepseek-v4.1-flash-1017',
      'research VA6 | D:gpt-oss-120b A:nemotron-3-120b-a12b D:kimi-k2.6 | deepseek-v4-flash-0731 deepseek-v4.1-flash-1017',
      'listen_live VA2 | D:flux A:nova-3 | ',
      'speak VA10 | D:melotts A:aura-2-en D:aura-2-es | aura-1',
    ]);
    assert.deepEqual(await got('Founder · Raise · Pitch deck'), [
      'write DK3,DK1,DK2 | D:llama-3.3-70b-instruct-fp8-fast A:glm-4.7-flash D:mistral-small-3.1-24b-instruct | llama-3.2-3b-instruct llama-3.2-1b-instruct granite-4.0-h-micro llama-3.1-8b-instruct-fp8',
      'draw DK4 | D:flux-2-klein-9b A:flux-1-schnell D:flux-2-dev | flux-2-klein-4b lucid-origin phoenix-1.0',
      'reason DK8,DK12 | D:gpt-oss-120b A:gpt-oss-20b D:nemotron-3-120b-a12b | deepseek-v4-pro-0813 deepseek-v4-flash-0731 qwq-32b qwen3-30b-a3b-fp8 glm-5.3-flash kimi-k2.6 deepseek-v4.1-flash-1017',
      'edit_image DK5 | D:flux-2-klein-4b A:flux-2-klein-9b D:flux-2-dev | ',
      'read_images DK9 | D:gemma-4-26b-a4b-it A:llama-4-scout-17b-16e-instruct D:qwen3.8-27b | moondream3.1-9B-A2B llama-3.2-11b-vision-instruct glm-5.3-flash kimi-k2.6',
      'speak DK10 | D:aura-2-en A:aura-2-es D:aura-1 | melotts',
      'listen_file DK11 | D:whisper-large-v3-turbo A:whisper D:nova-3 | ',
      'retrieve DK13 | D:bge-m3 | qwen3-embedding-0.6b bge-large-en-v1.5 bge-small-en-v1.5 plamo-embedding-1b',
      'research DK13 | D:gpt-oss-120b A:kimi-k2.6 D:nemotron-3-120b-a12b | deepseek-v4-flash-0731 deepseek-v4.1-flash-1017',
    ]);
    assert.deepEqual(await got('Founder · Grow · Distribution'), [
      'write GR2,GR5,GR10,GR12 | D:llama-3.3-70b-instruct-fp8-fast A:mistral-small-3.1-24b-instruct D:glm-4.7-flash | llama-3.2-3b-instruct llama-3.2-1b-instruct granite-4.0-h-micro llama-3.1-8b-instruct-fp8',
      'draw GR3,GR6,GR7 | D:lucid-origin A:phoenix-1.0 D:flux-2-klein-9b | flux-1-schnell flux-2-klein-4b flux-2-dev',
      'voice_turn GR8 | D:phonellm-mini-alpha-2 A:llama-3.3-70b-instruct-fp8-fast D:glm-4.7-flash | ',
      'speak GR9 | D:aura-2-en A:aura-2-es D:aura-1 | melotts',
    ]);
  } finally { db.close(); }
});

test('a kind pick round-trips per member, an unknown kind or model is refused, and a stale pick is cleared', async () => {
  const { env, db, prefs } = world();
  try {
    const put = (user: number, body: unknown) => call(env, user, 'PUT', '/rail/pick', body);
    const ok = await put(A, { page: RESEARCH, kind: 'listen_file', model: NOVA });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body, { ok: true, page: RESEARCH, kind: 'listen_file', model: NOVA });
    const picked = (body: any, kind: string) => body.selectors.find((s: any) => s.kind === kind).pick;
    assert.equal(picked((await call(env, A, 'GET', q(RESEARCH))).body, 'listen_file'), NOVA);
    assert.equal(picked((await call(env, B, 'GET', q(RESEARCH))).body, 'listen_file'), null, 'a pick is the member\'s own');
    // A pick never changes the row's own pick, cards or automatic chain.
    const after = (await call(env, A, 'GET', q(RESEARCH))).body;
    assert.equal(after.pick, null);
    assert.deepEqual(prefs(A).map((p: any) => p.task), ['kind:listen_file']);
    // An overflow model is a valid pick.
    assert.equal((await put(A, { page: RESEARCH, kind: 'speak', model: cf('deepgram/aura-1') })).status, 200);

    const kindless = await put(A, { page: RESEARCH, kind: 'draw', model: cf('black-forest-labs/flux-1-schnell') });
    assert.equal(kindless.status, 400);
    assert.equal(kindless.body.error, 'unknown_kind', 'this page has no Draw job');
    assert.equal((await put(A, { page: RESEARCH, kind: 'no_such_kind', model: NOVA })).body.error, 'unknown_kind');
    assert.equal((await put(A, { page: RESEARCH, kind: 7, model: NOVA })).body.error, 'unknown_kind');
    const wrong = await put(A, { page: RESEARCH, kind: 'listen_file', model: cf('deepgram/aura-1') });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error, 'model_not_offered');
    assert.deepEqual(wrong.body.models, [TURBO, NOVA, WHISPER]);
    const hidden = await put(A, { page: RESEARCH, kind: 'synth', model: cf('meta/llama-3.1-70b-instruct-fp8-fast') });
    assert.equal(hidden.body.error, 'model_not_offered', 'a hidden model is never a pick');

    // Clearing is `model: null`.
    assert.equal((await put(A, { page: RESEARCH, kind: 'speak', model: null })).status, 200);
    assert.deepEqual(prefs(A).map((p: any) => p.task), ['kind:listen_file']);

    // A pick the table no longer offers reads as none and is deleted.
    db.prepare("UPDATE ai_rail_preferences SET model = ? WHERE user_id = ? AND task = 'kind:listen_file'").run('@cf/no-longer/offered', A);
    assert.equal(picked((await call(env, A, 'GET', q(RESEARCH))).body, 'listen_file'), null);
    assert.deepEqual(prefs(A), []);
  } finally { db.close(); }
});

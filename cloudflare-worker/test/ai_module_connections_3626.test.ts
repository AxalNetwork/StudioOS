import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import modules, { modulePageAllowed } from '../src/routes/ai_modules.ts';
import { CATALOGUE, isOffered } from '../src/services/ai/catalogue.ts';
import { MODEL_CONNECTIONS, moduleConnections } from '../src/services/ai/moduleConnections.ts';
import { pcmBytes, pcmMinutes, questionsValid, specialistOutput } from '../src/services/ai/moduleShapes.ts';
import { railRows, railOptionRows, resolveRailChain } from '../src/services/ai/railMatrix.ts';
import { publicModels } from '../src/services/ai/publicModels.ts';
import { run, __resetForTest } from '../src/services/aiRouter.ts';
import { searchIndexAccepts, parseEmbed } from '../src/services/ai/shapes.ts';
import { unitPrice } from '../src/services/ai/pricing.ts';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { RAIL_PAGES, RAIL_BOARD_ALIASES } from '../../frontend/src/lib/railPages.js';

const SECRET = 'module-connections-fixture-secret-no-production-value';
const switches = { AI_PARTNER_MODELS: 'on', AI_PAID_MODELS: 'on' };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFNkAAAAASUVORK5CYII=';
const pcm = btoa('\0'.repeat(32_000)); // exactly one second, measured on the server
const questions = { urgent: { type: 'noul' as const, instructions: 'Does this evidence describe an urgent problem?' } };
const rows = railRows();
const pageFor = (id: string) => rows.find(r => moduleConnections(r, switches).some(m => m.id === id))!;
const surfaceFor = (page: string) => {
  const key = RAIL_BOARD_ALIASES.find(x => x.board === page)?.to ?? page;
  return RAIL_PAGES[key.split(' · ')[0]]?.find(x => x.key === key)?.route?.split(/[?#]/)[0] ?? '/studio';
};

function fixture(handler: (id: string, input: any) => any = () => ({ response: 'Result.', usage: { prompt_tokens: 12, completion_tokens: 3 } })) {
  const f = aiBudgetFixture();
  f.db.exec(readFileSync(new URL('../sql/migrations/465_ai_rail_preferences.sql', import.meta.url), 'utf8'));
  const calls: Array<{ id: string; input: any }> = [];
  const env: any = { DB: f.DB, ENVIRONMENT: 'development', JWT_SECRET: SECRET, ...switches,
    AI: withGuard({ run: async (id: string, input: any) => { calls.push({ id, input }); return handler(id, input); } }) };
  return { ...f, env, calls };
}
test.afterEach(() => __resetForTest());

test('every offered model has a purpose and real module connection; no backend details enter public copy', () => {
  const models = publicModels(switches);
  const failures = models.filter(m => !m.used_for || m.used_for === 'Use not recorded' || !m.pages.length
    || /@cf|cloudflare|worker|neuron|provider|infrastructure/i.test(m.used_for));
  assert.deepEqual({ count: models.length, failures: failures.map(m => m.id) }, { count: 60, failures: [] });
  assert.deepEqual(models.map(m => m.id).sort(), CATALOGUE.filter(m => isOffered(m, switches)).map(m => m.id).sort());
});

test('additional models do not change canvas defaults or automatic fallback chains', () => {
  const original = JSON.parse(readFileSync(new URL('../src/services/ai/railMatrix.json', import.meta.url), 'utf8'));
  const changed = rows.filter(r => {
    const before = original.rows.find((b: any) => b.pageKey === r.pageKey);
    const after = resolveRailChain(r, { vision: false }, {}, {});
    const baseline = resolveRailChain(before, { vision: false }, {}, {});
    return r.models[0].id !== before.models[0].id || JSON.stringify(after) !== JSON.stringify(baseline);
  });
  assert.deepEqual(changed.map(r => r.pageKey), []);
  const choice = rows.find(r => r.kind === 'chat')!;
  const optional = choice.models.find(m => m.optional)!;
  assert.equal(resolveRailChain(choice, { vision: false }, switches, { caller: optional.id })?.ok, true);
});

test('structured decisions and the guard cannot become chat or vision choices', () => {
  const bad = [...rows, ...railOptionRows()].flatMap(r => r.models.filter(m => ['decision', 'guard', 'sentiment', 'image_labels', 'turn'].includes(MODEL_CONNECTIONS[m.id]?.operation)).map(m => m.id));
  assert.deepEqual(bad, []);
  const row = rows.find(r => r.kind === 'reason')!;
  assert.deepEqual(resolveRailChain(row, { vision: false }, switches, { caller: '@cf/cloudflare/clef' }), { ok: false, refusal: 'model_not_offered', model: '@cf/cloudflare/clef' });
});

test('all persona modules retain their boundaries, including Super Admin elevation', () => {
  const profiles = ['Founder', 'Investor', 'Advisor', 'Operating Partner', 'Admin', 'Super Admin'];
  const roles = ['founder', 'investor', 'advisor', 'partner', 'admin'];
  assert.deepEqual(roles.map(role => profiles.filter(p => modulePageAllowed({ role }, `${p} · Home`))), [...profiles.slice(0, 4).map(p => [p]), profiles.slice(0, 5)]);
  assert.deepEqual([modulePageAllowed({ role: 'admin', is_super_admin: 1 }, 'Super Admin · Platform'), modulePageAllowed({ role: 'founder', is_super_admin: 1 }, 'Super Admin · Platform')], [true, false]);
});

const app = new Hono();
app.route('/api/ai/modules', modules);
app.onError((e, c) => c.json({ error: e.message }, e.message === 'Unauthorized' ? 401 : 500));
async function post(f: ReturnType<typeof fixture>, body: any, action = 'run', user: number | null = 2) {
  const token = user == null ? null : await new SignJWT({ user_id: user, role: 'ignored-claim' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/api/ai/modules/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ surface: surfaceFor(body.page), ...body }) }, f.env);
  return { status: res.status, body: await res.json() as any };
}
const decisionBody = { page: pageFor('@cf/cloudflare/clef').pageKey, model: '@cf/cloudflare/clef', text: 'Customers say checkout is failing.', questions };

test('Founder, Investor, Advisor, Partner, Admin and Super Admin dispatch under their own charged identity', async () => {
  const f = fixture();
  try {
    const results = [];
    const id = '@cf/zai-org/glm-4.7-flash';
    for (const [user, role, profile] of [[2, 'founder', 'Founder'], [3, 'investor', 'Investor'], [4, 'advisor', 'Advisor'], [5, 'partner', 'Operating Partner'], [6, 'admin', 'Admin'], [1, 'admin', 'Super Admin'], [6, 'admin', 'Founder']] as const) {
      f.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user);
      f.db.prepare('UPDATE member_subscription_amounts SET plan_family = ? WHERE user_id = ?').run(role, user);
      const page = rows.find(r => r.pageKey.startsWith(profile + ' · ') && moduleConnections(r, switches).some(m => m.id === id))!;
      const result = await post(f, { page: page.pageKey, model: id, text: 'Explain this material.' }, 'run', user);
      results.push([profile, result.body.ok]);
    }
    assert.deepEqual(results, ['Founder', 'Investor', 'Advisor', 'Operating Partner', 'Admin', 'Super Admin', 'Founder'].map(p => [p, true]));
    assert.deepEqual(f.db.prepare("SELECT DISTINCT user_id FROM ai_usage_logs WHERE task = 'module_chat' ORDER BY user_id").all().map((r: any) => r.user_id), [1, 2, 3, 4, 5, 6]);
  } finally { f.db.close(); }
});

test('module discovery is authenticated and request bodies are bounded before inference', async () => {
  const f = fixture();
  try {
    const token = await new SignJWT({ user_id: 2 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const url = '/api/ai/modules?page=' + encodeURIComponent(decisionBody.page);
    const allowed = await app.request(url, { headers: { authorization: `Bearer ${token}` } }, f.env);
    const body = await allowed.json() as any;
    const denied = await app.request(url, {}, f.env);
    assert.deepEqual([allowed.status, body.models.some((m: any) => m.id === '@cf/cloudflare/clef'), denied.status], [200, true, 401]);
    const large = await app.request('/api/ai/modules/run', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: ' '.repeat(7_000_001) }, f.env);
    assert.deepEqual([large.status, f.calls.length], [413, 0]);
  } finally { f.db.close(); }
});

test('decision quote/run uses authenticated ownership, typed questions, guard and charged units', async () => {
  const f = fixture(() => ({ answers: { urgent: 0.8 }, usage: { input_tokens: 21 } }));
  try {
    const quote = await post(f, decisionBody, 'quote');
    assert.deepEqual([quote.status, quote.body.ok, f.calls.length], [200, true, 0]);
    const result = await post(f, decisionBody);
    assert.deepEqual([result.status, result.body.ok, result.body.output, result.body.usage.model, result.body.units], [200, true, '{"urgent":0.8}', '@cf/cloudflare/clef', { tokens_in: 21, tokens_out: 0 }]);
    assert.deepEqual(f.calls, [{ id: '@cf/cloudflare/clef', input: { model: 'clef', state: decisionBody.text, questions } }]);
    const logs = f.db.prepare("SELECT user_id,rail_page,surface,charged_microusd FROM ai_usage_logs WHERE task = 'module_decision'").all();
    assert.deepEqual(logs.map((x: any) => [x.user_id, x.rail_page, x.surface, x.charged_microusd > 0]), [[2, decisionBody.page, surfaceFor(decisionBody.page), true]]);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ai_usage_logs WHERE task = 'safety'").get().n > 0, true);
  } finally { f.db.close(); }
});

test('wrong roles, arbitrary member ids, unknown options and unrelated models never run', async () => {
  const f = fixture();
  try {
    const bad = [null, { ...decisionBody, page: 'Super Admin · Platform' }, { ...decisionBody, page: 'Advisor · Home' }, { ...decisionBody, userId: 1 }, { ...decisionBody, option: 'unknown:option' }, { ...decisionBody, model: '@cf/microsoft/resnet-50' }, { ...decisionBody, surface: null }, { ...decisionBody, surface: 'https://example.test/page' }];
    const statuses = [];
    for (const body of bad) statuses.push((await post(f, body ?? decisionBody, 'run', body === null ? null : 2)).status);
    assert.deepEqual({ statuses, calls: f.calls, holds: f.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n }, { statuses: [401, 403, 403, 400, 400, 400, 400, 400], calls: [], holds: 0 });
  } finally { f.db.close(); }
});

test('schema limits and incompatible input shapes refuse before a model call', async () => {
  const f = fixture();
  try {
    const cases = [{ ...decisionBody, questions: {} }, { ...decisionBody, questions: { x: { type: 'unknown', instructions: 'x' } } }, { ...decisionBody, images: [png] }, { ...decisionBody, text: 'x'.repeat(24_001) }];
    assert.deepEqual(await Promise.all(cases.map(async body => (await post(f, body)).status)), [400, 400, 400, 400]);
    assert.deepEqual([questionsValid(questions), questionsValid({ ...questions, constructor: questions.urgent }), f.calls.length], [true, false, 0]);
  } finally { f.db.close(); }
});

test('assist off, no allowance, paused AI and a closed partner gate cannot spend', async () => {
  const outcomes = [];
  for (const mode of ['assist', 'budget', 'paused', 'partner']) {
    const f = fixture();
    try {
      let body: any = decisionBody;
      if (mode === 'assist') f.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES('off',2,?,'','manual')").run(decisionBody.page.toLowerCase());
      if (mode === 'budget') setFixtureAllowance(f.db, 0);
      if (mode === 'paused') f.db.exec('CREATE TABLE IF NOT EXISTS member_ai_pauses(user_id INTEGER PRIMARY KEY,paused_at TEXT,paused_by INTEGER); INSERT INTO member_ai_pauses(user_id) VALUES(2)');
      if (mode === 'partner') { f.env.AI_PARTNER_MODELS = ''; body = { page: 'Founder · Studio', model: '@cf/deepgram/aura-2-en', text: 'Hello.' }; }
      const r = await post(f, body);
      outcomes.push([r.body.ok === true, f.calls.length]);
    } finally { f.db.close(); }
  }
  assert.deepEqual(outcomes, [[false, 0], [false, 0], [false, 0], [false, 0]]);
});

test('unreadable specialist answers are withheld; malformed inputs never become guesses', async () => {
  const sample = { operation: 'decision' as const, questions };
  assert.deepEqual([specialistOutput({}, sample, 'text'), specialistOutput({ answers: { urgent: NaN } }, sample, 'text'), specialistOutput({ answers: { other: 0.5 } }, sample, 'text'), specialistOutput([{ label: 'positive', score: 1.2 }], { operation: 'sentiment' }, 'text'), specialistOutput({ answers: { urgent: -0.1 } }, sample, 'text'), specialistOutput({ answers: { urgent: 'yes' } }, sample, 'text')], [null, null, null, null, null, null]);
  const f = fixture(() => ({ answers: {} }));
  try {
    const r = await post(f, decisionBody);
    assert.deepEqual([r.body.ok, r.body.refusal, f.calls.length], [false, 'all_models_failed', 1]);
  } finally { f.db.close(); }
});

test('sentiment, image labels and turn detection use their own requests and billing units', async () => {
  const captured = [];
  for (const [model, text, extra, answer, expected] of [
    ['@cf/huggingface/distilbert-sst-2-int8', 'Good.', {}, [{ label: 'POSITIVE', score: 0.9 }], { tokens_in: 5, tokens_out: 0 }],
    ['@cf/microsoft/resnet-50', '', { images: [png] }, [{ label: 'object', score: 0.7 }], { images: 1 }],
    ['@cf/pipecat-ai/smart-turn-v2', '', { audio_pcm16: pcm }, { is_complete: true, probability: 0.9 }, { audio_minutes: 1 / 60 }],
  ] as const) {
    const f = fixture(() => answer);
    try {
      const quote = await post(f, { page: pageFor(model).pageKey, model, text, ...extra }, 'quote');
      const result = await post(f, { page: pageFor(model).pageKey, model, text, ...extra });
      const payload = f.calls[0]?.input;
      captured.push([quote.body.ok, result.body.ok, result.body.units, Object.keys(payload ?? {}).sort(), result.body.usage.est_cost_usd > 0]);
      assert.deepEqual(result.body.units, expected);
    } finally { f.db.close(); }
  }
  assert.deepEqual(captured.map(x => [x[0], x[1], x[3], x[4]]), [[true, true, ['text'], true], [true, true, ['image'], true], [true, true, ['audio', 'dtype'], true]]);
  assert.deepEqual([pcmMinutes(pcmBytes(pcm)!), pcmBytes('bad')], [1 / 60, null]);
});

test('standalone embeddings never write axal-search; each model bills its catalogue rate', async () => {
  const results = [];
  for (const [id, c] of Object.entries(MODEL_CONNECTIONS).filter(([, c]) => c.operation === 'embed')) {
    const f = fixture(() => ({ data: [[0.2, 0.8]], usage: { prompt_tokens: 10 } }));
    try {
      const r = await post(f, { page: pageFor(id).pageKey, model: id, text: 'Relevant research.' });
      results.push([r.body.ok, r.body.embedding, Math.abs(r.body.usage.est_cost_usd - Number(unitPrice(id, 'tokens_in')) * 10 / 1e6) < 1e-15, searchIndexAccepts(id, [0.2, 0.8])]);
    } finally { f.db.close(); }
  }
  assert.deepEqual(results, Array(6).fill([true, [0.2, 0.8], true, false]));
  assert.deepEqual([parseEmbed({ data: [[]] }, 'text').vector, parseEmbed({ data: [[NaN]] }, 'text').vector, parseEmbed({ data: [['0.2']] }, 'text').vector], [null, null, null]);
});

test('every newly connected text model actually dispatches through its persona module', async () => {
  const results = [];
  for (const [id, c] of Object.entries(MODEL_CONNECTIONS).filter(([, c]) => c.operation === 'chat')) {
    const f = fixture();
    try {
      const page = pageFor(id), image = CATALOGUE.find(m => m.id === id)!.capabilities.includes('Vision') && page.kind === 'vision';
      // Run the same router path as existing handlers (the endpoint adds role checks).
      const r = await run(f.env, { task: page.routeTask as any, userId: 2, model: id, text: 'Explain the supplied evidence.', rail: { page: page.pageKey }, ...(image ? { images: [png] } : {}) });
      results.push([id, r.ok, r.usage.model, f.calls[0]?.id]);
    } finally { f.db.close(); }
  }
  assert.deepEqual(results, Object.entries(MODEL_CONNECTIONS).filter(([, c]) => c.operation === 'chat').map(([id]) => [id, true, id, id]));
});

test('Moondream uses image-query shape; no reasoning trace is returned as the answer', async () => {
  const f = fixture(() => ({ answer: 'A chart.', reasoning: { text: 'private trace' }, metrics: { input_tokens: 40, output_tokens: 3 } }));
  try {
    const id = '@cf/moondream/moondream3.1-9B-A2B';
    const r = await post(f, { page: pageFor(id).pageKey, model: id, text: 'What is shown?', images: [png] });
    assert.deepEqual([r.body.ok, r.body.output, f.calls[0].input], [true, 'A chart.', { task: 'query', image: png, question: 'What is shown?', max_tokens: 1024 }]);
  } finally { f.db.close(); }
});

test('image specialists bound legitimate classifier output and refuse malformed usage', async () => {
  const labels = Array.from({ length: 1000 }, (_, i) => ({ label: `class-${i}`, score: i / 1000 }));
  const output = specialistOutput(labels, { operation: 'image_labels' }, '')!;
  assert.deepEqual(JSON.parse(output.output).map((x: any) => x.label), ['class-999', 'class-998', 'class-997', 'class-996', 'class-995']);
  const f = fixture(() => ({ answer: 'A chart.', metrics: { input_tokens: 'invalid', output_tokens: 3 } }));
  try {
    const result = await run(f.env, { task: 'module_vision', userId: 2, model: '@cf/moondream/moondream3.1-9B-A2B', text: 'Read this chart.', images: [png] }).catch((error: Error) => ({ ok: 'threw', refusal: error.message }));
    assert.deepEqual([result.ok, result.refusal], [false, 'all_models_failed']);
  } finally { f.db.close(); }
});

test('a speech module can discuss supplied material without treating a chat model as transcription', async () => {
  const f = fixture();
  try {
    const result = await post(f, { page: rows.find(r => r.kind === 'speech')!.pageKey, model: '@cf/daily-co/phonellm-mini-alpha-2', text: 'Draft a short follow-up question.' });
    assert.deepEqual([result.body.ok, result.body.output, Object.keys(f.calls[0].input).sort()], [true, 'Result.', ['max_tokens', 'messages']]);
  } finally { f.db.close(); }
});

test('translation, voices, images, transcription, reranking and each decision model have executable module paths', async () => {
  const operations = ['translate', 'voice', 'draw', 'transcribe', 'rerank', 'decision'];
  const results = [];
  for (const [id, c] of Object.entries(MODEL_CONNECTIONS).filter(([, c]) => operations.includes(c.operation))) {
    const f = fixture((_id, input) => {
      if (c.operation === 'translate') return { translated_text: 'Translated.', translations: ['Translated.'] };
      if (c.operation === 'voice') return new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]);
      if (c.operation === 'draw') return { image: png.split(',')[1] };
      if (c.operation === 'transcribe') return { text: 'Spoken words.', results: { channels: [{ alternatives: [{ transcript: 'Spoken words.' }] }] } };
      if (c.operation === 'rerank') return { response: [{ id: 0, score: 0.9 }] };
      return { answers: { urgent: 0.8 }, usage: { input_tokens: 20 } };
    });
    try {
      const extra = c.operation === 'translate' ? { source_language: 'en', target_language: 'hi' }
        : c.operation === 'transcribe' ? { audio_pcm16: pcm }
          : c.operation === 'rerank' ? { contexts: ['A relevant passage.'] }
            : c.operation === 'decision' ? { questions } : {};
      const result = await post(f, { page: pageFor(id).pageKey, model: id, text: 'Describe this evidence.', ...extra });
      results.push([id, result.body.ok, result.body.usage?.model, f.calls[0]?.id, result.body.usage?.est_cost_usd > 0]);
    } finally { f.db.close(); }
  }
  assert.deepEqual(results, Object.entries(MODEL_CONNECTIONS).filter(([, c]) => operations.includes(c.operation)).map(([id]) => [id, true, id, id, true]));
});

test('Indic translation refuses unsupported directions and mixed-shape requests', async () => {
  const f = fixture();
  try {
    const id = '@cf/ai4bharat/indictrans2-en-indic-1B';
    const statuses = [];
    for (const extra of [{ source_language: 'fr', target_language: 'hi' }, { source_language: 'en', target_language: 'fr' }, { source_language: 'en', target_language: 'hi', images: [png] }]) {
      statuses.push((await post(f, { page: pageFor(id).pageKey, model: id, text: 'A passage.', ...extra })).status);
    }
    assert.deepEqual({ statuses, calls: f.calls.length }, { statuses: [400, 400, 400], calls: 0 });
  } finally { f.db.close(); }
});

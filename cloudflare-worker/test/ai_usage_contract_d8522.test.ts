// D8522 (#8522): every `ai_usage_logs` row carries one contract, and `recordUsage` is the only writer.
// Real SQLite on the whole migrated schema. Each writer is driven with the exact `who`, usage and
// charge it passes today, and its stored row is held to the contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordUsage, type UsageMeta } from '../src/services/aiRouter.ts';
import { NOT_REPORTED, contractProblems, providerOfModel, usageContract } from '../src/services/aiUsageContract.ts';
import { stringLiterals } from '../../scripts/lib/usageTablesMatrix.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return { db, env: { DB: d1Over(db), ENVIRONMENT: 'development' } as any };
}
const usage = (over: Partial<UsageMeta> = {}): UsageMeta => ({
  task: 'transcribe' as any, model: '@cf/openai/whisper', latency_ms: 10, prompt_tokens: 0, completion_tokens: 0,
  est_cost_usd: 0.01, fallback_used: false, cached: false, safety_score: null, ...over,
});

/** The row as the contract reads it: a NULL legacy column is its "not reported", the three new ones are never empty. */
function contractOf(r: any) {
  return usageContract({
    surface: r.surface, model: r.model, provider: r.provider, prompt_tokens: r.prompt_tokens, completion_tokens: r.completion_tokens,
    tokens_reported: r.tokens_reported === 1, user_id: r.user_id, agent_id: r.agent_id, request_id: r.request_id,
  });
}
function assertContract(r: any, label: string) {
  assert.ok(r, `${label}: a row was written`);
  assert.deepEqual(contractProblems(contractOf(r)), [], `${label}: the contract holds`);
  for (const k of ['provider', 'request_id'] as const) assert.ok(typeof r[k] === 'string' && r[k].length > 0, `${label}: ${k} is stored, not NULL`);
  assert.ok(r.tokens_reported === 0 || r.tokens_reported === 1, `${label}: tokens_reported is stored`);
}
const last = (db: DatabaseSync) => db.prepare('SELECT * FROM ai_usage_logs ORDER BY id DESC LIMIT 1').get() as any;

// ---- the contract itself ----
test('a field the writer cannot supply reads "not reported", and the check names a field that is missing', () => {
  const c = usageContract({ surface: null, model: '', prompt_tokens: Number.NaN, completion_tokens: -4 });
  assert.equal(c.surface, NOT_REPORTED);
  assert.equal(c.provider, NOT_REPORTED);
  assert.equal(c.request_id, NOT_REPORTED);
  assert.equal(c.payer.label, NOT_REPORTED);
  assert.equal(c.prompt_tokens, 0);
  assert.equal(c.completion_tokens, 0);
  assert.equal(c.tokens_reported, false);
  assert.deepEqual(contractProblems(c), []);
  assert.deepEqual(contractProblems({ ...c, provider: '', request_id: undefined as any, payer: undefined as any }).sort(), ['payer', 'provider', 'request_id']);
  assert.deepEqual(contractProblems(null), ['row']);
  const ok = usageContract({ surface: '/x', model: 'm', prompt_tokens: 1, completion_tokens: 1 });
  for (const k of ['surface', 'provider', 'model', 'request_id', 'prompt_tokens', 'completion_tokens', 'tokens_reported', 'payer']) {
    assert.deepEqual(contractProblems({ ...ok, [k]: undefined } as any), [k], `${k} missing is named`);
  }
  assert.deepEqual(contractProblems({ ...ok, prompt_tokens: -1 }), ['prompt_tokens']);
});

test('the provider comes from the caller, else from the model name', () => {
  assert.equal(providerOfModel('@cf/meta/llama-3.1-8b-instruct'), 'workers-ai');
  assert.equal(providerOfModel('bria/remove-background'), 'bria');
  assert.equal(providerOfModel('whatever'), NOT_REPORTED);
  assert.equal(usageContract({ surface: null, model: 'bria/x', provider: 'acme', prompt_tokens: 0, completion_tokens: 0 }).provider, 'acme');
  assert.equal(usageContract({ surface: null, model: 'bria/x', agent_id: 7, user_id: 3, prompt_tokens: 0, completion_tokens: 0 }).payer.label, 'agent:7');
});

// ---- one test per writer ----
test('the router run path: a model run with reported tokens, a request id and an agent payer', async () => {
  const { db, env } = fixture();
  await recordUsage(env, { userId: 4, agentId: 9, surface: '/advisor', requestId: 'req-1' },
    usage({ task: 'advisor_turn' as any, model: '@cf/meta/llama-3.1-8b-instruct', prompt_tokens: 120, completion_tokens: 30 }), null, { charged: 500 });
  const r = last(db);
  assertContract(r, 'router');
  assert.equal(r.provider, 'workers-ai');
  assert.equal(r.request_id, 'req-1');
  assert.equal(r.tokens_reported, 1);
  assert.equal(r.surface, '/advisor');
});

test('the router refusal path: a refused run has no tokens and says the zero is real', async () => {
  const { db, env } = fixture();
  await recordUsage(env, { userId: 4 }, usage({ task: 'advisor_turn' as any, model: '@cf/meta/llama-3.1-8b-instruct' }), 'budget_user_day');
  const r = last(db);
  assertContract(r, 'refusal');
  assert.equal(r.request_id, NOT_REPORTED);
  assert.equal(r.tokens_reported, 1);
  assert.equal(r.surface, null);
});

test('decide / the deck runtime: a run for a deck record writes through the same function', async () => {
  const { db, env } = fixture();
  await recordUsage(env, { userId: 4, surface: '/raise/pitch', railPage: 'raise', railOption: 'deck.outline', recordRef: 'deck:7' },
    usage({ task: 'generate' as any, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', prompt_tokens: 900, completion_tokens: 400 }), null, { charged: 1200, reservationUid: 'hold-1' });
  assertContract(last(db), 'deck run');
});

test('the agent run: the row names its agent as the payer', async () => {
  const { db, env } = fixture();
  await recordUsage(env, { userId: 4, agentId: 12 }, usage({ task: 'agent_step' as any, prompt_tokens: 50, completion_tokens: 20, model: '@cf/zai-org/glm-4.7-flash' }), null, { charged: 40 });
  const r = last(db);
  assertContract(r, 'agent run');
  assert.equal(r.agent_id, 12);
  assert.equal(contractOf(r).payer.label, 'agent:12');
});

test('a D851 provider run names its provider and says its tokens were not reported', async () => {
  const { db, env } = fixture();
  await recordUsage(env, { userId: 4 }, usage({ task: 'generate' as any, model: 'claude-x' }), null,
    { charged: 10, units: { provider: 'anthropic', pricing_version: 'p1', usage_reported: false } });
  const r = last(db);
  assertContract(r, 'provider');
  assert.equal(r.provider, 'anthropic');
  assert.equal(r.tokens_reported, 0);
  await recordUsage(env, { userId: 4 }, usage({ task: 'generate' as any, model: 'claude-x' }), null,
    { charged: 10, units: { provider: 'anthropic', pricing_version: 'p1', usage_reported: true } });
  assert.equal(last(db).tokens_reported, 1, 'the provider said its usage is reported, so a zero is a zero');
});

test('image tools: a gateway image call is a Bria row with no tokens, charged to the member', async () => {
  const { db, env } = fixture();
  await recordUsage(env, { userId: 4, surface: '/raise/pitch' }, usage({ task: 'image_edit' as any, model: 'bria/remove-background', est_cost_usd: 0.02 }), null,
    { charged: 20000, reservationUid: 'hold-2', units: { images: 1, provider: 'bria' } });
  const r = last(db);
  assertContract(r, 'image tools');
  assert.equal(r.provider, 'bria');
  assert.equal(r.tokens_reported, 0);
});

test('live transcription and rehearsal live: a minutes-metered stream has no tokens and no request id', async () => {
  const { db, env } = fixture();
  await recordUsage(env, { userId: 4, surface: '/meetings' }, usage({ model: '@cf/deepgram/nova-3' }), null, { charged: 300, units: { websocket_minutes: 2 } });
  await recordUsage(env, { userId: 4, surface: '/raise/pitch', railPage: 'raise', railOption: 'rehearsal.live', recordRef: 'deck:7' }, usage({ model: '@cf/deepgram/nova-3' }), null, { charged: 300, units: { websocket_minutes: 1 } });
  const rows = db.prepare('SELECT * FROM ai_usage_logs ORDER BY id').all() as any[];
  assert.equal(rows.length, 2);
  for (const r of rows) { assertContract(r, 'stream'); assert.equal(r.tokens_reported, 0); assert.equal(r.request_id, NOT_REPORTED); }
});

test('a system run with no payer is written with the payer not reported, and is still counted', async () => {
  const { db, env } = fixture();
  await recordUsage(env, {} as any, usage({ prompt_tokens: 3, completion_tokens: 1 }), null);
  const r = last(db);
  assertContract(r, 'system');
  assert.equal(r.user_id, null);
  assert.equal(contractOf(r).payer.label, NOT_REPORTED);
});

// ---- the guard ----
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const WRITE = /\b(?:INSERT(?:\s+OR\s+\w+)?|REPLACE)\s+INTO\s+ai_usage_logs\b/i;
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(ts|mjs|js)$/.test(n) && !/\.d\.ts$/.test(n) ? [p] : [];
  });
}
/** Every file and line that inserts into the usage table, from the string literals of the sources given. */
export function usageWriters(files: Array<{ path: string; src: string }>): string[] {
  return files.flatMap((f) => stringLiterals(f.src).filter((l: any) => WRITE.test(l.text)).map((l: any) => `${f.path}:${l.line}`));
}

test('guard: only recordUsage inserts into ai_usage_logs', () => {
  const files = filesUnder(SRC).map((p) => ({ path: relative(SRC, p), src: readFileSync(p, 'utf8') }));
  const writers = usageWriters(files);
  const outside = writers.filter((w) => !w.startsWith('services/aiRouter.ts:'));
  assert.deepEqual(outside, [], 'a direct insert into ai_usage_logs bypasses the contract: call recordUsage (services/aiRouter.ts)');
  assert.equal(writers.length, 2, 'recordUsage has two statements, with and without agent_id');
});

test('guard: it fails on a direct insert, however it is spelled', () => {
  const stray = (sql: string) => usageWriters([{ path: 'routes/x.ts', src: `const s = db.prepare(\`${sql}\`);` }]);
  assert.equal(stray('INSERT INTO ai_usage_logs (task) VALUES (?)').length, 1);
  assert.equal(stray('insert or ignore into ai_usage_logs(task) values (?)').length, 1);
  assert.equal(stray('INSERT\n  INTO ai_usage_logs (task) VALUES (?)').length, 1);
  assert.equal(stray('REPLACE INTO ai_usage_logs (id) VALUES (1)').length, 1);
  assert.equal(stray('UPDATE ai_usage_logs SET units_json = ? WHERE id = ?').length, 0, 'a stamp on an existing row is not a new row');
  assert.equal(stray('SELECT * FROM ai_usage_logs').length, 0);
});

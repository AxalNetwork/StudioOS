/**
 * D843 (#2465) — one attributable `api_usage_events` row per MCP tool call.
 *
 * Drives the real `callTool` (mcp/server.ts) with stub tools, in the
 * mcp_server_d666 fixture style: node:sqlite holding `users`, `projects` and
 * `activity_logs` from the baseline plus migration 524 itself, and an
 * in-memory KV for the per-grant limit. Covers the four outcomes, the error
 * categories, the NULL money fields, a swallowed write failure and the
 * `_meta.execution_id` every result carries.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/api_usage_events_d843.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { callTool, type McpTool } from '../src/mcp/server.ts';
import { GRANT_CALLS_PER_MINUTE, type GrantProps } from '../src/mcp/grants.ts';
import { USAGE_ERROR_CATEGORIES, newExecutionId, recordUsage } from '../src/services/apiUsage.ts';
import { ToolError } from '../src/services/assistantInterviews.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';

const ROOT = resolve(process.cwd());
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const M524 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/524_api_usage_events.sql'), 'utf8');

const FOUNDER = 10, GONE = 11;
const P = 1, P_OTHER = 3;
const GRANT = 'grant-d843';
const SECRET_ARG = 'SECRET-ARGUMENT-TEXT';
const SECRET_RESULT = 'SECRET-RESULT-TEXT';

function fixture({ table = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs']) db.exec(tableFromBaseline(BASELINE, t));
  if (table) db.exec(M524);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, ?, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1, 1001);
  u.run(GONE, 'founder', 'Gus Gone', 'gus@example.test', 0, 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme', 1001), (${P_OTHER}, 'Beta', 1002)`);
  const env: any = { ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: memKV() };
  return { db, env };
}

const props = (over: Partial<GrantProps> & { apiKeyUid?: string } = {}): GrantProps => ({
  userId: FOUNDER, clientId: 'client-1', companies: [P], clientName: 'Test Assistant',
  redirectHost: null, redirectUri: null, grantedAt: Math.floor(Date.now() / 1000), ...over,
});

const tool = (over: Partial<McpTool> = {}): McpTool => ({
  name: 'stub_read', requiredScope: 'validate:read', source: 'axal', version: '1.0.0', title: 'Stub', description: 'A stub tool.',
  inputSchema: {}, company: true, run: async () => ({ answer: SECRET_RESULT }), ...over,
});

const SCOPE = ['validate:read'];
const quiet = async <T>(f: () => Promise<T>) => {
  const saved = [console.warn, console.error];
  const warnings: string[] = [];
  console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(' ')); };
  console.error = () => {};
  try { return { value: await f(), warnings }; } finally { [console.warn, console.error] = saved; }
};

const rows = (db: InstanceType<typeof DatabaseSync>) => db.prepare('SELECT * FROM api_usage_events ORDER BY id').all() as any[];
const metaId = (r: any) => r?._meta?.execution_id as string | undefined;

test('ok: one row with execution id, duration, operation and outcome, and the same id in _meta', async () => {
  const { db, env } = fixture();
  const { value: res } = await quiet(() => callTool(env, props(), GRANT, tool(), { company: P, note: SECRET_ARG }, SCOPE));
  assert.equal(res.isError, undefined);
  const all = rows(db);
  assert.equal(all.length, 1, 'exactly one row');
  const r = all[0];
  assert.match(r.execution_id, /^[0-9a-f-]{36}$/);
  assert.equal(metaId(res), r.execution_id, 'the result quotes the row\'s execution id');
  assert.deepEqual(
    { user: r.user_id, op: r.operation, outcome: r.outcome, cat: r.error_category, surface: r.surface, grant: r.grant_id, client: r.client, company: r.company_id },
    { user: FOUNDER, op: 'stub_read', outcome: 'ok', cat: null, surface: 'mcp', grant: GRANT, client: 'Test Assistant', company: P },
  );
  assert.equal(typeof r.duration_ms, 'number');
  assert.ok(r.duration_ms >= 0);
  // The activity_logs line is kept beside it.
  assert.equal((db.prepare(`SELECT count(*) AS n FROM activity_logs WHERE action = 'mcp_tool_call'`).get() as any).n, 1);
});

test('refused: the scope, company, account and tool refusals each write one row with their category', async () => {
  const { db, env } = fixture();
  const cases: Array<[string, () => Promise<any>, string]> = [
    ['scope', () => callTool(env, props(), GRANT, tool({ requiredScope: 'validate:write' }), { company: P }, SCOPE), 'scope'],
    ['company outside the grant', () => callTool(env, props(), GRANT, tool(), { company: P_OTHER }, SCOPE), 'company'],
    ['ended account', () => callTool(env, props({ userId: GONE }), GRANT, tool(), { company: P }, SCOPE), 'auth'],
    ['bad input', () => callTool(env, props(), GRANT, tool({ run: async () => { throw new ToolError(400, 'notes_empty', 'The notes are empty.'); } }), { company: P }, SCOPE), 'invalid_input'],
    ['lost venture', () => callTool(env, props(), GRANT, tool({ run: async () => { throw new ToolError(403, 'cannot_write', 'No.'); } }), { company: P }, SCOPE), 'company'],
  ];
  for (const [label, call, category] of cases) {
    const before = rows(db).length;
    const { value: res } = await quiet(call);
    const after = rows(db);
    assert.equal(after.length, before + 1, `${label}: exactly one row`);
    const r = after.at(-1);
    assert.equal(r.outcome, 'refused', label);
    assert.equal(r.error_category, category, label);
    assert.equal(res.isError, true, label);
    assert.equal(metaId(res), r.execution_id, `${label}: _meta carries the id`);
  }
  // A refused account is still attributed to the grant's user.
  assert.equal(rows(db).find((r) => r.error_category === 'auth').user_id, GONE);
});

test('error and rate_limited each write one row', async () => {
  const { db, env } = fixture();
  const { value: failed } = await quiet(() => callTool(env, props(), GRANT, tool({ run: async () => { throw new Error('boom ' + SECRET_RESULT); } }), { company: P }, SCOPE));
  let r = rows(db).at(-1);
  assert.deepEqual([r.outcome, r.error_category], ['error', 'internal']);
  assert.equal(metaId(failed), r.execution_id);

  const minute = Math.floor(Date.now() / 60_000);
  await env.RATE_LIMITS.put(`mcp_rl:${GRANT}:${minute}`, String(GRANT_CALLS_PER_MINUTE), { expirationTtl: 120 });
  const { value: limited } = await quiet(() => callTool(env, props(), GRANT, tool(), { company: P }, SCOPE));
  r = rows(db).at(-1);
  assert.deepEqual([r.outcome, r.error_category], ['rate_limited', 'rate_limited']);
  assert.equal(metaId(limited), r.execution_id);
  assert.equal(rows(db).length, 2);
  assert.equal(new Set(rows(db).map((x) => x.execution_id)).size, 2, 'each call has its own execution id');
});

test('no argument or result text is stored, and the money fields are NULL, never 0', async () => {
  const { db, env } = fixture();
  await quiet(() => callTool(env, props(), GRANT, tool(), { company: P, note: SECRET_ARG }, SCOPE));
  await quiet(() => callTool(env, props(), GRANT, tool({ run: async () => { throw new Error(SECRET_RESULT); } }), { company: P, note: SECRET_ARG }, SCOPE));
  const dump = JSON.stringify(rows(db));
  assert.equal(dump.includes(SECRET_ARG), false, 'an argument was stored');
  assert.equal(dump.includes(SECRET_RESULT), false, 'a result or error text was stored');
  for (const r of rows(db)) {
    for (const k of ['reservation_uid', 'held_microusd', 'charged_microusd', 'model', 'provider', 'connector', 'api_key_uid']) {
      assert.equal(r[k], null, `${k} must be NULL until something supplies it`);
    }
  }
  // recordUsage itself: unknown and invalid amounts are NULL; a real amount is kept as a whole number.
  const { db: db2, env: env2 } = fixture();
  await recordUsage(env2, { executionId: 'a', userId: FOUNDER, surface: 'api', operation: 'x', outcome: 'ok', durationMs: 1, heldMicrousd: -5, chargedMicrousd: Number.NaN });
  await recordUsage(env2, { executionId: 'b', userId: FOUNDER, surface: 'api', operation: 'x', outcome: 'ok', durationMs: 1, heldMicrousd: 1200, chargedMicrousd: 999.6, reservationUid: 'res-1' });
  const [a, b] = rows(db2);
  assert.deepEqual([a.held_microusd, a.charged_microusd], [null, null]);
  assert.deepEqual([b.held_microusd, b.charged_microusd, b.reservation_uid], [1200, 1000, 'res-1']);
});

test('a failed usage write does not fail the tool call', async () => {
  const { env } = fixture({ table: false });
  const { value: res, warnings } = await quiet(() => callTool(env, props(), GRANT, tool(), { company: P }, SCOPE));
  assert.equal(res.isError, undefined, 'the call still answers');
  assert.deepEqual(JSON.parse(res.content[0].text), { answer: SECRET_RESULT });
  assert.ok(metaId(res), 'and still carries its execution id');
  assert.ok(warnings.some((w) => w.includes('[api-usage]') && w.includes(metaId(res)!)), 'the failure is a warning naming the execution id');
  assert.equal(warnings.some((w) => w.includes(SECRET_RESULT)), false);
  const direct = await quiet(() => recordUsage(env, { executionId: newExecutionId(), userId: 1, surface: 'mcp', operation: 'x', outcome: 'ok', durationMs: 0 }));
  assert.equal(direct.value, false);
});

test('an API key on the principal is recorded; categories match the migration\'s CHECK', async () => {
  const { db, env } = fixture();
  await quiet(() => callTool(env, props({ apiKeyUid: 'key-uid-1' }), null, tool(), { company: P }, SCOPE));
  const r = rows(db).at(-1);
  assert.deepEqual([r.api_key_uid, r.grant_id], ['key-uid-1', null]);

  assert.deepEqual([...USAGE_ERROR_CATEGORIES],
    ['auth', 'scope', 'company', 'rate_limited', 'insufficient_tokens', 'timeout', 'provider', 'invalid_input', 'internal']);
  for (const c of USAGE_ERROR_CATEGORIES) assert.ok(M524.includes(`'${c}'`), `${c} is in the CHECK`);
  // An outcome that is not ok always has a category; ok never has one.
  await recordUsage(env, { executionId: 'nocat', userId: FOUNDER, surface: 'mcp', operation: 'x', outcome: 'error', durationMs: 0 });
  await recordUsage(env, { executionId: 'okcat', userId: FOUNDER, surface: 'mcp', operation: 'x', outcome: 'ok', durationMs: 0, errorCategory: 'internal' });
  const byId = Object.fromEntries(rows(db).map((x) => [x.execution_id, x.error_category]));
  assert.deepEqual([byId.nocat, byId.okcat], ['internal', null]);
});

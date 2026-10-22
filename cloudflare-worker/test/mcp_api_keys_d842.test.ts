/**
 * D842 (#2470) — `/mcp` with a member API key (D841): the key resolves to the
 * principal an OAuth grant does and every per-call check applies; refused keys
 * answer 401 without saying whether the id exists, an IP that keeps failing is
 * throttled, a key is counted at its own rate; every call carries an execution
 * id, a slow tool answers `timeout`, and refusals carry a code.
 *
 * Runs on D666's real fixture (in-memory KV, SQLite D1) with migration 523.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/mcp_api_keys_d842.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import worker from '../src/index.ts';
import * as server from '../src/mcp/server.ts';
import { KEY_REFUSALS, bearerOf } from '../src/mcp/oauth.ts';
import { KEY_FAILURES_PER_MINUTE } from '../src/mcp/grants.ts';
import { createKey, revokeKey } from '../src/services/apiKeys.ts';
import { bumpJwtMinIat } from '../src/auth.ts';
import { ToolError } from '../src/services/assistantInterviews.ts';
import { fixture as d666Fixture, connect } from './mcp_server_d666.test.ts';

const FOUNDER = 10;
const P = 1, P2 = 2, P_OTHER = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MIGRATION = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/523_member_api_keys.sql'), 'utf8');

// A slow tool and a failing one, behind the Raise + Grow plan so D666's own
// listing (a free founder) never shows them.
const SLOW: server.McpTool = {
  name: 'd842_slow', requiredScope: 'validate:read', source: 'axal', version: '1.0.0', entitlement: 'studio', timeoutMs: 40,
  title: 'Slow', description: 'A test tool that never answers in time.', inputSchema: {}, company: false,
  run: ({ signal }) => new Promise((done) => { signal.addEventListener('abort', () => { aborted.push(true); done({ late: true }); }); }),
};
const aborted: boolean[] = [];
const BROKE: server.McpTool = {
  name: 'd842_out_of_tokens', requiredScope: 'validate:read', source: 'axal', version: '1.0.0', entitlement: 'studio',
  title: 'Out of tokens', description: 'A test tool whose member is out of AI tokens.', inputSchema: {}, company: false,
  run: async () => { throw new ToolError(402, 'budget_user_month', 'raw sentence'); },
};
server.registerMcpTools([SLOW, BROKE]);

function fixture({ enabled = true } = {}) {
  const f = d666Fixture();
  f.db.exec(MIGRATION);
  if (enabled) f.env.API_KEYS_ENABLED = 'true';
  return f;
}

const ctx: any = { waitUntil() {}, passThroughOnException() {} };
let rpcId = 0;
/** One JSON-RPC request to /mcp, as `ip`, with console output captured. */
async function mcp(env: any, token: string | null, method: string, params: unknown = {}, ip = '203.0.113.7') {
  const said: string[] = [];
  const saved = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = (...a: unknown[]) => { said.push(a.map(String).join(' ')); };
  try {
    const r = await worker.fetch(new Request('https://axal.vc/mcp', { method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18',
      'CF-Connecting-IP': ip, ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) }), env, ctx);
    return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) as any, said };
  } finally { [console.log, console.warn, console.error] = saved; }
}
const call = (env: any, token: string, name: string, args: Record<string, unknown> = {}) => mcp(env, token, 'tools/call', { name, arguments: args });
const json = (r: any) => JSON.parse(r.body.result.content[0].text);

async function key(env: any, spec: Partial<{ scopes: string[]; companies: number[]; expiresInDays: number | null; ratePerMinute: number }> = {}) {
  return createKey(env, FOUNDER, { name: 'CI key', scopes: ['validate:read', 'validate:write'], companies: [P], expiresInDays: null, limit: null, ...spec });
}

// ── The key branch ─────────────────────────────────────────────────────────

test('a valid key: initialize, tools/list and tools/call work, with an execution id and last_used_at written', async () => {
  const { env, db } = fixture();
  const { row, secret } = await key(env);
  const init = await mcp(env, secret, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ci', version: '1' } });
  assert.equal(init.status, 200, JSON.stringify(init.body));
  assert.equal(init.body.result.serverInfo.name, 'StudioOS');
  const list = await mcp(env, secret, 'tools/list');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.result.tools.map((t: any) => t.name).sort(),
    ['assign_chat_to_interview', 'extract_action_items', 'get_interview_guide', 'get_meeting_transcript', 'get_session_insights', 'get_validate_context', 'list_channel_chats', 'list_companies', 'list_meetings', 'propose_placements', 'structure_with_studioos', 'submit_interview', 'summarize_meeting']);
  const r = await call(env, secret, 'list_companies');
  assert.equal(r.body.result.isError, undefined, JSON.stringify(r.body));
  assert.deepEqual(json(r).companies, [{ id: P, name: 'Acme' }]);
  assert.match(r.body.result._meta[server.EXECUTION_META], UUID);
  const again = await call(env, secret, 'list_companies');
  assert.notEqual(again.body.result._meta[server.EXECUTION_META], r.body.result._meta[server.EXECUTION_META], 'one id per call');
  const used = db.prepare('SELECT last_used_at FROM member_api_keys WHERE uid = ?').get(row.uid) as any;
  assert.match(String(used.last_used_at), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('the activity line names the key by its uid, and nothing anywhere carries the secret', async () => {
  const { env, db } = fixture();
  const { row, secret } = await key(env);
  const r = await call(env, secret, 'get_interview_guide', { company: P });
  const rows = db.prepare(`SELECT user_id, project_id, details FROM activity_logs WHERE action = 'mcp_tool_call'`).all() as any[];
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0].details), { tool: 'get_interview_guide', company_id: P, client: 'CI key', outcome: 'ok', api_key_uid: row.uid });
  const secretPart = secret.split('_')[2];
  for (const said of [JSON.stringify(db.prepare('SELECT * FROM activity_logs').all()), r.said.join('\n'), JSON.stringify(r.body)]) {
    assert.ok(!said.includes(secretPart), 'the secret never leaves');
  }
  // A failed lookup logs nothing either.
  assert.ok(!(await mcp(env, `${secret}x`, 'tools/list')).said.join('\n').includes(secretPart));
});

test('revoked, expired, wrong-secret, unknown and malformed keys get 401, with a code and no hint whether the id exists', async () => {
  const { env, db } = fixture();
  const live = await key(env);
  const revoked = await key(env);
  await revokeKey(env, FOUNDER, revoked.row.uid);
  const expired = await key(env, { expiresInDays: 1 });
  db.prepare(`UPDATE member_api_keys SET expires_at = datetime('now', '-1 minute') WHERE uid = ?`).run(expired.row.uid);
  const [, id, secretPart] = live.secret.split('_');
  const wrongSecret = `axk_${id}_${secretPart.slice(0, -1)}${secretPart.endsWith('A') ? 'B' : 'A'}`;
  const unknown = `axk_${'z'.repeat(12)}_${secretPart}`;
  const cases: [string, string][] = [[revoked.secret, 'revoked_key'], [expired.secret, 'expired_key'],
    [wrongSecret, 'invalid_key'], [unknown, 'invalid_key'], ['axk_short', 'invalid_key']];
  for (const [i, [bearer, code]] of cases.entries()) {
    const r = await mcp(env, bearer, 'tools/list', {}, `198.51.100.${i}`);
    assert.equal(r.status, 401, code);
    assert.deepEqual(r.body, { error: code, message: KEY_REFUSALS[code as keyof typeof KEY_REFUSALS] });
    assert.equal(r.headers.get('WWW-Authenticate'), `Bearer error="invalid_token", error_description="${code}"`);
  }
  // The wrong secret and the unknown id read alike.
  const a = await mcp(env, wrongSecret, 'tools/list', {}, '198.51.100.50');
  const b = await mcp(env, unknown, 'tools/list', {}, '198.51.100.51');
  assert.deepEqual([a.status, a.body], [b.status, b.body]);
});

test('an axk_ bearer never reaches the OAuth provider, and with API_KEYS_ENABLED off it is invalid_key', async () => {
  const { env } = fixture({ enabled: false });
  const { secret } = await key(env);
  const r = await mcp(env, secret, 'tools/list');
  assert.deepEqual([r.status, r.body.error], [401, 'invalid_key']);
  // An OAuth token still works with the flag off.
  const { token } = await connect(env, [P]);
  assert.equal((await mcp(env, token, 'tools/list')).status, 200);
  assert.equal(bearerOf(new Request('https://axal.vc/mcp', { headers: { Authorization: 'bearer  axk_x' } })), 'axk_x');
  assert.equal(bearerOf(new Request('https://axal.vc/mcp', { headers: { Authorization: 'Basic axk_x' } })), null);
});

test('an IP that fails 10 lookups in a minute is refused before the lookup, even with a valid key', async () => {
  const { env } = fixture();
  const { secret } = await key(env);
  const bad = `axk_${'q'.repeat(12)}_${'x'.repeat(43)}`;
  for (let i = 0; i < KEY_FAILURES_PER_MINUTE; i += 1) assert.equal((await mcp(env, bad, 'tools/list', {}, '192.0.2.9')).status, 401, `failure ${i + 1}`);
  const tripped = await mcp(env, secret, 'tools/list', {}, '192.0.2.9');
  assert.deepEqual([tripped.status, tripped.body.error, tripped.headers.get('Retry-After')], [429, 'rate_limited', '60']);
  assert.equal((await mcp(env, secret, 'tools/list', {}, '192.0.2.10')).status, 200, 'another IP is not throttled');
  // A failure counter that cannot be read fails closed, the key's own counter working.
  const broken = fixture().env;
  const kv = broken.RATE_LIMITS;
  broken.RATE_LIMITS = { ...kv, get: async (k: string, ...rest: unknown[]) => {
    if (k.startsWith('mcp_keyfail:')) throw new Error('kv down');
    return kv.get(k, ...rest);
  } };
  const k2 = await key(broken);
  const closed = await mcp(broken, k2.secret, 'tools/list');
  assert.deepEqual([closed.status, closed.body.error], [429, 'rate_limited']);
});

test('a key is counted at its own rate_per_minute: 429 with Retry-After past it', async () => {
  const { env } = fixture();
  const { secret } = await key(env, { ratePerMinute: 3 });
  for (let i = 0; i < 3; i += 1) assert.equal((await mcp(env, secret, 'tools/list')).status, 200);
  const over = await mcp(env, secret, 'tools/list');
  assert.deepEqual([over.status, over.body, over.headers.get('Retry-After')], [429, { error: 'rate_limited', message: KEY_REFUSALS.rate_limited }, '60']);
  const other = await key(env, { ratePerMinute: 3 });
  assert.equal((await mcp(env, other.secret, 'tools/list')).status, 200, 'each key has its own count');
});

// ── The per-call checks ────────────────────────────────────────────────────

test('a key without validate:write is not listed a write tool and cannot call one; the check itself answers insufficient_scope', async () => {
  const { env } = fixture();
  const { row, secret } = await key(env, { scopes: ['validate:read'] });
  const names = (await mcp(env, secret, 'tools/list')).body.result.tools.map((t: any) => t.name);
  assert.ok(!names.includes('submit_interview') && names.includes('list_companies'), names.join());
  const r = await call(env, secret, 'submit_interview', { company: P });
  assert.equal(r.body.result.isError, true);
  assert.equal(json(r).error, server.NOT_AVAILABLE);
  // Past the listing gate, the call's own scope check names the code and the key's remedy.
  const write = server.registeredTools().find((t) => t.name === 'submit_interview')!;
  const props = { userId: FOUNDER, clientId: `apikey:${row.uid}`, companies: [P], clientName: 'CI key', redirectHost: null, redirectUri: null, grantedAt: Math.floor(Date.now() / 1000) - 60, keyUid: row.uid };
  const direct = await server.callTool(env, props, null, write, { company: P }, ['validate:read']);
  const body = JSON.parse(direct.content[0].text);
  assert.deepEqual([body.code, body.error], ['insufficient_scope', 'This key needs validate:write for submit_interview. Create a key with that permission.']);
  assert.match((direct as any)._meta[server.EXECUTION_META], UUID);
});

test('a key cannot reach a company outside its list, nor one its creator has lost', async () => {
  const { env, db } = fixture();
  const { secret } = await key(env, { companies: [P] });
  for (const company of [P2, P_OTHER]) {
    const r = await call(env, secret, 'get_validate_context', { company });
    assert.equal(r.body.result.isError, true);
    assert.equal(json(r).code, 'refused');
  }
  assert.equal((await call(env, secret, 'get_validate_context', { company: P })).body.result.isError, undefined);
  db.exec(`UPDATE projects SET founder_id = 1002 WHERE id = ${P}`);
  const lost = await call(env, secret, 'get_validate_context', { company: P });
  assert.match(json(lost).error, /can no longer read that company/);
  assert.deepEqual(json(await call(env, secret, 'list_companies')).companies, []);
});

test('signing out everywhere ends every key made before it', async () => {
  const { env } = fixture();
  const { secret } = await key(env);
  assert.equal((await mcp(env, secret, 'tools/list')).status, 200);
  await bumpJwtMinIat(env, FOUNDER);
  const r = await mcp(env, secret, 'tools/list');
  assert.deepEqual([r.status, r.body.error], [401, 'revoked_key']);
});

// ── Execution ──────────────────────────────────────────────────────────────

test('a slow tool is stopped at its time limit: a timeout error, the signal aborted, the call logged', async () => {
  const { env, db } = fixture();
  db.exec(`UPDATE users SET subscription_tier = 'studio', subscription_status = 'active' WHERE id = ${FOUNDER}`);
  const { secret } = await key(env);
  assert.equal(server.TOOL_TIMEOUT_MS, 20_000);
  aborted.length = 0;
  const started = Date.now();
  const r = await call(env, secret, 'd842_slow');
  assert.ok(Date.now() - started < 5_000);
  assert.equal(r.body.result.isError, true, JSON.stringify(r.body));
  assert.deepEqual(json(r), { error: 'That call took too long and was stopped. Try again, or ask for less at once.', code: 'timeout' });
  assert.match(r.body.result._meta[server.EXECUTION_META], UUID);
  assert.deepEqual(aborted, [true], 'the tool saw the abort');
  const row = db.prepare(`SELECT details FROM activity_logs WHERE action = 'mcp_tool_call'`).get() as any;
  assert.equal(JSON.parse(row.details).outcome, 'timeout');
});

test('a member out of AI tokens gets insufficient_tokens with the #2466 body, unknown amounts null, never 0', async () => {
  const { env, db } = fixture();
  db.exec(`UPDATE users SET subscription_tier = 'studio', subscription_status = 'active' WHERE id = ${FOUNDER}`);
  const { secret } = await key(env);
  const body = json(await call(env, secret, 'd842_out_of_tokens'));
  assert.equal(body.code, 'insufficient_tokens');
  assert.equal(body.status, 402);
  assert.deepEqual([body.needed_microusd, body.available_microusd, body.add_tokens_href], [null, null, server.ADD_TOKENS_HREF]);
  assert.notEqual(body.error, 'raw sentence', 'the budget refusal reads in the member\'s words');
  assert.ok(!/credit/i.test(body.error), body.error);
});

test('the codes /mcp names: budget codes map, a cap keeps its own, everything else passes through', () => {
  assert.equal(server.mcpCode('budget_user_day'), 'insufficient_tokens');
  assert.equal(server.mcpCode('budget_user_month'), 'insufficient_tokens');
  assert.equal(server.mcpCode('budget_org_month'), 'unavailable');
  assert.equal(server.mcpCode('kill_switch'), 'unavailable');
  for (const code of ['spend_limit', 'ai_paused', 'budget_review', 'not_found']) assert.equal(server.mcpCode(code), code);
  assert.deepEqual(JSON.parse(server.errorResult('x', 'unavailable', null).content[0].text), { error: 'x', code: 'unavailable' });
});

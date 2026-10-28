/**
 * D1343 (#3551, part 4 of #3547): `mail_context` and `mail_draft` on Axal's
 * MCP server, through the real `callTool`, on the migrated schema with
 * D1341's records; `env.AI` is a stub and `fetch` throws.
 *
 *   · each tool refuses without its scope, and neither is listed without it;
 *   · a person outside the grant's companies is "Record not found.";
 *   · a draft through MCP is charged once, by the router, and stored once;
 *   · no tool sends: no `mail_send` is registered, and a draft writes no `mail_sent` row.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { callTool, listedTools, registeredTools } from '../src/mcp/server.ts';
import { bindMailTools } from '../src/services/mail/mcpTools.ts';
import { SCOPES } from '../src/mcp/oauth.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { METERING_POLICY, toolOperation } from '../src/services/metering.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

after(removeMigratedDatabases);
const ANSWER = JSON.stringify({ subject: 'Thank you', body: 'Thank you for the conversation.' });
const FOUNDER = 2, PROJECT = 1, OTHER_PROJECT = 3;

async function fixture() {
  __resetForTest();
  const db = migratedDatabase();
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  insert.run(FOUNDER, 'founder', 100, 'Synthetic founder', 'synthetic-2@example.invalid', 'studio');
  db.exec(`INSERT INTO projects(id,name,founder_id) VALUES (${PROJECT},'Synthetic venture',100),(${OTHER_PROJECT},'Second venture',100)`);
  db.exec(`INSERT INTO discovery_interviews(id,project_id,interviewee_name,stage,done_at,pains_json,updated_at)
           VALUES (11,${PROJECT},'Synthetic Ada','done','2026-10-01','["Synthetic pain"]','2026-10-02 09:00:00'),
                  (31,${OTHER_PROJECT},'Synthetic Bo','done','2026-10-01','[]','2026-10-02 09:00:00')`);
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,5000000)').run(FOUNDER);
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const runs: string[] = [];
  const AI = withGuard({ run: async (model: string) => { runs.push(model); return { response: ANSWER, usage: { prompt_tokens: 80, completion_tokens: 40 } }; } });
  const kv = new Map<string, string>();
  const RATE_LIMITS = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } };
  const env: any = { DB: d1Over(db), JWT_SECRET: 'synthetic-d1343'.repeat(4), ENVIRONMENT: 'development', AI, RATE_LIMITS };
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const charged = () => db.prepare("SELECT charged_microusd FROM ai_usage_logs WHERE guard_for IS NULL AND task = 'mail_draft'").all() as any[];
  const drafts = () => db.prepare('SELECT uid, cost_micro_usd FROM mail_drafts').all() as any[];
  return { db, env, close, runs, charged, drafts };
}

const grant = (companies: number[]) => ({
  userId: FOUNDER, companies, clientId: 'client-1343', clientName: 'Test Assistant', redirectHost: null, redirectUri: null,
  grantedAt: Math.floor(Date.now() / 1000),
});
const tool = (name: string) => registeredTools().find((t) => t.name === name)!;
const body = (r: any) => JSON.parse(r.content[0].text);
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const saved = [console.warn, console.error];
  console.warn = () => {}; console.error = () => {};
  try { return await f(); } finally { [console.warn, console.error] = saved; }
};
const call = (f: any, name: string, args: Record<string, unknown>, scope: string[], companies = [PROJECT]) =>
  quiet(() => callTool(f.env, grant(companies), 'g-1343', tool(name), args, scope));

test('the two tools, their scopes and their price: neither sends, and no tool sends mail', () => {
  assert.ok(SCOPES.includes('mail:read' as any) && SCOPES.includes('mail:write' as any));
  assert.deepEqual([tool('mail_context').requiredScope, tool('mail_context').readOnly], ['mail:read', true]);
  assert.deepEqual([tool('mail_draft').requiredScope, tool('mail_draft').readOnly], ['mail:write', false]);
  // Mutation checked: register a mail_send → this fails.
  assert.deepEqual(registeredTools().filter((t) => /send/i.test(t.name)).map((t) => t.name), [], 'no tool sends: sending stays a press in Axal');
  for (const n of ['mail_context', 'mail_draft']) assert.equal(METERING_POLICY.operations[toolOperation(n)].price_microusd, 0, `${n}: the model run is the router's charge`);
});

test('before the entry hands the services in, a tool answers 503 and runs nothing; the server imports none of them', async () => {
  const f = await fixture();
  try {
    const early = await call(f, 'mail_context', { person: 'interviewee:11' }, ['mail:read']);
    assert.equal(early.isError, true);
    assert.match(JSON.stringify(body(early)), /Email is not available right now/);
    assert.equal(f.runs.length, 0);
  } finally { f.close(); }
  // `auth.ts` reaches the MCP server, so neither the server nor the mail tools import a mail service (D707, D714).
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/mcp/tools/mail.ts', import.meta.url), 'utf8');
  assert.deepEqual(src.match(/from '\.\.\/\.\.\/services\/mail\/(?!intents')[^']+'/g), null, 'only the import-free intents table');
  bindMailTools();
});

test('each tool refuses without its scope, and is not listed without it', async () => {
  const f = await fixture();
  try {
    const noRead = await call(f, 'mail_context', { person: 'interviewee:11' }, ['validate:read']);
    assert.equal(noRead.isError, true);
    assert.match(body(noRead).error?.message ?? JSON.stringify(body(noRead)), /mail:read/);
    // Mutation checked: let mail:read run mail_draft → a draft without mail:write.
    const noWrite = await call(f, 'mail_draft', { person: 'interviewee:11', intent: 'thank_follow_up' }, ['mail:read']);
    assert.equal(noWrite.isError, true);
    assert.match(JSON.stringify(body(noWrite)), /mail:write/);
    assert.deepEqual([f.runs.length, f.drafts().length], [0, 0], 'nothing ran, nothing stored');
    const { tools } = await listedTools(f.env, grant([PROJECT]) as any, ['mail:read']);
    assert.deepEqual(tools.filter((t) => t.name.startsWith('mail_')).map((t) => t.name), ['mail_context']);
  } finally { f.close(); }
});

test('mail_context reads the pack; a person outside the grant\'s companies is not found', async () => {
  const f = await fixture();
  try {
    const r = await call(f, 'mail_context', { person: 'interviewee:11' }, ['mail:read']);
    assert.notEqual(r.isError, true, JSON.stringify(r));
    const pack = body(r);
    assert.equal(pack.person.ref, 'interviewee:11');
    assert.deepEqual(pack.items.map((i: any) => [i.ref, i.selected]).slice(0, 1), [['interviewee:11', true]]);
    assert.match(pack.items[0].text, /Synthetic pain/);
    // Mutation checked: drop the grant check → the other venture's interview is read.
    const outside = await call(f, 'mail_context', { person: 'interviewee:31' }, ['mail:read']);
    assert.equal(outside.isError, true);
    assert.match(JSON.stringify(body(outside)), /Record not found\./);
    const asked = await call(f, 'mail_context', { person: 'interviewee:11', project: OTHER_PROJECT }, ['mail:read']);
    assert.match(JSON.stringify(body(asked)), /Record not found\./, 'a project outside the grant');
    // Inside the grant it reads.
    assert.notEqual((await call(f, 'mail_context', { person: 'interviewee:31' }, ['mail:read'], [PROJECT, OTHER_PROJECT])).isError, true);
  } finally { f.close(); }
});

test('a draft through MCP is charged once, by the router, stored once, and sends nothing', async () => {
  const f = await fixture();
  try {
    const r = await call(f, 'mail_draft', { person: 'interviewee:11', intent: 'thank_follow_up', refs: ['interviewee:11'] }, ['mail:read', 'mail:write']);
    assert.notEqual(r.isError, true, JSON.stringify(r));
    const out = body(r);
    assert.deepEqual([out.draft.subject, out.sent, out.open_in], ['Thank you', false, '/email']);
    // Mutation checked: run the model again in the tool → two charges.
    const charged = f.charged();
    assert.equal(charged.length, 1, 'one run, one charge');
    const drafts = f.drafts();
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].uid, out.draft.uid);
    assert.equal(Number(drafts[0].cost_micro_usd), Number(charged[0].charged_microusd), 'the draft carries the router\'s charge');
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM mail_sent').get() as any).n, 0, 'nothing sent');
    // A short balance is the ledger's refusal, in its words, and stores nothing.
    f.db.prepare('UPDATE ai_topup_accounts SET balance_microusd = 0 WHERE user_id = ?').run(FOUNDER);
    const short = await call(f, 'mail_draft', { person: 'interviewee:11', intent: 'thank_follow_up' }, ['mail:read', 'mail:write']);
    assert.equal(short.isError, true);
    assert.match(JSON.stringify(body(short)), /insufficient_tokens|AI tokens/);
    assert.equal(f.drafts().length, 1);
  } finally { f.close(); }
});

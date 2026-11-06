/**
 * #4046 (S1, 2026-11-04) — Ask on Publish to…'s post text, `POST /api/publish/ask`.
 * On the migrated schema, the routes on a bare Hono, `_publish_fake.mjs` as the
 * place, and the real AI router with a stubbed model. Nothing reaches the
 * network; every venture, person and figure is made up.
 *
 *   1. The estimate quotes and runs nothing; the press runs once, metered
 *      under `draft:publish`, and writes no draft, proposal or send.
 *   2. What Eadwyn reads is the module's never-list builder: no customer's
 *      words, no partner not agreed to be named, no team-only figure.
 *   3. It writes for the ticked places: each is named, and the text is cut to
 *      the smallest confirmed limit.
 *   4. Only the founder who may publish asks, for places that pass preview's rule.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/publish_ask_4046.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { publishFake } from './_publish_fake.mjs';
import publishRoutes from '../src/routes/publish.ts';
import { registerProvider } from '../src/integrations/registry.ts';
import { registerPublishTarget } from '../src/integrations/publishTargets.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { ASK_DEFAULT_LIMIT, PUBLISH_ASK_OPTION, askLimit, askPrompt, screenPost } from '../src/services/publishAsk.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

test.after(() => removeMigratedDatabases());

const SECRET = 'test'.repeat(16); // in-memory test signing seed only, the shared unit-test literal
const FOUNDER = 1, COFOUNDER = 2;
const P = 701;
const fake = publishFake({ key: 'fakepub4046', textLimit: 120 });
registerProvider(fake.impl as any); registerPublishTarget(fake.target as any);

const app = new Hono<any>();
app.route('/api/publish', publishRoutes);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));

/** Values seeded where the never-list keeps them: none may reach the model. */
const NEVER = /PRIVATE|987654|48,000|48000/;
const LONG = 'We shipped bulk CSV import this month, the most asked-for change from finance teams. '.repeat(4);

function fixture(reply: string = LONG) {
  __resetForTest();
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'F','f@example.test'),(202,'C','c@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES (1,'Founder','founder@example.test','founder',101,1),(2,'Cofounder','co@example.test','founder',202,1);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (1,'co-1','Northwind Data');
    INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES (${P},'p-1','Northwind',101,1),(702,'p-2','Empty Venture',101,1);
    INSERT INTO project_members(project_id,user_id,role,status) VALUES (${P},2,'cofounder','accepted');
    INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin) VALUES ('l1',1,1,1),('l2',1,2,0);
    INSERT INTO integrations(id,uid,user_id,provider_key,status,auth_type) VALUES (10,'int-own',1,'fakepub4046','active','oauth2');
    INSERT INTO integration_companies(integration_id,company_id,enabled) VALUES (10,1,1);
    INSERT INTO ai_topup_accounts(user_id, balance_microusd) VALUES (1, 50000000);
  `);
  const seed = (sql: string, ...v: unknown[]) => db.prepare(sql).run(...(v as any[]));
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  seed("INSERT INTO product_feedback(uid,project_id,body,source,from_name,theme,roadmap_item_label,status,shipped_on) VALUES ('fb-1',?,?,'customer','PRIVATE Name','Bulk CSV import','Bulk CSV import','shipped',?)", P, 'PRIVATE customer words', day(10));
  seed("INSERT INTO project_metrics(project_id,snapshot_date,source,mrr,paying_accounts,new_users) VALUES (?,?,'stripe',18400,42,0)", P, day(2));
  seed("INSERT INTO project_metrics(project_id,snapshot_date,source,net_burn,cash_balance,notes) VALUES (?,?,'mercury',48000,987654,'PRIVATE note')", P, day(1));
  const prompts: string[] = [];
  const env: any = {
    DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development',
    AI: withGuard({ run: async (_model: string, input: any) => {
      prompts.push(JSON.stringify(input?.messages ?? input));
      return { response: reply, usage: { prompt_tokens: 40, completion_tokens: 30 } };
    } }),
  };
  async function call(who: number, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) {
    const token = await new SignJWT({ user_id: who, ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
    const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
    try {
      const res = await app.request(`https://unit.test${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
      return { status: res.status, body: await res.json().catch(() => null) as any };
    } finally { [console.warn, console.error, console.log] = saved; }
  }
  const count = (sql: string) => Number((db.prepare(sql).get() as any).n);
  const writes = () => ({
    drafts: count('SELECT COUNT(*) AS n FROM publish_drafts'),
    sends: count('SELECT COUNT(*) AS n FROM publish_sends'),
    proposals: count('SELECT COUNT(*) AS n FROM ai_rail_proposals'),
  });
  return { db, env, call, prompts, count, writes };
}
type F = ReturnType<typeof fixture>;

/** The founder's places, refreshed from the fake (two accounts) and switched on. */
async function places(f: F, on = [true, true]) {
  assert.equal((await f.call(FOUNDER, 'POST', '/api/publish/destinations/refresh/int-own', { project: P })).status, 200);
  const dests = (await f.call(FOUNDER, 'GET', `/api/publish/destinations?project=${P}`)).body.connections[0].destinations;
  for (const [i, d] of dests.entries()) if (on[i]) assert.equal((await f.call(FOUNDER, 'PUT', `/api/publish/destinations/${d.uid}?project=${P}`, { enabled: true })).status, 200);
  return dests.map((d: any) => d.uid) as string[];
}
const ask = (f: F, uids: string[], extra: Record<string, unknown> = {}, who = FOUNDER, module = 'product-improvement') =>
  f.call(who, 'POST', '/api/publish/ask', { project_id: P, module, destination_uids: uids, ...extra });

test('the estimate quotes and runs nothing; the press runs once under draft:publish and writes no draft, proposal or send', async () => {
  // Mutation checked: the estimate branch falling through to the run → a usage row and a prompt appear on estimate.
  const f = fixture();
  const [one] = await places(f);
  const before = f.writes();
  const est = await ask(f, [one], { estimate: true });
  assert.equal(est.status, 200, JSON.stringify(est.body));
  assert.ok(est.body.estimate.hold_microusd > 0, 'a hold to show before Draft');
  assert.deepEqual(est.body.sources.map((s: any) => s.label), ['Product improvement']);
  assert.equal(f.prompts.length, 0, 'the estimate runs nothing');
  assert.equal(f.count('SELECT COUNT(*) AS n FROM ai_usage_logs'), 0, 'and charges nothing');
  const r = await ask(f, [one]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(typeof r.body.text === 'string' && r.body.text.length > 0);
  const usage = f.db.prepare("SELECT rail_option, surface FROM ai_usage_logs WHERE task = 'rail_write'").all() as any[];
  assert.equal(usage.length, 1, 'one metered run');
  assert.equal(usage[0].rail_option, PUBLISH_ASK_OPTION);
  assert.equal(usage[0].surface, '/grow');
  assert.deepEqual(f.writes(), before, 'no draft, proposal or send is written');
  assert.equal(fake.publishes(), 0, 'nothing is published');
});

test('Eadwyn reads the module\'s never-list builder: no customer\'s words, no team-only figure', async () => {
  // Mutation checked: `teamOnly: true` on the builder → the Mercury burn reaches the prompt.
  const f = fixture();
  const [one] = await places(f);
  assert.equal((await ask(f, [one])).status, 200);
  assert.equal((await ask(f, [one], {}, FOUNDER, 'revenue-and-traction')).status, 200);
  assert.equal(f.prompts.length, 2);
  assert.ok(f.prompts[0].includes('Bulk CSV import'), 'the shipped item is the fact it drafts from');
  assert.ok(f.prompts[1].includes('18,400') || f.prompts[1].includes('18400'), 'Stripe\'s MRR is public to the team and may be posted');
  for (const p of f.prompts) assert.doesNotMatch(p, NEVER, 'a customer\'s name or words, or a bank figure, never reaches the model');
});

test('it writes for the ticked places: each is named, and the text is cut to the smallest limit', async () => {
  // Mutation checked: screenPost without the limit → a 336-character post for a 120-character place.
  const f = fixture();
  const uids = await places(f);
  const r = await ask(f, uids);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.text.length <= 120, `${r.body.text.length} characters for a 120-character place`);
  assert.equal(r.body.limit, 120);
  assert.ok(!r.body.text.endsWith(' '), 'cut at a word');
  assert.match(f.prompts[0], /fakepub4046/, 'the service it writes for');
  assert.match(f.prompts[0], /Character limit: 120/);
});

test('only the founder who may publish asks, for places that pass preview\'s own rule', async () => {
  // Mutation checked: the per-destination canPublish dropped → a place switched off still drafts.
  const f = fixture();
  const [on, off] = await places(f, [true, false]);
  const co = await ask(f, [on], {}, COFOUNDER);
  assert.equal(co.body.error, 'publish_not_allowed', `a co-founder is refused: ${JSON.stringify(co)}`);
  assert.equal((await ask(f, [on], {}, FOUNDER, 'product-improvement')).status, 200);
  const support = await f.call(FOUNDER, 'POST', '/api/publish/ask', { project_id: P, module: 'product-improvement', destination_uids: [on] }, { impersonated_by: 9 });
  assert.equal(support.body?.error, 'support_session', 'a support session drafts nothing');
  assert.equal((await ask(f, [off])).body.error, 'destination_off', 'a place switched off for this company');
  assert.equal((await ask(f, [])).body.error, 'invalid', 'no place ticked');
  assert.equal((await ask(f, Array.from({ length: 6 }, () => on))).status, 200, 'the same place six times is one place');
  assert.equal((await ask(f, [on, '00000000-0000-0000-0000-000000000000'])).body.error, 'not_found');
  assert.equal((await ask(f, [on], {}, FOUNDER, 'not-a-place')).body.error, 'invalid');
  const empty = await f.call(FOUNDER, 'POST', '/api/publish/ask', { project_id: 702, module: 'team-expansion', destination_uids: [on] });
  assert.equal(empty.body.error, 'nothing_to_draft', 'nothing recorded: Write your own');
  assert.equal(empty.status, 422);
  assert.equal(f.count("SELECT COUNT(*) AS n FROM ai_usage_logs WHERE task = 'rail_write'"), 2, 'only the two allowed presses ran');
});

test('the screen and the prompt: fences, quotes and labels go; the cut is at a word; the facts carry their sources', () => {
  assert.equal(screenPost('```\nPost: "Shipped bulk CSV import."\n```', 200), 'Shipped bulk CSV import.');
  assert.equal(screenPost('   ', 200), null);
  assert.equal(screenPost(42, 200), null);
  assert.equal(screenPost('one two three four five six', 13), 'one two three');
  assert.equal(askLimit([{ provider_key: 'a', account: 'x', audience: null, text_limit: 500 }, { provider_key: 'b', account: 'y', audience: null, text_limit: 280 }]), 280);
  assert.equal(askLimit([{ provider_key: 'a', account: 'x', audience: null, text_limit: null }]), ASK_DEFAULT_LIMIT);
  const p = askPrompt('product-improvement', [{ line: 'Shipped bulk CSV import', source: 'Product improvement', as_of: '2026-10-20' }],
    [{ provider_key: 'linkedin', account: 'Northwind', audience: 'Public', text_limit: 3000 }]);
  assert.match(p, /1\. Shipped bulk CSV import \[Product improvement, 2026-10-20\]/);
  assert.match(p, /- linkedin \(Public\)/);
  // The route writes nothing: no INSERT or UPDATE between its start and the next route.
  const src = readFileSync(new URL('../src/routes/publish.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf("publish.post('/ask'"), src.indexOf("publish.post('/drafts/:uid/confirm'"));
  assert.ok(body.length > 200);
  assert.doesNotMatch(body, /INSERT|UPDATE|DELETE|proposeRail|createDraft|confirmSend/, 'Ask writes no row of its own');
});

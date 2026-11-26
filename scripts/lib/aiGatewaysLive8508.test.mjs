// #8508 layer 2 (D8508-p2): the live read-only adapter against a synthetic transport. Nothing here reaches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FALLBACK_ROUTES, MAX_PAGES, STATES, TOKEN_BINDING, livePlan, liveSummaryLines, liveVerdict, readLiveState,
} from './aiGatewaysLive.mjs';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const TOKEN = 'synthetic-token-8508-not-a-credential';

/** A table with every route switched on unless a key is overridden. */
function toml(over = {}) {
  const v = {
    CF_AI_GATEWAY_SLUG_ADVISOR: 'advisor-ongoing', CF_AI_GATEWAY_SLUG_DECK: '', CF_AI_GATEWAY_SLUG_PROVIDERS: 'providers-gw',
    AI_PROVIDER_GATEWAY_OPENAI: 'on', AGENT_ENGINE: 'workflow', AGENT_INFERENCE_STUB: 'off', AGENT_AI_GATEWAY: 'agents',
    AGENT_CLAUDE_ALIAS_1: 'claude-primary', AGENT_CLAUDE_ALIAS_2: 'claude-2', AGENT_CLAUDE_ALIAS_3: '', AGENT_OPENAI_ALIAS: 'openai-codex',
    ...over,
  };
  const lines = Object.entries(v).map(([k, x]) => `${k} = "${x}"`).join('\n');
  return `name = "studioos"\n\n[vars]\n${lines}\n\n[env.production]\nname = "studioos"\n\n[env.production.vars]\n${lines}\n`;
}

const ok = (result, extra = {}) => ({ status: 200, body: { success: true, result, ...extra } });

/** A fake account: gateways, secret names, provider configs, and per-path overrides. */
function account({ gateways = ['advisor-ongoing', 'providers-gw', 'agents'], secrets = [TOKEN_BINDING],
  configs = [{ alias: 'claude-primary', provider_slug: 'anthropic' }, { alias: 'claude-2', provider_slug: 'anthropic' }, { alias: 'openai-codex', provider_slug: 'openai' }],
  override = () => undefined } = {}) {
  const calls = [];
  // The account id and token live only here, as a real transport's would.
  const request = async (path) => {
    calls.push(path);
    const o = override(path);
    if (o !== undefined) return typeof o === 'function' ? o() : o;
    let m;
    if ((m = /^ai-gateway\/gateways\/([^/?]+)$/.exec(path))) {
      const id = decodeURIComponent(m[1]);
      return gateways.includes(id) ? ok({ id, cache_ttl: 0 }) : { status: 404, body: { success: false, errors: [{ message: `no gateway in ${ACCOUNT}` }] } };
    }
    if (/^workers\/scripts\/studioos\/secrets$/.test(path)) return ok(secrets.map((name) => ({ name, type: 'secret_text' })));
    if ((m = /^ai-gateway\/gateways\/([^/?]+)\/provider_configs\?per_page=100&page=(\d+)$/.exec(path))) {
      if (!gateways.includes(decodeURIComponent(m[1]))) return { status: 404, body: { success: false } };
      return ok(Number(m[2]) === 1 ? configs : [], { result_info: { total_count: configs.length } });
    }
    return { status: 500, body: { success: false } };
  };
  return { request, calls };
}

const state = (r, kind, name) => r.items.find((i) => i.kind === kind && i.name === name)?.state;

test('every item present: states only, nothing stops, warns or is unread', async () => {
  const plan = livePlan(toml(), 'env.production.vars');
  const { request, calls } = account();
  const r = await readLiveState(plan, { request });
  assert.deepEqual(r.items.map((i) => [i.kind, i.name, i.state]), [
    ['gateway', 'advisor-ongoing', 'present'], ['gateway', 'providers-gw', 'present'], ['gateway', 'agents', 'present'],
    ['binding', TOKEN_BINDING, 'present'],
    ['alias', 'claude-primary', 'present'], ['alias', 'claude-2', 'present'], ['alias', 'openai-codex', 'present'],
  ]);
  assert.deepEqual([r.stops, r.warnings, r.unread], [[], [], []]);
  // One read per gateway, one for the secret names, one page of provider configs: bounded and in order.
  assert.deepEqual(calls, ['ai-gateway/gateways/advisor-ongoing', 'ai-gateway/gateways/providers-gw', 'ai-gateway/gateways/agents',
    'workers/scripts/studioos/secrets', 'ai-gateway/gateways/agents/provider_configs?per_page=100&page=1']);
});

test('the 2026-11-25 audit shape: the Advisor gateway 404 warns, a missing token binding stops a switched-on engine', async () => {
  // Mutations checked: fallbackOnly dropped → the Advisor's 404 stops the release; the `on` test dropped → a
  // switched-off engine's missing binding stops it; `missing` for a secret list without the name read as present.
  const plan = livePlan(toml(), 'env.production.vars');
  const r = await readLiveState(plan, { request: account({ gateways: ['providers-gw', 'agents'], secrets: [] }).request });
  assert.equal(state(r, 'gateway', 'advisor-ongoing'), STATES.missing);
  assert.equal(state(r, 'binding', TOKEN_BINDING), STATES.missing);
  assert.deepEqual(r.stops, [`binding ${TOKEN_BINDING}`]);
  assert.deepEqual(r.warnings, ['gateway advisor-ongoing']);
  assert.deepEqual(FALLBACK_ROUTES, ['advisor', 'deck']);
  // The same states with the engine off: reported, nothing stops (only the Advisor warns).
  const off = await readLiveState(livePlan(toml({ AGENT_ENGINE: 'off' }), 'env.production.vars'),
    { request: account({ gateways: ['providers-gw'], secrets: [], configs: [] }).request });
  assert.deepEqual(off.stops, []);
  assert.deepEqual(off.warnings, ['gateway advisor-ongoing']);
  assert.ok(off.items.filter((i) => i.routes.includes('agents')).every((i) => i.on === false && i.state === STATES.missing));
  assert.match(liveSummaryLines(off).join('\n'), /gateway agents \(agents, switched off\): missing/);
});

test('403, 429, 500, a malformed answer and a wrong id are "could not be read", never a stop', async () => {
  for (const answer of [{ status: 403, body: { success: false } }, { status: 401 }, { status: 429 }, { status: 500 },
    { status: 200, body: 'not json' }, { status: 200, body: { success: false } }, ok({ id: 'someone-else' }), {}, null]) {
    const plan = livePlan(toml(), 'env.production.vars');
    const r = await readLiveState(plan, { request: account({ override: (p) => (p === 'ai-gateway/gateways/agents' ? answer : undefined) }).request });
    assert.equal(state(r, 'gateway', 'agents'), STATES.unread, JSON.stringify(answer));
    assert.deepEqual(r.stops, []);
    assert.deepEqual(r.unread, ['gateway agents']);
  }
});

test('a request that never answers times out as "could not be read" and the read goes on', async () => {
  // Mutation checked: the timeout race removed → this test never finishes (node:test's own timeout catches it).
  const plan = livePlan(toml(), 'env.production.vars');
  const hang = () => new Promise(() => {});
  const started = performance.now();
  const r = await readLiveState(plan, { timeoutMs: 20, request: account({ override: (p) => (p.startsWith('workers/') ? hang : undefined) }).request });
  assert.ok(performance.now() - started < 2000);
  assert.equal(state(r, 'binding', TOKEN_BINDING), STATES.unread);
  assert.equal(state(r, 'alias', 'claude-primary'), STATES.present, 'later reads still run');
}, { timeout: 5000 });

test('no token, account id, path or answer text reaches a result or a summary, even from a thrown error', async () => {
  const plan = livePlan(toml(), 'env.production.vars');
  const leak = () => { throw new Error(`GET https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai-gateway Bearer ${TOKEN}`); };
  const { request } = account({ gateways: [], override: (p) => (p.includes('provider_configs') ? leak : p.startsWith('workers/') ? leak : undefined) });
  const r = await readLiveState(plan, { request });
  const text = JSON.stringify(r) + liveSummaryLines(r).join('\n');
  for (const marker of [ACCOUNT, TOKEN, 'Bearer', 'api.cloudflare.com', 'accounts/', 'workers/scripts', 'no gateway in']) {
    assert.ok(!text.includes(marker), marker);
  }
  assert.ok(r.items.every((i) => Object.values(STATES).includes(i.state)));
});

test('aliases: a full listing answers present or missing per alias and provider; a 404 is missing; a listing too long is unread', async () => {
  const plan = livePlan(toml(), 'env.production.vars');
  // claude-2 stored under the wrong provider is not the alias the slot asks for.
  const wrong = await readLiveState(plan, { request: account({ configs: [{ alias: 'claude-primary', provider_slug: 'anthropic' }, { alias: 'claude-2', provider_slug: 'openai' }] }).request });
  assert.deepEqual(wrong.items.filter((i) => i.kind === 'alias').map((i) => [i.name, i.state]),
    [['claude-primary', 'present'], ['claude-2', 'missing'], ['openai-codex', 'missing']]);
  assert.deepEqual(wrong.stops, ['alias claude-2', 'alias openai-codex']);
  // Two pages, counted by total_count.
  const two = (p) => {
    const m = /page=(\d+)$/.exec(p);
    if (!p.includes('provider_configs')) return undefined;
    const page = Number(m[1]);
    const rows = page === 1 ? Array.from({ length: 100 }, (_, i) => ({ alias: `other-${i}`, provider_slug: 'anthropic' })) : [{ alias: 'claude-primary', provider_slug: 'anthropic' }];
    return ok(rows, { result_info: { total_count: 101 } });
  };
  const paged = await readLiveState(plan, { request: account({ override: two }).request });
  assert.equal(state(paged, 'alias', 'claude-primary'), STATES.present);
  assert.equal(state(paged, 'alias', 'claude-2'), STATES.missing);
  // Longer than MAX_PAGES pages: not read whole, so not "missing".
  const endless = (p) => (p.includes('provider_configs') ? ok(Array.from({ length: 100 }, () => ({ alias: 'x', provider_slug: 'openai' })), { result_info: { total_count: 100 * (MAX_PAGES + 1) } }) : undefined);
  const { request: longReq, calls } = account({ override: endless });
  const long = await readLiveState(plan, { request: longReq });
  assert.ok(long.items.filter((i) => i.kind === 'alias').every((i) => i.state === STATES.unread));
  assert.equal(calls.filter((c) => c.includes('provider_configs')).length, MAX_PAGES);
  // The agents gateway gone: its configs answer 404, every alias is missing.
  const gone = await readLiveState(plan, { request: account({ gateways: ['advisor-ongoing', 'providers-gw'] }).request });
  assert.ok(gone.items.filter((i) => i.kind === 'alias').every((i) => i.state === STATES.missing));
});

test('binding: 404 on the Worker is missing; an unknown Worker name is unread without a call', async () => {
  const plan = livePlan(toml(), 'env.production.vars');
  const r = await readLiveState(plan, { request: account({ override: (p) => (p.startsWith('workers/') ? { status: 404 } : undefined) }).request });
  assert.equal(state(r, 'binding', TOKEN_BINDING), STATES.missing);
  const { request, calls } = account();
  const nameless = await readLiveState({ ...plan, worker: null }, { request });
  assert.equal(state(nameless, 'binding', TOKEN_BINDING), STATES.unread);
  assert.ok(!calls.some((c) => c.startsWith('workers/')));
});

test('the plan reads the table: routes, worker names, the default alias refused, a stub or an off engine switches the agents route off', async () => {
  const plan = livePlan(toml({ CF_AI_GATEWAY_SLUG_DECK: 'advisor-ongoing', AGENT_CLAUDE_ALIAS_2: 'default', AGENT_OPENAI_ALIAS: 'Bad Alias' }), 'env.production.vars');
  assert.deepEqual(plan.gateways.map((g) => [g.name, g.routes, g.on]), [['advisor-ongoing', ['advisor', 'deck'], true], ['providers-gw', ['providers'], true], ['agents', ['agents'], true]]);
  assert.deepEqual(plan.aliases.map((a) => a.name), ['claude-primary']);
  assert.equal(livePlan(toml({ AGENT_INFERENCE_STUB: 'on' }), 'vars').binding.on, false);
  assert.equal(livePlan(toml({ AI_PROVIDER_GATEWAY_OPENAI: 'off' }), 'vars').gateways.find((g) => g.name === 'providers-gw').on, false);
  assert.throws(() => livePlan(toml(), 'env.preview.vars'), /\[env\.preview\.vars\] is missing/);
  // The real wrangler.toml, as main ships it.
  const real = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  const prod = livePlan(real, 'env.production.vars');
  assert.equal(prod.worker, 'studioos');
  assert.deepEqual(prod.gateways.map((g) => g.name), ['advisor-ongoing', 'agents']);
  assert.equal(livePlan(real, 'env.preview.vars').worker, 'studioos-preview');
  await assert.rejects(readLiveState(prod, {}), /needs a request function/);
});

test('the verdict alone: missing on a shared fallback-and-on route stops, unread never does', () => {
  const items = [
    { kind: 'gateway', name: 'shared', routes: ['advisor', 'providers'], on: true, state: STATES.missing },
    { kind: 'gateway', name: 'advisor-ongoing', routes: ['advisor'], on: true, state: STATES.missing },
    { kind: 'gateway', name: 'agents', routes: ['agents'], on: true, state: STATES.unread },
  ];
  assert.deepEqual(liveVerdict(items), { stops: ['gateway shared'], warnings: ['gateway advisor-ongoing'], unread: ['gateway agents'] });
});

/* ---------------------------------------------- the release-preflight CLI, scripts/check-ai-gateways-live.mjs */

const SRC = Object.fromEntries(['cloudflare-worker/src/services/ai/catalogue.ts', 'cloudflare-worker/src/services/aiProviders.ts', 'cloudflare-worker/src/services/agents/agentRun.ts']
  .map((p) => [p, readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')]));

/** A fake fetch over `account()`'s answers, recording what it was asked. */
function fakeFetch(acct) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    const prefix = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/`;
    const a = await acct.request(String(url).slice(prefix.length));
    return { status: a?.status ?? 500, json: async () => { if (typeof a?.body !== 'object' || a.body === null) throw new Error('not json'); return a.body; } };
  };
  return { fetchImpl, seen };
}

test('the CLI transport: one bounded GET under the account with the bearer token; no credential, no call', async () => {
  const { cloudflareRequest } = await import('../check-ai-gateways-live.mjs');
  const { fetchImpl, seen } = fakeFetch(account());
  const req = cloudflareRequest({ account: ACCOUNT, token: ` ${TOKEN} `, fetchImpl });
  assert.deepEqual(await req('ai-gateway/gateways/agents'), ok({ id: 'agents', cache_ttl: 0 }));
  assert.equal(seen[0].url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai-gateway/gateways/agents`);
  assert.deepEqual([seen[0].init.method, seen[0].init.headers.Authorization, seen[0].init.redirect], ['GET', `Bearer ${TOKEN}`, 'error']);
  assert.ok(seen[0].init.signal instanceof AbortSignal);
  // A body that is not JSON comes back as null, which the adapter reads as "could not be read".
  const bad = cloudflareRequest({ account: ACCOUNT, token: TOKEN, fetchImpl: async () => ({ status: 200, json: async () => { throw new Error('html'); } }) });
  assert.deepEqual(await bad('x'), { status: 200, body: null });
  for (const creds of [{ account: ACCOUNT, token: '' }, { account: 'not-an-account', token: TOKEN }, { account: undefined, token: undefined }]) {
    let called = false;
    assert.equal(await cloudflareRequest({ ...creds, fetchImpl: async () => { called = true; } })('x'), null);
    assert.equal(called, false);
  }
});

test('the CLI on the audit shape: a missing token binding stops (exit 1), a missing Advisor gateway only warns, nothing leaks', async () => {
  // Mutations checked: warnings annotated as errors → the Advisor line reads ::error; the exit status taken from
  // warnings → exit 1 on a warning alone.
  const { runLiveCheck } = await import('../check-ai-gateways-live.mjs');
  const out = []; const notes = []; let summary = '';
  const env = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_API_TOKEN: TOKEN };
  const { fetchImpl } = fakeFetch(account({ gateways: ['providers-gw', 'agents'], secrets: [] }));
  const { status } = await runLiveCheck({ toml: toml(), src: SRC, env, fetchImpl, log: (s) => out.push(s), annotate: (s) => notes.push(s), summary: (t) => { summary += t; } });
  assert.equal(status, 1);
  assert.deepEqual(notes, [
    `::error title=AI gateway (D8508)::binding ${TOKEN_BINDING} is missing on a switched-on route; the release stops`,
    '::warning title=AI gateway (D8508)::gateway advisor-ongoing is missing; its route runs without a gateway (owner answer A, #8508)',
  ]);
  assert.match(summary, /\| gateway \| `advisor-ongoing` \| advisor \| on \| missing \|/);
  assert.match(summary, /\*\*Stops the release:\*\* binding AGENT_AI_GATEWAY_TOKEN/);
  const all = out.join('\n') + notes.join('\n') + summary;
  for (const marker of [ACCOUNT, TOKEN, 'Bearer', 'api.cloudflare.com']) assert.ok(!all.includes(marker), marker);
  // The Advisor alone missing: a warning, exit 0.
  const warnOnly = await runLiveCheck({ toml: toml(), src: SRC, env, fetchImpl: fakeFetch(account({ gateways: ['providers-gw', 'agents'] })).fetchImpl, log: () => {}, annotate: () => {} });
  assert.deepEqual([warnOnly.status, warnOnly.result.warnings], [0, ['gateway advisor-ongoing']]);
});

test('the CLI with a token that cannot read AI Gateway (403) or no credential at all: every item unread, a warning, exit 0', async () => {
  const { runLiveCheck } = await import('../check-ai-gateways-live.mjs');
  const denied = fakeFetch(account({ override: () => ({ status: 403, body: { success: false } }) }));
  for (const [env, fetchImpl] of [[{ CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_API_TOKEN: TOKEN }, denied.fetchImpl], [{}, async () => { throw new Error('must not be called'); }]]) {
    const notes = [];
    const { status, result } = await runLiveCheck({ toml: toml(), src: SRC, env, fetchImpl, log: () => {}, annotate: (s) => notes.push(s) });
    assert.equal(status, 0);
    assert.ok(result.items.every((i) => i.state === STATES.unread));
    assert.equal(notes.length, 1);
    assert.match(notes[0], /^::warning title=AI gateway \(D8508\)::could not be read: gateway advisor-ongoing/);
  }
  // On main's real wrangler.toml the engine is off, so even a missing agents gateway stops nothing.
  const real = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  const nothing = await runLiveCheck({ toml: real, src: SRC, env: { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_API_TOKEN: TOKEN },
    fetchImpl: fakeFetch(account({ gateways: [], secrets: [], configs: [] })).fetchImpl, log: () => {}, annotate: () => {} });
  assert.deepEqual([nothing.status, nothing.result.stops, nothing.result.warnings], [0, [], ['gateway advisor-ongoing']]);
});

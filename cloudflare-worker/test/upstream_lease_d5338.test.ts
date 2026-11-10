/**
 * D5338 (#5338) — the shared upstream admission lease behind
 * `runGatewayTextModel`'s `deps.admit`, held in the `AiGovernor` Durable
 * Object's storage (`services/upstreamLease.ts`). The Durable Object is the real
 * class over a storage map that outlives its instance (`_ai_governor_fixture.ts`),
 * so a restart, an eviction or a deploy is a new instance over the same storage.
 * The binding is a stub: no gateway exists and no live call is made.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/upstream_lease_d5338.test.ts
 */
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { governorNamespace } from './_ai_governor_fixture.ts';
import {
  ADMIT_MAX_WAIT_MS, LEASE_TTL_MS, UPSTREAM_LIMITS, acquireUpstream, attemptUpstream, emptyUpstreamState, readUpstreamState,
  releaseUpstream, upstreamAdmission, upstreamHeld, upstreamObjectName, type UpstreamState,
} from '../src/services/upstreamLease.ts';
import {
  GATEWAY_ATTEMPT_TIMEOUT_MS, GATEWAY_MAX_ATTEMPTS, GATEWAY_RETRY_BUDGET_MS, runGatewayTextModel,
} from '../src/services/aiProviders.ts';
import { GATEWAY_TEXT_SLUG_VAR, GATEWAY_TEXT_SWITCH, GATEWAY_TEXT_ZDR_VAR } from '../src/services/ai/catalogue.ts';
import { draftSummary, PUBLICATION_GATEWAY_MODEL } from '../src/services/publications.ts';

const MODEL = 'openai/gpt-5-mini';
const SLUG = 'providers-slice';
const OBJ = upstreamObjectName(SLUG);
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/ai_gateway_4556.json', import.meta.url), 'utf8'));
const DECISION = readFileSync(new URL('../../documentation/architecture/decisions/D5338.md', import.meta.url), 'utf8');
const migration = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');
const REQUEST = { system: 'Write three short bullets.', messages: [{ role: 'user' as const, content: 'Sector heat rose in four of six regions.' }], maxTokens: 400 };

const answer = () => new Response(JSON.stringify({
  id: 'chatcmpl-test', object: 'chat.completion', model: 'gpt-5-mini-2025-08-07',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Heat rose.', refusal: null } }],
  usage: { prompt_tokens: 1000, completion_tokens: 200 }, gatewayMetadata: { keySource: 'Unified' },
}), { status: 200, headers: { 'cf-aig-log-id': 'log_test_1' } });

type Reply = (() => Response) | 'hang' | 'throw-2018';
function stubAi(replies: Reply[]) {
  const calls: string[] = [];
  const ai: any = {
    async run(model: string) {
      calls.push(model);
      if (model !== MODEL) return { response: '- Workers AI bullet (2026-W44)', usage: { prompt_tokens: 100, completion_tokens: 20 } };
      const r = replies[Math.min(calls.filter((m) => m === MODEL).length - 1, replies.length - 1)];
      if (r === 'hang') return new Promise(() => {});
      if (r === 'throw-2018') throw new Error('AiGatewayError: 2018: Unified billing rate limit exceeded for this gateway.');
      return r();
    },
  };
  withGuard(ai);
  return { ai, gw: () => calls.filter((m) => m === MODEL).length };
}

function world(env: Record<string, unknown> = {}) {
  const { DB, db } = aiBudgetFixture();
  db.exec(migration('510_member_ai_pauses.sql') + migration('525_ai_reservation_idempotency.sql') + migration('632_ai_hold_context.sql'));
  const gov = governorNamespace();
  return { db, gov, env: { DB, AI_GOVERNOR: gov.ns, [GATEWAY_TEXT_SWITCH]: 'on', [GATEWAY_TEXT_SLUG_VAR]: SLUG, [GATEWAY_TEXT_ZDR_VAR]: 'on', ...env } as any };
}
const sleeps: number[] = [];
const sleep = async (ms: number) => { sleeps.push(ms); };
let runs = 0;
const run = (env: any, ai: any, over: Record<string, unknown> = {}, deps: Record<string, unknown> = {}) =>
  runGatewayTextModel({ ...env, AI: ai }, { userId: 2, model: MODEL, task: 'publication', dataClass: 'public', request: REQUEST, executionId: `exec-5338-${++runs}`, ...over } as any,
    { attemptTimeoutMs: 50, timeoutMs: 2000, random: () => 0.5, sleep, admit: upstreamAdmission(env, { sleep }), ...deps } as any);

/** Calls the object as the client does, with `Date.now` pinned. */
async function at<T>(now: number, fn: () => Promise<T>): Promise<T> {
  const real = Date.now;
  Date.now = () => now;
  try { return await fn(); } finally { Date.now = real; }
}
const post = (gov: ReturnType<typeof governorNamespace>, path: string, body: unknown) =>
  gov.ns.get(gov.ns.idFromName(OBJ)).fetch(`https://ai-governor/upstream/${path}`, { method: 'POST', body: JSON.stringify(body) }).then((r: Response) => r.json());
const acq = (gov: any, execution: string, tenant: string, product = 'publication') => post(gov, 'acquire', { execution, tenant, product, model: MODEL });

// ── the limits and their sources ──────────────────────────────────────────────

test('D5338: the window keeps a margin under the published per-gateway rate; the lease outlives the gateway run; the decision records both with dates', () => {
  // Cloudflare publishes 200 requests per 60 s per gateway for Unified Billing (re-read 2026-11-10).
  assert.match(FIXTURE.limits.unified_billing_rate, /^200 requests per 60 seconds per gateway/);
  assert.equal(UPSTREAM_LIMITS.windowMs, 60_000);
  assert.ok(UPSTREAM_LIMITS.windowRequests < 200, 'a published limit is not a capacity promise: keep a margin');
  assert.ok(UPSTREAM_LIMITS.tenantWindowRequests < UPSTREAM_LIMITS.windowRequests);
  assert.ok(UPSTREAM_LIMITS.tenantConcurrent < UPSTREAM_LIMITS.modelConcurrent, 'one tenant can never hold every slot');
  // The lease must outlive the metered run's own ceiling, so a live call never loses its slot.
  const ceiling = GATEWAY_MAX_ATTEMPTS * GATEWAY_ATTEMPT_TIMEOUT_MS + GATEWAY_RETRY_BUDGET_MS + 30_000;
  assert.ok(LEASE_TTL_MS > ceiling, `${LEASE_TTL_MS} > ${ceiling}`);
  assert.match(DECISION, /^## D5338 — .+ \(#5338\)$/m);
  for (const s of ['https://developers.cloudflare.com/ai-gateway/reference/limits/', 'https://developers.cloudflare.com/ai/models/openai/gpt-5-mini/', '2026-11-10']) {
    assert.ok(DECISION.includes(s), s);
  }
  const d4556 = readFileSync(new URL('../../documentation/architecture/decisions/D4556.md', import.meta.url), 'utf8');
  assert.match(d4556, /D5338/);
  assert.ok(!/#4594 hosts[^.]*restart-safe lease strategy/.test(d4556), 'D4556 §8 points to #5338, not #4594');
});

// ── fairness inside the aggregate ─────────────────────────────────────────────

test('D5338: four tenants and two products share one simulated quota — the aggregate holds every tick and the noisy tenant starves no one', () => {
  let s: UpstreamState = emptyUpstreamState();
  let tok = 0;
  const tenants = ['user:noisy', 'user:b', 'user:c', 'user:d'];
  const admitted: Record<string, number> = Object.fromEntries(tenants.map((t) => [t, 0]));
  const live: Array<{ token: string; until: number }> = [];
  let n = 0;
  // Ten simulated minutes, a tick a second. The noisy tenant asks 20 times a tick with 1 s calls, the others once every 3 s with 4 s calls.
  for (let now = 0; now < 600_000; now += 1_000) {
    for (const x of live.filter((l) => l.until <= now)) s = releaseUpstream(s, x.token, 'done', now).state;
    live.splice(0, live.length, ...live.filter((l) => l.until > now));
    for (const t of tenants) {
      const asks = t === 'user:noisy' ? 20 : (now / 1000) % 3 === 0 ? 1 : 0;
      for (let i = 0; i < asks; i++) {
        const r = acquireUpstream(s, { execution: `e${++n}`, tenant: t, product: i % 2 ? 'publication' : 'brief', model: MODEL }, now, `t${++tok}`);
        s = r.state;
        if (r.result.ok) { admitted[t]++; live.push({ token: r.result.token, until: now + (t === 'user:noisy' ? 1_000 : 4_000) }); }
      }
    }
    const held = upstreamHeld(s, now);
    assert.ok(held.leases <= UPSTREAM_LIMITS.modelConcurrent, `concurrency at ${now}`);
    assert.ok(held.requests <= UPSTREAM_LIMITS.windowRequests, `window at ${now}`);
    for (const t of tenants) assert.ok((held.byTenant[t] ?? 0) <= UPSTREAM_LIMITS.tenantConcurrent, `${t} share at ${now}`);
  }
  // Each quiet tenant asked 200 times and was admitted every time: its share was never taken.
  for (const t of ['user:b', 'user:c', 'user:d']) assert.equal(admitted[t], 200, t);
  // The noisy tenant was held to its share of the window: 50 a minute, ten minutes.
  assert.ok(admitted['user:noisy'] <= UPSTREAM_LIMITS.tenantWindowRequests * 10, String(admitted['user:noisy']));
  assert.ok(admitted['user:noisy'] > 0);
});

test('D5338: the aggregate binds across tenants: once every slot is held, a new tenant waits, and the window refuses the 151st request', () => {
  let s = emptyUpstreamState();
  for (let i = 0; i < UPSTREAM_LIMITS.modelConcurrent; i++) {
    const r = acquireUpstream(s, { execution: `e${i}`, tenant: `user:${Math.floor(i / 2)}`, product: i % 2 ? 'a' : 'b', model: MODEL }, 0, `t${i}`);
    assert.equal(r.result.ok, true); s = r.state;
  }
  // Mutation checked: dropping the model cap admits this.
  assert.deepEqual(acquireUpstream(s, { execution: 'x', tenant: 'user:new', product: 'a', model: MODEL }, 0, 'tx').result, { ok: false, reason: 'model_full', wait_ms: 500 });
  // Another model on the same gateway has its own slots but the gateway's one window.
  let w = emptyUpstreamState();
  for (let i = 0; i < UPSTREAM_LIMITS.windowRequests; i++) {
    const r = acquireUpstream(w, { execution: `w${i}`, tenant: `user:${i % 10}`, product: 'a', model: `m${i}` }, i, `w${i}`);
    assert.equal(r.result.ok, true, String(i));
    w = releaseUpstream(r.state, `w${i}`, 'done', i).state;
  }
  const over = acquireUpstream(w, { execution: 'w-over', tenant: 'user:99', product: 'a', model: 'm-other' }, 200, 'over').result;
  // Mutation checked: dropping the window check admits it.
  assert.equal(over.ok, false);
  assert.equal((over as any).reason, 'window_full');
  assert.equal((over as any).wait_ms, 60_000 - 200, 'until the oldest request leaves the window');
});

// ── restart safety ────────────────────────────────────────────────────────────

test('D5338: an eviction, a restart or a deploy finds every outstanding lease in storage; a release after it frees exactly its own slot', async () => {
  const gov = governorNamespace();
  const tokens: string[] = [];
  await at(1_000, async () => {
    for (let i = 0; i < UPSTREAM_LIMITS.modelConcurrent; i++) {
      const r = await acq(gov, `exec-${i}`, `user:${Math.floor(i / 2)}`);
      assert.equal(r.ok, true); tokens.push(r.token);
    }
  });
  assert.equal(readUpstreamState(gov.stored(OBJ)).leases.length, UPSTREAM_LIMITS.modelConcurrent, 'durable, not in memory');
  // Evicted, restarted or redeployed: a new instance over the same storage.
  for (const event of ['eviction', 'deploy']) {
    gov.restart();
    // Mutation checked: keeping the state in an instance field (as the deck governor does) admits this after the restart.
    const r = await at(2_000, () => acq(gov, `exec-new-${event}`, 'user:new'));
    assert.deepEqual(r, { ok: false, reason: 'model_full', wait_ms: 500 }, event);
  }
  gov.restart();
  assert.deepEqual(await at(3_000, () => post(gov, 'release', { token: tokens[0], completion: 'done' })), { released: true });
  const again = await at(3_000, () => acq(gov, 'exec-new', 'user:new'));
  assert.equal(again.ok, true);
  assert.equal(readUpstreamState(gov.stored(OBJ)).leases.length, UPSTREAM_LIMITS.modelConcurrent);
});

test('D5338: a lease that expires during a stalled call frees its slot only after the run\'s own ceiling, and its late release frees nothing a newer execution holds', async () => {
  const gov = governorNamespace();
  const stalled = await at(0, () => acq(gov, 'exec-stalled', 'user:2'));
  // Still live just before its expiry: the newer execution of the same tenant shares the tenant's two slots.
  await at(LEASE_TTL_MS - 1, () => acq(gov, 'exec-other', 'user:2'));
  assert.equal((await at(LEASE_TTL_MS - 1, () => acq(gov, 'exec-third', 'user:2'))).reason, 'tenant_share');
  // Expired: the slot goes to a newer execution.
  const newer = await at(LEASE_TTL_MS + 1, () => acq(gov, 'exec-newer', 'user:2'));
  assert.equal(newer.ok, true);
  assert.notEqual(newer.token, stalled.token);
  // The stalled call comes back and releases: nothing is freed, and the newer lease stands.
  // Mutation checked: releasing any live lease rather than the token's own frees the newer lease here.
  assert.deepEqual(await at(LEASE_TTL_MS + 2, () => post(gov, 'release', { token: stalled.token, completion: 'done' })), { released: false });
  const held = readUpstreamState(gov.stored(OBJ)).leases.map((l) => l.token);
  assert.ok(held.includes(newer.token));
  // Its retry is refused too: an expired lease cannot buy more requests.
  assert.deepEqual(await at(LEASE_TTL_MS + 2, () => post(gov, 'attempt', { token: stalled.token })), { ok: false, reason: 'lease_gone', wait_ms: 0 });
});

test('D5338: a duplicate release frees nothing more; an unknown completion keeps the slot until the lease expires', async () => {
  const gov = governorNamespace();
  const a = await at(0, () => acq(gov, 'exec-a', 'user:2'));
  const b = await at(0, () => acq(gov, 'exec-b', 'user:2'));
  assert.deepEqual(await at(10, () => post(gov, 'release', { token: a.token, completion: 'done' })), { released: true });
  // Mutation checked: a release that matches any live lease rather than the token's own frees b here.
  assert.deepEqual(await at(11, () => post(gov, 'release', { token: a.token, completion: 'done' })), { released: false });
  assert.deepEqual(readUpstreamState(gov.stored(OBJ)).leases.map((l) => l.token), [b.token]);

  // A timeout: the provider may still be working, so the slot is not given back early.
  assert.deepEqual(await at(20, () => post(gov, 'release', { token: b.token, completion: 'unknown' })), { released: true });
  assert.equal(upstreamHeld(readUpstreamState(gov.stored(OBJ)), 20).unknown, 1);
  // Mutation checked: freeing on an unknown completion admits a third lease for user:2 here.
  await at(30, () => acq(gov, 'exec-c', 'user:2'));
  assert.equal((await at(30, () => acq(gov, 'exec-d', 'user:2'))).reason, 'tenant_share');
  assert.deepEqual(await at(40, () => post(gov, 'release', { token: b.token, completion: 'done' })), { released: false }, 'released once');
  assert.equal((await at(LEASE_TTL_MS + 1, () => acq(gov, 'exec-d', 'user:2'))).ok, true, 'free once it expires');
});

test('D5338: one execution, one lease — a second admission under the same execution id waits', () => {
  const r = acquireUpstream(emptyUpstreamState(), { execution: 'e', tenant: 'user:1', product: 'a', model: MODEL }, 0, 't1');
  assert.equal(acquireUpstream(r.state, { execution: 'e', tenant: 'user:1', product: 'a', model: MODEL }, 1, 't2').result.ok, false);
});

test('D5338: an attempt counts one request and renews the lease; on a lease released as unknown it is refused', () => {
  const a = acquireUpstream(emptyUpstreamState(), { execution: 'e', tenant: 'user:1', product: 'a', model: MODEL }, 0, 't1');
  const r = attemptUpstream(a.state, 't1', 1_000);
  assert.deepEqual(r.result, { ok: true, token: 't1', expires: 1_000 + LEASE_TTL_MS });
  assert.equal(r.state.requests.length, 2);
  const unknown = releaseUpstream(r.state, 't1', 'unknown', 2_000).state;
  assert.deepEqual(attemptUpstream(unknown, 't1', 2_001).result, { ok: false, reason: 'lease_gone', wait_ms: 0 });
});

test('D5338: an unreadable stored value reads as empty, never a crash; a bad body is a 400', async () => {
  assert.deepEqual(readUpstreamState(null), emptyUpstreamState());
  assert.deepEqual(readUpstreamState({ v: 2, leases: [] }), emptyUpstreamState());
  const gov = governorNamespace();
  const r = await gov.ns.get(gov.ns.idFromName(OBJ)).fetch('https://ai-governor/upstream/acquire', { method: 'POST', body: JSON.stringify({ tenant: 'user:1' }) });
  assert.equal(r.status, 400);
});

// ── the client behind deps.admit ──────────────────────────────────────────────

test('D5338: a missing binding refuses, with no in-memory fallback; an object that cannot answer refuses through the seam', async () => {
  const w = world({ AI_GOVERNOR: undefined });
  const s = stubAi([answer]);
  // Mutation checked: an in-process fallback (as `governorFor` has for decks) admits this run.
  const r = await run(w.env, s.ai);
  assert.deepEqual([r.ok, (r as any).refusal], [false, 'capacity_unavailable']);
  assert.equal(s.gw(), 0, 'no outbound call');
  assert.deepEqual(await upstreamAdmission(w.env)({ gateway: SLUG, userId: 2, model: MODEL, task: 'publication', executionId: 'x' }), { ok: false, retryAfterSec: null, reason: 'no_binding' });

  const broken = world({ AI_GOVERNOR: { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('down', { status: 500 }) }) } });
  const b = stubAi([answer]);
  const rb = await run(broken.env, b.ai);
  assert.deepEqual([rb.ok, (rb as any).refusal], [false, 'capacity_unavailable']);
  assert.equal(b.gw(), 0);
  assert.equal(broken.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n, 0, 'no hold');
});

test('D5338: bounded waiting — a full lease waits at most ADMIT_MAX_WAIT_MS, then refuses with a retry-after and no call', async () => {
  const w = world();
  for (let i = 0; i < UPSTREAM_LIMITS.modelConcurrent; i++) await acq(w.gov, `held-${i}`, `user:${10 + Math.floor(i / 2)}`);
  sleeps.length = 0;
  const s = stubAi([answer]);
  const r = await run(w.env, s.ai);
  assert.deepEqual([r.ok, (r as any).refusal, (r as any).retryAfterSec], [false, 'capacity_unavailable', 1]);
  assert.equal(s.gw(), 0);
  const waited = sleeps.reduce((a, b) => a + b, 0);
  // Mutation checked: an unbounded wait loop never returns here.
  assert.equal(waited, ADMIT_MAX_WAIT_MS);
});

test('D5338: retries count against the same lease — each is a request in the window, and a refused retry ends the run', async () => {
  // Rate limited twice, then answered: three requests in the window, one lease, one charge.
  let w = world();
  let s = stubAi(['throw-2018', 'throw-2018', answer]);
  let r = await run(w.env, s.ai);
  assert.equal(r.ok, true);
  assert.equal(s.gw(), 3);
  let st = readUpstreamState(w.gov.stored(OBJ));
  // Mutation checked: skipping `attempt` before a retry leaves 1 here.
  assert.equal(st.requests.length, 3, 'every attempt is counted');
  assert.equal(st.leases.length, 0, 'released once, after the run');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n, 1, 'one hold for the execution');

  // The tenant's window has room for one request: the first attempt runs, the retry is refused, and the run ends with its failure.
  w = world();
  for (let i = 0; i < UPSTREAM_LIMITS.tenantWindowRequests - 1; i++) {
    const a = await acq(w.gov, `fill-${i}`, 'user:2');
    await post(w.gov, 'release', { token: a.token, completion: 'done' });
  }
  s = stubAi(['throw-2018', answer]);
  r = await run(w.env, s.ai);
  // Mutation checked: ignoring `attempt`'s refusal calls twice here.
  assert.equal(s.gw(), 1);
  assert.deepEqual([r.ok, (r as any).refusal, (r as any).completion], [false, 'all_models_failed', 'none']);
  st = readUpstreamState(w.gov.stored(OBJ));
  assert.equal(st.requests.filter((x) => x.tenant === 'user:2').length, UPSTREAM_LIMITS.tenantWindowRequests);
});

// ── no outbound call before the checks; a timeout is not "no work" ───────────

test('D5338: provider off, an unapproved data class, an insufficient balance and an unavailable admission each make no outbound call', async () => {
  for (const [label, env, over] of [
    ['provider off', { [GATEWAY_TEXT_SWITCH]: 'off' }, {}],
    ['data class', {}, { dataClass: 'member_private' }],
  ] as const) {
    const w = world(env); const s = stubAi([answer]);
    const r = await run(w.env, s.ai, over);
    assert.equal(r.ok, false, label);
    assert.equal(s.gw(), 0, label);
    assert.equal(w.gov.calls.length, 0, `${label}: refused before admission is asked`);
  }
  const broke = world(); setFixtureAllowance(broke.db, 0);
  let s = stubAi([answer]);
  const rb = await run(broke.env, s.ai);
  assert.deepEqual([rb.ok, (rb as any).refusal], [false, 'insufficient_tokens']);
  assert.equal(s.gw(), 0);
  // The admission was taken and given back: nothing was called, so the slot is free.
  assert.equal(readUpstreamState(broke.gov.stored(OBJ)).leases.length, 0);

  const down = world({ AI_GOVERNOR: { idFromName: (n: string) => n, get: () => ({ fetch: async () => { throw new Error('object unreachable'); } }) } });
  s = stubAi([answer]);
  const rd = await run(down.env, s.ai);
  assert.deepEqual([rd.ok, (rd as any).refusal], [false, 'capacity_unavailable']);
  assert.equal(s.gw(), 0);
});

test('D5338: a timeout is completion unknown, never "no work done": nothing charged, the slot held until the lease expires', async () => {
  const w = world();
  const s = stubAi(['hang']);
  const r = await run(w.env, s.ai);
  assert.deepEqual([r.ok, (r as any).error, (r as any).completion], [false, 'timeout', 'unknown']);
  assert.equal(s.gw(), 1, 'never retried');
  const st = readUpstreamState(w.gov.stored(OBJ));
  // Mutation checked: releasing with completion 'none' on a timeout frees the slot here.
  assert.equal(st.leases.length, 1);
  assert.equal(st.leases[0].unknown, true);
  const row = w.db.prepare("SELECT * FROM ai_usage_logs WHERE model = ? ORDER BY id DESC").get(MODEL);
  assert.equal(JSON.parse(row.units_json).completion, 'unknown');
});

test('D5338: one charge per execution — answered runs each hold and settle once, and a replay of the same id is refused without a call', async () => {
  const w = world();
  const s = stubAi([answer]);
  const r1 = await run(w.env, s.ai, { executionId: 'exec-once' });
  assert.equal(r1.ok, true);
  const r2 = await run(w.env, s.ai, { executionId: 'exec-once' });
  assert.equal(r2.ok, false);
  assert.equal(s.gw(), 1);
  const charged = w.db.prepare('SELECT COUNT(*) AS n FROM ai_usage_logs WHERE model = ? AND charged_microusd > 0').get(MODEL).n;
  assert.equal(charged, 1);
  assert.equal(readUpstreamState(w.gov.stored(OBJ)).leases.length, 0);
});

// ── the publications caller ───────────────────────────────────────────────────

test('D5338: the publications caller passes the lease — with the governor it is acquired and released; without the binding the gateway is not called', async () => {
  const AGG = [{ dimension_key: 'fintech', period_key: '2026-W44', n: 7, value: 0.4, payload: {} }] as any;
  const OPTS = { title: 'Weekly heat', section: 'sector_heat', audience: 'lp', filters: {}, aggregates: AGG };
  const DEPS = { attemptTimeoutMs: 50, timeoutMs: 2000, random: () => 0.5, sleep };
  const w = world();
  let s = stubAi([answer]);
  const r = await draftSummary({ ...w.env, AI: s.ai }, 2, OPTS, DEPS);
  assert.equal(r.model, PUBLICATION_GATEWAY_MODEL);
  // Mutation checked: dropping `admit` from the caller leaves no governor call.
  assert.deepEqual(w.gov.calls, [`${OBJ} /upstream/acquire`, `${OBJ} /upstream/release`]);

  const none = world({ AI_GOVERNOR: undefined });
  s = stubAi([answer]);
  const rn = await draftSummary({ ...none.env, AI: s.ai }, 2, OPTS, DEPS);
  assert.equal(s.gw(), 0, 'no gateway call without the lease');
  assert.notEqual(rn.model, PUBLICATION_GATEWAY_MODEL);
});

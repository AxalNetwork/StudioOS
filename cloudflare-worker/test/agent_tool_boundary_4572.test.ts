/**
 * #4572 (Security S3) — adversarial tests of the agent, MCP and tool boundary,
 * on a versioned synthetic corpus (`fixtures/adversarial_4572/corpus.json`).
 * Every row is made up; nothing reaches a provider, a network or production.
 * The existing permission system (#4534, D1496, D852, D1588) is what is tested:
 * nothing here adds a policy.
 *
 *   1. Untrusted content stays data: every injection in the corpus, as a tool
 *      result, a refusal or a cut result, is wrapped once, cannot close or open
 *      a wrapper, and sits under the not-instructions notice.
 *   2. A tool is found by its exact registered identity, never a prefix,
 *      suffix, case or look-alike, and a refused name has zero effects: no
 *      database read, no proposal, no call.
 *   3. Permission follows the declared scope, not the name: every tool needing a
 *      write scope is `readOnly: false`, every `readOnly: false` tool needs one,
 *      and every `proposes` tool is a write.
 *   4. An agent reads only what was granted, exactly; every check is made
 *      again at call time (revoked grant, paused agent, sponsor gone, another
 *      sponsor) and a refusal has zero calls and zero holds.
 *   5. Remote MCP SSRF: every corpus URL is refused before any lookup, every
 *      private address is refused after one, and a refused host is never fetched.
 *   6. R2-07, the halt and revocation contract (D4572): a halt read that fails
 *      is a halt; a halt that becomes visible between steps stops the run at
 *      that step and keeps the one charge it already made; a sponsor revoked
 *      between steps runs nothing; a halt while a person decides lets the
 *      person's decision land but admits nothing new.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, PROJECT, SPONSOR, STRANGER, fakeAgentRun, harness, hex, loopDeps, world, type World } from './_agent_engine_fixture.ts';
import { TOOL_DATA_NOTICE, runEadwynToolCalls, toolResultsForModel, type EadwynToolResult } from '../src/services/eadwynTools.ts';
import { registeredTools, WRITE_SCOPES } from '../src/mcp/server.ts';
import { SCOPES } from '../src/mcp/oauth.ts';
import { capResult, cleanReads, readTools, TOOL_RESULT_MAX } from '../src/services/agents/agentTools.ts';
import { agentMcpRefusal } from '../src/services/agents/allowlists.ts';
import { customUrlRefusal, guardedFetcher, isPublicAddress } from '../src/integrations/customMcp.ts';
import { haltedAll, engineMode } from '../src/agents/runtime.ts';
import { after, runTaskLoop } from '../src/agents/loop.ts';

test.after(() => removeMigratedDatabases());

const CORPUS = JSON.parse(readFileSync(new URL('./fixtures/adversarial_4572/corpus.json', import.meta.url), 'utf8'));
const P = { kind: 'project' as const, id: PROJECT };

test('the corpus is versioned and synthetic', () => {
  assert.equal(CORPUS.version, 1);
  assert.equal(CORPUS.synthetic, true);
  assert.ok(CORPUS.injections.length >= 15 && CORPUS.refused_urls.length >= 20 && CORPUS.private_addresses.length >= 20);
  // Any address in the injections is on a reserved domain (`.invalid`); the URL list uses `example.com` (RFC 2606).
  const text = CORPUS.injections.map((i: { text: string }) => i.text).join('\n');
  for (const m of text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []) assert.match(m, /\.invalid$/, `${m}: only reserved domains`);
  for (const { url } of CORPUS.refused_urls) assert.doesNotMatch(url, /axal\.vc\/(?!api\/mcp)/, 'no real path on our host');
});

// ── 1 · untrusted content stays data ─────────────────────────────────────────

/** The wrapper's structure, read back: the notice, then exactly `n` well-formed blocks with nothing between them. */
function assertWrapped(block: string, n: number) {
  const [notice, ...lines] = block.split('\n');
  assert.equal(notice, TOOL_DATA_NOTICE);
  assert.equal(lines.length, n, 'one line per result: a payload cannot add a line');
  for (const l of lines) {
    const m = /^<tool_result name="([A-Za-z0-9_.-]*)" outcome="(data|proposal|refused)" trust="data">([^<>]*)<\/tool_result>$/.exec(l);
    assert.ok(m, `not one well-formed block: ${l.slice(0, 160)}`);
    JSON.parse(m![3]); // the body is the JSON it claims to be
  }
}

test('1: every injection, as data, as a refusal, as a tool name and cut to size, stays inside one inert block', () => {
  // Mutation checked: `inert` without its < and > escapes (a forged </tool_result> closes the wrapper).
  for (const inj of CORPUS.injections) {
    const results: EadwynToolResult[] = [
      { name: 'synthetic.read', outcome: 'data', data: { note: inj.text, nested: [{ text: inj.text }] } },
      { name: 'synthetic.read', outcome: 'refused', error: inj.text },
      { name: inj.text, outcome: 'data', data: inj.text },
      { name: 'synthetic.read', outcome: 'data', data: capResult({ big: inj.text.repeat(Math.ceil((TOOL_RESULT_MAX * 2) / Math.max(1, inj.text.length))) }) },
    ];
    assertWrapped(toolResultsForModel(results), results.length);
  }
  const cut = capResult({ x: 'y'.repeat(TOOL_RESULT_MAX * 3) }) as { truncated: boolean; text: string };
  assert.equal(cut.truncated, true);
  assert.ok(cut.text.length <= TOOL_RESULT_MAX, 'a cut result never exceeds the cap');
});

// ── 2 · exact identity, zero effects ─────────────────────────────────────────

/** An env that records every binding read (and throws): a refused call must read none, even one a caller would catch. */
const touched: string[] = [];
const untouchable = () => new Proxy({}, { get: (_t, k) => { if (k === 'then') return undefined; touched.push(String(k)); throw new Error(`touched env.${String(k)}`); } }) as any;

test('2: a tool is matched by its exact registered name; every variant is refused with zero effects', async () => {
  // Mutation checked: the lookup by name prefix (`available.get` replaced with a startsWith search).
  const real = registeredTools().find((t) => !t.company);
  assert.ok(real, 'a tool that takes no company');
  const variants = [
    ...CORPUS.tool_name_variants,
    `${real!.name}​`, ` ${real!.name}`, `${real!.name} `, real!.name.toUpperCase(), `${real!.name}.x`, `x.${real!.name}`,
    real!.name.slice(0, -1), real!.name.replace(/a/, 'а'), `${real!.name}\u0000`,
  ].filter((v) => v !== real!.name);
  touched.length = 0;
  // One variant per turn: a turn runs at most MAX_TOOL_CALLS_PER_TURN calls, and the limit's refusal is not this test.
  for (const name of variants) {
    const [r] = await runEadwynToolCalls(untouchable(), { userId: 1, companyId: null as any, page: 'synthetic', option: 'synthetic' } as any, [{ name, args: {} }]);
    assert.deepEqual([r.outcome, (r as any).error], ['refused', 'That tool is not available here.'], JSON.stringify(name));
  }
  assert.deepEqual(touched, [], 'no binding was read for any refused name');
  // Non-string names and non-object calls are refused the same way.
  const odd = await runEadwynToolCalls(untouchable(), { userId: 1, companyId: null as any, page: 's', option: 's' } as any,
    [{ name: 42 }, { name: null }, { name: { toString: () => real!.name } }, null as any]);
  assert.ok(odd.every((r) => r.outcome === 'refused'));
  assert.deepEqual(touched, []);
});

// ── 3 · permission follows the declared scope ────────────────────────────────

/** Whether a declared OAuth scope grants writes: its own name says so (`:write`, `:propose`), on the declared list only. */
const writeScope = (s: string) => /:(write|propose)$/.test(s);

test('3: every write-scoped tool is readOnly:false, every readOnly:false tool needs a write scope, every proposes tool is a write', () => {
  // Mutation checked: a write-scoped registry tool declared without readOnly:false.
  for (const s of SCOPES) assert.match(s, /:(read|write|propose)$/, `${s}: every declared scope is a read or a write, so the rule below is total`);
  for (const s of WRITE_SCOPES) assert.ok(writeScope(s), `${s}: a company-write scope is a write scope`);
  const tools = registeredTools();
  assert.ok(tools.length > 10);
  const bad: string[] = [];
  for (const t of tools) {
    assert.ok((SCOPES as readonly string[]).includes(t.requiredScope), `${t.name}: ${t.requiredScope} is not a declared scope`);
    const writes = writeScope(t.requiredScope);
    if (writes && t.readOnly !== false) bad.push(`${t.name}: ${t.requiredScope} is a write scope but readOnly is ${t.readOnly}`);
    if (t.readOnly === false && !writes) bad.push(`${t.name}: readOnly:false under the read scope ${t.requiredScope}`);
    if (t.proposes && t.readOnly !== false) bad.push(`${t.name}: proposes but is not declared a write`);
  }
  assert.deepEqual(bad, [], 'whether a tool writes is declared, never read from its name');
});

// ── 4 · an agent's reads: exact grant, re-checked at call time, zero effects on refusal ─

const INTEGRATION = hex(1, 'd');
const TOOL = 'synthetic_read';

function agentWorld() {
  const w = world();
  w.db.prepare("UPDATE users SET subscription_tier = 'studio' WHERE id = ?").run(SPONSOR);
  w.env.CUSTOM_MCP_ENABLED = 'true';
  w.agent(AGENT);
  w.db.prepare('UPDATE team_agents SET tool_grants_json = ? WHERE id = ?').run(JSON.stringify([{ integration_uid: INTEGRATION, tool: TOOL }]), AGENT);
  const uid = hex(AGENT, 'b');
  return { w, uid };
}

test('4a: a read must name a granted tool exactly', () => {
  const grants = [{ integration_uid: INTEGRATION, tool: TOOL }];
  for (const tool of [`${TOOL} `, TOOL.toUpperCase(), `${TOOL}_all`, `read_${TOOL}`, `${TOOL}​`]) {
    const r = cleanReads([{ integration_uid: INTEGRATION, tool, arguments: {} }], grants);
    assert.deepEqual([r.ok, !r.ok && r.code], [false, 'tool_not_granted'], tool);
  }
  assert.deepEqual((cleanReads([{ integration_uid: hex(2, 'd'), tool: TOOL }], grants) as any).code, 'tool_not_granted', 'another server');
  assert.deepEqual((cleanReads(new Array(6).fill({ integration_uid: INTEGRATION, tool: TOOL }), grants) as any).code, 'too_many_tool_reads');
  assert.deepEqual((cleanReads([{ integration_uid: INTEGRATION, tool: TOOL, arguments: ['x'] }], grants) as any).code, 'invalid_tool_reads');
});

test('4b: every authority is re-checked at call time — a revoked grant, a paused agent, a lost sponsor, another sponsor', async () => {
  // Mutation checked: agentMcpRefusal's grant check matching by tool name prefix.
  const cases: Array<[string, (w: World) => void, number, string]> = [
    ['grant revoked', (w) => { w.db.prepare("UPDATE team_agents SET tool_grants_json = '[]' WHERE id = ?").run(AGENT); }, SPONSOR, 'tool_not_granted'],
    ['agent paused', (w) => { w.db.prepare("UPDATE team_agents SET status = 'paused' WHERE id = ?").run(AGENT); }, SPONSOR, 'agent_context_invalid'],
    ['sponsor deactivated', (w) => { w.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(SPONSOR); }, SPONSOR, 'sponsor_lost_access'],
    ['another sponsor', () => {}, STRANGER, 'agent_context_invalid'],
    ['engine off for agents', (w) => { w.env.TEAM_AGENTS_ENABLED = 'false'; }, SPONSOR, 'team_agents_off'],
  ];
  for (const [label, revoke, sponsor, code] of cases) {
    const { w, uid } = agentWorld();
    try {
      revoke(w);
      const denied = await agentMcpRefusal(w.env, sponsor, { agent_uid: uid, integration_uid: INTEGRATION }, TOOL);
      assert.equal(denied?.code, code, label);
      // The same refusal through the read path: nothing called, nothing held.
      let calls = 0; let holds = 0;
      const r = await readTools(w.env, { uid, sponsor_user_id: sponsor } as any, [{ integration_uid: INTEGRATION, tool: TOOL, arguments: {} }], `exec-${label}`, {
        call: (async () => { calls += 1; return { untrusted: true, data: 'x' }; }) as any,
        metered: (async (_e: any, _o: any, fn: any) => { holds += 1; return { value: await fn(), usage: {} }; }) as any,
      });
      assert.equal((r as any).ok, false, label);
      assert.deepEqual([calls, holds], [0, 0], `${label}: zero calls and zero holds`);
    } finally { w.close(); }
  }
  // A prefix or suffix of the granted tool is not granted.
  const { w, uid } = agentWorld();
  try {
    for (const t of [`${TOOL}_write`, TOOL.slice(0, -1), `${TOOL} `]) {
      assert.equal((await agentMcpRefusal(w.env, SPONSOR, { agent_uid: uid, integration_uid: INTEGRATION }, t))?.code, 'tool_not_granted', t);
    }
  } finally { w.close(); }
});

// ── 5 · remote MCP SSRF ──────────────────────────────────────────────────────

test('5a: every corpus URL is refused before any lookup, for its own reason', () => {
  // Mutation checked: the ip_literal check removed (an IP literal reaches DNS).
  for (const { url, reason } of CORPUS.refused_urls) assert.equal(customUrlRefusal(url), reason, url);
  assert.equal(customUrlRefusal('https://mcp.example.com/mcp'), null, 'a plain public https URL passes this stage');
  assert.equal(customUrlRefusal('https://mcp.synthetic-host.example/mcp', 'mcp.synthetic-host.example'), 'axal_host', 'the host the request came to');
});

test('5b: every private, loopback, link-local, metadata and mapped address is refused; public ones pass', () => {
  for (const ip of CORPUS.private_addresses) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of CORPUS.public_addresses) assert.equal(isPublicAddress(ip), true, ip);
});

test('5c: a host resolving to any private address, or off the connection\'s hosts, is never fetched; redirects are never followed', async () => {
  // Mutation checked: guardHost passing when SOME address is public (`every` → `some`).
  const fetched: Array<{ url: string; redirect: unknown }> = [];
  const base = (async (url: string, init: RequestInit) => { fetched.push({ url, redirect: init.redirect }); return new Response('{}'); }) as any;
  const resolver = (map: Record<string, string[]>) => async (h: string) => { if (!(h in map)) throw new Error('nx'); return map[h]; };
  const rebind = guardedFetcher(['mcp.example.com'], resolver({ 'mcp.example.com': ['93.184.216.34', '10.0.0.5'] }), base);
  await assert.rejects(rebind('https://mcp.example.com/mcp', { method: 'POST' }), /custom_mcp_host_refused/);
  const meta = guardedFetcher(['mcp.example.com'], resolver({ 'mcp.example.com': ['169.254.169.254'] }), base);
  await assert.rejects(meta('https://mcp.example.com/mcp', { method: 'POST' }), /custom_mcp_host_refused/);
  const off = guardedFetcher(['mcp.example.com'], resolver({ 'other.example.com': ['93.184.216.34'] }), base);
  await assert.rejects(off('https://other.example.com/mcp', { method: 'POST' }), /custom_mcp_host_refused/);
  const unresolved = guardedFetcher(['mcp.example.com'], resolver({}), base);
  await assert.rejects(unresolved('https://mcp.example.com/mcp', { method: 'POST' }), /custom_mcp_host_refused/);
  for (const { url } of CORPUS.refused_urls) {
    const g = guardedFetcher(['mcp.example.com'], resolver({ 'mcp.example.com': ['93.184.216.34'] }), base);
    await assert.rejects(g(url, { method: 'POST' }), /custom_mcp_(url|host)_refused/, url);
  }
  assert.deepEqual(fetched, [], 'zero outbound requests');
  const ok = guardedFetcher(['mcp.example.com'], resolver({ 'mcp.example.com': ['93.184.216.34'] }), base);
  await ok('https://mcp.example.com/mcp', { method: 'POST', redirect: 'follow' });
  assert.deepEqual(fetched, [{ url: 'https://mcp.example.com/mcp', redirect: 'manual' }], 'a redirect is never followed, whatever the caller asked');
});

// ── 6 · R2-07: halt and revocation ───────────────────────────────────────────

const admit = (w: World, taskId: number) => w.runtime.admit(P, { agentId: AGENT, taskId, by: SPONSOR, source: 'person' });
const runRow = (w: World, uid: string) => w.db.prepare('SELECT * FROM agent_task_runs WHERE uid = ?').get(uid) as any;

test('6a: a halt or breaker key that cannot be read is a halt; the read error never admits', async () => {
  // Mutation checked: haltedAll's catch returning false (fail open).
  const broken = { RATE_LIMITS: { get: async () => { throw new Error('kv timeout'); } } } as any;
  assert.equal(await haltedAll(broken), true);
  assert.equal(await engineMode({ ...broken, AGENT_ENGINE: 'on' }), 'paused');
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const a = await admit(w, 200);
    assert.ok(a.ok);
    const ar = fakeAgentRun(w);
    const h = harness();
    const realGet = w.kv.get;
    h.opts.beforeStep = (name) => { if (name === 'run') w.kv.get = async () => { throw new Error('kv timeout'); }; };
    const out = await runTaskLoop(a.run.uid, h.step, loopDeps(w, ar.fn));
    w.kv.get = realGet;
    assert.deepEqual([out.go, (out as any).status], [false, 'halted']);
    assert.deepEqual([ar.state.calls, ar.state.charges], [0, 0], 'nothing ran, nothing was held');
  } finally { w.close(); }
});

test('6b: a halt that becomes visible after the run step stops the run at the next step and keeps its one charge', async () => {
  // A stale-absent read: the run step sees no halt (propagation not yet visible); propose sees it.
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const a = await admit(w, 200);
    assert.ok(a.ok);
    const ar = fakeAgentRun(w);
    const h = harness();
    h.opts.decision = { status: 'accepted' };
    h.opts.beforeStep = async (name) => { if (name === 'propose') await w.kv.put('agents:halt', 'drill'); };
    const out = await runTaskLoop(a.run.uid, h.step, loopDeps(w, ar.fn));
    assert.deepEqual([out.go, (out as any).status], [false, 'halted']);
    assert.deepEqual([ar.state.calls, ar.state.charges], [1, 1], 'the step already run is not repeated or charged again');
    const run = runRow(w, a.run.uid);
    assert.ok(run.proposal_uid, 'its known output is kept, never silently discarded');
    assert.ok(w.db.prepare('SELECT 1 FROM ai_rail_proposals WHERE uid = ?').get(run.proposal_uid), 'the proposal row stays for a person');
    assert.ok(!h.executed.includes('after'), 'no decision effects after the halt');
  } finally { w.close(); }
});

test('6c: a sponsor revoked between admission and the run step runs nothing and pauses the agent', async () => {
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const a = await admit(w, 200);
    assert.ok(a.ok);
    const ar = fakeAgentRun(w);
    const h = harness();
    h.opts.beforeStep = (name) => { if (name === 'run') w.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(SPONSOR); };
    const out = await runTaskLoop(a.run.uid, h.step, loopDeps(w, ar.fn));
    assert.equal((out as any).refusal, 'sponsor_lost_access');
    assert.deepEqual([ar.state.calls, ar.state.charges], [0, 0]);
    assert.equal((w.db.prepare('SELECT status FROM team_agents WHERE id = ?').get(AGENT) as any).status, 'paused');
  } finally { w.close(); }
});

test('6d: a halt while a person decides lets the person\'s decision land, and admits nothing new', async () => {
  // Mutation checked: the halt read removed from BOTH admitNext and admission's engineRefusal (either one alone still
  // refuses: two independent checks, so removing one survives by design).
  const w = world({ autonomy: 'self_start' });
  try {
    w.agent(AGENT); w.task(200, AGENT); w.task(201, AGENT);
    const a = await admit(w, 200);
    assert.ok(a.ok);
    const ar = fakeAgentRun(w);
    const h = harness();
    // Run to the decision wait only: no decision yet (the 7-day timeout path is not taken here).
    h.opts.decision = { status: 'accepted' };
    h.opts.beforeStep = async (name) => { if (name === 'after') await w.kv.put('agents:halt', 'drill'); };
    const before = w.queue.length;
    await runTaskLoop(a.run.uid, h.step, loopDeps(w, ar.fn));
    assert.equal((w.db.prepare('SELECT status FROM scope_tasks WHERE id = 200').get() as any).status, 'done', 'the person accepted it: that stands');
    const live = w.db.prepare("SELECT COUNT(*) AS n FROM agent_task_runs WHERE agent_id = ? AND status IN ('admitted','running')").get(AGENT) as any;
    assert.equal(live.n, 0, 'the next task was not admitted under a halt');
    assert.equal(w.queue.length, before, 'nothing queued');
    assert.equal(ar.state.charges, 1);
  } finally { w.close(); }
});

test('6e: the stop boundary is a step: engine off read at the next step ends the run there', async () => {
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const a = await admit(w, 200);
    assert.ok(a.ok);
    const ar = fakeAgentRun(w);
    const h = harness();
    h.opts.beforeStep = (name) => { if (name === 'run') w.env.AGENT_ENGINE = 'off'; };
    const out = await runTaskLoop(a.run.uid, h.step, loopDeps(w, ar.fn));
    assert.deepEqual([(out as any).status, (out as any).refusal, ar.state.calls], ['halted', 'engine_off', 0]);
    // `paused` stops admissions only: an admitted run carries on (the runtime's documented semantics).
    const w2 = world();
    try {
      w2.agent(AGENT); w2.task(200, AGENT);
      const b = await admit(w2, 200);
      assert.ok(b.ok);
      const ar2 = fakeAgentRun(w2);
      const h2 = harness();
      h2.opts.decision = 'timeout';
      h2.opts.beforeStep = (name) => { if (name === 'run') w2.env.AGENT_ENGINE = 'paused'; };
      await runTaskLoop(b.run.uid, h2.step, loopDeps(w2, ar2.fn));
      assert.equal(ar2.state.calls, 1, 'paused does not stop an admitted run; the halt key does');
    } finally { w2.close(); }
  } finally { w.close(); }
});

// `after` is imported so a reader sees which step a decision's effects run in (6d).
void after;

/**
 * #3852 (E0 of #3742, under D1528) — the three rules the Agents SDK runtime
 * (`src/agents/sdkRuntime.ts`, `src/agents/sdkScope.ts`) must keep, each a
 * test, plus the pin.
 *
 *  1. No model call except through `run()`: nothing under
 *     `src/services/agents/` and nothing in the sdk runtime references
 *     `env.AI.run`, `workers-ai-provider`, a provider key, or the SDK's
 *     harness, model adapters or chat agent.
 *  2. The SDK's built-in tools stay behind the rule-book floor: the runtime
 *     imports `Agent` and `getAgentByName` from the package root and nothing
 *     else, so no tool (payments, email, browser automation, the sandbox,
 *     Code Mode, fetch or search) is reachable; no method is `@callable`; the
 *     Agent answers no request and accepts no socket; nothing routes a
 *     request to it. Every subpath the installed package exports is
 *     classified below, so an upgrade that adds one fails here until a person
 *     classifies it.
 *  3. A waiting run is resolved only by the approvals queue: no source file
 *     calls the SDK's `approveWorkflow`, `rejectWorkflow`, `waitForApproval`
 *     or `sendWorkflowEvent`; the one `decision` event is `deliverDecision`'s
 *     (`loop.ts`), and only `decideRailAs` (`railProposals.ts`, reached from
 *     `POST /api/teams/queue/:proposalUid/decide` and the member's own press)
 *     calls it.
 *
 * And the wiring: `AGENT_SCOPE_SDK` → `ScopeAgent` and its own `v6-agent-scope-sdk`
 * tag in all three wrangler tables and a branch's config; `AGENT_RUNTIME`
 * stays `do`; `index.ts` exports the class.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agents_sdk_rules_3852.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRendered, parseToml, renderBranchConfig } from '../../scripts/lib/branchConfig.mjs';
import { missingFromProduction } from '../../scripts/check-wrangler-binding-parity.mjs';

const WORKER = fileURLToPath(new URL('../', import.meta.url));
const SRC = join(WORKER, 'src');
const read = (rel: string) => readFileSync(join(WORKER, rel), 'utf8');
/** The code without its comments: a file may name what it never does. Block comments, then whole-line ones. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every .ts/.js file under a directory, as paths relative to the worker. */
function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /\.(ts|js|mjs)$/.test(e.name)) out.push(relative(WORKER, p));
    }
  };
  walk(dir);
  return out.sort();
}

const SDK_FILES = ['src/agents/sdkRuntime.ts', 'src/agents/sdkScope.ts'];

// ── Rule 1 ──────────────────────────────────────────────────────────────────

const MODEL_CALL = [
  /\benv\s*\.\s*AI\b/,
  /\.AI\s*\.\s*run\s*\(/,
  /workers-ai-provider/,
  /\b(?:OPENAI|ANTHROPIC|GEMINI|GOOGLE_AI|GROQ|MISTRAL|XAI|DEEPSEEK)_API_KEY\b/,
  /['"]@ai-sdk\//,
  /from\s+['"]ai['"]/,
  /['"]agents\/(?:harness|models|ai-chat-agent|ai-react|ai-types|chat|chat-sdk|codemode|observability\/ai)\b/,
  /\bAIChatAgent\b/,
];

test('rule 1: no model call but through run(): services/agents and the sdk runtime reference no model binding, provider or SDK harness', () => {
  // Mutation checked: `env.AI.run(` added to sdkScope.ts → the sdk file is named; `import { AIChatAgent } from 'agents/ai-chat-agent'`
  // added to services/agents/teams.ts → that file is named.
  const scanned = [...files(join(SRC, 'services', 'agents')), ...SDK_FILES];
  assert.ok(scanned.includes('src/services/agents/agentRun.ts') && scanned.length > 10, 'the folder is really read');
  const hits = scanned.flatMap((f) => MODEL_CALL.filter((re) => re.test(code(f))).map((re) => `${f}: ${re}`));
  assert.deepEqual(hits, []);
  // The guard is live: each pattern sees the line it is for.
  const lines = ['await env.AI.run(model, input)', "this.env.AI.run('@cf/x', {})", "import { createWorkersAI } from 'workers-ai-provider'",
    'c.env.OPENAI_API_KEY', "import { anthropic } from '@ai-sdk/anthropic'", "import { generateText } from 'ai'",
    "import { Think } from 'agents/harness/think'", 'class X extends AIChatAgent {}'];
  for (const l of lines) assert.ok(MODEL_CALL.some((re) => re.test(l)), l);
  // And the agents' model calls go through aiRouter's run().
  assert.match(read('src/services/agents/agentRun.ts'), /import \{[^}]*\brun\b[^}]*\} from '\.\.\/aiRouter'/);
});

// ── Rule 2 ──────────────────────────────────────────────────────────────────

/**
 * Every subpath `agents` exports, by what it is. Only the root is imported,
 * and from it only `Agent` and `getAgentByName`. A new subpath in an upgrade
 * matches none of these and fails the test until a person classifies it.
 */
const CLASSIFIED: [RegExp, string][] = [
  [/^\.$/, 'the Agent class and getAgentByName: the only import'],
  [/^\.\/x402$/, 'payments: never'],
  [/^\.\/email$|^\.\/experimental\/channels\/email$/, 'email sending: never'],
  [/^\.\/browser(?:\/|$)/, 'browser automation: not in v1'],
  [/^\.\/harness\/container(?:\/|$)|^\.\/skills\/runner$/, 'the sandbox: not in v1'],
  [/^\.\/codemode(?:\/|$)/, 'Code Mode: not in v1'],
  [/^\.\/(?:webfetch|websearch)(?:\/|$)/, 'read-only tools: not wired in v1; a result would be data, never instructions'],
  [/^\.\/(?:harness|models)(?:\/|$)|^\.\/ai-(?:chat-agent|chat-v5-migration|react|types)$|^\.\/chat(?:\/|$)|^\.\/chat-sdk$|^\.\/observability\/ai$/, 'model harness and chat agent: rule 1'],
  [/^\.\/mcp(?:\/|$)|^\.\/agent-tools$|^\.\/skills(?:\/|$)|^\.\/experimental\/webmcp$/, 'tools and tool servers: not in v1'],
  [/^\.\/experimental\/channels(?:\/|$)|^\.\/voice(?:\/|$)/, 'channels and voice: not in v1'],
  [/^\.\/(?:types|client|routing|streams|context|sessions|tasks|lifecycle|observability|react|websockets|state|schedule|queue|schedules|schedules\/parser|workflows|tsconfig|vite)$/, 'the framework\'s own parts and client: not imported'],
];

test('rule 2: the runtime imports only Agent and getAgentByName from the package root; every subpath of the pinned package is classified', () => {
  // Mutation checked: `import { createBrowserTools } from 'agents/browser'` added to sdkRuntime.ts → the import set differs;
  // a made-up `./payments-v2` subpath → unclassified.
  const imports: string[] = [];
  for (const f of SDK_FILES) {
    for (const m of code(f).matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"](agents(?:\/[^'"]*)?)['"]/g)) {
      imports.push(`${m[2]}: ${m[1].split(',').map((x) => x.trim().replace(/^type\s+/, '')).filter(Boolean).sort().join(', ')}`);
    }
    assert.doesNotMatch(code(f), /(?:import\s*\(|require\s*\()\s*['"]agents/, `${f}: no dynamic import of the package`);
  }
  assert.deepEqual(imports, ['agents: Agent, Connection, getAgentByName']);
  const pkg = JSON.parse(readFileSync(join(WORKER, 'node_modules', 'agents', 'package.json'), 'utf8'));
  const unclassified = Object.keys(pkg.exports).filter((p) => !CLASSIFIED.some(([re]) => re.test(p)));
  assert.deepEqual(unclassified, [], 'a subpath nobody has classified');
  assert.ok(!CLASSIFIED.some(([re]) => re.test('./payments-v2')), 'the table is not a catch-all');
});

test('rule 2: the pin is exact, and the lockfile holds that version', () => {
  const want = JSON.parse(read('package.json')).dependencies.agents;
  assert.match(want, /^\d+\.\d+\.\d+$/, 'an exact version; an upgrade is its own PR');
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.packages['node_modules/agents'].version, want);
});

test('rule 2: nothing reaches the Agent from outside the Worker: no @callable, no routing, no request, no socket', () => {
  // Mutation checked: `routeAgentRequest(req, env)` added to index.ts → named; onConnect's close removed → fails.
  const all = files(SRC);
  const hits = all.filter((f) => /@callable\b|\bcallable\s*\(|\brouteAgentRequest\b|\bagentsMiddleware\b|\bunstable_callable\b/.test(code(f)));
  assert.deepEqual(hits, []);
  const src = read('src/agents/sdkRuntime.ts');
  assert.match(src, /onRequest\(\): Response \{ return new Response\('Not found', \{ status: 404 \}\); \}/);
  assert.match(src, /onConnect\(connection: Connection\) \{ connection\.close\(1008, 'not_accepted'\); \}/);
  // One RPC entry, the scope's protocol; the duty callback is the only other method the SDK calls.
  const methods = [...src.matchAll(/^ {2}(?:async )?([a-zA-Z]+)\(/gm)].map((m) => m[1]).sort();
  assert.deepEqual(methods, ['call', 'dutyDue', 'onConnect', 'onRequest']);
});

// ── Rule 3 ──────────────────────────────────────────────────────────────────

test('rule 3: a waiting run is resolved only by the approvals queue', () => {
  // Mutation checked: `this.approveWorkflow(id)` added to sdkRuntime.ts → named; a second `import('../agents/loop')` calling
  // deliverDecision from routes/agent_engine.ts → named.
  const all = files(SRC);
  const sdkApproval = all.filter((f) => /\b(?:approveWorkflow|rejectWorkflow|waitForApproval|sendWorkflowEvent)\b/.test(code(f)));
  assert.deepEqual(sdkApproval, [], 'no SDK approval call anywhere');
  const decisionEvents = all.filter((f) => /sendEvent\(\s*\{\s*type:\s*'decision'/.test(code(f)));
  assert.deepEqual(decisionEvents, ['src/agents/loop.ts'], 'the one decision event is deliverDecision\'s');
  const callers = all.filter((f) => f !== 'src/agents/loop.ts' && /\bdeliverDecision\b/.test(code(f)));
  assert.deepEqual(callers, ['src/services/railProposals.ts']);
  const rp = read('src/services/railProposals.ts');
  const decideAs = rp.slice(rp.indexOf('export async function decideRailAs'));
  assert.match(decideAs.slice(0, decideAs.indexOf('\nexport ', 1)), /deliverDecision\(env, uid, decided\.status\)/, 'inside decideRailAs, after the decision is written');
  // The queue's decide route goes through decideRailAs.
  assert.match(read('src/routes/team_agents.ts'), /router\.post\('\/queue\/:proposalUid\/decide'/);
  assert.match(read('src/services/agents/queue.ts'), /decided = await decideRailAs\(/);
});

// ── The wiring ──────────────────────────────────────────────────────────────

test('wiring: AGENT_SCOPE_SDK and the v6-agent-scope-sdk tag in all three tables and a branch; AGENT_RUNTIME stays do', () => {
  // Mutation checked: the production binding removed → the parity guard and this test name it; the tag moved before v5 → order fails.
  const toml = readFileSync(join(WORKER, '..', 'wrangler.toml'), 'utf8');
  const { sections } = parseToml(toml);
  const unq = (v: string | undefined) => (v === undefined ? undefined : JSON.parse(v));
  for (const prefix of ['', 'env.production.', 'env.preview.']) {
    const dos = sections.filter((x: any) => x.name === `${prefix}durable_objects.bindings` && unq(x.kv.get('name')) === 'AGENT_SCOPE_SDK');
    assert.deepEqual(dos.map((x: any) => unq(x.kv.get('class_name'))), ['ScopeAgent'], `${prefix || 'top'}: the binding`);
    const tags = sections.filter((x: any) => x.name === `${prefix}migrations`).map((x: any) => [unq(x.kv.get('tag')), x.kv.get('new_sqlite_classes')]);
    // Append-only: v6 directly after v5. Later tags (D1581's v7-deck-remote) follow; they never move these.
    const v5 = tags.findIndex(([t]) => t === 'v5-agent-scope');
    assert.deepEqual(tags.slice(v5, v5 + 2), [['v5-agent-scope', '["AgentScope"]'], ['v6-agent-scope-sdk', '["ScopeAgent"]']], `${prefix || 'top'}: append-only, after v5`);
    const vars = sections.find((x: any) => x.name === `${prefix}vars`);
    assert.equal(unq(vars.kv.get('AGENT_RUNTIME')), 'do', `${prefix || 'top'}: the default is unchanged`);
  }
  assert.deepEqual(missingFromProduction(), []);
  const example = JSON.parse(readFileSync(join(WORKER, '..', 'infra', 'branches', '_example.json'), 'utf8'));
  const rendered = renderBranchConfig(toml, example);
  assert.deepEqual(checkRendered(toml, example, rendered), []);
  const out = parseToml(rendered).sections;
  assert.ok(out.find((x: any) => x.name === 'durable_objects.bindings' && unq(x.kv.get('name')) === 'AGENT_SCOPE_SDK'), 'a branch has its own');
  assert.ok(out.find((x: any) => x.name === 'migrations' && unq(x.kv.get('tag')) === 'v6-agent-scope-sdk'));
  assert.match(read('src/index.ts'), /^export \{ ScopeAgent \} from '\.\/agents\/sdkRuntime';$/m);
});

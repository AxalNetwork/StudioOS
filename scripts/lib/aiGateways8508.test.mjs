// #8508 (D8508): the static AI gateway and agent-settings check, one test per failure it names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkAiGateways, SOURCES, ALLOWED } from '../check-ai-gateways.mjs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const TOML = read('wrangler.toml');
const SRC = Object.fromEntries(SOURCES.map((p) => [p, read(p)]));

/** Sets `key = value` inside one vars table (adding the key if absent), or removes it when value is null. */
function setVar(toml, table, key, value) {
  const lines = toml.split('\n');
  const start = lines.findIndex((l) => l.trim() === `[${table}]`);
  assert.ok(start >= 0, `table ${table} exists`);
  let end = lines.findIndex((l, i) => i > start && /^\[/.test(l.trim()));
  if (end < 0) end = lines.length;
  const at = lines.findIndex((l, i) => i > start && i < end && new RegExp(`^${key}\\s*=`).test(l.trim()));
  const line = `${key} = ${JSON.stringify(value)}`;
  if (value === null) { if (at >= 0) lines.splice(at, 1); }
  else if (at >= 0) lines[at] = line;
  else lines.splice(start + 1, 0, line);
  return lines.join('\n');
}
const run = (toml = TOML, src = SRC, allow = ALLOWED) => checkAiGateways({ toml, src, allow });
const keys = (r) => r.failures.map((f) => `${f.rule} ${f.file} [${f.table}] ${f.key}`);

test('main passes, and each accepted difference carries a reason', () => {
  const r = run();
  assert.deepEqual(r.failures, []);
  assert.ok(r.accepted.length > 0);
  for (const a of r.accepted) assert.ok(a.reason.length > 20, `${a.key} has a reason`);
});

test('drift: a gateway slug that differs from production fails, naming file, table and key', () => {
  const r = run(setVar(TOML, 'vars', 'CF_AI_GATEWAY_SLUG_ADVISOR', 'advisor-other'));
  assert.deepEqual(keys(r), ['drift wrangler.toml [vars] CF_AI_GATEWAY_SLUG_ADVISOR']);
  assert.match(r.failures[0].message, /"advisor-other" here, "advisor-ongoing" in \[env\.production\.vars\]/);
});

test('drift: an agent setting missing from one table fails', () => {
  const r = run(setVar(TOML, 'vars', 'AGENT_AI_GATEWAY', null));
  assert.deepEqual(keys(r), ['drift wrangler.toml [vars] AGENT_AI_GATEWAY']);
});

test('drift: an allowlist entry covers only its exact value', () => {
  assert.deepEqual(run(TOML, SRC, ALLOWED.filter((a) => a.key !== 'CF_AI_GATEWAY_SLUG_ADVISOR')).failures.map((f) => f.key), ['CF_AI_GATEWAY_SLUG_ADVISOR']);
  const r = run(setVar(TOML, 'env.preview.vars', 'CF_AI_GATEWAY_SLUG_ADVISOR', 'advisor-ongoing-preview'));
  assert.deepEqual(keys(r), ['drift wrangler.toml [env.preview.vars] CF_AI_GATEWAY_SLUG_ADVISOR']);
  // ...and only its own table: preview's empty advisor slug does not excuse an empty one at the top level.
  assert.deepEqual(keys(run(setVar(TOML, 'vars', 'CF_AI_GATEWAY_SLUG_ADVISOR', ''))), ['drift wrangler.toml [vars] CF_AI_GATEWAY_SLUG_ADVISOR']);
});

test('gateway: an engine switched on with an empty agent gateway fails in that table', () => {
  let t = TOML;
  for (const tb of ['vars', 'env.production.vars', 'env.preview.vars']) t = setVar(setVar(t, tb, 'AGENT_ENGINE', 'canary'), tb, 'AGENT_AI_GATEWAY', '');
  const r = run(t);
  assert.deepEqual(keys(r).filter((k) => k.startsWith('gateway')), [
    'gateway wrangler.toml [vars] AGENT_AI_GATEWAY',
    'gateway wrangler.toml [env.production.vars] AGENT_AI_GATEWAY',
    'gateway wrangler.toml [env.preview.vars] AGENT_AI_GATEWAY',
  ]);
  assert.match(r.failures.find((f) => f.rule === 'gateway').message, /gateway_required/);
  // The inference stub answers engine runs without a gateway (gatewayRefusal), so preview may then be empty.
  const stub = run(setVar(t, 'env.preview.vars', 'AGENT_INFERENCE_STUB', 'on'));
  assert.ok(!keys(stub).includes('gateway wrangler.toml [env.preview.vars] AGENT_AI_GATEWAY'));
});

test('gateway: a malformed agent gateway fails even with the engine off', () => {
  let t = TOML;
  for (const tb of ['vars', 'env.production.vars', 'env.preview.vars']) t = setVar(t, tb, 'AGENT_AI_GATEWAY', 'not a gateway');
  assert.deepEqual(keys(run(t)).filter((k) => k.startsWith('gateway')).length, 3);
});

test('gateway: the provider path switched on with an empty or shared slug fails', () => {
  let t = TOML;
  for (const tb of ['vars', 'env.production.vars', 'env.preview.vars']) t = setVar(t, tb, 'AI_PROVIDER_GATEWAY_OPENAI', 'on');
  const r = run(t, SRC, [...ALLOWED, { rule: 'drift', table: 'env.preview.vars', key: 'AI_PROVIDER_GATEWAY_OPENAI', value: 'on', reason: 'test' }]);
  assert.ok(keys(r).includes('gateway wrangler.toml [env.production.vars] CF_AI_GATEWAY_SLUG_PROVIDERS'));
  let shared = t;
  for (const tb of ['vars', 'env.production.vars']) shared = setVar(shared, tb, 'CF_AI_GATEWAY_SLUG_PROVIDERS', 'advisor-ongoing');
  const s = run(shared).failures.find((f) => f.rule === 'gateway' && f.table === 'env.production.vars');
  assert.match(s.message, /advisor's or the deck's gateway/);
});

test('price: an unpriced Claude model fails; the OpenAI slot passes once AGENT_OPENAI_RATES prices it', () => {
  let t = TOML;
  for (const tb of ['vars', 'env.production.vars', 'env.preview.vars']) t = setVar(t, tb, 'AGENT_CLAUDE_MODEL', 'anthropic/claude-unpriced');
  assert.deepEqual(keys(run(t)), [
    'price wrangler.toml [vars] AGENT_CLAUDE_MODEL',
    'price wrangler.toml [env.production.vars] AGENT_CLAUDE_MODEL',
    'price wrangler.toml [env.preview.vars] AGENT_CLAUDE_MODEL',
  ]);
  const noAllow = ALLOWED.filter((a) => a.rule !== 'price');
  assert.equal(run(TOML, SRC, noAllow).failures.filter((f) => f.key === 'OPENAI_MODEL').length, 3);
  let priced = TOML;
  for (const tb of ['vars', 'env.production.vars', 'env.preview.vars'])
    priced = setVar(priced, tb, 'AGENT_OPENAI_RATES', '{"tokens_in":"1.25","tokens_cached":"0.125","tokens_out":"10"}');
  assert.deepEqual(run(priced, SRC, noAllow).failures, []);
});

test('code: a renamed gateway requirement in the source fails instead of passing silently', () => {
  const p = 'cloudflare-worker/src/services/agents/agentRun.ts';
  const r = run(TOML, { ...SRC, [p]: SRC[p].replace("'gateway_required'", "'gateway_needed'") });
  assert.deepEqual(r.failures.map((f) => `${f.rule} ${f.file} ${f.key}`), [`code ${p} gatewayRefusal 'gateway_required'`]);
});

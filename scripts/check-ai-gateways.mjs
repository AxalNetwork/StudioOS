#!/usr/bin/env node
/**
 * #8508 (D8508) — the static AI gateway and agent-settings check, layer 1.
 *
 *   node scripts/check-ai-gateways.mjs          CI (test:guards) and the release preflight
 *   node scripts/check-ai-gateways.mjs --json   the findings as JSON
 *
 * Reads `wrangler.toml` and the Worker's source only: no credential, no
 * Cloudflare call. It fails, naming the file, the table and the key, on:
 *   1. drift: a gateway slug or agent setting whose value in a table differs
 *      from `[env.production.vars]` (what ships), unless ALLOWED names that
 *      exact table, key and value with its reason;
 *   2. gateway: a switched-on path the code refuses without a gateway
 *      (`gateway_required` for an engine run, the provider gateway's
 *      `gatewayConfig`) whose slug is empty or malformed in that table;
 *   3. price: an agent account's model with no price (the catalogue's
 *      PROVIDER_MODELS or GATEWAY_TEXT_MODELS, or AGENT_OPENAI_RATES), unless
 *      ALLOWED says why the slot is meant to be skipped.
 * The names it checks are read from the code, so a rename there fails here
 * instead of passing silently. Whether a gateway exists on the account is the
 * live layer's question (#8508 layer 2), not this script's.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToml } from './lib/branchConfig.mjs';

export const TABLES = ['vars', 'env.production.vars', 'env.preview.vars'];
export const REFERENCE = 'env.production.vars';

/** The settings compared across tables. */
export const KEYS = [
  'CF_AI_GATEWAY_SLUG_ADVISOR', 'CF_AI_GATEWAY_SLUG_DECK', 'CF_AI_GATEWAY_SLUG_PROVIDERS',
  'AI_PROVIDER_GATEWAY_OPENAI', 'AI_GATEWAY_PROVIDERS_ZDR',
  'TEAM_AGENTS_ENABLED', 'AGENT_ENGINE', 'AGENT_AUTONOMY', 'AGENT_RUNTIME', 'AGENT_INFERENCE_STUB',
  'AGENT_AI_GATEWAY', 'AGENT_GATEWAY_MONTHLY_LIMIT_MICROUSD',
  'AGENT_CLAUDE_ALIAS_1', 'AGENT_CLAUDE_ALIAS_2', 'AGENT_CLAUDE_ALIAS_3', 'AGENT_OPENAI_ALIAS',
  'AGENT_CLAUDE_MODEL', 'OPENAI_MODEL', 'AGENT_OPENAI_RATES',
];

/**
 * Every accepted exception, with its reason. `value` is the exact value the
 * exception covers (`null` = unset): a different value fails again.
 */
export const ALLOWED = [
  { rule: 'drift', table: 'env.preview.vars', key: 'CF_AI_GATEWAY_SLUG_ADVISOR', value: '',
    reason: '#4566: preview must not share production\'s advisor gateway (logs, cache, limits); empty until a preview gateway exists. check-preview-isolation refuses the production slug.' },
  { rule: 'drift', table: 'env.preview.vars', key: 'TEAM_AGENTS_ENABLED', value: null,
    reason: 'D886: preview enables each surface explicitly, so /api/teams is off there by default; Stage A sets it to "true" for its own run (scripts/lib/stageARun.mjs).' },
  { rule: 'price', table: '*', key: 'OPENAI_MODEL', value: 'gpt-5.3-codex',
    reason: 'D7073-p2: the OpenAI slot is skipped ("no priced model") until the owner sets AGENT_OPENAI_RATES; the comment above the slot says so.' },
];

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const RATE = /^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/;

const unquote = (v) => {
  if (v === undefined) return null;
  const t = String(v).trim();
  if (t.startsWith('"')) { try { return JSON.parse(t); } catch { return t.slice(1, -1); } }
  if (t.startsWith("'")) return t.slice(1, -1);
  return t;
};

/** The names the code itself uses; a missing one is a failure, not a pass. */
export function codeFacts(src) {
  const facts = { failures: [], anthropicModels: [], openaiModels: [] };
  const need = (file, re, what) => {
    const m = re.exec(src[file] ?? '');
    if (!m) facts.failures.push({ rule: 'code', file, table: '-', key: what, message: `the code no longer declares ${what}; update scripts/check-ai-gateways.mjs with it` });
    return m;
  };
  const cat = 'cloudflare-worker/src/services/ai/catalogue.ts';
  const sw = need(cat, /GATEWAY_TEXT_SWITCH = '([A-Z0-9_]+)'/, 'GATEWAY_TEXT_SWITCH');
  const slug = need(cat, /GATEWAY_TEXT_SLUG_VAR = '([A-Z0-9_]+)'/, 'GATEWAY_TEXT_SLUG_VAR');
  facts.providerSwitch = sw?.[1]; facts.providerSlug = slug?.[1];
  need('cloudflare-worker/src/services/aiProviders.ts', /GATEWAY_SLUG_RE\.test\(slug\)\)\s*missing\.push\(GATEWAY_TEXT_SLUG_VAR\)/, 'gatewayConfig slug requirement');
  need('cloudflare-worker/src/services/agents/agentRun.ts', /g\.kind === 'none' && engineRun && !inferenceStubOn\(env\)\) return no\(503, 'gateway_required'/, "gatewayRefusal 'gateway_required'");
  const block = (name) => {
    const m = need(cat, new RegExp(`export const ${name}[^=]*= Object\\.freeze\\(\\[([\\s\\S]*?)\\n\\]\\);`), name);
    return m ? [...m[1].matchAll(/\bid: '([^']+)',\s*\n\s*provider: '([a-z]+)'/g)].map((x) => ({ id: x[1], provider: x[2] })) : [];
  };
  facts.anthropicModels = block('PROVIDER_MODELS').filter((m) => m.provider === 'anthropic').map((m) => m.id);
  facts.openaiModels = block('GATEWAY_TEXT_MODELS').filter((m) => m.provider === 'openai').map((m) => m.id);
  return facts;
}

const allowed = (list, rule, table, key, value) =>
  list.find((a) => a.rule === rule && (a.table === '*' || a.table === table) && a.key === key && a.value === value);

/** All findings for one wrangler.toml and its source files. */
export function checkAiGateways({ toml, src, allow = ALLOWED, file = 'wrangler.toml' }) {
  const facts = codeFacts(src);
  const failures = [...facts.failures];
  const accepted = [];
  const { sections } = parseToml(toml);
  const vars = {};
  for (const t of TABLES) {
    const s = sections.find((x) => x.name === t && !x.double);
    if (!s) { failures.push({ rule: 'table', file, table: t, key: '-', message: 'the table is missing' }); continue; }
    vars[t] = (k) => unquote(s.kv.get(k));
  }
  const fail = (rule, table, key, value, message) => {
    const a = allowed(allow, rule, table, key, value);
    if (a) accepted.push({ rule, file, table, key, value, reason: a.reason });
    else failures.push({ rule, file, table, key, message });
  };
  const show = (v) => (v === null ? '(unset)' : JSON.stringify(v));

  // 1. drift against what ships.
  const ref = vars[REFERENCE];
  if (ref) {
    for (const t of TABLES) {
      if (t === REFERENCE || !vars[t]) continue;
      for (const k of KEYS) {
        const v = vars[t](k), p = ref(k);
        if (v !== p) fail('drift', t, k, v, `${show(v)} here, ${show(p)} in [${REFERENCE}]; make them equal or add an ALLOWED entry with the reason`);
      }
    }
  }

  for (const t of TABLES) {
    const get = vars[t];
    if (!get) continue;
    // 2. a switched-on path without its gateway.
    const agw = get('AGENT_AI_GATEWAY');
    if (agw && !ID.test(agw)) fail('gateway', t, 'AGENT_AI_GATEWAY', agw, `${show(agw)} cannot name a gateway; every agent run is refused gateway_misconfigured`);
    const engine = get('AGENT_ENGINE');
    if (engine && engine !== 'off' && !agw && get('AGENT_INFERENCE_STUB') !== 'on')
      fail('gateway', t, 'AGENT_AI_GATEWAY', agw, `AGENT_ENGINE is ${show(engine)} but AGENT_AI_GATEWAY is empty; every engine run is refused gateway_required`);
    if (facts.providerSwitch && facts.providerSlug && get(facts.providerSwitch) === 'on') {
      const ps = get(facts.providerSlug);
      if (!ps || !ID.test(ps)) fail('gateway', t, facts.providerSlug, ps, `${facts.providerSwitch} is "on" but ${facts.providerSlug} is ${show(ps)}; every provider run is refused`);
      else if (ps === get('CF_AI_GATEWAY_SLUG_ADVISOR') || ps === get('CF_AI_GATEWAY_SLUG_DECK'))
        fail('gateway', t, facts.providerSlug, ps, `${show(ps)} is the advisor's or the deck's gateway; the provider path needs its own`);
    }
    // 3. every configured account slot's model has a price.
    const claude = get('AGENT_CLAUDE_MODEL');
    const claudeSlots = ['AGENT_CLAUDE_ALIAS_1', 'AGENT_CLAUDE_ALIAS_2', 'AGENT_CLAUDE_ALIAS_3'].some((k) => get(k));
    if (claudeSlots && !facts.anthropicModels.includes(claude ?? ''))
      fail('price', t, 'AGENT_CLAUDE_MODEL', claude, `${show(claude)} has no price in PROVIDER_MODELS (cloudflare-worker/src/services/ai/catalogue.ts); the Claude slots are skipped`);
    const openai = get('OPENAI_MODEL');
    if (get('AGENT_OPENAI_ALIAS')) {
      const want = String(openai ?? '').replace(/^openai\//, '');
      const priced = facts.openaiModels.includes(`openai/${want}`) || validRates(get('AGENT_OPENAI_RATES'));
      if (!priced) fail('price', t, 'OPENAI_MODEL', openai, `${show(openai)} has no price in GATEWAY_TEXT_MODELS and AGENT_OPENAI_RATES does not price it; the OpenAI slot is skipped`);
    }
  }
  return { failures, accepted };
}

export function validRates(raw) {
  let r;
  try { r = JSON.parse(raw || 'null'); } catch { return false; }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  const keys = ['tokens_cached', 'tokens_in', 'tokens_out'];
  return Object.keys(r).sort().join() === keys.join() && keys.every((k) => typeof r[k] === 'string' && RATE.test(r[k]) && Number(r[k]) > 0);
}

export const SOURCES = [
  'cloudflare-worker/src/services/ai/catalogue.ts',
  'cloudflare-worker/src/services/aiProviders.ts',
  'cloudflare-worker/src/services/agents/agentRun.ts',
];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (p) => readFileSync(resolve(root, p), 'utf8');
  const src = Object.fromEntries(SOURCES.map((p) => [p, read(p)]));
  const out = checkAiGateways({ toml: read('wrangler.toml'), src });
  if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
  else {
    for (const a of out.accepted) console.log(`· ${a.file} [${a.table}] ${a.key} (${a.rule}): allowed — ${a.reason}`);
    for (const f of out.failures) console.error(`✗ ${f.file} [${f.table}] ${f.key} (${f.rule}): ${f.message}`);
    if (!out.failures.length) console.log(`✓ check-ai-gateways: ${TABLES.length} tables agree on ${KEYS.length} AI gateway and agent settings (${out.accepted.length} allowed exceptions)`);
  }
  process.exit(out.failures.length ? 1 : 0);
}

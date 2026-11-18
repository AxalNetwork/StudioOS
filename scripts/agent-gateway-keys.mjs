#!/usr/bin/env node
// #7073 part 2 (D7073-p2): store the agent accounts' provider keys on the `agents` AI Gateway, by alias, from the
// repository's existing Actions secrets. Rerun after a key rotation: it updates the stored value in place.
/**
 * The account order is the review workflow's (`scripts/lib/claudeReview.mjs`, CLAUDE_REVIEW.md §6a):
 *
 *   slot 1  Primary Claude    ANTHROPIC_API_KEY     alias AGENT_CLAUDE_ALIAS_1 (default `claude-primary`)
 *   slot 2  Claude account 2  ANTHROPIC_API_KEY_2   alias AGENT_CLAUDE_ALIAS_2 (default `claude-2`)
 *   slot 3  Claude account 3  ANTHROPIC_API_KEY_3   alias AGENT_CLAUDE_ALIAS_3 (default `claude-3`)
 *   slot 4  OpenAI / Codex    OPENAI_API_KEY        alias AGENT_OPENAI_ALIAS   (default `openai-codex`)
 *
 * For each slot whose key is set, in order:
 *   1. VERIFY THE ACCOUNT, free of charge: `GET /v1/models` on the provider with the key. For the primary, the
 *      answer's `anthropic-organization-id` must equal the review's ANTHROPIC_ORGANIZATION_ID, so the key stored
 *      as "primary" is the intended primary account's. A primary reached by federation alone has no key to store:
 *      that is reported as the one credential gap, and the other slots go on.
 *   2. STORE THE KEY in the account's Secrets Store as `<gateway>_<provider>_<alias>` with the `ai_gateway` scope,
 *      the name AI Gateway looks up at run time. An existing secret has its value replaced (rotation).
 *   3. LINK IT: the gateway's provider config for that provider and alias, created when absent.
 *   4. CHECK: list the gateway's provider configs again and confirm each alias is there.
 *
 * NEVER PRINTED: a key, a key's prefix or preview, a token, an organization id. The summary names slots, aliases,
 * providers and outcomes only. `--plan` verifies the accounts and reads Cloudflare, and writes nothing.
 */
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SLOTS = Object.freeze([
  { slot: 1, label: 'Primary Claude', provider: 'anthropic', envName: 'ANTHROPIC_API_KEY', aliasVar: 'AGENT_CLAUDE_ALIAS_1', alias: 'claude-primary' },
  { slot: 2, label: 'Claude account 2', provider: 'anthropic', envName: 'ANTHROPIC_API_KEY_2', aliasVar: 'AGENT_CLAUDE_ALIAS_2', alias: 'claude-2' },
  { slot: 3, label: 'Claude account 3', provider: 'anthropic', envName: 'ANTHROPIC_API_KEY_3', aliasVar: 'AGENT_CLAUDE_ALIAS_3', alias: 'claude-3' },
  { slot: 4, label: 'OpenAI / Codex', provider: 'openai', envName: 'OPENAI_API_KEY', aliasVar: 'AGENT_OPENAI_ALIAS', alias: 'openai-codex' },
]);
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const GATEWAY = /^[A-Za-z0-9_-]{1,64}$/;
const ACCOUNT = /^[0-9a-f]{32}$/;
const CF = 'https://api.cloudflare.com/client/v4';
const val = (env, k) => String(env[k] ?? '').trim();

/** The slots to act on and the reasons others are left: pure, from the environment's names only. */
export function planSlots(env) {
  const out = [];
  for (const s of SLOTS) {
    const alias = val(env, s.aliasVar) || s.alias;
    const hasKey = !!val(env, s.envName);
    if (!ALIAS.test(alias) || alias === 'default') { out.push({ ...s, alias, action: 'refuse', reason: 'alias refused: never `default`, which falls through to Unified Billing' }); continue; }
    if (!hasKey) {
      out.push({ ...s, alias, action: 'skip', reason: s.slot === 1 ? 'credential gap: ANTHROPIC_API_KEY is not set, so the primary account is reached by federation only and has no key to store' : `${s.envName} is not set` });
      continue;
    }
    out.push({ ...s, alias, action: 'store' });
  }
  return out;
}

/** The Secrets Store name AI Gateway reads for a provider and alias. */
export const secretName = (gateway, provider, alias) => `${gateway}_${provider}_${alias}`;

/** Verify one key with a free models call. Returns whether it is usable, and for Anthropic whether it is the expected organization. */
export async function verifyAccount(slot, key, { fetchImpl = fetch, primaryOrg = '' } = {}) {
  const url = slot.provider === 'anthropic' ? 'https://api.anthropic.com/v1/models?limit=1' : 'https://api.openai.com/v1/models';
  const headers = slot.provider === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${key}` };
  let res;
  try { res = await fetchImpl(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20_000) }); } catch { return { ok: false, reason: 'the provider could not be reached' }; }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'the provider refused the key' };
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: `the provider answered ${res.status}` };
  if (slot.provider !== 'anthropic') return { ok: true };
  const org = String(res.headers.get('anthropic-organization-id') ?? '').trim();
  if (slot.slot === 1) {
    if (!primaryOrg) return { ok: false, reason: 'ANTHROPIC_ORGANIZATION_ID is not set, so the key cannot be confirmed as the primary account\'s' };
    if (!org) return { ok: false, reason: 'the provider did not name the key\'s organization' };
    if (org !== primaryOrg) return { ok: false, reason: 'ANTHROPIC_API_KEY belongs to another organization than ANTHROPIC_ORGANIZATION_ID' };
    return { ok: true, primary: true };
  }
  // A fallback account in the primary's organization shares its credit, so falling back to it gains nothing.
  return { ok: true, samePrimaryOrg: !!primaryOrg && org === primaryOrg };
}

/** A small Cloudflare API client. Errors carry Cloudflare's codes and messages, which never echo a secret value. */
export function cloudflare({ token, account, fetchImpl = fetch }) {
  if (!token || !ACCOUNT.test(account)) throw new Error('CLOUDFLARE_API_TOKEN and a 32-hex CLOUDFLARE_ACCOUNT_ID are required');
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${CF}/accounts/${account}/${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.success === false) {
      const errs = (json?.errors ?? []).map((e) => `${e.code ?? '?'} ${String(e.message ?? '').slice(0, 160)}`).join('; ');
      throw Object.assign(new Error(`Cloudflare ${method} ${path.split('?')[0].replace(/\/[0-9a-f-]{20,}/g, '/…')} failed (HTTP ${res.status}${errs ? `: ${errs}` : ''})`), { status: res.status });
    }
    return json?.result;
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b) };
}

/** The Secrets Store to use: the one named by AGENT_SECRETS_STORE_ID, else the account's only store. */
export async function pickStore(cf, wanted = '') {
  const stores = (await cf.get('secrets_store/stores?per_page=100')) ?? [];
  if (wanted) {
    const s = stores.find((x) => x.id === wanted);
    if (!s) throw new Error('AGENT_SECRETS_STORE_ID names no store of this account');
    return s.id;
  }
  if (stores.length !== 1) throw new Error(`the account has ${stores.length} Secrets Stores; set AGENT_SECRETS_STORE_ID to the one to use`);
  return stores[0].id;
}

/** Create the secret, or replace its value when it exists: a rerun after a rotation stores the new key. */
export async function upsertSecret(cf, store, name, value) {
  const found = ((await cf.get(`secrets_store/stores/${store}/secrets?search=${encodeURIComponent(name)}&per_page=100`)) ?? []).find((x) => x.name === name);
  const comment = 'Agent model account key, stored by agent-gateway-keys.yml (#7073). Rotate by rerunning the workflow.';
  if (found) {
    await cf.patch(`secrets_store/stores/${store}/secrets/${found.id}`, { value, scopes: ['ai_gateway'], comment });
    return { id: found.id, action: 'updated' };
  }
  const created = await cf.post(`secrets_store/stores/${store}/secrets`, [{ name, value, scopes: ['ai_gateway'], comment }]);
  const row = Array.isArray(created) ? created[0] : created;
  if (!row?.id) throw new Error('Cloudflare created no secret id');
  return { id: row.id, action: 'created' };
}

/** The gateway's provider configs, as provider and alias pairs (nothing else is read or printed). */
export async function providerConfigs(cf, gateway) {
  const rows = (await cf.get(`ai-gateway/gateways/${gateway}/provider_configs?per_page=100`)) ?? [];
  return rows.map((r) => ({ id: r.id, provider: r.provider_slug, alias: r.alias, secretId: r.secret_id ?? null }));
}

/** Link the stored secret to the gateway for this provider and alias, when no config names them yet. */
export async function ensureProviderConfig(cf, gateway, { provider, alias, secretId, value }, existing) {
  const have = existing.find((c) => c.provider === provider && c.alias === alias);
  if (have) return { action: have.secretId && have.secretId !== secretId ? 'present (linked to another secret)' : 'present' };
  await cf.post(`ai-gateway/gateways/${gateway}/provider_configs`, { provider_slug: provider, alias, secret_id: secretId, secret: value, default_config: false });
  return { action: 'created' };
}

export async function main(env = process.env, { fetchImpl = fetch, out = (s) => console.log(s), plan = false } = {}) {
  const gateway = val(env, 'AGENT_AI_GATEWAY') || 'agents';
  if (!GATEWAY.test(gateway)) throw new Error('AGENT_AI_GATEWAY is not a gateway id');
  const slots = planSlots(env);
  const rows = [];
  const cf = cloudflare({ token: val(env, 'CLOUDFLARE_API_TOKEN'), account: val(env, 'CLOUDFLARE_ACCOUNT_ID'), fetchImpl });
  const store = await pickStore(cf, val(env, 'AGENT_SECRETS_STORE_ID'));
  let configs = await providerConfigs(cf, gateway);
  let failed = false;
  for (const s of slots) {
    const row = { slot: s.slot, label: s.label, provider: s.provider, alias: s.alias, account: '—', secret: '—', config: '—', note: s.reason ?? '' };
    rows.push(row);
    if (s.action !== 'store') { row.account = s.action === 'skip' ? 'not set' : 'refused'; if (s.action === 'refuse') failed = true; continue; }
    const key = val(env, s.envName);
    const v = await verifyAccount(s, key, { fetchImpl, primaryOrg: val(env, 'ANTHROPIC_ORGANIZATION_ID') });
    if (!v.ok) { row.account = 'refused'; row.note = v.reason; failed = true; continue; }
    row.account = s.slot === 1 ? 'verified (primary organization)' : v.samePrimaryOrg ? 'verified (same organization as the primary: no separate credit)' : 'verified';
    if (plan) { row.secret = 'would store'; row.config = configs.some((c) => c.provider === s.provider && c.alias === s.alias) ? 'present' : 'would create'; continue; }
    try {
      const sec = await upsertSecret(cf, store, secretName(gateway, s.provider, s.alias), key);
      row.secret = sec.action;
      row.config = (await ensureProviderConfig(cf, gateway, { provider: s.provider, alias: s.alias, secretId: sec.id, value: key }, configs)).action;
    } catch (e) {
      row.note = String(e.message).slice(0, 300);
      failed = true;
    }
  }
  // The check: every alias stored this run is on the gateway now.
  if (!plan) {
    configs = await providerConfigs(cf, gateway);
    for (const r of rows.filter((x) => x.secret === 'created' || x.secret === 'updated')) {
      const there = configs.some((c) => c.provider === r.provider && c.alias === r.alias);
      r.check = there ? 'alias on the gateway' : 'MISSING on the gateway';
      if (!there) failed = true;
    }
  }
  out(`## Agent gateway keys (#7073) — ${plan ? 'plan, nothing written' : 'applied'}\n`);
  out(`Gateway \`${gateway}\`. No key, preview, token or organization id is printed.\n`);
  out('| Slot | Account | Provider | Alias | Account check | Secret | Provider config | Gateway check | Note |');
  out('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) out(`| ${r.slot} | ${r.label} | ${r.provider} | \`${r.alias}\` | ${r.account} | ${r.secret} | ${r.config} | ${r.check ?? '—'} | ${r.note} |`);
  return { rows, failed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = process.argv.includes('--plan');
  const lines = [];
  main(process.env, { plan, out: (s) => { lines.push(s); console.log(s); } }).then((r) => {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
    if (r.failed) process.exitCode = 1;
  }, (e) => {
    console.error(`agent gateway keys: ${String(e?.message || e).slice(0, 300)}`);
    process.exitCode = 1;
  });
}

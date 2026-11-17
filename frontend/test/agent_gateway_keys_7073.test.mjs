// #7073 part 2 (D7073-p2): the agent gateway key provisioning script, against fake Cloudflare and provider APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { main, planSlots, verifyAccount, secretName, SLOTS } from '../../scripts/agent-gateway-keys.mjs';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const KEYS = { ANTHROPIC_API_KEY: 'sk-ant-PRIMARY-SECRET', ANTHROPIC_API_KEY_2: 'sk-ant-SECOND-SECRET', ANTHROPIC_API_KEY_3: 'sk-ant-THIRD-SECRET', OPENAI_API_KEY: 'sk-proj-OPENAI-SECRET' };
const ORG = { 'sk-ant-PRIMARY-SECRET': 'org-primary', 'sk-ant-SECOND-SECRET': 'org-two', 'sk-ant-THIRD-SECRET': 'org-three' };
const BASE = { CLOUDFLARE_API_TOKEN: 'cf-token-SECRET', CLOUDFLARE_ACCOUNT_ID: ACCOUNT, ANTHROPIC_ORGANIZATION_ID: 'org-primary' };

/** A fake of the four APIs the script calls: Anthropic and OpenAI model lists, the Secrets Store, provider configs. */
function world({ stores = [{ id: 'store1' }], orgs = ORG } = {}) {
  const secrets = new Map(); // name -> { id, value }
  const configs = [];
  const calls = [];
  const json = (result, status = 200) => new Response(JSON.stringify({ success: status < 400, result, errors: status < 400 ? [] : [{ code: 1000, message: 'nope' }] }), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    calls.push(`${method} ${u.host}${u.pathname}`);
    if (u.host === 'api.anthropic.com') {
      const org = orgs[init.headers['x-api-key']];
      return org ? new Response('{"data":[]}', { status: 200, headers: { 'anthropic-organization-id': org } }) : new Response('{}', { status: 401 });
    }
    if (u.host === 'api.openai.com') return new Response('{"data":[]}', { status: init.headers.authorization === `Bearer ${KEYS.OPENAI_API_KEY}` ? 200 : 401 });
    assert.equal(init.headers.authorization, `Bearer ${BASE.CLOUDFLARE_API_TOKEN}`);
    const path = u.pathname.replace(`/client/v4/accounts/${ACCOUNT}/`, '');
    if (path === 'secrets_store/stores') return json(stores);
    if (path === 'secrets_store/stores/store1/secrets' && method === 'GET') {
      const q = u.searchParams.get('search');
      return json([...secrets].filter(([n]) => n.includes(q)).map(([name, s]) => ({ id: s.id, name })));
    }
    if (path === 'secrets_store/stores/store1/secrets' && method === 'POST') {
      const [row] = JSON.parse(init.body);
      assert.deepEqual(row.scopes, ['ai_gateway']);
      const id = `sec-${secrets.size + 1}`;
      secrets.set(row.name, { id, value: row.value });
      return json([{ id, name: row.name }]);
    }
    const patch = path.match(/^secrets_store\/stores\/store1\/secrets\/(.+)$/);
    if (patch && method === 'PATCH') {
      const entry = [...secrets].find(([, s]) => s.id === patch[1]);
      entry[1].value = JSON.parse(init.body).value;
      return json({ id: patch[1] });
    }
    if (path === 'ai-gateway/gateways/agents/provider_configs' && method === 'GET') return json(configs.map((c) => ({ ...c })));
    if (path === 'ai-gateway/gateways/agents/provider_configs' && method === 'POST') {
      const b = JSON.parse(init.body);
      assert.equal(b.default_config, false, 'never the default config');
      configs.push({ id: `cfg-${configs.length + 1}`, provider_slug: b.provider_slug, alias: b.alias, secret_id: b.secret_id });
      return json({ id: `cfg-${configs.length}` });
    }
    return json(null, 404);
  };
  return { fetchImpl, secrets, configs, calls };
}

const run = async (w, env, plan = false) => {
  const lines = [];
  const r = await main({ ...BASE, ...env }, { fetchImpl: w.fetchImpl, plan, out: (s) => lines.push(s) });
  return { ...r, text: lines.join('\n') };
};
const noValues = (text) => { for (const v of [...Object.values(KEYS), BASE.CLOUDFLARE_API_TOKEN, 'org-primary', 'org-two', 'org-three']) assert.ok(!text.includes(v), `the summary prints no secret or organization id (${v.slice(0, 6)}…)`); };

test('the slots follow the review order, default to named aliases and never take `default`', () => {
  assert.deepEqual(SLOTS.map((s) => [s.slot, s.envName, s.alias]), [[1, 'ANTHROPIC_API_KEY', 'claude-primary'], [2, 'ANTHROPIC_API_KEY_2', 'claude-2'], [3, 'ANTHROPIC_API_KEY_3', 'claude-3'], [4, 'OPENAI_API_KEY', 'openai-codex']]);
  const p = planSlots({ ANTHROPIC_API_KEY_2: 'x', OPENAI_API_KEY: 'y', AGENT_OPENAI_ALIAS: 'default' });
  assert.deepEqual(p.map((s) => s.action), ['skip', 'store', 'skip', 'refuse']);
  assert.match(p[0].reason, /credential gap: ANTHROPIC_API_KEY is not set, so the primary account is reached by federation only/);
  assert.equal(secretName('agents', 'anthropic', 'claude-2'), 'agents_anthropic_claude-2');
});

test('the primary key must belong to ANTHROPIC_ORGANIZATION_ID; a fallback in the same organization is flagged', async () => {
  const w = world();
  const [one, two] = SLOTS;
  assert.deepEqual(await verifyAccount(one, KEYS.ANTHROPIC_API_KEY, { fetchImpl: w.fetchImpl, primaryOrg: 'org-primary' }), { ok: true, primary: true });
  assert.match((await verifyAccount(one, KEYS.ANTHROPIC_API_KEY, { fetchImpl: w.fetchImpl, primaryOrg: 'org-other' })).reason, /another organization/);
  assert.match((await verifyAccount(one, KEYS.ANTHROPIC_API_KEY, { fetchImpl: w.fetchImpl, primaryOrg: '' })).reason, /ANTHROPIC_ORGANIZATION_ID is not set/);
  assert.deepEqual(await verifyAccount(two, KEYS.ANTHROPIC_API_KEY, { fetchImpl: w.fetchImpl, primaryOrg: 'org-primary' }), { ok: true, samePrimaryOrg: true });
  assert.match((await verifyAccount(two, 'sk-ant-WRONG', { fetchImpl: w.fetchImpl, primaryOrg: 'org-primary' })).reason, /refused the key/);
});

test('plan verifies every account and writes nothing', async () => {
  const w = world();
  const r = await run(w, KEYS, true);
  assert.equal(r.failed, false);
  assert.equal(w.secrets.size, 0);
  assert.ok(!w.calls.some((c) => !c.startsWith('GET')), 'only reads');
  assert.deepEqual(r.rows.map((x) => [x.alias, x.secret, x.config]), [['claude-primary', 'would store', 'would create'], ['claude-2', 'would store', 'would create'], ['claude-3', 'would store', 'would create'], ['openai-codex', 'would store', 'would create']]);
  noValues(r.text);
});

test('apply stores each key under its alias, links it once, and a rerun after rotation replaces the value', async () => {
  const w = world();
  let r = await run(w, KEYS);
  assert.equal(r.failed, false, r.text);
  assert.deepEqual([...w.secrets.keys()], ['agents_anthropic_claude-primary', 'agents_anthropic_claude-2', 'agents_anthropic_claude-3', 'agents_openai_openai-codex']);
  assert.deepEqual(w.configs.map((c) => [c.provider_slug, c.alias]), [['anthropic', 'claude-primary'], ['anthropic', 'claude-2'], ['anthropic', 'claude-3'], ['openai', 'openai-codex']]);
  assert.ok(r.rows.every((x) => x.secret === 'created' && x.config === 'created' && x.check === 'alias on the gateway'));
  noValues(r.text);

  // Rotation: a new key for account 2 in the same organization.
  const rotated = { ...KEYS, ANTHROPIC_API_KEY_2: 'sk-ant-SECOND-ROTATED' };
  const w2 = Object.assign(w, {});
  ORG['sk-ant-SECOND-ROTATED'] = 'org-two';
  r = await run(w2, rotated);
  assert.equal(r.failed, false, r.text);
  assert.equal(w.secrets.size, 4, 'no second secret');
  assert.equal(w.configs.length, 4, 'no second provider config');
  assert.equal(w.secrets.get('agents_anthropic_claude-2').value, 'sk-ant-SECOND-ROTATED');
  assert.deepEqual(r.rows.map((x) => [x.secret, x.config]), [['updated', 'present'], ['updated', 'present'], ['updated', 'present'], ['updated', 'present']]);
  assert.ok(!r.text.includes('sk-ant-SECOND-ROTATED'));
});

test('a primary on federation alone is reported as the gap; the other slots are still stored', async () => {
  const w = world();
  const { ANTHROPIC_API_KEY, ...rest } = KEYS;
  const r = await run(w, rest);
  assert.equal(r.failed, false, 'a gap is reported, not a failure');
  assert.equal(r.rows[0].account, 'not set');
  assert.match(r.text, /credential gap: ANTHROPIC_API_KEY is not set/);
  assert.deepEqual([...w.secrets.keys()], ['agents_anthropic_claude-2', 'agents_anthropic_claude-3', 'agents_openai_openai-codex']);
});

test('a primary key from another organization is not stored, and the run fails', async () => {
  const w = world({ orgs: { ...ORG, 'sk-ant-PRIMARY-SECRET': 'org-elsewhere' } });
  const r = await run(w, KEYS);
  assert.equal(r.failed, true);
  assert.match(r.rows[0].note, /another organization/);
  assert.ok(!w.secrets.has('agents_anthropic_claude-primary'));
  assert.equal(w.secrets.size, 3, 'the others are still stored');
  noValues(r.text);
});

test('more than one Secrets Store needs AGENT_SECRETS_STORE_ID', async () => {
  await assert.rejects(run(world({ stores: [{ id: 'store1' }, { id: 'store2' }] }), KEYS), /set AGENT_SECRETS_STORE_ID/);
  const r = await run(world({ stores: [{ id: 'store1' }, { id: 'store2' }] }), { ...KEYS, AGENT_SECRETS_STORE_ID: 'store1' });
  assert.equal(r.failed, false);
});

test('the workflow runs only from main, by hand, with the secrets in one step and no expression in its script', () => {
  const y = readFileSync(new URL('../../.github/workflows/agent-gateway-keys.yml', import.meta.url), 'utf8');
  assert.match(y, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(y, /^\s+(push|pull_request|schedule|workflow_run):/m);
  assert.match(y, /github\.ref == 'refs\/heads\/main'/);
  assert.match(y, /^permissions: \{\}/m);
  const run = y.slice(y.indexOf('        run: |'));
  assert.doesNotMatch(run, /\$\{\{/, 'no expression inside the script');
  assert.equal((y.match(/secrets\./g) ?? []).length, 7, 'the secrets appear once each, in the one step');
  assert.ok(!/echo .*\$\{?(ANTHROPIC|OPENAI|CLOUDFLARE)/.test(y), 'nothing echoes a secret');
});

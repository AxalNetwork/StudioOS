// D4870 part 2 (#4870): the pure half of the hosted gateway live check.
//   node --test scripts/lib/gatewayLiveCheck.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkProbeConfig, gatewaySlugOk, liveCheckNames, liveCheckVerdict, productionCompat, renderProbeConfig } from './gatewayLiveCheck.mjs';

const TOML = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');

test('names: studioos-s4870-<run>, and a bad run id is refused', () => {
  assert.deepEqual(liveCheckNames('A123'), { run: 'a123', worker: 'studioos-s4870-a123', configFile: 'wrangler.s4870.a123.toml' });
  for (const bad of [null, '', 'a-1', 'a'.repeat(21), '../x']) assert.throws(() => liveCheckNames(bad));
});

test('gateway ids: lower case, digits and hyphens', () => {
  for (const ok of ['axal-providers', 'a', 'gw1']) assert.equal(gatewaySlugOk(ok), true, ok);
  for (const bad of ['', 'Axal', 'a_b', '-a', 'a-', 'a b', 'a"\nname = "studioos', 'x'.repeat(65), undefined]) assert.equal(gatewaySlugOk(bad), false, String(bad));
});

test('the config: flat, workers.dev, the AI binding only, production\'s compatibility, never the switch', () => {
  const t = renderProbeConfig({ worker: 'studioos-s4870-a1', slug: 'owner-gw', toml: TOML });
  assert.equal(checkProbeConfig(t, 'studioos-s4870-a1'), true);
  const { date, flags } = productionCompat(TOML);
  assert.match(t, new RegExp(`compatibility_date = "${date}"`));
  assert.ok(t.includes(`compatibility_flags = ${flags}`));
  assert.match(t, /^main = "cloudflare-worker\/src\/probes\/gatewayLiveCheck\.ts"$/m);
  assert.match(t, /^workers_dev = true$/m);
  assert.match(t, /^CF_AI_GATEWAY_SLUG_PROVIDERS = "owner-gw"$/m);
  assert.match(t, /^AI_GATEWAY_PROVIDERS_ZDR = "on"$/m);
  assert.match(t, /^ENVIRONMENT = "preview"$/m);
  assert.doesNotMatch(t, /AI_PROVIDER_GATEWAY_OPENAI|\[env\.|route|d1_databases|axal\.vc/);
  assert.throws(() => renderProbeConfig({ worker: 'studioos-s4870-a1', slug: 'Bad"', toml: TOML }), /not a valid/);
});

test('checkProbeConfig refuses anything that could reach production', () => {
  const t = renderProbeConfig({ worker: 'studioos-s4870-a1', slug: 'owner-gw', toml: TOML });
  const refused = {
    'an [env.*] table': `${t}\n[env.production]\n`,
    'a route': `${t}\n[[routes]]\npattern = "x"\n`,
    'a production host': t.replace('owner-gw', 'axal.vc'),
    'a binding other than AI': `${t}\n[[d1_databases]]\nbinding = "DB"\n`,
    'a cron': `${t}\n[triggers]\ncrons = ["* * * * *"]\n`,
    'the production switch': `${t}AI_PROVIDER_GATEWAY_OPENAI = "on"\n`,
    'the name studioos': t.replace('name = "studioos-s4870-a1"', 'name = "studioos"'),
  };
  for (const [why, text] of Object.entries(refused)) assert.throws(() => checkProbeConfig(text, 'studioos-s4870-a1'), new RegExp(why.replace(/[[\]*.]/g, '\\$&')), why);
  assert.throws(() => checkProbeConfig(t, 'studioos-s4870-a2'), /the name/);
});

const PASS = {
  call: { ok: true }, pin: { served_model_ok: true, key_source: 'Unified' },
  usage: { tokens_in: 40, tokens_cached: 0, tokens_out: 120 },
  charge: { settled_microusd: 250 }, log: { state: 'no_payload', cost_usd: 0.00025, tokens_in: 40, tokens_out: 120 }, reconcile_marked: 0,
};
const withOver = (over) => ({ ...PASS, ...over });

test('the verdict: a pinned answer, no payload, a matching cost', () => {
  const v = liveCheckVerdict(PASS);
  assert.equal(v.verdict, 'pass');
  assert.deepEqual(v.checks, { answered: true, log: 'no_payload', cost: 'matches', cost_delta_microusd: 0, tokens: { log_in: 40, log_out: 120, usage_in: 40, usage_out: 120 }, reconcile_marked: 0 });
  assert.equal(liveCheckVerdict(withOver({ log: { ...PASS.log, state: 'absent' } })).verdict, 'pass', 'no log entry carries no payload either');
  assert.equal(liveCheckVerdict(withOver({ log: { ...PASS.log, cost_usd: 0.0002524 } })).checks.cost, 'matches', 'within 1%');
  assert.equal(liveCheckVerdict(withOver({ reconcile_marked: 1 })).verdict, 'pass', 'marked rows are reported, not failed');
});

test('the verdict fails on each check', () => {
  const fails = (over) => liveCheckVerdict(withOver(over));
  assert.match(fails({ call: { ok: false, error: 'billing' } }).fails.join(), /did not answer \(billing\)/);
  assert.match(fails({ pin: { served_model_ok: true, key_source: 'BYOK' } }).fails.join(), /pin/);
  assert.match(fails({ pin: { served_model_ok: false, key_source: 'Unified' } }).fails.join(), /pin/);
  assert.match(fails({ log: { ...PASS.log, state: 'payload_present' } }).fails.join(), /payload_present/);
  assert.match(fails({ log: { ...PASS.log, state: 'no_log_id' } }).fails.join(), /no_log_id/);
  const differs = fails({ log: { ...PASS.log, cost_usd: 0.0003 } });
  assert.equal(differs.checks.cost, 'differs');
  assert.equal(differs.checks.cost_delta_microusd, 50);
  assert.equal(fails({ log: { ...PASS.log, cost_usd: null } }).checks.cost, 'not_recorded');
  assert.equal(fails({ charge: { settled_microusd: null } }).checks.cost, 'not_recorded');
  for (const p of [null, undefined, 'x']) assert.equal(liveCheckVerdict(p).verdict, 'fail');
});

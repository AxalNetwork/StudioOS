/**
 * The branch config generator — what it must carry, and what it must refuse.
 *
 * The tests that matter are not "it renders": they are the two ways a
 * generated config goes wrong without looking wrong.
 *
 *   1. A BINDING HQ GAINS AND THE BRANCH DOES NOT. The renderer copies tables
 *      it does not recognise, so this is guarded by appending a table to a
 *      COPY of wrangler.toml and asserting it appears — a test that fails if
 *      anyone rewrites the renderer around an allowlist.
 *   2. A ROUTE THAT IS HQ'S. `custom_domain` belongs to one Worker: deploying
 *      a branch config carrying `axal.vc` would move the apex off HQ. There is
 *      no recovering from that inside a deploy, so both the renderer's output
 *      and the guard are pinned on it.
 *
 * Run with:
 *   node --test scripts/lib/branchConfig.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  validateBranch, renderBranchConfig, checkRendered, hqIds, parseToml,
  derivedNames, BRANCH_CRONS,
} from './branchConfig.mjs';

const ROOT = process.cwd();
const TOML = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8');
const EXAMPLE = JSON.parse(readFileSync(resolve(ROOT, 'infra/branches/_example.json'), 'utf8'));

/** A valid entry with `over` applied. */
const entry = (over = {}) => ({ ...structuredClone(EXAMPLE), code: 'fr', hostname: 'fr.axal.vc', name: 'Axal VC France', status: 'provisioning', ...over });

const render = (e = entry()) => renderBranchConfig(TOML, e);
const tables = (src) => parseToml(src).sections.map((s) => s.name);

test('the shipped registry renders clean, and so does a real entry', () => {
  assert.deepEqual(validateBranch(EXAMPLE, hqIds(TOML)), []);
  assert.deepEqual(checkRendered(TOML, EXAMPLE, renderBranchConfig(TOML, EXAMPLE)), []);
  const e = entry();
  assert.deepEqual(validateBranch(e, hqIds(TOML)), []);
  assert.deepEqual(checkRendered(TOML, e, render(e)), []);
});

test('every name is derived from the code, and the shared dataset is not', () => {
  const src = render();
  const n = derivedNames('fr');
  for (const want of [
    'name = "studioos-fr"',
    'pattern = "fr.axal.vc"',
    `database_name = "${n.d1}"`,
    `queue = "${n.queue}"`,
    `dead_letter_queue = "${n.dlq}"`,
    `index_name = "${n.vectorize}"`,
    `bucket_name = "${n.r2.FILES}"`,
    `bucket_name = "${n.r2.PUBLICATIONS}"`,
    `bucket_name = "${n.r2.BACKUPS}"`,
    'BRANCH_CODE = "fr"',
    'BRANCH_TERRITORY = "FR,BE,LU"',
    'CF_WORKER_SCRIPT_NAME = "studioos-fr"',
    'APP_URL = "https://fr.axal.vc"',
    'entrypoint = "HqEntrypoint"',
  ]) assert.ok(src.includes(want), `the rendered config is missing: ${want}`);

  // Shared by design — the HQ statements and the anonymised median are
  // computed across branches from one dataset, with the branch carried on
  // every row as a blob (D161). This comment used to say "indexed by
  // BRANCH_CODE", which was D105's claim and was never built: the sole index
  // is the route, because the first index is the sampling key.
  assert.ok(src.includes('dataset = "studioos_metrics"'), 'the Analytics Engine dataset must NOT be renamed per branch');
  assert.ok(src.includes('AE_DATASET = "studioos_metrics"'));
});

test('HQ\'s hosts never reach a branch config, and there is exactly one route', () => {
  const src = render();
  const routes = parseToml(src).sections.filter((s) => s.name === 'routes');
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kv.get('custom_domain'), 'true');
  assert.ok(!src.includes('"axal.vc"'), 'the apex must not appear: a custom domain belongs to one Worker');
  assert.ok(!src.includes('"app.axal.vc"'), 'app.axal.vc must not appear either');
  // Even OAUTH_CALLBACK_BASE_URL, which HQ pins to app.axal.vc.
  assert.ok(src.includes('OAUTH_CALLBACK_BASE_URL = "https://fr.axal.vc"'));
});

test('the output is flat, and carries the tables that are inherited rather than declared', () => {
  const names = tables(render());
  assert.ok(!names.some((n) => n.startsWith('env.')), 'no [env.*] table: --env is never combined with --name');
  for (const t of ['rules', 'observability', 'observability.logs', 'observability.traces']) {
    assert.ok(names.includes(t), `${t} is inherited at the top level on HQ, so a flat config must render it`);
  }
  assert.ok(names.includes('migrations'), 'without the DO migration tag a new script has no Durable Object bindings');
});

test('a branch runs its own crons, not the platform-content cadences', () => {
  const src = render();
  const crons = parseToml(src).sections.find((s) => s.name === 'triggers').kv.get('crons');
  assert.equal(crons, JSON.stringify(BRANCH_CRONS).replaceAll('","', '", "'));
  assert.ok(!src.includes('0 */6 * * *'), 'the market-intel connector cadence is HQ\'s alone');
  assert.ok(!src.includes('0 9 * * 1'), 'the weekly digest cadence is HQ\'s alone');
});

test('a binding added to HQ reaches the branch config with no code change', () => {
  // THE POINT OF DERIVING RATHER THAN TEMPLATING. Append a table to a COPY of
  // the source — as a future PR would to wrangler.toml — and it must appear.
  // An allowlist-shaped renderer passes every other test in this file and
  // fails this one.
  const withNew = `${TOML}\n[[env.production.hyperdrive]]\nbinding = "PG"\nid = "abc123"\n`;
  const src = renderBranchConfig(withNew, entry());
  assert.ok(tables(src).includes('hyperdrive'), 'a new [env.production] table did not reach the branch config');
  assert.ok(src.includes('binding = "PG"'));
  // And the guard notices it does not know the rename rule for it, rather
  // than passing a config whose id still points at HQ's resource.
  const problems = checkRendered(withNew, entry(), src);
  assert.ok(problems.some((p) => p.includes('IDENTITY')), `the guard should demand a rule for the new table, got: ${problems.join(' | ')}`);
});

test('validateBranch refuses every way an entry can be wrong', () => {
  const ids = hqIds(TOML);
  const refuses = (over, needle) => {
    const problems = validateBranch(entry(over), ids);
    assert.ok(problems.some((p) => p.includes(needle)),
      `expected a problem mentioning "${needle}" for ${JSON.stringify(over)}, got: ${problems.join(' | ') || 'none'}`);
  };
  refuses({ code: 'Fr' }, 'must match');
  refuses({ code: 'a' }, 'must match');
  refuses({ code: 'a-very-long-branch-code' }, 'must match');
  refuses({ hostname: 'axal.vc' }, 'hostname');
  refuses({ hostname: 'fr.example.com' }, 'hostname');
  refuses({ name: '' }, 'name is required');
  refuses({ licence_uid: '' }, 'licence_uid is required');
  refuses({ territory: [] }, 'territory');
  refuses({ territory: ['France'] }, 'ISO alpha-2');
  refuses({ residency: { d1_jurisdiction: 'ch' } }, 'residency.d1_jurisdiction');
  refuses({ residency: { location_hint: 'zurich' } }, 'residency.location_hint');
  refuses({ status: 'deployed' }, 'status');
  refuses({ ids: { d1: '', kv_tokens: 'a', kv_rate_limits: 'b' } }, 'ids.d1 is required');
  // The one that matters most: a copy-paste that kept production's id.
  refuses({ ids: { ...EXAMPLE.ids, d1: [...ids][0] } }, "HQ's own id");
  // Nulls are how "no guarantee available" is said, and must be accepted.
  assert.deepEqual(
    validateBranch(entry({ residency: { d1_jurisdiction: null, location_hint: 'apac', do_jurisdiction: null, r2_jurisdiction: null } }), ids),
    [], 'a non-EU branch states its residency as null, and that is a valid entry',
  );
});

test('checkRendered catches every way a rendered config can be undeployable', () => {
  const e = entry();
  const good = render(e);
  const breaks = (mutate, needle) => {
    const problems = checkRendered(TOML, e, mutate(good));
    assert.ok(problems.some((p) => p.includes(needle)),
      `expected a problem mentioning "${needle}", got: ${problems.join(' | ') || 'none'}`);
  };
  breaks((s) => s.replace('pattern = "fr.axal.vc"', 'pattern = "axal.vc"'), "HQ's own host");
  breaks((s) => `${s}\n[[routes]]\npattern = "app.axal.vc"\ncustom_domain = true\n`, 'exactly one route');
  breaks((s) => s.replace('custom_domain = true', 'custom_domain = false'), 'custom domain');
  breaks((s) => s.replace(/database_id = "[^"]+"/, `database_id = "${[...hqIds(TOML)][0]}"`), "HQ's id");
  breaks((s) => s.replace('workers_dev = false', 'workers_dev = true'), 'workers_dev');
  breaks((s) => s.replace(/\n\[\[migrations\]\][^[]*/, '\n'), 'Durable Object');
  breaks((s) => s.replace(/\n\[\[r2_buckets\]\]\nbinding = "BACKUPS"[^[]*/, '\n'), 'table r2_buckets');
  breaks((s) => s.replace('BRANCH_CODE = "fr"', 'BRANCH_CODE = "dach"'), 'BRANCH_CODE');
  breaks((s) => s.replace('APP_URL = "https://fr.axal.vc"', 'APP_URL = "https://axal.vc"'), 'APP_URL');
  breaks((s) => s.replace('directory = "./docs"', 'directory = "../docs"'), 'assets directory');
  breaks((s) => s.replace(/crons = \[[^\]]*\]/, 'crons = ["* * * * *", "0 */6 * * *"]'), 'branch crons');
  breaks((s) => s.replace(/\n\[\[services\]\][^[]*/, '\n'), 'HQ service binding');
  breaks((s) => s.replace(/\n\[observability\]\n/, '\n[observability_off]\n'), 'observability');
  breaks((s) => s.replace('name = "studioos-fr"', 'name = "studioos"'), 'name must be');
  breaks((s) => `[env.production]\nname = "x"\n${s}`, 'flat');
});

test('the cron table\'s multi-line array is read, not dropped', () => {
  // wrangler.toml writes crons one per line with trailing comments. A parser
  // that took only the first line would render `crons = [` and produce a
  // config wrangler rejects — or, worse, silently drop the key.
  const hq = parseToml(TOML).sections.find((s) => s.name === 'env.production.triggers');
  assert.ok(hq.kv.get('crons').startsWith('[') && hq.kv.get('crons').endsWith(']'), hq.kv.get('crons'));
  assert.equal(JSON.parse(hq.kv.get('crons')).length, 6, 'HQ declares six cadences');
});

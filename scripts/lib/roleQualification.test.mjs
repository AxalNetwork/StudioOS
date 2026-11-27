/**
 * D8688 (#8688): `roleQualification.mjs` — the fail-closed target rule against
 * the real `wrangler.toml`, synthetic addresses, build ids, a row's result and
 * the matrix's publishable text. No database and no clock: `now` is passed in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertIsolatedTarget, buildIds, isPublishable, matrixMarkdown, overallResult, productionDatabases,
  rowResult, syntheticEmail, targetRefusals, unpublishable, STEPS,
} from './roleQualification.mjs';

const toml = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
const production = productionDatabases(toml);
const NOW = Date.parse('2026-11-27T12:00:00Z');
const local = (over = {}) => ({ environment: 'development', database: {}, remote: false, accounts: [syntheticEmail('founder-a')], ...over });
const codes = (t) => targetRefusals(t, production).map((r) => r.code);

test('wrangler.toml\'s production D1 is found in both the top level and [env.production]', () => {
  assert.ok(production.length >= 2, 'both DB bindings are read');
  assert.ok(production.every((p) => p.name === 'studioos-db' && /^[0-9a-f-]{36}$/.test(p.id)));
  // Mutation checked: the env.production header not matched → one binding only, and the first assertion fails.
});

test('a local in-process target holding only synthetic accounts passes', () => {
  assert.deepEqual(codes(local()), []);
  assert.equal(assertIsolatedTarget(local(), production), true);
});

test('production, an unset or unknown environment, and production\'s D1 are each refused by name', () => {
  assert.deepEqual(codes(local({ environment: 'production' })), ['production_environment']);
  assert.deepEqual(codes(local({ environment: '' })), ['environment_unset']);
  assert.deepEqual(codes(local({ environment: 'staging-ish' })), ['unknown_environment']);
  assert.deepEqual(codes(local({ database: { name: 'studioos-db' } })), ['production_database']);
  assert.deepEqual(codes(local({ database: { name: 'studioos-db-copy', id: production[0].id } })), ['production_database']);
  assert.throws(() => assertIsolatedTarget(local({ environment: 'production' }), production), (e) => e.reasons?.[0]?.code === 'production_environment');
});

test('a hosted or preview target needs a fresh isolated preflight', () => {
  const remote = local({ environment: 'preview', remote: true, database: { name: 'studioos-db-preview' }, now: NOW });
  assert.deepEqual(codes(remote), ['not_isolated']);
  assert.deepEqual(codes({ ...remote, preflight: { verdict: 'unverified', observed_at: '2026-11-27T11:00:00Z' } }), ['not_isolated']);
  assert.deepEqual(codes({ ...remote, preflight: { verdict: 'isolated', observed_at: '2026-11-25T11:00:00Z' } }), ['preflight_stale']);
  assert.deepEqual(codes({ ...remote, preflight: { verdict: 'isolated', observed_at: '2026-11-28T11:00:00Z' } }), ['preflight_stale'], 'a preflight from the future is not fresh');
  assert.deepEqual(codes({ ...remote, preflight: { verdict: 'isolated', observed_at: '2026-11-27T11:00:00Z' } }), []);
});

test('a database with any non-synthetic account, or whose accounts were not read, is refused', () => {
  assert.deepEqual(codes(local({ accounts: [syntheticEmail('a'), 'member-row-without-the-domain'] })), ['non_synthetic_accounts']);
  assert.deepEqual(codes(local({ accounts: undefined })), ['accounts_unread']);
  assert.deepEqual(codes(local({ accounts: [] })), [], 'an empty database is isolated');
});

test('synthetic addresses use the reserved domain and refuse a key that is not a plain slug', () => {
  assert.match(syntheticEmail('Founder-A'), /^founder-a@qualification\.invalid$/);
  assert.throws(() => syntheticEmail('a b'));
  assert.throws(() => syntheticEmail(''));
});

test('build ids name the commit and the app and Worker trees separately, and mark a dirty tree', () => {
  const answers = {
    'rev-parse HEAD': 'a'.repeat(40), 'rev-parse HEAD:frontend/src': 'b'.repeat(40), 'rev-parse HEAD:cloudflare-worker/src': 'c'.repeat(40),
    'status --porcelain -- frontend/src': ' M frontend/src/x.js', 'status --porcelain -- cloudflare-worker/src': '',
  };
  assert.deepEqual(buildIds((args) => answers[args.join(' ')] ?? ''), { commit: 'a'.repeat(12), app: `${'b'.repeat(12)}+dirty`, worker: 'c'.repeat(12) });
  assert.deepEqual(buildIds(() => { throw new Error('no git'); }), { commit: 'unknown', app: 'unknown', worker: 'unknown' });
});

const steps = (over = {}) => Object.fromEntries(STEPS.map((s) => [s, { result: 'pass', evidence: 'ok', ...(over[s] || {}) }]));

test('a row passes only when every step passes; a fail wins over a missing step', () => {
  assert.equal(rowResult(steps()), 'pass');
  assert.equal(rowResult(steps({ reload: { result: 'missing' } })), 'incomplete');
  assert.equal(rowResult(steps({ reload: { result: 'missing' }, scope: { result: 'fail' } })), 'fail');
  assert.equal(rowResult({}), 'incomplete');
  assert.equal(overallResult({ steps: steps(), phone_390: { result: 'pass' } }), 'pass');
  assert.equal(overallResult({ steps: steps(), phone_390: { result: 'not run' } }), 'incomplete');
  assert.equal(overallResult({ steps: steps(), phone_390: { result: 'fail' } }), 'fail');
});

test('the matrix refuses addresses, links and token-like values, and prints one row per scenario', () => {
  assert.equal(isPublishable('the draft is listed (version 2)'), true);
  for (const bad of [syntheticEmail('x'), 'see https://example.invalid/x', 'Bearer abc', 'eyJhbGciOiJIUzI1NiJ9', 'x'.repeat(40)]) assert.equal(isPublishable(bad), false, bad);
  const row = { intended_role: 'Founder', authenticated_role: 'founder', workspace: 'Company A', scope: 'Venture A', steps: steps(), phone_390: { result: 'not run', evidence: 'no browser' }, preview_only: false, missing_steps: [], evidence: [] };
  assert.deepEqual(unpublishable([row]), []);
  assert.deepEqual(unpublishable([{ ...row, evidence: [syntheticEmail('x')] }]), [`Founder: ${syntheticEmail('x')}`]);
  const md = matrixMarkdown({ build: { commit: 'c', app: 'a', worker: 'w' }, mode: 'local', rows: [row] });
  assert.match(md, /\| Founder \| founder \| Company A \| Venture A \| pass \| pass \| pass \| pass \| pass \| not run \| no \| \*\*incomplete\*\* \|/);
});

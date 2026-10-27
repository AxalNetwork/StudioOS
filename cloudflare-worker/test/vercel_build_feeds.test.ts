/**
 * D1096 (#2961) — the Vercel connector page claims only what a sync writes.
 *
 * `vercelFeeds.ts` is the one list. The registry's `pulls` and `feeds` are
 * read from it, so a landing claims a module only once its part sets a store;
 * part 1 lands no module's rows and claims the connection on Operating
 * systems only. Every module named is one `MODULE_LABELS` knows.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/vercel_build_feeds.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONNECTOR_METADATA, getDescriptor } from '../src/integrations/registry.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { MODULE_LABELS } from '../src/integrations/moduleLabels.ts';
import { VERCEL_LANDINGS, VERCEL_READ_BY, vercelFedModules, vercelPulls } from '../src/integrations/vercelFeeds.ts';
import { VERCEL_READ_SCOPES } from '../src/services/vercel/api.ts';
import { writesProjectData } from '../src/integrations/companyScope.ts';

test('the page claims what the list says, and part 1 claims only the connection on Operating systems', () => {
  const m = CONNECTOR_METADATA.vercel;
  assert.deepEqual(m.pulls, vercelPulls());
  assert.deepEqual(m.feeds, vercelFedModules());
  // D1097 (part 2): health events land on Operating systems; Runs on reads the projects on Solution design.
  assert.deepEqual(m.feeds, ['operating_systems', 'solution_design']);
  for (const claim of [{ what: 'Production health', module: 'operating_systems' }, { what: 'Framework, Node version and repository', module: 'solution_design' }]) {
    assert.ok(m.pulls.some((x: any) => x.what === claim.what && x.module === claim.module), `It brings: ${claim.what}`);
  }
  assert.deepEqual(m.sends, [], 'Vercel sends nothing');
  for (const l of VERCEL_LANDINGS) {
    assert.ok(Object.hasOwn(MODULE_LABELS, l.module), l.module);
    // A landing with a store is claimed; one without is claimed only when its module reads the connection anyway.
    if (l.store !== null) assert.ok(m.feeds.includes(l.module), `${l.kind} → ${l.module} has a store and is claimed`);
    else assert.equal(m.feeds.includes(l.module), (VERCEL_READ_BY as readonly string[]).includes(l.module), `${l.kind} → ${l.module} is claimed only by a module that reads the connection`);
  }
  for (const t of CONNECTOR_PAGES.vercel.tools) assert.ok(t.lands_in === null || m.feeds.includes(t.lands_in), `${t.name} lands in ${t.lands_in}, which the page does not claim`);
});

test('the registry row: read-only, founder-facing, project data, the three Read scopes', () => {
  const d = getDescriptor('vercel')!;
  assert.deepEqual([d.auth_type, d.audience_rule, d.supports_pat, d.status], ['oauth2', 'venture', false, 'beta']);
  assert.deepEqual(d.oauth_scopes, [...VERCEL_READ_SCOPES]);
  assert.equal(CONNECTOR_METADATA.vercel.category, 'Hosting');
  assert.equal(CONNECTOR_METADATA.vercel.permissions.length, VERCEL_READ_SCOPES.length, 'one line per scope');
  assert.ok(CONNECTOR_METADATA.vercel.permissions.at(-1)!.endsWith('Axal VC cannot deploy, cancel, roll back or change anything.'));
  assert.equal(writesProjectData('vercel'), true, 'a Vercel connection writes into a company\'s projects, so it needs one');
  assert.ok(!CONNECTOR_PAGES.vercel.tools.some((t) => t.access === 'write'), 'no write tool');
});

test('the slug is declared in both [vars] blocks, and is not a secret', () => {
  const toml = readFileSync('wrangler.toml', 'utf8');
  assert.equal((toml.match(/^VERCEL_INTEGRATION_SLUG = "[a-z0-9-]*"$/gm) || []).length, 2);
  assert.doesNotMatch(toml, /VERCEL_CLIENT_SECRET\s*=/, 'the client secret is a Worker secret, never a var');
});

test('Now fed by: Operating systems reads the connection (no ledger zero); a landed row counts once its part writes one', async () => {
  const { fedCounts, FED_LEDGER_PROVIDERS } = await import('../src/integrations/fed.ts');
  assert.ok(FED_LEDGER_PROVIDERS.has('vercel'));
  const env = { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) } } as any;
  const out = await fedCounts(env, 1, 'vercel');
  assert.deepEqual(out.map((m) => [m.module, m.count]), [['operating_systems', null], ['solution_design', null]]);
  assert.match(out[0].reason!, /^Read from the connection: Vercel/);
  assert.match(out[1].reason!, /^Read from the connection: Runs on/);
});

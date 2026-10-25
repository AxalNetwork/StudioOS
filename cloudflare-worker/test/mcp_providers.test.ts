/**
 * D1080 (#2945) — every record in `MCP_PROVIDERS`, held to what a sign-in and
 * a read may do with it. A provider task that adds a record passes here or
 * does not merge.
 *
 *  1. No write tool without the provider issue that asked for publishing.
 *  2. Every read tool has a typed read: the provider's `reads.ts` calls it by name.
 *  3. A record that registers by `preregistered` is a `MANAGED_PROVIDERS` key,
 *     so HQ › Integration keys holds its client and `CALLBACK_URL` must list it.
 *  4. A record served by the generic sign-in calls back to its own generic
 *     path, and a CIMD record's document is the generic route on axal.vc.
 *  5. Every grant it accepts includes every scope it asks for, and its
 *     resources sit on its hosts.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mcp_providers.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MCP_PROVIDERS, type McpProvider } from '../src/integrations/mcpProviders.ts';
import { onProviderHosts } from '../src/integrations/mcpClient.ts';
import { genericMcpProvider, mcpCallbackPath, mcpCimdUrl } from '../src/integrations/mcpSignIn.ts';
import { MANAGED_PROVIDERS } from '../src/services/providerOauthKeys.ts';

/** Where each record's typed reads live. A new record adds its line here. */
const TYPED_READS: Record<string, string> = {
  mercury: 'cloudflare-worker/src/services/mercury/reads.ts',
};

const records = Object.entries(MCP_PROVIDERS) as Array<[string, McpProvider]>;

/** The tool names a reads module calls: `call('<name>'`, `all('<name>'` or `callTool('<name>'`. */
function calledTools(src: string): Set<string> {
  return new Set([...src.matchAll(/\b(?:call|all|callTool)\(\s*'([A-Za-z0-9_.-]+)'/g)].map((m) => m[1]));
}

test('1. no record lists a write tool without the provider issue that asked for publishing', () => {
  assert.ok(records.length > 0);
  for (const [key, p] of records) {
    if (p.publish_issue === null) assert.deepEqual([...p.write_tools], [], `${key} lists a write tool without a publishing issue`);
    else assert.ok(Number.isSafeInteger(p.publish_issue) && p.publish_issue > 0, `${key}: publish_issue is an issue number`);
    for (const t of p.write_tools) assert.ok(!p.read_tools.includes(t), `${key}: ${t} is both a read and a write tool`);
  }
});

test('2. every read tool has a typed read in the provider\'s reads module', () => {
  for (const [key, p] of records) {
    assert.ok(Object.hasOwn(TYPED_READS, key), `${key} names no reads module`);
    const called = calledTools(readFileSync(TYPED_READS[key], 'utf8'));
    for (const tool of p.read_tools) assert.ok(called.has(tool), `${key}: ${tool} has no typed read`);
  }
  // The reader itself: a name in a plain string is not a read.
  assert.deepEqual([...calledTools("call('getA'); all('listB', {}); const x = 'getC'; session.callTool('getD', {});")], ['getA', 'listB', 'getD']);
});

test('3. a pre-registered record is a key HQ › Integration keys holds', () => {
  for (const [key, p] of records) {
    if (p.registration.includes('preregistered')) assert.ok((MANAGED_PROVIDERS as string[]).includes(key), `${key} registers by preregistered but is not a MANAGED_PROVIDERS key`);
  }
  // CALLBACK_URL is exhaustive over the managed keys (tsc), so a managed record must be listed there.
  assert.match(readFileSync('cloudflare-worker/src/routes/admin_integration_keys.ts', 'utf8'), /const CALLBACK_URL: Record<ManagedProviderKey,/);
});

test('4. the generic sign-in serves a record on its own callback; a CIMD record publishes the generic document on axal.vc', () => {
  for (const [key, p] of records) {
    assert.equal(p.key, key, `${key}: the record's key is its own`);
    const generic = genericMcpProvider(MCP_PROVIDERS, key);
    if (key === 'mercury') assert.equal(generic, null, 'Mercury keeps routes/mercury_oauth.ts until #2404 part 3');
    else assert.equal(p.callback_path, mcpCallbackPath(key), `${key} calls back somewhere the generic routes do not answer`);
    if (p.registration.includes('cimd')) assert.equal(p.cimd_url, mcpCimdUrl(key), `${key}: its client ID metadata document is not served by Axal`);
    else assert.equal(p.cimd_url, null, `${key}: a cimd_url without CIMD registration`);
  }
});

test('5. what a record accepts includes what it asks for, and its resources sit on its hosts', () => {
  for (const [key, p] of records) {
    for (const s of p.scopes) assert.ok(p.accepted_scopes.includes(s), `${key}: asks for ${s} but would refuse it`);
    for (const r of p.resources) assert.ok(onProviderHosts(r, p.hosts), `${key}: ${r} is off its hosts`);
    assert.ok(p.registration.length > 0, `${key} has no way to register`);
  }
});

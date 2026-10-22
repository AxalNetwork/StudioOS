/**
 * D840 (#2346) — the Mercury page claims only what the code builds (D753).
 *
 *  1. Every entry of `MERCURY_FEEDS` names a role that holds a personal
 *     connection, a known module (or none), and only tools on
 *     `MERCURY_READ_TOOLS`; each D713/D752 use is listed once.
 *  2. Each role's registry `feeds` are exactly the modules its entries land in,
 *     and the catalogue's own Mercury row (D879) claims the founder's: Grow and Raise.
 *  3. Each member page's tools name exactly the MCP tools that role's entries
 *     call, and every tool's `lands_in` is one of that role's modules.
 *  4. Each member page signs in with Mercury (`oauth_or_key`) and names the MCP
 *     server. D879 (#2552) removed the entity page.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_feeds_d840.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTOR_METADATA, getDescriptor, PERSONAL_MERCURY } from '../src/integrations/registry.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { MODULE_LABELS } from '../src/integrations/moduleLabels.ts';
import { MERCURY_FEEDS, mercuryFedModules, mercuryFeedTools } from '../src/integrations/mercuryFeeds.ts';
import { MERCURY_MCP_URL, MERCURY_READ_TOOLS } from '../src/services/mercury/mcp.ts';
import { PERSONAL_USES } from '../src/services/mercuryPersonal.ts';

const pages = (CONNECTOR_PAGES as any).mercury;
const ROLES = getDescriptor('mercury')!.personal_roles!;
/** The MCP tool names a page tool's `calls` quote. */
const mcpTools = (page: any) => page.tools.flatMap((t: any) => t.calls.map((c: string) => c.replace(/^'|'$/g, '')).filter((c: string) => MERCURY_READ_TOOLS.includes(c)));

test('1. every feed names a personal role, a known module or none, and only allowlisted tools', () => {
  assert.ok(MERCURY_FEEDS.length > 0);
  for (const f of MERCURY_FEEDS) {
    assert.ok(ROLES.includes(f.role), `${f.key}: ${f.role}`);
    assert.ok(f.module === null || Object.hasOwn(MODULE_LABELS, f.module), `${f.key}: ${f.module}`);
    assert.ok(f.tools.length > 0, f.key);
    for (const t of f.tools) assert.ok(MERCURY_READ_TOOLS.includes(t), `${f.key}: ${t} is not on the read list`);
    assert.match(f.decision, /^D\d+$/);
  }
  const keys = MERCURY_FEEDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, 'a feed is listed once');
  for (const [role, uses] of Object.entries(PERSONAL_USES)) {
    for (const use of uses) assert.equal(MERCURY_FEEDS.filter((f) => f.key === use && f.role === role).length, 1, `${role}.${use} is listed`);
  }
});

test('2. each role\'s registry feeds are its feeds\' modules; the catalogue row claims the founder\'s (D879)', () => {
  for (const role of ROLES) {
    assert.deepEqual([...(PERSONAL_MERCURY as any)[role].feeds], mercuryFedModules(role), role);
  }
  assert.deepEqual(CONNECTOR_METADATA.mercury.feeds, mercuryFedModules('founder'));
  assert.deepEqual(CONNECTOR_METADATA.mercury.pulls.map((p) => p.module), MERCURY_FEEDS.filter((f) => f.role === 'founder' && f.module).map((f) => f.module));
});

test('3. each member page names exactly its role\'s MCP tools, and lands only where its feeds land', () => {
  for (const role of ROLES) {
    const page = pages.personal[role];
    assert.deepEqual([...new Set(mcpTools(page))].sort(), mercuryFeedTools(role).sort(), `${role}: the page's MCP tools`);
    const modules = mercuryFedModules(role);
    for (const t of page.tools) assert.ok(t.lands_in === null || modules.includes(t.lands_in), `${role}.${t.name} lands in ${t.lands_in}`);
    for (const m of modules) assert.ok(page.tools.some((t: any) => t.lands_in === m), `${role}: nothing on the page lands in ${m}`);
  }
});

test('4. member pages sign in with Mercury through its MCP server, and there is no entity page (D879)', () => {
  for (const role of ROLES) {
    const page = pages.personal[role];
    // D881 (#2554): Sign in with Mercury only, with no token help and no token line.
    assert.deepEqual(page.sign_in, { kind: 'mcp', label: 'Sign in with Mercury', key_help_href: null }, role);
    assert.ok(!page.long_description.some((l: string) => /API token/.test(l)), role);
    assert.equal(page.endpoints.sign_in, MERCURY_MCP_URL, role);
    assert.ok(page.tools.some((t: any) => t.name === 'sign_in_with_mercury' && t.access === 'account'), role);
  }
  assert.equal('entity' in pages, false);
});

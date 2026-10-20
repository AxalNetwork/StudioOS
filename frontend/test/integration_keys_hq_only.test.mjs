/**
 * The owner's ruling (2026-10-20): Integration keys and GitHub Sync are the
 * Super Admin's alone, a row of HQ's own sidebar, with GitHub Sync a section
 * of the Integration keys page. They were Admin Console tabs open to every
 * admin (`/admin?tab=integration-keys`, `?tab=github`).
 *
 * This holds the move in the shell, in the old links and in the Worker: the
 * page is `hqOnly`, the row is in the Super Admin group and nowhere else, no
 * Admin Console section offers either console, the old addresses redirect,
 * nothing in the app links them, and the Worker's reads take
 * `requireSuperAdmin` while the writes keep D223's bar.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { legacyContractsTarget } from '../src/pages/admin/LegacyContractsRedirect.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');
const PAGE = read('frontend/src/pages/hq/IntegrationKeysPage.jsx');
const ADMIN_PAGE = read('frontend/src/pages/AdminPage.jsx');

test('the page is registered once, behind the admin guard and hqOnly', () => {
  const lines = APP.split('\n').filter((l) => l.includes('path="/admin/integration-keys"'));
  assert.equal(lines.length, 1, 'the route is registered once');
  assert.match(lines[0], /element=\{guard\(\['admin'\], hqOnly\(<HqIntegrationKeysPage \/>\)\)\}/);
  assert.match(APP, /const HqIntegrationKeysPage = lazy\(\(\) => import\('\.\/pages\/hq\/IntegrationKeysPage'\)\);/);
});

test('the page holds both consoles, GitHub Sync as its #github section', () => {
  assert.match(PAGE, /import \{ IntegrationKeysPanel \} from '\.\.\/admin\/consoles\/IntegrationKeysConsole';/);
  assert.match(PAGE, /import \{ GithubSyncPanel \} from '\.\.\/admin\/consoles\/GithubSyncConsole';/);
  const keys = PAGE.indexOf('<IntegrationKeysPanel />');
  const sync = PAGE.indexOf('<GithubSyncPanel />');
  assert.ok(keys > 0 && sync > keys, 'the keys come first, GitHub Sync below them');
  assert.match(PAGE.slice(PAGE.lastIndexOf('<section', sync), sync), /id="github"/, 'GitHub Sync is not the #github section');
});

test('the row is the Super Admin\'s, after Platform, and no other profile has it', () => {
  const hq = (SIDEBAR_GROUPS.super_admin || []).flatMap((g) => g.items || []);
  const at = hq.findIndex((r) => r.to === '/admin/integration-keys');
  assert.ok(at > 0, 'no Super Admin row');
  assert.equal(hq[at].label, 'Integration keys');
  assert.equal(hq[at - 1].label, 'Platform');
  for (const [role, groups] of Object.entries(SIDEBAR_GROUPS)) {
    if (role === 'super_admin') continue;
    const rows = (groups || []).flatMap((g) => g.items || []);
    assert.ok(!rows.some((r) => String(r.to || '').startsWith('/admin/integration-keys')), `${role} has the row`);
  }
});

test('the Admin Console offers neither console any more', () => {
  const start = ADMIN_PAGE.indexOf('const ADMIN_SECTIONS = [');
  const sections = ADMIN_PAGE.slice(start, ADMIN_PAGE.indexOf('];', start));
  assert.doesNotMatch(sections, /value: 'integration-keys'|value: 'github'/);
  assert.doesNotMatch(ADMIN_PAGE, /IntegrationKeysPanel|GithubSyncPanel/);
});

test('the old addresses redirect to the page, GitHub Sync to its section', () => {
  assert.equal(legacyContractsTarget('?tab=integration-keys'), '/admin/integration-keys');
  assert.equal(legacyContractsTarget('?tab=github'), '/admin/integration-keys#github');
  assert.equal(legacyContractsTarget('?tab=legal'), '/admin/contracts?moved=legal', 'D647 is unchanged');
  for (const q of ['', '?tab=users', '?tab=payments', '?tab=constructor', '?tab=__proto__']) {
    assert.equal(legacyContractsTarget(q), null, q);
  }
});

test('nothing in the app links the old addresses', () => {
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(jsx?|tsx?)$/.test(name) && !p.endsWith('LegacyContractsRedirect.jsx')) {
        if (/\/admin\?tab=(integration-keys|github)\b/.test(readFileSync(p, 'utf8'))) hits.push(p.slice(root.length + 1));
      }
    }
  };
  walk(resolve(root, 'frontend/src'));
  walk(resolve(root, 'cloudflare-worker/src'));
  assert.deepEqual(hits, []);
});

test('the Worker reads take requireSuperAdmin, and the writes keep D223\'s bar', () => {
  const keys = read('cloudflare-worker/src/routes/admin_integration_keys.ts');
  const gh = read('cloudflare-worker/src/routes/admin_github.ts');
  const gate = (src, method, path) => {
    const at = src.indexOf(`r.${method}('${path}', async (c) => {`);
    assert.ok(at >= 0, `${method.toUpperCase()} ${path} moved`);
    return /await (require\w+)\(c\)/.exec(src.slice(at, at + 200))?.[1];
  };
  assert.equal(gate(keys, 'get', '/'), 'requireSuperAdmin');
  assert.equal(gate(keys, 'post', '/:provider/test'), 'requireSuperAdmin');
  assert.equal(gate(keys, 'put', '/:provider'), 'requireSuperAdminWriteBar');
  assert.equal(gate(keys, 'post', '/:provider/rotate'), 'requireSuperAdminWriteBar');
  assert.equal(gate(keys, 'delete', '/:provider'), 'requireSuperAdminWriteBar');
  assert.equal(gate(gh, 'get', '/'), 'requireSuperAdmin');
  assert.equal(gate(gh, 'post', '/test'), 'requireSuperAdmin');
  assert.equal(gate(gh, 'put', '/'), 'requireSuperAdminWriteBar');
  assert.equal(gate(gh, 'delete', '/'), 'requireSuperAdminWriteBar');
  for (const src of [keys, gh]) assert.doesNotMatch(src, /\brequireAdmin\(c\)/, 'a route still admits a plain admin');
});

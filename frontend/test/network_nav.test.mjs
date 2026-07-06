/**
 * Unified Network page — information-architecture invariants.
 *
 * Covers the Contacts + Relationships → Network merge:
 *
 *   1. Exactly one top-level sidebar entry ("Network", → /network); the
 *      standalone "Contacts" and "Relationships" items are gone.
 *   2. Legacy routes redirect: /contacts → /network?tab=contacts and
 *      /relationships → /network?tab=relationships; /network mounts NetworkPage.
 *   3. NetworkPage renders both tabs (Contacts + Relationships) and gates
 *      Contacts to admin/founder.
 *   4. Activity Feed and Leaderboard are gone entirely (no tab, no fetch).
 *   5. The former page bodies are exported as named panels the container reuses.
 *
 * These are source-level assertions — the frontend has no React test runner, so
 * (like the other frontend/test/*.mjs suites) we parse the source directly.
 *
 * Run with:  node --test frontend/test/network_nav.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => readFileSync(join(SRC, rel), 'utf8');

const sidebar = read('sidebarConfig.js');
const app = read('App.jsx');
const network = read('pages/NetworkPage.jsx');
const relationships = read('pages/RelationshipsPage.jsx');
const contacts = read('pages/ContactsPage.jsx');

test('sidebar exposes a single Network entry and no standalone Contacts/Relationships items', () => {
  assert.match(sidebar, /to:\s*'\/network'/, 'expected a /network sidebar entry');
  assert.match(sidebar, /label:\s*'Network'/, "expected a 'Network' label");
  assert.doesNotMatch(sidebar, /to:\s*'\/contacts'/, 'no sidebar item should point at /contacts');
  assert.doesNotMatch(sidebar, /to:\s*'\/relationships'/, 'no sidebar item should point at /relationships');
});

test('legacy /contacts and /relationships routes redirect into the Network tabs', () => {
  assert.match(app, /path="\/contacts"\s+element=\{<Navigate to="\/network\?tab=contacts" replace \/>\}/);
  assert.match(app, /path="\/relationships"\s+element=\{<Navigate to="\/network\?tab=relationships" replace \/>\}/);
});

test('/network route mounts NetworkPage and dead page imports are removed', () => {
  assert.match(app, /path="\/network"[^\n]*<NetworkPage \/>/);
  assert.match(app, /import\('\.\/pages\/NetworkPage'\)/);
  assert.doesNotMatch(app, /import\('\.\/pages\/ContactsPage'\)/, 'ContactsPage should no longer be lazily imported');
  assert.doesNotMatch(app, /import\('\.\/pages\/RelationshipsPage'\)/, 'RelationshipsPage should no longer be lazily imported');
});

test('NetworkPage reuses both panels, renders both tabs, and gates Contacts to admin/founder', () => {
  assert.match(network, /import\s*\{\s*ContactsPanel\s*\}\s*from\s*'\.\/ContactsPage'/);
  assert.match(network, /import\s*\{\s*RelationshipsPanel\s*\}\s*from\s*'\.\/RelationshipsPage'/);
  assert.match(network, /id:\s*'contacts'/);
  assert.match(network, /id:\s*'relationships'/);
  assert.match(network, /role === 'admin' \|\| role === 'founder'/);
});

test('Activity Feed and Leaderboard are removed entirely', () => {
  for (const needle of ['Activity Feed', 'Leaderboard', 'ActivityTab', 'LeaderboardTab', 'partnerLeaderboard', 'activityLogs']) {
    assert.ok(!relationships.includes(needle), `RelationshipsPage should not reference ${needle}`);
  }
});

test('former page bodies are exported as reusable named panels', () => {
  assert.match(contacts, /export function ContactsPanel/);
  assert.doesNotMatch(contacts, /export default/, 'ContactsPage should no longer have a default export');
  assert.match(relationships, /export function RelationshipsPanel/);
  assert.doesNotMatch(relationships, /export default/, 'RelationshipsPage should no longer have a default export');
});

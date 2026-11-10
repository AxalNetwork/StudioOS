/**
 * D5304 (#5304, D4860 question D = b) — HQ › Platform's key rows draw each
 * managed key's expiry and last use, and a key near or past its expiry joins
 * Needs attention.
 *
 * What is pinned:
 *   - a reported expiry draws as a date with the days left; a past one as
 *     expired; one never reported reads "Not recorded", never a date and never
 *     "0 d";
 *   - a key never used reads "Last used Not recorded";
 *   - stamps that could not be read read Unreadable;
 *   - Needs attention: expired is High, within 30 days is Medium, beyond it or
 *     not recorded raises nothing; none of it lowers platform health;
 *   - the console's dialog sends an expiry only when one was typed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/platform_key_stamps_5304.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { IntegrationKeysPanel } from '../src/pages/hq/PlatformPage.jsx';
import {
  keyExpiry, keyExpiryText, keyLastUsedText, keyExpiryItems, expirySummary, KEY_EXPIRY_WARN_DAYS, STATUS,
  signals, attention,
} from '../src/pages/hq/platformOverviewModel.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const render = (props) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(IntegrationKeysPanel, props)));
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
const slot = (html, id) => {
  const m = html.match(new RegExp(`data-testid="${id}"[^>]*>([\\s\\S]*?)</span>`));
  return m ? text(m[1]).trim() : null;
};

const item = (provider_key, extra = {}) => ({ provider_key, state: 'env', last_set_at: null, last_set_basis: 'no_record', expires_at: null, last_used_at: null, ...extra });
const KEYS = {
  available: true,
  managed: 5,
  db_readable: true,
  db_reason: null,
  counts: { env: 3, db: 1, unset: 1, unreadable: 0 },
  items: [
    item('stripe', { expires_at: '2027-03-01 00:00:00', last_used_at: '2026-11-10 11:42:00' }), // reported, far
    item('slack'),                                                                           // unreported, never used
    item('hubspot', { state: 'db', expires_at: '2026-11-01 00:00:00' }),                     // expired
    item('github', { expires_at: '2026-12-06 00:00:00' }),                                   // within 30 d
    item('gcip', { state: 'unset' }),
  ],
  last_set_available: true,
  last_set_reason: 'basis',
  stamps_available: true,
  stamps_reason: 'Expiry is recorded only where the provider reports one.',
  notes: [],
};

/* ── the model ──────────────────────────────────────────────────────────── */

test('a reported expiry is a date with the days left', () => {
  const e = keyExpiry(KEYS.items[0], NOW);
  assert.equal(e.state, 'Valid');
  assert.equal(e.days, 110);
  assert.equal(keyExpiryText(KEYS.items[0], NOW), '1 Mar 2027 · in 110 d');
});

test('an unreported expiry is Not recorded: no date, no days', () => {
  const e = keyExpiry(KEYS.items[1], NOW);
  assert.deepEqual(e, { state: 'Not recorded', at: null, days: null });
  assert.equal(keyExpiryText(KEYS.items[1], NOW), 'Not recorded');
  assert.doesNotMatch(keyExpiryText(KEYS.items[1], NOW), /\d/);
});

test('an expired key reads expired, with how long ago', () => {
  assert.equal(keyExpiry(KEYS.items[2], NOW).state, 'Expired');
  assert.equal(keyExpiryText(KEYS.items[2], NOW), '1 Nov 2026 · expired 9 d ago');
  const justNow = item('x', { expires_at: '2026-11-10 11:00:00' });
  assert.equal(keyExpiry(justNow, NOW).state, 'Expired', 'an hour past the expiry is expired');
  assert.equal(keyExpiryText(justNow, NOW), '10 Nov 2026 · expired today');
});

test('a key inside the window is Expiring; one a day past the window is not', () => {
  assert.equal(KEY_EXPIRY_WARN_DAYS, 30);
  assert.equal(keyExpiry(KEYS.items[3], NOW).state, 'Expiring');
  assert.equal(keyExpiry(item('x', { expires_at: '2026-12-10 12:00:00' }), NOW).state, 'Expiring', '30 days exactly is inside');
  assert.equal(keyExpiry(item('x', { expires_at: '2026-12-11 12:00:00' }), NOW).state, 'Valid');
  for (const s of ['Expired', 'Expiring']) assert.ok(STATUS[s]?.sym && STATUS[s]?.tone, `${s} has no symbol`);
});

test('a key never used reads Not recorded; a used one its UTC minute', () => {
  assert.equal(keyLastUsedText(KEYS.items[1]), 'Not recorded');
  assert.equal(keyLastUsedText(KEYS.items[0]), '2026-11-10 11:42');
});

test('Needs attention: expired is High, within 30 days Medium, nothing else', () => {
  const items = keyExpiryItems(KEYS, NOW, '2026-11-10 12:00');
  assert.deepEqual(items.map((i) => [i.title, i.severity, i.state]), [
    ['Hubspot key expired', 'High', 'Expired'],
    ['Github key expires in 25 days', 'Medium', 'Expiring'],
  ]);
  for (const i of items) assert.equal(i.link.to, '/admin/integration-keys');
  assert.deepEqual(keyExpiryItems({ ...KEYS, items: [KEYS.items[0], KEYS.items[1]] }, NOW, null), [], 'far or unrecorded raised an item');
  assert.deepEqual(keyExpiryItems({ available: false }, NOW, null), []);
});

test('an expired key reaches the queue through the keys signal, as configuration that lowers no health', () => {
  const sigs = signals({ data: { integration_keys: KEYS }, deps: null, traffic: null, now: NOW, UNAVAILABLE: Symbol('u') });
  const titles = attention(sigs).map((i) => i.title);
  assert.ok(titles.includes('Hubspot key expired') && titles.includes('Github key expires in 25 days'), titles.join(' | '));
  const keys = sigs.find((x) => x.key === 'keys');
  assert.equal(keys.config, true);
  assert.equal(keys.status, 'Healthy');
});

test('the Integrations block counts expiry over held keys only, and says Unreadable when unread', () => {
  assert.equal(expirySummary(KEYS, NOW), '1 expired · 1 within 30 d · 1 of 4 not recorded');
  assert.equal(expirySummary({ ...KEYS, stamps_available: false }, NOW), 'Unreadable');
});

/* ── the key rows ───────────────────────────────────────────────────────── */

test('each held key row draws its expiry and last use; an unset key draws neither', () => {
  const html = render({ keys: KEYS, now: NOW });
  assert.equal(slot(html, 'hq-key-expiry-stripe'), 'Expiry 1 Mar 2027 · in 110 d');
  assert.equal(slot(html, 'hq-key-last-used-stripe'), 'Last used 2026-11-10 11:42');
  assert.equal(slot(html, 'hq-key-expiry-slack'), 'Expiry Not recorded');
  assert.equal(slot(html, 'hq-key-last-used-slack'), 'Last used Not recorded');
  assert.equal(slot(html, 'hq-key-expiry-hubspot'), 'Expiry 1 Nov 2026 · expired 9 d ago');
  assert.match(html, /data-testid="hq-key-expiry-hubspot" data-state="Expired"/);
  assert.match(html, /data-testid="hq-key-expiry-github" data-state="Expiring"/);
  assert.ok(!html.includes('hq-key-stamps-gcip'), 'an unset key drew stamps');
  assert.doesNotMatch(text(html), /Expiry 0 d|in 0 d/);
  assert.match(html, /data-testid="hq-keys-stamps-basis"/);
});

test('stamps that could not be read read Unreadable, never Not recorded', () => {
  const html = render({ keys: { ...KEYS, stamps_available: false }, now: NOW });
  const m = html.match(/data-testid="hq-key-stamps-stripe"[^>]*>([^<]*)</);
  assert.equal(m?.[1], 'Expiry Unreadable · Last used Unreadable');
});

test('the console dialog sends an expiry only when one was typed', () => {
  const api = readFileSync(resolve(process.cwd(), 'frontend/src/lib/api.js'), 'utf8');
  assert.match(api, /adminSetIntegrationKeys: \(provider, client_id, client_secret, expires_at = ''\)/);
  assert.match(api, /JSON\.stringify\(\{ client_id, client_secret, \.\.\.\(expires_at \? \{ expires_at \} : \{\}\) \}\)/);
  const dialog = readFileSync(resolve(process.cwd(), 'frontend/src/pages/admin/consoles/IntegrationKeysConsole.jsx'), 'utf8');
  assert.match(dialog, /data-testid="integration-keys-expiry"/);
  assert.match(dialog, /adminRotateIntegrationKeys\(provider, clientSecret\.trim\(\), expiresAt\)/);
});

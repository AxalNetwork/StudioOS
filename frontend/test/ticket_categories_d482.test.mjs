/**
 * D482 (#1022) — the ticket category on the filing form and the HQ Support
 * panel: the panel draws HQ's stored tiers (or says it cannot), the eight
 * categories with the uncategorised apart, and names the branch copy as held.
 * The form's list is held to migration 333's CHECK by running it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { TICKET_CATEGORIES } from '../src/lib/ticketCategories.js';
import { SlaPolicyPanel, SUPPORT_UNAVAILABLE } from '../src/pages/hq/HqSupportPage.jsx';

const render = (props) => renderedText(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SlaPolicyPanel, props))));
const M333 = readFileSync(new URL('../../cloudflare-worker/sql/migrations/333_ticket_category_sla_tiers.sql', import.meta.url), 'utf8');

test('the form offers exactly the eight categories migration 333 accepts', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); CREATE TABLE tickets (id INTEGER PRIMARY KEY, title TEXT);');
  db.exec(M333);
  const ins = db.prepare("INSERT INTO tickets (title, category) VALUES ('t', ?)");
  for (const c of TICKET_CATEGORIES) ins.run(c.id);
  assert.equal(TICKET_CATEGORIES.length, 8);
  for (const c of TICKET_CATEGORIES) assert.throws(() => ins.run(c.label + ' '), /CHECK/, `the CHECK took ${c.label}`);
  // And the CHECK takes no ninth: its list, read back from the failure of every other value, is the form's.
  assert.throws(() => ins.run('refunds'), /CHECK/);
  assert.deepEqual(TICKET_CATEGORIES.map((c) => c.label), ['Fund administration', 'Contracts', 'Access & permissions', 'Licence & seats', 'Billing', 'Data & reporting', 'Onboarding', 'Other']);
});

const TIERS = { available: true, items: [
  { id: 'P1', hours: 36, due_soon_hours: 18, description: 'Money, access, or data at risk' },
  { id: 'P2', hours: 48, due_soon_hours: 24, description: 'A workflow is blocked, a workaround exists' },
  { id: 'P3', hours: 96, due_soon_hours: 24, description: 'Wrong, but nobody is stopped' },
] };
const HELD = { held: true, reason: 'Branches do not carry these hours yet.' };
const TAX = (uncategorised) => ({ available: true, uncategorised,
  items: TICKET_CATEGORIES.map((c, i) => ({ category: c.id, label: c.label, open: i === 4 ? 3 : 0 })) });

test('the panel draws the stored tiers with an edit control, and names the branch copy as held', () => {
  const t = render({ slaPolicy: { tiers: TIERS, escalation_kinds: [], branch_copy: HELD }, taxonomy: TAX(0), failed: false });
  assert.match(t, /P1Money, access, or data at risk36h· due soon last 18h/);
  assert.match(t, /Edit hours/);
  assert.match(t, /Branch copy held/);
  assert.match(t, /Set here · ticket tiers/);
  assert.doesNotMatch(t, /Fixed in code · the same on every subsidiary/);
});

test('an unreadable tier store says so and offers no edit', () => {
  const t = render({ slaPolicy: { tiers: { available: false, reason: 'no table' }, escalation_kinds: [] }, taxonomy: TAX(0), failed: false });
  assert.match(t, /Unreadable/);
  assert.match(t, /No ticket is banded until the tiers can be read/);
  assert.doesNotMatch(t, /Edit hours/);
  assert.doesNotMatch(t, /P1/);
});

test('the taxonomy lists the eight categories and counts the uncategorised apart, never as Other', () => {
  const t = render({ slaPolicy: { tiers: TIERS, escalation_kinds: [] }, taxonomy: TAX(2), failed: false });
  assert.match(t, /Open tickets by category/);
  for (const c of TICKET_CATEGORIES) assert.match(t, new RegExp(c.label.replace('&', '&')));
  assert.match(t, /Billing3/);
  assert.match(t, /Other0/);
  assert.match(t, /2 open with no category recorded/);
  assert.match(t, /Eight categories, fixed/);
  assert.doesNotMatch(t, /Types are fixed at filing/);
  const none = render({ slaPolicy: { tiers: TIERS, escalation_kinds: [] }, taxonomy: TAX(0), failed: false });
  assert.doesNotMatch(none, /no category recorded/, 'a zero uncategorised count was drawn as a line');
});

test('the rail no longer says the categories are not stored, and says the branch copy is held', () => {
  assert.ok(!SUPPORT_UNAVAILABLE.some(([t]) => /Eight canvas support categories/.test(t)));
  assert.ok(SUPPORT_UNAVAILABLE.some(([t, d]) => /SLA hours/.test(t) && /slot S05/.test(d)));
});

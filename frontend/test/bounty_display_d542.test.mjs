/**
 * D542 (#1105, the owner's C) — a ticket's bounty state, shown on the rows of
 * Help → Tickets and in the chat's list of the member's own bug reports.
 *
 * Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/bounty_display_d542.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import BountyBadge, { bountyLine } from '../src/components/tickets/BountyBadge.jsx';
import { MyBugReportsList } from '../src/components/tickets/MyBugReports.jsx';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('each state is worded once, and a fixed bounty names only what the ledger paid', () => {
  assert.equal(bountyLine({ state: 'under_review' }).text, 'Under review');
  assert.equal(bountyLine({ state: 'confirmed' }).text, 'Confirmed: being fixed');
  assert.equal(bountyLine({ state: 'fixed', credits: 150, revoked: false }).text, 'Fixed: 150 credits');
  assert.equal(bountyLine({ state: 'fixed', credits: 1, revoked: false }).text, 'Fixed: 1 credit');
  assert.equal(bountyLine({ state: 'fixed', credits: 20, revoked: true }).text, 'Fixed: credits taken back');
  assert.equal(bountyLine({ state: 'fixed', credits: null }).text, 'Fixed: no credits granted', 'no grant: never a guessed amount');
  assert.equal(bountyLine({ state: 'fixed', credits: null, credits_unreadable: true }).text, 'Fixed: credits could not be read');
  assert.equal(bountyLine({ state: 'not_a_bug' }).text, 'Not a bug');
  assert.match(bountyLine({ state: 'not_a_bug' }).hint, /reason is in the ticket’s comments/);
  assert.equal(bountyLine({ state: 'duplicate' }).text, 'Duplicate');
  assert.equal(bountyLine(null), null);
  assert.equal(html(h(BountyBadge, { bounty: null })), '', 'a ticket with no bounty state shows nothing');
});

test('the states the badge words are the states the route sends', () => {
  const svc = read('cloudflare-worker/src/services/bugBounties.ts');
  const states = [...svc.matchAll(/state: '([a-z_]+)'/g)].map((m) => m[1]);
  for (const s of new Set(states)) assert.ok(bountyLine({ state: s, credits: 1 }), `${s} has no wording`);
});

test('Help → Tickets draws the badge beside each row\'s status, in both layouts', () => {
  const page = read('frontend/src/pages/TicketsPage.jsx');
  assert.match(page, /import BountyBadge from '\.\.\/components\/tickets\/BountyBadge';/);
  assert.equal((page.match(/<BountyBadge bounty=\{t\.bounty\} \/>/g) || []).length, 2, 'the virtual rows and the table rows');
});

test('the chat lists the member\'s bug reports with their state, and a failed read is said as one', () => {
  const rows = [
    { id: 1, title: 'Export 500s', bounty: { state: 'fixed', credits: 60, revoked: false } },
    { id: 2, title: 'A feature', bounty: null },
    { id: 3, title: 'Login loop', bounty: { state: 'not_a_bug' } },
  ];
  const t = text(h(MyBugReportsList, { status: 'ready', rows }));
  assert.match(t, /My bug reports All tickets Export 500s Fixed: 60 credits Login loop Not a bug The reason is in the ticket’s comments\./);
  assert.doesNotMatch(t, /A feature/, 'a ticket with no bounty state is not a bug report');
  assert.match(html(h(MyBugReportsList, { status: 'ready', rows })), /href="\/help\/tickets\/1"/);
  assert.match(text(h(MyBugReportsList, { status: 'ready', rows: [] })), /No bug reports yet\./);
  assert.match(text(h(MyBugReportsList, { status: 'unreadable' })), /Your tickets could not be read\. This is not a sign that you have none\./);
  assert.doesNotMatch(text(h(MyBugReportsList, { status: 'unreadable' })), /No bug reports yet/);
  const many = Array.from({ length: 8 }, (_, i) => ({ id: i + 10, title: `Bug ${i}`, bounty: { state: 'under_review' } }));
  assert.equal((html(h(MyBugReportsList, { status: 'ready', rows: many })).match(/data-testid="bounty-state"/g) || []).length, 5, 'the five newest; the rest are a link away');
  // It is mounted under the chat's ticket form.
  assert.match(read('frontend/src/components/advisor/PersonalAdvisor.jsx'), /<\/div>\n      <MyBugReports \/>\n    <\/div>/);
});

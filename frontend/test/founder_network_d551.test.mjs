/**
 * D551 (#1144) — the founder Network pages read a contact's strength and
 * organisation (migration 386) and the list's follow-up rollup, and the desk's
 * two proposal bands draft over founder surfaces.
 *
 * The Worker half is pinned in cloudflare-worker/test/contacts_founder_network_d551.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { followUp, lastNote, strengthLabel } from '../src/lib/networkBook.js';
import { RelationshipTable, profileBody } from '../src/pages/founder/FounderNetworkRelationships.jsx';
import { OrganizationTable, strongest } from '../src/pages/founder/FounderNetworkOrganizations.jsx';
import { PAIRINGS_REASON, coldestProject } from '../src/pages/founder/FounderNetworkDesk.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const render = (C, props) => renderedText(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props))));
const NOW = Date.parse('2026-10-05T12:00:00Z');
// The table reads the clock, so its fixture does too.
const ago = (days) => new Date(Date.now() - days * 86400_000 - 3600_000).toISOString();

test('strength reads its label, and an unscored contact is Not recorded, never Cool', () => {
  assert.equal(strengthLabel({ strength: 'strong' }), 'Strong');
  assert.equal(strengthLabel({ strength: 'COOL' }), 'Cool');
  assert.equal(strengthLabel({ strength: null }), 'Not recorded');
  assert.equal(strengthLabel({ strength: 'hot' }), 'Not recorded');
});

test('follow-up: due, overdue, undated, none — and Not recorded when the rollup is missing', () => {
  assert.deepEqual(followUp({ open_tasks: 2, next_task_due: '2026-10-20' }, NOW), { state: 'due', text: 'Follow up due Oct 20, 2026' });
  assert.deepEqual(followUp({ open_tasks: 1, next_task_due: '2026-10-01' }, NOW), { state: 'overdue', text: 'Follow-up overdue since Oct 1, 2026' });
  assert.equal(followUp({ open_tasks: 1, next_task_due: '2026-10-05' }, NOW).state, 'due', 'due today is not overdue');
  assert.deepEqual(followUp({ open_tasks: 3, next_task_due: null }, NOW), { state: 'undated', text: '3 open, no due date' });
  assert.deepEqual(followUp({ open_tasks: 0, next_task_due: null }, NOW), { state: 'none', text: 'No open follow-up' });
  assert.deepEqual(followUp({}, NOW), { state: 'not_recorded', text: 'Not recorded' }, 'a row without the rollup is not "none open"');
  assert.equal(lastNote({ last_reply_at: '2026-09-15 10:00:00' }), 'Sep 15, 2026');
  assert.equal(lastNote({ last_reply_at: null }), 'Not recorded');
});

test('a save sends null for a blank, never an empty string', () => {
  assert.deepEqual(profileBody('warm', '  Latitude Seed '), { strength: 'warm', organization: 'Latitude Seed' });
  assert.deepEqual(profileBody('', '   '), { strength: null, organization: null });
});

// The table reads the real clock, so a due date that is still to come must stay
// in the future: a fixed 2026 date turned this row overdue on 2026-10-21.
const FUTURE_DUE = '2099-10-20';

test('the relationship book shows strength, organisation, follow-up and last note, and an editor per row', () => {
  const rows = [
    { id: 1, uid: 'a', name: 'Ana', email: 'a@x.test', audience: 'investor', strength: 'warm', organization: 'Latitude Seed',
      last_activity_at: ago(4), open_tasks: 1, next_task_due: FUTURE_DUE, last_reply_at: '2026-09-15 10:00:00' },
    { id: 2, uid: 'b', name: 'Bo', email: 'b@x.test', audience: 'advisor', strength: null, organization: null,
      last_activity_at: ago(71), open_tasks: 0, next_task_due: null, last_reply_at: null },
  ];
  const t = render(RelationshipTable, { rows });
  assert.match(t, /Ana\s*Latitude Seed/);
  assert.match(t, /Warm/);
  assert.match(t, /Follow up due Oct 20, 2099/);
  assert.match(t, /Sep 15, 2026/);
  assert.match(t, /Bo\s*b@x\.test/, 'no organisation: the email, not an inferred company');
  assert.match(t, /71 days ago · going cold/);
  assert.match(t, /No open follow-up/);
  // Bo's strength and last note, plus each editor's empty strength option.
  assert.equal((t.match(/Not recorded/g) || []).length, 4);
  assert.equal((renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RelationshipTable, { rows }))).match(/<form/g) || []).length, 2);
});

test('organisations group the set field and name their strongest tie', () => {
  assert.equal(strongest([{ strength: 'cool' }, { strength: 'warm' }]), 'Warm');
  assert.equal(strongest([{ strength: null }]), 'Not recorded');
  const t = render(OrganizationTable, { groups: [{ name: 'Verwood', people: [{ strength: 'strong', audience: 'customer', last_activity_at: ago(2) }], types: ['customer'] }] });
  assert.match(t, /Verwood.*1.*Strong/s);
});

test('the desk: the re-engagement band drafts for the coldest contact\'s project, and pairings stay Not recorded', () => {
  assert.equal(coldestProject([
    { project_id: 7, last_activity_at: new Date(Date.now() - 70 * 86400_000).toISOString() },
    { project_id: 9, last_activity_at: new Date(Date.now() - 95 * 86400_000).toISOString() },
    { project_id: 3, last_activity_at: new Date(Date.now() - 2 * 86400_000).toISOString() },
  ]), '9');
  assert.equal(coldestProject([{ project_id: 3, last_activity_at: new Date().toISOString() }]), null, 'nobody cold: no band');
  const desk = read('frontend/src/pages/founder/FounderNetworkDesk.jsx');
  assert.match(desk, /surface="network\/re-engagement"\s*scopeKey=\{coldScope\}/);
  assert.match(desk, /surface="network\/intro-email"/);
  assert.match(desk, /\{fillsOn && coldScope \? <ZoneDraft/, 'the band draws with the switch off');
  assert.match(desk, /<Empty title="Not recorded" body=\{PAIRINGS_REASON\} \/>/);
  assert.match(PAIRINGS_REASON, /never between two third parties/);
  assert.doesNotMatch(desk, /pending\.length \? <Propositions/, 'pending propositions shown as pairings again');
});

test('the worker registers both founder surfaces the desk names', () => {
  const research = read('cloudflare-worker/src/routes/research.ts');
  assert.match(research, /'network\/re-engagement': \{/);
  assert.match(research, /'network\/intro-email': \{/);
});

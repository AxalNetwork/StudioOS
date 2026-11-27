/**
 * D775 (#2101) PR 7 — the Super Admin's Support section (H35) on the rail.
 *
 * H35 is one board, `pages/hq/HqSupportPage.jsx`, whose rail is HQ's. Its one
 * record view is an escalation's decision panel: while it is open, the
 * escalation being answered is the rail's last crumb and the run's record,
 * named as its card names it (`escalationTitle`), through `useRecordCrumb`.
 * Closing the panel drops it. The ticket queues are read-only rows. Support
 * offers no option that runs a model.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_support_super_admin_d775.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { currentRail, pageKeyFor } from '../src/lib/railPages.js';
import { RailPageProvider, useRailCrumbs } from '../src/ui/railCrumbs.js';
import { EscalationDecision, escalationCardProps, escalationTitle } from '../src/pages/hq/HqSupportPage.jsx';
import { SUPER_ADMIN_BOARDS, SUPER_ADMIN_RAIL_OPTIONS, boardPage } from '../src/lib/railOptions/superAdmin.js';

const read = (p) => codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src', p), 'utf8'));
const ITEM = { uid: 'esc_7', branch_code: 'MTL', subject: 'Seat increase', kind: 'seat_increase', age_hours: 3 };

test('H35 Support is one board on its own route, with no option', () => {
  const boards = SUPER_ADMIN_BOARDS.filter((b) => b.section === 'Support');
  assert.deepEqual(boards.map((b) => b.id), ['H35']);
  assert.equal(pageKeyFor(boards[0].route, 'super_admin'), boardPage(boards[0]));
  assert.deepEqual(SUPER_ADMIN_RAIL_OPTIONS.filter((o) => o.page.startsWith('Super Admin · Support')), []);
});

test('the record is named as the escalation\'s card names it, by one function', () => {
  assert.equal(escalationTitle(ITEM), 'MTL · Seat increase');
  assert.equal(escalationTitle({ ...ITEM, subject: '' }), 'MTL · seat increase');
  const card = escalationCardProps({ escalations: { available: true, count: 1, items: [ITEM] } }, false, null);
  assert.equal(card.items[0].title, escalationTitle(ITEM));
  const code = read('pages/hq/HqSupportPage.jsx');
  const panel = code.slice(code.indexOf('export function EscalationDecision('));
  assert.match(panel, /^export function EscalationDecision\([^)]*\) \{\s*useRecordCrumb\(escalationTitle\(item\), 'escalation', item\.uid\);/,
    'the decision panel no longer names its escalation first thing');
  assert.equal(code.split('useRecordCrumb(').length - 1, 1, 'a second record on the Support page');
});

function Probe({ seen }) {
  seen.push(useRailCrumbs());
  return null;
}

test('an open decision panel is the last crumb and the run\'s record; closing it drops both', async () => {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const seen = [];
  const tree = (open) => React.createElement(MemoryRouter, { initialEntries: ['/admin/hq-support'] },
    React.createElement(RailPageProvider, { role: 'super_admin' },
      open ? React.createElement(EscalationDecision, { item: ITEM, onRecorded() {}, onReload() {} }) : null,
      React.createElement(Probe, { seen })));
  try {
    await act(async () => { root.render(tree(true)); });
    assert.deepEqual(seen[seen.length - 1], { section: 'Support', module: null, record: 'MTL · Seat increase' });
    assert.deepEqual(currentRail(), { page: 'Super Admin · Support', option: null, record: { type: 'escalation', id: 'esc_7' } });
    await act(async () => { root.render(tree(false)); });
    assert.equal(seen[seen.length - 1].record, null, 'closed, the record is dropped');
    assert.equal(currentRail().record, null, 'closed, the run reads no record');
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});

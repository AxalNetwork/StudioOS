/**
 * D1317 — three admin record panels that had no mounted test of their own,
 * moved onto the shared detail Sheet (`ui/Sheet.jsx`): Team's member editor,
 * Analytics' user drill-down and Monitoring's error detail. Each renders as a
 * named modal dialog at its own width; a new team member stays the centred
 * create form.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_record_sheets_d1317.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { MemberEditor } from '../src/pages/admin/AdminTeam.jsx';
import { UserDrillDown } from '../src/pages/AnalyticsTab.jsx';
import { ErrorDetailModal } from '../src/pages/MonitoringPage.jsx';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

/** The Sheet's frame: a modal dialog named by its title, carrying the testid and the width. */
function assertSheet(out, testId, width) {
  const id = out.match(/<h2 id="([^"]+)"/)?.[1];
  assert.ok(id, `${testId}: the title has an id`);
  assert.match(out, new RegExp(`role="dialog" aria-modal="true" aria-labelledby="${id}"[^>]*data-testid="${testId}" data-width="${width}"`), testId);
  assert.match(out, new RegExp(`data-testid="${testId}-layer"`));
  assert.match(out, new RegExp(`data-testid="${testId}-close"`), 'its ×');
}

test('Team: editing a member is the shared Sheet at 640px; Add team member stays the centred modal', () => {
  const edit = html(h(MemberEditor, { initial: { id: 7, name: 'Fixture Partner', title: 'Partner', slug: 'fixture-partner' }, onClose() {} }));
  assertSheet(edit, 'team-member-sheet', 640);
  assert.match(edit, /Edit Fixture Partner/);
  assert.match(edit, /data-testid="team-member-sheet-footer"/, 'Cancel and Save sit in the fixed footer');
  const add = html(h(MemberEditor, { initial: {}, onClose() {} }));
  assert.doesNotMatch(add, /team-member-sheet/);
  assert.match(add, /fixed inset-0[^"]*items-center justify-center/);
  assert.match(add, /Add team member/);
});

test('Analytics: one user’s drill-down is the shared Sheet at 640px', () => {
  const out = html(h(UserDrillDown, { id: 42, anonymized: false, onClose() {} }));
  assertSheet(out, 'analytics-user-drilldown', 640);
  assert.match(out, /User drill-down · #42/);
  assert.doesNotMatch(out, /fixed inset-0/);
});

test('Monitoring: one error’s detail is the shared Sheet at 760px, with Copy before its ×', () => {
  const error = { id: 9, method: 'POST', endpoint: '/api/fixture', status_code: 500, created_at: '2026-10-27T10:00:00Z', message: 'Fixture failure' };
  const out = html(h(ErrorDetailModal, { error, allErrors: [error], onClose() {} }));
  assertSheet(out, 'monitoring-error-detail', 760);
  assert.match(out, /POST \/api\/fixture → 500/);
  assert.match(out, /Error #9/);
  assert.match(out, />Copy<\/button>.*data-testid="monitoring-error-detail-close"/s);
  assert.doesNotMatch(out, /fixed inset-0/);
});

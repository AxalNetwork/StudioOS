// #4733 — Team: the Settings "Data sharing per role" card and the Add-an-agent controls when the roles read is not ready.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/team_ui_integration_4733.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import AgentsCard from '../src/pages/team/AgentsCard.jsx';
import TeamSettingsTab from '../src/pages/team/TeamSettingsTab.jsx';
import { rolesOffReason } from '../src/pages/team/TeamAgentsPage.jsx';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => renderedText(html(el));
const agent = (over = {}) => ({ uid: 'a-9001', role_key: 'cfo', first_name: 'Synthetic', last_name: null, status: 'active', source: 'platform', monthly_cap_microusd: 5_000_000, month_spend: { available: true, value_microusd: 1_000_000 }, sponsor: { uid: 'u-9001', name: 'Synthetic Sponsor' }, ...over });
const settings = (agents) => text(h(TeamSettingsTab, { scope: { kind: 'project', project: { id: 9001 } }, agentsBlock: { available: true, value: { agents } }, canManage: false }));

test('Data sharing per role renders the Worker\'s reads_line and shows "Not recorded" only when it is absent', () => {
  const sharing = (out) => out.slice(out.indexOf('Data sharing per role'));
  const withLine = sharing(settings([agent({ reads_line: 'Works in Use of funds, Cap table' })]));
  assert.match(withLine, /Works in Use of funds, Cap table/);
  assert.doesNotMatch(withLine, /Not recorded/);
  const without = sharing(settings([agent({ reads_line: undefined })]));
  assert.match(without, /Not recorded/);
  const nulled = sharing(settings([agent({ reads_line: null })]));
  assert.match(nulled, /Not recorded/);
});

test('rolesOffReason: pending, unreadable and refused each give a reason; a readable read gives none', () => {
  assert.equal(rolesOffReason(null), 'Reading the roles…');
  assert.equal(rolesOffReason({ available: false, unreadable: true, reason: 'could not be read' }), 'The roles could not be read.');
  assert.equal(rolesOffReason({ available: false, refused: true, code: 'not_member', reason: 'Only this team’s editors can do this.' }), 'Only this team’s editors can do this.');
  assert.equal(rolesOffReason({ available: true, value: { roles: [] } }), null);
});

test('Add an AI agent is disabled with the reason while the roles read is pending, unreadable or refused', () => {
  const empty = { available: true, value: { agents: [], can_manage: true, plan_ok: true } };
  for (const off of ['Reading the roles…', 'The roles could not be read.', 'Only this team’s editors can do this.']) {
    const out = html(h(AgentsCard, { block: empty, kind: 'project', canAdd: true, addOff: off, onAdd() {} }));
    assert.match(out, /<button[^>]*disabled=""[^>]*data-testid="team-agents-add"|<button[^>]*data-testid="team-agents-add"[^>]*disabled=""/, off);
    assert.ok(renderedText(out).includes(off), off);
  }
  const ready = html(h(AgentsCard, { block: empty, kind: 'project', canAdd: true, addOff: null, onAdd() {} }));
  assert.doesNotMatch(ready, /team-agents-add-off/);
  assert.doesNotMatch(ready, /<button[^>]*disabled=""[^>]*data-testid="team-agents-add"/);
});

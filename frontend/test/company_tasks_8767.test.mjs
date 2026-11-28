import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import CompanyTasks from '../src/pages/team/CompanyTasks.jsx';
import { agentEngineApi } from '../src/lib/api/agentEngine.js';
import { mountContracts } from './_contracts_dom.mjs';

const scope = { company: 'orchard', member: 3, agents: [{ uid: 'a1', first_name: 'Sample' }],
  people: [{ uid: 'p2', name: 'Reviewer' }], canEdit: true };
const mount = (extra = {}, query = '') => mountContracts(React.createElement(CompanyTasks, { ...scope, ...extra }), '/account/companies/orchard/settings/team?tab=tasks' + query);

test('engine off lets an editor save and delete a scoped device brief without creating a task', async t => {
  t.mock.method(agentEngineApi, 'tasks', async () => { throw Object.assign(new Error('off'), { status: 404, code: 'agent_engine_off' }); });
  const create = t.mock.method(agentEngineApi, 'createTask', async () => {});
  const ui = await mount({}, '&agent=a1');
  try {
    assert.match(ui.text(), /Axal switches the agent engine on/);
    await ui.fill('Task title', 'First-pass runway analysis');
    await ui.click('Save draft on this device');
    const key = 'company-task:orchard:3:a1';
    assert.equal(JSON.parse(localStorage.getItem(key)).title, 'First-pass runway analysis');
    assert.equal(create.mock.callCount(), 0);
    await ui.click('Delete draft');
    assert.equal(JSON.parse(localStorage.getItem(key)), null);
  } finally { await ui.unmount(); }
});

test('a human assignment uses the selected company seat, deliverable and due date', async t => {
  t.mock.method(agentEngineApi, 'tasks', async () => ({ tasks: [] }));
  const create = t.mock.method(agentEngineApi, 'createTask', async () => ({ task: { uid: 't1' } }));
  const ui = await mount();
  try {
    await ui.fill('Team member', 'p2');
    await ui.fill('Task title', 'Review runway');
    await ui.fill('Expected deliverable', 'One-page analysis');
    await ui.fill('Due date', '2027-01-04');
    await act(async () => ui.props(ui.nodes().find(n => n.tagName === 'FORM')).onSubmit({ preventDefault() {} }));
    assert.deepEqual(create.mock.calls[0].arguments, ['company', 'orchard', { title: 'Review runway', detail: 'One-page analysis', due_at: '2027-01-04', assignee: { kind: 'person', uid: 'p2' } }]);
  } finally { await ui.unmount(); }
});

test('a read-only visitor sees the selected task and no assignment form', async t => {
  t.mock.method(agentEngineApi, 'tasks', async () => ({ tasks: [{ uid: 't1', title: 'Runway review', detail: 'Summarize projected costs', status: 'open' }] }));
  const ui = await mount({ canEdit: false }, '&task=t1&project=7');
  try {
    assert.match(ui.text(), /Summarize projected costs/);
    assert.match(ui.text(), /Read only/);
    assert.ok(!ui.nodes().some(n => n.tagName === 'FORM'));
  } finally { await ui.unmount(); }
});

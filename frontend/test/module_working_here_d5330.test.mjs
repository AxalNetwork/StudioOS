import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ModuleWorkingHere from '../src/pages/team/ModuleWorkingHere.jsx';
import { teamsApi } from '../src/lib/api/teams.js';
import { teamAgentsApi } from '../src/lib/api/teamAgents.js';
import { agentEngineApi } from '../src/lib/api/agentEngine.js';
import { workAdapter } from '../src/pages/work/workAdapter.js';

const member = { uid: 'ada', name: 'Ada Person', email: 'ada@example.test', role: 'owner' };
const task = { uid: 'task-one', title: 'Read the figures', status: 'open', assignee: { kind: 'person', person: member } };
const agent = { uid: 'agent-one', first_name: 'Orrin', last_name: 'Agent' };
const unavailable = (code) => Object.assign(new Error(code), { code });

test('module header and sheet use the Team and module, and preserve the module on assignment', async (t) => {
  const restore = installDocument();
  window.innerWidth = 390;
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  const render = async (readOnly = false, key = 0) => act(async () => root.render(React.createElement(MemoryRouter, null,
    React.createElement(ModuleWorkingHere, { key, projectId: 7, module: 'use-of-funds', moduleLabel: 'Use of funds', readOnly }))));
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] ?? {};
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => n.nodeType === 3 ? n.textContent : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
  const button = (name) => walk(document.body).find((n) => n.tagName === 'BUTTON' && text(n).startsWith(name));
  const click = async (name) => {
    const node = button(name);
    assert.ok(node, name);
    await act(async () => props(node).onClick());
  };
  let members = [];
  let off = false;
  let broken = false;
  t.mock.method(teamsApi, 'listProjectMembers', async () => ({ members, can_manage: true }));
  const tasks = t.mock.method(agentEngineApi, 'tasks', async () => {
    if (broken) throw new Error('unreadable');
    return { tasks: [task] };
  });
  const agents = t.mock.method(teamAgentsApi, 'listAgents', async () => {
    if (off) throw unavailable('team_agents_off');
    return { agents: [agent] };
  });
  t.mock.method(workAdapter, 'assignable', async () => ({ available: true, data: { team: [{ ...member, kind: 'person' }] } }));
  const write = t.mock.method(agentEngineApi, 'updateTask', async () => ({ task }));

  await render();
  assert.equal(button('Working here'), undefined);
  members = [member];
  await render(false, 1);
  await click('Working here');
  const layer = walk(document.body).find((n) => props(n)['data-testid'] === 'working-here-layer');
  assert.equal(props(layer)['data-phone'], 'full');
  assert.deepEqual(tasks.mock.calls[0].arguments, ['project', 7, { module: 'use-of-funds' }]);
  assert.deepEqual(agents.mock.calls[0].arguments, tasks.mock.calls[0].arguments);
  assert.match(text(document.body), /Ada Person.*Orrin Agent/);
  assert.doesNotMatch(text(document.body), /ada@example\.test/);
  await click('Assign this task to…');
  await click('Ada Person');
  assert.deepEqual(write.mock.calls[0].arguments, ['task-one', { module: 'use-of-funds', assignee: { kind: 'person', uid: 'ada' } }]);

  off = true;
  broken = true;
  await render(true, 2);
  await click('Working here');
  assert.match(text(document.body), /AI agents are not switched on/);
  assert.doesNotMatch(text(document.body), /AI agents · 0|People · 0|Orrin Agent/);
  assert.match(text(document.body), /Couldn’t be read/);
  broken = false;
  await click('Try again');
  assert.match(text(document.body), /Ada Person/);
  assert.equal(button('Assign this task to…'), undefined);
});

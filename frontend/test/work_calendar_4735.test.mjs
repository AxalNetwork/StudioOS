// #4735 — Work and Calendar integration fixes: the capacity writer, the viewer gates on Workload and
// the item sheet, the 403 not_member refusal on Work and Compliance, the Calendar's off block, the route guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import { capacityBody, refusedOf, workloadRows, NOT_ON_THE_TEAM } from '../src/pages/work/workModel.js';
import { workAdapter, WORK_OFF } from '../src/pages/work/workAdapter.js';
import WorkloadView, { canSetCapacity } from '../src/pages/work/WorkloadView.jsx';
import WorkPage, { ItemSheet } from '../src/pages/work/WorkPage.jsx';
import CompliancePage from '../src/pages/work/CompliancePage.jsx';
import { OffBlock } from '../src/pages/CalendarAgentSessions.jsx';
import { api } from '../src/lib/api.js';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
async function mount(element) {
  const restore = installDocument(); const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const all = (id) => walk(document.body).filter((n) => props(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : (n?.childNodes || []).map(text).join('') || n?.textContent || '');
  await act(async () => root.render(element));
  return { all, by: (id) => all(id)[0], props, text: (n) => text(n || document.body),
    press: async (id) => { const n = all(id)[0]; assert.ok(n, id); await act(async () => props(n).onClick()); },
    type: async (id, value) => { await act(async () => props(all(id)[0]).onChange({ target: { value } })); },
    settle: async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); },
    close: async () => { await act(async () => root.unmount()); restore(); } };
}
const WORKLOAD = {
  weeks: ['2026-11-09'],
  people: [
    { person: { uid: 'u-2', name: 'Ada Shah' }, capacity: { available: true, value: 8 }, weeks: [{ week_start: '2026-11-09', items: [{ uid: 't1', title: 'Seed deck', estimate_points: 11 }], estimate_points: 11, unestimated: 0, over_capacity: true }], unscheduled: [] },
    { person: { uid: 'u-3', name: 'Jordan Reyes' }, capacity: { available: false, reason: 'Not recorded' }, weeks: [{ week_start: '2026-11-09', items: [], estimate_points: 0, unestimated: 0, over_capacity: null }], unscheduled: [] },
  ],
  agents: [],
};
function withWorkload(fn) {
  return async () => {
    const old = { workload: workAdapter.workload, assignable: workAdapter.assignable, setCapacity: workAdapter.setCapacity, assign: workAdapter.assign };
    workAdapter.workload = async () => ({ available: true, data: WORKLOAD });
    workAdapter.assignable = async () => ({ available: false, reason: 'no' });
    try { await fn(); } finally { Object.assign(workAdapter, old); }
  };
}

test('words: capacityBody blank clears, 0 to 1,000 is a number, anything else is refused', () => {
  assert.deepEqual(capacityBody(''), { body: { weekly_capacity_points: null } });
  assert.deepEqual(capacityBody('  '), { body: { weekly_capacity_points: null } });
  assert.deepEqual(capacityBody('0'), { body: { weekly_capacity_points: 0 } });
  assert.deepEqual(capacityBody('1000'), { body: { weekly_capacity_points: 1000 } });
  for (const bad of ['1001', '-1', 'abc', '1e3', '8 points']) assert.match(capacityBody(bad).error, /0 to 1,000 points/, bad);
  assert.equal(workloadRows(WORKLOAD)[0].capacityPoints, 8);
  assert.equal(workloadRows(WORKLOAD)[1].capacityPoints, null, 'not recorded is never 0');
});

test('words: refusedOf answers only a 403 not_member, with the Worker sentence and never e.message', () => {
  const e = { status: 403, message: 'HTTP 403 raw', data: { error: 'not_member', message: 'You are not on this team.' } };
  assert.equal(refusedOf(e), 'You are not on this team.');
  assert.equal(refusedOf({ status: 403, data: { error: 'not_member' } }), NOT_ON_THE_TEAM);
  assert.equal(refusedOf({ status: 500, data: { error: 'not_member', message: 'x' } }), null);
  assert.equal(refusedOf({ status: 403, data: { error: 'forbidden', message: 'x' } }), null);
  assert.equal(refusedOf(new Error('boom')), null);
  assert.doesNotMatch(String(refusedOf(e)), /HTTP 403/);
});

test('adapter: setCapacity PUTs the points (null clears) and blocks when the engine is off', async () => {
  const restore = installDocument(), previous = globalThis.fetch; const calls = []; let off = false;
  globalThis.fetch = async (u, o = {}) => { calls.push([new URL(String(u), 'https://example.test').pathname, o.method || 'GET', o.body ? JSON.parse(o.body) : null]);
    return json(off ? { error: 'agent_engine_off' } : { ok: true }, off ? 404 : 200); };
  try {
    assert.deepEqual(await workAdapter.setCapacity(7, 'u/2', 12), { available: true, data: { ok: true } });
    assert.deepEqual(calls.at(-1), ['/api/teams/project/7/work/capacity/u%2F2', 'PUT', { weekly_capacity_points: 12 }]);
    await workAdapter.setCapacity(7, 'u-2', null);
    assert.deepEqual(calls.at(-1)[2], { weekly_capacity_points: null });
    off = true;
    assert.deepEqual(await workAdapter.setCapacity(7, 'u-2', 3), { available: false, reason: WORK_OFF });
  } finally { globalThis.fetch = previous; restore(); }
});

test('canSetCapacity: the person themself or a manager, on a person row only', () => {
  const row = { kind: 'person', who: { uid: 'u-2' } };
  assert.equal(canSetCapacity({ can_manage: true, user_uid: 'u-9' }, row), true);
  assert.equal(canSetCapacity({ can_manage: false, user_uid: 'u-2' }, row), true);
  assert.equal(canSetCapacity({ can_manage: false, user_uid: 'u-9' }, row), false);
  assert.equal(canSetCapacity(null, row), false);
  assert.equal(canSetCapacity({ can_manage: true, user_uid: 'u-9' }, { kind: 'agent', who: { uid: 'a1' } }), false);
});

test('Workload: capacity button and drag follow the viewer; an editor saves, clears and sees the Worker refusal', withWorkload(async () => {
  const calls = [];
  workAdapter.setCapacity = async (...a) => { calls.push(a); return { available: true, data: {} }; };
  const matrix = [
    [{ can_manage: true, user_uid: 'u-1' }, 2, true], [{ can_manage: false, user_uid: 'u-2' }, 1, false],
    [{ can_manage: false, user_uid: 'u-9' }, 0, false], [null, 0, false],
  ];
  for (const [viewer, buttons, canDrag] of matrix) {
    const m = await mount(h(WorkloadView, { projectId: 7, viewer, onOpenItem() {}, onNotice() {} }));
    await m.settle();
    try {
      assert.equal(m.all('work-workload-capacity').length, buttons, JSON.stringify(viewer));
      assert.equal(m.all('work-workload-bar').length > 0, true);
      assert.equal(!!m.props(m.all('work-workload-bar')[0]).draggable, canDrag, `drag ${JSON.stringify(viewer)}`);
      assert.match(m.text(), canDrag ? /Drag a bar/ : /^(?![\s\S]*Drag a bar)/);
    } finally { await m.close(); }
  }
  const notices = [];
  const m = await mount(h(WorkloadView, { projectId: 7, viewer: { can_manage: true, user_uid: 'u-1' }, onOpenItem() {}, onNotice: (x) => notices.push(x) }));
  await m.settle();
  try {
    await act(async () => m.props(m.all('work-workload-capacity')[1]).onClick());
    assert.equal(m.props(m.by('work-capacity-input')).value, '', 'not recorded starts blank, not 0');
    await m.type('work-capacity-input', '2000'); await m.press('work-capacity-save');
    assert.match(m.text(), /0 to 1,000 points/); assert.equal(calls.length, 0);
    await m.type('work-capacity-input', '13'); await m.press('work-capacity-save'); await m.settle();
    assert.deepEqual(calls[0], [7, 'u-3', 13]);
    assert.match(notices[0], /13 points a week/);
    await act(async () => m.props(m.all('work-workload-capacity')[0]).onClick());
    assert.equal(m.props(m.by('work-capacity-input')).value, '8');
    await m.type('work-capacity-input', ''); await m.press('work-capacity-save'); await m.settle();
    assert.deepEqual(calls[1], [7, 'u-2', null]); assert.match(notices[1], /cleared/);
    workAdapter.setCapacity = async () => { throw { status: 403, data: { error: 'forbidden', message: 'Only the person or an editor sets capacity.' } }; };
    await act(async () => m.props(m.all('work-workload-capacity')[0]).onClick());
    await m.press('work-capacity-save'); await m.settle();
    assert.equal(m.text(m.by('work-capacity-error')), 'Only the person or an editor sets capacity.');
  } finally { await m.close(); }
}));

function pageAt(path, route, element) {
  return h(MemoryRouter, { initialEntries: [path] }, h(Routes, null, h(Route, { path: route, element })));
}
test('Work and Compliance: 403 not_member is the Worker sentence with no Try again; a 500 is an error with Try again', async () => {
  const old = { board: workAdapter.board, complianceTasks: workAdapter.complianceTasks, getProject: api.getProject };
  api.getProject = async () => ({ id: 7, name: 'Example' });
  const refuse = { status: 403, message: 'HTTP 403 raw', data: { error: 'not_member', message: 'You are not on this team.' } };
  const fail = { status: 500, message: 'HTTP 500 raw', data: { error: 'boom' } };
  try {
    for (const [name, key, path, route, el, refusedId] of [
      ['work', 'board', '/projects/7/work', '/projects/:id/work', h(WorkPage), 'work-refused'],
      ['compliance', 'complianceTasks', '/c/co-1/compliance', '/c/:uid/compliance', h(CompliancePage), 'compliance-refused'],
    ]) {
      workAdapter[key] = async () => { throw refuse; };
      let m = await mount(pageAt(path, route, el)); await m.settle();
      try {
        assert.equal(m.text(m.by(refusedId)), 'You are not on this team.', name);
        assert.doesNotMatch(m.text(), /HTTP 403|Try again/, name);
      } finally { await m.close(); }
      workAdapter[key] = async () => { throw fail; };
      m = await mount(pageAt(path, route, el)); await m.settle();
      try {
        assert.equal(m.by(refusedId), undefined, name);
        assert.match(m.text(), /Try again/, name);
        assert.doesNotMatch(m.text(), /HTTP 500/, name);
      } finally { await m.close(); }
    }
  } finally { Object.assign(workAdapter, { board: old.board, complianceTasks: old.complianceTasks }); api.getProject = old.getProject; }
});

test('Item sheet: Assign is for a manager only', async () => {
  const task = { project: { id: 7 }, uid: 'item-a', title: 'Example task', column: 'ready', assignee: { kind: 'person', uid: 'u-5' } };
  const old = workAdapter.item; workAdapter.item = async () => ({ available: true, data: task });
  try {
    for (const [viewer, expected] of [[{ can_manage: true, user_uid: 'u-1' }, 1], [{ can_manage: false, user_uid: 'u-1' }, 0], [null, 0]]) {
      const m = await mount(h(MemoryRouter, null, h(ItemSheet, { uid: 'item-a', projectId: 7, viewer, onClose() {} }))); await m.settle();
      try { assert.equal(m.all('work-item-assign').length, expected, JSON.stringify(viewer)); } finally { await m.close(); }
    }
  } finally { workAdapter.item = old; }
});

test('Calendar OffBlock: a link to Team only when the reply names one, never the public /team page', () => {
  const none = renderToStaticMarkup(h(MemoryRouter, null, h(OffBlock, { reason: 'Agents are off.', team: null, onClose() {}, testId: 'x' })));
  assert.doesNotMatch(none, /href=/); assert.match(none, /Agents are off\./);
  const some = renderToStaticMarkup(h(MemoryRouter, null, h(OffBlock, { reason: 'Off.', team: '/projects/7/settings/team', onClose() {}, testId: 'x' })));
  assert.match(some, /href="\/projects\/7\/settings\/team"/);
});

test('the Work route admits advisors, whom the Worker lets read', () => {
  const src = readFileSync(new URL('../src/routes/team.jsx', import.meta.url), 'utf8');
  const line = src.split('\n').find((l) => l.includes('path="/projects/:id/work"'));
  assert.match(line, /labRoles\(\[[^\]]*'advisor'[^\]]*\]\)/);
});

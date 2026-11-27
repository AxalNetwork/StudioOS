// D6320 (#6320) — connector rows, actions and sync notices belong to one Grow venture.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { DurableFromGoogle, RevenueFromGoogle } from '../src/pages/cycles/GrowFromGoogle.jsx';
import GrowFromMercury from '../src/pages/cycles/GrowFromMercury.jsx';
import { googleWorkspace } from '../src/lib/api/googleWorkspace.js';
import { cyclesWrite } from '../src/lib/api/cycles.js';

const h = React.createElement;
const A = 701;
const B = 702;

async function mount(element) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (next) => act(async () => { root.render(h(MemoryRouter, null, next)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  await render(element);
  return {
    render, by, text: (id) => text(id ? by(id) : container), disabled: (id) => props(by(id)).disabled,
    async click(id) { assert.ok(by(id), id); await act(async () => { props(by(id)).onClick(); }); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

const file = (id) => ({ uid: 'sheet-' + id, name: 'Metrics ' + id, module: 'revenue_traction', kind: 'sheet', status: 'active' });
const sheet = (id) => ({ files: [{ uid: file(id).uid, mine: true }], facts: [{ id, snapshot_date: '2026-10-21', new_users: id }] });

test('D6320: a Sheets switch discards the previous rows, mapping target, sync note and late read', async (t) => {
  const lateA = Promise.withResolvers();
  const pendingB = Promise.withResolvers();
  const filesB = Promise.withResolvers();
  let readsA = 0;
  t.mock.method(googleWorkspace, 'files', (project) => project === A ? Promise.resolve({ items: [file(A)] }) : filesB.promise);
  const api = {
    files: googleWorkspace.files,
    growRead(project) {
      if (project === B) return pendingB.promise;
      readsA += 1;
      return readsA === 1 ? Promise.resolve(sheet(A)) : lateA.promise;
    },
    growSync: async () => ({ sheets: { files: 1, written: 2 } }),
  };
  const forProject = (projectId) => h(RevenueFromGoogle, { projectId, api });
  const v = await mount(forProject(A));
  try {
    assert.ok(v.by('from-google-delete-701'));
    assert.ok(v.by('grow-map-open'));
    await v.click('from-google-sync');
    assert.match(v.text('grow-sync-note'), /2 days of figures/);
    assert.equal(readsA, 2, 'the previous venture has a reread in flight');
    await v.render(forProject(B));
    assert.equal(Boolean(v.by('from-google-delete-701')), false);
    assert.equal(Boolean(v.by('grow-map-open')), false);
    assert.equal(Boolean(v.by('grow-sync-note')), false);
    await act(async () => { pendingB.resolve(sheet(B)); });
    assert.equal(Boolean(v.by('grow-map-open')), false, 'venture B has not read its own file yet');
    await act(async () => { filesB.resolve({ items: [file(B)] }); lateA.resolve(sheet(A)); });
    assert.ok(v.by('from-google-delete-702'));
    assert.equal(Boolean(v.by('from-google-delete-701')), false);
    assert.match(v.text(), /Metrics 702/);
  } finally { await v.close(); }
});

test('D6320: Calendar proposals and their open dialog disappear while the next venture loads', async () => {
  const pending = Promise.withResolvers();
  const calendar = (id, title) => ({ proposals: [{ id, title, date: '2026-10-21', kind: 'board_meeting' }] });
  const api = { growRead: (project) => (project === A ? Promise.resolve(calendar(1, 'Board A')) : pending.promise) };
  const forProject = (projectId) => h(DurableFromGoogle, { projectId, api });
  const v = await mount(forProject(A));
  try {
    assert.match(v.text('grow-calendar-proposal'), /Board A/);
    await v.click('grow-calendar-accept');
    assert.ok(v.by('grow-calendar-decide'));
    await v.render(forProject(B));
    assert.equal(Boolean(v.by('grow-calendar-decide')), false);
    assert.equal(Boolean(v.by('grow-calendar-accept')), false);
    assert.equal(Boolean(v.by('grow-calendar-dismiss')), false);
    assert.doesNotMatch(v.text(), /Board A/);
    await act(async () => { pending.resolve(calendar(2, 'Board B')); });
    assert.match(v.text('grow-calendar-proposal'), /Board B/);
  } finally { await v.close(); }
});

test('D6320: Mercury drops an error and pending state on switch and ignores the previous completion', async (t) => {
  const pending = Promise.withResolvers();
  let first = true;
  t.mock.method(cyclesWrite.grow, 'syncMercury', () => {
    if (!first) return pending.promise;
    first = false;
    return Promise.reject(new Error('Mercury read refused for A'));
  });
  const reloaded = [];
  const forProject = (projectId) => h(GrowFromMercury, {
    projectId,
    slug: 'durable-company-building',
    part: { state: 'not_recorded', can_sync: true },
    reload: () => reloaded.push(projectId),
  });
  const v = await mount(forProject(A));
  try {
    await v.click('mercury-sync');
    assert.match(v.text('mercury-error'), /refused for A/);
    await v.render(forProject(B));
    assert.equal(Boolean(v.by('mercury-error')), false);
    await v.render(forProject(A));
    await v.click('mercury-sync');
    assert.equal(v.disabled('mercury-sync'), true);
    await v.render(forProject(B));
    assert.equal(v.disabled('mercury-sync'), false);
    await act(async () => { pending.resolve({ ok: true }); });
    assert.deepEqual(reloaded, []);
    assert.equal(Boolean(v.by('mercury-error')), false);
  } finally { await v.close(); }
});

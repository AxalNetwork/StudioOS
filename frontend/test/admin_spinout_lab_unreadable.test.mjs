/**
 * #1742 (a #1439 leftover) — the Admin Console's Spin-Out Lab says
 * "Unreadable" when its read fails, as every other admin console has since
 * D648, never its empty state.
 *
 * `AdminSpinoutLab` reads the applications and the participants in one load.
 * Each read that fails turns its own section into `ConsoleUnreadable`
 * ("… could not be read. This is not a sign that there are none.", with Try
 * again); a read that answers with no rows keeps the empty state it had.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_spinout_lab_unreadable.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import AdminSpinoutLab from '../src/pages/admin/AdminSpinoutLab.jsx';

const h = React.createElement;
const ORIGINAL = { ...api };
const fail = () => Promise.reject(new Error('read failed'));
const UNREADABLE = /could not be read\. This is not a sign that there are none\.\s*Try again/;

async function mount(answers) {
  const calls = [];
  api.adminSpinoutApplications = (...a) => { calls.push('applications'); return answers.applications(...a); };
  api.adminSpinoutParticipants = (...a) => { calls.push('participants'); return answers.participants(...a); };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, null, h(AdminSpinoutLab))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, settle, text: () => text(container).replace(/\s+/g, ' '),
    async click(id) { await act(async () => { await pr(by(id)).onClick?.({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); Object.assign(api, ORIGINAL); },
  };
}

test('a failed applications read says Unreadable, not "No applications yet."', async () => {
  const m = await mount({ applications: fail, participants: async () => ({ participants: [], catalog: [] }) });
  try {
    assert.match(m.text(), /The applications could not be read\. This is not a sign that there are none\./);
    assert.match(m.text(), UNREADABLE);
    assert.doesNotMatch(m.text(), /No applications yet\./, 'a failed read is not an empty queue');
    assert.ok(m.by('admin-console-unreadable'));
    // Try again reads both again.
    const before = m.calls.length;
    await m.click('admin-console-retry');
    assert.deepEqual(m.calls.slice(before).sort(), ['applications', 'participants']);
  } finally { await m.unmount(); }
});

test('a failed participants read says Unreadable on Participants, not "No admitted founders yet"', async () => {
  const m = await mount({ applications: async () => ({ applications: [] }), participants: fail });
  try {
    assert.match(m.text(), /No applications yet\./, 'the applications read answered, so its empty state stands');
    await m.click('tab-participants');
    assert.match(m.text(), /The participants could not be read\. This is not a sign that there are none\./);
    assert.doesNotMatch(m.text(), /No admitted founders yet/);
  } finally { await m.unmount(); }
});

test('reads that answer with no rows keep the empty states', async () => {
  const m = await mount({ applications: async () => ({ applications: [] }), participants: async () => ({ participants: [], catalog: [] }) });
  try {
    assert.match(m.text(), /No applications yet\./);
    assert.doesNotMatch(m.text(), /could not be read/);
    await m.click('tab-participants');
    assert.match(m.text(), /No admitted founders yet — accept an application to get started\./);
    assert.doesNotMatch(m.text(), /could not be read/);
  } finally { await m.unmount(); }
});

test('a read that recovers on Try again draws its rows', async () => {
  let first = true;
  const m = await mount({
    applications: () => (first ? (first = false, fail()) : Promise.resolve({ applications: [] })),
    participants: async () => ({ participants: [], catalog: [] }),
  });
  try {
    assert.match(m.text(), UNREADABLE);
    await m.click('admin-console-retry');
    assert.doesNotMatch(m.text(), /could not be read/);
    assert.match(m.text(), /No applications yet\./);
  } finally { await m.unmount(); }
});

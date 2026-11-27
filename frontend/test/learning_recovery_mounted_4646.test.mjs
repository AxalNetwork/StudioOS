/**
 * #4646 — the exercise panel, mounted: unsent text comes back after the panel is closed and opened again, says where it
 * is kept, is kept per learner, and goes once the server has the answer.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_recovery_mounted_4646.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import ExercisePanel from '../src/pages/learning/ExercisePanel.jsx';
import { draftKey, loadDraft } from '../src/pages/learning/learningDrafts.js';

const h = React.createElement;
const EXERCISE = { uid: 'ex-9001', title: 'Synthetic exercise', instructions: 'Write something.', submission_kind: 'text', checklist: null, status: 'published', answer_max_chars: 500 };
const CHECKLIST = { ...EXERCISE, uid: 'ex-9002', submission_kind: 'checklist', checklist: ['First', 'Second', 'Third'] };
/** One device's storage, kept across the panel being closed and opened again (each mount would otherwise start empty). */
const DEVICE = new Map();
const deviceStorage = {
  getItem: (k) => (DEVICE.has(k) ? DEVICE.get(k) : null), setItem: (k, v) => { DEVICE.set(k, String(v)); }, removeItem: (k) => { DEVICE.delete(k); },
  key: (i) => [...DEVICE.keys()][i] ?? null, get length() { return DEVICE.size; },
};
const response = (body) => ({ ok: true, status: 200, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

async function mount(user, props) {
  const restore = installDocument();
  globalThis.localStorage = deviceStorage;
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async (u) => (String(u) === '/api/auth/me' ? response(user) : new Promise(() => {}));
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const tree = (p) => h(MemoryRouter, null, h(AuthProvider, null, h(ExercisePanel, p)));
  await act(async () => root.render(tree(props)));
  const flush = async (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const propsOf = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => propsOf(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : (n?.childNodes || []).map(text).join('') || n?.textContent || '');
  return {
    byId, propsOf, text: (id) => text(byId(id)), flush,
    async type(id, value) { await act(async () => { propsOf(byId(id)).onChange({ target: { value } }); }); },
    async rerender(p) { await act(async () => root.render(tree(p))); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; localStorage.removeItem('user'); restore(); },
  };
}
const USER = { id: 9001, role: 'founder', name: 'Synthetic Learner', email: 'learner@example.test' };
const OTHER = { id: 9002, role: 'founder', name: 'Another Learner', email: 'other@example.test' };

test('text typed and not sent is kept on the device, comes back, and says where it is', async () => {
  const key = draftKey({ userId: 9001, kind: 'exercise', uid: 'ex-9001' });
  let view = await mount(USER, { status: 'ready', exercise: EXERCISE, submission: null, onSubmit() {} });
  try {
    assert.equal(view.byId('exercise-draft-state'), undefined, 'nothing saved yet, nothing said');
    await view.type('input-exercise-answer', 'My unsent answer');
    await view.flush(600);
    assert.equal(loadDraft(localStorage, key)?.value.text, 'My unsent answer');
    assert.match(view.text('exercise-draft-state'), /Saved on this device/);
    assert.match(view.text('exercise-draft-state'), /not sent until you submit/);
  } finally { await view.close(); }
  // The tab is reopened: the same learner, the same exercise.
  view = await mount(USER, { status: 'ready', exercise: EXERCISE, submission: null, onSubmit() {} });
  try {
    assert.equal(view.propsOf(view.byId('input-exercise-answer')).value, 'My unsent answer');
    assert.match(view.text('exercise-draft-state'), /Restored your unsent work from this device/);
  } finally { await view.close(); }
});

test('another learner on the same device sees none of it', async () => {
  const view = await mount(OTHER, { status: 'ready', exercise: EXERCISE, submission: null, onSubmit() {} });
  try {
    assert.equal(view.propsOf(view.byId('input-exercise-answer')).value, '');
    assert.equal(view.byId('exercise-draft-state'), undefined);
  } finally { await view.close(); }
});

test('a checklist\'s first tick is kept, and comes back', async () => {
  DEVICE.clear();
  let view = await mount(USER, { status: 'ready', exercise: CHECKLIST, submission: null, onSubmit() {} });
  try {
    await act(async () => { view.propsOf(view.byId('input-exercise-check-0')).onChange(); });
    await view.flush(600);
    assert.deepEqual(loadDraft(localStorage, draftKey({ userId: 9001, kind: 'exercise', uid: 'ex-9002' }))?.value, { checked: [0] });
  } finally { await view.close(); }
  view = await mount(USER, { status: 'ready', exercise: CHECKLIST, submission: null, onSubmit() {} });
  try {
    assert.equal(view.propsOf(view.byId('input-exercise-check-0')).checked, true);
    assert.equal(view.propsOf(view.byId('input-exercise-check-1')).checked, false);
  } finally { await view.close(); }
});

test('once the server has an answer the copy on the device goes', async () => {
  DEVICE.clear();
  const key = draftKey({ userId: 9001, kind: 'exercise', uid: 'ex-9001' });
  const view = await mount(USER, { status: 'ready', exercise: EXERCISE, submission: null, onSubmit() {} });
  try {
    await view.type('input-exercise-answer', 'Sent answer');
    await view.flush(600);
    assert.ok(loadDraft(localStorage, key));
    await view.rerender({ status: 'ready', exercise: EXERCISE, submission: { uid: 'sub-1', status: 'submitted', body: 'Sent answer', submitted_at: '2026-11-07T10:00:00Z' }, onSubmit() {} });
    assert.equal(loadDraft(localStorage, key), null, 'a new submission removes it');
  } finally { await view.close(); }
});

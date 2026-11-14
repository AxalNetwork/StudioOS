/**
 * #5356 part 2 (D5356) — an exam attempt's choices are saved to the server after the device write, the page says
 * truthfully whether the server has them, and a resume opens with the newer of the server's and the device's copy.
 * Mounted: a second device restores the first device's choices; a stale save is sent once more at the server's
 * revision; offline then reconnect sends what failed; a closed attempt stops saving.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_exam_server_draft_5356.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import ExamFlow from '../src/pages/learning/ExamFlow.jsx';
import { SERVER_WORDS, indexesToKeys, startFrom } from '../src/pages/learning/examServerDraft.js';
import { draftKey, saveDraft } from '../src/pages/learning/learningDrafts.js';

const h = React.createElement;
const Q1 = { uid: 'q1', prompt: 'Who leads?', kind: 'single', options: ['Founder', 'Lead investor', 'Lawyer'], position: 0 };
const Q2 = { uid: 'q2', prompt: 'Which are terms?', kind: 'multiple', options: ['Valuation', 'Weather', 'Pro rata'], position: 1 };
const EXAM = { uid: 'x1', title: 'Term sheets', question_count: 2, pass_mark_percent: 70, time_limit_minutes: null, status: 'published' };
const USER = { id: 9001, role: 'founder', name: 'Synthetic Learner', email: 'learner@example.test' };
const attemptOf = (draft = null) => ({ uid: 'a1', started_at: '2026-11-10T10:00:00.000Z', deadline: null, questions: [Q1, Q2], draft });

test('indexes become keys for this attempt\'s questions only; a resume opens with the newer copy', () => {
  assert.deepEqual(indexesToKeys([Q1, Q2], { q1: [1], q2: [0, 2], nope: [0] }), { q1: ['1'], q2: ['0', '2'] });
  assert.deepEqual(indexesToKeys([Q1], { q1: [0, 2] }), { q1: ['0'] }, 'a single-choice question keeps one');
  assert.deepEqual(indexesToKeys([Q1], { q1: [7] }), {}, 'an option that is not there is dropped');
  const server = { answers: { q1: [1] }, revision: 3, saved_at: '2026-11-10T10:05:00.000Z' };
  const older = Date.parse('2026-11-10T10:04:00.000Z'); const newer = Date.parse('2026-11-10T10:06:00.000Z');
  assert.deepEqual(startFrom({ device: { q1: ['2'] }, deviceAt: older, server, questions: [Q1] }), { answers: { q1: ['1'] }, source: 'server' });
  assert.deepEqual(startFrom({ device: { q1: ['2'] }, deviceAt: newer, server, questions: [Q1] }), { answers: { q1: ['2'] }, source: 'device' });
  assert.deepEqual(startFrom({ device: {}, deviceAt: null, server, questions: [Q1] }).source, 'server', 'a second device has nothing of its own');
  assert.deepEqual(startFrom({ device: {}, deviceAt: null, server: null, questions: [Q1] }), { answers: {}, source: null });
});

async function mount({ attempt = attemptOf(), save, seedDevice = null } = {}) {
  const restore = installDocument();
  const DEVICE = new Map();
  globalThis.localStorage = {
    getItem: (k) => (DEVICE.has(k) ? DEVICE.get(k) : null), setItem: (k, v) => { DEVICE.set(k, String(v)); }, removeItem: (k) => { DEVICE.delete(k); },
    key: (i) => [...DEVICE.keys()][i] ?? null, get length() { return DEVICE.size; },
  };
  const listeners = new Map();
  const realAdd = window.addEventListener.bind(window); const realRemove = window.removeEventListener.bind(window);
  window.addEventListener = (t, f, o) => { if (t === 'online') listeners.set(f, f); realAdd(t, f, o); };
  window.removeEventListener = (t, f, o) => { listeners.delete(f); realRemove(t, f, o); };
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async (u) => (String(u) === '/api/auth/me' ? { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => USER, text: async () => JSON.stringify(USER) } : new Promise(() => {}));
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(USER));
  if (seedDevice) saveDraft(localStorage, draftKey({ userId: USER.id, kind: 'exam', uid: EXAM.uid, attempt: attempt.uid }), seedDevice.value, seedDevice.at);
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(AuthProvider, null, h(ExamFlow, { status: 'ready', exam: EXAM, attempts: [], attempt, now: Date.parse('2026-11-10T10:10:00Z'), onSubmit() {}, saveDraft: save })))));
  const flush = async (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const propsOf = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => propsOf(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : (n?.childNodes || []).map(text).join('') || n?.textContent || '');
  const inputs = () => nodes().filter((n) => n.tagName === 'INPUT');
  return {
    byId, propsOf, flush, text: (id) => text(byId(id)), inputs,
    async pick(i) { await act(async () => { propsOf(inputs()[i]).onChange({ target: {} }); }); },
    async online() { await act(async () => { for (const f of listeners.values()) f(); }); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; window.addEventListener = realAdd; window.removeEventListener = realRemove; restore(); },
  };
}

test('a choice is saved to the server after the device write, one revision up, and the page says so', async () => {
  const calls = [];
  const v = await mount({ save: async (...a) => { calls.push(a); return { revision: a[3] }; } });
  try {
    await v.flush(1300);
    assert.equal(calls.length, 0, 'opening sends nothing, even after the hold');
    await v.pick(1);
    await v.flush(1300);
    assert.deepEqual(calls.at(-1), ['x1', 'a1', { q1: [1] }, 1]);
    assert.equal(v.propsOf(v.byId('exam-server-state'))['data-state'], 'saved');
    assert.equal(v.text('exam-server-state'), SERVER_WORDS.saved);
    await v.pick(2);
    await v.flush(1300);
    assert.equal(calls.at(-1)[3], 2, 'each save one revision higher');
  } finally { await v.close(); }
});

test('a second device opens with the first device\'s choices from the server', async () => {
  const v = await mount({ attempt: attemptOf({ answers: { q1: [2] }, revision: 5, saved_at: '2026-11-10T10:05:00.000Z' }), save: async () => ({}) });
  try {
    assert.equal(v.propsOf(v.inputs()[2]).checked, true, 'the server\'s choice is checked');
    assert.equal(v.propsOf(v.inputs()[0]).checked, false);
  } finally { await v.close(); }
  // The same attempt with a newer copy on this device keeps the device's.
  const w = await mount({ attempt: attemptOf({ answers: { q1: [2] }, revision: 5, saved_at: '2026-11-10T10:05:00.000Z' }), save: async () => ({}), seedDevice: { value: { q1: ['0'] }, at: Date.parse('2026-11-10T10:07:00.000Z') } });
  try { assert.equal(w.propsOf(w.inputs()[0]).checked, true); } finally { await w.close(); }
});

test('a stale save is sent once more at the server\'s revision; another tab cannot loop it', async () => {
  const calls = [];
  const stale = Object.assign(new Error('newer'), { status: 409, code: 'stale_revision', data: { draft: { revision: 7 } } });
  const v = await mount({ attempt: attemptOf({ answers: {}, revision: 2, saved_at: null }), save: async (...a) => { calls.push(a[3]); if (calls.length === 1) throw stale; return {}; } });
  try {
    await v.pick(1);
    await v.flush(1300);
    assert.deepEqual(calls, [3, 8], 'from the attempt\'s revision, then above the server\'s');
    assert.equal(v.propsOf(v.byId('exam-server-state'))['data-state'], 'saved');
  } finally { await v.close(); }
  const twice = [];
  const w = await mount({ save: async (...a) => { twice.push(a[3]); throw stale; } });
  try {
    await w.pick(1);
    await w.flush(1300);
    assert.equal(twice.length, 2, 'one retry, not a loop');
    assert.equal(w.propsOf(w.byId('exam-server-state'))['data-state'], 'failed');
  } finally { await w.close(); }
});

test('offline then reconnect sends what failed; a closed attempt stops saving and says so', async () => {
  let up = false; const calls = [];
  const v = await mount({ save: async (...a) => { calls.push(a); if (!up) throw new TypeError('Failed to fetch'); return {}; } });
  try {
    await v.pick(1);
    await v.flush(1300);
    assert.equal(v.propsOf(v.byId('exam-server-state'))['data-state'], 'failed');
    assert.equal(v.text('exam-server-state'), SERVER_WORDS.failed, 'not saved, still on this device');
    up = true;
    await v.online();
    await v.flush();
    assert.equal(v.propsOf(v.byId('exam-server-state'))['data-state'], 'saved');
    assert.deepEqual(calls.at(-1)[2], { q1: [1] });
  } finally { await v.close(); }
  const closed = Object.assign(new Error('closed'), { status: 409, code: 'already_submitted' });
  const sent = [];
  const w = await mount({ save: async (...a) => { sent.push(a); throw closed; } });
  try {
    await w.pick(1); await w.flush(1300);
    await w.pick(2); await w.flush(1300);
    assert.equal(sent.length, 1, 'nothing more is sent to a closed attempt');
    assert.equal(w.text('exam-server-state'), SERVER_WORDS.closed);
  } finally { await w.close(); }
});

/**
 * D1071 (#2941) — VB5, "Word with Eadwyn" on Plan the build: the press and
 * its cost, Eadwyn's wording in lavender beside the rule's plain title, and
 * Keep wording as the item's Save (D1066's PATCH with the wording's id).
 *
 * The model is pure; the panel is mounted against the Worker's shapes
 * (D1065's plan read, D1071's wording). Every item and venture is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_plan_word_d1071.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { PlanWording } from '../src/pages/cycles/BuildPlan.jsx';
import { ADD_TOKENS_PATH } from '../src/lib/aiTokens.js';
import {
  AI_OFF_LINE, DISCARD, KEEP, WORDING_TAG, WORD_COST, WORD_LINE, WORD_READS, wordRefusal, wordingRows,
} from '../src/pages/cycles/buildPlanModel.js';
import { FOUNDER_OPTIONS } from '../src/lib/railOptions/founder.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const F = '11111111-1111-4111-8111-111111111111';
const R = '22222222-2222-4222-8222-222222222222';
const DOOR = '33333333-3333-4333-8333-333333333333';
const DONE = '44444444-4444-4444-8444-444444444444';
const W = '55555555-5555-4555-8555-555555555555';
const PLAN = () => ({
  plan: { uid: 'plan-uid', scope: 'venture', status: 'draft' },
  brief: { problems: [{ key: 'theme-1', label: 'Slow setup' }] },
  modules: {
    'solution-design': [
      { uid: F, kind: 'feature', status: 'proposed', payload: { title: 'Slow setup' }, evidence: [] },
      { uid: R, kind: 'risk', status: 'proposed', payload: { title: 'Test the price objection' }, evidence: [] },
      { uid: DONE, kind: 'feature', status: 'accepted', payload: { title: 'Already decided' }, evidence: [] },
    ],
    'prototype-mvp': [], 'product-roadmap': [], 'company-creation': [],
    'operating-systems': [{ uid: DOOR, kind: 'connect-door', status: 'proposed', payload: { title: 'Connect GitHub (Code)' }, evidence: [] }],
    'founding-team': [],
  },
});
const WORDING = () => ({
  uid: W, removed: 1,
  items: { [F]: { title: 'Set up in a single sitting', description: 'A guided setup a new team finishes alone.' } },
  brief: { summary: 'A setup tool for small teams.' }, lovable_prompt: 'Build a clickable prototype of a guided setup.',
  kept: { brief: null, prompt: null },
});

function handler({ word = () => response({ wording: WORDING() }), wording = null } = {}) {
  return (url, options = {}) => {
    const method = options.method || 'GET';
    if (url.includes('/cycles/build/plan/word') && method === 'POST' && !/\/word\/[^/?]+\//.test(url)) return word(url, options);
    if (url.includes('/cycles/build/plan/word') && method === 'GET') return response({ wording });
    if (/\/word\/[^/?]+\/(keep|discard)/.test(url)) return response({ wording: { ...WORDING(), brief: null } });
    if (url.includes('/cycles/build/plan/items/')) return response({ uid: F, status: 'proposed', payload: {} });
    if (url.includes('/cycles/build/plan?')) return response(PLAN());
    if (url.includes('/ai/me/spend')) return response({ recorded: true, by_task_recorded: true, by_task: [] });
    return response({});
  };
}

async function mounted({ handle = handler() } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => {
    requests.push({ url: String(u), method: options.method || 'GET', headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : null });
    return handle(String(u), options);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(PlanWording, { projectId: 3 }))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props(byId(id)),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const header = (r, name) => r.headers?.[name] ?? r.headers?.get?.(name) ?? null;

test('the rows: pending, worded kinds only, in module order, with the rule\'s title and any wording', () => {
  const rows = wordingRows(PLAN(), WORDING());
  assert.deepEqual(rows.map((r) => [r.uid, r.title, r.module]), [[F, 'Slow setup', 'Solution design'], [R, 'Test the price objection', 'Solution design']]);
  assert.equal(rows[0].words.title, 'Set up in a single sitting');
  assert.equal(rows[1].words, null);
  assert.deepEqual(wordingRows(null, null), []);
  assert.equal(wordRefusal({ status: 402, data: {} }).kind, 'tokens');
  assert.equal(wordRefusal({ status: 403, data: { error: 'assist_off' } }).text, AI_OFF_LINE);
  assert.equal(wordRefusal({ status: 503, data: { detail: 'Eadwyn could not word the plan just now.' } }).text, 'Eadwyn could not word the plan just now.');
});

test('VB5: the press runs under draft:build/plan, and the wording is lavender beside the rule\'s title, not saved', async () => {
  const m = await mounted();
  try {
    assert.match(m.textOf('plan-wording'), new RegExp(WORD_LINE));
    assert.match(m.textOf('plan-wording'), new RegExp(WORD_READS));
    assert.match(m.textOf('plan-wording'), new RegExp(WORD_COST));
    assert.ok(m.has('plan-word-estimate'), 'its cost is shown before the press');
    assert.ok(!m.has(`plan-wording-${F}`), 'no wording before the press');
    assert.ok(!m.requests.some((r) => r.method === 'POST'), 'nothing runs on its own');
    await m.click('plan-word');
    const press = m.requests.find((r) => r.method === 'POST' && r.url.includes('/cycles/build/plan/word'));
    assert.ok(press);
    assert.equal(decodeURIComponent(header(press, 'X-Rail-Option')), 'draft:build/plan');
    const card = m.textOf(`plan-wording-${F}`);
    assert.match(card, new RegExp(WORDING_TAG));
    assert.match(card, /Set up in a single sitting/);
    assert.match(card, /A guided setup a new team finishes alone\./);
    assert.equal(m.textOf(`plan-wording-rule-${F}`), 'Rule’s title: Slow setup');
    assert.match(m.props(`plan-wording-${F}`).className, /bg-axal-lavender/);
    assert.equal(m.textOf(`plan-wording-keep-${F}`), KEEP);
    assert.equal(m.textOf(`plan-wording-discard-${F}`), DISCARD);
    // The risk has no wording: its rule's title stands, plain.
    assert.equal(m.textOf(`plan-wording-item-${R}`), 'Solution designTest the price objection');
    assert.ok(!m.has(`plan-wording-item-${DOOR}`), 'a door is never worded');
    assert.ok(!m.has(`plan-wording-item-${DONE}`), 'a decided item is not offered');
    assert.match(m.textOf('plan-wording-brief'), /A setup tool for small teams/);
    assert.match(m.textOf('plan-wording-prompt'), /Build a clickable prototype/);
    assert.match(m.textOf('plan-wording-removed'), /One worded field held a number/);
  } finally { await m.close(); }
});

test('Keep wording is the item\'s Save, with the wording\'s id; Discard and the brief\'s Keep go to the wording row', async () => {
  const m = await mounted({ handle: handler({ wording: WORDING() }) });
  try {
    assert.ok(m.has(`plan-wording-${F}`), 'a pending wording is read back');
    await m.click(`plan-wording-keep-${F}`);
    const save = m.requests.find((r) => r.method === 'PATCH');
    assert.ok(save.url.endsWith(`/cycles/build/plan/items/${F}`));
    assert.deepEqual(save.body, { wording: W });
    await m.click(`plan-wording-discard-${F}`);
    const discard = m.requests.find((r) => r.url.includes(`/word/${W}/discard`));
    assert.deepEqual(discard.body, { target: F });
    assert.match(discard.url, /project=3/);
    await m.click('plan-wording-keep-brief');
    assert.deepEqual(m.requests.find((r) => r.url.includes(`/word/${W}/keep`)).body, { target: 'brief' });
  } finally { await m.close(); }
});

test('refusals: Manual mode and an empty purse say so, with a way to top up; nothing else changes', async () => {
  let m = await mounted({ handle: handler({ word: () => response({ code: 'assist_off', error: 'assist_off', message: 'AI assistance is off on this page.' }, 403) }) });
  try {
    await m.click('plan-word');
    assert.equal(m.textOf('plan-word-refused-off').startsWith(AI_OFF_LINE), true);
    assert.ok(!m.has(`plan-wording-${F}`));
  } finally { await m.close(); }
  m = await mounted({ handle: handler({ word: () => response({ code: 'budget_user_month', error: 'budget_user_month' }, 402) }) });
  try {
    await m.click('plan-word');
    assert.ok(m.has('plan-word-refused-tokens'));
    assert.equal(m.props('plan-word-topup').href, ADD_TOKENS_PATH);
  } finally { await m.close(); }
});

test('the rail option is listed where it lives, and Eadwyn is never called an advisor', () => {
  const o = FOUNDER_OPTIONS.find((x) => x.key === 'draft:build/plan');
  assert.deepEqual([o.page, o.route, o.label, o.handler], ['Founder · Build', '/build/plan', 'Word with Eadwyn', 'draft']);
  const page = read('frontend/src/pages/cycles/BuildPlan.jsx');
  assert.ok(page.includes("useRailOption(running ? 'draft:build/plan' : null"));
  const words = page + read('frontend/src/pages/cycles/buildPlanModel.js');
  assert.doesNotMatch(words, /\b(advisor|advice|recommendation|fiduciary)\b/i);
  const matrix = JSON.parse(read('cloudflare-worker/src/services/ai/railMatrix.json'));
  assert.ok(JSON.stringify(matrix).includes('draft:build/plan'), 'the parity entry is in the Worker\'s matrix');
});

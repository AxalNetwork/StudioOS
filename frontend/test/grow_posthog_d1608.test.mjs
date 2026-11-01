// D1608 (#3731, #2409 part 6) — PostHog in Grow: product retention by
// first-seen week labelled apart, survey scores, and "Add as customer
// feedback" with no respondent identity. The API is injected; every value is
// invented.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_posthog_d1608.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { APART_LINE, ImprovementPosthog, NO_IDENTITY, RETENTION_TITLE, RevenuePosthog, cohortLine, surveyLine } from '../src/pages/cycles/GrowPosthog.jsx';

const h = React.createElement;
const LINK = { linked: true, active: true, mine: true, uid: 'int-fixture' };

async function mounted(el) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  document.getElementById = () => null;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, el)));
  await act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => pr(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  return {
    all, by: (id) => all(id)[0], say: (n) => text(n), text: () => text(document.body),
    async click(n) { await act(async () => pr(n).onClick?.()); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}
const fakeApi = (read) => { const calls = []; return { calls, fromPosthog: async (...a) => { calls.push(['from', ...a]); return read; }, sync: async (...a) => { calls.push(['sync', ...a]); }, accept: async (...a) => { calls.push(['accept', ...a]); }, dismiss: async () => {}, deleteFact: async () => {} }; };

test('the words: a week PostHog gave no count for is a dash, never 0%; a survey score is PostHog\'s', () => {
  assert.equal(cohortLine({ week: '2026-10-05', size: 180, pct: [38.9, null] }), '2026-10-05 · 180 people · W1 38.9% · W2 —');
  assert.equal(surveyLine({ responses: 46, nps: 31 }), '46 responses · NPS 31');
  assert.equal(surveyLine({ responses: null, average: 4.2 }), 'Responses not recorded · Average 4.2');
  assert.equal(surveyLine({ responses: 1 }), '1 response');
});

test('Revenue and traction: product retention under its own title, apart from revenue retention', async () => {
  const read = { ok: true, link: LINK, tracked: [], proposals: [], facts: [{ id: 4, kind: 'metric', fact_key: 'retention:abc', period: '2026-10-31', label: 'Week-4 retention', as_of: '2026-10-31', data: { cohorts: [{ week: '2026-09-28', size: 200, pct: [42, 31] }] } }] };
  const api = fakeApi(read);
  const ui = await mounted(h(RevenuePosthog, { projectId: 1, api }));
  try {
    assert.ok(ui.text().includes(RETENTION_TITLE));
    assert.ok(ui.text().includes(APART_LINE));
    assert.deepEqual(ui.all('posthog-cohort').map((n) => ui.say(n)), ['2026-09-28 · 200 people · W1 42% · W2 31%']);
    await ui.click(ui.by('posthog-sync'));
    assert.deepEqual(api.calls.find((c) => c[0] === 'sync'), ['sync', 'grow', 1]);
  } finally { await ui.close(); }
});

test('Product improvement: survey figures, and an answer added as customer feedback, with no identity', async () => {
  const read = { ok: true, link: LINK, tracked: [], facts: [{ id: 5, kind: 'survey_stats', label: 'Team boards', period: '2026-10', as_of: '2026-10-31', data: { responses: 46, nps: 31 } }],
    proposals: [{ id: 9, kind: 'survey_feedback', payload: { answer: 'We’d pay if it synced with our calendar.' } }] };
  const api = fakeApi(read);
  const ui = await mounted(h(ImprovementPosthog, { projectId: 1, api }));
  try {
    assert.equal(ui.say(ui.by('posthog-survey-line')), '46 responses · NPS 31');
    assert.ok(ui.text().includes(NO_IDENTITY));
    await ui.click(ui.by('posthog-accept'));
    assert.deepEqual(api.calls.find((c) => c[0] === 'accept'), ['accept', 'grow', 1, 9, {}], 'nothing about the respondent is sent');
  } finally { await ui.close(); }
});

test('wiring: Revenue and traction and Product improvement mount their PostHog parts', () => {
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.ok(route.includes('<RevenuePosthog projectId={ctx.projectId} />'));
  assert.ok(route.includes('<ImprovementPosthog projectId={ctx.projectId} />'));
});

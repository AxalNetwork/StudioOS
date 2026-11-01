// D1605 (#3731, #2409 part 3) — PostHog in Validate: experiment results and
// survey counts, "Link this experiment to a hypothesis" with the founder's
// hypothesis and direction, the web overview beside the waitlist, signals
// from marked questions, and Mark survey questions. The API is injected;
// every value is invented.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_posthog_d1605.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { BESIDE_WAITLIST, MARK_LINE, ValidateDemandPosthog, ValidateExperimentsPosthog, experimentLines } from '../src/pages/cycles/ValidatePosthog.jsx';

const h = React.createElement;
const LINK = { linked: true, active: true, mine: true, uid: 'int-fixture' };
const EXPERIMENTS = {
  ok: true, module: 'experiments', label: 'Experiments and evidence', link: LINK, tracked: [],
  facts: [
    { id: 1, kind: 'experiment_result', label: 'Shorter onboarding', as_of: '2026-10-30', data: { variants: [{ key: 'test', exposure: 1800, uplift: 3.1 }], significant: true } },
    { id: 2, kind: 'survey_stats', label: 'Would you pay for team boards?', as_of: '2026-10-30', data: { responses: 46, shown: 400 } },
  ],
  proposals: [{ id: 9, kind: 'experiment_evidence', payload: { title: 'Shorter onboarding' } }],
};
const DEMAND = {
  ok: true, module: 'demand_signals', label: 'Demand and urgency signals', link: LINK, tracked: [],
  facts: [{ id: 3, kind: 'web_overview', as_of: '2026-10-30', data: { visitors: 820, sessions: 1104 } }],
  proposals: [{ id: 4, kind: 'survey_signal', payload: { answer: 'We’d pay if it synced with our calendar.', mark: 'would_pay', at: '2026-10-21' } }],
};

function fakeApi(read) {
  const calls = [];
  const log = (name, fn) => async (...a) => { calls.push([name, ...a]); return fn(...a); };
  return {
    calls,
    fromPosthog: log('from', async () => read),
    sync: log('sync', async () => ({ ok: true })),
    accept: log('accept', async () => ({ ok: true })),
    dismiss: log('dismiss', async () => ({ ok: true })),
    deleteFact: log('deleteFact', async () => ({ ok: true })),
    surveys: log('surveys', async () => ({ surveys: [{ id: 'svy-1', name: 'Team boards', questions: [{ id: 'q1', index: 0, text: 'Would you pay?', mark: null }] }] })),
    markQuestion: log('mark', async () => ({ ok: true })),
  };
}

async function mounted(el) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  document.getElementById = () => null;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, el)));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => pr(n)['data-testid'] === id);
  const by = (id) => all(id)[0];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  return {
    by, all, pr, say: (n) => text(typeof n === 'string' ? by(n) : n), text: () => text(document.body),
    async click(n) { const x = typeof n === 'string' ? by(n) : n; assert.ok(x, `no ${n}`); assert.ok(!pr(x).disabled, `${n} is enabled`); await act(async () => pr(x).onClick?.({ preventDefault() {} })); await flush(); },
    async choose(n, value) { const x = typeof n === 'string' ? by(n) : n; await act(async () => pr(x).onChange?.({ target: { value } })); await flush(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('experiment lines: exposures and uplift, survey counts; nothing read says so, never 0', () => {
  assert.deepEqual(experimentLines(EXPERIMENTS.facts[0]), ['Variant test: 1,800 exposures, +3.1']);
  assert.deepEqual(experimentLines(EXPERIMENTS.facts[1]), ['46 responses of 400 shown']);
  assert.deepEqual(experimentLines({ kind: 'experiment_result', data: {} }), ['Results not recorded']);
  assert.deepEqual(experimentLines({ kind: 'survey_stats', data: {} }), ['Responses not recorded']);
});

test('Link this experiment: Accept is off until the founder chooses the hypothesis and the direction; then both are sent', async () => {
  const api = fakeApi(EXPERIMENTS);
  const ui = await mounted(h(ValidateExperimentsPosthog, { projectId: 1, api, loadHypotheses: async () => [{ id: 5, code: 'H2', claim: 'Short onboarding raises activation' }] }));
  try {
    assert.equal(ui.all('posthog-experiment-fact').length, 2);
    assert.ok(ui.text().includes('Significant'));
    assert.ok(ui.pr(ui.by('posthog-accept')).disabled, 'nothing chosen');
    await ui.choose('posthog-hypothesis', '5');
    assert.ok(ui.pr(ui.by('posthog-accept')).disabled, 'the direction is never guessed');
    await ui.click(ui.all('posthog-direction').find((n) => ui.pr(n)['data-direction'] === 'contradicts'));
    await ui.click('posthog-accept');
    assert.deepEqual(api.calls.filter((c) => c[0] === 'accept'), [['accept', 'validate', 1, 9, { hypothesis_id: 5, direction: 'contradicts' }]]);
    await ui.click('posthog-sync');
    assert.deepEqual(api.calls.filter((c) => c[0] === 'sync'), [['sync', 'validate', 1]]);
  } finally { await ui.close(); }
});

test('Demand: the web overview sits beside the waitlist; a marked answer is added as a signal to confirm; questions are marked in a dialog', async () => {
  const api = fakeApi(DEMAND);
  const ui = await mounted(h(ValidateDemandPosthog, { projectId: 1, api }));
  try {
    assert.equal(ui.say('posthog-overview-line'), '820 visitors · 1,104 sessions');
    assert.ok(ui.text().includes(BESIDE_WAITLIST));
    assert.ok(ui.say('posthog-signal-proposal').includes('no respondent identity'));
    await ui.click('posthog-accept');
    assert.deepEqual(api.calls.filter((c) => c[0] === 'accept'), [['accept', 'validate', 1, 4, {}]]);
    await ui.click('posthog-mark-open');
    assert.ok(ui.by('posthog-mark-dialog'), 'an in-page dialog');
    assert.ok(ui.text().includes(MARK_LINE));
    assert.deepEqual(api.calls.filter((c) => c[0] === 'mark'), [], 'nothing marked before a choice');
    await ui.choose('posthog-mark', 'would_pay');
    assert.deepEqual(api.calls.filter((c) => c[0] === 'mark'), [['mark', 1, 'svy-1', 'q1', 'would_pay']]);
    await ui.choose('posthog-mark', '');
    assert.deepEqual(api.calls.filter((c) => c[0] === 'mark').at(-1), ['mark', 1, 'svy-1', 'q1', null], 'Not marked clears it');
  } finally { await ui.close(); }
});

test('a teammate reads the figures but never links, accepts or marks', async () => {
  const read = { ...EXPERIMENTS, link: { linked: true, active: true, mine: false } };
  const ui = await mounted(h(ValidateExperimentsPosthog, { projectId: 1, api: fakeApi(read), loadHypotheses: async () => [] }));
  try {
    assert.equal(ui.all('posthog-experiment-fact').length, 2);
    assert.equal(ui.by('posthog-accept'), undefined);
    assert.equal(ui.by('posthog-hypothesis'), undefined);
    assert.equal(ui.by('posthog-sync'), undefined);
  } finally { await ui.close(); }
});

test('wiring: Experiments and Demand mount their PostHog parts; the client reaches the sync and marks routes', () => {
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.match(route, /<ValidateDemandPosthog projectId=\{ctx\.projectId\} \/>/);
  assert.match(route, /<ValidateExperimentsPosthog projectId=\{ctx\.projectId\}/);
  const client = readFileSync(new URL('../src/lib/api/posthog.js', import.meta.url), 'utf8');
  for (const p of ['/posthog/sync', '/cycles/validate/posthog/surveys?project=', '/marks']) assert.ok(client.includes(p), p);
});

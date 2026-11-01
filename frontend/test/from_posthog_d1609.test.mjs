// D1609 (#3731, #2409 part 2) — a module's "From PostHog" part: tracked
// metrics as figures or a dash with its reason (never 0), Track a metric
// behind an in-page dialog, Stop tracking and Delete asked first, proposals
// with Accept and Dismiss for the owner only, and the states. No test reaches
// the network: the API is injected. Every value is invented.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/from_posthog_d1609.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import FromPosthog from '../src/pages/cycles/FromPosthog.jsx';
import {
  DELETE_LINE, DISCONNECTED, NOT_LINKED, NOT_MINE, NO_METRICS, TRACK_LINE, UNTRACK_LINE, changeText, figureText, matchInsights, metricRow, partState, refusalOf,
} from '../src/pages/cycles/fromPosthogModel.js';

const h = React.createElement;
const READ = {
  ok: true, module: 'revenue_and_traction', label: 'Revenue and traction',
  link: { linked: true, active: true, mine: true, uid: 'int-fixture' },
  tracked: [
    { uid: 'a'.repeat(32), name: 'Weekly active users', role: 'active_users', role_words: 'Active users', unit: 'count', value: 1240, change_30d: 90, as_of: '2026-10-30', reason: null },
    { uid: 'b'.repeat(32), name: 'Activation', role: 'activation', role_words: 'Activation', unit: 'pct', value: null, change_30d: null, as_of: null, reason: 'Not recorded' },
  ],
  facts: [{ id: 7, kind: 'experiment_result', fact_key: 'experiment:7', label: 'Shorter onboarding', value: 3.1, as_of: '2026-10-30' }],
  proposals: [{ id: 3, kind: 'survey_feedback', payload: { title: 'We would pay if it synced with our calendar.' } }],
};
const INSIGHTS = [{ short_id: 'AbCd1234', name: 'Weekly active users', kind: 'TrendsQuery', last_refresh: '2026-10-20T10:00:00Z' }, { short_id: 'EfGh5678', name: 'Signup funnel', kind: 'FunnelsQuery' }];

function fakeApi({ read = async () => READ, insights = async () => ({ insights: INSIGHTS }), track = async () => ({ ok: true }) } = {}) {
  const calls = [];
  const log = (name, fn) => async (...a) => { calls.push([name, ...a]); return fn(...a); };
  return {
    calls,
    fromPosthog: log('from', read),
    insights: log('insights', insights),
    track: log('track', track),
    untrack: log('untrack', async () => ({ ok: true })),
    deleteFact: log('deleteFact', async () => ({ ok: true })),
    accept: log('accept', async () => ({ ok: true })),
    dismiss: log('dismiss', async () => ({ ok: true })),
  };
}

async function mounted({ api = fakeApi(), props = {} } = {}) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  document.getElementById = () => null;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(FromPosthog, { section: 'grow', projectId: 1, module: 'revenue_and_traction', api, ...props }))));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => pr(n)['data-testid'] === id);
  const by = (id) => all(id)[0];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  return {
    api, by, all, pr, say: (n) => text(typeof n === 'string' ? by(n) : n), text: () => text(document.body),
    async click(n) { const x = typeof n === 'string' ? by(n) : n; assert.ok(x, `no ${n}`); assert.ok(!pr(x).disabled, `${n} is enabled`); await act(async () => pr(x).onClick?.({ preventDefault() {} })); await flush(); },
    async pick(n) { await act(async () => pr(n).onChange?.({ target: { value: pr(n).value } })); await flush(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('the model: a figure, a change, a dash with its reason; never 0 for a value not read', () => {
  assert.equal(figureText(1240, 'count'), '1,240');
  assert.equal(figureText(31.04, 'pct'), '31%');
  assert.equal(figureText(null, 'count'), null, 'nothing read is not 0');
  assert.equal(figureText(undefined, 'pct'), null);
  assert.equal(changeText(90, 'count'), '+90 in 30 days');
  assert.equal(changeText(-3.1, 'pct'), '−3.1 points in 30 days');
  assert.equal(changeText(null, 'count'), null);
  assert.deepEqual(metricRow(READ.tracked[0]), { name: 'Weekly active users', role: 'Active users', figure: '1,240', reason: null, change: '+90 in 30 days', source: 'From PostHog, as of 2026-10-30' });
  assert.deepEqual(metricRow(READ.tracked[1]), { name: 'Activation', role: 'Activation', figure: null, reason: 'Not recorded', change: null, source: null });
  assert.equal(partState({ link: { linked: false } }), 'not_linked');
  assert.equal(partState({ link: { linked: true, active: false } }), 'disconnected');
  assert.equal(partState(READ), 'ready');
  assert.deepEqual(matchInsights(INSIGHTS, 'funnel').map((i) => i.short_id), ['EfGh5678']);
  assert.equal(refusalOf({ data: { detail: 'Choose what this insight measures.' } }), 'Choose what this insight measures.');
});

test('the part: each tracked metric with its source line or its reason; the owner sees Track and Stop tracking', async () => {
  const ui = await mounted();
  try {
    assert.deepEqual(ui.all('posthog-figure').map((n) => ui.say(n)), ['1,240']);
    assert.deepEqual(ui.all('posthog-reason').map((n) => ui.say(n)), ['— Not recorded']);
    assert.deepEqual(ui.all('posthog-source').map((n) => ui.say(n)), ['From PostHog, as of 2026-10-30']);
    assert.ok(!ui.all('posthog-figure').some((n) => ui.say(n) === '0'), 'never a 0');
    assert.ok(ui.by('posthog-track'));
    assert.equal(ui.all('posthog-untrack').length, 2);
    assert.equal(ui.all('posthog-accept').length, 1);
    assert.equal(ui.by('posthog-sync'), undefined, 'no Sync until a part passes one');
    assert.deepEqual(ui.api.calls, [['from', 'grow', 1, 'revenue_and_traction']]);
  } finally { await ui.close(); }
});

test('Track a metric: an in-page dialog; nothing is sent before an insight and a role are chosen', async () => {
  const ui = await mounted();
  try {
    await ui.click('posthog-track');
    assert.ok(ui.by('posthog-track-dialog'), 'an in-page dialog, never a browser pop-up');
    assert.ok(ui.text().includes(TRACK_LINE));
    assert.deepEqual(ui.api.calls.find((c) => c[0] === 'insights'), ['insights', 'int-fixture', 1]);
    assert.ok(ui.pr(ui.by('posthog-track-save')).disabled, 'nothing chosen yet');
    const [first] = ui.all('posthog-insight');
    await ui.pick(first);
    assert.ok(ui.pr(ui.by('posthog-track-save')).disabled, 'a role is still needed');
    const sessions = ui.all('posthog-role').find((n) => ui.pr(n)['data-role'] === 'active_users');
    await ui.click(sessions);
    assert.deepEqual(ui.api.calls.filter((c) => c[0] === 'track'), [], 'nothing sent before the button');
    await ui.click('posthog-track-save');
    assert.deepEqual(ui.api.calls.filter((c) => c[0] === 'track'), [['track', 'grow', 1, 'revenue_and_traction', 'AbCd1234', 'active_users']]);
    assert.equal(ui.by('posthog-track-dialog'), undefined, 'closed on success');
    assert.equal(ui.api.calls.filter((c) => c[0] === 'from').length, 2, 'the part is read again');
  } finally { await ui.close(); }
});

test('a refusal stays in the Track dialog; Stop tracking and Delete each say what they do first', async () => {
  const refused = Object.assign(new Error('x'), { data: { detail: 'That insight is not in this PostHog project. Choose one from the list.' } });
  let ui = await mounted({ api: fakeApi({ track: async () => { throw refused; } }) });
  try {
    await ui.click('posthog-track');
    await ui.pick(ui.all('posthog-insight')[1]);
    await ui.click(ui.all('posthog-role')[0]);
    await ui.click('posthog-track-save');
    assert.equal(ui.say('posthog-track-error'), 'That insight is not in this PostHog project. Choose one from the list.');
    assert.ok(ui.by('posthog-track-dialog'), 'the dialog stays open');
  } finally { await ui.close(); }
  ui = await mounted();
  try {
    await ui.click(ui.all('posthog-untrack')[0]);
    assert.ok(ui.text().includes(UNTRACK_LINE));
    assert.deepEqual(ui.api.calls.filter((c) => c[0] === 'untrack'), []);
    await ui.click('posthog-untrack-dialog-confirm');
    assert.deepEqual(ui.api.calls.filter((c) => c[0] === 'untrack'), [['untrack', 'grow', 1, 'a'.repeat(32)]]);
    await ui.click('posthog-fact-delete');
    assert.ok(ui.text().includes(DELETE_LINE));
    await ui.click('posthog-delete-dialog-confirm');
    assert.deepEqual(ui.api.calls.filter((c) => c[0] === 'deleteFact'), [['deleteFact', 'grow', 1, 7]]);
    await ui.click('posthog-dismiss');
    assert.deepEqual(ui.api.calls.filter((c) => c[0] === 'dismiss'), [['dismiss', 'grow', 1, 3]]);
  } finally { await ui.close(); }
});

test('the states: a teammate reads only; no link, disconnected, unreadable with Try again, and no metric say why', async () => {
  let ui = await mounted({ api: fakeApi({ read: async () => ({ ...READ, link: { linked: true, active: true, mine: false } }) }) });
  try {
    assert.equal(ui.by('posthog-track'), undefined);
    assert.equal(ui.all('posthog-untrack').length, 0);
    assert.equal(ui.all('posthog-accept').length, 0, 'only the owner decides');
  } finally { await ui.close(); }
  ui = await mounted({ api: fakeApi({ read: async () => ({ ...READ, link: { linked: false } }) }) });
  try { assert.ok(ui.say('posthog-no-project').includes(NOT_LINKED)); } finally { await ui.close(); }
  ui = await mounted({ api: fakeApi({ read: async () => ({ ...READ, link: { linked: true, active: false, mine: true } }) }) });
  try { assert.equal(ui.say('posthog-disconnected'), DISCONNECTED); } finally { await ui.close(); }
  ui = await mounted({ api: fakeApi({ read: async () => { throw new Error('x'); } }) });
  try {
    assert.ok(ui.say('posthog-unreadable').startsWith('Unreadable.'));
    assert.ok(ui.by('posthog-retry'));
  } finally { await ui.close(); }
  ui = await mounted({ api: fakeApi({ read: async () => ({ ...READ, tracked: [], link: { linked: true, active: true, mine: false } }) }) });
  try { assert.equal(ui.say('posthog-no-metrics'), `${NO_METRICS} ${NOT_MINE}`); } finally { await ui.close(); }
});

test('wiring: the client hits the Worker routes and is one line in api.js', () => {
  const client = readFileSync(new URL('../src/lib/api/posthog.js', import.meta.url), 'utf8');
  for (const path of ['/posthog-insights?project=', '/posthog?project=', '/posthog/tracked', '/posthog/facts/', '/posthog/proposals/']) assert.ok(client.includes(path), path);
  const api = readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8');
  assert.match(api, /^export \* from '\.\/api\/posthog\.js';$/m);
});

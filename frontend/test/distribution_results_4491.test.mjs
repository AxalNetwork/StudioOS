// D4491 (#4491): Distribution Results — named missing reasons, the MRR boundary, the read-error card and the mounted read.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { mutationCheck } from './_form_d695.mjs';
import ResultsTab, { ResultsView } from '../src/pages/cycles/distribution/ResultsTab.jsx';
import { costMoney, costPerLead, figure, funnelWidth, money, windowError, windowLabel } from '../src/pages/cycles/distribution/resultsModel.js';

const h = React.createElement;
const render = (View, state) => renderToStaticMarkup(h(MemoryRouter, null, h(View, { state, onRetry() {} })));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const DATA = {
  window: null, scope: { kind: 'lifetime' },
  campaigns: [
    { uid: 'spring', name: 'Spring demo push', leads: 18, demos: 4, customers: 1, spend_cents: 62000, spend_reason: null, cost_per_lead_cents: 3444, cost_per_lead_reason: null, cost_per_lead_sources: ['mercury', 'attributed'] },
    { uid: 'wait', name: 'Waitlist sign-ups', leads: null, leads_reason: 'Not recorded: no UTM tag', demos: null, demos_reason: 'Not recorded: no UTM tag', customers: null, customers_reason: 'Not recorded: no UTM tag', spend_cents: 41000, cost_per_lead_cents: null, cost_per_lead_reason: 'Not recorded: no UTM tag', cost_per_lead_sources: ['manual', 'attributed'] },
    { uid: 'ops', name: 'Ops leads outreach', leads: 11, demos: 3, customers: 0, spend_cents: null, spend_reason: 'Not recorded: no spend entered', cost_per_lead_cents: null, cost_per_lead_reason: 'Not recorded: no spend entered', cost_per_lead_sources: ['attributed'] },
  ],
  sources: [
    { key: 'channel:g', name: 'Google Search ad', leads: 11, demos: 3, customers: 1, figure_source: 'attributed' },
    { key: 'manual', name: 'Added by hand', leads: 3, demos: 0, customers: 0, figure_source: 'manual' },
  ],
  channels: [
    { uid: 'g', name: 'Google', spend_cents: 112000, spend_reason: null, spend_sources: ['mercury'] },
    { uid: 'x', name: 'X', spend_cents: null, spend_reason: 'Not recorded: no spend entered', spend_sources: [] },
  ],
};

test('the model keeps a measured zero, names every missing figure and rounds cost per lead to the cent', () => {
  assert.deepEqual(figure(null, 'no UTM tag'), { value: null, reason: 'Not recorded: no UTM tag' });
  assert.deepEqual(figure(undefined), { value: null, reason: 'Not recorded' });
  assert.deepEqual(figure(null, 'Unreadable: contacts could not be read').reason, 'Unreadable: contacts could not be read');
  assert.deepEqual(figure(0), { value: 0, reason: null });
  assert.equal(money(null), null); assert.equal(money(0), '$0'); assert.equal(money(62000), '$620'); assert.equal(money(112050), '$1,120.50');
  assert.equal(costPerLead(62000, 18), 3444); assert.equal(costMoney(3444), '$34.44');
  assert.equal(costMoney(costPerLead(80000, 9)), '$88.89');
  assert.equal(costPerLead(null, 18), null); assert.equal(costPerLead(62000, 0), null); assert.equal(costPerLead(62000, null), null);
  assert.equal(funnelWidth(4, 18), 4 / 18 * 100); assert.equal(funnelWidth(null, 18), null); assert.equal(funnelWidth(0, 0), 0);
  assert.equal(windowError('2026-04-01', '2026-03-01'), 'Choose a from date on or before the to date.');
  assert.equal(windowError('2026-03-01', ''), 'Choose a from date on or before the to date.');
  assert.equal(windowError('', ''), null);
  assert.match(windowLabel({ window: null }), /^No window chosen: lifetime figures/);
  assert.match(windowLabel({ window: { from: '2026-03-01', to: '2026-03-31' } }), /^Window: 2026-03-01 to 2026-03-31/);
});

test('Results shows Not recorded with each reason, never a 0 or a dash for a missing figure', () => {
  const html = render(ResultsView, { status: 'ready', data: DATA });
  const t = text(html);
  assert.match(t, /Waitlist sign-ups Not recorded: no UTM tag Not recorded: no UTM tag Not recorded: no UTM tag \$410 Not recorded: no UTM tag/);
  assert.match(t, /Ops leads outreach 11 3 0 Not recorded: no spend entered Not recorded: no spend entered/);
  assert.match(t, /X Not recorded: no spend entered Manual/);
  assert.match(t, /Spring demo push 18 4 1 \$620 \$34\.44 Mercury UTM attribution/);
  assert.match(t, /Google \$1,120 Mercury/);
  assert.match(t, /Added by hand 3 0 0 Manual/);
  assert.match(t, /No window chosen: lifetime figures/);
  assert.doesNotMatch(t, /\s[—–-]\s/);
  assert.equal((html.match(/data-testid="results-funnel"/g) || []).length, 2, 'only campaigns with counted leads get a funnel card');
  assert.match(html, /aria-valuenow="22"/, 'demos bar is relative to leads: 4 of 18');
  const unread = text(render(ResultsView, { status: 'ready', data: { ...DATA, sources: null, sources_reason: 'Unreadable: contacts could not be read', channels: null, channels_reason: 'Unreadable: channels could not be read' } }));
  assert.match(unread, /Unreadable: contacts could not be read/); assert.match(unread, /Unreadable: channels could not be read/);
});

test('the MRR note and its link to Revenue and traction; Results writes nothing', () => {
  const html = render(ResultsView, { status: 'ready', data: DATA });
  assert.match(text(html), /Revenue stays on Revenue and traction\. Nothing here changes MRR\. Open Revenue and traction ›/);
  assert.match(html, /href="\/grow\/revenue-and-traction"/);
  const src = readFileSync(new URL('../src/pages/cycles/distribution/ResultsTab.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /method:\s*'(POST|PUT|PATCH|DELETE)'|cyclesWrite|metrics/i);
  assert.doesNotMatch(src, /\bFill\b/);
});

test('loading is a skeleton; a failed read is the read-error card with Try again, not an empty result', () => {
  assert.match(render(ResultsView, { status: 'loading' }), /aria-label="Loading Results"/);
  const html = render(ResultsView, { status: 'error' });
  assert.match(text(html), /Results Couldn’t be read\. This is not a claim that there are none\. Try again/);
  assert.match(html, /min-h-\[44px\]/);
  assert.doesNotMatch(html, /no campaigns yet|Campaigns/);
});

async function mounted(respond) {
  const before = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return respond(String(url), calls.length); };
  const m = await mountContracts(h(ResultsTab, { projectId: 7 }), '/grow/distribution/results?project_id=7', { id: 1, role: 'founder' });
  await m.flush(); await m.flush();
  return { m, calls, restore: () => { globalThis.fetch = before; } };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('a failed read never renders the raw error; Try again reads again', async () => {
  const leak = 'D1_ERROR: no such table grow_campaigns SQLITE_ERROR';
  const { m, calls, restore } = await mounted((url, n) => (n === 1 ? json({ detail: leak }, 503) : json(DATA)));
  try {
    assert.match(m.text(), /Couldn’t be read\. This is not a claim that there are none\./);
    assert.doesNotMatch(m.text(), /D1_ERROR|SQLITE|no such table|Results are unreadable/);
    assert.match(calls[0], /\/grow\/results\?project=7$/);
    await m.click('Try again'); await m.flush(); await m.flush();
    assert.equal(calls.length, 2);
    assert.match(m.text(), /Spring demo push/);
  } finally { await m.unmount(); restore(); }
});

test('the window is checked before reading and sent as from/to', async () => {
  const { m, calls, restore } = await mounted(() => json(DATA));
  try {
    await m.fill('From', '2026-04-01'); await m.fill('To', '2026-03-01');
    const form = m.nodes().find((n) => n.tagName === 'FORM');
    const { act } = await import('react');
    await act(async () => { m.props(form).onSubmit({ preventDefault() {} }); });
    assert.match(m.text(), /Choose a from date on or before the to date\./); assert.equal(calls.length, 1);
    await m.fill('To', '2026-04-30');
    await act(async () => { m.props(form).onSubmit({ preventDefault() {} }); }); await m.flush(); await m.flush();
    assert.match(calls.at(-1), /project=7&from=2026-04-01&to=2026-04-30$/);
  } finally { await m.unmount(); restore(); }
});

test('CycleRoute renders ResultsTab for the results tab only', async () => {
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.match(route, /distributionTab === 'results' \? <ResultsTab key=\{projectId\} projectId=\{projectId\} \/> : <ComingSoon \/>/);
  const routes = readFileSync(new URL('../src/routes/growDistribution.jsx', import.meta.url), 'utf8');
  assert.match(routes, /path="\/grow\/distribution\/results"[^\n]+tab="results"/);
});

test('mutations: a missing figure as 0, a dropped reason or a dropped MRR link fail', async () => {
  const path = 'pages/cycles/distribution/resultsModel.js';
  const src = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
  const verify = (mod) => {
    assert.equal(mod.figure(null, 'no spend entered').value, null);
    assert.equal(mod.figure(null, 'no spend entered').reason, 'Not recorded: no spend entered');
    assert.equal(mod.costPerLead(62000, 0), null);
    assert.equal(mod.REVENUE_PATH, '/grow/revenue-and-traction');
  };
  await mutationCheck(src, path, verify, [
    ["if (isCount(value)) return { value, reason: null };", "if (isCount(value ?? 0)) return { value: value ?? 0, reason: null };"],
    ["`Not recorded: ${text}`", 'text'],
    ['|| leads === 0 ? null', '? null'],
    ["'/grow/revenue-and-traction'", "'/grow'"],
  ]);
});

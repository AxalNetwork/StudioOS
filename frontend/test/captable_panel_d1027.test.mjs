// D1027 (#2864, part 12 of #2432) — the investor's read-only Cap table panel
// (CT15, CT15o, CT15n): it draws exactly what D1019's level returns. At
// Investor level the group bar, the positions with "Your position" in lavender
// (only when the Worker marks the row), rounds and pricing or why not, and why
// the payout at exit values is not shown; at Own position the caller's shares
// and the bar; at Summary the bar; not shared, CT15n's sentence and "Ask for
// access" through an in-page dialog. A failed read is never "not shared", and
// a missing share is never 0%. Mounted on the deal's Terms tab and the
// company page's Terms.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/captable_panel_d1027.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import InvestorCapTablePanel from '../src/pages/raise/captable/InvestorCapTablePanel.jsx';
import { askOutcome, groupBar, headerLine, ownLines, panelOf } from '../src/pages/raise/captable/investorPanelModel.js';
import { sharedView } from '../src/pages/raise/captable/capTableAccess.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const FOUNDING = [
  { holder: 'Founder A', type: 'founder', shares: 8000, pct: 66.67 },
  { holder: 'Harbor Seed Fund', type: 'preferred', shares: 1000, pct: 8.33, mine: true },
  { holder: 'Option pool', type: 'option_pool', shares: 1000, pct: 8.33 },
  { holder: 'Other', type: 'common', shares: 2000, pct: 16.67 },
];
const INVESTOR = { project_id: 10, level: 'investor', via: 'grant', read_only: true, source_note: 'These figures come from recorded issuances.',
  view: { audience: 'investor', founding: FOUNDING, rounds: [], instruments: [{ holder: 'Harbor Seed Fund', instrument: 'safe', amount: 500000, currency: 'USD', basis: 'post_money', issue_date: '2026-01-01' }],
    split_reason: null, disclosure: 'Recorded positions. Saved scenarios, proposals and private notes are excluded.' } };
const SUMMARY = [{ group: 'Founders', pct: 66.67 }, { group: 'Investors', pct: 8.33 }, { group: 'Option pool', pct: 8.33 }, { group: 'Other', pct: 16.67 }];
const OWN = { project_id: 10, level: 'own_position', via: 'grant', read_only: true,
  view: { level: 'own_position', holder: 'Harbor Seed Fund', position: [{ holder: 'Harbor Seed Fund', type: 'preferred', shares: 1000, pct: 8.33 }], instruments: [], documents: [], summary: SUMMARY, split_reason: null, disclosure: 'Your recorded position and the group split.' } };
const NO_PCT = { ...INVESTOR, view: { ...INVESTOR.view, founding: FOUNDING.map((f) => ({ ...f, pct: null })), split_reason: 'Pool size is not recorded.' } };

async function mounted(handle) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, o = {}) => { requests.push({ url: String(u).replace(/^.*\/api/, ''), method: (o.method || 'GET').toUpperCase() }); return handle(String(u), o); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(InvestorCapTablePanel, { projectId: 10, venture: 'Acme Robotics' }))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const byId = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  return {
    requests, count: (id) => byId(id).length, textOf: (id) => byId(id).map(text).join(' | '), text: () => text(document.body),
    classOf: (id, i = 0) => String(props(byId(id)[i] || {}).className || ''),
    async click(id) { const n = byId(id)[0]; assert.ok(n, `no ${id}`); await act(async () => props(n).onClick?.({ preventDefault() {} })); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

// ---------------------------------------------------------------- the model

test('the model: the header line, the group bar from what the level sent, own lines, and no zero for a missing share', () => {
  assert.equal(headerLine(INVESTOR, new Date('2026-10-26T12:00:00Z')), 'As of 26 Oct 2026 · shared at Investor level by the founder');
  assert.deepEqual(groupBar(INVESTOR).parts, [{ group: 'Founders', pct: 66.67 }, { group: 'Investors', pct: 8.33 }, { group: 'Option pool', pct: 8.33 }, { group: 'Other', pct: 16.67 }]);
  assert.equal(groupBar(INVESTOR).reason, null);
  assert.deepEqual(groupBar(OWN).parts.map((p) => p.group), ['Founders', 'Investors', 'Option pool', 'Other'], 'own position: the split it was sent');
  const none = groupBar(NO_PCT);
  assert.deepEqual([none.parts, none.reason], [[], 'Pool size is not recorded.'], 'no share recorded: no bar, the Worker’s reason, never 0%');
  const partial = groupBar({ view: { audience: 'investor', founding: [{ type: 'founder', pct: 60 }] } });
  assert.match(partial.reason, /does not reach 100%/);
  assert.deepEqual(ownLines(sharedView(OWN)), ['Your position: 1,000 shares (Investor) · 8.33% fully diluted']);
  assert.equal(sharedView(INVESTOR).rows.filter((r) => r.mine).length, 1, 'mine only where the Worker marked it');
  assert.equal(panelOf({ status: 'refused' }).kind, 'no_access');
  assert.equal(panelOf({ status: 'error' }).kind, 'unreadable');
  assert.equal(panelOf({ status: 'ready', data: { view: { recorded: false, reason: 'No ownership has been recorded for this venture yet.' } } }).kind, 'none');
  assert.equal(askOutcome({ data: { error: 'already_asked' } }).asked, true);
  assert.equal(askOutcome({ data: { code: 'already_shared' } }).reload, true);
  assert.equal(askOutcome({ message: 'Down' }).asked, false);
});

// ---------------------------------------------------------------- mounted

test('Investor level: the bar, the positions with Your position in lavender, rounds not recorded, the payout not shown', async () => {
  const v = await mounted((u) => (u.includes('/captable/access/10') ? response(INVESTOR) : response({})));
  try {
    assert.match(v.textOf('captable-panel'), /Cap table · Acme Robotics/);
    assert.match(v.textOf('captable-panel-line'), /shared at Investor level by the founder/);
    assert.equal(v.count('captable-panel-bar-part'), 4);
    assert.equal(v.count('captable-panel-mine'), 1);
    assert.match(v.textOf('captable-panel-mine'), /Harbor Seed Fund[\s\S]*Your position/);
    assert.match(v.classOf('captable-panel-mine'), /bg-axal-lavender/);
    assert.equal(v.count('captable-panel-row'), 3);
    assert.ok(!/bg-axal-lavender/.test(v.classOf('captable-panel-row')), 'no other row is lit');
    assert.match(v.textOf('captable-panel-rounds'), /Rounds and pricing are not recorded on the cap table yet\./);
    assert.match(v.textOf('captable-panel-payout'), /not shown/);
    assert.match(v.textOf('captable-panel-investor'), /Investor level: the pool is one line, and who holds options is not shown\./);
    assert.match(v.textOf('captable-panel-instruments'), /Harbor Seed Fund · SAFE/);
    assert.ok(!/\b0%|\b0\.00%/.test(v.text()), 'no zero');
    assert.deepEqual(v.requests.map((r) => r.url), ['/captable/access/10'], 'one read, never /raise/cap-table');
  } finally { await v.close(); }
});

test('Own position (CT15o): the caller\'s shares and fully diluted %, and the group bar; no other holder', async () => {
  const v = await mounted(() => response(OWN));
  try {
    assert.match(v.textOf('captable-panel-own-line'), /Your position: 1,000 shares \(Investor\) · 8\.33% fully diluted/);
    assert.equal(v.count('captable-panel-bar-part'), 4);
    assert.equal(v.count('captable-panel-positions'), 0, 'no table of other holders');
    assert.ok(!v.text().includes('Founder A'));
  } finally { await v.close(); }
});

test('a missing share: the Worker\'s reason, no bar and no 0%', async () => {
  const v = await mounted(() => response(NO_PCT));
  try {
    assert.equal(v.count('captable-panel-bar-part'), 0);
    assert.match(v.textOf('captable-panel-bar-reason'), /Pool size is not recorded\./);
    assert.ok(!/\b0%/.test(v.text()));
  } finally { await v.close(); }
});

test('not shared (CT15n): the sentence and Ask for access, which asks in a dialog and says it was asked', async () => {
  const v = await mounted((u, o = {}) => ((o.method || 'GET').toUpperCase() === 'POST'
    ? response({ ok: true, asked: true }) : response({ error: 'not_shared', message: 'The founder has not shared the cap table with you.' }, 403)));
  try {
    assert.match(v.textOf('captable-panel-no-access'), /The founder has not shared the cap table with you\.[\s\S]*Ask Acme Robotics for access\. The founder answers on their Access tab\./);
    await v.click('captable-panel-ask');
    assert.equal(v.requests.filter((r) => r.method === 'POST').length, 0, 'nothing is sent before the dialog is confirmed');
    assert.equal(v.count('captable-panel-ask-dialog'), 1);
    await v.click('captable-panel-ask-dialog-go');
    assert.deepEqual(v.requests.filter((r) => r.method === 'POST').map((r) => r.url), ['/captable/access/10/ask']);
    assert.match(v.textOf('captable-panel-asked'), /Asked\. The founder answers on their Access tab\./);
    assert.equal(v.count('captable-panel-ask'), 0);
  } finally { await v.close(); }
});

test('an ask the Worker already holds says so; any other refusal stays in the dialog', async () => {
  const held = await mounted((u, o = {}) => ((o.method || 'GET').toUpperCase() === 'POST'
    ? response({ error: 'already_asked', message: 'You asked in the last day.' }, 409) : response({ error: 'not_shared' }, 403)));
  try {
    await held.click('captable-panel-ask'); await held.click('captable-panel-ask-dialog-go');
    assert.match(held.textOf('captable-panel-asked'), /You asked in the last day/);
  } finally { await held.close(); }
  const down = await mounted((u, o = {}) => ((o.method || 'GET').toUpperCase() === 'POST'
    ? response({ error: 'down', message: 'Service unavailable' }, 503) : response({ error: 'not_shared' }, 403)));
  try {
    await down.click('captable-panel-ask'); await down.click('captable-panel-ask-dialog-go');
    assert.equal(down.count('captable-panel-asked'), 0, 'a failed ask is not "Asked"');
    assert.equal(down.count('captable-panel-ask-dialog'), 1);
    assert.equal(down.count('captable-panel-ask-dialog-refusal'), 1);
  } finally { await down.close(); }
});

test('a failed read is could not be read with Try again, never not shared; nothing recorded says why', async () => {
  const v = await mounted(() => response({ error: 'access_log_unwritable', message: 'x' }, 503));
  try {
    assert.equal(v.count('captable-panel-unreadable'), 1);
    assert.equal(v.count('captable-panel-no-access'), 0);
  } finally { await v.close(); }
  const n = await mounted(() => response({ level: 'investor', via: 'grant', view: { recorded: false, reason: 'No ownership has been recorded for this venture yet.' } }));
  try { assert.match(n.textOf('captable-panel-none'), /No ownership has been recorded/); } finally { await n.close(); }
});

test('the wiring: the deal\'s Terms tab and the company page\'s Terms mount it for an investor; no browser pop-up, no hex colour', () => {
  const deal = read('frontend/src/pages/deal/DealWorkTabs.jsx');
  assert.match(deal, /investor\s*\?\s*<InvestorCapTablePanel projectId=\{deal\.project_id\} venture=\{deal\.project_name\} testId="deal-terms-captable" \/>/);
  const company = read('frontend/src/pages/investor/PortfolioCompanyPage.jsx');
  assert.match(company, /<InvestorCapTablePanel projectId=\{position\.project_id\} venture=\{position\.project\?\.name\} testId="company-captable" \/>/);
  for (const f of ['InvestorCapTablePanel.jsx', 'investorPanelModel.js']) {
    const src = read(`frontend/src/pages/raise/captable/${f}`);
    assert.ok(!/\balert\(|\bconfirm\(|window\.prompt/.test(src), f);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src.replace(/(^|[\s(,])#\d{4}\b/g, '')), f);
    assert.ok(!src.includes('/raise/cap-table'), `${f}: the investor never opens the founder's tool`);
  }
  assert.ok(read('frontend/src/lib/api/capTableAccess.js').includes("ask: (projectId) => request(`${base(projectId)}/ask`, json('POST')),"));
});

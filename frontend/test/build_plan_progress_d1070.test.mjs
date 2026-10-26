/**
 * D1070 (#2940) — Validate → Build part 7: Send to… (VB6–VB8), Back in (VB9),
 * Progress (VB10, VB12, VB22), the evidence trail (VB11), the Operating
 * Partner's view (VB15), the admin's (VB16) and the not-founder card (VB20a).
 *
 * Mounted against the Worker's own shapes (D1065's plan read, D1068's
 * handoffs and links, D1066's evidence trail, the connectors list and its
 * repositories) through a stubbed fetch. Every venture, item and label is
 * invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_plan_progress_d1070.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import BuildPlan from '../src/pages/cycles/BuildPlan.jsx';
import {
  bucketOf, chartLabel, counterText, filterRows, githubConnection, pageRows, phoneStatus, pickedRepositories, progressRows, sendRefusal, sendable,
  stageChart, stageLead, trailNodes, waitingLinks,
} from '../src/pages/cycles/buildProgressModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const MUST = '11111111-1111-4111-8111-111111111111';
const FEAT = '22222222-2222-4222-8222-222222222222';
const RISK = '33333333-3333-4333-8333-333333333333';
const ROAD = '44444444-4444-4444-8444-444444444444';
const DOOR = '55555555-5555-4555-8555-555555555555';
const WAIT = '66666666-6666-4666-8666-666666666666';
const STEP = '77777777-7777-4777-8777-777777777777';
const LINK_DONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINK_WAIT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const accepted = (uid, kind, title, extra = {}) => ({ uid, kind, status: 'accepted', payload: { title, ...(extra.payload || {}) }, evidence: [], decided_at: '2026-10-12 15:00:00', landed_table: extra.table ?? 'mvp_features', landed_id: extra.id ?? '5', marker: `VB-${uid.slice(0, 4).toUpperCase()}`, ...extra.row });

const PLAN = () => ({
  plan: { uid: 'plan-uid', scope: 'venture', status: 'open', prepared_at: '2026-10-12 14:05:00' },
  verdict: { id: 9, decision: 'proceed', state: 'given', decided_at: '2026-10-12 09:00:00', evidence_count: 6 },
  brief: null,
  modules: {
    'solution-design': [
      accepted(FEAT, 'feature', 'Live ETA panel', { id: '6' }),
      accepted(RISK, 'risk', 'Buyers fear migration', { table: 'venture_risks', id: '2' }),
      { uid: WAIT, kind: 'feature', status: 'proposed', payload: { title: 'Driver app' }, evidence: [] },
    ],
    'prototype-mvp': [accepted(MUST, 'must-have', 'One-day setup wizard')],
    'product-roadmap': [accepted(ROAD, 'roadmap', 'Carrier integrations', { table: 'roadmap_okrs', id: '9', payload: { lane: 'Later' } })],
    'company-creation': [accepted(STEP, 'formation-step', 'Incorporate', { table: 'formation_steps', id: '3' })],
    'operating-systems': [accepted(DOOR, 'connect-door', 'Connect GitHub', { table: null, id: null })],
    'founding-team': [],
  },
});
const HANDOFFS = [
  { uid: 'h1', provider: 'lovable', plan_item_uids: [MUST, FEAT], opened_at: '2026-10-13 10:00:00', prompt_chars: 521 },
  { uid: 'h2', provider: 'notion', plan_item_uids: [RISK], opened_at: '2026-10-14 10:00:00' },
];
const LINKS = [
  { uid: LINK_DONE, status: 'accepted', provider: 'github', fed: 'pr:northwind/app#12', fed_kind: 'pull_request', title: 'Bulk CSV import', plan_item_uid: MUST, marker: 'VB-1111', decided_at: '2026-10-20 08:00:00' },
  { uid: LINK_WAIT, status: 'proposed', provider: 'github', fed: 'issue:northwind/app#9', fed_kind: 'issue', title: 'Live ETA panel', plan_item_uid: FEAT, marker: 'VB-2222', decided_at: null },
];
const TRAIL = {
  table: 'mvp_features', id: 5,
  evidence: [{ kind: 'theme', ref: '1', label: 'Setup takes weeks', source_label: 'Recorded', linked_at: '2026-10-12' }],
  accepted: { plan_item_uid: MUST, status: 'accepted', decided_at: '2026-10-12 15:00:00' },
  decision: { decision: 'proceed', state: 'given', decided_at: '2026-10-12 09:00:00' },
  sent: { recorded: false }, came_back: [],
};

// ---------------------------------------------------------------- the model

test('the stages: each read for what it carries, Not yet only where a read could say it, Not recorded never as not done', () => {
  const rows = progressRows(PLAN(), HANDOFFS, LINKS);
  const by = Object.fromEntries(rows.map((r) => [r.uid, r]));
  assert.deepEqual(rows.map((r) => r.uid).sort(), [DOOR, FEAT, MUST, RISK, ROAD, STEP].sort(), 'accepted items only; a proposal is not progress');
  assert.deepEqual(by[MUST].stages.accepted, { state: 'done', text: '12 Oct', source: 'Your accept', at: '2026-10-12 15:00:00' });
  assert.deepEqual(by[MUST].stages.sent, { state: 'done', text: 'Lovable · opened 13 Oct', source: 'Your press', at: '2026-10-13 10:00:00' });
  assert.deepEqual(by[MUST].stages.progress, { state: 'done', text: 'GitHub · pull request linked 20 Oct', source: 'Connector · GitHub', at: '2026-10-20 08:00:00' });
  for (const k of ['built', 'live', 'tested']) assert.equal(by[MUST].stages[k].state, 'unrecorded', `${k} is never read here, so never "Not yet"`);
  assert.equal(by[FEAT].stages.progress.state, 'notyet', 'a waiting link is not progress');
  assert.equal(by[RISK].stages.sent.text, 'Notion · copied 14 Oct');
  assert.deepEqual(by[RISK].stages.progress, { state: 'unrecorded', text: 'Not recorded', source: 'Notion reports nothing back' });
  assert.deepEqual(['built', 'live', 'tested'].map((k) => by[RISK].stages[k].state), ['na', 'na', 'na'], 'a risk is never built, live or tested');
  assert.equal(by[ROAD].stages.sent.state, 'notyet');
  assert.deepEqual(['sent', 'progress', 'built', 'tested'].map((k) => by[DOOR].stages[k].state), ['na', 'na', 'na', 'na'], 'a door is opened, never sent');
  assert.equal(by[DOOR].stages.live.state, 'unrecorded');
  assert.deepEqual(['live', 'tested'].map((k) => by[STEP].stages[k].state), ['na', 'na']);
  const test_ = progressRows({ modules: { 'prototype-mvp': [accepted('t1', 'prototype-test', 'Setup in a day')] } }, [], [])[0];
  assert.deepEqual(['built', 'live', 'tested'].map((k) => test_.stages[k].state), ['na', 'na', 'unrecorded'], 'a test is never built or live, only tested');
  // A failed sends or links read is "Not recorded" with its reason, never "Not yet".
  const blind = Object.fromEntries(progressRows(PLAN(), null, null).map((r) => [r.uid, r]));
  assert.deepEqual(blind[ROAD].stages.sent, { state: 'unrecorded', text: 'Not recorded', source: 'Sends could not be read' });
  assert.deepEqual(blind[MUST].stages.progress, { state: 'unrecorded', text: 'Not recorded', source: 'Links could not be read' });
  assert.equal(phoneStatus(by[MUST]), 'In progress · GitHub · pull request linked 20 Oct');
});

test('the chart: each item in its furthest bucket, the lead never claims 0 built, the label names what is not recorded', () => {
  const rows = progressRows(PLAN(), HANDOFFS, LINKS);
  const by = Object.fromEntries(rows.map((r) => [r.uid, r.bucket]));
  assert.deepEqual(by, { [MUST]: 'progress', [FEAT]: 'sent', [RISK]: 'unrecorded', [ROAD]: 'notstarted', [STEP]: 'accepted', [DOOR]: 'accepted' });
  assert.equal(bucketOf('feature', { built: { state: 'done' } }), 'built');
  const chart = stageChart(rows);
  assert.deepEqual(chart.find((m) => m.module === 'solution-design').counts, { accepted: 0, sent: 1, progress: 0, built: 0, notstarted: 0, unrecorded: 1 });
  assert.equal(stageLead(rows), '6 accepted items, 3 sent to a tool. Built and live are not recorded here yet.');
  assert.doesNotMatch(stageLead(rows), /\b0 of\b/, 'no read carries built, so it is never counted as none');
  assert.match(chartLabel(chart), /In Solution design, 1 is not recorded\./);
  assert.equal(stageLead([]), 'No item is accepted yet, so there is nothing to show by stage.');
});

test('the table: search, Module, Stage and Tool, the sort, and pages of 25', () => {
  const rows = progressRows(PLAN(), HANDOFFS, LINKS);
  assert.deepEqual(filterRows(rows, { q: 'eta', module: '', stage: '', tool: '' }).map((r) => r.uid), [FEAT]);
  assert.deepEqual(filterRows(rows, { q: '', module: 'prototype-mvp', stage: '', tool: '' }).map((r) => r.uid), [MUST]);
  assert.deepEqual(filterRows(rows, { q: '', module: '', stage: 'notstarted', tool: '' }).map((r) => r.uid), [ROAD]);
  assert.deepEqual(filterRows(rows, { q: '', module: '', stage: '', tool: 'github' }).map((r) => r.uid), [MUST]);
  assert.equal(filterRows(rows)[0].uid, MUST, 'Last change: the newest stamp first');
  assert.equal(filterRows(rows, undefined, 'name')[0].title, 'Buyers fear migration');
  const many = Array.from({ length: 30 }, (_, i) => ({ uid: String(i) }));
  assert.deepEqual([pageRows(many, 1).range, pageRows(many, 2).range, pageRows(many, 9).page, pageRows([], 1).range], ['1–25 of 30', '26–30 of 30', 2, '0 of 0']);
});

test('Send to…: what may be sent, the founder\'s picked repositories, the counter, and a refusal that never repeats what it found', () => {
  assert.deepEqual(sendable(PLAN()).map((i) => i.uid), [FEAT, RISK, MUST, ROAD, STEP], 'accepted and landed; a door and a proposal are never sent');
  const list = { items: [
    { uid: 'g-other', provider_key: 'github', status: 'connected', config: { project_id: 9 } },
    { uid: 'g-off', provider_key: 'github', status: 'disconnected', config: { project_id: 3 } },
    { uid: 'g-mine', provider_key: 'github', status: 'connected', config: { project_id: 3 } },
  ] };
  assert.equal(githubConnection(list, 3), 'g-mine');
  assert.equal(githubConnection(list, 4), null);
  assert.deepEqual(pickedRepositories({ selected: ['northwind/app', 'bad name', 7], available: ['x/y'] }), ['northwind/app'], 'picked, never merely available');
  assert.equal(counterText(1840), '1,840 / 4,000');
  const pii = sendRefusal({ data: { code: 'pii_found', findings: [{ kind: 'email', in: MUST }, { kind: 'name', in: MUST }] } }, sendable(PLAN()));
  assert.equal(pii.text, 'The privacy check found a name, an email or a quote in “One-day setup wizard”. Nothing was sent or recorded.');
  assert.equal(sendRefusal({ data: { code: 'too_long', message: 'The prompt is 4,210 characters; Lovable takes 4000. Send fewer items.' } }).text, 'The prompt is 4,210 characters; Lovable takes 4000. Send fewer items.');
});

test('Back in and the trail: proposals only, in words; the trail oldest first, ending with what no read carries', () => {
  assert.deepEqual(waitingLinks(LINKS, PLAN()), [{ uid: LINK_WAIT, source: 'Connector · GitHub', line: 'Issue #9 ‘Live ETA panel’ names VB-2222.', ask: 'Link to feature Live ETA panel?' }]);
  const row = progressRows(PLAN(), HANDOFFS, LINKS).find((r) => r.uid === MUST);
  const nodes = trailNodes(row, TRAIL, HANDOFFS, LINKS);
  assert.deepEqual(nodes.map((n) => [n.tone, n.text]), [
    ['evidence', 'Setup takes weeks'],
    ['you', 'Verdict · Proceed · 12 Oct'],
    ['you', 'Accepted into Prototype / MVP · 12 Oct'],
    ['you', 'Opened in Lovable · 13 Oct'],
    ['tool', 'GitHub pull request ‘Bulk CSV import’ · linked 20 Oct'],
    ['missing', 'Not recorded: built, live, tested.'],
  ]);
  assert.equal(nodes[0].sub, 'Recorded · Problem discovery');
  assert.ok(!trailNodes(row, { ...TRAIL, decision: undefined }, HANDOFFS, LINKS).some((n) => n.key === 'decision'), 'no decision node when the trail carries none (a partner)');
});

// ---------------------------------------------------------------- mounted

function handler(over = {}) {
  return (url, options = {}) => {
    const method = options.method || 'GET';
    for (const [k, f] of Object.entries(over)) if (url.includes(k) && (!f.method || f.method === method)) return f.answer(url, options);
    if (/\/cycles\/build\/plan\/handoffs\?/.test(url) && method === 'GET') return response({ handoffs: HANDOFFS });
    if (/\/cycles\/build\/plan\/handoffs\?/.test(url)) return response({ provider: 'lovable', text: 'Build a clickable prototype.\n\nAxal VC plan item VB-1111', prompt_chars: 521, link: 'https://lovable.dev/?autosubmit=true#prompt=Build', handoffs: [] });
    if (/\/cycles\/build\/plan\/links\?/.test(url)) return response({ links: LINKS });
    if (/\/cycles\/build\/plan\/links\/[^/]+\/(accept|dismiss)/.test(url)) return response({ uid: LINK_WAIT, status: 'accepted' });
    if (/\/cycles\/build\/evidence\?/.test(url)) return response(TRAIL);
    if (/\/cycles\/build\/plan\/word\?/.test(url) && method === 'GET') return response({ wording: null });
    if (/\/cycles\/build\/plan\/since\?/.test(url)) return response({ plan: 'plan-uid', status: 'open', changed: false, new: 0, contradicting: 0 });
    if (/\/cycles\/build\/plan\?/.test(url) && method === 'GET') return response(PLAN());
    if (/\/connectors$/.test(url)) return response({ ok: true, items: [] });
    if (url.includes('/ai/me/spend')) return response({ recorded: true, by_task_recorded: true, by_task: [] });
    if (url.includes('/cycles/validate/overview')) return response({ cards: [] });
    return response({});
  };
}

async function mounted({ handle = handler(), props = {}, phone = false } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => {
    requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return handle(String(u), options);
  };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(BuildPlan, { tab: 'progress', projectId: 3, search: '?project_id=3', cards: [], role: 'founder', phone, ...props }))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props_(n)['data-testid'] === id);
  const all = (id) => nodes().filter((n) => props_(n)['data-testid'] === id);
  return {
    requests, flush, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props_(byId(id)), all: () => text(container),
    texts: (id) => all(id).map(text), count: (id) => all(id).length,
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onChange({ target: { value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const writes = (r) => r.requests.filter((q) => q.method !== 'GET');

test('mounted VB10: the stages, the dashed Not recorded, Built per week unread, the table, and its filter', async () => {
  const r = await mounted();
  try {
    assert.match(r.textOf('plan-progress-asof'), /^As of \d+ \w{3} · read from Lovable, Notion, GitHub and your presses$/);
    assert.equal(r.textOf('plan-progress-lead'), '6 accepted items, 3 sent to a tool. Built and live are not recorded here yet.');
    assert.ok(r.has('plan-progress-seg-solution-design-unrecorded'), 'the Notion copy is drawn as not recorded');
    assert.match(r.props('plan-progress-seg-solution-design-unrecorded').className, /border-dashed/, 'Not recorded is a dashed outline, never a fill');
    assert.match(r.props('plan-progress-chart')['aria-label'], /In Solution design, 1 is not recorded\./);
    assert.match(r.textOf('plan-progress-week-unread'), /no week is drawn as 0/);
    assert.equal(r.count('plan-progress-row'), 6);
    assert.match(r.textOf('plan-progress-table'), /One-day setup wizard.*Must-have.*Prototype \/ MVP.*12 Oct.*Your accept.*Lovable · opened 13 Oct.*Your press.*GitHub · pull request linked 20 Oct.*Connector · GitHub.*Not recorded/s);
    assert.equal(r.textOf('plan-progress-range'), '1–6 of 6');
    await r.change('plan-progress-filter-tool', 'notion');
    assert.deepEqual(r.texts('plan-progress-row').map((t) => t.split('Risk')[0]), ['Buyers fear migration']);
    assert.ok(!r.requests.some((q) => q.url.includes('/cycles/validate/overview')), 'Progress makes no Validate read');
    assert.deepEqual(writes(r), [], 'reading Progress writes nothing');
  } finally { await r.close(); }
});

test('mounted VB9: what arrived waits for Link; Link and Not this one are the founder\'s presses', async () => {
  const r = await mounted();
  try {
    assert.match(r.textOf('plan-back-in-door'), /Arrived from your tools · 1\. Nothing is linked until you press Link\./);
    await r.click('plan-back-in-open');
    assert.match(r.textOf('plan-back-in'), /Connector · GitHub.*Issue #9 ‘Live ETA panel’ names VB-2222\..*Link to feature Live ETA panel\?/s);
    assert.deepEqual(writes(r), [], 'opening it links nothing');
    await r.click('plan-back-in-link');
    assert.deepEqual(writes(r).map((w) => [w.method, w.url.replace(/\?.*/, '')]), [['POST', `/api/cycles/build/plan/links/${LINK_WAIT}/accept`]]);
  } finally { await r.close(); }
  const d = await mounted({ handle: handler({ '/links/': { method: 'POST', answer: () => response({ code: 'marker_unknown', message: 'The plan item this names is no longer accepted on this venture, so it cannot be linked.' }, 409) } }) });
  try {
    await d.click('plan-back-in-open');
    await d.click('plan-back-in-dismiss');
    assert.match(d.textOf('plan-back-in-refused'), /no longer accepted on this venture/);
    assert.equal(writes(d)[0].url.replace(/\?.*/, ''), `/api/cycles/build/plan/links/${LINK_WAIT}/dismiss`);
  } finally { await d.close(); }
});

test('mounted VB11: an item opens its trail from D1066\'s evidence read, with the sends and links', async () => {
  const r = await mounted();
  try {
    await r.click(`plan-progress-open-${MUST}`);
    const ev = r.requests.find((q) => q.url.includes('/cycles/build/evidence'));
    assert.match(ev.url, /project=3&table=mvp_features&id=5/);
    assert.match(r.textOf('plan-trail'), /Setup takes weeks.*Verdict · Proceed · 12 Oct.*Accepted into Prototype \/ MVP · 12 Oct.*Opened in Lovable · 13 Oct.*GitHub pull request ‘Bulk CSV import’ · linked 20 Oct.*Not recorded: built, live, tested\..*See how Raise uses it/s);
    assert.equal(r.count('plan-trail-node-missing'), 1);
  } finally { await r.close(); }
  const f = await mounted({ handle: handler({ '/cycles/build/evidence': { answer: () => response({ code: 'unreadable' }, 503) } }) });
  try {
    await f.click(`plan-progress-open-${MUST}`);
    assert.match(f.textOf('plan-trail'), /not a claim that it is empty/);
    assert.ok(!f.has('plan-trail-nodes'), 'a failed trail is never drawn as an empty one');
  } finally { await f.close(); }
});

test('mounted: failed sends and links reads each say so, and their stages read Not recorded, never Not yet', async () => {
  const r = await mounted({ handle: handler({ '/plan/handoffs': { method: 'GET', answer: () => response({}, 503) }, '/plan/links': { answer: () => response({}, 503) } }) });
  try {
    assert.match(r.all(), /Your sends could not be read\. This is not a claim that nothing was sent\./);
    assert.match(r.all(), /What came back from your tools could not be read\./);
    assert.match(r.textOf('plan-progress-table'), /Not recorded.*Sends could not be read/s);
    assert.ok(!r.has('plan-back-in-door'));
    assert.equal(r.count('plan-progress-row'), 6, 'the plan still draws');
  } finally { await r.close(); }
});

test('mounted VB15, VB16 and VB20a: the Operating Partner reads Progress only; an admin reads with no actions; a non-founder meets the card', async () => {
  const op = await mounted({ props: { role: 'partner' } });
  try {
    assert.match(op.textOf('plan-op-header'), /^Build plan.*You see what the founders accepted and what was built\.$/s);
    assert.equal(op.textOf('plan-op-pill'), '● Operating Partner');
    assert.ok(op.has('plan-tab-progress') && !op.has('plan-tab-plan'), 'Progress only');
    assert.ok(!op.has('plan-back-in-door'), 'no decisions for a partner');
  } finally { await op.close(); }
  const opPlan = await mounted({ props: { role: 'partner', tab: 'plan' } });
  try {
    assert.ok(!opPlan.has('plan-board') && !opPlan.requests.some((q) => q.url.includes('/plan/word')), 'the Plan tab is never drawn for a partner');
  } finally { await opPlan.close(); }
  const admin = await mounted({ props: { role: 'admin' } });
  try {
    assert.ok(admin.has('plan-read-only-pill'));
    assert.ok(!admin.has('plan-back-in-door'), 'an admin reads, never links');
    assert.equal(admin.count('plan-progress-row'), 6);
  } finally { await admin.close(); }
  for (const role of ['investor', 'advisor', 'exploring']) {
    const v = await mounted({ props: { role } });
    try {
      assert.match(v.textOf('plan-not-founder'), /This plan belongs to the venture’s founders\..*Investors, advisors and explorers see a venture’s evidence only when its founders share it in Raise\..*Go to your home/s);
      assert.ok(!v.requests.some((q) => q.url.includes('/cycles/build')), `${role}: nothing is read`);
    } finally { await v.close(); }
  }
  const lab = await mounted({ props: { role: 'exploring', lab: true } });
  try { assert.ok(!lab.has('plan-not-founder') && lab.has('plan-progress'), 'a Spin-Out Lab founder keeps their plan'); } finally { await lab.close(); }
});

test('mounted VB22: on a phone, the chart and one card per item with its six dots, five at a time', async () => {
  const r = await mounted({ phone: true });
  try {
    assert.ok(r.has('plan-progress-phone') && !r.has('plan-progress-table') && !r.has('plan-progress-week'), 'no table and no weekly chart on a phone');
    assert.equal(r.count('plan-progress-card'), 5);
    await r.click('plan-progress-more');
    assert.equal(r.count('plan-progress-card'), 6);
  } finally { await r.close(); }
});

test('mounted VB6–VB8: Send to… chooses nothing for the founder, says what each tab opens, and records only on the press', async () => {
  const r = await mounted({ props: { tab: 'plan' } });
  try {
    assert.equal(r.textOf('plan-send-door'), 'Send to… · 5');
    await r.click('plan-send-door');
    assert.match(r.textOf('plan-send-opens'), /Build a clickable prototype in Lovable\./);
    assert.equal(r.props('plan-send-prepare').disabled, true, 'nothing is chosen for the founder');
    await r.change(`plan-send-item-${MUST}`, 'on');
    assert.equal(writes(r).length, 0, 'choosing sends nothing');
    assert.match(r.textOf('plan-send-note'), /Preparing records that you sent these items/);
    await r.click('plan-send-prepare');
    const post = writes(r)[0];
    assert.match(post.url, /\/api\/cycles\/build\/plan\/handoffs\?project=3&scope=venture$/);
    assert.deepEqual(post.body, { provider: 'lovable', items: [MUST] });
    assert.equal(r.textOf('plan-send-counter'), '521 / 4,000');
    assert.match(r.textOf('plan-send-privacy'), /Privacy check passed: no names, emails or quotes\./);
    assert.equal(r.props('plan-send-open').href, 'https://lovable.dev/?autosubmit=true#prompt=Build');
    assert.equal(r.props('plan-send-open').target, '_blank', 'it opens in the founder\'s own tool');
  } finally { await r.close(); }
});

test('mounted Send to…: GitHub not connected still gives issues to copy; connected sends the picked repository; Vercel needs one; a refusal names the item', async () => {
  const issue = { plan_item_uid: MUST, marker: 'VB-1111', title: 'One-day setup wizard', body: 'Axal VC plan item VB-1111' };
  const un = await mounted({ props: { tab: 'plan' }, handle: handler({ '/plan/handoffs?': { method: 'POST', answer: () => response({ provider: 'github', issues: [{ ...issue, url: null }], markdown: '## One-day setup wizard', repository: null, handoffs: [] }) } }) });
  try {
    await un.click('plan-send-door');
    await un.click('plan-send-tab-github');
    assert.match(un.textOf('plan-send-tab-github'), /GitHub· Not connected/);
    assert.match(un.textOf('plan-send-unconnected'), /Not connected\. Connect GitHub to pick a repository\./);
    await un.click('plan-send-tab-vercel');
    await un.change(`plan-send-item-${MUST}`, 'on');
    assert.equal(un.props('plan-send-prepare').disabled, true, 'Vercel imports from a repository the founder picked');
    await un.click('plan-send-tab-github');
    await un.click('plan-send-prepare');
    assert.deepEqual(writes(un)[0].body, { provider: 'github', items: [MUST] }, 'no repository is invented');
    assert.ok(un.has('plan-send-issue-copy') && !un.has('plan-send-issue-open'));
  } finally { await un.close(); }
  const con = await mounted({
    props: { tab: 'plan' },
    handle: handler({
      '/connectors/g-mine/repositories': { answer: () => response({ ok: true, selected: ['northwind/app'], available: ['northwind/app', 'northwind/site'] }) },
      '/plan/handoffs?': { method: 'POST', answer: () => response({ provider: 'github', issues: [{ ...issue, url: 'https://github.com/northwind/app/issues/new?title=x' }], markdown: '## x', repository: 'northwind/app', handoffs: [] }) },
      '/connectors': { answer: () => response({ ok: true, items: [{ uid: 'g-mine', provider_key: 'github', status: 'connected', config: { project_id: 3 } }] }) },
    }),
  });
  try {
    await con.click('plan-send-door');
    await con.click('plan-send-tab-github');
    assert.equal(con.props('plan-send-repo').value, 'northwind/app');
    await con.change(`plan-send-item-${MUST}`, 'on');
    await con.click('plan-send-prepare');
    assert.deepEqual(writes(con)[0].body, { provider: 'github', items: [MUST], repository: 'northwind/app' });
    assert.equal(con.props('plan-send-issue-open').href, 'https://github.com/northwind/app/issues/new?title=x');
    await con.click('plan-send-tab-notion');
    await con.click('plan-send-prepare');
    assert.deepEqual(writes(con)[1].body, { provider: 'notion', items: [MUST] }, 'a repository rides only with GitHub and Vercel');
  } finally { await con.close(); }
  const pii = await mounted({ props: { tab: 'plan' }, handle: handler({ '/plan/handoffs?': { method: 'POST', answer: () => response({ code: 'pii_found', message: 'x', findings: [{ kind: 'email', in: MUST }] }, 422) } }) });
  try {
    await pii.click('plan-send-door');
    await pii.change(`plan-send-item-${MUST}`, 'on');
    await pii.click('plan-send-prepare');
    assert.match(pii.textOf('plan-send-refused'), /The privacy check found a name, an email or a quote in “One-day setup wizard”\. Nothing was sent or recorded\./);
    assert.ok(!pii.has('plan-send-result-lovable'));
  } finally { await pii.close(); }
});

test('the wiring: the roles on both addresses, the card before CycleRoute, no browser pop-up, and every light hover has its dark pair', () => {
  const app = read('frontend/src/App.jsx');
  for (const [path, tab] of [['/build/plan', 'plan'], ['/build/plan/progress', 'progress']]) {
    const at = app.indexOf(`<Route path="${path}" element={`);
    const line = app.slice(at, app.indexOf('\n', at));
    assert.match(line, /labRoles\(\['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'\]\)/, path);
    assert.ok(line.includes(`planNotFounder ? <PlanNotFounder /> : <CycleRoute cycle="build" buildPlan="${tab}" />`), path);
  }
  assert.match(app, /const planNotFounder = \['investor', 'advisor', 'exploring'\]\.includes\(user\?\.role\) && user\?\.spinout_lab_active !== 1;/);
  for (const f of ['BuildPlan.jsx', 'BuildPlanProgress.jsx', 'BuildPlanSend.jsx', 'buildProgressModel.js']) {
    const src = read(`frontend/src/pages/cycles/${f}`);
    assert.doesNotMatch(src, /window\.(alert|confirm)|\balert\(|\bconfirm\(/, f);
    for (const cls of src.match(/['"`][^'"`]*\bhover:[^'"`]*['"`]/g) || []) {
      const light = (cls.match(/(?<!dark:)\bhover:/g) || []).length;
      const dark = (cls.match(/dark:hover:/g) || []).length;
      assert.ok(dark >= light, `${f}: a light hover without its dark pair in ${cls.slice(0, 80)}`);
    }
  }
});

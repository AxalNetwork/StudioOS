// D6909 part 4 (#6909, canvas PRM20 and PRM22): Eadwyn's drafts on a mark request — the investor's reason, which
// only fills the reason field, and HQ's basis and source, which only fill the mark's Prepare (never a value). Every run
// is quoted and runs only on Confirm. Sample data only; the Worker is a stub.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mark_drafts_6909.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import PortfolioPositionsPage from '../src/pages/PortfolioPositionsPage.jsx';
import { RequestSteps } from '../src/pages/investor/MarkRequestPanel.jsx';
import {
  BASIS_NOTE, NO_DRAFT, REASON_NOTE, REASON_OFF, draftError, holdLine, prepareSeed, proposalFacts, sourcesLine,
} from '../src/pages/portfolio/markDraftsModel.js';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/* ------------------------------------------------------------- the book */

const PROJECT = { id: 1, uid: 'northwind', name: 'Northwind Labs' };
const DETAIL = {
  project: PROJECT,
  rounds: [{ uid: 'r1', round_name: 'Seed', invested_amount: 1500000, ownership_pct: 6.2 }],
  cap_table_snapshot: [],
  marks: [{ uid: 'm1', as_of_date: '2026-03-31', fmv: 2400000, basis: 'round_price', event: 'Priced round' }],
  distributions: [{ uid: 'd1', distribution_date: '2026-05-01', amount: 900000, kind: 'secondary' }],
};
const MOVED = { ...DETAIL, marks: [{ uid: 'm2', as_of_date: '2026-09-30', fmv: 2250000, basis: 'gp_estimate' }, ...DETAIL.marks] };
const LIST = { items: [{ project_id: 1, project: PROJECT, total_invested: 1500000, rounds: 1, latest_ownership_pct: 6.2, latest_round: 'Seed' }] };
const STORED_MARK = {
  id: 41, uid: 'mk-7f3a', fund_id: null, project_id: 1, as_of_date: '2026-09-30', fmv: 2100000, post_money: null,
  event: 'Down round', basis: 'gp_estimate', source: 'Q3 board pack', note: null, created_by: 1, created_at: '2026-11-14T14:44:09.120Z',
};
const STORED_DIST = {
  id: 9, uid: 'ds-31c0', fund_id: null, project_id: 1, distribution_date: '2026-11-05', amount: 150000, kind: 'exit',
  note: 'Partial exit', created_by: 1, created_at: '2026-11-14T15:02:00Z',
};

/** The Worker: `detail` answers each company read in turn (the last repeats); `post` answers the write. */
function worker({ details = [DETAIL], post = () => json(STORED_MARK, 201), role = 'admin', extra = null } = {}) {
  let read = 0;
  return ({ path, method, body }) => {
    if (path === '/api/auth/me') return json({ id: 1, role, name: 'Ada' });
    if (method === 'GET' && path === '/api/positions') return json(LIST);
    if (method === 'GET' && path === '/api/positions/northwind') {
      const d = details[Math.min(read, details.length - 1)];
      read += 1;
      return typeof d === 'function' ? d() : json(d);
    }
    if (method === 'POST') return post({ path, body });
    if (extra) { const r = extra({ path, method, body }); if (r) return r; }
    return json({});
  };
}

async function mount(answer, { role = 'admin' } = {}) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(String(input), 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: u.pathname, method, body });
    return answer({ path: u.pathname, method, body }) ?? json({});
  };
  localStorage.setItem('user', JSON.stringify({ id: 1, role, name: 'Ada' }));
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join(' ') || node.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const squash = (s) => s.replace(/\s+/g, ' ').trim();
  const settle = async () => { for (let i = 0; i < 15; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/portfolio/positions'] }, h(AuthProvider, null, h(PortfolioPositionsPage, { embedded: true })))));
  await settle();
  const need = (node, what) => { if (!node) throw new Error(`no ${what}`); return node; };
  const fire = async (fn) => { await act(async () => { fn(); }); await settle(); };
  const api = {
    calls,
    posts: () => calls.filter((c) => c.method === 'POST'),
    has: (id) => Boolean(byTestId(id)),
    node: byTestId,
    prop: (id, name) => props(need(byTestId(id), id))[name],
    text: (id) => (id ? (byTestId(id) ? squash(textOf(byTestId(id))) : null) : squash(textOf(box))),
    step: (kind) => props(need(byTestId(`write-flow-${kind}`), 'flow'))['data-step'],
    click: (id) => fire(() => props(need(byTestId(id), id)).onClick({ preventDefault() {}, stopPropagation() {} })),
    clickText: (label) => fire(() => props(need(nodes().find((n) => n.tagName === 'BUTTON' && squash(textOf(n)) === label), label)).onClick({ preventDefault() {} })),
    type: (id, value) => fire(() => props(need(byTestId(id), id)).onChange({ target: { value } })),
    submit: (id) => fire(() => props(need(byTestId(id), id)).onSubmit({ preventDefault() {} })),
    value: (id) => props(need(byTestId(id), id)).value,
    closeSheet: () => fire(() => props(need(byTestId('portfolio-position-sheet-close'), 'the sheet’s close')).onClick()),
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; localStorage.removeItem('user'); restore(); },
  };
  return api;
}

const OPEN = {
  uid: 'rq-1', project_uid: 'northwind', project_name: 'Northwind Labs', kind: 'mark', reason: 'Latest mark is 7 months old.',
  state: 'open', created_at: '2026-11-03T10:00:00Z', requester: { name: '[Sample Investor]' }, evidence: null,
};
const queueAnd = (patch) => ({ path, method }) => {
  if (method === 'GET' && path === '/api/mark-requests/queue') return json({ items: [OPEN] });
  if (method === 'GET' && path === '/api/mark-requests') return json({ items: [OPEN] });
  if (method === 'PATCH' && path === '/api/mark-requests/rq-1') return patch();
  return null;
};


const QUOTE = { quote: { hold_microusd: 3000, model: 'synthetic-model', confirm_quote: 'confirm-1' } };
const REASON = { uid: 'd-reason', kind: 'reason', status: 'proposed', reason: 'The latest mark is from 31 Mar 2026; a Q2 report has come since.', sources: ['Mark of 31 Mar 2026', '2026-Q2 report, 29 Jul 2026'] };
const BASIS = { uid: 'd-basis', kind: 'basis', status: 'proposed', basis: 'gp_estimate', source: 'Q2 2026 report (29 Jul)', as_of_date: '2026-07-29', why: 'No priced round since.', sources: ['Mark of 31 Mar 2026'] };

test('the model: the hold line, sources in words, the proposal as Basis, Source and As of with no value, the seed, and each refusal', () => {
  assert.match(holdLine({ hold_microusd: 3000 }), /^Holds up to .+ · you pay what it uses$/);
  assert.equal(sourcesLine(REASON.sources), 'Sources: Mark of 31 Mar 2026 · 2026-Q2 report, 29 Jul 2026');
  assert.equal(sourcesLine([]), null);
  assert.deepEqual(proposalFacts(BASIS), [['Basis', 'GP estimate'], ['Source', 'Q2 2026 report (29 Jul)'], ['As of', '29 Jul 2026']]);
  // Mutation checked: copy every kept field into the seed → fmv reaches Prepare and this fails.
  assert.deepEqual(prepareSeed({ basis: 'gp_estimate', source: 'Q2', as_of_date: '2026-07-29', fmv: '750000' }), { basis: 'gp_estimate', source: 'Q2', as_of_date: '2026-07-29' });
  assert.equal(prepareSeed({}), null);
  assert.equal(draftError({ status: 503, data: { error: 'model_unavailable' } }, REASON_OFF), REASON_OFF);
  assert.match(draftError({ status: 403, data: { error: 'not_held' } }, REASON_OFF), /only about a company you hold/);
  assert.match(draftError({ status: 402, data: { error: 'quote_required' } }, REASON_OFF), /cost changed/);
  assert.match(BASIS_NOTE, /never a value/);
  assert.match(REASON_NOTE, /never sends a request/);
});

async function mountSteps(answer, onSend = async () => ({ kind: 'mark', state: 'open' })) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(String(input), 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: u.pathname, method, body });
    return answer({ path: u.pathname, method, body }) ?? json({});
  };
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join(' ') || node.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  const sends = [];
  const row = { key: 'p7', uid: 'p7', name: '[Sample Labs]', mark: { kind: 'marked' }, stale: true };
  await act(async () => root.render(h(RequestSteps, { row, latest: { date: '31 Mar 2026', age: '7 months old' }, onSend: async (x) => { sends.push(x); return onSend(x); }, onCancel: () => {} })));
  await settle();
  const need = (id) => { const n = byTestId(id); if (!n) throw new Error(`no ${id}`); return n; };
  return {
    calls, sends,
    has: (id) => !!byTestId(id),
    text: (id) => (byTestId(id) ? textOf(byTestId(id)).replace(/\s+/g, ' ').trim() : null),
    value: (id) => props(need(id)).value,
    click: async (id) => { await act(async () => { props(need(id)).onClick({ preventDefault() {} }); }); await settle(); },
    type: async (id, value) => { await act(async () => { props(need(id)).onChange({ target: { value } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; restore(); },
  };
}
const posts = (ui, tail) => ui.calls.filter((c) => c.method === 'POST' && c.path.endsWith(tail));

test('PRM20: the quote before the run; the draft with its sources; Accept fills the reason and sends nothing; Edit keeps the investor’s words', async () => {
  const ui = await mountSteps(({ path, body }) => {
    if (path.endsWith('/drafts/quote')) return json(QUOTE);
    if (path.endsWith('/drafts/run')) return json({ draft: REASON });
    if (path.endsWith('/drafts/d-reason/accept')) return json({ draft: { uid: 'd-reason', status: body?.reason ? 'edited' : 'accepted' }, kept: { reason: body?.reason || REASON.reason } });
    return null;
  });
  try {
    await ui.click('reason-draft-ask');
    assert.deepEqual(posts(ui, '/drafts/quote')[0].body, { kind: 'reason', project_uid: 'p7', request_kind: 'mark' });
    assert.equal(posts(ui, '/drafts/run').length, 0, 'a quote is not a run');
    await ui.click('reason-draft-run');
    // Mutation checked: run without the quote's confirmation → confirm_quote is missing and this fails.
    assert.equal(posts(ui, '/drafts/run')[0].body.confirm_quote, 'confirm-1');
    assert.equal(ui.text('reason-draft-sources'), 'Sources: Mark of 31 Mar 2026 · 2026-Q2 report, 29 Jul 2026');
    assert.equal(ui.value('input-mark-request-reason'), '', 'a draft fills nothing by itself');
    await ui.click('reason-draft-accept');
    assert.equal(ui.value('input-mark-request-reason'), REASON.reason);
    assert.equal(ui.sends.length, 0, 'Eadwyn never sends a request');
    assert.equal(ui.calls.filter((c) => c.path === '/api/mark-requests' && c.method === 'POST').length, 0);

    await ui.click('reason-draft-ask');
    await ui.click('reason-draft-run');
    await ui.click('reason-draft-edit-open');
    await ui.type('reason-draft-edit', 'My own words: the mark is stale.');
    await ui.click('reason-draft-keep');
    // Mutation checked: send the draft instead of the edit → this fails.
    assert.deepEqual(posts(ui, '/drafts/d-reason/accept')[1].body, { kind: 'reason', project_uid: 'p7', request_kind: 'mark', reason: 'My own words: the mark is stale.' });
    assert.equal(ui.value('input-mark-request-reason'), 'My own words: the mark is stale.');
  } finally { await ui.close(); }
});

test('PRM20: unavailable says the reason can be written by hand; nothing usable says so', async () => {
  let up = true;
  const ui = await mountSteps(({ path }) => {
    if (path.endsWith('/drafts/quote')) return up ? json(QUOTE) : json({ error: 'model_unavailable', message: 'down' }, 503);
    if (path.endsWith('/drafts/run')) return json({ draft: null });
    return null;
  });
  try {
    await ui.click('reason-draft-ask');
    await ui.click('reason-draft-run');
    assert.equal(ui.text('reason-draft-notice'), NO_DRAFT);
    up = false;
    await ui.click('reason-draft-ask');
    assert.equal(ui.text('reason-draft-notice'), REASON_OFF);
  } finally { await ui.close(); }
});

test('PRM22: on a queue row, HQ’s proposal shows Basis, Source and As of; Accept fills Prepare and leaves the value to HQ; nothing is recorded', async () => {
  const page = await mount(worker({
    post: ({ path }) => {
      if (path.endsWith('/drafts/quote')) return json(QUOTE);
      if (path.endsWith('/drafts/run')) return json({ draft: BASIS });
      if (path.endsWith('/drafts/d-basis/accept')) return json({ draft: { uid: 'd-basis', status: 'accepted' }, kept: { basis: 'gp_estimate', source: BASIS.source, as_of_date: '2026-07-29' } });
      return json(STORED_MARK, 201);
    },
    extra: queueAnd(() => json({})),
  }));
  try {
    await page.click('button-queue-record-rq-1');
    assert.match(page.text('basis-proposal'), /On the request from .+ for Northwind Labs/);
    await page.click('basis-proposal-ask');
    assert.deepEqual(page.calls.filter((c) => c.path.endsWith('/drafts/quote'))[0].body, { kind: 'basis', request_uid: 'rq-1' });
    await page.click('basis-proposal-run');
    assert.equal(page.text('basis-proposal-basis'), 'GP estimate');
    assert.equal(page.text('basis-proposal-source'), 'Q2 2026 report (29 Jul)');
    assert.equal(page.text('basis-proposal-as-of'), '29 Jul 2026');
    assert.doesNotMatch(page.text('basis-proposal'), /FMV|value of|\$/i, 'the proposal shows no value');
    await page.click('basis-proposal-accept');
    assert.equal(page.step('mark'), 'prepare');
    // Mutation checked: drop the seed → Prepare opens on the default basis and today, and this fails.
    assert.equal(page.value('input-mark-basis'), 'gp_estimate');
    assert.equal(page.value('input-mark-source'), 'Q2 2026 report (29 Jul)');
    assert.equal(page.value('input-mark-as_of_date'), '2026-07-29');
    assert.equal(page.value('input-mark-fmv'), '', 'the value stays HQ’s to enter');
    assert.match(page.text('write-flow-context'), /Answers the request from/);
    assert.equal(page.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/marks')).length, 0, 'accepting records no mark');
  } finally { await page.close(); }
});

test('PRM22: a mark opened from the sheet has no proposal panel and no seed', async () => {
  const page = await mount(worker({ extra: queueAnd(() => json({})) }));
  try {
    await page.clickText('View dilution');
    await page.click('button-mark-open');
    assert.equal(page.has('basis-proposal'), false);
    assert.equal(page.value('input-mark-source'), '');
  } finally { await page.close(); }
});

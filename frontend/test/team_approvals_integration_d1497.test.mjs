// D1497 (#3727): exercise the merged Team clients and TM7 on the Worker's
// actual queue shape. Synthetic proposals only; no model or network runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import * as adapter from '../src/pages/team/agentsAdapter.js';
import ApprovalsTab from '../src/pages/team/ApprovalsTab.jsx';
import { queueProposal } from '../src/pages/team/teamModel.js';

const h = React.createElement;
const SCOPE = { kind: 'company', company: { uid: 'company-one', name: 'Synthetic company' } };
const ROLES = [{ key: 'cfo', works_in: [{ key: 'use-of-funds', label: 'Use of funds' }] }];
const ITEM = {
  uid: 'proposal-one', headline: 'Synthetic runway draft', payload: { text: 'First draft\nSecond line', source_key: 'synthetic' },
  status: 'proposed', module: 'use-of-funds', option: 'draft:runway', created_at: '2026-10-31 09:00:00',
  agent: { uid: 'agent-one', first_name: 'Synthetic', last_name: 'Agent', role_key: 'cfo' },
  sponsor: { uid: 'sponsor-one', name: 'Synthetic sponsor' }, cost: { available: true, value_microusd: 40_000 },
  decided_at: null, decided_by: null,
};
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const page = (items = [], next = null) => ({ items, counts: { proposed: { available: true, value: items.length } }, next_cursor: next });

async function mount({ canManage = true, viewerUid = 'reader-one', handle, ...extra } = {}) {
  const restore = installDocument();
  const fetch = globalThis.fetch;
  const seen = [];
  let saved = { ...ITEM, payload: { ...ITEM.payload } };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://test');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    seen.push({ path: u.pathname, status: u.searchParams.get('status'), cursor: u.searchParams.get('cursor'), method, body });
    const own = await handle?.(u, init, body);
    if (own) return own;
    if (u.pathname.endsWith('/decide')) {
      saved = { ...saved, payload: body.payload || saved.payload, status: { accept: 'accepted', edit: 'edited', discard: 'discarded' }[body.decision], decided_by: { uid: 'human', name: 'Synthetic reviewer' }, decided_at: '2026-10-31 10:00:00' };
      return response({ item: saved });
    }
    if (u.pathname === '/api/teams/queue/proposal-one') return response({ item: saved, inputs: [{ source: 'request', summary: 'What the sponsor asked.', read_only: true }] });
    if (u.pathname.endsWith('/queue')) return response(page((u.searchParams.get('status') || 'proposed') === saved.status ? [saved] : []));
    throw new Error(`Unexpected route: ${u.pathname}`);
  };
  const box = document.createElement('div'); document.body.appendChild(box);
  const root = createRoot(box);
  let props = { scope: SCOPE, roles: ROLES, canManage, viewerUid, ...extra };
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const draw = async (patch = {}) => { props = { ...props, ...patch }; await act(async () => root.render(h(ApprovalsTab, props))); await settle(); };
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
  const nodes = () => walk(document.body);
  const byId = (id) => nodes().find((n) => pr(n)['data-testid'] === id);
  const button = (name) => nodes().filter((n) => n.tagName === 'BUTTON' && text(n) === name).at(-1);
  const click = async (n) => { assert.ok(n, 'button exists'); assert.ok(!pr(n).disabled, 'button enabled'); await act(async () => { pr(n).onClick(); }); await settle(); };
  await draw();
  return { seen, settle, draw, pr, text: () => text(document.body), nodes, byId, button, click,
    async close() { await act(async () => root.unmount()); globalThis.fetch = fetch; restore(); },
  };
}

test('all six merged adapter operations reach the mounted API, preserving the quote, tools and edited payload', async () => {
  const restore = installDocument(); const before = globalThis.fetch; const seen = [];
  globalThis.fetch = async (u, init = {}) => { seen.push({ url: String(u), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }); return response({ marker: seen.length }); };
  try {
    const opts = { module: 'use-of-funds', option: 'draft:runway' };
    assert.deepEqual(await adapter.runQuote('agent-one', opts), { available: true, value: { marker: 1 } });
    assert.deepEqual(await adapter.runAgent('agent-one', { ...opts, record: 'project:7', prompt: 'Synthetic', toolReads: [{ tool: 'read' }] }), { available: true, value: { marker: 2 } });
    assert.deepEqual(await adapter.queue('company', 'company-one', { status: 'edited', cursor: '25' }), { available: true, value: { marker: 3 } });
    assert.deepEqual(await adapter.queueItem('proposal-one'), { available: true, value: { marker: 4 } });
    assert.deepEqual(await adapter.decide('proposal-one', { decision: 'edit', payload: { text: 'Human edit' } }), { available: true, value: { marker: 5 } });
    assert.deepEqual(await adapter.toolChoices(), { available: true, value: { marker: 6 } });
    assert.deepEqual(seen.map((s) => s.url), [
      '/api/teams/agents/agent-one/run/quote?module=use-of-funds&option=draft%3Arunway', '/api/teams/agents/agent-one/run',
      '/api/teams/company/company-one/queue?status=edited&cursor=25', '/api/teams/queue/proposal-one', '/api/teams/queue/proposal-one/decide', '/api/teams/tools',
    ]);
    assert.deepEqual(seen[1].body.tool_reads, [{ tool: 'read' }]);
    assert.deepEqual(seen[4].body, { decision: 'edit', payload: { text: 'Human edit' } });
  } finally { globalThis.fetch = before; restore(); }
});

test('run refusals and a second decision keep their words, status and decider; missing tools are not an empty list', async () => {
  const refuse = (status, data) => adapter.through(async () => { throw { status, data, message: data.message }; });
  assert.deepEqual(await refuse(402, { code: 'agent_cap_reached' }), { available: false, refused: true, code: 'agent_cap_reached', reason: 'Reached its monthly cap' });
  assert.equal((await refuse(503, { code: 'run_quote_unreadable', message: 'This run could not be priced. Nothing was charged.' })).reason, 'This run could not be priced. Nothing was charged.');
  assert.equal((await refuse(403, { code: 'not_sponsor' })).reason, 'Only this agent’s sponsor can run it.');
  const closed = await refuse(409, { code: 'not_open', status: 'edited', decided_by: { name: 'Synthetic reviewer' }, decided_at: '2026-10-31 10:00:00' });
  assert.deepEqual(closed.decided, { by: { name: 'Synthetic reviewer' }, at: '2026-10-31 10:00:00', decision: 'edited' });
  assert.equal((await refuse(409, { code: 'not_open', status: 'withdrawn' })).decided.decision, 'withdrawn');
  assert.equal((await refuse(404, { code: 'custom_mcp_off' })).available, false);
  assert.equal((await refuse(502, {})).unreadable, true);
});

test('a real queue DTO supplies the title, date and module; absent spend/model stay unrecorded and permissions stay narrow', () => {
  const view = queueProposal(ITEM, { roles: ROLES });
  assert.equal(view.title, ITEM.headline); assert.equal(view.proposed_at, ITEM.created_at); assert.equal(view.module_label, 'Use of funds');
  assert.equal(view.draft, ITEM.payload.text); assert.equal(view.can_decide, false); assert.equal(view.model_label, undefined);
  assert.equal(queueProposal(ITEM, { viewerUid: 'sponsor-one' }).can_decide, true);
  assert.equal(queueProposal(ITEM, { viewerUid: 'someone-else' }).can_decide, false);
  assert.equal(queueProposal(ITEM, { canManage: true }).can_decide, true);
  assert.equal(queueProposal({ ...ITEM, cost: { available: false } }).cost.available, false);
  assert.equal(queueProposal({ ...ITEM, payload: { total: 0, enabled: false } }).draft, 'total: 0\nenabled: false');
});

test('TM7 loads open and decided proposals; Edit reads fresh detail, then sends the actual human edit once', async () => {
  let changed = 0; const hold = deferred();
  const v = await mount({ onChanged: () => { changed += 1; }, handle: (u) => u.pathname.endsWith('/decide') ? hold.promise : null });
  try {
    assert.deepEqual(v.seen.filter((s) => s.path.endsWith('/queue')).map((s) => s.status).sort(), ['accepted', 'discarded', 'edited', 'proposed', 'withdrawn']);
    assert.match(v.text(), /Synthetic runway draft/); assert.match(v.text(), /Use of funds/); assert.match(v.text(), /\$0.04/);
    await v.click(v.button('Edit'));
    assert.equal(v.seen.filter((s) => s.path === '/api/teams/queue/proposal-one').length, 1);
    assert.match(v.text(), /What the sponsor asked\./);
    const input = v.nodes().find((n) => v.pr(n)['aria-label'] === 'Edit proposal');
    assert.ok(input); assert.equal(v.pr(input).value, ITEM.payload.text);
    await act(async () => { v.pr(input).onChange({ target: { value: 'Human approved wording' } }); });
    const save = v.button('Save edited proposal');
    await act(async () => { v.pr(save).onClick(); v.pr(save).onClick(); });
    assert.deepEqual(v.seen.filter((s) => s.method === 'POST').map((s) => s.body), [{ decision: 'edit', payload: { text: 'Human approved wording', source_key: 'synthetic' } }]);
    hold.resolve(response({ item: { ...ITEM, status: 'edited' } })); await v.settle();
    assert.equal(changed, 1); assert.equal(v.byId('proposal-sheet'), undefined);
    assert.equal(v.seen.filter((s) => s.status === 'proposed').length, 2, 're-read after the human decides');
  } finally { hold.resolve(response({ item: ITEM })); await v.close(); }
});

test('a reader only views; the sponsor can decide; an already decided proposal has no write controls', async () => {
  const v = await mount({ canManage: false });
  try {
    assert.equal(v.button('Accept'), undefined); assert.equal(v.button('Edit'), undefined);
    await v.click(v.button('View'));
    assert.equal(v.button('Accept'), undefined); assert.equal(v.button('Discard'), undefined);
    assert.equal(v.seen.filter((s) => s.method === 'POST').length, 0);
  } finally { await v.close(); }
  const sponsor = await mount({ canManage: false, viewerUid: 'sponsor-one' });
  try { assert.ok(sponsor.button('Accept')); } finally { await sponsor.close(); }
});

test('a refused second decision shows who decided and how, and disables further decisions', async () => {
  const v = await mount({ handle: (u) => u.pathname.endsWith('/decide') ? response({ code: 'not_open', status: 'edited', decided_by: { name: 'Synthetic reviewer' }, decided_at: '2026-10-31 10:00:00' }, 409) : null });
  try {
    await v.click(v.button('Discard')); await v.click(v.button('Discard'));
    assert.match(v.text(), /Edited 31 Oct 10:00 by Synthetic reviewer\./);
    assert.equal(v.byId('proposal-sheet') && v.nodes().some((n) => n.tagName === 'BUTTON' && v.pr(n).children === 'Save edited proposal'), false);
    assert.equal(v.seen.filter((s) => s.method === 'POST').length, 1);
  } finally { await v.close(); }
});

test('history is served from decided statuses, including its real decider; a partial failure never claims none', async () => {
  const v = await mount({ handle: (u) => u.pathname.endsWith('/queue') && u.searchParams.get('status') === 'accepted'
    ? response(page([{ ...ITEM, uid: 'accepted-one', status: 'accepted', headline: 'Accepted synthetic draft', decided_by: { name: 'Synthetic reviewer' }, decided_at: '2026-10-31 10:00:00' }]))
    : u.pathname.endsWith('/queue') && u.searchParams.get('status') === 'discarded' ? response({ message: 'Unreadable' }, 500) : null });
  try {
    assert.match(v.text(), /Accepted synthetic draft/); assert.match(v.text(), /Synthetic reviewer/);
    assert.match(v.text(), /Decided proposals could not be read/); assert.doesNotMatch(v.text(), /Nothing decided yet/);
  } finally { await v.close(); }
});

test('pagination uses the server cursor and status, appends the page and never invents a total', async () => {
  const v = await mount({ handle: (u) => {
    if (!u.pathname.endsWith('/queue') || u.searchParams.get('status') !== 'proposed') return null;
    return response(u.searchParams.get('cursor') ? page([{ ...ITEM, uid: 'proposal-two', headline: 'Second page proposal' }]) : page([ITEM], '25'));
  } });
  try {
    await v.click(v.button('More open proposals'));
    assert.match(v.text(), /Second page proposal/); assert.match(v.text(), /2 shown/); assert.doesNotMatch(v.text(), /of 2/);
    assert.equal(v.seen.filter((s) => s.cursor === '25' && s.status === 'proposed').length, 1);
    assert.equal(v.button('More open proposals'), undefined);
  } finally { await v.close(); }
});

test('an old team response or late detail cannot leak into a newly selected company', async () => {
  const pending = deferred(); const detail = deferred();
  const v = await mount({ handle: (u) => {
    if (u.pathname.includes('/company/slow-team/queue')) return pending.promise;
    if (u.pathname.includes('/company/empty-team/queue')) return response(page());
    if (u.pathname === '/api/teams/queue/proposal-one') return detail.promise;
    return null;
  } });
  try {
    await v.click(v.button('Discard'));
    await v.draw({ scope: { kind: 'company', company: { uid: 'slow-team', name: 'Slow company' } } });
    await v.draw({ scope: { kind: 'company', company: { uid: 'empty-team', name: 'Empty company' } }, handle: undefined });
    detail.resolve(response({ item: { ...ITEM, headline: 'Old detail must stay hidden' }, inputs: [] }));
    pending.resolve(response(page([{ ...ITEM, headline: 'Old team must stay hidden' }]))); await v.settle();
    assert.doesNotMatch(v.text(), /Old detail must stay hidden|Old team must stay hidden/);
    assert.equal(v.byId('proposal-sheet'), undefined);
    assert.match(v.text(), /Nothing is waiting for a decision/);
  } finally { await v.close(); }
});

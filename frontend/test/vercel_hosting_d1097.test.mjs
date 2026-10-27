/**
 * D1097 (#2962, Vercel part 2) — Operating systems' Hosting block (VC1, VC5,
 * VC6a) and Solution design's "From Vercel · Runs on" (VC4a), drawn from the
 * Worker's own shapes (`services/vercel/hosting.ts`) with a stubbed fetch;
 * Vercel is never reached.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/vercel_hosting_d1097.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import HostingFromVercel, { day, healthLine, hostingView, reconnectSentence, stamp } from '../src/pages/cycles/HostingFromVercel.jsx';
import RunsOnFromVercel, { runsOnView } from '../src/pages/cycles/RunsOnFromVercel.jsx';
import { BUILD_PARTS, builtParts } from '../src/pages/cycles/buildParts.jsx';

const h = React.createElement;
const FACTS = { project: 'acme-web', domain: 'app.acme.example', framework: 'nextjs', runtime: 'Node 20.x', branch: 'main', repository: null, plan: 'Hobby',
  live: { state: 'live', words: 'Live', since: '2026-10-03T10:00:00.000Z' } };
const SYSTEM = (o = {}) => ({
  kind: 'hosting', system: 'Hosting', provider: 'Vercel', source_label: 'From the Vercel connection', state: 'Connected',
  last_sync: '2026-10-23 09:12:00', owner: 'You', sync_uid: 'vc-1', action: { text: 'Open', href: '/build/connect?tool=vercel&project_id=101' },
  projects: [FACTS], projects_total: 1, projects_reason: null,
  hobby: { text: 'Production runs on a personal Vercel account, Hobby plan.', link: { text: 'See the proposal in Company creation', href: '/build/company-creation?project_id=101#from-vercel' } },
  reconnect: null,
  health: { open: 1, closed: 1, items: [
    { id: 7, kind: 'domain_misconfigured', words: 'Domain is misconfigured', subject: 'www.acme.example', state: 'open', opened_at: '2026-10-18T08:00:00.000Z', closed_at: null },
    { id: 8, kind: 'production_failed', words: 'Production deploy failed', subject: 'dpl_1', state: 'closed', opened_at: '2026-10-12T08:00:00.000Z', closed_at: '2026-10-13T08:00:00.000Z' },
  ] },
  ...o,
});
const HOSTING = (o = {}, sys = {}) => ({ state: 'ok', systems: [SYSTEM(sys)], reason: null,
  syncs: { state: 'ok', rows: [{ id: 'vercel-sync-1', state: 'done', text: 'Synced: 1 project, 14 deployments, 2 health events', error: null }] }, ...o });

test('the words: stamps in UTC, the reconnect sentence, each health line, and each view’s state', () => {
  assert.equal(stamp('2026-10-23 09:12:00'), '23 Oct 2026, 09:12');
  assert.equal(stamp(null), null);
  assert.equal(day('2026-10-20T08:00:00.000Z'), '20 Oct');
  assert.equal(reconnectSentence({ project: 'acme-web', expired_at: '2026-10-20 08:00:00', as_of: '2026-10-19 07:00:00' }), 'Vercel’s sign-in for acme-web expired on 20 Oct. Figures are as of 19 Oct.');
  assert.equal(reconnectSentence({ project: null, expired_at: null, as_of: null }), 'Vercel’s sign-in expired. No figures were read before it expired.');
  assert.deepEqual(healthLine(SYSTEM().health.items[0]), { open: true, text: 'Domain is misconfigured · www.acme.example', when: 'since 18 Oct' });
  assert.deepEqual(healthLine(SYSTEM().health.items[1]), { open: false, text: 'Production deploy failed · dpl_1', when: 'closed 13 Oct' });
  assert.equal(hostingView(undefined).state, 'none');
  assert.equal(hostingView({ state: 'not_recorded' }).state, 'none');
  assert.deepEqual(hostingView({ state: 'unreadable', reason: 'Unreadable: Vercel could not be read. The rest of this page is current.' }).state, 'unreadable');
  assert.equal(hostingView(HOSTING()).sync, 'Synced: 1 project, 14 deployments, 2 health events');
  assert.deepEqual([hostingView(HOSTING({ syncs: { state: 'ok', rows: [{ state: 'failed', error: 'Vercel’s sign-in expired. Reconnect Vercel.' }] } })).sync,
    hostingView(HOSTING({ syncs: { state: 'ok', rows: [{ state: 'failed', error: 'x' }] } })).syncFailed], ['Vercel’s sign-in expired. Reconnect Vercel.', true]);
  assert.equal(runsOnView({ state: 'empty', items: [], reason: 'Vercel has not brought anything to this venture yet.' }).state, 'none', 'no connection: nothing drawn on Solution design');
  assert.equal(runsOnView({ state: 'empty', items: [], reason: 'No Vercel project is chosen for this venture yet.' }).state, 'empty');
  assert.deepEqual(runsOnView({ state: 'ok', items: null, total: 2 }), { state: 'members_only', total: 2, asOf: null });
});

test('buildParts: the two #2962 lines draw; the other Vercel tasks keep their null lines', () => {
  assert.deepEqual(builtParts('operating-systems').map(([k]) => k), ['tools', 'vercel']);
  // D1088 (#2953) draws From Notion after Runs on; D1093 (#2958) From Google between them.
  assert.deepEqual(builtParts('solution-design').map(([k]) => k), ['github', 'vercel', 'google', 'notion']);
  for (const slug of ['prototype-mvp', 'product-roadmap', 'company-creation']) {
    assert.ok(BUILD_PARTS[slug].some(([k, r]) => k === 'vercel' && r === null), `${slug}'s Vercel line stays its own task's`);
  }
});

const response = (body, status = 200) => ({
  ok: status < 400, status, type: 'basic', redirected: false,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body, text: async () => JSON.stringify(body),
});

async function mounted(Component, props, answer = () => response({ ok: true })) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const requests = [];
  let reloads = 0;
  globalThis.fetch = async (u, o = {}) => {
    if (String(u).includes('/client-error')) return response({});
    requests.push([o.method || 'GET', String(u).replace(/^.*\/api/, '')]);
    return answer(String(u));
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(Component, { ...props, projectId: 101, reload: () => { reloads += 1; } }))));
  const flush = () => act(async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props_(n)['data-testid'] === id);
  return {
    requests, reloads: () => reloads, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), all: () => text(document.body),
    href: (id) => props_(byId(id)).to ?? props_(byId(id)).href,
    allOf: (prefix) => nodes().filter((n) => String(props_(n)['data-testid'] || '').startsWith(prefix)).map(text),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('mounted VC1: the sync line, as of, the facts with Not recorded, live since, Health Open and Closed, the Hobby line', async () => {
  const r = await mounted(HostingFromVercel, { hosting: HOSTING() });
  try {
    assert.equal(r.textOf('hosting-vercel-syncline'), 'Synced: 1 project, 14 deployments, 2 health events');
    assert.equal(r.textOf('hosting-vercel-asof'), 'as of 23 Oct 2026, 09:12');
    assert.deepEqual(r.allOf('hosting-vercel-fact-'), ['acme-web', 'app.acme.example', 'nextjs', 'Node 20.x', 'main', 'Not recorded']);
    assert.equal(r.textOf('hosting-vercel-live'), 'Live since 3 Oct');
    assert.match(r.textOf('hosting-vercel-event-7'), /^OpenDomain is misconfigured · www\.acme\.examplesince 18 OctDismiss$/);
    assert.match(r.textOf('hosting-vercel-event-8'), /^ClosedProduction deploy failed · dpl_1closed 13 Oct$/);
    assert.ok(!r.has('hosting-vercel-dismiss-8'), 'a closed event has nothing to dismiss');
    assert.match(r.textOf('hosting-vercel-hobby'), /^Production runs on a personal Vercel account, Hobby plan\.See the proposal in Company creation$/);
    assert.deepEqual(r.requests, [], 'drawing reads and writes nothing');
  } finally { await r.close(); }
});

test('Sync again is the owner’s: it syncs the connection once and reloads; a failure says nothing changed', async () => {
  const r = await mounted(HostingFromVercel, { hosting: HOSTING() });
  try {
    await r.click('hosting-vercel-sync');
    assert.deepEqual(r.requests, [['POST', '/connectors/vc-1/sync']]);
    assert.equal(r.reloads(), 1);
  } finally { await r.close(); }
  const member = await mounted(HostingFromVercel, { hosting: HOSTING({}, { sync_uid: null, owner: 'One' }) });
  try { assert.ok(!member.has('hosting-vercel-sync'), 'someone else’s connection has no Sync again'); } finally { await member.close(); }
  const down = await mounted(HostingFromVercel, { hosting: HOSTING() }, () => response({ error: 'sync_failed', message: 'The sync did not complete. Check the connection and try again.' }, 502));
  try {
    await down.click('hosting-vercel-sync');
    assert.equal(down.reloads(), 0);
    assert.match(down.textOf('hosting-vercel-error'), /did not complete/);
  } finally { await down.close(); }
});

test('Dismiss opens an in-page dialog that says what it changes; Cancel writes nothing; Dismiss deletes once and reloads', async () => {
  const r = await mounted(HostingFromVercel, { hosting: HOSTING() });
  try {
    await r.click('hosting-vercel-dismiss-7');
    assert.equal(r.textOf('hosting-vercel-dialog-sentence'), '“Domain is misconfigured · www.acme.example” leaves this page and does not come back while Vercel still shows it.');
    assert.match(r.all(), /Nothing changes on Vercel\./);
    await r.click('hosting-vercel-cancel');
    assert.deepEqual(r.requests, []);
    assert.ok(!r.has('hosting-vercel-dialog'));
    await r.click('hosting-vercel-dismiss-7');
    await r.click('hosting-vercel-confirm');
    assert.deepEqual(r.requests, [['DELETE', '/cycles/build/vercel/health-events/7?project=101']]);
    assert.equal(r.reloads(), 1);
    assert.ok(!r.has('hosting-vercel-dialog'));
  } finally { await r.close(); }
  const refused = await mounted(HostingFromVercel, { hosting: HOSTING() }, () => response({ error: 'closed', detail: 'That health event has closed, so there is nothing to dismiss.' }, 409));
  try {
    await refused.click('hosting-vercel-dismiss-7');
    await refused.click('hosting-vercel-confirm');
    assert.ok(refused.has('hosting-vercel-dialog-error'), 'the refusal stays in the dialog');
    assert.equal(refused.reloads(), 0);
  } finally { await refused.close(); }
});

test('the Tools rule as drawn: a non-member reads counts, never a project, a domain or the Hobby line', async () => {
  const r = await mounted(HostingFromVercel, { hosting: HOSTING({}, { projects: null, projects_total: 2, hobby: null, sync_uid: null, owner: null, health: { open: 1, closed: 3, items: null } }) });
  try {
    assert.equal(r.textOf('hosting-vercel-projects-count'), '2 projects from Vercel. Only the company’s members see which.');
    assert.equal(r.textOf('hosting-vercel-health-counts'), '1 open, 3 closed in the last 30 days.');
    assert.doesNotMatch(r.all(), /acme|Hobby/);
  } finally { await r.close(); }
});

test('VC5: Empty with Choose projects, Unreadable with Try again, and an expired sign-in with Reconnect Vercel and no Sync again', async () => {
  const empty = await mounted(HostingFromVercel, { hosting: { state: 'empty', systems: [], reason: 'Vercel has not brought anything to this venture yet.' } });
  try {
    assert.match(empty.textOf('hosting-vercel-empty'), /^Vercel has not brought anything to this venture yet\.Choose projects$/);
    assert.equal(empty.href('hosting-vercel-choose'), '/build/connect?tool=vercel&project_id=101');
  } finally { await empty.close(); }
  const down = await mounted(HostingFromVercel, { hosting: { state: 'unreadable', systems: [], reason: 'Unreadable: Vercel could not be read. The rest of this page is current.' } });
  try {
    assert.match(down.textOf('hosting-vercel-unreadable'), /^Unreadable: Vercel could not be read\. The rest of this page is current\.Try again$/);
    await down.click('hosting-vercel-retry');
    assert.equal(down.reloads(), 1);
  } finally { await down.close(); }
  const lost = await mounted(HostingFromVercel, { hosting: HOSTING({}, { state: 'Reconnect', reconnect: { project: 'acme-web', expired_at: '2026-10-20 08:00:00', as_of: '2026-10-20 07:00:00' } }) });
  try {
    assert.match(lost.textOf('hosting-vercel-reconnect'), /^Vercel’s sign-in for acme-web expired on 20 Oct\. Figures are as of 20 Oct\.Reconnect Vercel$/);
    assert.equal(lost.href('hosting-vercel-reconnect-link'), '/build/connect?tool=vercel&project_id=101');
    assert.ok(!lost.has('hosting-vercel-sync'), 'an expired sign-in cannot sync; Reconnect is the way');
  } finally { await lost.close(); }
  const none = await mounted(HostingFromVercel, { hosting: { state: 'not_recorded', systems: [] } });
  try { assert.ok(!none.has('cycle-part-hosting-vercel'), 'a venture with no company draws no Hosting block'); } finally { await none.close(); }
});

test('mounted VC4a: Runs on per project with Not recorded, a count for a non-member, nothing with no connection, Unreadable on its own', async () => {
  const PART = { state: 'ok', reason: null, as_of: '2026-10-23 09:12:00', total: 1,
    items: [{ project: 'acme-web', framework: 'nextjs', runtime: 'Node 20.x', hosting: 'Vercel', domain: 'app.acme.example', branch: 'main', repository: null }] };
  const r = await mounted(RunsOnFromVercel, { part: PART });
  try {
    assert.equal(r.textOf('runs-on-asof'), 'as of 23 Oct 2026, 09:12');
    assert.deepEqual(r.allOf('runs-on-0-'), ['nextjs', 'Node 20.x', 'Vercel', 'app.acme.example', 'main', 'Not recorded']);
    assert.match(r.all(), /^From Vercel · Runs on/);
  } finally { await r.close(); }
  const outside = await mounted(RunsOnFromVercel, { part: { ...PART, items: null } });
  try { assert.equal(outside.textOf('runs-on-count'), '1 project from Vercel. Only the company’s members see which.'); } finally { await outside.close(); }
  const none = await mounted(RunsOnFromVercel, { part: { state: 'empty', items: [], reason: 'Vercel has not brought anything to this venture yet.' } });
  try { assert.ok(!none.has('cycle-part-runs-on-vercel')); } finally { await none.close(); }
  const down = await mounted(RunsOnFromVercel, { part: { state: 'unreadable', items: [], reason: 'Unreadable: Vercel could not be read. The rest of this page is current.' } });
  try { assert.match(down.textOf('runs-on-unreadable'), /^Unreadable: Vercel could not be read\. The rest of this page is current\.Try again$/); } finally { await down.close(); }
});

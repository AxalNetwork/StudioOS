/**
 * D1321 (#3482) follow-up — where Grow opens Publish to…, on part 2's gate
 * (D1333): the header's Publish to… (PUB1) and PUB8's empty states, "Published
 * from here", the pre-filled draft with its source chip and what it left out,
 * and Publish to… on a sent update. Every read is a stand-in; every account,
 * company and post is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/publish_entry_d1321.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { droppedLines } from '../src/pages/cycles/publish/publishModel.js';
import { PublishTo, PublishUpdate, PublishedFromHere } from '../src/pages/cycles/publish/PublishEntry.jsx';
import UpdatesHistory from '../src/pages/cycles/UpdatesHistory.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;
const P = 701;

const gate = (over = {}) => ({ state: 'ok', module: 'product-improvement', can_publish: true, destinations_on: 1, empty: null, recent: [], ...over });
const PREFILL = 'Shipped: Bulk CSV import\nShipped: Faster search';

function stubApi(over = {}) {
  const calls = [];
  const api = {
    destinations: async (p) => { calls.push(['destinations', p]); return { can_publish: true, connections: [{ uid: 'i', provider_key: 'x', destinations: [{ uid: 'd-x', provider_key: 'x', account: '@northwind_demo', audience: 'Public', enabled: true, retract: 'delete' }] }] }; },
    createDraft: async (b) => {
      calls.push(['createDraft', b]);
      if (over.createFails) throw new Error('Publishing could not finish that request. Nothing was sent.');
      return { draft: { uid: 'draft-1', body: { text: b.text ? b.text : PREFILL } }, prefill: b.text ? null : { chip: 'From Product improvement · 2 shipped items · Oct 2026', lines: over.lines ?? 2, dropped: over.dropped || { team_only: 0, not_recorded: 0, unnamed: 0 } } };
    },
    draftFromUpdate: async (uid) => { calls.push(['draftFromUpdate', uid]); return { draft_uid: 'draft-u', prefill: { chip: 'From Updates · 3 lines · Oct 2026', lines: 3, dropped: { team_only: 1, not_recorded: 0, unnamed: 0 } } }; },
    draft: async (uid) => { calls.push(['draft', uid]); return { draft: { uid, body: { text: 'October update\nWe are looking for: design partners' } } }; },
    saveDraft: async (uid, b) => { calls.push(['saveDraft', uid, b]); return { draft: { uid } }; },
    archiveDraft: async (uid) => { calls.push(['archiveDraft', uid]); return { archived: true }; },
    preview: async (uid, uids) => { calls.push(['preview', uid, uids]); return { previews: [] }; },
    updateGate: async (uid) => {
      calls.push(['updateGate', uid]);
      if (over.gateError) throw over.gateError;
      return { update: uid, publish: over.updateGate || gate({ module: 'updates' }) };
    },
  };
  return { api, calls };
}

async function mount(element) {
  const restore = installDocument('', { focus: true });
  const add = document.addEventListener;
  document.addEventListener = () => {};
  const mk = document.createElement.bind(document);
  document.createElement = (tag) => { const n = mk(tag); n.querySelector = () => null; n.querySelectorAll = () => []; return n; };
  document.querySelectorAll = () => [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (!n ? '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, element)));
  await settle();
  const need = (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return n; };
  return {
    has: (id) => !!byId(id), text: (id) => text(id ? need(id) : container), props: (id) => pr(need(id)),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.({ preventDefault() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); document.addEventListener = add; restore(); },
  };
}

test('droppedLines says what the pre-fill left out, and nothing for none', () => {
  assert.deepEqual(droppedLines({ team_only: 2, not_recorded: 1, unnamed: 1 }), [
    '2 team-only figures were left out. They stay in Axal VC.',
    '1 figure is not recorded, so it was left out.',
    '1 partner is named by type only.',
  ]);
  assert.deepEqual(droppedLines({ team_only: 1 }), ['1 team-only figure was left out. They stay in Axal VC.']);
  assert.deepEqual(droppedLines({ team_only: 0, not_recorded: 0 }), []);
  assert.deepEqual(droppedLines(null), []);
  assert.deepEqual(droppedLines({ team_only: 'x' }), []);
});

test('PUB1: Publish to… opens the sheet on a draft pre-filled from the page, with its source chip; closing it untouched archives the draft', async () => {
  const { api, calls } = stubApi({ dropped: { team_only: 1, not_recorded: 0, unnamed: 0 } });
  const v = await mount(h(PublishTo, { part: gate(), projectId: P, module: 'product-improvement', api, delay: 0 }));
  assert.equal(v.text('publish-to'), 'Publish to…');
  assert.ok(!calls.length, 'nothing is read or written before the press');
  await v.click('publish-to');
  assert.deepEqual(calls.find(([k]) => k === 'createDraft'), ['createDraft', { project_id: P, module: 'product-improvement' }], 'no text: the Worker pre-fills it');
  assert.equal(v.props('publish-text').value, PREFILL);
  assert.equal(v.text('publish-chip'), 'Recorded · From Product improvement · 2 shipped items · Oct 2026');
  assert.match(v.text('publish-prefill'), /1 team-only figure was left out\. They stay in Axal VC\./);
  assert.equal(calls.filter(([k]) => k === 'createDraft').length, 1, 'the check saves onto the pre-filled draft, never a second one');
  assert.ok(calls.some(([k, uid]) => k === 'saveDraft' && uid === 'draft-1'));
  await v.close();
  assert.deepEqual(calls.filter(([k]) => k === 'archiveDraft'), [['archiveDraft', 'draft-1']]);
});

test('a page with nothing recorded says so, and a pre-fill that fails leaves the founder to write their own', async () => {
  const none = stubApi({ lines: 0 });
  const v = await mount(h(PublishTo, { part: gate(), projectId: P, module: 'distribution', api: none.api }));
  try {
    await v.click('publish-to');
    assert.equal(v.text('publish-prefill-none'), 'Nothing recorded here yet to draft from. Write your own.');
    assert.ok(!v.has('publish-chip'));
  } finally { await v.close(); }
  const bad = stubApi({ createFails: true });
  const w = await mount(h(PublishTo, { part: gate(), projectId: P, module: 'distribution', api: bad.api }));
  try {
    await w.click('publish-to');
    assert.match(w.text('publish-prefill-error'), /Publishing could not finish that request/);
    assert.equal(w.props('publish-text').value, '');
  } finally { await w.close(); }
});

test('PUB8: with nothing switched on, Publish to… opens Connect a place to publish; anyone else, or an unreadable gate, gets no button', async () => {
  const { api, calls } = stubApi();
  const v = await mount(h(PublishTo, { part: gate({ can_publish: false, destinations_on: 0, empty: { kind: 'connect', sentence: 'Connect a place to publish', href: '/account/connectors' } }), projectId: P, module: 'overview', api }));
  try {
    await v.click('publish-to');
    assert.match(v.text('publish-connect'), /Connect a place to publish.*Nothing is posted until you confirm it\./s);
    assert.equal(v.props('publish-connect-open').href, '/account/connectors');
    assert.ok(!calls.length, 'no draft is made for a founder with no place');
  } finally { await v.close(); }
  for (const part of [
    gate({ can_publish: false, destinations_on: null, empty: { kind: 'founder_only', sentence: 'Only the founder publishes for Northwind Data.' } }),
    gate({ can_publish: false, destinations_on: null, empty: { kind: 'support', sentence: 'A support session cannot publish.' } }),
    { state: 'unreadable', module: 'overview', can_publish: false, reason: 'Publishing could not be read for this page. Try again.' },
    null,
  ]) {
    const w = await mount(h(PublishTo, { part, projectId: P, module: 'overview', api }));
    try { assert.ok(!w.has('publish-to'), JSON.stringify(part?.empty?.kind || part?.state || null)); } finally { await w.close(); }
  }
});

test('PUB8 and "Published from here": only-the-founder and support states, the last sends with their links, an unreadable gate, and nothing when there is nothing', async () => {
  const co = await mount(h(PublishedFromHere, { part: gate({ can_publish: false, empty: { kind: 'founder_only', sentence: 'Only the founder publishes for Northwind Data.' } }) }));
  try {
    assert.match(co.text('publish-empty-founder_only'), /Only the founder publishes for Northwind Data\.You can read what was published in Updates › Published outside\./);
    assert.equal(co.props('publish-open-outside').href, '/grow/reporting#published-outside');
  } finally { await co.close(); }
  const sup = await mount(h(PublishedFromHere, { part: gate({ can_publish: false, empty: { kind: 'support', sentence: 'A support session cannot publish.' } }) }));
  try { assert.match(sup.text('publish-empty-support'), /A support session cannot publish\./); } finally { await sup.close(); }
  const recent = [
    { uid: 's1', provider_key: 'x', destination: '@northwind_demo', audience: 'Public', status: 'sent', sent_at: '2026-10-26 14:02:00', external_url: 'https://example.test/p/1' },
    { uid: 's2', provider_key: 'facebook', destination: 'Northwind Data', audience: 'Public', status: 'unknown', sent_at: '2026-10-25 09:40:00', external_url: null },
  ];
  const r = await mount(h(PublishedFromHere, { part: gate({ recent }) }));
  try {
    assert.match(r.text('published-recent'), /^Published from here2/);
    assert.match(r.text('published-recent-s1'), /@northwind_demo on X26 Oct 2026.*Sent.*View on X ↗/s);
    assert.match(r.text('published-recent-s2'), /Northwind Data on Facebook.*Not known/s);
    assert.doesNotMatch(r.text('published-recent-s2'), /View on/);
  } finally { await r.close(); }
  const un = await mount(h(PublishedFromHere, { part: { state: 'unreadable', reason: 'Publishing could not be read for this page. Try again.' } }));
  try { assert.equal(un.text('publish-gate-unreadable'), 'Publishing could not be read for this page. Try again.'); } finally { await un.close(); }
  for (const part of [gate(), gate({ recent: null }), null]) {
    const n = await mount(h(PublishedFromHere, { part }));
    try { assert.ok(!n.has('published-from-here')); } finally { await n.close(); }
  }
});

test('a sent update: Publish to… reads its own gate when pressed, then opens the sheet on the update’s network version; a refusal says why', async () => {
  const { api, calls } = stubApi();
  const v = await mount(h(PublishUpdate, { updateUid: 'u-oct', projectId: P, api }));
  try {
    assert.ok(!calls.length, 'nothing is read before the press');
    await v.click('publish-update-u-oct');
    assert.deepEqual(calls.slice(0, 2).map(([k, a]) => [k, a]), [['updateGate', 'u-oct'], ['destinations', P]]);
    assert.ok(calls.some(([k, a]) => k === 'draftFromUpdate' && a === 'u-oct'));
    assert.ok(calls.some(([k, a]) => k === 'draft' && a === 'draft-u'), 'the draft’s text is read back');
    assert.equal(v.props('publish-text').value, 'October update\nWe are looking for: design partners');
    assert.match(v.text('publish-sheet'), /Publish from · Updates/);
    assert.equal(v.text('publish-chip'), 'Recorded · From Updates · 3 lines · Oct 2026');
  } finally { await v.close(); }
  const refused = stubApi({ gateError: Object.assign(new Error('Only a sent update can be published'), { code: 'not_sent', status: 409 }) });
  const w = await mount(h(PublishUpdate, { updateUid: 'u-draft', projectId: P, api: refused.api }));
  try {
    await w.click('publish-update-u-draft');
    assert.equal(w.text('publish-update-note-u-draft'), 'Only a sent update can be published');
    assert.ok(!refused.calls.some(([k]) => k === 'draftFromUpdate'));
  } finally { await w.close(); }
  const co = stubApi({ updateGate: gate({ can_publish: false, empty: { kind: 'founder_only', sentence: 'Only the founder publishes for Northwind Data.' } }) });
  const c = await mount(h(PublishUpdate, { updateUid: 'u-oct', projectId: P, api: co.api }));
  try {
    await c.click('publish-update-u-oct');
    assert.equal(c.text('publish-update-note-u-oct'), 'Only the founder publishes for Northwind Data.');
  } finally { await c.close(); }
  const conn = stubApi({ updateGate: gate({ can_publish: false, empty: { kind: 'connect', sentence: 'Connect a place to publish' } }) });
  const d = await mount(h(PublishUpdate, { updateUid: 'u-oct', projectId: P, api: conn.api }));
  try { await d.click('publish-update-u-oct'); assert.ok(d.has('publish-connect')); } finally { await d.close(); }
});

test('the Updates history draws a row action on a sent update only', async () => {
  const updates = [
    { uid: 'u1', title: 'October update', sent_at: '2026-10-26 10:00:00', sent_to: { investors: 3, team: 2, network: 0 }, href: '/updates/u1' },
    { uid: 'u2', title: 'Pending', sent_at: null, label: "Submitted to the investors' inbox", href: null },
  ];
  const v = await mount(h(UpdatesHistory, { updates, rowAction: (u) => h('span', { 'data-testid': `act-${u.uid}` }, 'Publish to…') }));
  try { assert.ok(v.has('act-u1') && !v.has('act-u2')); } finally { await v.close(); }
  const w = await mount(h(UpdatesHistory, { updates }));
  try { assert.ok(!w.has('act-u1')); } finally { await w.close(); }
});

test('the wiring: Grow’s module headers and overview carry Publish to… on part 2’s gate; the desk’s History offers it on sent updates', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  // D1328 (#3489): the other cycles' modules carry Fill with Eadwyn (`FillModule`) in the same slot.
  assert.match(route, /more=\{cycle === 'grow' && projectId \? <PublishTo part=\{module\?\.parts\?\.publish\} projectId=\{projectId\} module=\{slug\} \/>\n/);
  assert.match(route, /\{cycle === 'grow' && <PublishedFromHere part=\{module\?\.parts\?\.publish\} \/>\}/);
  assert.match(route, /more=\{cycle === 'grow' && projectId \? <PublishTo part=\{rawOverview\?\.publish\} projectId=\{projectId\} module="overview" \/> : null\}/);
  assert.match(route, /\{cycle === 'grow' && <PublishedFromHere part=\{rawOverview\?\.publish\} \/>\}/);
  assert.match(read('frontend/src/pages/cycles/CycleModulePage.jsx'), /search=\{search\} more=\{more\} \/>/);
  assert.match(read('frontend/src/pages/cycles/CycleOverview.jsx'), /chip=\{chip\} more=\{more\} \/>/);
  assert.match(read('frontend/src/pages/cycles/PhoneModulePage.jsx'), /\{more && <div className="flex justify-end">\{more\}<\/div>\}/);
  const desk = read('frontend/src/pages/cycles/ReportingDesk.jsx');
  assert.match(desk, /const mayPublish = gate\?\.state === 'ok' && \(gate\.can_publish \|\| gate\.empty\?\.kind === 'connect'\);/);
  assert.match(desk, /rowAction=\{rowAction\}/);
  const entry = read('frontend/src/pages/cycles/publish/PublishEntry.jsx');
  assert.doesNotMatch(entry, /window\.(confirm|alert)|\balert\(/);
  assert.doesNotMatch(entry, /api\.confirm|publishApi\.confirm/, 'an entry point never sends');
});

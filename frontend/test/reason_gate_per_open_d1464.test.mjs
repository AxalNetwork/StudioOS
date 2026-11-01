/**
 * D1464 (#4021) — read with a reason, per open: the gate on the Data room
 * (RR11) and Capital relationships (RR12), the 409 refusal (RR18), and the
 * founder's Support reads (RR09). The pages are mounted with the real client
 * over a stubbed `fetch`; every name and reason is synthetic.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/reason_gate_per_open_d1464.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { DataRoomTabPage } from '../src/pages/raise/dataroom/DataRoomTool.jsx';
import { CapRelTabPage } from '../src/pages/raise/caprel/CapRelTool.jsx';
import SupportReadsCard from '../src/pages/raise/SupportReadsCard.jsx';
import { NO_READS, readWhen, supportReadRow, supportReadRows } from '../src/pages/raise/supportReads.js';
import { SAVE_REFUSED } from '../src/ui/reasonGate.js';

const h = React.createElement;
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

async function mounted(element) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const prevMatch = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, element)));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  return {
    all, props, flush, text: () => text(document.body), byId: (id) => all(id)[0],
    async close() { await act(async () => root.unmount()); globalThis.matchMedia = prevMatch; restore(); },
  };
}

/** A fetch that answers by path; `calls` records method, path and body. */
function stubFetch(answer) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url), 'http://x').pathname.replace(/^\/api/, '');
    const method = init.method || 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const [status, body] = answer(method, path, init);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = previous; } };
}

async function type(page, prefix, value) {
  await act(async () => page.props(page.byId(`${prefix}-input`)).onChange({ target: { value } }));
  await act(async () => page.props(page.byId(prefix)).onSubmit({ preventDefault() {} }));
  await page.flush();
}

const SUMMARY = { mode: 'summary', read_only: true, project: { uid: 'synthetic-room' }, files: { available: true, total: 2 }, folders: { available: true, total: 1 }, coverage: { available: true, covered_items: 1, total_items: 7 }, grants: { available: true, total: 1 } };
const ROOM = {
  mode: 'support', read_only: true, project: { uid: 'synthetic-room', name: 'Synthetic venture' },
  folders: [{ id: 1, uid: 'f1', name: 'Legal' }],
  files: [{ id: 1, uid: 'file-a', name: 'Synthetic articles.pdf', folder_id: 1, visibility: 'nda', access_tier: 'invited', downloads: 2 }],
  grants: [{ uid: 'g1', status: 'active', investor_email: 'investor@example.com', investor_name: 'Synthetic investor' }],
};

test('the founder\'s row: who and as what, the reason, when and one open; nothing invented', () => {
  assert.deepEqual(supportReadRow({ id: 1, reader: { name: 'Synthetic HQ', kind: 'super_admin' }, reason: '  Due   diligence ', created_at: '2026-11-01 09:05:00' }),
    { id: 1, who: 'Synthetic HQ · HQ', reason: 'Due diligence', when: '1 Nov 2026, 09:05 · one open' });
  assert.equal(supportReadRow({ reader: { name: 'Synthetic admin', kind: 'admin' } }).who, 'Synthetic admin · Studio admin');
  const bare = supportReadRow({ reader: { name: null, kind: null }, reason: null, created_at: 'soon' });
  assert.deepEqual([bare.who, bare.reason, bare.when], ['Not recorded · Not recorded', 'Not recorded', 'Not recorded · one open']);
  assert.equal(readWhen(null), null);
  assert.equal(supportReadRows({ reads: 'x' }), null, 'an answer that is not a list is not a read');
  assert.equal(supportReadRows(null), null);
  assert.deepEqual(supportReadRows({ reads: [] }), []);
  assert.equal(NO_READS['capital-relationships'], 'No admin has read your capital relationships.');
});

test('RR11: an admin on the Data room meets the per-open gate, never the bare sentence or the room; the reason opens it read only', async () => {
  for (const tab of ['files', 'activity']) {
    const fetch = stubFetch((m, p) => (p === '/projects' ? [200, [{ id: 3, uid: 'synthetic-room' }]]
      : m === 'POST' && p === '/data-room/synthetic-room/support-read' ? [200, ROOM] : [200, SUMMARY]));
    const opened = [];
    const page = await mounted(h(DataRoomTabPage, { tab, projectId: 3, search: '?project_id=3', onSupportRead: (v) => opened.push(v) }));
    try {
      assert.ok(page.byId('dataroom-support-page'), tab);
      assert.match(page.text(), /Why are you opening this data room\?/);
      assert.match(page.text(), /This opens once; each open asks again\./);
      assert.match(page.text(), /0 \/ 500/);
      assert.ok(page.byId('dataroom-support-preview'), 'a skeleton behind the gate');
      assert.doesNotMatch(page.text(), /Synthetic articles|Read-only summary|Give a reason for a read-only support view/, 'nothing of the record behind the gate');
      await type(page, 'dataroom-support', '  Quarterly   portfolio review ');
      const post = fetch.calls.find((c) => c.method === 'POST');
      assert.deepEqual(post, { method: 'POST', path: '/data-room/synthetic-room/support-read', body: { reason: 'Quarterly portfolio review' } }, 'sent squashed, once');
      assert.ok(page.byId('dataroom-support-view'));
      assert.match(page.text(), /Read only · Studio admin access for Quarterly portfolio review/);
      assert.match(page.text(), /Synthetic articles\.pdf/);
      assert.equal(page.byId('dataroom-support-banner-left'), undefined, 'no timer on a per-open read');
      assert.equal(page.byId('dataroom-support-banner-end'), undefined, 'no End access');
      assert.doesNotMatch(page.text(), /Upload|Share|Send NDA|Download|investor@example/, 'no owner action and no investor address');
      await act(async () => page.props(page.byId('dataroom-support-file')).onClick());
      assert.ok(page.byId('dataroom-support-sheet'), 'the file detail in the right Sheet');
      assert.deepEqual(opened.filter(Boolean), [true], 'the rail is told once the read shows');
    } finally { await page.close(); fetch.restore(); }
  }
});

test('RR18 and a failed save: 409 draws the muted line with no form; 503 keeps the field with the save sentence', async () => {
  for (const [status, body] of [[409, { error: 'support_owner_unresolved', message: 'Support access cannot be recorded for this venture owner.' }], [503, { error: 'support_read_unavailable' }]]) {
    const fetch = stubFetch((m, p) => (p === '/projects' ? [200, [{ id: 3, uid: 'synthetic-room' }]] : m === 'POST' ? [status, body] : [200, SUMMARY]));
    const page = await mounted(h(DataRoomTabPage, { tab: 'files', projectId: 3, search: '?project_id=3' }));
    try {
      await type(page, 'dataroom-support', 'Support request');
      if (status === 409) {
        assert.equal(page.props(page.byId('dataroom-support-refused'))['data-kind'], 'owner');
        assert.equal(page.byId('dataroom-support'), undefined, 'no form');
        assert.doesNotMatch(page.text(), /Try again/);
      } else {
        assert.match(page.text(), new RegExp(SAVE_REFUSED.replace(/\./g, '\\.')));
        assert.equal(page.props(page.byId('dataroom-support-input')).value, 'Support request', 'the field is kept');
        assert.equal(page.byId('dataroom-support-view'), undefined);
      }
    } finally { await page.close(); fetch.restore(); }
  }
});

test('RR12: an admin on Capital relationships meets the gate on every tab; one response, read only, no email; the next page asks again', async () => {
  const fetch = stubFetch((m, p, init) => {
    if (m === 'POST' && p === '/cycles/raise/capital-relationships/support-read') {
      const { page } = JSON.parse(init.body);
      return [200, { mode: 'support', read_only: true, page, has_more: page === 1, actions: [], round: { name: 'Seed' },
        items: [{ uid: `p${page}`, name: `Synthetic partner ${page}`, firm: 'Synthetic Fund', stage: 'meeting', email: 'partner@example.com', notes: 'private note' }] }];
    }
    return [403, { error: 'support_read_required', message: 'Give a reason for a read-only support view.' }];
  });
  const page = await mounted(h(CapRelTabPage, { tab: 'pipeline', projectId: 7, admin: true, viewer: 'super_admin' }));
  try {
    assert.ok(page.byId('caprel-support-page'));
    assert.match(page.text(), /Why are you opening these capital relationships\?/);
    assert.match(page.text(), /This opens once; each open asks again\./);
    assert.equal(fetch.calls.length, 0, 'no private read before the reason');
    await type(page, 'caprel-support', 'Due diligence');
    assert.deepEqual(fetch.calls.map((c) => [c.method, c.path, c.body]), [['POST', '/cycles/raise/capital-relationships/support-read', { reason: 'Due diligence', page: 1 }]]);
    assert.match(page.text(), /Read only · HQ access for Due diligence/);
    assert.match(page.text(), /Synthetic partner 1/);
    assert.doesNotMatch(page.text(), /partner@example|private note/);
    await act(async () => page.props(page.byId('caprel-support-next')).onClick());
    assert.ok(page.byId('caprel-support'), 'the next page is a fresh reason');
    assert.equal(page.props(page.byId('caprel-support-input')).value, '', 'the field starts empty');
    await type(page, 'caprel-support', 'Due diligence, page two');
    assert.deepEqual(fetch.calls.at(-1).body, { reason: 'Due diligence, page two', page: 2 });
    assert.match(page.text(), /Synthetic partner 2/);
  } finally { await page.close(); fetch.restore(); }
});

test('RR09: the founder\'s Support reads card draws rows, the empty line, or Unreadable with Try again', async () => {
  let answer = { reads: [{ id: 1, reader: { name: 'Synthetic admin', kind: 'admin' }, reason: 'Support request', created_at: '2026-11-01 10:00:00' }], has_more: false };
  let fail = false;
  const load = async () => { if (fail) throw Object.assign(new Error('x'), { status: 503 }); return answer; };
  let page = await mounted(h(SupportReadsCard, { record: 'capital-relationships', load }));
  try {
    assert.equal(page.all('support-reads-row').length, 1);
    assert.match(page.text(), /Synthetic admin · Studio admin/);
    assert.match(page.text(), /1 Nov 2026, 10:00 · one open/);
  } finally { await page.close(); }
  answer = { reads: [], has_more: false };
  page = await mounted(h(SupportReadsCard, { record: 'capital-relationships', load }));
  try { assert.match(page.text(), /No admin has read your capital relationships\./); } finally { await page.close(); }
  answer = { detail: 'not a list' };
  page = await mounted(h(SupportReadsCard, { record: 'capital-relationships', load }));
  try {
    assert.ok(page.byId('support-reads-unreadable'), 'an answer with no list is unreadable');
    assert.doesNotMatch(page.text(), /No admin has read/);
  } finally { await page.close(); }
  fail = true;
  page = await mounted(h(SupportReadsCard, { record: 'data-room', load }));
  try {
    assert.ok(page.byId('support-reads-unreadable'));
    assert.doesNotMatch(page.text(), /No admin has read/, 'unreadable is never empty');
    fail = false; answer = { reads: [], has_more: false };
    await act(async () => page.props(page.byId('support-reads-unreadable').childNodes.at(-1)).onClick());
    await page.flush();
    assert.match(page.text(), /No admin has read your data room\./);
  } finally { await page.close(); }
});

test('the rail: CycleRoute turns Eadwyn off while a per-open read shows, and the founder\'s Activity tabs carry the card', () => {
  const route = src('pages/cycles/CycleRoute.jsx');
  assert.match(route, /readOnlyFor=\{narrativeAdmin \|\| supportOpen \? 'founder-record' : null\}/);
  assert.match(route, /onSupportRead=\{setSupportOpen\}/);
  assert.match(src('pages/raise/dataroom/DataRoomTool.jsx'), /SupportReadsCard record="data-room"/);
  assert.match(src('pages/raise/caprel/CapRelTool.jsx'), /SupportReadsCard record="capital-relationships"/);
});

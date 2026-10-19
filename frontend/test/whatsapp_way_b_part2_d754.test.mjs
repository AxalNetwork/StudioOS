/**
 * D754 way B (#1939, part 2) — "Agreed beforehand" for a recording still
 * waiting for consent (wb2's capture routes, #2006), Axal's number with
 * **Open WhatsApp** in Record a Session's entry, and the Super Admin's list of
 * unset settings. Stubbed APIs only; nothing reaches the Worker.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/whatsapp_way_b_part2_d754.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import { WAY_B, axalContact, captureLine, missingSettings, waitingCaptures } from '../src/pages/account/whatsappWayB.js';
import { WaitingCaptures, WhatsAppEntry, WhatsAppWayBSection } from '../src/pages/account/WhatsAppWayB.jsx';
import { channelsApi } from '../src/lib/api/channels.js';

const h = React.createElement;
const LINK = { number_masked: '•••• 1234', linked_at: '2026-10-01T09:00:00Z', last_used_at: null };
const CAPTURES = [
  { uid: 'cap_new', item_count: 2, status: 'waiting', created_at: '2026-10-19T08:00:00Z' },
  { uid: 'cap_done', item_count: 1, status: 'imported', created_at: '2026-10-18T08:00:00Z' },
  { uid: 'cap_one', item_count: 1, status: 'waiting', created_at: '2026-10-17T08:00:00Z' },
  { uid: '', item_count: 1, status: 'waiting' },
  null,
];

// ================================================================ the rules

test('waitingCaptures keeps only waiting captures with a uid, in the Worker\'s order', () => {
  assert.deepEqual(waitingCaptures(CAPTURES), [
    { uid: 'cap_new', items: 2, at: '2026-10-19T08:00:00Z' },
    { uid: 'cap_one', items: 1, at: '2026-10-17T08:00:00Z' },
  ]);
  assert.deepEqual(waitingCaptures(null), []);
  assert.deepEqual(waitingCaptures([{ uid: 'x', item_count: 'lots', status: 'waiting', created_at: '' }]), [{ uid: 'x', items: 0, at: '' }]);
  const iso = (d) => d.toISOString().slice(0, 10);
  assert.equal(captureLine({ items: 2, at: '2026-10-19T08:00:00Z' }, iso), '2 recordings, 2026-10-19');
  assert.equal(captureLine({ items: 1, at: '' }), '1 recording');
});

test('axalContact draws only the Worker\'s shape: a number and a plain wa.me link with no code', () => {
  assert.deepEqual(axalContact({ axal_number: '+1 555 000 9999', axal_link: 'https://wa.me/15550009999' }), { number: '+1 555 000 9999', href: 'https://wa.me/15550009999' });
  for (const bad of [
    {}, { axal_number: '+1 555', axal_link: '' },
    { axal_number: '+1 555 000 9999', axal_link: 'https://wa.me/15550009999?text=LINK%20abc' },
    { axal_number: '+1 555 000 9999', axal_link: 'http://wa.me/15550009999' },
    { axal_number: '+1 555 000 9999', axal_link: 'https://evil.example/15550009999' },
    { axal_number: 'x'.repeat(33), axal_link: 'https://wa.me/15550009999' },
  ]) assert.equal(axalContact(bad), null, JSON.stringify(bad));
});

test('missingSettings keeps only the four known names, in their order', () => {
  assert.deepEqual(missingSettings({ data: { missing: ['WHATSAPP_AXAL_DISPLAY_NUMBER', 'nope', 'WHATSAPP_AXAL_ACCESS_TOKEN'] } }),
    ['WHATSAPP_AXAL_ACCESS_TOKEN', 'WHATSAPP_AXAL_DISPLAY_NUMBER']);
  assert.deepEqual(missingSettings({ data: { missing: 'WHATSAPP_AXAL_WABA_ID' } }), []);
  assert.deepEqual(missingSettings(null), []);
});

// ================================================================ drawn

async function mount(element) {
  const restoreDoc = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.window.addEventListener = () => {};
  globalThis.window.removeEventListener = () => {};
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, null, h(Routes, null, h(Route, { path: '*', element })))); });
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    by,
    text: () => textOf(container).replace(/\s+/g, ' '),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}

test('a linked member sees each waiting recording with Agreed beforehand; pressing it records pre_agreed once and re-reads', async () => {
  let list = CAPTURES;
  const agreed = [];
  let reads = 0;
  const api = {
    whatsappCaptures: async () => { reads += 1; return { items: list }; },
    agreeCapture: async (uid) => { agreed.push(uid); list = list.map((c) => (c && c.uid === uid ? { ...c, status: 'consented' } : c)); return { ok: true, status: 'consented' }; },
  };
  const v = await mount(h(WhatsAppWayBSection, { read: { status: 'ready', view: { link: LINK } }, api, onChanged() {} }));
  try {
    assert.ok(v.by('way-b-waiting'), 'the waiting list is not in the linked section');
    assert.ok(v.text().includes(WAY_B.waiting));
    assert.ok(v.by('button-way-b-agreed-cap_new') && v.by('button-way-b-agreed-cap_one'));
    assert.equal(v.by('button-way-b-agreed-cap_done'), undefined, 'an imported capture was offered');
    await v.click('button-way-b-agreed-cap_new');
    assert.deepEqual(agreed, ['cap_new']);
    assert.equal(reads, 2, 'the list was not read again after the answer');
    assert.equal(v.by('way-b-capture-cap_new'), undefined, 'the answered capture is still listed');
    assert.ok(v.by('way-b-capture-cap_one'));
  } finally { await v.unmount(); }
});

test('a refused answer says so in words; an unreadable or empty list draws nothing', async () => {
  const api = { whatsappCaptures: async () => ({ items: CAPTURES }), agreeCapture: async () => { throw Object.assign(new Error('capture_not_waiting'), { status: 404, code: 'capture_not_waiting' }); } };
  const v = await mount(h(WaitingCaptures, { api }));
  try {
    await v.click('button-way-b-agreed-cap_one');
    assert.ok(v.text().includes('Axal could not record that. Answer in the WhatsApp chat instead.'));
    assert.ok(!v.text().includes('capture_not_waiting'));
  } finally { await v.unmount(); }
  for (const read of [async () => { throw new Error('down'); }, async () => ({ items: [] })]) {
    const w = await mount(h(WaitingCaptures, { api: { whatsappCaptures: read } }));
    try { assert.equal(w.by('way-b-waiting'), undefined); } finally { await w.unmount(); }
  }
});

test('the linked section only reads captures once linked', async () => {
  let reads = 0;
  const api = { whatsappCaptures: async () => { reads += 1; return { items: [] }; } };
  const v = await mount(h(WhatsAppWayBSection, { read: { status: 'ready', view: {} }, api, onChanged() {} }));
  try { assert.equal(reads, 0, 'a member who is not linked had their captures read'); } finally { await v.unmount(); }
});

test('"From WhatsApp" shows Axal\'s number and Open WhatsApp when the Worker sends them, and never otherwise', () => {
  const entry = (view) => renderToStaticMarkup(h(MemoryRouter, null, h(WhatsAppEntry, { read: { status: 'ready', view } })));
  const s = entry({ link: null, claim: null, axal_number: '+1 555 000 9999', axal_link: 'https://wa.me/15550009999' });
  assert.ok(s.includes('+1 555 000 9999'));
  assert.ok(s.includes('href="https://wa.me/15550009999"') && s.includes('rel="noopener noreferrer"'));
  const none = entry({ link: null, claim: null });
  assert.ok(!none.includes('data-testid="whatsapp-entry-number"') && !none.includes('data-testid="link-whatsapp-entry-open"'));
  const bad = entry({ axal_number: '+1', axal_link: 'javascript:alert(1)' });
  assert.ok(!bad.includes('javascript:'), 'an unsafe link was drawn');
});

// ================================================================ the API methods (D527)

test('channelsApi: the capture read and Agreed beforehand hit wb2\'s paths, with pre_agreed', async () => {
  const restoreDoc = installDocument();
  const seen = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => { seen.push([String(url).replace(/^.*\/api/, ''), opts.method || 'GET', opts.body ?? null]); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await channelsApi.whatsappCaptures();
    await channelsApi.agreeCapture('cap/1');
  } finally { globalThis.fetch = prev; restoreDoc(); }
  assert.deepEqual(seen, [
    ['/channels/whatsapp/captures', 'GET', null],
    ['/channels/whatsapp/captures/cap%2F1/consent', 'POST', JSON.stringify({ method: 'pre_agreed' })],
  ]);
});

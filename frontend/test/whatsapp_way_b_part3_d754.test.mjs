/**
 * D754 way B (#1939, part 3) — where a linked member's WhatsApp recordings go.
 * The WhatsApp page says it; Record a Session's "From WhatsApp", open in a
 * venture, offers **Send WhatsApp recordings to this venture** when they go
 * elsewhere. No picker: the venture is the page's scope
 * (scripts/check-inline-project-pickers.mjs). Stubbed APIs only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/whatsapp_way_b_part3_d754.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import { WAY_B, offersVenture, ventureLine, ventureOf, wayBState } from '../src/pages/account/whatsappWayB.js';
import { WhatsAppEntry, WhatsAppWayBSection } from '../src/pages/account/WhatsAppWayB.jsx';
import { channelsApi } from '../src/lib/api/channels.js';

const h = React.createElement;
const LINK = { number_masked: '•••• 1234', linked_at: '2026-10-01T09:00:00Z', last_used_at: null };
const linked = (venture) => ({ status: 'ready', view: { link: LINK, venture } });

test('ventureOf keeps only a whole positive id; the line names the venture or says the default', () => {
  // Mutation checked: accept any truthy project_id → ventureOf({ project_id: 'x' }) is a venture.
  assert.deepEqual(ventureOf({ project_id: 501, name: ' Payroll pilot ' }), { projectId: 501, name: 'Payroll pilot' });
  for (const bad of [null, {}, { project_id: 0 }, { project_id: -2 }, { project_id: 1.5 }, { project_id: 'x' }]) assert.equal(ventureOf(bad), null, JSON.stringify(bad));
  assert.equal(ventureLine({ projectId: 501, name: 'Payroll pilot' }), 'Recordings go to Payroll pilot.');
  assert.equal(ventureLine({ projectId: 501, name: '' }), 'Recordings go to the venture you chose.');
  assert.equal(ventureLine(null), WAY_B.ventureDefault);
  assert.deepEqual(wayBState(linked({ project_id: 501, name: 'Payroll pilot' })).venture, { projectId: 501, name: 'Payroll pilot' });
});

test('offersVenture only for a linked member whose recordings go somewhere other than this venture', () => {
  // Mutation checked: drop the "already this venture" check → the button is offered for the chosen venture itself.
  const here = wayBState(linked({ project_id: 500, name: 'Ledger tool' }));
  assert.equal(offersVenture(here, 500), false, 'already this venture');
  assert.equal(offersVenture(here, 501), true);
  assert.equal(offersVenture(wayBState(linked(null)), 500), true, 'no choice yet');
  assert.equal(offersVenture(wayBState({ status: 'ready', view: {} }), 500), false, 'not linked');
  for (const id of [null, 0, 'x']) assert.equal(offersVenture(here, id), false, String(id));
});

test('the WhatsApp page says where recordings go and how to change it, with no picker', () => {
  const page = renderToStaticMarkup(h(MemoryRouter, null, h(WhatsAppWayBSection, { read: linked({ project_id: 501, name: 'Payroll pilot' }), api: { whatsappCaptures: async () => ({ items: [] }) }, onChanged() {} })));
  assert.ok(page.includes(`Recordings go to Payroll pilot. ${WAY_B.ventureHow}`));
  assert.ok(!/<select/.test(page), 'the page draws a picker');
  const none = renderToStaticMarkup(h(MemoryRouter, null, h(WhatsAppWayBSection, { read: linked(null), api: { whatsappCaptures: async () => ({ items: [] }) }, onChanged() {} })));
  assert.ok(none.includes(WAY_B.ventureDefault));
});

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

test('"From WhatsApp" in a venture sends recordings there in one press, re-reads, and says a refusal in words', async () => {
  // Mutation checked: send the entry's own choice instead of projectId → the PUT carries 501, not 500.
  const sent = [];
  let reloads = 0;
  const api = { setWhatsAppVenture: async (id) => { sent.push(id); return { ok: true }; } };
  const v = await mount(h(WhatsAppEntry, { read: linked({ project_id: 501, name: 'Payroll pilot' }), projectId: 500, api, onChanged: () => { reloads += 1; } }));
  try {
    assert.ok(v.text().includes('Recordings go to Payroll pilot.'));
    await v.click('button-whatsapp-entry-venture');
    assert.deepEqual([sent, reloads], [[500], 1]);
  } finally { await v.unmount(); }
  const refused = { setWhatsAppVenture: async () => { throw Object.assign(new Error('venture_not_yours'), { status: 403, code: 'venture_not_yours' }); } };
  const w = await mount(h(WhatsAppEntry, { read: linked(null), projectId: 500, api: refused }));
  try {
    await w.click('button-whatsapp-entry-venture');
    assert.ok(w.text().includes('Axal could not change where your WhatsApp recordings go. Try again.'));
    assert.ok(!w.text().includes('venture_not_yours'), 'a bare code reached the page');
  } finally { await w.unmount(); }
  // Already this venture, or no venture in scope: nothing to offer.
  for (const projectId of [501, null]) {
    const s = renderToStaticMarkup(h(MemoryRouter, null, h(WhatsAppEntry, { read: linked({ project_id: 501, name: 'Payroll pilot' }), projectId })));
    assert.ok(!s.includes('button-whatsapp-entry-venture'), String(projectId));
  }
});

test('Record a Session hands the entry its venture and the reload', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/pages/founder/RecordLightbox.jsx', import.meta.url), 'utf8');
  assert.ok(src.includes('<WhatsAppEntry read={whatsappLink.read} projectId={projectId} api={channelsSource} onChanged={whatsappLink.reload} />'));
});

test('channelsApi.setWhatsAppVenture PUTs the id, or null to clear', async () => {
  const restoreDoc = installDocument();
  const seen = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => { seen.push([String(url).replace(/^.*\/api/, ''), opts.method || 'GET', opts.body ?? null]); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await channelsApi.setWhatsAppVenture(500);
    await channelsApi.setWhatsAppVenture(null);
  } finally { globalThis.fetch = prev; restoreDoc(); }
  assert.deepEqual(seen, [
    ['/channels/whatsapp/link/venture', 'PUT', JSON.stringify({ project_id: 500 })],
    ['/channels/whatsapp/link/venture', 'PUT', JSON.stringify({ project_id: null })],
  ]);
});

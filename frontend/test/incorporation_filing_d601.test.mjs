/**
 * D601 (#998; the owner's answer 1A) — the founder's screens and HQ's
 * "Formation orders" tab for the packet and the state filing an admin records.
 * The Worker's half is cloudflare-worker/test/incorporation_filing_d601.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/incorporation_filing_d601.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { PAID_STATUSES, PACKET_NOT_BUILT } from '../src/lib/incorporationPricing.js';
import IncorporationStatusBadge from '../src/components/IncorporationStatusBadge.jsx';
import { TERMINAL_STATES } from '../src/hooks/useIncorporationStatus.js';
import { packetLine } from '../src/pages/IncorporateSuccessPage.jsx';
import { OrderRow, STEP_ERRORS, nextStep, stepError } from '../src/pages/admin/AdminFormationOrders.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const LAB = codeOnly(read('frontend/src/pages/SpinoutLabIncorporatePage.jsx'));
const VM = codeOnly(read('frontend/src/lib/cofounderAgreementViewModel.js'));
const WORKER = read('cloudflare-worker/src/services/incorporationFiling.ts');

test('a filed order is a paid order everywhere, and polling stops at payment', () => {
  assert.ok(PAID_STATUSES.includes('filed'));
  for (const s of PAID_STATUSES) assert.ok(TERMINAL_STATES.has(s), `${s} keeps polling until a false timeout`);
  assert.ok(TERMINAL_STATES.has('failed'));
  assert.ok(!TERMINAL_STATES.has('pending_payment'), 'polling stops before payment is confirmed');
  assert.match(VM, /PAID_STATUSES\.includes\(s\(o\?\.status\)\)/);
  assert.doesNotMatch(VM, /\['paid', 'packet_processing', 'packet_ready'\]/);
});

test('the status badge names a filed order', () => {
  const html = renderToStaticMarkup(h(IncorporationStatusBadge, { status: 'filed' }));
  assert.match(html, /Filed with the state/);
});

test('the success page says what was recorded, and never that a packet was emailed', () => {
  assert.equal(packetLine({ status: 'filed', filed_on: '2026-09-03' }), 'Your formation packet was filed with the state on 2026-09-03. Open Legal to view the packet.');
  assert.match(packetLine({ status: 'filed' }), /^Your formation packet was filed with the state\. /);
  assert.match(packetLine({ status: 'packet_ready' }), /not been filed with the state yet/);
  assert.equal(packetLine({ status: 'paid' }), PACKET_NOT_BUILT);
  assert.equal(packetLine({ status: 'packet_processing' }), PACKET_NOT_BUILT);
  const page = read('frontend/src/pages/IncorporateSuccessPage.jsx');
  assert.doesNotMatch(page, /emailed to you/, 'nothing emails a packet');
});

test('the Lab page counts a filed order as submitted to the state, with its date', () => {
  assert.match(LAB, /const filingDone = !paid \? 0 : orderStatus === 'filed' \? 2 : orderStatus === 'packet_ready' \|\| docsAllDone \? 1 : 0;/);
  assert.match(LAB, /orderStatus === 'filed' && order\?\.filed_on \? `Filed \$\{order\.filed_on\}` : 'Est\. same day'/);
});

test('HQ: each order offers only its next step, with no default document or date', () => {
  assert.equal(nextStep('paid'), 'packet');
  assert.equal(nextStep('packet_processing'), 'packet');
  assert.equal(nextStep('packet_ready'), 'filed');
  assert.equal(nextStep('filed'), null);
  assert.equal(nextStep('pending_payment'), null);
  const row = (order) => renderToStaticMarkup(h('table', null, h('tbody', null, h(OrderRow, { order, onSaved: () => {} }))));
  const base = { id: 7, company_name: 'Acme, Inc.', project_id: 1, project_name: 'Acme', jurisdiction_id: 'us_de_ccorp', documents: [{ id: 51, title: 'Formation packet — Acme' }] };
  const waiting = row({ ...base, status: 'packet_processing' });
  assert.match(waiting, /<option value="" disabled="" selected="">Packet document…<\/option>/);
  assert.match(waiting, /<button type="button" disabled=""[^>]*>Packet ready<\/button>/);
  assert.doesNotMatch(waiting, /Filed with the state<\/button>/);
  const ready = row({ ...base, status: 'packet_ready', packet_document_id: 51 });
  assert.match(ready, />Formation packet — Acme</);
  assert.match(ready, /<input type="date" aria-label="Filed on"[^>]*value=""/);
  assert.match(ready, /<button type="button" disabled=""[^>]*>Filed with the state<\/button>/);
  assert.doesNotMatch(ready, />Packet ready<\/button>/);
  const done = row({ ...base, status: 'filed', packet_document_id: 51, filed_on: '2026-09-03' });
  assert.match(done, />2026-09-03</);
  assert.doesNotMatch(done, /<button/);
  const nodocs = row({ ...base, status: 'paid', documents: [] });
  assert.match(nodocs, />No documents</);
  assert.doesNotMatch(nodocs, /Packet ready<\/button>/);
});

test('every refusal the Worker can give has a sentence, keyed by its code', () => {
  for (const code of [...WORKER.matchAll(/error: '([a-z_]+)'/g)].map((m) => m[1])) {
    assert.ok(STEP_ERRORS[code], `no sentence for ${code}`);
  }
  assert.equal(stepError({ code: 'filed_on_future', message: 'x' }), STEP_ERRORS.filed_on_future);
  assert.equal(stepError({ message: 'packet_not_ready' }), 'packet_not_ready', 'the table is keyed by e.code, never by the sentence');
});

test('the client calls the Worker\'s routes, and HQ has the tab', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, ''), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { adminIncorporationsApi } = await import('../src/lib/api/adminIncorporations.js');
    await adminIncorporationsApi.list();
    await adminIncorporationsApi.packetReady(7, 51);
    await adminIncorporationsApi.filed(7, '2026-09-03');
    assert.deepEqual(calls, [
      ['GET', '/admin/incorporations', null],
      ['POST', '/admin/incorporations/7/packet-ready', { document_id: 51 }],
      ['POST', '/admin/incorporations/7/filed', { filed_on: '2026-09-03' }],
    ]);
  } finally { globalThis.fetch = original; }
  assert.match(read('cloudflare-worker/src/index.ts'), /app\.route\('\/api\/admin\/incorporations', adminIncorporations\);/);
  const hq = codeOnly(read('frontend/src/pages/admin/AdminSpinoutLab.jsx'));
  assert.match(hq, /section === 'formation' \? \(\s*<AdminFormationOrders \/>/);
});

/**
 * D713 (#1778 PR C, F28): "Import from Mercury" on the revenue ledger.
 *   · each credit shows a checkbox only when the Worker says it can be
 *     imported, otherwise its reason;
 *   · a picked credit needs a label and a type, and the request carries only
 *     the transaction id, the label and the type (never an amount or a date);
 *   · no connection reads Not recorded, a failed read Unreadable, an empty
 *     window says so.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/revenue_mercury_import_d713.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import { mercuryPersonalApi } from '../src/lib/api/mercuryPersonal.js';
import MercuryCreditImport, { MercuryCreditImportView } from '../src/components/spinout/MercuryCreditImport.jsx';
import {
  mercuryCreditReason, mercuryImportItems, mercuryImportLine, mercuryImportReady, mercuryReadOutcome,
} from '../src/lib/revenueLedger.js';

const h = React.createElement;
const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = new Proxy({}, { get: () => () => {} });
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CREDITS = [
  { transaction_id: A, posted_on: '2026-10-01', amount_cents: 120050, last_four: '0042', counterparty_name: 'Acme Corp', importable: true, reason: null },
  { transaction_id: B, posted_on: '2026-10-02', amount_cents: 5000, last_four: '0042', counterparty_name: 'Own savings', importable: false, reason: 'internal_transfer' },
];
const view = (read, extra = {}) => ssr(h(MercuryCreditImportView, { state: { read, picks: {}, busy: false, err: '', result: null, ...extra }, on: noop }));
const ok = (credits = CREDITS, more = {}) => ({ status: 'ok', data: { credits, window: { from: '2026-09-01', to: '2026-10-18' }, capped: false, ...more } });

test('every Worker reason has its sentence, and an unknown one is not dropped', () => {
  for (const k of ['pending', 'internal_transfer', 'axal_entity', 'stripe_payout', 'already_imported', 'imported_elsewhere', 'invalid_amount', 'transaction_not_found', 'not_a_credit']) {
    assert.doesNotMatch(mercuryCreditReason(k), /not recognised/, k);
  }
  assert.equal(mercuryCreditReason('internal_transfer'), 'A transfer between your own accounts');
  assert.match(mercuryCreditReason('something_new'), /not recognised/);
  assert.match(mercuryCreditReason('toString'), /not recognised/, 'a prototype key is not a reason');
});

test('a failed read: no connection is Not recorded, a stated refusal is said, anything else Unreadable', () => {
  assert.equal(mercuryReadOutcome({ status: 409, code: 'mercury_not_connected', message: 'x' }).kind, 'not_recorded');
  assert.deepEqual(mercuryReadOutcome({ status: 409, code: 'mercury_reconnect_required', message: 'Reconnect it.' }), { kind: 'refused', reason: 'Reconnect it.' });
  assert.equal(mercuryReadOutcome({ status: 502, code: 'mercury_unreadable', message: 'down' }).kind, 'unreadable');
  assert.equal(mercuryReadOutcome({ status: 400 }).kind, 'unreadable', 'a 4xx with no code is not a stated refusal');
  assert.equal(mercuryReadOutcome(new Error('network')).kind, 'unreadable');
});

test('items: only picked, importable credits, with the label trimmed and no amount or date', () => {
  const picks = { [A]: { on: true, customer: '  Acme  ', revenue_type: 'pilot' }, [B]: { on: true, customer: 'x', revenue_type: 'pilot' } };
  const items = mercuryImportItems(CREDITS, picks);
  assert.deepEqual(items, [{ transaction_id: A, customer: 'Acme', revenue_type: 'pilot' }]);
  assert.equal(mercuryImportReady(items), true);
  assert.equal(mercuryImportReady([]), false);
  assert.equal(mercuryImportReady([{ ...items[0], customer: '' }]), false, 'a label is required');
  assert.equal(mercuryImportReady([{ ...items[0], revenue_type: 'grant' }]), false, 'the type is one of the four');
  assert.equal(mercuryImportReady(Array.from({ length: 201 }, () => items[0])), false, 'at most 200');
});

test('the answer names the counts returned, and only those', () => {
  assert.equal(mercuryImportLine({ inserted: 2, already_imported: 1, refused: [{ transaction_id: A, reason: 'pending' }] }),
    '2 credits imported as supported · 1 already on the ledger · 1 refused');
  assert.equal(mercuryImportLine({ inserted: 1, already_imported: 0, refused: [] }), '1 credit imported as supported');
  assert.equal(mercuryImportLine({ refused: [] }), '');
  assert.equal(mercuryImportLine(null), '');
});

test('the list: a checkbox for an importable credit, the reason for the other', () => {
  const html = view(ok());
  assert.match(html, new RegExp(`data-testid="mercury-pick-${A}"`));
  assert.doesNotMatch(html, new RegExp(`data-testid="mercury-pick-${B}"`));
  assert.match(html, new RegExp(`data-testid="mercury-reason-${B}"[^>]*>A transfer between your own accounts<`));
  assert.doesNotMatch(html, new RegExp(`data-testid="mercury-reason-${A}"`));
  assert.match(html, /\$1,200\.50/);
  assert.match(html, /2026-09-01 to 2026-10-18 · 2 found/);
  assert.match(html, /data-testid="mercury-run-import"[^>]*>Pick the credits to import</);
  assert.match(html, /disabled=""[^>]*data-testid="mercury-run-import"|data-testid="mercury-run-import"[^>]*disabled=""/);
});

test('a picked credit asks for its label and type; the button waits for both', () => {
  const half = view(ok(), { picks: { [A]: { on: true, customer: 'Acme' } } });
  assert.match(half, new RegExp(`data-testid="mercury-customer-${A}"`));
  assert.match(half, />Recurring<\/button>/);
  assert.match(half, /disabled=""[^>]*data-testid="mercury-run-import"[^>]*>Import 1 credit</);
  const full = view(ok(), { picks: { [A]: { on: true, customer: 'Acme', revenue_type: 'recurring' } } });
  assert.doesNotMatch(full, /disabled=""[^>]*data-testid="mercury-run-import"/);
});

test('the states: loading, empty, Not recorded, a refusal, Unreadable, capped', () => {
  assert.match(view({ status: 'loading' }), /data-testid="mercury-import-loading"/);
  assert.match(view(ok([])), /data-testid="mercury-import-empty"[^>]*>Your Mercury account has no credits in this window\.</);
  const none = view({ status: 'failed', outcome: { kind: 'not_recorded', reason: 'Connect your own Mercury account first, with a Read Only token.' } });
  assert.match(none, /data-testid="mercury-import-not-recorded"/);
  assert.match(none, /Not recorded/);
  assert.match(none, /href="\/account\/connectors"/);
  assert.match(view({ status: 'failed', outcome: { kind: 'refused', reason: 'Reconnect it.' } }), /role="alert" data-testid="mercury-import-refused">Reconnect it\.</);
  const bad = view({ status: 'failed', outcome: { kind: 'unreadable' } });
  assert.match(bad, /data-testid="mercury-import-unreadable"/);
  assert.match(bad, /Your Mercury credits could not be read\. This is not a claim that there are none\./);
  assert.doesNotMatch(bad, /no credits/);
  assert.match(view(ok(CREDITS, { capped: true })), /data-testid="mercury-import-capped"/);
  assert.doesNotMatch(view(ok()), /mercury-import-capped/);
});

async function mounted(credits, importCredits) {
  const saved = { ...mercuryPersonalApi };
  const calls = [];
  mercuryPersonalApi.credits = async (...a) => { calls.push(['credits', ...a]); return credits(); };
  mercuryPersonalApi.importCredits = async (...a) => { calls.push(['importCredits', ...a]); return importCredits?.(); };
  try {
    const v = await mountContracts(h(MercuryCreditImport, { projectId: 7 }), '/spinout');
    try { await v.flush(); await v.flush(); return { text: v.text(), calls }; } finally { await v.unmount(); }
  } finally { Object.assign(mercuryPersonalApi, saved); }
}

test('mounted: it reads the founder\'s credits for this project, and says why a read failed', async () => {
  const good = await mounted(() => ({ credits: CREDITS, window: { from: '2026-09-01', to: '2026-10-18' } }));
  assert.deepEqual(good.calls, [['credits', 7]]);
  assert.match(good.text, /Acme Corp/);
  const none = await mounted(() => { throw Object.assign(new Error('Connect your own Mercury account first.'), { status: 409, code: 'mercury_not_connected' }); });
  assert.match(none.text, /Not recorded/);
  const down = await mounted(() => { throw Object.assign(new Error('down'), { status: 502, code: 'mercury_unreadable' }); });
  assert.match(down.text, /Your Mercury credits could not be read/);
  assert.doesNotMatch(down.text, /no credits/);
});

test('the ledger offers Import from Mercury beside the Stripe import, in its own modal', () => {
  const src = readFileSync('frontend/src/components/spinout/RevenueLedger.jsx', 'utf8');
  const stripe = src.indexOf('data-testid="ledger-import-stripe"');
  const mercury = src.indexOf('data-testid="ledger-import-mercury"');
  assert.ok(stripe > 0 && mercury > stripe, 'the Mercury button follows the Stripe one');
  assert.match(src.slice(mercury, mercury + 600), /Import from Mercury/);
  assert.match(src, /onClick=\{\(\) => \{ setErr\(''\); setModal\('mercury'\); \}\}/);
  assert.match(src, /\{modal === 'mercury' \? \(\s*<MercuryCreditImport projectId=\{project\.id\} onImported=\{load\} onBusy=\{setBusy\} \/>/);
  const panel = readFileSync('frontend/src/components/spinout/MercuryCreditImport.jsx', 'utf8');
  assert.match(panel, /mercuryPersonalApi\.importCredits\(projectId, items\)/);
  assert.doesNotMatch(panel, /amount_cents:|received_on:/, 'the panel never sends an amount or a date');
});


test('mounted: malformed credits are Unreadable; a valid empty array is empty', async () => {
  for (const data of [null, {}, { credits: null }, { credits: [] }]) {
    const result = await mounted(() => data);
    if (Array.isArray(data?.credits)) {
      assert.match(result.text, /Your Mercury account has no credits in this window/);
      assert.doesNotMatch(result.text, /could not be read/);
    } else {
      assert.match(result.text, /Your Mercury credits could not be read/);
      assert.doesNotMatch(result.text, /has no credits/);
    }
  }
});

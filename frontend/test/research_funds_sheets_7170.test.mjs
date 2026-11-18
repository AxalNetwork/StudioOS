/**
 * D7170 (#7170) — Research › Funds Google Sheets sync, built to the D7035
 * canvas (boards FND-G00 to FND-G09). Rendered with react-dom/server (no DOM)
 * and read as source where only the wiring can say it.
 *
 *   G01  One card state per status, one primary action per state; disabled
 *        actions stay focusable (`aria-disabled`) and say why.
 *   G03  Export scope: Notes and Pass reasons are Private and unticked.
 *   G05  A missing tab blocks both directions and offers no tab in its place.
 *   G06  The result vocabulary: Complete only when read back; Outcome
 *        uncertain blocks import until reconciled.
 *   G09  Live-region text per result.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_funds_sheets_7170.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';

const card = await import('../src/pages/research/SheetsSyncCard.jsx');
const model = await import('../src/pages/research/sheetsSyncModel.js');
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const CARD = codeOnly(read('frontend/src/pages/research/SheetsSyncCard.jsx'));
const CLIENT = codeOnly(read('frontend/src/lib/api/researchFundSheets.js'));

const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);

const BASE = {
  configured: true, missing: [], connected: true, google_email: 'hq.research@example.com',
  spreadsheet_id: '1Abcdefghijklmnopqrstuvwxyz0123456789', sheet_gid: 100, sheet_title: 'Shortlist',
  workbook_title: 'Workbook', tab_state: 'present', tab_checked_at: '2026-11-16T10:36:00Z',
  last_runs: { export: null, import: null }, open_run: null,
};

/** Whether the button with this test id is `aria-disabled`. */
const off = (markup, testid) => {
  const at = markup.indexOf(`data-testid="${testid}"`);
  const start = at < 0 ? -1 : markup.lastIndexOf('<button', at);
  const tag = start < 0 || markup.slice(start, at).includes('>') ? null : markup.slice(start, markup.indexOf('>', at) + 1);
  assert.ok(tag, `no ${testid} button`);
  return tag.includes('aria-disabled="true"');
};
const primaries = (markup) => (markup.match(/bg-axal-violet px-3/g) || []).length;

test('every card state has at most one primary action', () => {
  const states = {
    ready: BASE,
    tab_missing: { ...BASE, tab_state: 'missing' },
    pending: { ...BASE, open_run: { uid: 'imp_1', direction: 'import', status: 'uncertain', counts: { created: 4 }, pending: [{ row: 4, cell: 'D4', uid: 'a', name: 'L' }] } },
    no_destination: { ...BASE, spreadsheet_id: null },
    disconnected: { ...BASE, connected: false },
    unconfigured: { ...BASE, configured: false, missing: ['GOOGLE_SHEETS_CLIENT_ID'] },
  };
  for (const [name, status] of Object.entries(states)) {
    assert.equal(model.cardState(status), name);
    const out = html(h(card.default, { initialStatus: status }));
    assert.ok(primaries(out) <= 1, `${name} draws ${primaries(out)} primary actions`);
  }
  assert.equal(model.cardState(null, { loading: true }), 'loading');
  assert.equal(model.cardState(null, { failed: true }), 'unavailable');
});

test('the two actions are named Export Axal funds to Sheets and Import from Sheets', () => {
  const out = renderedText(html(h(card.default, { initialStatus: BASE })));
  assert.match(out, /Export Axal funds to Sheets/);
  assert.match(out, /Import from Sheets/);
  assert.doesNotMatch(out, /Pull from Axal|Push to Axal/);
  assert.match(out, /Nothing transfers until you review it and confirm/);
});

test('a missing tab blocks both directions, offers to choose, and names no other tab', () => {
  const status = { ...BASE, tab_state: 'missing' };
  const out = html(h(card.default, { initialStatus: status }));
  const text = renderedText(out);
  assert.match(text, /not in the workbook/);
  assert.match(text, /No destination is confirmed\. Nothing will be written to another tab\./);
  assert.match(text, /Blocked until you choose a destination tab/);
  assert.match(text, /Choose a tab/);
  // Both actions stay focusable and say why they are off.
  assert.equal(off(out, 'rfg-export-open'), true);
  assert.equal(off(out, 'rfg-import-open'), true);
  assert.match(text, /Off until you choose a tab\./);
  assert.match(out, /role="alert"[^>]*>[^<]*The linked tab Shortlist is no longer in the workbook\. Choose a tab\./);
});

test('an uncertain import makes Reconcile the primary and keeps Import off with its rows', () => {
  const status = {
    ...BASE,
    open_run: { uid: 'imp_1', direction: 'import', status: 'uncertain', counts: { created: 4, ids_expected: 4, ids_confirmed: 0 },
      pending: [4, 11, 16, 19].map((r) => ({ row: r, cell: `D${r}`, uid: `u${r}`, name: `F${r}` })) },
  };
  const out = html(h(card.default, { initialStatus: status }));
  const text = renderedText(out);
  assert.match(text, /Reconcile the import/);
  assert.match(text, /Retry waits until rows 4, 11, 16 and 19 have identifiers/);
  assert.equal(off(out, 'rfg-import-open'), true);
  assert.equal(off(out, 'rfg-export-open'), false, 'export is off while an import is open');
});

test('not configured and not connected are honest, and say what to do', () => {
  const un = renderedText(html(h(card.default, { initialStatus: { ...BASE, configured: false, missing: ['GOOGLE_SHEETS_CLIENT_ID'] } })));
  assert.match(un, /Unavailable · integration not configured/);
  assert.match(un, /Missing: GOOGLE_SHEETS_CLIENT_ID/);
  const off = renderedText(html(h(card.default, { initialStatus: { ...BASE, connected: false } })));
  assert.match(off, /Not connected/);
  assert.match(off, /Connect Google Sheets/);
  assert.match(off, /Not applicable · nothing has run/);
});

test('the last confirmed result shows counts per direction', () => {
  const status = {
    ...BASE,
    last_runs: {
      export: { uid: 'exp_1', direction: 'export', status: 'complete', counts: { expected: 211, written: 211 }, created_at: '2026-11-12T09:14:00Z', updated_at: '2026-11-12T09:14:00Z' },
      import: { uid: 'imp_1', direction: 'import', status: 'complete', counts: { created: 3, updated: 9, planned: { skip: 1 } }, created_at: '2026-11-13T16:40:00Z', updated_at: '2026-11-13T16:40:00Z' },
    },
  };
  const text = renderedText(html(h(card.default, { initialStatus: status })));
  assert.match(text, /Export · 12 Nov, 09:14 UTC/);
  assert.match(text, /211 funds written · read back/);
  assert.match(text, /3 created · 9 updated · 1 skipped/);
  assert.match(text, /Complete · counts verified/);
});

test('export scope: private fields are marked and unticked; the primary is Review export', () => {
  const out = html(h(card.ExportFlow, { status: BASE, onClose() {}, onDone() {} }));
  const text = renderedText(out);
  assert.match(text, /Fields to write/);
  assert.match(text, /Notes\s*Private/);
  assert.match(text, /Pass reasons\s*Private/);
  assert.match(text, /Column J left blank/);
  assert.match(text, /Column H left blank/);
  assert.match(text, /Review export/);
  assert.match(text, /Nothing has been written\./);
  assert.match(out, /aria-current="step"[^>]*>1 Scope/);
  // Fund record always; thesis ticked; notes and pass reasons not.
  const boxes = [...out.matchAll(/<input type="checkbox"[^>]*>/g)].map((m) => m[0]);
  assert.equal(boxes.length, 4);
  assert.deepEqual(boxes.map((b) => / checked=""/.test(b)), [true, true, false, false]);
});

test('the result vocabulary keeps Complete for read-back counts', () => {
  assert.equal(model.resultLabel({ status: 'complete' }).text, 'Complete · counts verified');
  assert.equal(model.resultLabel({ status: 'partial' }).text, 'Partial');
  assert.equal(model.resultLabel({ status: 'failed' }).text, 'Failed · nothing written');
  assert.equal(model.resultLabel({ status: 'uncertain' }).text, 'Outcome uncertain · reconciliation pending');
  assert.equal(model.runCounts({ direction: 'export', counts: { expected: 501, written: 500 } }), '500 of 501 funds written · read back');
  assert.equal(model.runCounts({ direction: 'export', counts: { expected: 214, written: null } }), '214 funds · not read back');
});

test('each result has its live-region text and role', () => {
  assert.deepEqual(model.announcement({ direction: 'export', status: 'complete', counts: { written: 214 } }),
    { role: 'status', text: 'Export complete. 214 funds written and read back.' });
  assert.deepEqual(model.announcement({ direction: 'export', status: 'partial', counts: { written: 500, expected: 501 } }),
    { role: 'alert', text: 'Export partial. 500 of 501 funds written. 1 not written.' });
  assert.deepEqual(model.announcement({ direction: 'export', status: 'failed', counts: {} }),
    { role: 'alert', text: 'Export failed. Nothing was written.' });
  assert.deepEqual(model.announcement({ direction: 'import', status: 'uncertain', counts: { created: 4 } }),
    { role: 'alert', text: 'Import outcome uncertain. 4 created in Axal; identifiers on the sheet not confirmed. Retry is off until reconciled.' });
  assert.equal(model.announcement({ direction: 'import', status: 'complete', counts: { created: 4, updated: 11 } }).text,
    'Import complete: 4 created, 11 updated.');
});

test('the import primary counts changes and the rows left to resolve', () => {
  assert.equal(model.importPrimaryLabel({ create: 4, update: 11, resolve: 2 }), 'Import 15 changes, skip 2 to resolve');
  assert.equal(model.importPrimaryLabel({ create: 1, update: 0 }), 'Import 1 change');
});

test('each run carries one idempotency key per review, and the client sends it', () => {
  const a = model.newIdempotencyKey();
  const b = model.newIdempotencyKey();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{8,80}$/);
  assert.match(CLIENT, /idempotency_key: idempotencyKey/);
  // The key is made when the review opens, not when the button is pressed, so a resend replays the same run.
  assert.match(CARD, /setPreview\(p\); setConfirmed\(false\); key\.current = newIdempotencyKey\(\); setStep\(1\);/);
  assert.match(CARD, /exportRun\(\{ fields, idempotencyKey: key\.current \}\)/);
});

test('the Sheet moves focus to each step heading and is a bottom sheet on a phone', () => {
  assert.match(CARD, /initialFocus=\{head\}/);
  assert.match(CARD, /phone="sheet"/);
  assert.match(CARD, /tabIndex=\{-1\}/);
  assert.match(CARD, /max-sm:min-h-\[44px\]/, 'phone targets are 44px');
});

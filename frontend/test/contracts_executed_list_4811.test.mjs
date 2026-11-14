/**
 * D4811 (#4811) part 23 — "Executed everywhere" (owner, 2026-11-13: A) reaches the agreements list itself. Part 22
 * put the words in `lib/contractLifecycle.js`; this part has `AgreementList.jsx` draw its status chips and its sort
 * from those lists, and has the CT-17 date filter read "Executed" too. The stored and API values stay `signed`,
 * `signed_at`, `signed_from` and `signed_to`, so an existing link opens the same rows. Every title is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/contracts_executed_list_4811.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { contractsApi } from '../src/lib/api.js';
import AgreementList from '../src/pages/admin/contracts/AgreementList.jsx';
import { metricCells } from '../src/pages/admin/contracts/contractMetrics.js';
import { activeAgreementChips, FILTER_BUTTONS } from '../src/lib/contractAgreements.js';

const never = () => new Promise(() => {});
const listMarkup = (filters) => {
  const saved = contractsApi.agreements;
  contractsApi.agreements = never;
  try {
    return renderToStaticMarkup(React.createElement(MemoryRouter, null,
      React.createElement(AgreementList, { filters, onFilters() {}, onOpen() {}, revision: 0 })));
  } finally { contractsApi.agreements = saved; }
};
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

test('the list draws Executed in its chip, its sort and its date filter, and keeps the stored values', () => {
  const html = listMarkup({ status: 'signed', sort: 'signed_at', direction: 'desc', signed_from: '2026-01-01' });
  // Mutation checked: put the inline ['Signed', 'signed'] chip back in AgreementList → this match fails.
  assert.match(html, /<button[^>]*aria-pressed="true"[^>]*>Executed<\/button>/, 'the chip pressed for status=signed reads Executed');
  // Mutation checked: put 'Signed, newest' back in the inline sort → this match fails.
  assert.match(html, /<option value="signed_at:desc" selected="">Executed, newest<\/option>/, 'the sort keeps the field and reads Executed');
  // Mutation checked: FILTER_BUTTONS' 'Signed date' back → the button no longer reads Executed date.
  assert.match(text(html), /Executed date/);
  // Mutation checked: `Signed from` back in activeAgreementChips → the chip reads Signed from.
  assert.match(text(html), /Executed from 2026-01-01/);
  assert.doesNotMatch(text(html), /\bsigned\b/i, 'no word on the list reads signed');
});

test('the strip, the chip and the filter say one word, and open the same records', () => {
  const cell = metricCells({ attention: { awaiting: 1, executed: { total: 2, this_year: 2, this_month: 1 }, stalled: { count: 0 }, repair: { count: 0, evidence: 0, unlinked: 0 } } })
    .find((c) => c.key === 'executed');
  assert.equal(cell.label, 'Executed');
  const html = listMarkup(cell.drill.filters);
  // Mutation checked: label the chip anything but the strip's word → no pressed chip carries it.
  assert.match(html, new RegExp(`<button[^>]*aria-pressed="true"[^>]*>${cell.label}</button>`), 'the strip opens the chip of its own word');
  assert.deepEqual(FILTER_BUTTONS.find(([id]) => id === 'signed'), ['signed', 'Executed date', 'Executed']);
  assert.deepEqual(activeAgreementChips({ signed_from: '2026-01-01', signed_to: '2026-02-01' }).map((c) => [c.key, c.label]),
    [['signed_from', 'Executed from 2026-01-01'], ['signed_to', 'Executed to 2026-02-01']], 'the keys stay signed_from and signed_to');
});

test('no agreement surface labels the state Signed; the workspace fact and the date filter read Executed', () => {
  const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const surfaces = ['pages/admin/contracts/AgreementList.jsx', 'pages/admin/contracts/AgreementWorkspace.jsx', 'pages/admin/contracts/AgreementDetail.jsx',
    'pages/admin/contracts/AgreementFilterRow.jsx', 'pages/admin/contracts/contractMetrics.js', 'lib/contractAgreements.js', 'lib/contractLifecycle.js'];
  // The state's word: a chip or label that is just "Signed", "Signed, newest", "Signed date", or a date filter.
  // A party's own signature ("Signed: …"), a file ("Signed PDF", "Signed copy") and the provider's event stay.
  const stateWord = /['"`>]Signed(?:['"`<,]| date)|label="Signed"|Signed (?:from|to|on or)/;
  // Mutation checked: AgreementWorkspace's <Fact label="Executed"> back to "Signed" → the scan names that file.
  for (const p of surfaces) assert.doesNotMatch(read(p).replace(/envelope_signed: 'Signed'/, ''), stateWord, p);
  assert.match(read('pages/admin/contracts/AgreementWorkspace.jsx'), /<Fact label="Executed">/);
  // Mutation checked: 'Signed on or after' back in AgreementFilterRow → the scan above and this match both fail.
  assert.match(read('pages/admin/contracts/AgreementFilterRow.jsx'), /\['signed_from', 'Executed on or after'.*\['signed_to', 'Executed on or before'/);
});

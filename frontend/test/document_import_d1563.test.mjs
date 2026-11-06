/**
 * D1563 (#3810, deck v2 D2) — pd1's "Import a document", the browser half.
 *
 *   1. the words: which files and pastes may be sent, and the line an import
 *      says (a count the answer does not hold is left out, never shown as 0);
 *   2. the adapter: `importDocument` goes through its client, a file as
 *      multipart and a paste as JSON;
 *   3. the sheet: a wrong file is refused before it is sent; a paste is sent,
 *      and the proposal it made opens on New deck's `?proposal=` address, where
 *      the outline builds into the shared review; a refusal says the Worker's words.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/document_import_d1563.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { deckImportsApi } from '../src/lib/api/deckImports.js';
import * as adapter from '../src/pages/raise/pitch/deckV2Adapter.js';
import DocumentImport from '../src/pages/raise/pitch/DocumentImport.jsx';
import { DOCUMENT_PRIVACY, DOCUMENT_READING, documentProblem, importedLine, pasteProblem } from '../src/pages/raise/pitch/documentImportModel.js';

const h = React.createElement;
const ORIGINAL = { ...deckImportsApi };
const OUTLINE = {
  kind: 'outline', source: 'paste', proposal: { id: 41, slides: [] }, proposal_hash: 'h',
  outline: { rows: Array.from({ length: 12 }, (_, i) => ({ card: `c${i}`, title: `Card ${i}`, purpose: 'p' })), proposed_by: 'Your document' },
  counts: { sections: 3, matched: 3, unmatched: 0, padded: 9, figures_left_out: 1 },
};

let at = null;
function Where() { at = useLocation(); return null; }

async function mount(element) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/raise/pitch?project_id=7'] }, element, h(Where))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => [container, ...walk(document.body)];
  const by = (id) => nodes().find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    by, pr, settle,
    of: (id) => { const n = by(id); assert.ok(n, `no ${id}`); return text(n).replace(/\s+/g, ' ').trim(); },
    async press(id) { await act(async () => { await pr(by(id)).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(id, value) { await act(async () => { pr(by(id)).onChange({ target: { value } }); }); await settle(); },
    async choose(id, file) { await act(async () => { await pr(by(id)).onChange({ target: { files: [file] } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); Object.assign(deckImportsApi, ORIGINAL); },
  };
}

test('1. the words: what may be sent, and what an import made, never a 0 it does not hold', () => {
  // Mutation checked: the .pptx size cap read as 20 MB → the 30 MB deck is refused; a missing count drawn as 0 → the null check fails.
  assert.equal(documentProblem(null), 'Choose a document to import.');
  assert.equal(documentProblem({ name: 'deck.key', size: 10 }), 'Import a Word document (.docx), a PDF or a PowerPoint deck (.pptx).');
  assert.equal(documentProblem({ name: 'plan.docx', size: 21 * 1024 * 1024 }), 'A document can be up to 20 MB.');
  assert.equal(documentProblem({ name: 'Deck.PPTX', size: 30 * 1024 * 1024 }), null);
  assert.equal(documentProblem({ name: 'plan.pdf', size: 10 }), null);
  assert.equal(pasteProblem('  '), 'Paste the text of your document.');
  assert.equal(pasteProblem('x'.repeat(40001)), 'A paste can be up to 40,000 characters. Import the file instead.');
  assert.equal(pasteProblem('Problem\n\nClinics lose patients.'), null);
  assert.equal(importedLine(OUTLINE), 'An outline of 12 cards · 3 sections of your document placed · 1 line with figures left out');
  assert.equal(importedLine({ kind: 'cards', counts: { cards: 15, placed_share: 0.995, not_placed: 1 } }), '15 slides imported as editable cards · 99% of the text placed on the grid · 1 box moved to the notes');
  assert.equal(importedLine({ kind: 'cards', counts: { cards: 2, placed_share: null, not_placed: 0 } }), '2 slides imported as editable cards');
  assert.equal(importedLine({ kind: 'cards', counts: {} }), null, 'no count, no line — never “0 slides”');
  assert.equal(importedLine(null), null);
});

test('2. the adapter: importDocument goes through its client; a refusal carries the Worker’s words', async () => {
  // Mutation checked: the row left off(...) → availability is not null and the call never reaches the client.
  assert.equal(adapter.availability('importDocument'), null);
  assert.equal(adapter.SURFACES.importDocument.issue, 3810);
  const sent = [];
  deckImportsApi.importDocument = async (pid, input) => { sent.push([pid, input.file?.name ?? null, input.text ?? null]); return OUTLINE; };
  try {
    assert.equal((await adapter.importDocument(7, { text: 'Team\n\nFounders.' })).value.proposal.id, 41);
    assert.equal((await adapter.importDocument(7, { file: { name: 'plan.docx' } })).available, true);
    assert.deepEqual(sent, [[7, null, 'Team\n\nFounders.'], [7, 'plan.docx', null]]);
    deckImportsApi.importDocument = async () => { throw Object.assign(new Error('That document could not be read. Paste its text instead; nothing was changed.'), { status: 422 }); };
    const refused = await adapter.importDocument(7, { file: { name: 'scan.pdf' } });
    assert.equal(refused.available, false);
    assert.match(refused.reason, /could not be read/);
  } finally { Object.assign(deckImportsApi, ORIGINAL); }
});

test('3. the sheet: a wrong file is refused first; a paste opens its proposal on New deck', async () => {
  // Mutation checked: the navigate removed → the address stays on the studio; documentProblem skipped → the .key file is sent.
  let release;
  const sent = [];
  deckImportsApi.importDocument = (pid, input) => { sent.push([pid, input.file ? 'file' : 'text']); return new Promise((r) => { release = () => r(OUTLINE); }); };
  let closed = 0;
  const v = await mount(h(DocumentImport, { projectId: 7, q: '?project_id=7', onClose() { closed += 1; } }));
  try {
    assert.ok(v.of('pitch-document-drop').includes(DOCUMENT_PRIVACY));
    await v.choose('pitch-document-file', { name: 'deck.key', size: 10 });
    assert.equal(v.of('pitch-document-line'), 'Import a Word document (.docx), a PDF or a PowerPoint deck (.pptx).');
    assert.equal(sent.length, 0, 'a refused file is never sent');
    await v.type('pitch-document-paste', 'Northwind Labs\n\nProblem\n\nClinics lose patients between visits.');
    await act(async () => { v.pr(v.by('pitch-document-send')).onClick(); });
    assert.equal(v.of('pitch-document-reading'), DOCUMENT_READING);
    await act(async () => { release(); }); await v.settle();
    assert.deepEqual(sent, [[7, 'text']]);
    assert.equal(`${at.pathname}${at.search}`, '/raise/pitch/new?project_id=7&proposal=41');
    assert.equal(closed, 1);
  } finally { await v.unmount(); }
});

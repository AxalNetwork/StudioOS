/**
 * #6030 (BD7) — Solution design's features say why each exists, and a feature
 * with no evidence is fixed in one step.
 *
 *   · one evidence cell, its pain theme and hypothesis each a link to its record;
 *   · the filter names its link kind (Pain linked / Hypothesis linked / No
 *     evidence link), each option with its count; "Linked" is gone;
 *   · a feature with no evidence offers "Link evidence", which opens the same
 *     Edit form focused on the link fields; on a phone, the row's tap does it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/solution_design_evidence_6030.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { Cell, RecordsTable } from '../src/pages/cycles/CycleModulePage.jsx';
import { phoneRow } from '../src/pages/cycles/PhoneModulePage.jsx';
import { cellView, linkEvidenceAction, optionLabel } from '../src/pages/cycles/cycleModel.js';

const evidence = {
  text: 'Pain · Setup takes two days · Hypothesis · Teams migrate in week 1',
  links: [
    { text: 'Pain · Setup takes two days', href: '/validate/problem-discovery/4?project=12' },
    { text: 'Hypothesis · Teams migrate in week 1', href: '/validate/experiments/7?project=12' },
  ],
};
const records = {
  cols: [{ key: 'feature', label: 'Feature' }, { key: 'evidence', label: 'Evidence link' }, { key: 'impact', label: 'Impact' }, { key: 'effort', label: 'Effort' }],
  rows: [
    { id: 1, cells: { feature: 'Instant workspace setup', evidence, impact: 'High', effort: 'Medium' }, keys: { evidence: 'pain' } },
    { id: 2, cells: { feature: 'CSV import', evidence: { text: 'Hypothesis · Teams migrate in week 1', links: [evidence.links[1]] }, impact: 'High', effort: 'Medium' }, keys: { evidence: 'hypothesis' } },
    { id: 3, cells: { feature: 'Dark mode', evidence: { text: 'No evidence link', tone: 'warn' }, impact: null, effort: 'Low' }, keys: { evidence: 'none' } },
  ],
  total: 3, page: 1, page_size: 25,
  filters: [{ key: 'evidence', label: 'Evidence link', options: [
    { value: 'pain', label: 'Pain linked', count: 4 }, { value: 'hypothesis', label: 'Hypothesis linked', count: 1 }, { value: 'none', label: 'No evidence link', count: 1 },
  ] }],
  sorts: [{ key: 'impact', label: 'Impact' }],
};
const inRouter = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

// Mutation checked: cellView dropping `links` (fails); Cell drawing only the text (fails); an outside href kept (fails).
test('BD7: the evidence cell links each record it cites; a hypothesis-only feature is never shown as unlinked', () => {
  const v = cellView(evidence);
  assert.deepEqual(v.links.map((l) => l.href), ['/validate/problem-discovery/4?project=12', '/validate/experiments/7?project=12']);
  assert.equal(cellView({ text: 'x', links: [{ text: 'Pain · y', href: 'https://example.test/' }] }).links[0].href, null, 'only in-app paths are linked');
  const html = inRouter(h(Cell, { cell: evidence }));
  assert.match(html, /href="\/validate\/problem-discovery\/4\?project=12"[^>]*>Pain · Setup takes two days →</);
  assert.match(html, /href="\/validate\/experiments\/7\?project=12"[^>]*>Hypothesis · Teams migrate in week 1 →</);
  const hypOnly = renderedText(inRouter(h(Cell, { cell: records.rows[1].cells.evidence })));
  assert.match(hypOnly, /^Hypothesis · Teams migrate in week 1 →$/);
  assert.doesNotMatch(hypOnly, /No evidence|Links to nothing|Unlinked/);
  // A row that is itself a link draws the evidence as plain text, never a link inside a link.
  assert.doesNotMatch(inRouter(h(Cell, { cell: evidence, plain: true })), /<a /);
});

// Mutation checked: optionLabel ignoring count (fails).
test('BD7: the filter names its link kind with each count; the word "Linked" is not a filter', () => {
  assert.equal(optionLabel({ label: 'Pain linked', count: 4 }), 'Pain linked · 4');
  assert.equal(optionLabel({ label: 'High' }), 'High', 'an option without a count reads as before');
  const html = inRouter(h(RecordsTable, { title: 'Features', records, query: {} }));
  const text = renderedText(html);
  for (const o of ['Pain linked · 4', 'Hypothesis linked · 1', 'No evidence link · 1']) assert.ok(text.includes(o), o);
  assert.match(html, /aria-label="Evidence link"/);
  assert.doesNotMatch(html, /aria-label="Linked"|>Linked: all</);
});

// Mutation checked: Link evidence offered on a linked row (fails); not offered on an unlinked one (fails).
test('BD7: "Link evidence" is the row action of a feature with no evidence, and only of that one', () => {
  const open = () => 'opened';
  const first = (row) => cellView(row.cells.feature);
  assert.equal(linkEvidenceAction(records.rows[0], first(records.rows[0]), open), null);
  assert.equal(linkEvidenceAction(records.rows[1], first(records.rows[1]), open), null, 'hypothesis linked is linked');
  const act = linkEvidenceAction(records.rows[2], first(records.rows[2]), open);
  assert.equal(act.text, 'Link evidence');
  assert.equal(act.label, 'Link evidence to Dark mode');
  assert.equal(act.onClick(), 'opened');
  const html = inRouter(h(RecordsTable, { title: 'Features', records, query: {}, rowAction: (r) => linkEvidenceAction(r, first(r), open) || { text: 'Edit', onClick: open } }));
  assert.equal((html.match(/data-testid="records-row-action"[^>]*>Link evidence</g) || []).length, 1);
  assert.equal((html.match(/data-testid="records-row-action"[^>]*>Edit</g) || []).length, 2);
});

// Mutation checked: the route opening Edit without the focus (fails); FormLightbox ignoring focusField (fails).
test('BD7: Link evidence opens the existing Edit form, focused on the link fields, and saves through its PATCH', () => {
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.match(route, /linkEvidenceAction\(row, [^)]*\),\s*\(\) => navigate\(`\$\{location\.pathname\}\$\{location\.search\}`, \{ state: \{ editing: String\(row\.id\), editingFocus: 'pain_group_id' \} \}\)\)/);
  assert.equal((route.match(/focusField=\{typeof location\.state\?\.editingFocus === 'string' \? location\.state\.editingFocus : null\}/g) || []).length, 2, 'both Edit forms take the focus');
  const form = readFileSync(new URL('../src/pages/cycles/FormLightbox.jsx', import.meta.url), 'utf8');
  assert.match(form, /document\.getElementById\(`\$\{id\}-\$\{focusField\}`\) \|\| document\.getElementById\(`\$\{id\}-\$\{focusField\}-0`\)/);
  // The same form, the same write: the feature's Edit is forms.js's, which PATCHes both link fields.
  const forms = readFileSync(new URL('../src/pages/cycles/forms.js', import.meta.url), 'utf8');
  assert.match(forms, /pain_group_id: idOrNull\(v\.pain_group_id\), hypothesis_id: idOrNull\(v\.hypothesis_id\)/);
});

test('BD7 on a phone: the evidence reads as the row\'s description, the unlinked row carries its pill', () => {
  const linked = phoneRow(records.cols, records.rows[1]);
  assert.equal(linked.description, 'Hypothesis · Teams migrate in week 1');
  assert.equal(linked.pill, undefined);
  const none = phoneRow(records.cols, records.rows[2]);
  assert.equal(none.description, 'No evidence link');
  assert.deepEqual(none.pill, { label: 'No evidence link', tone: 'warn' });
});

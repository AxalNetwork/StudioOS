// D6897 part 2 (#6897, canvas D6054 RA-28 C, RA-29, RA-30 B) — the evidence pack and the readiness snapshot as A4
// PDF copies: what the page says (the reader pages' own words), how it is drawn (A4, every row on a page, the header
// repeated, the footer on every page), the Link/PDF choice and its checks, and the PDF copies on Shared links.
// Sample data only.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_share_pdf_6897.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createPdfStub } from './_pdf-stub.mjs';
import { renderSharePdf, A4 } from '../src/lib/raiseSharePdf.js';
import { readinessPdfModel, packPdfModel, valueWords, copyShares, pdfFilename, COPY_LINE } from '../src/pages/cycles/evidence/sharePdfModel.js';
import { snapshotErrors, snapshotBody, composerErrors, composerBody, OUTPUTS } from '../src/pages/cycles/evidence/shareOutsideModel.js';
import { PdfCopiesList } from '../src/pages/cycles/evidence/ShareOutside.jsx';
import { OutputChoice } from '../src/pages/cycles/evidence/ShareReadiness.jsx';
import { raiseEvidenceShareApi } from '../src/lib/api/raiseEvidenceShare.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const read = (p) => readFileSync(p, 'utf8');
const PT = 0.75;

const AREAS = [
  { key: 'narrative', label: 'Investor narrative', score: 7, evidence: 'Stated', missing: 'One customer story.', scored_on: '2026-11-02', words: '7 of 10' },
  { key: 'data_room', label: 'Data room', score: null, evidence: null, missing: null, scored_on: null, words: 'Not scored yet' },
  { key: 'cap_table', label: 'Cap table', score: 0, evidence: 'Measured', missing: 'Every holder.', scored_on: '2026-11-04', words: '0 of 10' },
  { key: 'team', label: 'Team', score: null, evidence: null, missing: null, scored_on: null, words: 'Team is assessed by a person' },
];
const SNAPSHOT = { kind: 'readiness', venture: '[Sample venture]', covering_line: 'Where we stand this week.', made_at: '2026-11-17T10:00:00.000Z', areas: AREAS };
const item = (i, extra = {}) => ({ uid: `item-${i}`, area: 'Traction proof', kind: 'kpi-snapshot', source_label: 'manual', observed_on: '2026-10-01', strength: 'measured', value_num: 4200 + i, value_unit: 'USD', currency: 'USD', value_reason: null, ...extra });
const AFTER = {
  reader: 'after_nda', nda_signed: true, nda_signed_on: '2026-11-01', venture: '[Sample venture]', made_at: '2026-11-17T10:00:00.000Z', partial: false,
  coverage: { state: 'recorded', groups: [] },
  items: { state: 'recorded', rows: [item(1), item(2, { value_reason: 'Shared as a summary only.' }), item(3, { value_reason: 'The bank figure stays in Axal.' })] },
  claims: { state: 'recorded', rows: [{ uid: 'c1', state: 'mismatch', checked_at: '2026-11-10', founder_note: 'Recounted after the audit.' }] },
};
const BEFORE = {
  reader: 'before_nda', nda_signed: false, venture: '[Sample venture]', made_at: '2026-11-17T10:00:00.000Z', before_nda: 'Figures, files and quotes open once the NDA is signed.',
  coverage: { state: 'recorded', groups: [{ area: 'Traction proof', kind: 'kpi-snapshot', source_label: 'manual', count: 3, newest: '2026-10-01' }] }, items: null, claims: null,
};
const texts = (doc) => doc.calls.filter((c) => c.op === 'text').map((c) => [].concat(c.text ?? c.str ?? c.args?.[0] ?? '').join(' ')).join('\n');

test('the readiness PDF says what the reader page says: dated, the covering line, Not scored yet, a real 0, Team by a person', () => {
  const m = readinessPdfModel(SNAPSHOT);
  assert.equal(m.filename, 'axal-readiness-sample-venture-2026-11-17.pdf');
  assert.equal(m.title, 'Fundraising readiness');
  assert.match(m.dated, /as recorded on 17 Nov 2026\. This page does not update/);
  assert.equal(m.line, 'Where we stand this week.');
  const [s] = m.sections;
  assert.deepEqual(s.columns, ['Area', 'Score', 'Evidence', 'What is missing', 'Scored']);
  assert.deepEqual(s.rows.map((r) => r[1]), ['7 of 10', 'Not scored yet', '0 of 10', 'Team is assessed by a person']);
  assert.ok(!JSON.stringify(m.sections).match(/overall|Product-market|PMF/i), 'an overall score or a PMF row reached the PDF');
  assert.equal(s.rows.length, AREAS.length, 'a row was added or lost');
  assert.match(m.foot, /never 0/);
  assert.equal(readinessPdfModel({ ...SNAPSHOT, areas: undefined }).sections[0].empty, 'Not recorded.');
});

test('the pack PDF: before an NDA, coverage only; after one, a figure only as shared, Value withheld with its reason, a Mismatch kept', () => {
  const before = packPdfModel(BEFORE);
  assert.match(before.eyebrow, /before an NDA/);
  assert.deepEqual(before.sections.map((s) => s.heading), ['What is on record']);
  assert.deepEqual(before.sections[0].columns, ['Area', 'Kind', 'Source', 'How many', 'Newest']);
  assert.deepEqual([before.sections[0].rows[0][0], before.sections[0].rows[0][3], before.sections[0].rows[0][4]], ['Traction proof', '3', '1 Oct 2026']);
  assert.ok(!JSON.stringify(before).includes('4201'), 'a before-NDA PDF carried a figure');
  const after = packPdfModel(AFTER);
  assert.match(after.shared, /after an NDA signed outside Axal on 1 Nov 2026/);
  assert.deepEqual(after.sections.map((s) => s.heading), ['Evidence', 'Claims these items back']);
  const values = after.sections[0].rows.map((r) => r[5]);
  assert.match(values[0], /4,201|4201/);
  assert.equal(values[1], 'Shared as a summary only.');
  assert.equal(values[2], 'Value withheld: The bank figure stays in Axal.');
  assert.match(after.sections[1].rows[0][0], /Mismatch/i);
  assert.equal(after.sections[1].rows[0][2], 'Recounted after the audit.');
  assert.equal(valueWords({ value_num: null }), 'Not recorded', 'a missing figure was drawn as 0');
  assert.equal(packPdfModel({ ...AFTER, claims: { state: 'recorded', rows: [] } }).sections[1].empty, 'No claim is backed by these items.');
});

test('drawn on A4: inside the page box, every row on a page, the header repeated, a footer with Page n of m on every page', () => {
  const one = createPdfStub();
  assert.equal(renderSharePdf(one, readinessPdfModel(SNAPSHOT)), 1);
  const bottom = Math.max(...one.calls.filter((c) => c.op === 'text').map((c) => c.y ?? c.args?.[2] ?? 0));
  assert.ok(bottom / PT < A4.h - 40, `text runs past the A4 page (${bottom / PT}px)`);
  assert.match(texts(one), /Page 1 of 1/);

  const long = { ...AFTER, items: { state: 'recorded', rows: Array.from({ length: 120 }, (_, i) => item(i, { area: `Area ${i % 6}` })) } };
  const doc = createPdfStub();
  const pages = renderSharePdf(doc, packPdfModel(long));
  assert.ok(pages >= 3, `120 rows fit on ${pages} page(s)`);
  const all = texts(doc);
  for (let i = 0; i < 120; i += 1) assert.ok(all.includes(`Area ${i % 6}`), `row ${i} was clipped`);
  assert.equal((all.match(/^AREA$/gm) || []).length, pages, 'the header row is not on every page of the table');
  for (let p = 1; p <= pages; p += 1) assert.ok(all.includes(`Page ${p} of ${pages}`), `page ${p} has no footer`);
});

test('Output: Link or PDF; a PDF drops the expiry and the view limit from the checks and the body', () => {
  assert.deepEqual(OUTPUTS.map((o) => o.key), ['link', 'pdf']);
  const snap = { output: 'pdf', label: '[Sample advisor]', covering_line: ' One line. ', expires_in_days: 'x', view_limit: -1 };
  assert.deepEqual(snapshotErrors(snap), {});
  assert.deepEqual(snapshotBody(snap), { label: '[Sample advisor]', covering_line: 'One line.' });
  assert.ok(snapshotErrors({ ...snap, output: 'link' }).expires_in_days, 'a link lost its expiry check');
  const pack = { output: 'pdf', label: '[Sample fund]', reader: 'after_nda', nda_confirmed: true, nda_signed_on: '2026-11-01', expires_in_days: 'x', view_limit: 0 };
  assert.deepEqual(composerErrors(pack, '2026-11-17'), {});
  assert.deepEqual(composerBody(pack), { label: '[Sample fund]', reader: 'after_nda', nda_confirmed: true, nda_signed_on: '2026-11-01' });
  assert.ok(composerErrors({ ...pack, nda_confirmed: false }, '2026-11-17').nda_confirmed, 'a PDF skipped the NDA confirmation');
  const out = html(h(OutputChoice, { value: 'pdf', onChange() {}, name: 'o', testId: 't' }));
  assert.match(out, /<legend[^>]*>Output<\/legend>/);
  assert.match(out, /checked="" value="pdf"/);
  assert.doesNotMatch(out, /checked="" value="link"/);
  assert.match(out, /cannot be stopped or counted/);
});

test('Shared links lists PDF copies apart, with what each shares and the day; no state, no Revoke', () => {
  const copies = [
    { uid: 'p1', kind: 'pdf', output: 'readiness', label: '[Sample advisor]', reader: 'before_nda', item_count: 7, created_at: '2026-11-17T10:00:00Z' },
    { uid: 'p2', kind: 'pdf', output: 'pack', label: '[Sample fund]', reader: 'after_nda', item_count: 6, created_at: '2026-11-14T14:22:00Z' },
  ];
  assert.equal(copyShares(copies[1]), 'Evidence pack · 6 items · after NDA');
  assert.equal(copyShares({ output: 'pack', reader: 'before_nda', item_count: 1 }), 'Evidence pack · 1 item · before NDA');
  assert.equal(copyShares(copies[0]), 'Readiness snapshot · 7 areas');
  const out = html(h(PdfCopiesList, { copies }));
  assert.match(out, /PDF copies · 2/);
  assert.ok(out.includes(COPY_LINE));
  assert.match(out, /Downloaded 14 Nov 2026/);
  assert.doesNotMatch(out, /Revoke|Live|Expired|views/, 'a copy was shown as if it were a link');
  assert.equal(pdfFilename('evidence-pack', '  ', null), 'axal-evidence-pack-venture-undated.pdf');
});

test('wiring: the client posts to the two copy routes; the sheets offer PDF and draw what the Worker returned', async () => {
  const src = read('frontend/src/lib/api/raiseEvidenceShare.js');
  assert.match(src, /createPackPdf: \(projectId, body\) => request\(`\/cycles\/raise\/evidence\/pdf-copies\?/);
  assert.match(src, /createReadinessPdf: \(projectId, body\) => request\(`\/cycles\/raise\/readiness\/pdf-copies\?/);
  assert.equal(typeof raiseEvidenceShareApi.createPackPdf, 'function');
  const worker = read('cloudflare-worker/src/routes/cycle_raise.ts');
  assert.match(worker, /cycleRaise\.post\('\/evidence\/pdf-copies'/);
  assert.match(worker, /cycleRaise\.post\('\/readiness\/pdf-copies'/);
  const sheet = read('frontend/src/pages/cycles/evidence/ShareReadiness.jsx');
  assert.match(sheet, /downloadReadinessPdf\(copy\.snapshot\)/);
  const pack = read('frontend/src/pages/cycles/evidence/ShareOutside.jsx');
  assert.match(pack, /downloadPackPdf\(copy\.pack\)/);
  assert.match(pack, /<PdfCopiesList copies=\{state\.read\.copies\} \/>/);
  const lib = read('frontend/src/lib/raiseSharePdf.js');
  assert.match(lib, /format: 'a4'/);
  assert.match(lib, /import\('jspdf'\)/, 'jsPDF must stay out of the initial bundle');
});

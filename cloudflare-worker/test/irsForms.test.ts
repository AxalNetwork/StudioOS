// Task #9 — IRS-style form renderers.
//
// Each renderer must produce a real, loadable PDF with the expected page
// count and embed the three placeholder fields. These checks lock in that the
// catalog stays in sync with the dispatcher and that SS-4 carries its
// instructions page.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import {
  IRS_FORMS,
  FORM_PLACEHOLDER_FIELDS,
  renderForm,
  renderSS4Pdf,
  renderForm8821Pdf,
  renderFaxedEinPdf,
  renderConfirmationPdf,
  sampleFields,
  type FormFields,
} from '../src/services/irsForms.ts';

const FIELDS: FormFields = {
  fullLegalName: 'Ada Lovelace',
  company: 'Analytical Engines, Inc.',
  date: '2026-06-11',
};

function assertIsPdf(bytes: Uint8Array) {
  assert.ok(bytes instanceof Uint8Array, 'returns a Uint8Array');
  assert.ok(bytes.length > 800, 'PDF has non-trivial length');
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  assert.equal(magic, '%PDF', 'starts with the %PDF magic bytes');
}

test('catalog declares exactly the four forms with placeholder fields', () => {
  const ids = IRS_FORMS.map((f) => f.id).sort();
  assert.deepEqual(ids, ['confirmation', 'faxed_ein', 'form_8821', 'ss4']);
  assert.deepEqual([...FORM_PLACEHOLDER_FIELDS], ['full_legal_name', 'company', 'date']);
  for (const f of IRS_FORMS) {
    assert.ok(f.title && f.description, `${f.id} has title + description`);
    assert.ok(f.pages >= 1, `${f.id} declares a page count`);
  }
});

test('each catalog id renders a valid PDF with its declared page count', async () => {
  for (const meta of IRS_FORMS) {
    const bytes = await renderForm(meta.id, FIELDS);
    assert.ok(bytes, `renderForm(${meta.id}) returned bytes`);
    assertIsPdf(bytes!);
    const doc = await PDFDocument.load(bytes!);
    assert.equal(doc.getPageCount(), meta.pages, `${meta.id} has ${meta.pages} page(s)`);
  }
});

test('SS-4 includes its instructions page (2 pages)', async () => {
  const bytes = await renderSS4Pdf(FIELDS);
  assertIsPdf(bytes);
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
});

test('single-page forms each render one page', async () => {
  for (const render of [renderForm8821Pdf, renderFaxedEinPdf, renderConfirmationPdf]) {
    const bytes = await render(FIELDS);
    assertIsPdf(bytes);
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
  }
});

test('blank fields still render valid PDFs (no throw on empty values)', async () => {
  const blank: FormFields = { fullLegalName: '', company: '', date: '' };
  for (const meta of IRS_FORMS) {
    const bytes = await renderForm(meta.id, blank);
    assert.ok(bytes, `${meta.id} blank render returned bytes`);
    assertIsPdf(bytes!);
  }
});

test('unknown form id returns null (so routes can 404 cleanly)', async () => {
  const bytes = await renderForm('does_not_exist', FIELDS);
  assert.equal(bytes, null);
});

test('sampleFields supplies all three placeholder values', () => {
  const s = sampleFields();
  assert.ok(s.fullLegalName.length > 0);
  assert.ok(s.company.length > 0);
  assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/);
});

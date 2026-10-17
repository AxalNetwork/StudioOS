/**
 * D705 (#1716) — the Fund's execution block in the PDF: a subscription is
 * signed by Axal VC Spin-Out Lab Fund I LP "By: Axal VC GP LLC, its general
 * partner", by its General Partner, and the whole block stays on one page.
 *
 * The text is read back from each page's own content streams, so "on one
 * page" means the same page object, not the same file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFArray, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import { renderTemplatePreviewPdf } from '../src/services/pdf.ts';

/** The text each page draws, from its `<hex> Tj` operators, page by page. */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const raw = page.node.lookup(PDFName.of('Contents'));
    const streams = raw instanceof PDFArray
      ? raw.asArray().map((r) => doc.context.lookup(r))
      : [raw];
    let ops = '';
    for (const s of streams) {
      if (s instanceof PDFRawStream) ops += Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
    }
    const lines: string[] = [];
    for (const m of ops.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) lines.push(Buffer.from(m[1], 'hex').toString('latin1'));
    return lines.join('\n');
  });
}

test('D705: a subscription\'s execution page names the Fund, its general partner and the General Partner title', async () => {
  const bytes = await renderTemplatePreviewPdf({
    documentTitle: 'Subscription Agreement', documentBody: 'The Investor subscribes.',
    documentType: 'subscription', counterpartyName: 'Juniper Holdings LLC',
  });
  const pages = await pageTexts(bytes);
  const exec = pages.find((p) => p.includes('EXECUTION'));
  assert.ok(exec, 'an execution block was drawn');
  for (const line of [
    'Axal VC Spin-Out Lab Fund I LP',
    'By: Axal VC GP LLC, its general partner',
    'Name: Joseph Gabriel Guillaume Lauzier',
    'Title: General Partner',
  ]) assert.ok(exec!.includes(line), line);
  assert.ok(!pages.join('\n').includes('Axal VC Fund I, LP'));
  // The capacity line comes between the heading and the signature line.
  const at = (s: string) => exec!.indexOf(s);
  assert.ok(at('Axal VC Spin-Out Lab Fund I LP') < at('By: Axal VC GP LLC, its general partner'));
  assert.ok(at('By: Axal VC GP LLC, its general partner') < at('By: ___'));
});

test('D705: the Fund\'s whole block stays on one page wherever the body ends', async () => {
  // One body line more each time, so the block meets every position near a
  // page break: the height that keeps it together must count the capacity line.
  // A body line is 14pt and a blank line 7.7pt, so lines and blanks together
  // step the block's start through every few points of the page.
  for (let n = 40; n <= 100; n += 1) for (let k = 0; k <= 2; k += 1) {
    const body = [...Array.from({ length: n }, (_, i) => `Clause ${i + 1}.`), ...Array.from({ length: k }, () => ''), 'End.'].join('\n');
    const pages = await pageTexts(await renderTemplatePreviewPdf({
      documentTitle: 'Subscription Agreement', documentBody: body, documentType: 'subscription',
    }));
    const holding = pages.filter((p) => p.includes('EXECUTION'));
    assert.equal(holding.length, 1, `n=${n} k=${k}`);
    for (const line of ['Axal VC Spin-Out Lab Fund I LP', 'By: Axal VC GP LLC, its general partner', 'Title: General Partner', '[Counterparty Legal Name]']) {
      assert.ok(holding[0].includes(line), `n=${n} k=${k}: ${line}`);
    }
    // The counterparty's last line, Date, is on the same page as the heading.
    assert.equal((holding[0].match(/Date: _+/g) || []).length, 2, `n=${n} k=${k}: both Date lines`);
  }
});

test('D705: a Management document still prints Managing Partner and no capacity line', async () => {
  const bytes = await renderTemplatePreviewPdf({
    documentTitle: 'Mentor Agreement', documentBody: 'The Mentor advises.', documentType: 'mentor_nda_axal',
  });
  const text = (await pageTexts(bytes)).join('\n');
  assert.ok(text.includes('Axal VC Management LLC'));
  assert.ok(text.includes('Title: Managing Partner'));
  assert.ok(!text.includes('its general partner'));
});

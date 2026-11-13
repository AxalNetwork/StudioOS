/**
 * D711 (#1776) — printing the paper: Browser Run through `quickAction`, the
 * two-pass contents for a cover slug, and the pdf-lib fallback on every
 * failure, never `BROWSER.fetch`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import { paperModel, type PaperInput } from '../src/services/legalPaper.ts';
import { renderLegalPdf } from '../src/services/legalPaperRender.ts';
import { renderPaperFallbackPdf } from '../src/services/pdf.ts';

const SHA = 'e'.repeat(64);
const model = (i: Partial<PaperInput> = {}) => paperModel({
  title: 'Mutual NDA', body: '## Article 1 Terms\nAgreed.', slug: 'mutual_nda', bodySha256: SHA, state: { kind: 'draft' }, ...i,
});

async function pdfWithPages(n: number, linkPages: number[] = []): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([612, 792]);
  for (const p of linkPages) {
    const page = doc.getPage(p - 1);
    const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], Border: [0, 0, 0] });
    page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  }
  return doc.save();
}

function fakeBrowser(answer: (html: string, call: number) => Promise<Response> | Response) {
  const calls: { action: string; options: any }[] = [];
  let fetched = 0;
  return {
    calls,
    get fetched() { return fetched; },
    binding: {
      fetch: async () => { fetched++; throw new Error('BROWSER.fetch must not be called'); },
      quickAction: async (action: string, options: any) => { calls.push({ action, options }); return answer(options.html, calls.length); },
    },
  };
}

async function texts(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = '';
  for (const page of doc.getPages()) {
    const raw = page.node.lookup(PDFName.of('Contents'));
    const streams = raw instanceof PDFArray ? raw.asArray().map((r) => doc.context.lookup(r)) : [raw];
    let ops = '';
    for (const s of streams) if (s instanceof PDFRawStream) ops += Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
    for (const m of ops.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) out += Buffer.from(m[1], 'hex').toString('latin1') + '\n';
  }
  return out;
}

test('D711 Browser Run prints through quickAction("pdf", …) with the paper, the size and the renderer recorded', async () => {
  for (const pageSize of ['letter', 'a4'] as const) {
    const fake = fakeBrowser(async () => new Response(await pdfWithPages(1)));
    const r = await renderLegalPdf({ BROWSER: fake.binding } as any, model(), { pageSize, cover: 'dark' });
    assert.ok(r.ok && r.renderer === 'browser_run');
    assert.equal(fake.calls.length, 1);
    const { action, options } = fake.calls[0];
    assert.equal(action, 'pdf');
    assert.ok(options.html.startsWith('<!doctype html>') && options.html.includes('<h1 class="title">Mutual NDA</h1>'));
    assert.ok(options.html.includes('@font-face'), 'faces inline');
    assert.deepEqual(options.pdfOptions, { format: pageSize, printBackground: true, preferCSSPageSize: true });
    assert.deepEqual(options.gotoOptions, { waitUntil: 'networkidle0' });
    assert.equal(fake.fetched, 0);
  }
});

test('D711 a cover slug prints its contents from pass 1\'s link pages, numbers its front matter i and ii, and strips the links', async () => {
  const body = '## Article I Summary\nA.\n## Article II Risks\nB.\n## Article III Terms\nC.';
  const fake = fakeBrowser(async (_html, n) => new Response(n === 1 ? await pdfWithPages(4, [1, 3, 4]) : await pdfWithPages(2)));
  const r = await renderLegalPdf({ BROWSER: fake.binding } as any, model({ title: 'Private Placement Memorandum', slug: 'ppm', body }), { pageSize: 'letter', cover: 'dark' });
  assert.ok(r.ok && r.renderer === 'browser_run');
  const [pass1, pass2] = fake.calls.map((c) => c.options.html as string);
  assert.ok(pass1.includes('<a href="#art-1">') && !pass1.includes('<section class="cover'), 'pass 1 is the body with linked headings');
  assert.ok(pass2.includes('<section class="cover') && !pass2.includes('<h1 class="title">Private Placement Memorandum</h1>\n'), 'pass 2 is the front matter');
  assert.deepEqual([...pass2.matchAll(/<span class="pg">(\d+)<\/span>/g)].map((m) => m[1]), ['1', '3', '4']);
  assert.ok(pass2.includes('counter(page, lower-roman)'), 'front matter numbered i, ii');
  const merged = await PDFDocument.load(r.bytes);
  assert.equal(merged.getPageCount(), 6);
  for (const page of merged.getPages()) assert.equal(page.node.lookup(PDFName.of('Annots')), undefined, 'no link annotation survives');
});

test('D711 a pass 1 with no link annotations prints the contents without numbers and logs toc_unresolved', async () => {
  const warns: string[] = [];
  const orig = console.warn;
  console.warn = (s: unknown) => { warns.push(String(s)); };
  try {
    const fake = fakeBrowser(async () => new Response(await pdfWithPages(2)));
    const r = await renderLegalPdf({ BROWSER: fake.binding } as any, model({ slug: 'ppm', body: '## Article I A\nx.' }), { pageSize: 'letter', cover: 'light' });
    assert.ok(r.ok);
    assert.ok(!fake.calls[1].options.html.includes('class="pg"'));
    assert.ok(warns.some((w) => w.includes('toc_unresolved')));
  } finally { console.warn = orig; }
});

test('D711 every Browser Run failure falls back to a valid pdf-lib PDF, or answers its code with fallback: false', async () => {
  const pdf = await pdfWithPages(1);
  const cases: [string, any, string][] = [
    ['no binding', undefined, 'browser_unbound'],
    ['a throw', fakeBrowser(() => { throw new Error('down'); }).binding, 'browser_error'],
    ['a 500', fakeBrowser(() => new Response('no', { status: 500 })).binding, 'browser_status'],
    ['non-PDF bytes', fakeBrowser(() => new Response('<html>not a pdf</html>')).binding, 'not_pdf'],
    ['over 10 MB', fakeBrowser(() => new Response(new Uint8Array(10 * 1024 * 1024 + 1).fill(37))).binding, 'pdf_too_large'],
    ['a hang', fakeBrowser(() => new Promise<Response>((res) => setTimeout(() => res(new Response(pdf)), 400))).binding, 'browser_timeout'],
  ];
  const orig = console.warn;
  console.warn = () => {};
  try {
    for (const [name, binding, code] of cases) {
      const env = { BROWSER: binding } as any;
      const r = await renderLegalPdf(env, model(), { pageSize: 'letter', cover: 'dark', timeoutMs: 50 });
      assert.ok(r.ok && r.renderer === 'pdf_lib', name);
      assert.equal(String.fromCharCode(...r.bytes.subarray(0, 5)), '%PDF-', name);
      await PDFDocument.load(r.bytes);
      const strict = await renderLegalPdf(env, model(), { pageSize: 'letter', cover: 'dark', timeoutMs: 50, fallback: false });
      assert.deepEqual(strict, { ok: false, code }, name);
    }
  } finally { console.warn = orig; }
});

test('D711 the fallback is Letter or A4, ends with the certificate, prints no IP, and no "v1" without a version', async () => {
  const signed = model({
    envelopeUuid: 'env-9', state: { kind: 'issued' }, certificate: true,
    recipients: [{ name: 'Ada Founder', email: 'ada@example.test', status: 'signed', signedAt: '2026-10-17T10:00:00Z' }],
  });
  for (const [pageSize, box] of [['letter', [612, 792]], ['a4', [595.28, 841.89]]] as const) {
    const bytes = await renderPaperFallbackPdf(signed, { pageSize });
    const doc = await PDFDocument.load(bytes);
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      assert.deepEqual([Math.round(width * 100) / 100, Math.round(height * 100) / 100], box, pageSize);
    }
    const text = await texts(bytes);
    assert.ok(text.includes('CERTIFICATE OF COMPLETION') && text.includes('Signer 1'));
    assert.ok(!text.includes('IP:') && !text.includes('ada@example.test') && !text.includes('legal@axal.vc'));
    // WinAnsi draws the em dash as byte 0x97.
    assert.ok(!text.includes(' \x97 v1') && !text.includes('v1'), 'no recorded version prints no v1');
    assert.ok(text.includes('Page 1 of'));
  }
  const versioned = await texts(await renderPaperFallbackPdf(model({ version: 2 }), { pageSize: 'letter' }));
  assert.ok(versioned.includes('Mutual NDA \x97 v2'));
});

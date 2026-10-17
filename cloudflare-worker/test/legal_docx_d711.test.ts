/**
 * D711 (#1776) — the Word export: unzipped here (store mode needs no
 * inflate), every part typed, the page size in twips, the text round-trips,
 * the styles exist, a cover slug gets a TOC field and two numbered sections,
 * and nothing external. No `.docx` fixture is committed (`.docx` is LFS).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { paperModel, type PaperInput } from '../src/services/legalPaper.ts';
import { buildLegalDocx, docxFilename } from '../src/services/legalDocx.ts';
import { fixture, raw } from './_legal_paper_harness.ts';

/** The entries of a store-mode zip, by name. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (at + 30 <= bytes.length && dv.getUint32(at, true) === 0x04034b50) {
    assert.equal(dv.getUint16(at + 8, true), 0, 'store mode');
    const size = dv.getUint32(at + 18, true);
    const nameLen = dv.getUint16(at + 26, true);
    const extra = dv.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen + extra;
    out.set(name, new TextDecoder().decode(bytes.subarray(start, start + size)));
    at = start + size;
  }
  return out;
}

/** Tags open and close in order: enough to call a part well formed here. */
function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  const body = xml.replace(/^<\?xml[^?]*\?>/, '');
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g)) {
    if (m[1]) { if (stack.pop() !== m[2]) return false; }
    else if (!m[4]) stack.push(m[2]);
  }
  return stack.length === 0 && !/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/.test(body);
}

const base: PaperInput = {
  title: 'Mutual NDA', slug: 'mutual_nda', version: 3, bodySha256: 'a'.repeat(64), state: { kind: 'draft' },
  body: '## Article 1 Terms\n1.1 Łukasz signs <script>alert(1)</script>.\n> Warning: not an offer.\n- [x] done\n| Item | Amount |\n| --- | --- |\n| Fee | $10 |\n| Total | $10 |',
};
const PARTS = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/header1.xml',
  'word/footer1.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml'];

test('D711 every part has its content type, and w:pgSz matches Letter and A4', () => {
  for (const [pageSize, w, h] of [['letter', 12240, 15840], ['a4', 11906, 16838]] as const) {
    const z = unzip(buildLegalDocx(paperModel(base), { pageSize }));
    assert.deepEqual([...z.keys()].sort(), [...PARTS].sort());
    const types = z.get('[Content_Types].xml')!;
    for (const part of ['/word/document.xml', '/word/styles.xml', '/word/header1.xml', '/word/footer1.xml', '/docProps/core.xml']) {
      assert.ok(types.includes(`PartName="${part}"`), part);
    }
    assert.ok(types.includes('Extension="rels"') && types.includes('Extension="xml"'));
    assert.ok(z.get('word/document.xml')!.includes(`<w:pgSz w:w="${w}" w:h="${h}"/>`), pageSize);
  }
});

test('D711 the text round-trips escaped, the styles exist, and nothing is external or personal', () => {
  const z = unzip(buildLegalDocx(paperModel(base), { pageSize: 'letter' }));
  const doc = z.get('word/document.xml')!;
  assert.ok(doc.includes('Łukasz signs &lt;script&gt;alert(1)&lt;/script&gt;.'));
  assert.ok(!doc.includes('<script'));
  assert.ok(doc.includes('☒ '), 'a checked box is ☒');
  assert.ok(doc.includes('<w:tblHeader/>'), 'the table header repeats');
  for (const style of ['Title', 'Article', 'Section', 'Body', 'Recital', 'Legend', 'Warning']) {
    assert.ok(z.get('word/styles.xml')!.includes(`w:styleId="${style}"`), style);
  }
  assert.ok(doc.includes('<w:pStyle w:val="Warning"/>'));
  for (const [name, xml] of z) {
    assert.ok(!xml.includes('TargetMode="External"'), name);
    assert.ok(wellFormed(xml), `${name} is well formed`);
  }
  assert.ok(z.get('word/header1.xml')!.includes('DRAFT — for counsel review'), 'the state is a header line');
  const footer = z.get('word/footer1.xml')!;
  assert.ok(footer.includes('Mutual NDA — v3') && footer.includes(' PAGE ') && footer.includes(' NUMPAGES '));
  const core = z.get('docProps/core.xml')!;
  assert.ok(core.includes('<dc:creator>Axal VC</dc:creator>') && !core.includes('@'));
});

test('D711 a cover slug gets a TOC field and two sections numbered lower-roman, then from 1', () => {
  const z = unzip(buildLegalDocx(paperModel({ ...base, title: 'Private Placement Memorandum', slug: 'ppm' }), { pageSize: 'letter' }));
  const doc = z.get('word/document.xml')!;
  assert.ok(doc.includes('w:instr=" TOC '));
  assert.deepEqual([...doc.matchAll(/<w:pgNumType w:fmt="(\w+)" w:start="1"\/>/g)].map((m) => m[1]), ['lowerRoman', 'decimal']);
  const plain = unzip(buildLegalDocx(paperModel(base), { pageSize: 'letter' })).get('word/document.xml')!;
  assert.ok(!plain.includes(' TOC '));
});

test('D711 the export route writes a docx_export row, sanitises the filename, and answers 503 with no file when it cannot', async () => {
  assert.equal(docxFilename('subscription booklet & lpa', 2), 'subscription-booklet---lpa-v2.docx');
  const db = fixture();
  const res = await raw(db, `/templates/store/${encodeURIComponent('subscription booklet & lpa')}/export.docx?page=a4`, 2);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="subscription-booklet---lpa-v2.docx"');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.ok(unzip(bytes).get('word/document.xml')!.includes('<w:pgSz w:w="11906" w:h="16838"/>'));
  const row = db.prepare("SELECT * FROM legal_document_files WHERE kind = 'docx_export'").get() as any;
  assert.deepEqual([row.template_slug, row.template_version, row.renderer, row.page_size, row.file_bytes, row.actor_user_id],
    ['subscription booklet & lpa', 2, 'docx', 'a4', bytes.length, 2]);
  assert.equal(row.envelope_id, null);
  assert.equal((await raw(db, '/templates/store/mutual_nda/export.docx?page=a5', 2)).status, 400);
  assert.equal((await raw(db, '/templates/store/mutual_nda/export.docx', 3)).status, 403);
  db.exec('DROP TRIGGER legal_document_files_block_delete; DROP TRIGGER legal_document_files_block_update; DROP TABLE legal_document_files');
  const failed = await raw(db, '/templates/store/mutual_nda/export.docx', 2);
  assert.equal(failed.status, 503);
  assert.ok((failed.headers.get('content-type') || '').includes('application/json'), 'no file');
});

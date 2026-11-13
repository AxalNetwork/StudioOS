/**
 * D1575 (#3822): a PDF built the way Chrome writes one, for the deck export's
 * check (`services/decks/pdfExport.ts`): pages at a size in points, a font
 * per page whose descriptor carries an embedded font file (or not), and URI
 * link annotations, and — D1578 (#3825) — tagged as Chrome's `tagged: true`
 * writes it (a structure tree, MarkInfo, the language and the title), unless
 * `tagged` is false. Not a test file (the leading underscore keeps it out of
 * the glob). Every value is synthetic.
 */
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { PT_PER_PX } from '../src/services/decks/pdfExport.ts';

export type DeckPdfFixture = {
  /** Page size in CSS pixels, as the deck prints (1920 × 1080, 1440 × 1080). */
  width?: number;
  height?: number;
  pages?: number;
  /** How each page's font is written: embedded (FontFile2), not embedded, a Type0 with an embedded descendant, or none at all. */
  font?: 'embedded' | 'not_embedded' | 'type0' | 'none';
  links?: string[];
  /** D1578: Chrome's tagged output (default), or an untagged PDF. */
  tagged?: boolean;
};

export async function deckPdf({ width = 1920, height = 1080, pages = 1, font = 'embedded', links = [], tagged = true }: DeckPdfFixture = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  if (tagged) {
    doc.catalog.set(PDFName.of('StructTreeRoot'), ctx.register(ctx.obj({ Type: 'StructTreeRoot', K: [] })));
    doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));
    doc.setLanguage('en');
    doc.setTitle('Synthetic deck', { showInWindowTitleBar: true });
  }
  const fontFile = ctx.register(ctx.stream(new Uint8Array([0, 1, 0, 0, 0, 0]), {}));
  const descriptor = ctx.register(ctx.obj({
    Type: 'FontDescriptor', FontName: 'AAAAAA+SyntheticSans', Flags: 32, FontBBox: [0, 0, 1000, 1000],
    ItalicAngle: 0, Ascent: 900, Descent: -200, CapHeight: 700, StemV: 80,
    ...(font === 'not_embedded' ? {} : { FontFile2: fontFile }),
  }));
  const simple = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'AAAAAA+SyntheticSans', FontDescriptor: descriptor }));
  const cid = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'AAAAAA+SyntheticSans', FontDescriptor: descriptor }));
  const type0 = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'AAAAAA+SyntheticSans', Encoding: 'Identity-H', DescendantFonts: [cid] }));
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([width * PT_PER_PX, height * PT_PER_PX]);
    if (font !== 'none') page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font === 'type0' ? type0 : simple } }));
    if (i === 0 && links.length) {
      const annots = links.map((uri, j) => ctx.register(ctx.obj({
        Type: 'Annot', Subtype: 'Link', Rect: [10, 10 + j * 20, 200, 25 + j * 20], Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) },
      })));
      page.node.set(PDFName.of('Annots'), ctx.obj(annots));
    }
  }
  return doc.save();
}

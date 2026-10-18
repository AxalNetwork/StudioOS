/**
 * The text a pdf-lib PDF draws, page by page: each `<hex> Tj` operand decoded
 * as Latin-1 (Helvetica's WinAnsi bytes). Not a test file (the leading
 * underscore keeps it out of the glob). Moved here from
 * template_format_d717.test.ts for the library sweep (#1865).
 */
import { PDFDocument, PDFArray, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

export async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const raw = page.node.lookup(PDFName.of('Contents'));
    const streams = raw instanceof PDFArray ? raw.asArray().map((r) => doc.context.lookup(r)) : [raw];
    let ops = '';
    for (const st of streams) if (st instanceof PDFRawStream) ops += Buffer.from(decodePDFRawStream(st).decode()).toString('latin1');
    return [...ops.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join(' ').replace(/\s+/g, ' ');
  });
}

export async function pdfText(bytes: Uint8Array): Promise<string> {
  return (await pdfPageTexts(bytes)).join(' ').replace(/\s+/g, ' ');
}

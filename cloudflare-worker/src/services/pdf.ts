/**
 * PDF generation for the eSignature pipeline.
 *
 * - `renderAgreementPdf` produces a clean, single-pass PDF for an agreement
 *   template (text body), with a signature image embedded on the final page
 *   and a tamper-evident audit footer (envelope UUID + SHA-256 of body +
 *   timestamp).
 * - We use pdf-lib (~120KB gzipped) — pure JS, runs on Workers.
 * - Word-wrap is implemented by character-width estimation against
 *   StandardFonts.Helvetica's per-glyph widths; good enough for legal text
 *   without pulling a full text-shaping engine.
 */
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';

interface RenderOptions {
  envelopeUuid: string;
  documentTitle: string;
  documentBody: string;
  signerName: string;
  signerEmail: string;
  signerIp: string;
  signedAt: string;          // ISO timestamp
  signatureDataUrl: string;  // data:image/png;base64,...
  bodySha256: string;
}

const PAGE_WIDTH = 612;   // US Letter
const PAGE_HEIGHT = 792;
const MARGIN_X = 54;
const MARGIN_TOP = 72;
const MARGIN_BOTTOM = 72;
const BODY_FONT_SIZE = 10.5;
const BODY_LINE_HEIGHT = 14;
const TITLE_FONT_SIZE = 16;

function wrapTextToWidth(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine.trim() === '') { lines.push(''); continue; }
    const words = rawLine.split(/\s+/);
    let cur = '';
    for (const word of words) {
      const trial = cur ? `${cur} ${word}` : word;
      const w = font.widthOfTextAtSize(trial, fontSize);
      if (w <= maxWidth) {
        cur = trial;
      } else {
        if (cur) lines.push(cur);
        // If a single word is too long, hard-break it.
        if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
          let chunk = '';
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, fontSize) > maxWidth) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          cur = chunk;
        } else {
          cur = word;
        }
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

function drawHeader(page: PDFPage, font: PDFFont, boldFont: PDFFont, title: string, envelopeUuid: string) {
  page.drawText('AXAL VC', {
    x: MARGIN_X, y: PAGE_HEIGHT - 36,
    size: 10, font: boldFont, color: rgb(0.486, 0.227, 0.929),
  });
  page.drawText(`Envelope: ${envelopeUuid}`, {
    x: PAGE_WIDTH - MARGIN_X - font.widthOfTextAtSize(`Envelope: ${envelopeUuid}`, 8),
    y: PAGE_HEIGHT - 36, size: 8, font, color: rgb(0.6, 0.6, 0.6),
  });
  page.drawLine({
    start: { x: MARGIN_X, y: PAGE_HEIGHT - 48 },
    end:   { x: PAGE_WIDTH - MARGIN_X, y: PAGE_HEIGHT - 48 },
    thickness: 0.5, color: rgb(0.85, 0.85, 0.85),
  });
}

function drawFooter(page: PDFPage, font: PDFFont, pageNum: number, totalPages: number, bodySha: string) {
  const footerY = 36;
  page.drawLine({
    start: { x: MARGIN_X, y: footerY + 14 },
    end:   { x: PAGE_WIDTH - MARGIN_X, y: footerY + 14 },
    thickness: 0.5, color: rgb(0.85, 0.85, 0.85),
  });
  page.drawText(`SHA-256: ${bodySha.slice(0, 32)}…`, {
    x: MARGIN_X, y: footerY, size: 7, font, color: rgb(0.55, 0.55, 0.55),
  });
  const pageStr = `Page ${pageNum} of ${totalPages}`;
  page.drawText(pageStr, {
    x: PAGE_WIDTH - MARGIN_X - font.widthOfTextAtSize(pageStr, 8),
    y: footerY, size: 8, font, color: rgb(0.55, 0.55, 0.55),
  });
}

function dataUriToBytes(dataUri: string): Uint8Array {
  const comma = dataUri.indexOf(',');
  if (comma < 0) throw new Error('Invalid data URI');
  const b64 = dataUri.slice(comma + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function renderAgreementPdf(opts: RenderOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(opts.documentTitle);
  doc.setAuthor('Axal VC');
  doc.setSubject(`Envelope ${opts.envelopeUuid}`);
  doc.setProducer('Axal StudioOS eSign');
  doc.setCreator('Axal StudioOS');
  doc.setCreationDate(new Date(opts.signedAt));

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await doc.embedFont(StandardFonts.HelveticaOblique);

  const contentWidth = PAGE_WIDTH - 2 * MARGIN_X;
  const lines = wrapTextToWidth(opts.documentBody, font, BODY_FONT_SIZE, contentWidth);

  // Reserve ~180pt at the end of the document for the signature block.
  const SIG_BLOCK_HEIGHT = 180;
  const usableTop = PAGE_HEIGHT - MARGIN_TOP - 40; // account for title on first page
  const usableBottom = MARGIN_BOTTOM + 24;

  let pages: PDFPage[] = [doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])];
  let y = usableTop;

  // Title on page 1
  pages[0].drawText(opts.documentTitle, {
    x: MARGIN_X, y, size: TITLE_FONT_SIZE, font: boldFont, color: rgb(0.07, 0.09, 0.15),
  });
  y -= 28;

  for (const line of lines) {
    if (y - BODY_LINE_HEIGHT < usableBottom) {
      const p = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pages.push(p);
      y = PAGE_HEIGHT - MARGIN_TOP;
    }
    if (line) {
      pages[pages.length - 1].drawText(line, {
        x: MARGIN_X, y, size: BODY_FONT_SIZE, font, color: rgb(0.13, 0.17, 0.22),
      });
    }
    y -= BODY_LINE_HEIGHT;
  }

  // Signature block — always on the last page; if not enough room, add one.
  if (y - SIG_BLOCK_HEIGHT < usableBottom) {
    const p = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(p);
    y = PAGE_HEIGHT - MARGIN_TOP;
  }

  const lastPage = pages[pages.length - 1];
  let sy = y - 20;
  lastPage.drawLine({
    start: { x: MARGIN_X, y: sy }, end: { x: PAGE_WIDTH - MARGIN_X, y: sy },
    thickness: 0.5, color: rgb(0.78, 0.78, 0.78),
  });
  sy -= 20;
  lastPage.drawText('SIGNATURE', {
    x: MARGIN_X, y: sy, size: 9, font: boldFont, color: rgb(0.486, 0.227, 0.929),
  });
  sy -= 14;

  // Embed signature PNG (canvas output is always PNG).
  try {
    const sigBytes = dataUriToBytes(opts.signatureDataUrl);
    const sigImg = await doc.embedPng(sigBytes);
    const sigDims = sigImg.scale(1);
    // Scale to max 220x70.
    const maxW = 220, maxH = 70;
    const ratio = Math.min(maxW / sigDims.width, maxH / sigDims.height, 1);
    const w = sigDims.width * ratio;
    const h = sigDims.height * ratio;
    lastPage.drawImage(sigImg, { x: MARGIN_X, y: sy - h, width: w, height: h });
    sy -= h + 8;
  } catch (e) {
    lastPage.drawText('[Signature image could not be embedded]', {
      x: MARGIN_X, y: sy - 14, size: 9, font: italicFont, color: rgb(0.7, 0.2, 0.2),
    });
    sy -= 22;
  }

  lastPage.drawLine({
    start: { x: MARGIN_X, y: sy - 4 }, end: { x: MARGIN_X + 240, y: sy - 4 },
    thickness: 0.5, color: rgb(0.5, 0.5, 0.5),
  });
  sy -= 18;
  lastPage.drawText(opts.signerName || opts.signerEmail, {
    x: MARGIN_X, y: sy, size: 10, font: boldFont, color: rgb(0.07, 0.09, 0.15),
  });
  sy -= 12;
  lastPage.drawText(opts.signerEmail, {
    x: MARGIN_X, y: sy, size: 9, font, color: rgb(0.4, 0.45, 0.5),
  });
  sy -= 14;
  lastPage.drawText(`Signed: ${new Date(opts.signedAt).toUTCString()}`, {
    x: MARGIN_X, y: sy, size: 8, font, color: rgb(0.5, 0.55, 0.6),
  });
  sy -= 10;
  lastPage.drawText(`IP: ${opts.signerIp}`, {
    x: MARGIN_X, y: sy, size: 8, font, color: rgb(0.5, 0.55, 0.6),
  });

  // Decorate every page with header + footer (after we know totalPages).
  const total = pages.length;
  pages.forEach((p, i) => {
    drawHeader(p, font, boldFont, opts.documentTitle, opts.envelopeUuid);
    drawFooter(p, font, i + 1, total, opts.bodySha256);
  });

  return await doc.save();
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

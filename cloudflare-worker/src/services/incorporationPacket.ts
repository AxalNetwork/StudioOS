/**
 * 8-page incorporation packet PDF assembler (Task #12).
 *
 * Fixed page order:
 *   1. Certificate of Formation (jurisdiction-aware)
 *   2. SS-4 Instructions
 *   3. SS-4 Application
 *   4. Statement & Acknowledgement of Faxed EIN
 *   5. Form 8821 — Tax Information Authorization
 *   6. Confirmation of Information
 *   7. KYC ID Page (founder identity document)
 *   8. Audit Trail page (tamper-evident hash footer)
 *
 * Uses pdf-lib (pure JS, runs on Workers). Reuses the existing IRS form
 * renderers from services/irsForms.ts and the agreement-PDF sealing pattern
 * from services/pdf.ts.
 */
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import { sha256HexBytes } from './pdf';
import {
  renderSS4Pdf,
  renderForm8821Pdf,
  renderFaxedEinPdf,
  renderConfirmationPdf,
} from './irsForms';

// ---------------------------------------------------------------------------
// Geometry constants (mirroring services/irsForms.ts and services/pdf.ts)
// ---------------------------------------------------------------------------
const PAGE_W = 612;
const PAGE_H = 792;
const MX = 48;
const CONTENT_W = PAGE_W - 2 * MX;

const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.46, 0.52);
const LINE = rgb(0.72, 0.74, 0.78);
const BAR = rgb(0.91, 0.92, 0.94);
const BRAND = rgb(0.486, 0.227, 0.929);

interface Fonts {
  font: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

function escapeWinAnsi(s: string): string {
  return (s || '')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[^\x00-\xFF]/g, '?');
}

function text(page: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont, color = INK) {
  page.drawText(escapeWinAnsi(s), { x, y, size, font, color });
}

function rightText(page: PDFPage, s: string, xRight: number, y: number, size: number, font: PDFFont, color = INK) {
  const w = font.widthOfTextAtSize(escapeWinAnsi(s), size);
  text(page, s, xRight - w, y, size, font, color);
}

function hr(page: PDFPage, y: number, x0 = MX, x1 = PAGE_W - MX, thickness = 0.75, color = LINE) {
  page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness, color });
}

function sectionBar(page: PDFPage, f: Fonts, y: number, label: string) {
  page.drawRectangle({ x: MX, y: y - 4, width: CONTENT_W, height: 16, color: BAR });
  text(page, label, MX + 6, y, 9, f.bold, INK);
  return y - 22;
}

function paragraph(page: PDFPage, f: Fonts, s: string, x: number, y: number, w: number, size = 10.5, leading = 15, font?: PDFFont) {
  const useFont = font ?? f.font;
  const words = escapeWinAnsi(s).split(/\s+/);
  let line = '';
  let cy = y;
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (useFont.widthOfTextAtSize(trial, size) > w && line) {
      text(page, line, x, cy, size, useFont, INK);
      line = word;
      cy -= leading;
    } else {
      line = trial;
    }
  }
  if (line) {
    text(page, line, x, cy, size, useFont, INK);
    cy -= leading;
  }
  return cy;
}

function formFooter(page: PDFPage, f: Fonts, note: string) {
  hr(page, 44, MX, PAGE_W - MX, 0.5, LINE);
  text(page, 'AXAL VC', MX, 30, 8, f.bold, BRAND);
  rightText(page, note, PAGE_W - MX, 30, 7.5, f.italic, MUTED);
}

async function newDoc(): Promise<{ doc: PDFDocument; f: Fonts }> {
  const doc = await PDFDocument.create();
  doc.setAuthor('Axal VC');
  doc.setProducer('Axal StudioOS Incorporation');
  doc.setCreator('Axal StudioOS');
  const f: Fonts = {
    font: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  return { doc, f };
}

// ---------------------------------------------------------------------------
// 1. Certificate of Formation — jurisdiction-aware
// ---------------------------------------------------------------------------

interface CertificateInputs {
  jurisdictionId: string;
  companyName: string;
  founderName: string;
  registeredAgentName?: string | null;
  registeredAgentAddress?: string | null;
  date: string;
}

const JURISDICTION_CERT_TITLES: Record<string, string> = {
  us_de_ccorp: 'Certificate of Formation — Delaware C-Corporation',
  us_de_llc: 'Certificate of Formation — Delaware Limited Liability Company',
  uk_ltd: 'Certificate of Incorporation — United Kingdom Private Limited Company',
  sg_pte: 'Certificate of Incorporation — Singapore Private Limited Company',
  ee_oy: 'Certificate of Registration — Estonian Private Limited Company',
};

export async function renderCertificateOfFormationPdf(
  inputs: CertificateInputs,
): Promise<Uint8Array> {
  const { doc, f } = await newDoc();
  const title = JURISDICTION_CERT_TITLES[inputs.jurisdictionId] || 'Certificate of Formation';
  doc.setTitle(title);

  const p = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 52;

  // Header
  text(p, title, MX, y, 14, f.bold, INK);
  y -= 20;
  hr(p, y, MX, PAGE_W - MX, 1, INK);
  y -= 28;

  // Entity block
  y = sectionBar(p, f, y, 'Entity details');
  y = fieldBox(p, f, { x: MX, y, w: CONTENT_W, label: 'Legal name of entity', value: inputs.companyName }) - 8;
  y = fieldBox(p, f, { x: MX, y, w: CONTENT_W, label: 'Jurisdiction', value: inputs.jurisdictionId }) - 8;
  if (inputs.registeredAgentName) {
    y = fieldBox(p, f, { x: MX, y, w: CONTENT_W, label: 'Registered agent', value: inputs.registeredAgentName }) - 8;
  }
  if (inputs.registeredAgentAddress) {
    y = fieldBox(p, f, { x: MX, y, w: CONTENT_W, label: 'Registered agent address', value: inputs.registeredAgentAddress }) - 8;
  }
  y -= 10;

  // Founder block
  y = sectionBar(p, f, y, 'Founder / incorporator');
  y = fieldBox(p, f, { x: MX, y, w: CONTENT_W, label: 'Full legal name', value: inputs.founderName }) - 8;
  y = fieldBox(p, f, { x: MX, y, w: CONTENT_W, label: 'Incorporation date', value: inputs.date }) - 8;
  y -= 10;

  // Boilerplate
  y = sectionBar(p, f, y, 'Declaration');
  const boilerplate = jurisdictionBoilerplate(inputs.jurisdictionId);
  y = paragraph(p, f, boilerplate, MX, y, CONTENT_W, 9.5, 13) - 12;

  // Signature block
  y -= 10;
  p.drawLine({ start: { x: MX, y: y }, end: { x: MX + 240, y: y }, thickness: 0.75, color: LINE });
  text(p, 'Signature of incorporator', MX, y - 11, 7.5, f.font, MUTED);
  text(p, inputs.founderName, MX + 2, y + 3, 10, f.bold, INK);
  p.drawLine({ start: { x: MX + 260, y: y }, end: { x: PAGE_W - MX, y: y }, thickness: 0.75, color: LINE });
  text(p, 'Date', MX + 260, y - 11, 7.5, f.font, MUTED);
  text(p, inputs.date, MX + 264, y + 3, 10, f.bold, INK);

  formFooter(p, f, 'Axal StudioOS — Certificate of Formation');
  return await doc.save();
}

function jurisdictionBoilerplate(jurisdictionId: string): string {
  switch (jurisdictionId) {
    case 'us_de_ccorp':
      return 'The undersigned incorporator, being a natural person competent to contract, hereby forms a corporation pursuant to the Delaware General Corporation Law. The corporation is authorized to issue one class of shares. The name and mailing address of the incorporator are set forth above. The corporation shall have perpetual existence unless sooner dissolved in accordance with law.';
    case 'us_de_llc':
      return 'The undersigned member hereby forms a limited liability company pursuant to the Delaware Limited Liability Company Act. The company shall be managed by its member(s). The company shall have perpetual existence unless sooner dissolved in accordance with law.';
    case 'uk_ltd':
      return 'The company is incorporated with limited liability under the Companies Act 2006. The liability of each member is limited to the amount unpaid on their shares. The company has a standard set of articles (Model Articles) unless otherwise filed with Companies House.';
    case 'sg_pte':
      return 'The company is incorporated as a private company limited by shares under the Companies Act (Cap. 50) of Singapore. The company has a share capital and the liability of members is limited to the amount unpaid on their shares.';
    case 'ee_oy':
      return 'The company is established as a private limited company (Osa\u00FChing) under the Estonian Commercial Code. The share capital is EUR 2,500 unless a higher amount is specified in the articles of association.';
    default:
      return 'The undersigned hereby forms a legal entity in the specified jurisdiction. All information provided is true and accurate to the best of the incorporator\'s knowledge.';
  }
}

/** A labelled, bordered field box. Returns the y just below the box. */
function fieldBox(
  page: PDFPage,
  f: Fonts,
  opts: { x: number; y: number; w: number; h?: number; label: string; value?: string },
) {
  const h = opts.h ?? 30;
  page.drawRectangle({ x: opts.x, y: opts.y - h, width: opts.w, height: h, borderWidth: 0.75, borderColor: LINE });
  text(page, opts.label, opts.x + 5, opts.y - 10, 7, f.font, MUTED);
  if (opts.value) {
    text(page, opts.value, opts.x + 8, opts.y - h + 9, 10.5, f.bold, INK);
  }
  return opts.y - h;
}

// ---------------------------------------------------------------------------
// 7. KYC ID Page — embeds founder ID document or placeholder
// ---------------------------------------------------------------------------

export interface KycDocumentInput {
  bytes?: Uint8Array | null;
  mimeType?: string | null;
}

export async function renderKycIdPagePdf(
  founderName: string,
  kyc?: KycDocumentInput,
): Promise<Uint8Array> {
  const { doc, f } = await newDoc();
  doc.setTitle('KYC Identification Document');

  const p = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 52;

  text(p, 'KYC Identification Document', MX, y, 14, f.bold, INK);
  y -= 20;
  hr(p, y, MX, PAGE_W - MX, 1, INK);
  y -= 28;

  y = sectionBar(p, f, y, 'Founder');
  y = fieldBox(p, f, { x: MX, y, w: CONTENT_W, label: 'Full legal name', value: founderName }) - 8;
  y -= 10;

  y = sectionBar(p, f, y, 'ID document');

  if (kyc?.bytes && kyc.mimeType) {
    if (kyc.mimeType === 'application/pdf') {
      // pdf-lib cannot embed a PDF page onto another page (no "placing" API).
      // Render a placeholder so the 8-page count is preserved; the actual KYC
      // PDF can be appended separately by the caller if needed.
      try {
        const kycDoc = await PDFDocument.load(kyc.bytes);
        const pageCount = kycDoc.getPageCount();
        paragraph(p, f, 'A KYC identification document is on file for this incorporation. The original PDF document is preserved separately for compliance review.', MX, y, CONTENT_W, 10, 14);
        y -= 40;
        paragraph(p, f, `Document type: ${kyc.mimeType} | Pages: ${pageCount} | Size: ${kyc.bytes.length} bytes`, MX, y, CONTENT_W, 9, 13, f.italic);
      } catch {
        paragraph(p, f, 'The KYC identification document could not be embedded. Please verify the document separately.', MX, y, CONTENT_W, 10, 14);
      }
    } else if (kyc.mimeType.startsWith('image/')) {
      try {
        let img;
        if (kyc.mimeType === 'image/png') {
          img = await doc.embedPng(kyc.bytes);
        } else if (kyc.mimeType === 'image/jpeg' || kyc.mimeType === 'image/jpg') {
          img = await doc.embedJpg(kyc.bytes);
        } else {
          // WebP or other — try PNG fallback or just note it
          throw new Error('Unsupported image format for embedding');
        }
        const dims = img.scale(1);
        const maxW = CONTENT_W;
        const maxH = 420;
        const ratio = Math.min(maxW / dims.width, maxH / dims.height, 1);
        const w = dims.width * ratio;
        const h = dims.height * ratio;
        const imgY = y - h;
        p.drawImage(img, { x: MX, y: imgY, width: w, height: h });
        y = imgY - 14;
        paragraph(p, f, `ID document for ${founderName}`, MX, y, CONTENT_W, 9, 13, f.italic);
      } catch {
        paragraph(p, f, 'The KYC identification document could not be embedded. Please verify the document separately.', MX, y, CONTENT_W, 10, 14);
      }
    } else {
      paragraph(p, f, 'Unsupported KYC document format. Please verify the document separately.', MX, y, CONTENT_W, 10, 14);
    }
  } else {
    paragraph(p, f, 'No KYC identification document was provided at the time of packet assembly. This page is reserved for the founder ID document.', MX, y, CONTENT_W, 10, 14);
    y -= 30;
    paragraph(p, f, `Founder: ${founderName}`, MX, y, CONTENT_W, 9, 13, f.italic);
  }

  formFooter(p, f, 'Axal StudioOS — KYC Identification');
  return await doc.save();
}

// ---------------------------------------------------------------------------
// 8. Audit Trail page
// ---------------------------------------------------------------------------

export interface AuditEvent {
  ts: string;         // ISO timestamp
  action: string;
  actor: string;
  details?: string;
}

export async function renderAuditTrailPagePdf(
  events: AuditEvent[],
  bodyHash: string,
  envelopeUuid?: string,
): Promise<Uint8Array> {
  const { doc, f } = await newDoc();
  doc.setTitle('Audit Trail — Incorporation Packet');

  const p = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 52;

  text(p, 'Audit Trail — Incorporation Packet', MX, y, 14, f.bold, INK);
  y -= 20;
  hr(p, y, MX, PAGE_W - MX, 1, INK);
  y -= 28;

  if (envelopeUuid) {
    rightText(p, `Envelope: ${envelopeUuid}`, PAGE_W - MX, y + 28, 8, f.font, MUTED);
  }

  y = sectionBar(p, f, y, 'Events');

  for (const ev of events) {
    const ts = new Date(ev.ts).toUTCString();
    text(p, `${ts}  —  ${ev.action}`, MX, y, 9, f.bold, INK);
    y -= 14;
    if (ev.actor) {
      text(p, `Actor: ${ev.actor}`, MX + 12, y, 8.5, f.font, MUTED);
      y -= 12;
    }
    if (ev.details) {
      const cy = paragraph(p, f, ev.details, MX + 12, y, CONTENT_W - 12, 8.5, 12, f.font);
      y = cy - 4;
    }
    y -= 6;
    if (y < 140) break; // Leave room for hash block
  }

  y -= 10;
  hr(p, y, MX, PAGE_W - MX, 1, INK);
  y -= 20;

  // Tamper-evident hash block
  text(p, 'Tamper-evident seal', MX, y, 10, f.bold, INK);
  y -= 14;
  paragraph(p, f, 'The SHA-256 hash below is computed over the first seven pages of this packet (the document body). Any modification to the body will change this hash, making the tampering detectable.', MX, y, CONTENT_W, 8.5, 12, f.italic);
  y -= 36;

  text(p, 'SHA-256 (body hash):', MX, y, 9, f.bold, INK);
  y -= 14;
  text(p, bodyHash, MX, y, 8, f.font, INK);
  y -= 14;
  text(p, bodyHash.slice(0, 32) + '...', MX, y, 8, f.font, MUTED);

  formFooter(p, f, 'Axal StudioOS — Audit Trail');
  return await doc.save();
}

// ---------------------------------------------------------------------------
// Main assembler
// ---------------------------------------------------------------------------

export interface PacketInputs {
  jurisdictionId: string;
  companyName: string;
  founderName: string;
  founderEmail: string;
  registeredAgentName?: string | null;
  registeredAgentAddress?: string | null;
  date: string;
  kycDocument?: KycDocumentInput;
  auditEvents?: AuditEvent[];
  envelopeUuid?: string;
}

export async function assembleIncorporationPacket(
  inputs: PacketInputs,
): Promise<{ bytes: Uint8Array; pageCount: number; bodyHash: string }> {
  // Step 1 — build the body PDF (pages 1-7)
  const bodyDoc = await PDFDocument.create();
  bodyDoc.setTitle('Axal StudioOS — Incorporation Packet');
  bodyDoc.setAuthor('Axal VC');
  bodyDoc.setProducer('Axal StudioOS Incorporation');
  bodyDoc.setCreator('Axal StudioOS');

  const certBytes = await renderCertificateOfFormationPdf({
    jurisdictionId: inputs.jurisdictionId,
    companyName: inputs.companyName,
    founderName: inputs.founderName,
    registeredAgentName: inputs.registeredAgentName,
    registeredAgentAddress: inputs.registeredAgentAddress,
    date: inputs.date,
  });
  const ss4Bytes = await renderSS4Pdf({
    fullLegalName: inputs.founderName,
    company: inputs.companyName,
    date: inputs.date,
  });
  const faxedEinBytes = await renderFaxedEinPdf({
    fullLegalName: inputs.founderName,
    company: inputs.companyName,
    date: inputs.date,
  });
  const form8821Bytes = await renderForm8821Pdf({
    fullLegalName: inputs.founderName,
    company: inputs.companyName,
    date: inputs.date,
  });
  const confirmationBytes = await renderConfirmationPdf({
    fullLegalName: inputs.founderName,
    company: inputs.companyName,
    date: inputs.date,
  });
  const kycBytes = await renderKycIdPagePdf(
    inputs.founderName,
    inputs.kycDocument,
  );

  // Load each sub-PDF and copy its pages into the body document
  const subDocs = [
    await PDFDocument.load(certBytes),
    await PDFDocument.load(ss4Bytes),
    await PDFDocument.load(faxedEinBytes),
    await PDFDocument.load(form8821Bytes),
    await PDFDocument.load(confirmationBytes),
    await PDFDocument.load(kycBytes),
  ];

  for (const sub of subDocs) {
    const copied = await bodyDoc.copyPages(sub, sub.getPageIndices());
    for (const page of copied) bodyDoc.addPage(page);
  }

  // Body PDF should be exactly 7 pages (cert:1 + ss4:2 + faxed:1 + 8821:1 + confirm:1 + kyc:1 = 7)
  const bodyPageCount = bodyDoc.getPageCount();
  if (bodyPageCount !== 7) {
    throw new Error(`Expected 7 body pages, got ${bodyPageCount}`);
  }

  // Step 2 — save the body PDF and compute its hash (pdf-lib save is deterministic)
  const bodyPdfBytes = await bodyDoc.save();
  const bodyHash = await sha256HexBytes(bodyPdfBytes);

  // Step 3 — build the final PDF with audit trail
  const finalDoc = await PDFDocument.load(bodyPdfBytes);
  const auditBytes = await renderAuditTrailPagePdf(
    inputs.auditEvents ?? [],
    bodyHash,
    inputs.envelopeUuid,
  );
  const auditDoc = await PDFDocument.load(auditBytes);
  const [auditPage] = await finalDoc.copyPages(auditDoc, [0]);
  finalDoc.addPage(auditPage);

  const finalBytes = await finalDoc.save();
  const totalPages = finalDoc.getPageCount();

  // Step 4 — 5 MB ceiling guard
  const MAX_PACKET_BYTES = 5 * 1024 * 1024;
  if (finalBytes.length > MAX_PACKET_BYTES) {
    throw new Error(`Packet exceeds ${MAX_PACKET_BYTES} bytes (size: ${finalBytes.length})`);
  }

  return { bytes: finalBytes, pageCount: totalPages, bodyHash };
}

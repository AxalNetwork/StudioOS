/**
 * IRS-style fixed-layout forms (Task #9).
 *
 * Renders the hardcoded forms used in the incorporation kit as programmatic,
 * fixed-geometry PDFs with three placeholder fields: full legal name, company,
 * and date. These are *IRS-style* layouts (clean reproductions of the standard
 * field structure), not pixel-perfect copies of the official government PDFs.
 *
 * Admins preview/download blanks here; the incorporation packet task later
 * fills the same renderers with real founder data.
 *
 * Uses pdf-lib (already used by services/pdf.ts) — pure JS, runs on Workers.
 */
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';

export interface FormFields {
  fullLegalName: string;
  company: string;
  date: string;
}

export interface FormMeta {
  id: string;
  title: string;
  description: string;
  pages: number;
}

export const FORM_PLACEHOLDER_FIELDS = ['full_legal_name', 'company', 'date'] as const;

export const IRS_FORMS: FormMeta[] = [
  {
    id: 'ss4',
    title: 'Form SS-4 — Application for Employer Identification Number',
    description: 'EIN application (with instructions page). Used to obtain a federal EIN for a new entity.',
    pages: 2,
  },
  {
    id: 'form_8821',
    title: 'Form 8821 — Tax Information Authorization',
    description: 'Authorizes a designee to inspect and/or receive confidential tax information.',
    pages: 1,
  },
  {
    id: 'faxed_ein',
    title: 'Statement & Acknowledgement of Faxed EIN',
    description: 'Records that the entity received its EIN by fax from the IRS.',
    pages: 1,
  },
  {
    id: 'confirmation',
    title: 'Confirmation of Information',
    description: 'Responsible party confirms the accuracy of the information provided.',
    pages: 1,
  },
];

// US Letter geometry, mirroring services/pdf.ts.
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
  // StandardFonts.Helvetica is WinAnsi-encoded and cannot draw arbitrary
  // Unicode (em-dashes, smart quotes, etc.). Normalise the common offenders
  // so a stray character never throws inside drawText.
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

function formHeader(page: PDFPage, f: Fonts, opts: { formNo: string; title: string; omb: string; subtitle?: string }) {
  let y = PAGE_H - 52;
  text(page, opts.formNo, MX, y, 18, f.bold, INK);
  rightText(page, opts.omb, PAGE_W - MX, y + 4, 8.5, f.font, MUTED);
  text(page, opts.title, MX + 86, y + 2, 13, f.bold, INK);
  if (opts.subtitle) {
    text(page, opts.subtitle, MX + 86, y - 12, 8.5, f.italic, MUTED);
  }
  y -= 24;
  hr(page, y, MX, PAGE_W - MX, 1.5, INK);
  return y - 22;
}

function sectionBar(page: PDFPage, f: Fonts, y: number, label: string) {
  page.drawRectangle({ x: MX, y: y - 4, width: CONTENT_W, height: 16, color: BAR });
  text(page, label, MX + 6, y, 9, f.bold, INK);
  return y - 22;
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

function checkbox(page: PDFPage, f: Fonts, x: number, y: number, label: string, checked = false) {
  page.drawRectangle({ x, y: y - 1, width: 9, height: 9, borderWidth: 0.75, borderColor: INK });
  if (checked) {
    page.drawLine({ start: { x: x + 1, y: y - 0.5 }, end: { x: x + 8, y: y + 7.5 }, thickness: 1, color: INK });
    page.drawLine({ start: { x: x + 1, y: y + 7.5 }, end: { x: x + 8, y: y - 0.5 }, thickness: 1, color: INK });
  }
  text(page, label, x + 13, y, 8.5, f.font, INK);
  return x + 13 + f.font.widthOfTextAtSize(escapeWinAnsi(label), 8.5);
}

/** Word-wrap a paragraph and draw it, returning the y below the last line. */
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

function footer(page: PDFPage, f: Fonts, note: string) {
  hr(page, 44, MX, PAGE_W - MX, 0.5, LINE);
  text(page, 'AXAL VC', MX, 30, 8, f.bold, BRAND);
  rightText(page, note, PAGE_W - MX, 30, 7.5, f.italic, MUTED);
}

function signatureBlock(page: PDFPage, f: Fonts, y: number, fields: FormFields, sigLabel = 'Signature') {
  let cy = y;
  text(page, 'Sign here', MX, cy, 9, f.bold, INK);
  cy -= 18;
  // Signature line
  page.drawLine({ start: { x: MX, y: cy }, end: { x: MX + 230, y: cy }, thickness: 0.75, color: LINE });
  text(page, sigLabel, MX, cy - 11, 7.5, f.font, MUTED);
  // Name and title line
  page.drawLine({ start: { x: MX + 250, y: cy }, end: { x: MX + 380, y: cy }, thickness: 0.75, color: LINE });
  text(page, fields.fullLegalName, MX + 252, cy + 3, 10, f.bold, INK);
  text(page, 'Name and title (print)', MX + 250, cy - 11, 7.5, f.font, MUTED);
  // Date line
  page.drawLine({ start: { x: MX + 400, y: cy }, end: { x: PAGE_W - MX, y: cy }, thickness: 0.75, color: LINE });
  text(page, fields.date, MX + 404, cy + 3, 10, f.bold, INK);
  text(page, 'Date', MX + 400, cy - 11, 7.5, f.font, MUTED);
  return cy - 24;
}

async function newDoc(): Promise<{ doc: PDFDocument; f: Fonts }> {
  const doc = await PDFDocument.create();
  doc.setAuthor('Axal VC');
  doc.setProducer('Axal StudioOS Forms');
  doc.setCreator('Axal StudioOS');
  const f: Fonts = {
    font: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  return { doc, f };
}

// ---------------------------------------------------------------------------
// Form SS-4 — Application for Employer Identification Number (+ instructions)
// ---------------------------------------------------------------------------
export async function renderSS4Pdf(fields: FormFields): Promise<Uint8Array> {
  const { doc, f } = await newDoc();
  doc.setTitle('Form SS-4 — Application for EIN');

  // Page 1 — the form.
  const p1 = doc.addPage([PAGE_W, PAGE_H]);
  let y = formHeader(p1, f, {
    formNo: 'Form SS-4',
    title: 'Application for Employer Identification Number',
    omb: 'OMB No. 1545-0003',
    subtitle: 'For use by employers, corporations, partnerships, trusts, estates, churches, and others.',
  });

  y = fieldBox(p1, f, { x: MX, y, w: CONTENT_W, label: '1  Legal name of entity (or individual) for whom the EIN is being requested', value: fields.company }) - 8;
  y = fieldBox(p1, f, { x: MX, y, w: CONTENT_W, label: '2  Trade name of business (if different from name on line 1)' }) - 8;

  const half = (CONTENT_W - 12) / 2;
  let yRow = y;
  fieldBox(p1, f, { x: MX, y: yRow, w: half, label: "4a  Mailing address (room, apt., suite no. and street, or P.O. box)" });
  fieldBox(p1, f, { x: MX + half + 12, y: yRow, w: half, label: '5a  Street address (if different) (Do not enter a P.O. box.)' });
  y = yRow - 38;

  yRow = y;
  fieldBox(p1, f, { x: MX, y: yRow, w: half, label: '6  County and state where principal business is located' });
  fieldBox(p1, f, { x: MX + half + 12, y: yRow, w: half, label: '7a  Name of responsible party', value: fields.fullLegalName });
  y = yRow - 46;

  // Type of entity checkboxes.
  y = sectionBar(p1, f, y, '8a  Type of entity (check only one box)');
  let cx = MX + 4;
  cx = checkbox(p1, f, cx, y, 'Sole proprietor', false) + 16;
  cx = checkbox(p1, f, cx, y, 'Partnership', false) + 16;
  cx = checkbox(p1, f, cx, y, 'Corporation', true) + 16;
  checkbox(p1, f, cx, y, 'Personal service corp.', false);
  y -= 16;
  cx = MX + 4;
  cx = checkbox(p1, f, cx, y, 'Estate', false) + 16;
  cx = checkbox(p1, f, cx, y, 'Trust', false) + 16;
  checkbox(p1, f, cx, y, 'Other (specify)', false);
  y -= 24;

  yRow = y;
  fieldBox(p1, f, { x: MX, y: yRow, w: half, label: '10  Reason for applying', value: 'Started new business' });
  fieldBox(p1, f, { x: MX + half + 12, y: yRow, w: half, label: '11  Date business started or acquired', value: fields.date });
  y = yRow - 46;

  y = sectionBar(p1, f, y, 'Third Party Designee / Applicant Signature');
  paragraph(p1, f, 'Under penalties of perjury, I declare that I have examined this application, and to the best of my knowledge and belief, it is true, correct, and complete.', MX, y, CONTENT_W, 9, 13, f.italic);
  y -= 30;
  signatureBlock(p1, f, y, fields, 'Signature and title');

  footer(p1, f, 'IRS-style reproduction — page 1 of 2 (application)');

  // Page 2 — instructions summary.
  const p2 = doc.addPage([PAGE_W, PAGE_H]);
  let iy = formHeader(p2, f, {
    formNo: 'Form SS-4',
    title: 'Instructions (Summary)',
    omb: 'OMB No. 1545-0003',
    subtitle: 'How to apply for an Employer Identification Number (EIN).',
  });
  const instructions: Array<[string, string]> = [
    ['Who must file', 'Entities that pay wages, operate as a corporation or partnership, or are required to file employment, excise, or certain other tax returns must obtain an EIN.'],
    ['Line 1 — Legal name', 'Enter the legal name of the entity exactly as it appears on the formation documents. For this kit, line 1 is pre-filled with the company name.'],
    ['Line 7a — Responsible party', 'Enter the name of the individual who ultimately owns or controls the entity, or who exercises ultimate effective control over it.'],
    ['Line 8a — Type of entity', 'Check the single box that describes the entity. Delaware C-Corps and similar should check "Corporation".'],
    ['How to apply', 'Apply online at IRS.gov for immediate issuance, by fax (about 4 business days), or by mail (about 4 weeks). International applicants may apply by phone.'],
    ['Signature', 'The application must be signed by an authorized individual. Print the name and title, sign, and date in the boxes provided on page 1.'],
    ['Keep a copy', 'Retain a signed copy of this application and the EIN confirmation for the entity records.'],
  ];
  for (const [head, bodyText] of instructions) {
    text(p2, head, MX, iy, 10, f.bold, INK);
    iy -= 14;
    iy = paragraph(p2, f, bodyText, MX, iy, CONTENT_W, 9.5, 13) - 10;
  }
  footer(p2, f, 'IRS-style reproduction — page 2 of 2 (instructions)');

  return await doc.save();
}

// ---------------------------------------------------------------------------
// Form 8821 — Tax Information Authorization
// ---------------------------------------------------------------------------
export async function renderForm8821Pdf(fields: FormFields): Promise<Uint8Array> {
  const { doc, f } = await newDoc();
  doc.setTitle('Form 8821 — Tax Information Authorization');
  const p = doc.addPage([PAGE_W, PAGE_H]);
  let y = formHeader(p, f, {
    formNo: 'Form 8821',
    title: 'Tax Information Authorization',
    omb: 'OMB No. 1545-1165',
    subtitle: 'Authorize the inspection and/or receipt of confidential tax information.',
  });

  y = sectionBar(p, f, y, '1  Taxpayer information');
  y = fieldBox(p, f, { x: MX, y, w: CONTENT_W, label: 'Taxpayer name and address', value: fields.company }) - 8;
  const half = (CONTENT_W - 12) / 2;
  let yRow = y;
  fieldBox(p, f, { x: MX, y: yRow, w: half, label: 'Taxpayer identification number (EIN)' });
  fieldBox(p, f, { x: MX + half + 12, y: yRow, w: half, label: 'Daytime telephone number' });
  y = yRow - 44;

  y = sectionBar(p, f, y, '2  Designee');
  y = fieldBox(p, f, { x: MX, y, w: CONTENT_W, label: 'Name of designee', value: fields.fullLegalName }) - 8;
  y = fieldBox(p, f, { x: MX, y, w: CONTENT_W, label: 'Address (number, street, city, state, ZIP)' }) - 18;

  y = sectionBar(p, f, y, '3  Tax matters');
  y = fieldBox(p, f, { x: MX, y, w: CONTENT_W, h: 44, label: 'Type of tax information, tax form number, year(s) or period(s)', value: 'Income — Form 1120 / 1065 — current and prior tax years' }) - 18;

  y = sectionBar(p, f, y, '6  Signature of taxpayer');
  paragraph(p, f, 'If signed by a corporate officer, partner, guardian, executor, receiver, administrator, trustee, or party other than the taxpayer, I certify that I have the authority to execute this form with respect to the tax matters and tax periods shown above.', MX, y, CONTENT_W, 9, 13, f.italic);
  y -= 36;
  signatureBlock(p, f, y, fields, 'Signature');

  footer(p, f, 'IRS-style reproduction — Tax Information Authorization');
  return await doc.save();
}

// ---------------------------------------------------------------------------
// Statement & Acknowledgement of Faxed EIN
// ---------------------------------------------------------------------------
export async function renderFaxedEinPdf(fields: FormFields): Promise<Uint8Array> {
  const { doc, f } = await newDoc();
  doc.setTitle('Statement & Acknowledgement of Faxed EIN');
  const p = doc.addPage([PAGE_W, PAGE_H]);
  let y = formHeader(p, f, {
    formNo: 'Statement',
    title: 'Statement & Acknowledgement of Faxed EIN',
    omb: 'Internal — Axal StudioOS',
    subtitle: 'Record of an Employer Identification Number received by fax from the IRS.',
  });

  y = sectionBar(p, f, y, 'Entity details');
  y = fieldBox(p, f, { x: MX, y, w: CONTENT_W, label: 'Legal name of entity', value: fields.company }) - 8;
  const half = (CONTENT_W - 12) / 2;
  let yRow = y;
  fieldBox(p, f, { x: MX, y: yRow, w: half, label: 'Responsible party', value: fields.fullLegalName });
  fieldBox(p, f, { x: MX + half + 12, y: yRow, w: half, label: 'Date EIN received', value: fields.date });
  y = yRow - 46;

  y = sectionBar(p, f, y, 'Acknowledgement');
  y = paragraph(
    p, f,
    `I, ${fields.fullLegalName || '[Full Legal Name]'}, as responsible party for ${fields.company || '[Company]'}, acknowledge that the Employer Identification Number (EIN) for the above entity was issued by the Internal Revenue Service and received by facsimile on ${fields.date || '[Date]'}.`,
    MX, y, CONTENT_W, 11, 16,
  ) - 8;
  y = paragraph(
    p, f,
    'I confirm that the EIN as received matches the legal name of the entity above, and that this acknowledgement has been retained for the entity records.',
    MX, y, CONTENT_W, 11, 16,
  ) - 30;

  signatureBlock(p, f, y, fields, 'Signature');
  footer(p, f, 'IRS-style reproduction — Faxed EIN acknowledgement');
  return await doc.save();
}

// ---------------------------------------------------------------------------
// Confirmation of Information
// ---------------------------------------------------------------------------
export async function renderConfirmationPdf(fields: FormFields): Promise<Uint8Array> {
  const { doc, f } = await newDoc();
  doc.setTitle('Confirmation of Information');
  const p = doc.addPage([PAGE_W, PAGE_H]);
  let y = formHeader(p, f, {
    formNo: 'Form',
    title: 'Confirmation of Information',
    omb: 'Internal — Axal StudioOS',
    subtitle: 'Attestation that the information provided is accurate and complete.',
  });

  y = sectionBar(p, f, y, 'Confirming party');
  y = fieldBox(p, f, { x: MX, y, w: CONTENT_W, label: 'Full legal name', value: fields.fullLegalName }) - 8;
  const half = (CONTENT_W - 12) / 2;
  let yRow = y;
  fieldBox(p, f, { x: MX, y: yRow, w: half, label: 'Company', value: fields.company });
  fieldBox(p, f, { x: MX + half + 12, y: yRow, w: half, label: 'Date', value: fields.date });
  y = yRow - 46;

  y = sectionBar(p, f, y, 'Statement');
  y = paragraph(
    p, f,
    `I, ${fields.fullLegalName || '[Full Legal Name]'}, confirm that the information provided in connection with the formation and registration of ${fields.company || '[Company]'} is true, accurate, and complete to the best of my knowledge as of ${fields.date || '[Date]'}.`,
    MX, y, CONTENT_W, 11, 16,
  ) - 8;
  y = paragraph(
    p, f,
    'I understand that this confirmation may be relied upon by Axal VC and relevant authorities, and I agree to promptly notify Axal VC of any material change to the information provided.',
    MX, y, CONTENT_W, 11, 16,
  ) - 30;

  signatureBlock(p, f, y, fields, 'Signature');
  footer(p, f, 'IRS-style reproduction — Confirmation of Information');
  return await doc.save();
}

const RENDERERS: Record<string, (f: FormFields) => Promise<Uint8Array>> = {
  ss4: renderSS4Pdf,
  form_8821: renderForm8821Pdf,
  faxed_ein: renderFaxedEinPdf,
  confirmation: renderConfirmationPdf,
};

/** Sample placeholder values used for the admin "preview" (non-blank) mode. */
export function sampleFields(): FormFields {
  return {
    fullLegalName: 'Jane Q. Founder',
    company: 'Acme Technologies, Inc.',
    date: new Date().toISOString().slice(0, 10),
  };
}

/** Render a form by id. Unknown ids return null so callers can 404 cleanly. */
export async function renderForm(id: string, fields: FormFields): Promise<Uint8Array | null> {
  const renderer = RENDERERS[id];
  if (!renderer) return null;
  return await renderer(fields);
}

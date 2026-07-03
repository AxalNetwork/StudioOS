/**
 * Task #67 — Autopopulate profiles from LinkedIn.
 *
 * Pure, dependency-free helpers (no Env, no DB) so they unit-test cleanly under
 * the `--experimental-strip-types` loader (see MEMORY: heavy transitive imports
 * break `node --test`). Two source paths:
 *
 *   1. account — map the verified LinkedIn identity (name / email / picture we
 *      captured at OAuth callback) into editable profile fields.
 *   2. pdf     — parse a LinkedIn "Save to PDF" profile export into structured
 *      experience / education / certification entries + headline / about /
 *      location.
 *
 * Security posture (uploads are malware-safe):
 *   - PDF only: MIME must be application/pdf AND the bytes must start with the
 *     `%PDF-` magic header. Anything else is rejected with a clear error.
 *   - Hard size cap (see MAX_PDF_BYTES) checked on the base64 length BEFORE we
 *     decode, then again on the decoded bytes.
 *   - Parsing is a sandbox: pure string/stream ops, no eval, no PDF actions
 *     (/Launch, /JavaScript, /URI, /OpenAction) are ever executed — we only
 *     read the text layer. Bounded loops guard against pathological inputs.
 *   - All extracted text is sanitised (control chars + angle brackets stripped,
 *     length-clamped) before it leaves this module.
 *
 * NOTHING here writes to the DB — callers persist only after the user confirms.
 */

export const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8 MB hard ceiling.
export const PDF_MIME = 'application/pdf';

export interface ExperienceEntry {
  title?: string;
  company?: string;
  start?: string;
  end?: string;
  description?: string;
}
export interface EducationEntry {
  school?: string;
  degree?: string;
  field?: string;
  start?: string;
  end?: string;
}
export interface CertificationEntry {
  name?: string;
  issuer?: string;
  year?: string;
}

export interface ImportProposal {
  source: 'account' | 'pdf';
  fields: {
    display_name?: string;
    full_legal_name?: string;
    headline?: string;
    bio?: string;
    location?: string;
    website?: string;
  };
  experience: ExperienceEntry[];
  education: EducationEntry[];
  certifications: CertificationEntry[];
  photo_url?: string | null;
  warnings: string[];
}

export class LinkedInImportError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// --- text hygiene -----------------------------------------------------------

/** Strip control chars + angle brackets, collapse whitespace, clamp length.
 * Angle brackets are removed defensively so nothing script-like survives into
 * a field that may later render on a public profile. */
export function sanitizeText(v: unknown, maxLen = 500): string {
  if (v == null) return '';
  let s = String(v);
  // Drop C0/C1 control chars except tab/newline, then angle brackets.
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ');
  s = s.replace(/[<>]/g, ' ');
  s = s.replace(/[ \t\u00A0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return s.slice(0, maxLen);
}

function clean(v: unknown, maxLen = 200): string | undefined {
  const s = sanitizeText(v, maxLen).replace(/\n/g, ' ').trim();
  return s || undefined;
}

// --- upload validation ------------------------------------------------------

interface DecodedUpload { bytes: Uint8Array; }

/** Validate + decode a `data:application/pdf;base64,...` upload. Throws
 * LinkedInImportError with a user-facing message on any rejection. */
export function decodePdfDataUri(dataUri: unknown): DecodedUpload {
  if (typeof dataUri !== 'string' || !dataUri.startsWith('data:')) {
    throw new LinkedInImportError('invalid_upload', 'Upload must be a data: URI.');
  }
  const comma = dataUri.indexOf(',');
  if (comma < 0) throw new LinkedInImportError('invalid_upload', 'Malformed data URI.');
  const meta = dataUri.slice(5, comma); // strip "data:"
  const mime = meta.replace(';base64', '').trim().toLowerCase();
  if (mime !== PDF_MIME) {
    throw new LinkedInImportError('not_pdf', 'Only PDF files are accepted (LinkedIn → Save to PDF).');
  }
  if (!/;base64$/i.test(meta)) {
    throw new LinkedInImportError('invalid_upload', 'PDF must be base64-encoded.');
  }
  const b64 = dataUri.slice(comma + 1);
  // Cheap length pre-check (4 base64 chars ≈ 3 bytes) so we never decode a
  // multi-MB string just to reject it.
  if (Math.floor((b64.length * 3) / 4) > MAX_PDF_BYTES) {
    throw new LinkedInImportError('too_large', `PDF exceeds the ${Math.round(MAX_PDF_BYTES / (1024 * 1024))}MB limit.`, 413);
  }
  let bytes: Uint8Array;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    throw new LinkedInImportError('invalid_upload', 'Could not decode the uploaded file.');
  }
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new LinkedInImportError('too_large', `PDF exceeds the ${Math.round(MAX_PDF_BYTES / (1024 * 1024))}MB limit.`, 413);
  }
  // Magic-byte check: genuine PDFs start with "%PDF-". This defeats a renamed
  // or content-type-spoofed non-PDF upload.
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d)) {
    throw new LinkedInImportError('not_pdf', 'File is not a valid PDF.');
  }
  return { bytes };
}

// --- PDF text extraction (Flate-aware) --------------------------------------

async function inflate(raw: Uint8Array): Promise<Uint8Array> {
  // PDF FlateDecode is zlib-wrapped; a few producers emit raw DEFLATE. Try
  // zlib first, fall back to raw.
  for (const fmt of ['deflate', 'deflate-raw'] as const) {
    try {
      const stream = new Response(raw).body!.pipeThrough(new DecompressionStream(fmt));
      const ab = await new Response(stream).arrayBuffer();
      const out = new Uint8Array(ab);
      if (out.byteLength) return out;
    } catch { /* try next */ }
  }
  return new Uint8Array(0);
}

function decodePdfLiteral(s: string): string {
  return s
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b').replace(/\\f/g, '\f')
    .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\')
    .replace(/\\([0-7]{1,3})/g, (_m, oct) => String.fromCharCode(parseInt(oct, 8)));
}

/** Tokenise a decoded content stream into visual lines. Text-show operators
 * (Tj / TJ / ') append to the current line; vertical Td/TD moves and T*
 * start a new line; horizontal-only Td inserts a space. */
function contentToLines(content: string, out: string[]): void {
  let cur = '';
  const push = () => {
    const t = cur.replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
    cur = '';
  };
  const RE = /\(((?:\\.|[^\\)])*)\)\s*(Tj|')|\[((?:[^\]\\]|\\.)*)\]\s*TJ|(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(Td|TD)|(T\*)/g;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = RE.exec(content)) !== null) {
    if (++guard > 500000) break;
    if (m[2] !== undefined) {
      const lit = decodePdfLiteral(m[1]);
      if (m[2] === "'") { push(); cur += lit; } else { cur += lit; }
    } else if (m[3] !== undefined) {
      const litRe = /\(((?:\\.|[^\\)])*)\)/g;
      let lm: RegExpExecArray | null;
      while ((lm = litRe.exec(m[3])) !== null) cur += decodePdfLiteral(lm[1]);
    } else if (m[6] !== undefined) {
      const ty = parseFloat(m[5]);
      if (Math.abs(ty) > 0.01) push(); else cur += ' ';
    } else if (m[7] !== undefined) {
      push();
    }
  }
  push();
}

/** Extract text lines from a PDF, inflating FlateDecode streams first (real
 * LinkedIn exports compress their content streams). Never executes anything. */
export async function extractPdfLines(bytes: Uint8Array): Promise<string[]> {
  const latin = new TextDecoder('latin1');
  const txt = latin.decode(bytes); // latin1 = 1 byte per char, so indices == byte offsets.
  const lines: string[] = [];
  const streamRe = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  let guard = 0;
  let sawStream = false;
  while ((m = streamRe.exec(txt)) !== null) {
    if (++guard > 5000) break;
    sawStream = true;
    const dictStart = txt.lastIndexOf('<<', m.index);
    const dict = dictStart >= 0 ? txt.slice(dictStart, m.index) : '';
    const dataStart = m.index + m[0].length;
    const endIdx = txt.indexOf('endstream', dataStart);
    if (endIdx < 0) continue;
    if (/\/FlateDecode/.test(dict)) {
      const inflated = await inflate(bytes.subarray(dataStart, endIdx));
      if (inflated.byteLength) contentToLines(latin.decode(inflated), lines);
    } else if (!/\/(DCTDecode|JPXDecode|CCITTFaxDecode|Image)/.test(dict)) {
      // Uncompressed content stream (skip binary image streams).
      contentToLines(txt.slice(dataStart, endIdx), lines);
    }
    if (lines.length > 6000) break;
  }
  // Fallback: some simple PDFs have no stream keyword we matched — scan raw.
  if (!sawStream) contentToLines(txt, lines);
  return lines.slice(0, 6000);
}

// --- LinkedIn profile section parser ----------------------------------------

const SECTION_HEADERS: Record<string, string> = {
  summary: 'about', about: 'about',
  experience: 'experience',
  education: 'education',
  'licenses & certifications': 'certifications',
  'licenses and certifications': 'certifications',
  certifications: 'certifications',
  skills: 'skills',
  'top skills': 'skills',
  languages: 'skills',
  'honors & awards': 'skills',
  'honors-awards': 'skills',
  publications: 'skills',
  projects: 'skills',
  volunteering: 'skills',
  'volunteer experience': 'skills',
  recommendations: 'skills',
  interests: 'skills',
  contact: 'contact',
  courses: 'skills',
};

function headerFor(line: string): string | null {
  const k = line.trim().toLowerCase().replace(/\s+/g, ' ');
  if (k.length > 32) return null;
  return SECTION_HEADERS[k] || null;
}

const DATE_RANGE_RE = /((?:[A-Z][a-z]{2,8}\.?\s+)?\d{4})\s*[-–—to]+\s*(Present|(?:[A-Z][a-z]{2,8}\.?\s+)?\d{4})/i;
const YEAR_RE = /\b(19|20)\d{2}\b/;

function splitDateRange(line: string): { start?: string; end?: string } {
  const m = line.match(DATE_RANGE_RE);
  if (!m) return {};
  return { start: clean(m[1], 32), end: clean(m[2], 32) };
}

// A role's "meta" line ("Company · Full-time") anchors each entry. A date line
// ("Jan 2020 - Present · 5 yrs") also carries ' · ' so it must be excluded, or
// it would be mistaken for the next role.
function isRoleMeta(l: string): boolean {
  return l.includes(' · ') && !DATE_RANGE_RE.test(l);
}

function parseExperience(block: string[]): ExperienceEntry[] {
  const out: ExperienceEntry[] = [];
  let i = 0;
  while (i < block.length && out.length < 30) {
    const metaIdx = block.findIndex((l, idx) => idx >= i && isRoleMeta(l));
    if (metaIdx < 0) break;
    const title = metaIdx - 1 >= i ? clean(block[metaIdx - 1]) : undefined;
    const company = clean(block[metaIdx].split(' · ')[0]);
    const entry: ExperienceEntry = {};
    if (title) entry.title = title;
    if (company) entry.company = company;
    // Look ahead a few lines for a date range + description.
    const desc: string[] = [];
    let j = metaIdx + 1;
    for (; j < block.length && j < metaIdx + 8; j++) {
      const l = block[j];
      if (isRoleMeta(l)) break; // next role
      const dr = splitDateRange(l);
      if (dr.start && !entry.start) { entry.start = dr.start; entry.end = dr.end; continue; }
      if (/^[A-Za-z].{0,60},/.test(l) && desc.length === 0 && !entry.start) continue; // location line
      desc.push(l);
    }
    if (desc.length) entry.description = clean(desc.join(' '), 500);
    if (entry.title || entry.company) out.push(entry);
    i = block.findIndex((l, idx) => idx > metaIdx && isRoleMeta(l));
    if (i < 0) break;
  }
  return out;
}

function parseEducation(block: string[]): EducationEntry[] {
  const out: EducationEntry[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    const entry: EducationEntry = {};
    const school = clean(buf[0]);
    if (school) entry.school = school;
    if (buf[1]) {
      const parts = buf[1].split(',');
      entry.degree = clean(parts[0]);
      if (parts[1]) entry.field = clean(parts.slice(1).join(','));
    }
    if (entry.school || entry.degree) out.push(entry);
    buf = [];
  };
  for (const line of block) {
    const dr = splitDateRange(line);
    if (dr.start || YEAR_RE.test(line)) {
      // Date line terminates the current school block.
      if (buf.length) {
        flush();
        const last = out[out.length - 1];
        if (last) { last.start = dr.start; last.end = dr.end; }
      }
      continue;
    }
    buf.push(line);
    if (buf.length >= 3) flush();
  }
  flush();
  return out.slice(0, 30);
}

function parseCertifications(block: string[]): CertificationEntry[] {
  const out: CertificationEntry[] = [];
  let i = 0;
  while (i < block.length && out.length < 30) {
    const name = block[i];
    if (/^(issued|expires|credential|show credential|see credential)/i.test(name)) { i++; continue; }
    const entry: CertificationEntry = { name: clean(name) };
    const next = block[i + 1];
    if (next && !/^(issued|expires|credential)/i.test(next) && !DATE_RANGE_RE.test(next)) {
      entry.issuer = clean(next);
      i += 2;
    } else {
      i += 1;
    }
    // Pull a year from the following line if present.
    const after = block[i];
    if (after && /issued/i.test(after)) {
      const ym = after.match(YEAR_RE);
      if (ym) entry.year = ym[0];
      i += 1;
    }
    if (entry.name) out.push(entry);
  }
  return out;
}

/** Parse extracted lines into a structured, editable proposal. Best-effort:
 * unparseable sections yield empty arrays + a warning, never an exception. */
export function parseLinkedInProfile(lines: string[]): ImportProposal {
  const proposal: ImportProposal = {
    source: 'pdf',
    fields: {},
    experience: [],
    education: [],
    certifications: [],
    warnings: [],
  };
  const clamped = lines.map((l) => sanitizeText(l, 500).replace(/\n/g, ' ').trim()).filter(Boolean);
  if (!clamped.length) {
    proposal.warnings.push('No readable text was found in this PDF. It may be image-only — use the connected-account option or fill fields manually.');
    return proposal;
  }

  // Header block: Name, then Headline, then optional Location — all before the
  // first recognised section header.
  let firstSection = clamped.findIndex((l) => headerFor(l));
  if (firstSection < 0) firstSection = Math.min(clamped.length, 4);
  const head = clamped.slice(0, firstSection);
  if (head[0]) {
    proposal.fields.display_name = clean(head[0], 120);
    proposal.fields.full_legal_name = clean(head[0], 200);
  }
  if (head[1] && !headerFor(head[1])) proposal.fields.headline = clean(head[1], 220);
  // Location heuristic: an early short line with a comma that isn't the headline.
  const loc = head.slice(2).find((l) => /,/.test(l) && l.length <= 60);
  if (loc) proposal.fields.location = clean(loc, 100);

  // Group remaining lines by section.
  const sections: Record<string, string[]> = {};
  let currentKey: string | null = null;
  for (let i = firstSection; i < clamped.length; i++) {
    const h = headerFor(clamped[i]);
    if (h) { currentKey = h; sections[h] = sections[h] || []; continue; }
    if (currentKey) sections[currentKey].push(clamped[i]);
  }

  if (sections.about?.length) {
    proposal.fields.bio = sanitizeText(sections.about.join('\n'), 2000);
  }
  if (sections.experience?.length) {
    proposal.experience = parseExperience(sections.experience);
    if (!proposal.experience.length) proposal.warnings.push('Could not detect individual roles in the Experience section — please add them manually.');
  }
  if (sections.education?.length) {
    proposal.education = parseEducation(sections.education);
  }
  if (sections.certifications?.length) {
    proposal.certifications = parseCertifications(sections.certifications);
  }

  if (!proposal.experience.length && !proposal.education.length && !proposal.fields.bio) {
    proposal.warnings.push('Little structured data was detected. Review the fields below and edit as needed before saving.');
  }
  return proposal;
}

// --- account-source mapping -------------------------------------------------

export interface LinkedInAccountRow {
  linkedin_sub?: string | null;
  linkedin_name?: string | null;
  linkedin_email?: string | null;
  linkedin_picture_url?: string | null;
}

/** Build a proposal from the verified LinkedIn identity captured at OAuth. The
 * LinkedIn OIDC userinfo scope only exposes name / email / picture — no career
 * history — so this path proposes those and defers the rich fields to the PDF. */
export function buildAccountProposal(row: LinkedInAccountRow | null | undefined): ImportProposal {
  const proposal: ImportProposal = {
    source: 'account',
    fields: {},
    experience: [],
    education: [],
    certifications: [],
    photo_url: null,
    warnings: [],
  };
  if (!row || !row.linkedin_sub) {
    throw new LinkedInImportError('not_connected', 'Connect your LinkedIn account first, or upload a PDF export.', 409);
  }
  if (row.linkedin_name) {
    proposal.fields.display_name = clean(row.linkedin_name, 120);
    proposal.fields.full_legal_name = clean(row.linkedin_name, 200);
  }
  if (row.linkedin_picture_url && isLinkedInImageHost(row.linkedin_picture_url)) {
    proposal.photo_url = row.linkedin_picture_url.slice(0, 1000);
  }
  proposal.warnings.push('LinkedIn only shares your name and photo through the connection. For experience, education and certifications, upload your LinkedIn PDF export.');
  return proposal;
}

/** SSRF guard: only ever fetch a profile photo from LinkedIn's own CDN. */
export function isLinkedInImageHost(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return h === 'licdn.com' || h.endsWith('.licdn.com') || h === 'linkedin.com' || h.endsWith('.linkedin.com');
  } catch {
    return false;
  }
}

// --- apply-time normalisation ----------------------------------------------

/** Whitelist + clamp an incoming (user-edited) proposal so apply never trusts
 * the client blindly. Mirrors the FastAPI normaliser for parity. */
export function normalizeProposalForApply(body: unknown): {
  fields: ImportProposal['fields'];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  certifications: CertificationEntry[];
  photo_url: string | null;
} {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const f = (b.fields && typeof b.fields === 'object' ? b.fields : {}) as Record<string, unknown>;
  const fields: ImportProposal['fields'] = {};
  const dn = clean(f.display_name, 120); if (dn) fields.display_name = dn;
  const fn = clean(f.full_legal_name, 200); if (fn) fields.full_legal_name = fn;
  const hl = clean(f.headline, 220); if (hl) fields.headline = hl;
  const bio = sanitizeText(f.bio, 2000); if (bio) fields.bio = bio;
  const loc = clean(f.location, 100); if (loc) fields.location = loc;
  const web = clean(f.website, 300); if (web) fields.website = web;

  const pickArr = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').slice(0, 30) as Record<string, unknown>[] : [];

  const experience: ExperienceEntry[] = pickArr(b.experience).map((e) => ({
    title: clean(e.title), company: clean(e.company),
    start: clean(e.start, 32), end: clean(e.end, 32),
    description: sanitizeText(e.description, 500) || undefined,
  })).filter((e) => e.title || e.company);

  const education: EducationEntry[] = pickArr(b.education).map((e) => ({
    school: clean(e.school), degree: clean(e.degree), field: clean(e.field),
    start: clean(e.start, 32), end: clean(e.end, 32),
  })).filter((e) => e.school || e.degree);

  const certifications: CertificationEntry[] = pickArr(b.certifications).map((e) => ({
    name: clean(e.name), issuer: clean(e.issuer), year: clean(e.year, 16),
  })).filter((e) => e.name);

  let photo_url: string | null = null;
  if (typeof b.photo_url === 'string' && isLinkedInImageHost(b.photo_url)) {
    photo_url = b.photo_url.slice(0, 1000);
  }

  return { fields, experience, education, certifications, photo_url };
}

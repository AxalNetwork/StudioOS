// D711 (#1776) — one paper for every legal document.
//
// `paperModel(input)` assembles what a legal document prints: its kind and
// Axal party, preamble and execution block (all from legalDocFormat.ts), the
// body as typed blocks (legalPaperBlocks.ts), the page state, the cover and
// contents of a long instrument, and a signed copy's certificate of
// completion. `paperHtml(model, opts)` draws that model as one complete HTML
// document in the brand faces (legalPaperCss.ts). Browser Run prints the HTML
// to PDF (legalPaperRender.ts); the pdf-lib fallback (pdf.ts) and the Word
// export (legalDocx.ts) draw the same model, so no second drawing drifts
// (decision 1).
//
// What never reaches paper: an IP address or an email (decision 13). The
// email in a recipient row only finds the counter-signer.
//
// NOTE: authored to load under `node --experimental-strip-types` (the worker
// test gate) — no `enum`s, no TS parameter properties.

import {
  AXAL_ENTITIES,
  axalEntityKeyForDoc,
  buildExecutionBlock,
  buildPreamble,
  classifyDocument,
  stripTrailingSignatureBlock,
  type AxalEntityKey,
  type DocumentKind,
  type SignatureParty,
} from './legalDocFormat';
import { paperBlocks, runsText, type Block, type MergeMode, type Run } from './legalPaperBlocks';
import {
  assertCover,
  assertPageSize,
  markDataUri,
  paperCss,
  paperFontsCss,
  type PaperCover,
  type PaperMedium,
  type PaperPageSize,
} from './legalPaperCss';

/** The long instruments that get a cover and contents (decision 12). */
export const COVER_SLUGS = new Set(['lpa_amended_restated', 'ppm', 'compliance_manual_code_of_ethics']);

export const DEFAULT_COUNTERSIGNER_EMAIL = 'legal@axal.vc';

// --- state -------------------------------------------------------------------

export type PaperState =
  | { kind: 'draft' }
  | { kind: 'specimen' }
  | { kind: 'superseded'; by: number }
  | { kind: 'issued' };

export interface PublicationRef {
  version: number;
  bodySha256: string;
}

/**
 * A page's state comes from stored state, never from the template
 * (decision 11). A copy made for an envelope is Issued. A preview whose
 * version and body match the publication is a Specimen, one of an older
 * version is Superseded, and anything else a Draft.
 */
export function paperStateFor(o: {
  issued?: boolean;
  version?: number | null;
  bodySha256?: string | null;
  publication?: PublicationRef | null;
}): PaperState {
  if (o.issued) return { kind: 'issued' };
  const pub = o.publication;
  if (!pub) return { kind: 'draft' };
  if (o.version != null && o.version === pub.version && o.bodySha256 === pub.bodySha256) return { kind: 'specimen' };
  if (o.version != null && o.version < pub.version) return { kind: 'superseded', by: pub.version };
  return { kind: 'draft' };
}

export function stateLabel(s: PaperState): string {
  switch (s.kind) {
    case 'issued': return 'Issued';
    case 'specimen': return 'Specimen';
    case 'superseded': return `Superseded by v${s.by}`;
    default: return 'Draft';
  }
}

// --- the model ---------------------------------------------------------------

export interface PaperRecipient {
  id?: number;
  name: string | null;
  /** Used only to find the counter-signer; never printed. */
  email?: string | null;
  status: string;
  signedAt?: string | null;
}

export interface PaperSignature {
  /** Index into `recipients` of the one signing now (single-recipient: 0). */
  recipientIndex: number;
  imageDataUrl: string;
  signedAt: string;
}

export interface PaperInput {
  title: string;
  body: string;
  slug?: string | null;
  category?: string | null;
  version?: number | null;
  bodySha256: string;
  envelopeUuid?: string | null;
  counterpartyName?: string | null;
  counterpartyTitle?: string | null;
  effectiveDate?: string | null;
  merge?: MergeMode;
  state: PaperState;
  recipients?: PaperRecipient[];
  counterSignerEmail?: string | null;
  signature?: PaperSignature | null;
  /** A signed copy: ends with the certificate of completion. */
  certificate?: boolean;
  restricted?: boolean;
  offeree?: string | null;
  copyNumber?: string | null;
  documentKind?: DocumentKind;
  axalEntityKey?: AxalEntityKey;
  /** Keep a trailing signature stanza (DocuSign's anchor text). */
  preserveBody?: boolean;
  /** Print no execution block or certificate (DocuSign draws its own). */
  suppressExecutionBlock?: boolean;
}

export interface PaperParty extends SignatureParty {
  /** "Signed <UTC> · Envelope <id>" under the By line, once signed. */
  signedLine: string | null;
  /** Validated `data:image/png;base64,…`, on the signer's By line only. */
  image: string | null;
  /** True for a party whose By/Name/Title nest under a `through` line. */
  nested: boolean;
}

export interface PaperCertificateRow {
  label: string;
  name: string;
  status: string;
  at: string;
}

export interface PaperModel {
  title: string;
  version: number | null;
  bodySha256: string;
  envelopeUuid: string | null;
  slug: string;
  kind: DocumentKind;
  entityKey: AxalEntityKey;
  entityName: string;
  state: PaperState;
  restricted: boolean;
  preamble: string | null;
  blocks: Block[];
  articles: { id: string; text: string }[];
  execution: { recital: string; parties: PaperParty[] } | null;
  certificate: { envelopeUuid: string; title: string; version: number | null; bodySha256: string; rows: PaperCertificateRow[] } | null;
  cover: { fund: string; name: string; copyNumber: string | null; preparedFor: string | null; date: string | null; legends: Block[] } | null;
  footerLeft: string;
  auditLine: string;
}

const BASE64 = /^[A-Za-z0-9+/=]+$/;

/** Rebuild a PNG data URL from validated base64, or null. */
export function safePngDataUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const s = String(u);
  const comma = s.indexOf(',');
  if (comma < 0 || !/^data:image\/png;base64$/i.test(s.slice(0, comma))) return null;
  const b64 = s.slice(comma + 1).replace(/\s+/g, '');
  if (!b64 || !BASE64.test(b64)) return null;
  return `data:image/png;base64,${b64}`;
}

export function utcStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function dateOnly(iso: string | null | undefined): string {
  const s = utcStamp(iso);
  return s ? s.slice(0, 10) : '';
}

const BLANK = '___________________________';

function counterpartyParty(name: string | null, signedAt: string | null | undefined): SignatureParty {
  const n = (name || '').trim();
  const d = dateOnly(signedAt);
  return {
    role: 'counterparty',
    heading: n || '[Counterparty Legal Name]',
    by: `By: ${BLANK}`,
    name: n ? `Name: ${n}` : `Name: ${BLANK}`,
    title: `Title: ${BLANK}`,
    date: d ? `Date: ${d}` : `Date: ${BLANK}`,
    isSigner: true,
  };
}

function withDate(p: SignatureParty, signedAt: string | null | undefined): SignatureParty {
  const d = dateOnly(signedAt);
  return d ? { ...p, date: `Date: ${d}` } : p;
}

export function paperModel(input: PaperInput): PaperModel {
  const slug = String(input.slug || input.title || '');
  const kind = input.documentKind || classifyDocument(slug);
  const entityKey = input.axalEntityKey || axalEntityKeyForDoc(slug, input.category);
  const ent = AXAL_ENTITIES[entityKey] || AXAL_ENTITIES.management;
  const version = input.version != null && Number.isInteger(input.version) && input.version >= 1 ? input.version : null;
  const recipients = input.recipients || [];
  const counterEmail = (input.counterSignerEmail || DEFAULT_COUNTERSIGNER_EMAIL).toLowerCase();
  const isCounter = (r: PaperRecipient) => !!r.email && r.email.toLowerCase() === counterEmail;
  const multi = recipients.length > 1;
  const signerIdx = input.signature ? input.signature.recipientIndex : -1;
  const image = input.signature ? safePngDataUrl(input.signature.imageDataUrl) : null;
  const uuid = input.envelopeUuid || null;

  const others = recipients.filter((r) => !isCounter(r));
  const cpName = (input.counterpartyName || '').trim()
    || (others.length ? others.map((r) => (r.name || '').trim()).filter(Boolean).join(' and ') : '');

  const preamble = kind === 'agreement'
    ? buildPreamble({
        documentTitle: input.title,
        effectiveDate: input.effectiveDate || null,
        axalEntityKey: entityKey,
        counterpartyName: cpName || null,
      })
    : null;

  const body = input.preserveBody ? input.body : stripTrailingSignatureBlock(input.body || '');
  const allBlocks = paperBlocks(body, { merge: input.merge || 'raw', title: input.title });

  // A cover slug's legends before the first article move to its cover.
  let blocks = allBlocks;
  let cover: PaperModel['cover'] = null;
  if (COVER_SLUGS.has(slug.toLowerCase())) {
    const first = allBlocks.findIndex((b) => b.t === 'article');
    const head = first < 0 ? allBlocks : allBlocks.slice(0, first);
    const legends: Block[] = head.filter((b) => b.t === 'legend');
    blocks = allBlocks.filter((b) => !legends.includes(b));
    cover = {
      fund: AXAL_ENTITIES.fund.name,
      name: input.title,
      copyNumber: input.copyNumber || null,
      preparedFor: input.offeree || null,
      date: input.effectiveDate || null,
      legends,
    };
  }
  const articles = blocks.filter((b): b is Extract<Block, { t: 'article' }> => b.t === 'article').map((b) => ({ id: b.id, text: b.text }));

  let execution: PaperModel['execution'] = null;
  if (kind !== 'policy' && !input.suppressExecutionBlock) {
    const signedLine = (r: PaperRecipient | undefined) =>
      r && r.status === 'signed' && r.signedAt && uuid ? `Signed ${utcStamp(r.signedAt)} · Envelope ${uuid}` : null;
    const toParty = (p: SignatureParty, r: PaperRecipient | undefined, idx: number, fallbackSigner: boolean): PaperParty => ({
      ...p,
      signedLine: signedLine(r),
      image: image && (idx === signerIdx || (idx < 0 && fallbackSigner && p.isSigner)) ? image : null,
      nested: !!p.through,
    });
    if (multi) {
      const base = buildExecutionBlock({ kind, axalEntityKey: entityKey });
      const axal = base.parties.find((p) => p.role === 'axal');
      const parties: PaperParty[] = [];
      let axalPlaced = false;
      recipients.forEach((r, i) => {
        if (isCounter(r) && axal && !axalPlaced) {
          parties.push(toParty({ ...withDate(axal, r.signedAt), isSigner: true }, r, i, false));
          axalPlaced = true;
        } else if (!isCounter(r)) {
          parties.push(toParty(counterpartyParty(r.name, r.signedAt), r, i, false));
        }
      });
      if (axal && !axalPlaced) parties.unshift(toParty(axal, undefined, -2, false));
      execution = { recital: base.recital, parties };
    } else {
      const r = recipients[0];
      const base = buildExecutionBlock({
        kind,
        axalEntityKey: entityKey,
        counterpartyName: cpName || (r?.name ?? null),
        counterpartyTitle: input.counterpartyTitle || null,
        signedDate: r?.signedAt ? dateOnly(r.signedAt) : null,
      });
      execution = {
        recital: base.recital,
        parties: base.parties.map((p) => toParty(p, p.isSigner ? r : undefined, p.isSigner && r ? 0 : -1, true)),
      };
    }
  }

  const certificate: PaperModel['certificate'] = input.certificate && uuid && !input.suppressExecutionBlock
    ? {
        envelopeUuid: uuid,
        title: input.title,
        version,
        bodySha256: input.bodySha256,
        rows: recipients.map((r, i) => ({
          label: `Signer ${i + 1}`,
          name: (r.name || '').trim() || '—',
          status: r.status,
          at: utcStamp(r.signedAt) || '—',
        })),
      }
    : null;

  const issued = input.state.kind === 'issued' && !!uuid;
  return {
    title: input.title,
    version,
    bodySha256: input.bodySha256,
    envelopeUuid: uuid,
    slug,
    kind,
    entityKey,
    entityName: ent.name,
    state: input.state,
    restricted: !!input.restricted,
    preamble,
    blocks,
    articles,
    execution,
    certificate,
    cover,
    footerLeft: version ? `${input.title} — v${version}` : input.title,
    auditLine: issued
      ? `SHA-256 ${input.bodySha256.slice(0, 16)}… · Envelope ${uuid}`
      : 'SHA-256 and envelope id assigned when issued',
  };
}

// --- the HTML ----------------------------------------------------------------

export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function runsHtml(runs: Run[]): string {
  return runs.map((r) => {
    switch (r.k) {
      case 'bold': return `<strong>${escapeHtml(r.text)}</strong>`;
      case 'em': return `<em>${escapeHtml(r.text)}</em>`;
      case 'term': return `<strong class="term">${escapeHtml(r.text)}</strong>`;
      case 'merge': return `<span class="merge">${escapeHtml(r.text)}</span>`;
      case 'fill': return '<span class="fill"></span>';
      case 'box': return `<span class="box${r.checked ? ' x' : ''}"></span>`;
      default: return escapeHtml(r.text);
    }
  }).join('');
}

function blockHtml(b: Block, linkArticles: boolean): string {
  switch (b.t) {
    case 'title': return `<h2 class="article">${runsHtml(b.runs)}</h2>`;
    case 'article':
      return linkArticles
        ? `<h2 class="article" id="${b.id}"><a href="#${b.id}">${runsHtml(b.runs)}</a></h2>`
        : `<h2 class="article" id="${b.id}">${runsHtml(b.runs)}</h2>`;
    case 'section': return `<h3 class="section">${runsHtml(b.runs)}</h3>`;
    case 'recitals': return `<h2 class="article">${runsHtml(b.runs)}</h2>`;
    case 'recital': return `<p class="recital">${runsHtml(b.runs)}</p>`;
    case 'schedule':
      return `<h2 class="schedule">${runsHtml(b.runs)}</h2>${b.dateline ? `<p class="dateline">${runsHtml(b.dateline)}</p>` : ''}`;
    case 'para': {
      const runIn = b.runIn ? `<span class="runin">${runsHtml(b.runIn)}.</span> ` : '';
      if (b.num) {
        return `<p class="clause depth-${b.depth}"><span class="num">${escapeHtml(b.num)}</span>${runIn}${runsHtml(b.runs)}</p>`;
      }
      return `<p>${runIn}${runsHtml(b.runs)}</p>`;
    }
    case 'bullets': return `<ul class="bullets">${b.items.map((i) => `<li>${runsHtml(i)}</li>`).join('')}</ul>`;
    case 'table': {
      const cls = (c: number) => [b.align[c] !== 'left' ? b.align[c] : '', b.mono[c] ? 'mono' : ''].filter(Boolean).join(' ');
      const attr = (c: number) => (cls(c) ? ` class="${cls(c)}"` : '');
      const head = `<thead><tr>${b.head.map((h, c) => `<th${attr(c)}>${runsHtml(h)}</th>`).join('')}</tr></thead>`;
      const rows = b.rows.map((r, i) => {
        const total = b.total && i === b.rows.length - 1;
        return `<tr${total ? ' class="total"' : ''}>${r.map((cell, c) => `<td${attr(c)}>${runsHtml(cell)}</td>`).join('')}</tr>`;
      }).join('');
      return `<table class="paper-table">${head}<tbody>${rows}</tbody></table>`;
    }
    case 'legend':
      return `<div class="legend${b.warning ? ' warning' : ''}">${b.paras.map((p) => `<p>${runsHtml(p)}</p>`).join('')}</div>`;
    case 'check': return `<div class="check"><span class="box${b.checked ? ' x' : ''}"></span><span>${runsHtml(b.runs)}</span></div>`;
    case 'rule': return '<hr class="paper-rule">';
  }
}

/** One execution line: a run of underscores is drawn as a fill-in rule. */
function lineHtml(s: string): string {
  return escapeHtml(s).replace(/_{3,}/g, '<span class="fill"></span>');
}

function partyHtml(p: PaperParty): string {
  const sig = p.image ? `<img class="sigimg" alt="Signature" src="${p.image}">` : '';
  const signed = p.signedLine ? `<p class="signed">${escapeHtml(p.signedLine)}</p>` : '';
  const lines = `${sig}<p class="line">${lineHtml(p.by)}</p>${signed}<p class="line">${lineHtml(p.name)}</p>`
    + `<p class="line">${lineHtml(p.title)}</p><p class="line">${lineHtml(p.date)}</p>`;
  return `<div class="party"><div class="heading">${escapeHtml(p.heading)}</div>`
    + (p.through ? `<p class="line through">${escapeHtml(p.through)}</p><div class="through-block">${lines}</div>` : lines)
    + '</div>';
}

function stateHtml(s: PaperState): string {
  switch (s.kind) {
    case 'draft': return '<div class="state-banner">DRAFT — for counsel review</div><div class="diagonal draft" aria-hidden="true">DRAFT</div>';
    case 'specimen': return '<div class="diagonal specimen" aria-hidden="true">SPECIMEN</div>';
    case 'superseded': return `<div class="stamp">Superseded by v${s.by}</div>`;
    case 'issued': return '<div class="stamp">Issued</div>';
  }
}

function coverHtml(m: PaperModel, cover: PaperCover): string {
  const c = m.cover!;
  const fill = (v: string | null) => (v ? escapeHtml(v) : '<span class="fill"></span>');
  return `<section class="cover cover-${cover}"><div class="cover-inner">`
    + `<div class="lockup"><img alt="" src="${markDataUri()}"><span class="wordmark">AXAL VC</span></div>`
    + `<div class="cover-fund">${escapeHtml(c.fund)}</div>`
    + `<h1 class="cover-title">${escapeHtml(c.name)}</h1>`
    + `<div class="eyebrow">Confidential</div>`
    + `<dl><dt>Copy No.</dt><dd>${fill(c.copyNumber)}</dd><dt>Prepared for</dt><dd>${fill(c.preparedFor)}</dd>`
    + `<dt>Date</dt><dd>${fill(c.date)}</dd></dl>`
    + `<div class="cover-foot">${c.legends.map((b) => blockHtml(b, false)).join('')}</div>`
    + '</div></section>';
}

function contentsHtml(m: PaperModel, pages: (number | null)[] | null, last = false): string {
  const items = m.articles.map((a, i) => {
    const pg = pages && pages[i] != null ? `<span class="pg">${pages[i]}</span>` : '';
    return `<li><span>${escapeHtml(a.text)}</span>${pg ? '<span class="leader"></span>' + pg : ''}</li>`;
  }).join('');
  return `<section class="contents${last ? ' last' : ''}"><div class="eyebrow">Contents</div><h1 class="title">${escapeHtml(m.title)}</h1><ol>${items}</ol></section>`;
}

function certificateHtml(m: PaperModel): string {
  const c = m.certificate!;
  const rows = c.rows.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.status)}</td><td class="mono">${escapeHtml(r.at)}</td></tr>`).join('');
  return '<section class="certificate"><div class="eyebrow">Certificate of completion</div>'
    + `<h1 class="title">${escapeHtml(c.title)}</h1>`
    + '<table class="paper-table"><tbody>'
    + `<tr><td>Envelope</td><td colspan="3" class="mono">${escapeHtml(c.envelopeUuid)}</td></tr>`
    + `<tr><td>Version</td><td colspan="3">${c.version ? `v${c.version}` : 'not recorded'}</td></tr>`
    + `<tr><td>Body SHA-256</td><td colspan="3" class="mono">${escapeHtml(c.bodySha256)}</td></tr>`
    + '</tbody></table>'
    + `<table class="paper-table"><thead><tr><th>Signer</th><th>Name</th><th>Status</th><th>Time (UTC)</th></tr></thead><tbody>${rows}</tbody></table>`
    + '</section>';
}

export interface PaperHtmlOptions {
  pageSize: PaperPageSize;
  cover: PaperCover;
  medium: PaperMedium;
  fonts: 'inline' | 'omit';
  /**
   * `all` (the default) is the whole paper. A cover slug's PDF prints in two
   * passes: `body` (each article heading links to its own id) and `front`
   * (the cover and contents, with `tocPages`).
   */
  part?: 'all' | 'body' | 'front';
  tocPages?: (number | null)[] | null;
}

const CSP = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:";

export function paperHtml(m: PaperModel, o: PaperHtmlOptions): string {
  const pageSize = assertPageSize(o.pageSize);
  const cover = assertCover(o.cover);
  const part = o.part || 'all';
  const screen = o.medium === 'screen';
  const css = paperCss({
    pageSize, cover, medium: o.medium, footerLeft: m.footerLeft, auditLine: m.auditLine, frontMatter: part === 'front',
  });
  const fonts = o.fonts === 'inline' ? paperFontsCss() : '';

  const head = screen
    ? `<header class="screen-head"><div class="lockup"><img alt="" src="${markDataUri()}"><span class="wordmark">AXAL VC</span></div><span class="confidential">Confidential</span></header>`
    : '<span class="lockup-font-warm" aria-hidden="true">AXAL VC</span>';
  const foot = screen
    ? `<footer class="screen-foot"><div>${escapeHtml(m.footerLeft)}</div><div class="audit">${escapeHtml(m.auditLine)}</div></footer>`
    : '';

  const parts: string[] = [];
  if (part !== 'body' && m.cover) {
    parts.push(coverHtml(m, cover));
    parts.push(contentsHtml(m, screen ? null : (o.tocPages ?? null), part === 'front'));
  }
  if (part !== 'front') {
    parts.push(stateHtml(m.state));
    if (m.restricted) parts.push('<div class="restricted">Confidential — GP and LPAC only</div>');
    parts.push(`<h1 class="title">${escapeHtml(m.title)}</h1>`);
    if (m.preamble) parts.push(`<p class="preamble">${escapeHtml(m.preamble)}</p>`);
    parts.push(m.blocks.map((b) => blockHtml(b, part === 'body')).join('\n'));
    if (m.execution) {
      parts.push('<p class="sig-follows">[Signature page follows]</p>');
      parts.push('<section class="execution"><div class="eyebrow">Execution</div>'
        + `<p class="recital">${escapeHtml(m.execution.recital)}</p>`
        + `<div class="parties">${m.execution.parties.map(partyHtml).join('')}</div></section>`);
    }
    if (m.certificate) parts.push(certificateHtml(m));
  } else {
    parts.push(stateHtml(m.state).replace(/<div class="(state-banner|stamp)">[^<]*<\/div>/, ''));
  }

  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${CSP}">`
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${escapeHtml(m.title)}</title>`
    + `<style id="paper-fonts">${fonts}</style><style id="paper-css">${css}</style>`
    + `</head><body>${head}<main>${parts.join('\n')}</main>${foot}</body></html>`;
}

// --- the paper's own hash ----------------------------------------------------

let paperShaMemo: Promise<string> | null = null;

/** SHA-256 of the CSS, faces and mark, once per isolate, for every registry row. */
export function paperSha256(): Promise<string> {
  if (!paperShaMemo) {
    const canon = paperCss({ pageSize: 'letter', cover: 'dark', medium: 'pdf', footerLeft: '', auditLine: '' })
      + paperCss({ pageSize: 'letter', cover: 'dark', medium: 'screen', footerLeft: '', auditLine: '' })
      + paperFontsCss() + markDataUri();
    paperShaMemo = crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon)).then((buf) =>
      Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''));
  }
  return paperShaMemo;
}

export { runsText };

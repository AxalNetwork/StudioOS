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
import { STRUCTURE_MAP_SLUGS } from './templateFormat';
import { STRUCTURE_HEADING, STRUCTURE_MARKER, STRUCTURE_SUBTITLE, licenceLines, structureLines, structureSvg, structureTable } from './fundStructurePaper';
import type { StructureModel } from './fundStructure';

export const COVER_SLUGS = new Set(['lpa_amended_restated', 'ppm', 'compliance_manual_code_of_ethics', 'subscription_booklet']);

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
  // D716 — a notice's sections. Each is optional and prints only when given.
  /** The addressee lines (`buildAddresseeBlock`). */
  addressee?: string[] | null;
  /** Key figures, in rows. A `mono` value prints in the figures face. */
  keyFigures?: NoticeKeyFigure[] | null;
  /** Figures tables: columns with their alignment, and an optional totals row under a strong rule. */
  tables?: NoticeTable[] | null;
  /** The phone check (#1773's PAY_WARNING), in the warning box. */
  warning?: string | null;
  /** The payment-instructions block, or the resolver's refusal in its place. */
  payment?: NoticePayment | null;
  /** An issued notice's stamp; replaces the state stamp. */
  stamp?: 'issued' | 'superseded' | null;
  /** The footer's audit line, in place of the envelope's. */
  audit?: string | null;
  /** The sender's block takes no page of its own (a notice is issued, not signed). */
  inlineExecution?: boolean;
  /**
   * D716 — a composite paper (the Subscription Booklet): its parts, in order.
   * The input's own body is then the cover's legend, and each part prints on
   * its own named page with its own block.
   */
  parts?: PaperPartInput[] | null;
  /**
   * D717 (#1782) — the entity and money map (services/fundStructure.ts), for
   * the audience this paper is printed for. It prints only on a
   * `STRUCTURE_MAP_SLUGS` document, on its own page: at a body line that reads
   * exactly `[STRUCTURE OF THE FUND]`, else straight after the preamble; in the
   * booklet, after Part 2.
   */
  structure?: StructureModel | null;
}

/** D716 — one part of a composite paper. */
export interface PaperPartInput {
  n: number;
  title: string;
  /** The part's body, or null for a part that prints only its block (Part 8). */
  body: string | null;
  /** The part's store row has no text yet: it prints the stub sentence. */
  missing?: boolean;
  /** The part's own block, or null for none. */
  block: { kind: DocumentKind; axalEntityKey?: AxalEntityKey } | null;
  counterpartyName?: string | null;
  /** The footer's title on this part's pages. */
  footer: string;
}

export interface PaperPart {
  n: number;
  title: string;
  /** The heading's id: the contents links to it. */
  id: string;
  blocks: Block[];
  execution: { recital: string; parties: PaperParty[] } | null;
  footer: string;
}

/** What a part with no text from counsel prints. */
export const PART_STUB = 'Stub — counsel to draft.';

export interface NoticeKeyFigure { label: string; value: string; mono?: boolean }
export interface NoticeTable {
  title?: string | null;
  columns: { label: string; align?: 'left' | 'right' }[];
  rows: string[][];
  /** The last row is the totals row. */
  total?: boolean;
}
export type NoticePayment =
  | { lines: { label: string; value: string; mono?: boolean }[]; reference: string | null }
  | { refusal: string };

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
  addressee: string[] | null;
  keyFigures: NoticeKeyFigure[] | null;
  tables: NoticeTable[] | null;
  warning: string | null;
  payment: NoticePayment | null;
  stamp: 'issued' | 'superseded' | null;
  inlineExecution: boolean;
  parts: PaperPart[] | null;
  /**
   * D717 — the Structure of the Fund page: the drawing, the numbered table, the
   * licence lines, the closing paragraph and the note (#1855), the pdf-lib
   * fallback's lines, and the block index it precedes.
   */
  structure: {
    svg: string; lines: string[]; at: number;
    subtitle: string; table: [string, string, string, string][]; licences: string[]; closing: string; note: string;
  } | null;
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
    // D716 — a composite paper's own body is all cover: the legend.
    const legends: Block[] = input.parts?.length ? allBlocks : head.filter((b) => b.t === 'legend');
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
  // D716 — each part prints its own block, parties as `buildExecutionBlock` names them.
  const parts: PaperPart[] | null = input.parts?.length
    ? input.parts.map((pt) => {
        const base = pt.block
          ? buildExecutionBlock({ kind: pt.block.kind, axalEntityKey: pt.block.axalEntityKey, counterpartyName: pt.counterpartyName || null })
          : null;
        const blocksOf = pt.missing
          ? paperBlocks(PART_STUB, { merge: 'raw', title: pt.title })
          : pt.body ? paperBlocks(stripTrailingSignatureBlock(pt.body), { merge: input.merge || 'raw', title: pt.title }) : [];
        return {
          n: pt.n,
          title: pt.title,
          id: `part-${pt.n}`,
          blocks: blocksOf,
          execution: base && base.parties.length
            ? { recital: base.recital, parties: base.parties.map((p) => ({ ...p, signedLine: null, image: null, nested: !!p.through })) }
            : null,
          footer: pt.footer,
        };
      })
    : null;
  // A composite paper's contents lists its parts after the cover.
  const articles = parts
    ? parts.filter((pt) => pt.n > 1).map((pt) => ({ id: pt.id, text: `Part ${pt.n} · ${pt.title}` }))
    : blocks.filter((b): b is Extract<Block, { t: 'article' }> => b.t === 'article').map((b) => ({ id: b.id, text: b.text }));

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

  // D717 — the Structure of the Fund page, on a map document only: at the
  // marker line (which is dropped), else straight after the preamble.
  let structure: PaperModel['structure'] = null;
  if (input.structure && STRUCTURE_MAP_SLUGS.has(slug.toLowerCase())) {
    const marker = blocks.findIndex((b) => b.t === 'para' && !b.num && !b.runIn && runsText(b.runs).trim() === STRUCTURE_MARKER);
    if (marker >= 0) blocks = blocks.filter((_, i) => i !== marker);
    const st = input.structure;
    structure = {
      svg: structureSvg(st), lines: structureLines(st), at: marker >= 0 ? marker : 0,
      subtitle: STRUCTURE_SUBTITLE, table: structureTable(st), licences: licenceLines(st), closing: st.rails_note, note: st.note,
    };
  }

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
    auditLine: input.audit
      ? input.audit
      : issued
        ? `SHA-256 ${input.bodySha256.slice(0, 16)}… · Envelope ${uuid}`
        : 'SHA-256 and envelope id assigned when issued',
    addressee: input.addressee?.length ? input.addressee : null,
    keyFigures: input.keyFigures?.length ? input.keyFigures : null,
    tables: input.tables?.length ? input.tables : null,
    warning: input.warning || null,
    payment: input.payment || null,
    stamp: input.stamp || null,
    inlineExecution: !!input.inlineExecution,
    parts,
    structure,
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
  // D716 — a notice's sender has no By line.
  const by = p.by ? `<p class="line">${lineHtml(p.by)}</p>` : '';
  const lines = `${sig}${by}${signed}<p class="line">${lineHtml(p.name)}</p>`
    + `<p class="line">${lineHtml(p.title)}</p><p class="line">${lineHtml(p.date)}</p>`;
  return `<div class="party"><div class="heading">${escapeHtml(p.heading)}</div>`
    + (p.through ? `<p class="line through">${escapeHtml(p.through)}</p><div class="through-block">${lines}</div>` : lines)
    + '</div>';
}

// --- D716: a notice's sections -----------------------------------------------

function keyFiguresHtml(rows: NoticeKeyFigure[]): string {
  return '<dl class="key-figures">' + rows.map((r) =>
    `<dt>${escapeHtml(r.label)}</dt><dd${r.mono ? ' class="mono"' : ''}>${escapeHtml(r.value)}</dd>`).join('') + '</dl>';
}

function noticeTableHtml(t: NoticeTable): string {
  const cls = (c: number) => (t.columns[c]?.align === 'right' ? ' class="right mono"' : '');
  const head = `<thead><tr>${t.columns.map((col, c) => `<th${cls(c)}>${escapeHtml(col.label)}</th>`).join('')}</tr></thead>`;
  const rows = t.rows.map((r, i) => {
    const total = !!t.total && i === t.rows.length - 1;
    return `<tr${total ? ' class="total"' : ''}>${r.map((v, c) => `<td${cls(c)}>${escapeHtml(v)}</td>`).join('')}</tr>`;
  }).join('');
  return (t.title ? `<div class="eyebrow table-title">${escapeHtml(t.title)}</div>` : '')
    + `<table class="paper-table">${head}<tbody>${rows}</tbody></table>`;
}

function paymentHtml(p: NoticePayment): string {
  if ('refusal' in p) {
    return `<section class="payment"><div class="eyebrow">Payment instructions</div><p class="payment-refusal">${escapeHtml(p.refusal)}</p></section>`;
  }
  return '<section class="payment"><div class="eyebrow">Payment instructions</div><dl class="key-figures">'
    + p.lines.map((l) => `<dt>${escapeHtml(l.label)}</dt><dd${l.mono ? ' class="mono"' : ''}>${escapeHtml(l.value)}</dd>`).join('')
    + (p.reference ? `<dt>Reference to quote</dt><dd class="mono">${escapeHtml(p.reference)}</dd>` : '')
    + '</dl></section>';
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

/**
 * D717 — the Structure of the Fund page, in L10's paper order (#1855 decision
 * 3): the heading and subtitle, the map, the numbered table, the licences A and
 * B, the closing paragraph and the note.
 */
function structureHtml(st: NonNullable<PaperModel['structure']>): string {
  const head = ['No.', 'Flow', 'Rail', 'Receiving account'].map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const rows = st.table.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
  return `<section class="structure-page"><div class="eyebrow">${escapeHtml(STRUCTURE_HEADING)}</div>`
    + `<h2 class="article structure-heading">${escapeHtml(STRUCTURE_HEADING)}</h2>`
    + `<p class="structure-subtitle">${escapeHtml(st.subtitle)}</p>`
    + `<figure class="structure-figure">${st.svg}</figure>`
    + `<table class="structure-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
    + st.licences.map((l) => `<p class="structure-licence">${escapeHtml(l)}</p>`).join('')
    + `<p class="structure-closing">${escapeHtml(st.closing)}</p>`
    + `<p class="structure-note">${escapeHtml(st.note)}</p></section>`;
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
    parts: m.parts ? m.parts.filter((pt) => pt.n > 1).map((pt) => ({ n: pt.n, footer: pt.footer })) : null,
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
  if (part !== 'front' && m.parts) {
    // D716 — a composite paper: each part on its own named page, its heading
    // the one link the body pass prints, so the contents finds its page.
    if (m.state.kind === 'draft') parts.push(stateHtml(m.state));
    for (const pt of m.parts.filter((x) => x.n > 1)) {
      const heading = part === 'body' ? `<a href="#${pt.id}">${escapeHtml(pt.title)}</a>` : escapeHtml(pt.title);
      parts.push(`<section class="booklet-part part-${pt.n}"><div class="eyebrow">Part ${pt.n}</div>`
        + `<h1 class="title" id="${pt.id}">${heading}</h1>`
        + pt.blocks.map((b) => blockHtml(b, false)).join('\n')
        + (pt.execution
          ? '<section class="execution part-block">'
            + (pt.execution.recital ? `<p class="recital">${escapeHtml(pt.execution.recital)}</p>` : '')
            + `<div class="parties">${pt.execution.parties.map(partyHtml).join('')}</div></section>`
          : '')
        + '</section>');
      // D717 — the booklet's Structure of the Fund page, a generated page after Part 2.
      if (pt.n === 2 && m.structure) parts.push(structureHtml(m.structure));
    }
  } else if (part !== 'front') {
    parts.push(m.stamp && m.state.kind === 'issued'
      ? `<div class="stamp">${m.stamp === 'superseded' ? 'Superseded' : 'Issued'}</div>`
      : stateHtml(m.state));
    if (m.restricted) parts.push('<div class="restricted">Confidential — GP and LPAC only</div>');
    parts.push(`<h1 class="title">${escapeHtml(m.title)}</h1>`);
    if (m.addressee) parts.push(`<div class="addressee">${m.addressee.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}</div>`);
    if (m.preamble) parts.push(`<p class="preamble">${escapeHtml(m.preamble)}</p>`);
    const bodyHtml = m.blocks.map((b) => blockHtml(b, part === 'body'));
    if (m.structure) bodyHtml.splice(Math.min(m.structure.at, bodyHtml.length), 0, structureHtml(m.structure));
    parts.push(bodyHtml.join('\n'));
    if (m.keyFigures) parts.push(keyFiguresHtml(m.keyFigures));
    if (m.tables) parts.push(m.tables.map(noticeTableHtml).join(''));
    // The phone check sits directly above the payment block, or above the
    // sender's block when there is none.
    if (m.warning) parts.push(`<div class="legend warning warning-box"><p>${escapeHtml(m.warning)}</p></div>`);
    if (m.payment) parts.push(paymentHtml(m.payment));
    if (m.execution && m.execution.parties.length) {
      if (!m.inlineExecution) parts.push('<p class="sig-follows">[Signature page follows]</p>');
      parts.push(`<section class="execution${m.inlineExecution ? ' inline' : ''}">`
        + (m.inlineExecution ? '' : '<div class="eyebrow">Execution</div>')
        + (m.execution.recital ? `<p class="recital">${escapeHtml(m.execution.recital)}</p>` : '')
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

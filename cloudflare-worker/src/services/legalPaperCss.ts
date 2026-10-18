// D711 (#1776) — the legal paper's faces, tokens and CSS.
//
// Every legal document prints on one HTML paper (services/legalPaper.ts).
// This file is its look: the brand faces, inlined as data: URIs so no render
// fetches anything, and one CSS string built from named tokens. Every colour,
// size and space is a token here. Tests read token names, not values.
//
// The values are R2's, the canvas's brand pass ("Legal Documents ·
// Templates", boards R1, R2 and the page renderer), set by the library sweep
// (#1865, D711 § "The library sweep and the R2 restyle"). That pass changed
// four rules as well as the tokens:
//   - violet only in CONFIDENTIAL, the eyebrows, clause numbers, links, the
//     table-header underline, the Draft and Superseded states and the light
//     cover's top rule; the wordmark, table-header text and Issued stamp ink;
//   - Public Sans prints at 400 and 700 only: the canvas's 600 and 800 map to
//     the shipped 700, so no browser fakes a bold;
//   - body paragraphs are justified;
//   - the wordmark reads "Axal VC".
//
// NOTE: authored to load under `node --experimental-strip-types` (the worker
// test gate) — no `enum`s, no TS parameter properties.

import publicSans400 from '../templates/legal/paper/public-sans-400.woff2';
import publicSans400Italic from '../templates/legal/paper/public-sans-400-italic.woff2';
import publicSans700 from '../templates/legal/paper/public-sans-700.woff2';
import bricolage800 from '../templates/legal/paper/bricolage-grotesque-800.woff2';
import spaceGrotesk700 from '../templates/legal/paper/space-grotesk-700.woff2';
import robotoMono400 from '../templates/legal/paper/roboto-mono-400.woff2';
import robotoMono700 from '../templates/legal/paper/roboto-mono-700.woff2';
import axalMark from '../templates/legal/paper/axal-mark.png';

export type PaperPageSize = 'letter' | 'a4';
export type PaperCover = 'dark' | 'light';
export type PaperMedium = 'pdf' | 'screen';

export const PAGE_SIZES: readonly PaperPageSize[] = ['letter', 'a4'];
export const COVERS: readonly PaperCover[] = ['dark', 'light'];

export function assertPageSize(v: unknown): PaperPageSize {
  if (v === 'letter' || v === 'a4') return v;
  throw new Error('page_size_invalid');
}
export function assertCover(v: unknown): PaperCover {
  if (v === 'dark' || v === 'light') return v;
  throw new Error('cover_invalid');
}

/**
 * A request's page size and cover: absent takes the default (Letter, dark);
 * anything else is refused with `page_size_invalid` or `cover_invalid`.
 */
export function readPaperChoice(pageSize: unknown, cover: unknown):
  { ok: true; pageSize: PaperPageSize; cover: PaperCover } | { ok: false; code: 'page_size_invalid' | 'cover_invalid' } {
  const p = pageSize == null || pageSize === '' ? 'letter' : pageSize;
  const c = cover == null || cover === '' ? 'dark' : cover;
  if (p !== 'letter' && p !== 'a4') return { ok: false, code: 'page_size_invalid' };
  if (c !== 'dark' && c !== 'light') return { ok: false, code: 'cover_invalid' };
  return { ok: true, pageSize: p, cover: c };
}

export const PAPER_CHOICE_MESSAGES: Record<'page_size_invalid' | 'cover_invalid', string> = {
  page_size_invalid: 'page_size must be letter or a4.',
  cover_invalid: 'cover must be dark or light.',
};

// --- the faces ---------------------------------------------------------------

export interface LegalFace {
  family: string;
  style: 'normal' | 'italic';
  /** The weight range the file covers (a static file: one weight). */
  weights: [number, number];
  role: string;
  file: string;
  bytes: ArrayBuffer;
}

export const LEGAL_FACES: readonly LegalFace[] = [
  { family: 'Public Sans', style: 'normal', weights: [400, 400], role: 'body, preamble, execution text', file: 'public-sans-400.woff2', bytes: publicSans400 },
  { family: 'Public Sans', style: 'italic', weights: [400, 400], role: 'oblique runs', file: 'public-sans-400-italic.woff2', bytes: publicSans400Italic },
  { family: 'Public Sans', style: 'normal', weights: [700, 700], role: 'bold runs, eyebrows, CONFIDENTIAL, section labels', file: 'public-sans-700.woff2', bytes: publicSans700 },
  { family: 'Bricolage Grotesque', style: 'normal', weights: [800, 800], role: 'title and article headings', file: 'bricolage-grotesque-800.woff2', bytes: bricolage800 },
  { family: 'Space Grotesk', style: 'normal', weights: [700, 700], role: 'the AXAL VC wordmark in the lockup only', file: 'space-grotesk-700.woff2', bytes: spaceGrotesk700 },
  { family: 'Roboto Mono', style: 'normal', weights: [400, 400], role: 'figures, the audit line, hashes', file: 'roboto-mono-400.woff2', bytes: robotoMono400 },
  { family: 'Roboto Mono', style: 'normal', weights: [700, 700], role: 'bold figures', file: 'roboto-mono-700.woff2', bytes: robotoMono700 },
];

export const LEGAL_MARK_PNG: ArrayBuffer = axalMark;

export function bytesToBase64(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

let fontsCssMemo: string | null = null;
let markUriMemo: string | null = null;

/** The `@font-face` rules alone, every face inline. */
export function paperFontsCss(): string {
  if (fontsCssMemo) return fontsCssMemo;
  fontsCssMemo = LEGAL_FACES.map((f) => {
    const w = f.weights[0] === f.weights[1] ? String(f.weights[0]) : `${f.weights[0]} ${f.weights[1]}`;
    return `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${w};font-display:block;`
      + `src:url(data:font/woff2;base64,${bytesToBase64(f.bytes)}) format('woff2');}`;
  }).join('\n');
  return fontsCssMemo;
}

export function markDataUri(): string {
  if (!markUriMemo) markUriMemo = `data:image/png;base64,${bytesToBase64(LEGAL_MARK_PNG)}`;
  return markUriMemo;
}

// --- the tokens --------------------------------------------------------------
// Ink, violet and neutrals only: no token is a red hue (the old PDF printed a
// red CONFIDENTIAL; the canvas has none).

export const PAPER_TOKENS = {
  color: {
    ink: '#141118',
    inkStrong: '#141118',
    violet: '#6d28d9',
    muted: '#6b6577',
    faint: '#9a96a8',
    rule: '#ececf1',
    mergeTint: '#efe7fd',
    mergeInk: '#5b21b6',
    tableHeadGround: '#faf9fc',
    stampIssued: '#141118',
    stampSuperseded: '#6d28d9',
    stampGround: '#ffffff',
    diagonalDraft: '#6d28d9',
    diagonalSpecimen: '#6b6577',
    coverDarkGround: '#141118',
    coverDarkInk: '#ffffff',
    coverDarkMuted: '#9a96a8',
    coverDarkEyebrow: '#a78bfa',
    coverGlow: 'rgba(124, 58, 237, 0.55)',
    coverLightGround: '#ffffff',
    white: '#ffffff',
  },
  size: {
    body: '10.5pt',
    bodyLine: '15pt',
    title: '15pt',
    titleLine: '19pt',
    article: '12.5pt',
    articleLine: '16pt',
    section: '10.5pt',
    sectionLine: '15pt',
    lockup: '10pt',
    confidential: '8pt',
    eyebrow: '8pt',
    eyebrowLine: '10pt',
    footer: '8pt',
    footerLine: '10pt',
    audit: '6.5pt',
    auditLine: '8pt',
    figures: '9.5pt',
    figuresLine: '13pt',
    tableHead: '8.5pt',
    tableCell: '9.5pt',
    legend: '9pt',
    diagonal: '48pt',
    coverTitle: '40pt',
    coverTitleLine: '44pt',
    coverFund: '10.5pt',
    coverMark: '24pt',
    coverWordmark: '16pt',
    checkbox: '9pt',
    mark: '13pt',
  },
  track: {
    wordmark: '-0.025em',
    eyebrow: '0.14em',
    confidential: '0.14em',
    tableHead: '0.06em',
    coverTitle: '-0.03em',
  },
  angle: { diagonal: '-38deg' },
  space: {
    pageMargin: '0.75in',
    titleAfter: '12pt',
    paragraphAfter: '7pt',
    articleBefore: '14pt',
    articleAfter: '6pt',
    hang: '2.4em',
    partyGap: '18pt',
  },
  rule: {
    header: '0.5pt',
    table: '0.5pt',
    tableHead: '0.75pt',
    total: '1.25pt',
    legend: '0.75pt',
    warning: '1.25pt',
    fill: '0.5pt',
    checkbox: '0.75pt',
  },
  opacity: { diagonal: '0.2' },
} as const;

const PAGE_DIMENSIONS: Record<PaperPageSize, { css: string; w: string; h: string }> = {
  letter: { css: 'letter', w: '8.5in', h: '11in' },
  a4: { css: 'A4', w: '210mm', h: '297mm' },
};

/**
 * A string for a CSS `content` value: `\`, `"` and newlines escaped, and `<`
 * as `\3C ` so no title can close the `<style>` element.
 */
export function cssString(s: string): string {
  return '"' + String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n?|\n/g, '\\A ')
    .replace(/</g, '\\3C ') + '"';
}

export interface PaperCssOptions {
  pageSize: PaperPageSize;
  cover: PaperCover;
  medium: PaperMedium;
  /** The footer's left line: "<title> — v<N>", or the title alone. */
  footerLeft: string;
  /** The audit line under the footer. */
  auditLine: string;
  /** Front matter (cover and contents) numbers its pages i, ii, … */
  frontMatter?: boolean;
  /** D716 — a composite paper's parts: each its own named page, with its own footer title. */
  parts?: { n: number; footer: string }[] | null;
}

/** The paper's CSS, faces excluded (they go in `<style id="paper-fonts">`). */
export function paperCss(o: PaperCssOptions): string {
  const pageSize = assertPageSize(o.pageSize);
  const cover = assertCover(o.cover);
  const T = PAPER_TOKENS;
  const C = T.color;
  const dim = PAGE_DIMENSIONS[pageSize];
  const counter = o.frontMatter ? 'counter(page, lower-roman)' : 'counter(page)';
  const pageRule = o.frontMatter
    ? `"Page " ${counter}`
    : `"Page " counter(page) " of " counter(pages)`;
  const footer = `${cssString(o.footerLeft)} "\\A " ${cssString(o.auditLine)}`;
  // D716 — one named page per part, so its footer names the part.
  const partPages = (o.parts || []).filter((pt) => Number.isInteger(pt.n) && pt.n > 0).map((pt) =>
    `@page part-${pt.n} { @bottom-left { content: ${cssString(pt.footer)} "\\A " ${cssString(o.auditLine)}; } }\n`
    + `section.booklet-part.part-${pt.n} { page: part-${pt.n}; }`).join('\n');

  const print = o.medium === 'pdf' ? `
@page {
  size: ${dim.css};
  margin: ${T.space.pageMargin};
  @top-left {
    content: "Axal VC";
    font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: ${T.size.lockup};
    color: ${C.ink}; letter-spacing: ${T.track.wordmark};
    background: url(${markDataUri()}) no-repeat left 0 bottom 5pt / ${T.size.mark} ${T.size.mark};
    padding-left: calc(${T.size.mark} + 5pt);
    vertical-align: bottom; padding-bottom: 6pt;
    border-bottom: ${T.rule.header} solid ${C.rule};
  }
  @top-center { content: ""; vertical-align: bottom; border-bottom: ${T.rule.header} solid ${C.rule}; }
  @top-right {
    content: "CONFIDENTIAL";
    font-family: 'Public Sans', sans-serif; font-weight: 700; font-size: ${T.size.confidential};
    letter-spacing: ${T.track.confidential}; color: ${C.violet};
    vertical-align: bottom; padding-bottom: 6pt;
    border-bottom: ${T.rule.header} solid ${C.rule};
  }
  @bottom-left {
    content: ${footer};
    white-space: pre; font-family: 'Public Sans', sans-serif; font-size: ${T.size.footer}; line-height: ${T.size.footerLine};
    color: ${C.muted}; vertical-align: top; padding-top: 8pt;
  }
  @bottom-right {
    content: ${pageRule};
    font-family: 'Public Sans', sans-serif; font-size: ${T.size.footer}; line-height: ${T.size.footerLine};
    color: ${C.muted}; vertical-align: top; padding-top: 8pt;
  }
}
@page cover {
  margin: 0;
  @top-left { content: none; border: 0; background: none; }
  @top-center { content: none; border: 0; }
  @top-right { content: none; border: 0; }
  @bottom-left { content: none; }
  @bottom-right { content: none; }
}
.cover { page: cover; width: ${dim.w}; height: ${dim.h}; box-sizing: border-box; padding: ${T.space.pageMargin}; break-after: page; }
${partPages}
section.booklet-part { break-before: page; }
.screen-only { display: none; }
/* A face used only in a margin box is never loaded, so the lockup's wordmark
   would print blank: this invisible run in the page loads it. */
.lockup-font-warm { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; font-family: 'Space Grotesk', sans-serif; font-weight: 700; }
` : `
body { max-width: 7in; margin: 0 auto; padding: 24px 20px; background: ${C.white}; }
.cover { min-height: 9in; padding: ${T.space.pageMargin}; margin-bottom: 24px; }
.print-only { display: none; }
@media (max-width: 600px) { .parties { flex-direction: column; } }
`;

  return `${print}
html { font-family: 'Public Sans', sans-serif; font-size: ${T.size.body}; line-height: ${T.size.bodyLine}; color: ${C.ink}; }
body { margin: 0; background: ${C.white}; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
b, strong, .term { font-weight: 700; }
em { font-style: italic; }
.mono { font-family: 'Roboto Mono', monospace; font-variant-numeric: tabular-nums; }
.screen-head { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 6pt; margin-bottom: 14pt; border-bottom: ${T.rule.header} solid ${C.rule}; }
.lockup { display: inline-flex; align-items: center; gap: 5pt; }
.lockup img { width: ${T.size.mark}; height: ${T.size.mark}; }
.lockup .wordmark { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: ${T.size.lockup}; color: ${C.ink}; letter-spacing: ${T.track.wordmark}; }
.eyebrow, .confidential { font-family: 'Public Sans', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: ${T.track.eyebrow}; color: ${C.violet}; font-size: ${T.size.eyebrow}; line-height: ${T.size.eyebrowLine}; }
.confidential { font-size: ${T.size.confidential}; letter-spacing: ${T.track.confidential}; }
a { color: ${C.violet}; }
.screen-foot { margin-top: 24pt; padding-top: 8pt; border-top: ${T.rule.header} solid ${C.rule}; font-size: ${T.size.footer}; line-height: ${T.size.footerLine}; color: ${C.muted}; }
.audit { font-family: 'Roboto Mono', monospace; font-size: ${T.size.audit}; line-height: ${T.size.auditLine}; color: ${C.muted}; }
.state-banner { font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; font-size: ${T.size.eyebrow}; color: ${C.muted}; margin: 0 0 12pt; }
.state-banner.draft { color: ${C.violet}; }
.stamp { display: inline-block; font-weight: 700; letter-spacing: 0.1em; font-size: ${T.size.eyebrow}; background: ${C.stampGround}; border: ${T.rule.legend} solid currentColor; padding: 2pt 6pt; margin: 0 0 12pt; }
.stamp.issued { color: ${C.stampIssued}; }
.stamp.superseded { color: ${C.stampSuperseded}; }
.restricted { font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; font-size: ${T.size.eyebrow}; color: ${C.violet}; margin: 0 0 12pt; }
.diagonal { position: fixed; top: 46%; left: 0; right: 0; text-align: center; transform: rotate(${T.angle.diagonal}); font-family: 'Public Sans', sans-serif; font-weight: 700; font-size: ${T.size.diagonal}; opacity: ${T.opacity.diagonal}; pointer-events: none; z-index: 0; }
.diagonal.draft { color: ${C.diagonalDraft}; }
.diagonal.specimen { color: ${C.diagonalSpecimen}; }
h1.title { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: ${T.size.title}; line-height: ${T.size.titleLine}; text-transform: uppercase; text-align: center; color: ${C.inkStrong}; margin: 0 0 ${T.space.titleAfter}; break-after: avoid; }
h2.article { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: ${T.size.article}; line-height: ${T.size.articleLine}; color: ${C.inkStrong}; margin: ${T.space.articleBefore} 0 ${T.space.articleAfter}; break-after: avoid; }
h2.article a { color: inherit; text-decoration: none; }
h1.title a { color: inherit; text-decoration: none; }
h3.section { font-weight: 700; font-size: ${T.size.section}; line-height: ${T.size.sectionLine}; margin: 10pt 0 4pt; break-after: avoid; }
h2.schedule { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: ${T.size.article}; text-align: center; text-transform: uppercase; margin: ${T.space.articleBefore} 0 2pt; break-after: avoid; }
p.dateline { text-align: center; color: ${C.muted}; margin: 0 0 10pt; }
p { margin: 0 0 ${T.space.paragraphAfter}; orphans: 2; widows: 2; text-align: justify; }
p.preamble { margin-bottom: 12pt; }
p.recital { padding-left: ${T.space.hang}; text-align: justify; }
p.clause { padding-left: ${T.space.hang}; text-indent: -${T.space.hang}; text-align: justify; }
p.clause.depth-2 { padding-left: calc(${T.space.hang} * 2); }
p.clause .num { display: inline-block; width: ${T.space.hang}; text-indent: 0; color: ${C.violet}; font-weight: 700; }
.runin { font-weight: 700; }
ul.bullets { margin: 0 0 ${T.space.paragraphAfter}; padding-left: ${T.space.hang}; }
ul.bullets li { margin-bottom: 3pt; }
table.paper-table { width: 100%; border-collapse: collapse; margin: 6pt 0 10pt; }
table.paper-table thead { display: table-header-group; }
table.paper-table th { text-align: left; font-weight: 700; font-size: ${T.size.tableHead}; text-transform: uppercase; letter-spacing: ${T.track.tableHead}; color: ${C.ink}; background: ${C.tableHeadGround}; border-bottom: ${T.rule.tableHead} solid ${C.violet}; padding: 3pt 4pt; }
table.paper-table td { font-size: ${T.size.tableCell}; border-bottom: ${T.rule.table} solid ${C.rule}; padding: 3pt 4pt; vertical-align: top; }
table.paper-table tr { break-inside: avoid; }
table.paper-table .right { text-align: right; }
table.paper-table .center { text-align: center; }
table.paper-table tr.total td { border-top: ${T.rule.total} solid ${C.ink}; font-weight: 700; }
.legend { border: ${T.rule.legend} solid ${C.ink}; padding: 8pt 10pt; margin: 8pt 0 10pt; text-transform: uppercase; font-size: ${T.size.legend}; line-height: 1.4; break-inside: avoid; }
.legend.warning { border-width: ${T.rule.warning}; }
.legend p:last-child { margin-bottom: 0; }
.check { display: flex; gap: 6pt; align-items: baseline; margin: 0 0 4pt; break-inside: avoid; }
.box { display: inline-block; flex: none; width: ${T.size.checkbox}; height: ${T.size.checkbox}; border: ${T.rule.checkbox} solid ${C.ink}; box-sizing: border-box; vertical-align: -1pt; }
.box.x { background:
  linear-gradient(45deg, transparent 44%, ${C.ink} 44%, ${C.ink} 56%, transparent 56%),
  linear-gradient(-45deg, transparent 44%, ${C.ink} 44%, ${C.ink} 56%, transparent 56%); }
.fill { display: inline-block; min-width: 12em; border-bottom: ${T.rule.fill} solid ${C.ink}; height: 0.9em; }
.merge { background: ${C.mergeTint}; color: ${C.mergeInk}; padding: 0 2pt; border-radius: 2pt; }
hr.paper-rule { border: 0; border-top: ${T.rule.table} solid ${C.rule}; margin: 10pt 0; }
.sig-follows { font-style: italic; text-align: center; color: ${C.muted}; margin-top: 16pt; }
section.execution { break-before: page; break-inside: avoid; }
section.execution .recital { font-style: italic; color: ${C.muted}; font-size: 9pt; line-height: 12pt; margin-bottom: 16pt; }
.parties { display: flex; gap: ${T.space.partyGap}; align-items: flex-start; }
.party { flex: 1 1 0; min-width: 0; break-inside: avoid; }
.party .heading { font-weight: 700; color: ${C.inkStrong}; margin-bottom: 2pt; }
.party .through { margin-bottom: 4pt; }
.party .line { margin: 0 0 3pt; font-size: 9.5pt; }
.party .line .fill { min-width: 0; width: 70%; }
.party .through-block { padding-left: 12pt; }
.party .sigimg { display: block; max-width: 180pt; max-height: 48pt; margin: 4pt 0 2pt; }
.party .signed { font-family: 'Roboto Mono', monospace; font-size: ${T.size.audit}; color: ${C.muted}; margin: 0 0 3pt; }
section.certificate { break-before: page; }
/* D717 (#1782) — the Structure of the Fund page (services/fundStructurePaper.ts).
   Its own page, never split. #1855 draws L10's map: entity boxes and Mercury
   and licence routes in the violet (licences dashed), the Stripe route in the
   ink, outside boxes and guides in the muted grey, markers white with a ring.
   The colours are the paper tokens by role; PAPER (S14) sets their values. */
section.structure-page { break-before: page; break-after: page; break-inside: avoid; }
.structure-subtitle { margin: 0 0 8pt; font-size: ${T.size.legend}; color: ${C.muted}; }
.structure-figure { margin: 8pt 0 10pt; }
svg.fund-structure { display: block; width: 100%; height: auto; font-family: 'Public Sans', sans-serif; }
svg.fund-structure .fs-node { fill: ${C.white}; stroke: ${C.violet}; stroke-width: 0.9; }
svg.fund-structure .fs-node.fs-outside { stroke: ${C.muted}; stroke-dasharray: 3 2; }
svg.fund-structure .fs-label { font-size: 8.5px; font-weight: 700; fill: ${C.inkStrong}; }
svg.fund-structure .fs-sub { font-size: 6.5px; fill: ${C.muted}; }
svg.fund-structure .fs-line { fill: none; stroke: ${C.violet}; stroke-width: 0.9; }
svg.fund-structure .fs-line.fs-licence { stroke-dasharray: 4 2; }
svg.fund-structure .fs-line.fs-stripe { stroke: ${C.ink}; }
svg.fund-structure .fs-head { fill: ${C.violet}; }
svg.fund-structure .fs-head.fs-stripe { fill: ${C.ink}; }
svg.fund-structure .fs-marker { fill: ${C.white}; stroke: ${C.violet}; stroke-width: 0.8; }
svg.fund-structure .fs-marker.fs-stripe { stroke: ${C.ink}; }
svg.fund-structure .fs-num { font-size: 7px; font-weight: 700; fill: ${C.violet}; }
svg.fund-structure .fs-num.fs-stripe { fill: ${C.ink}; }
svg.fund-structure .fs-guide { fill: none; stroke: ${C.muted}; stroke-width: 0.6; }
svg.fund-structure .fs-text.fs-ink { fill: ${C.ink}; }
svg.fund-structure .fs-text.fs-grey { fill: ${C.muted}; }
svg.fund-structure .fs-caption { fill: ${C.muted}; }
table.structure-table { width: 100%; border-collapse: collapse; margin: 0 0 8pt; font-size: ${T.size.legend}; line-height: 1.45; }
table.structure-table th { text-align: left; font-size: ${T.size.eyebrow}; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: ${C.muted}; padding: 0 6pt 3pt 0; border-bottom: 0.5pt solid ${C.rule}; }
table.structure-table td { vertical-align: top; padding: 3pt 6pt 3pt 0; border-bottom: 0.5pt solid ${C.rule}; }
table.structure-table td:first-child { font-weight: 700; }
table.structure-table tr { break-inside: avoid; }
.structure-licence, .structure-closing, .structure-note { margin: 0 0 4pt; font-size: ${T.size.legend}; line-height: 1.45; }
section.execution.inline { break-before: auto; margin-top: 16pt; }
section.booklet-part + section.booklet-part { margin-top: 24pt; }
section.execution.part-block { break-before: auto; margin-top: 16pt; }
.addressee { margin: 0 0 12pt; }
.addressee p { margin: 0 0 2pt; }
dl.key-figures { display: grid; grid-template-columns: 14em 1fr; gap: 3pt 10pt; margin: 6pt 0 12pt; break-inside: avoid; }
dl.key-figures dt { font-weight: 700; font-size: ${T.size.eyebrow}; text-transform: uppercase; letter-spacing: 0.08em; color: ${C.muted}; }
dl.key-figures dd { margin: 0; }
.table-title { margin-top: 10pt; }
.warning-box { text-transform: none; }
section.payment { margin: 6pt 0 12pt; break-inside: avoid; }
.payment-refusal { font-weight: 700; }
section.certificate table td { font-size: 9pt; }
.cover-inner { display: flex; flex-direction: column; height: 100%; }
.cover .cover-fund { font-size: ${T.size.coverFund}; font-weight: 700; text-transform: uppercase; letter-spacing: ${T.track.eyebrow}; margin-top: 1.4in; }
.cover h1.cover-title { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; font-size: ${T.size.coverTitle}; line-height: ${T.size.coverTitleLine}; letter-spacing: ${T.track.coverTitle}; text-transform: uppercase; margin: 10pt 0 18pt; }
.cover .lockup img { width: ${T.size.coverMark}; height: ${T.size.coverMark}; }
.cover .lockup .wordmark { font-size: ${T.size.coverWordmark}; }
.cover dl { display: grid; grid-template-columns: 9em 1fr; gap: 6pt 10pt; margin: 0 0 18pt; }
.cover dt { font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; font-size: ${T.size.eyebrow}; }
.cover dd { margin: 0; }
.cover .cover-foot { margin-top: auto; }
.cover-${cover} { ${cover === 'dark'
    ? `background: radial-gradient(circle at 100% 0%, ${C.coverGlow} 0, transparent 45%), ${C.coverDarkGround}; color: ${C.coverDarkInk};`
    : `background: ${C.coverLightGround}; color: ${C.ink};`} }
.cover-dark .lockup .wordmark { color: ${C.coverDarkInk}; }
.cover-dark .eyebrow, .cover-dark .cover-fund { color: ${C.coverDarkEyebrow}; }
.cover-dark dt { color: ${C.coverDarkMuted}; }
.cover-light { border-top: 2pt solid ${C.violet}; }
.cover-light .cover-fund { color: ${C.violet}; }
.cover-dark .legend { border-color: ${C.coverDarkInk}; }
.cover-dark .fill { border-bottom-color: ${C.coverDarkInk}; }
section.contents { break-after: page; }
section.contents.last { break-after: auto; }
section.contents ol { list-style: none; padding: 0; margin: 0; }
section.contents li { display: flex; align-items: baseline; gap: 4pt; margin: 0 0 5pt; }
section.contents .leader { flex: 1; border-bottom: 1pt dotted ${C.faint}; }
section.contents .pg { font-family: 'Roboto Mono', monospace; }
`;
}

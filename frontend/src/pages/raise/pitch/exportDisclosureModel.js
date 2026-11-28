/**
 * D8771 (#8771) — the export dialog's disclosure, pure: who the file is for,
 * what leaves Axal VC in it, what the file will hold, and what the finished
 * export carried. Every sentence here is read from what the Worker's writers
 * make on main, never from what a format is assumed to do:
 *
 *   - the presets are the Worker's `deck_exports.EXPORT_COPIES` (a drift test
 *     reads both): an investor copy has no speaker notes and keeps the Sources
 *     appendix, as an investor link does (`shareModel.DEFAULT_INCLUDE`; owner
 *     question Q1, drawn as A); a working copy carries both. The dialog opens
 *     on the investor copy every time (Q2, drawn as A);
 *   - the PDF (`pdfExport.ts`, `PrintExtras.jsx`): each card a page at the
 *     deck's aspect (a template deck at 1920 × 1080), notes pages six cards a
 *     page after the cards, the Sources page last with the cards written with
 *     AI help;
 *   - PowerPoint (`pptxEditable.ts`, D1574): slides always 13.33 × 7.5 in;
 *     text and metric areas are text boxes, set smaller to fit down to
 *     FIT_FLOOR; the chart types in NATIVE_CHART_TYPES are native charts when
 *     they hold a point, any other chart a picture (when the headless browser
 *     takes one) or its type and series as text; a typed diagram is native
 *     shapes; a PNG, JPEG or GIF image is a picture, any other a sentence; a
 *     card made of fields and the Sources appendix are stacked text frames;
 *     speaker notes are empty unless included. Google Slides uploads that
 *     same file; the .odp (`odp.ts`) is the same placement at 28 × 15.75 cm
 *     with every chart a picture or text.
 */
import { versionLabel } from './pitchStudioModel.js';
import { formatLabel } from './presentExportModel.js';

// ── who the file is for ──

export const PRESETS = Object.freeze({
  investor: Object.freeze({ notes: false, sources: true }),
  working: Object.freeze({ notes: true, sources: true }),
});
/** Q2 (drawn as A): the dialog opens on the investor copy, every time. */
export const DEFAULT_PRESET = 'investor';
export const COPIES = ['investor', 'working', 'custom'];
export const COPY_LABEL = { investor: 'Investor copy', working: 'Working copy', custom: 'Custom' };
export const COPY_LINE = {
  investor: 'A clean deck for someone outside the venture. No speaker notes; the Sources appendix stays, as on an investor link.',
  working: 'For a colleague who edits or presents it. Speaker notes and the Sources appendix are in the file.',
  custom: 'You choose the speaker notes and the Sources appendix below.',
};

/** The preset two settings make; the Worker's `copyOf` records the same on the export. */
export function presetOf(notes, sources) {
  for (const [k, v] of Object.entries(PRESETS)) if (v.notes === Boolean(notes) && v.sources === Boolean(sources)) return k;
  return 'custom';
}

// ── the writers' own rules, copied (drift tests read the Worker's) ──

/** `pptxChart.NATIVE_CHART_TYPES`: the chart types PowerPoint gets as native, editable charts. */
export const NATIVE_CHART_TYPES = Object.freeze(['line', 'projection', 'columns', 'waterfall', 'nested_bars', 'stacked', 'percent_bar', 'ranked_bars', 'funnel']);
/** `pptxEditable.FIT_FLOOR`: the smallest share of its size long text is set at to fit its box. */
export const FIT_FLOOR = 0.4;
/** `PrintExtras.NOTES_PER_PAGE`: the PDF's notes pages hold six cards each. */
export const NOTES_PER_PAGE = 6;
const DIAGRAM_TYPES = ['timeline', 'flow', 'cycle', 'matrix'];
/** The image kinds PowerPoint gets as pictures (`pptxEditable.MEDIA`); the .odp also takes WebP. */
const PICTURE_KINDS = 'PNG, JPEG or GIF';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const titleOf = (c, i) => str(c?.title) || `Card ${i + 1}`;
const blocksOf = (c) => (Array.isArray(c?.blocks) ? c.blocks.filter((b) => b && typeof b === 'object') : []);
const fromBlocks = (c) => blocksOf(c).length > 0;

/** `PrintExtras.isStudioSlide`: a card the studio laid out or filled, rather than a template's. */
const isStudioSlide = (s) => (Array.isArray(s?.blocks) && s.blocks.length > 0) || (Array.isArray(s?.fields) && s.fields.length > 0);

// ── what the cards hold ──

/** The cards whose speaker notes say something, in deck order. */
export function notedCards(cards) {
  return (Array.isArray(cards) ? cards : []).map((c, i) => ({ n: i + 1, title: titleOf(c, i), note: str(c?.notes) })).filter((r) => r.note);
}

/** The private note the acknowledgment quotes: the first card's with notes, clipped to 160 characters. */
export function privateNote(cards) {
  const r = notedCards(cards)[0];
  if (!r) return null;
  return { ...r, quote: r.note.length > 160 ? `${r.note.slice(0, 159).trimEnd()}…` : r.note };
}

/** The Sources appendix's lines: one per card and figure source (`offlineHtml.sourceLines`). */
export function sourceLineCount(cards) {
  const seen = new Set();
  const ok = (b) => b && typeof b === 'object' && typeof b.source_key === 'string' && b.source_key.length > 0;
  (Array.isArray(cards) ? cards : []).forEach((s, i) => {
    const add = (b) => { if (ok(b)) seen.add(`${i}:${b.source_key}`); };
    add(s?.binding);
    for (const f of Array.isArray(s?.fields) ? s.fields : []) add(f?.binding);
    for (const b of blocksOf(s)) {
      add(b.binding);
      for (const sr of Array.isArray(b.series) ? b.series : []) add(sr?.binding);
    }
  });
  return seen.size;
}

/** The cards whose text was written with AI help (`offlineHtml.aiCards`): the PDF and HTML appendix name them. */
export const aiCardCount = (cards) => (Array.isArray(cards) ? cards : []).filter((s) => Array.isArray(s?.fields) && s.fields.some((f) => f?.source === 'ai')).length;

/** The page a PDF prints on (`pdfExport.printPageOf`): a studio deck at its aspect, a template deck at 16:9. */
export function pdfPageOf(cards, theme, methodId) {
  const studio = !methodId && (Array.isArray(cards) ? cards : []).some(isStudioSlide);
  return studio && theme?.aspect === '4:3' ? { aspect: '4:3', width: 1440, height: 1080 } : { aspect: '16:9', width: 1920, height: 1080 };
}

// ── the preview: what the file will be ──

const SLIDE_SIZE = { pptx: '13.33 × 7.5 in (16:9)', google_slides: '13.33 × 7.5 in (16:9), as Google converts it', odp: '28 × 15.75 cm (16:9)' };

/**
 * The file's plan for one format and the two settings: how many pages, slides
 * or cards, their size, and what follows the cards. `cards` are the version's
 * exportable cards (a hidden card is in no export).
 */
export function planOf(format, cards, { notes, sources, theme = null, methodId = null } = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const n = list.length;
  if (format === 'pdf') {
    const page = pdfPageOf(list, theme, methodId);
    const notesPages = notes ? Math.ceil(n / NOTES_PER_PAGE) : 0;
    const count = n + notesPages + (sources ? 1 : 0);
    const parts = [plural(n, 'card')];
    if (notesPages) parts.push(plural(notesPages, 'notes page'));
    if (sources) parts.push('Sources');
    return { unit: 'page', count, size: `${page.width} × ${page.height} px (${page.aspect})`, line: `${plural(count, 'page')} · ${parts.join(', ')}${notes ? '' : ' · no notes pages'}` };
  }
  if (format === 'html') {
    const count = n + (sources ? 1 : 0);
    return { unit: 'card', count, size: 'One file at the deck’s own layout', line: `${plural(count, 'card')} in one file${sources ? ', the last one Sources' : ''}${notes ? ' · notes under each card' : ' · no notes'}` };
  }
  const count = n + (sources ? 1 : 0);
  return { unit: 'slide', count, size: SLIDE_SIZE[format] || SLIDE_SIZE.pptx, line: `${plural(count, 'slide')}${sources ? ', the last one Sources' : ''} · speaker notes ${notes ? 'included' : 'empty'}` };
}

/** A 4:3 deck in a 16:9 slide file: said, never hidden. */
export function aspectNote(format, theme) {
  if (theme?.aspect !== '4:3') return null;
  if (format === 'pptx' || format === 'google_slides' || format === 'odp') return 'This deck is 4:3. The slides in this file are 16:9, with each area at its place on the 16:9 grid.';
  return null;
}

/**
 * What leaves Axal VC in this file, row by row: the cards, the speaker notes,
 * the Sources appendix and the hidden cards. `state` is `in` (in the file) or
 * `out` (stays in Axal VC).
 */
export function leavesOf(format, slides, cards, { notes, sources } = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const all = Array.isArray(slides) ? slides : list;
  const noted = notedCards(list).length;
  const hidden = Math.max(0, all.length - list.length);
  const rows = [{ key: 'cards', state: 'in', label: 'Cards', detail: `${plural(list.length, 'visible card')}, every area as the version holds it.` }];
  if (notes) {
    const where = format === 'pdf'
      ? `on ${plural(Math.ceil(list.length / NOTES_PER_PAGE), 'notes page')} after the cards, six cards a page`
      : format === 'html' ? 'under each card' : 'as each slide’s speaker notes';
    rows.push({ key: 'notes', state: 'in', label: 'Speaker notes', detail: `${noted ? `The notes of ${plural(noted, 'card')}` : 'No card has notes, so each says “No notes on this card.”'}${noted ? `, ${where}. A card without notes says “No notes on this card.”` : ''}` });
  } else {
    rows.push({ key: 'notes', state: 'out', label: 'Speaker notes', detail: format === 'pdf' || format === 'html' ? 'Not in the file. No notes pages.' : 'Not in the file. Every slide’s speaker notes are empty.' });
  }
  if (sources) {
    const lines = sourceLineCount(list);
    const ai = aiCardCount(list);
    const what = lines ? `${plural(lines, 'source line')}: each figure’s card, name, grade and date` : 'It says this version records no sources';
    const aiLine = (format === 'pdf' || format === 'html') && ai ? ` It also names the ${plural(ai, 'card')} written with AI help.` : '';
    rows.push({ key: 'sources', state: 'in', label: 'Sources appendix', detail: `The last ${format === 'pdf' ? 'page' : format === 'html' ? 'card' : 'slide'}. ${what}.${aiLine}` });
  } else {
    rows.push({ key: 'sources', state: 'out', label: 'Sources appendix', detail: 'Not in the file.' });
  }
  if (hidden) rows.push({ key: 'hidden', state: 'out', label: 'Hidden cards', detail: `${plural(hidden, 'hidden card')} ${hidden === 1 ? 'is' : 'are'} in no export.` });
  return rows;
}

/** A chart block's chart type, as the writer reads it (no type is a line). */
const chartType = (b) => String(b?.chart_type || 'line');
/**
 * Whether a chart may hold a point the writer can draw (`pptxChart.seriesPoints`):
 * a series with typed points is read from them alone; one without is its
 * binding's store, which only the export reads.
 */
const holdsPoints = (b) => (Array.isArray(b?.series) ? b.series : []).some((sr) => (Array.isArray(sr?.points)
  ? sr.points.some((p) => typeof p?.x === 'string' && typeof p?.y === 'number' && Number.isFinite(p.y))
  : Boolean(str(sr?.binding?.source_key))));
/** `diagramModel.sanitizeDiagram`'s test, enough to tell shapes from words: a known type with its minimum items. */
function isDiagram(d) {
  if (!d || typeof d !== 'object' || Number(d.v) !== 1 || !DIAGRAM_TYPES.includes(d.type)) return false;
  const items = (Array.isArray(d.items) ? d.items : []).filter((it) => str(it?.label));
  if (d.type === 'matrix') return items.length >= 4 && Boolean(str(d.axes?.x)) && Boolean(str(d.axes?.y));
  return items.length >= 2;
}
/** Whether `blockParagraphs` writes anything for a block (an empty text block draws nothing). */
function writesText(b) {
  switch (b?.kind) {
    case 'text': return Boolean(str(b.text));
    case 'metric': case 'video': case 'audio': case 'link': case 'graphic': return true;
    // `tableLines`: a table with no non-empty cell writes nothing.
    case 'table': return (Array.isArray(b.rows) ? b.rows : []).some((row) => (Array.isArray(row) ? row : []).some((c) => str(typeof c === 'object' && c ? String(c.text ?? c.value ?? '') : String(c ?? ''))));
    default: return false;
  }
}

/**
 * The editable file's table, from the version's own blocks: what goes in as
 * native, editable content and what falls back. Counts that depend on the
 * file's moment (a bound series' points, an image's bytes, the headless
 * browser) are said as the rule, and the completed panel reports what the
 * writer actually made.
 */
export function editabilityOf(format, cards, { sources = false } = {}) {
  if (!['pptx', 'google_slides', 'odp'].includes(format)) return null;
  const list = Array.isArray(cards) ? cards : [];
  const t = { text: 0, native: [], fallback: [], diagrams: 0, images: 0, frames: 0 };
  list.forEach((c, i) => {
    if (!fromBlocks(c)) { t.frames += 1; return; }
    for (const b of blocksOf(c)) {
      if (b.kind === 'image') { if (str(b.image_url)) t.images += 1; continue; }
      if (b.kind === 'chart') {
        if (format !== 'odp' && NATIVE_CHART_TYPES.includes(chartType(b)) && holdsPoints(b)) t.native.push(i + 1);
        else t.fallback.push(i + 1);
        continue;
      }
      if (b.kind === 'graphic' && isDiagram(b.diagram)) { t.diagrams += 1; continue; }
      if (writesText(b)) t.text += 1;
    }
  });
  const cardsOf = (ns) => [...new Set(ns)].join(', ');
  const rows = [
    { key: 'text', state: 'native', label: 'Text boxes', detail: `${plural(t.text, 'area')} as editable text at its place. Long text is set smaller to fit its box, down to ${Math.round(FIT_FLOOR * 100)}% of its size, and stays editable.` },
  ];
  if (format === 'odp') {
    if (t.fallback.length) rows.push({ key: 'charts', state: 'picture', label: 'Charts', detail: `${plural(t.fallback.length, 'chart')} (card ${cardsOf(t.fallback)}) as a picture when it can be taken, else its type and series as text. The .odp file has no native charts.` });
  } else {
    if (t.native.length) rows.push({ key: 'native', state: 'native', label: 'Native charts', detail: `${plural(t.native.length, 'chart')} (card ${cardsOf(t.native)}) as native charts with their numbers, when the points are recorded.` });
    if (t.fallback.length) rows.push({ key: 'fallback', state: 'picture', label: 'Charts as pictures', detail: `${plural(t.fallback.length, 'chart')} (card ${cardsOf(t.fallback)}) with no native chart: a picture of the chart, not editable, when it can be taken, else its type and series as text.` });
  }
  if (t.diagrams) rows.push({ key: 'diagrams', state: 'native', label: 'Diagrams', detail: `${plural(t.diagrams, 'diagram')} as native shapes with editable words.` });
  if (t.images) rows.push({ key: 'images', state: 'picture', label: 'Pictures', detail: `${plural(t.images, 'image')} as pictures with their crop. ${format === 'odp' ? 'One that cannot be fetched' : `One that is not ${PICTURE_KINDS}, or cannot be fetched,`} is a sentence in its place.` });
  const frames = t.frames + (sources ? 1 : 0);
  if (frames) rows.push({ key: 'frames', state: 'native', label: 'Text frames', detail: `${plural(frames, 'slide')} (${[t.frames ? plural(t.frames, 'card made of fields', 'cards made of fields') : null, sources ? 'the Sources appendix' : null].filter(Boolean).join(' and ')}) as stacked editable text.` });
  return rows;
}

// ── the acknowledgment and the finished export ──

/** Q4 (drawn as A): every export that includes notes some card holds asks for the acknowledgment. */
export const ackNeeded = (notes, cards) => Boolean(notes) && notedCards(cards).length > 0;
export const ackLabel = (cards) => `I understand the speaker notes of ${plural(notedCards(cards).length, 'card')} leave Axal VC in this file.`;

/** The writer's report (`X-Deck-Export-Report`, or Google Slides' `report`), as lines; null when none came back. */
export function reportLines(report) {
  if (!report || typeof report !== 'object') return null;
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const out = [];
  if (report.text && typeof report.text === 'object') {
    const shrunk = n(report.text.shrunk);
    const small = Number(report.text.smallest);
    out.push(`${plural(n(report.text.boxes), 'text box', 'text boxes')}${shrunk ? `, ${shrunk} set smaller to fit (the smallest at ${Math.round((Number.isFinite(small) ? small : FIT_FLOOR) * 100)}%)` : ''}`);
  }
  const c = report.charts || {};
  if (n(c.native)) out.push(plural(n(c.native), 'native chart'));
  if (n(c.pictured)) out.push(`${plural(n(c.pictured), 'chart')} as a picture`);
  if (n(c.as_text)) out.push(`${plural(n(c.as_text), 'chart')} as text`);
  if (Number.isInteger(report.diagrams) && report.diagrams) out.push(`${plural(report.diagrams, 'diagram')} as shapes`);
  const im = report.images || {};
  if (n(im.placed)) out.push(plural(n(im.placed), 'picture'));
  if (n(im.not_placed)) out.push(`${plural(n(im.not_placed), 'image')} not placed: a sentence in its place`);
  if (report.slides && n(report.slides.text_frames)) out.push(`${plural(n(report.slides.text_frames), 'slide')} as stacked text`);
  return out;
}

/** Parses the report header; anything that is not the writer's JSON is no report. */
export function parseReport(raw) {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  try { const r = JSON.parse(raw); return r && typeof r === 'object' && !Array.isArray(r) ? r : null; } catch { return null; }
}

/** A file's fingerprint, as the panel shows it: the first 12 hex characters; the whole one is its title. */
export const shortHash = (h) => (typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? h.slice(0, 12) : null);

/** The completed export, said: the frozen version, the format, the copy and both settings. */
export function completedLines({ format, version, notes, sources }) {
  return {
    what: `${formatLabel(format)} of ${versionLabel(version)} · ${COPY_LABEL[presetOf(notes, sources)]}`,
    settings: `Speaker notes ${notes ? 'included' : 'not included'} · Sources appendix ${sources ? 'included' : 'not included'}`,
  };
}

export const RECOVER_LINE = (v) => `This file is not kept in Axal VC. To get it again after you close this, export ${versionLabel(v)} again with the same settings; that is recorded as a new export.`;

/** A ledger row's settings: what it carried, or "Not recorded" for a row from before they were recorded. */
export function ledgerSettings(row) {
  if (!row) return null;
  if (row.notes == null || row.sources == null) return 'Notes and appendix Not recorded';
  const copy = COPY_LABEL[row.copy] || COPY_LABEL[presetOf(row.notes, row.sources)];
  return `${copy} · notes ${row.notes ? 'included' : 'not included'} · appendix ${row.sources ? 'included' : 'not included'}`;
}

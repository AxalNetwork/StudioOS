/**
 * D901 (#2680) — Pitch deck studio part 7: present mode (PD16, PD26 frame 2)
 * and the export dialog (PD17, PD25), kept pure so the tests read them
 * without a browser.
 *
 * WHAT IS READ. Present reads one version, `GET /api/decks/:id` (a version is
 * a `pitch_decks` row, so the deck id names it). Export writes through
 * `POST /api/decks/:id/export` (PDF, PowerPoint) and
 * `POST /api/decks/:id/export/html`, and reads the ledger,
 * `GET /api/decks/:id/exports`. Nothing here is a sample.
 *
 * Speaker notes are each card's `notes` (D898's slide model, #2676); a card
 * with none says so. They leave the venture only in an export the founder
 * asks to carry them, never in a share link. "Show sources" draws each
 * figure's binding (D896's, written on every figure New deck fills, D897):
 * its area, grade and the day it was read (D1111). A figure with no binding,
 * or bound to a slot nothing filled, says its source is not recorded. D1112
 * (#2992): a card laid out on D898's grid is drawn from its blocks, in Present
 * and in every export, and the two options apply to every format. WHAT IS
 * NOT THERE YET. Google Slides is part 10: its option is drawn, unavailable,
 * with the reason.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { STUDIO_PATH, dayLabel, ventureQuery, versionLabel } from './pitchStudioModel.js';

export const PRESENT_PATH = '/raise/pitch/present';

/** The present address: the venture, and the version to show. */
export function presentHref(projectId, deckId) {
  const q = new URLSearchParams(ventureQuery(projectId).slice(1));
  if (deckId) q.set('deck', String(deckId));
  const s = q.toString();
  return `${PRESENT_PATH}${s ? `?${s}` : ''}`;
}

/** Where Esc goes: back to the studio, the venture kept. */
export const exitHref = (projectId) => `${STUDIO_PATH}${ventureQuery(projectId)}`;

export const ESC_TO_EXIT = 'Esc to exit';
export const NO_NOTES = 'No notes on this card.';
export const SHOW_SOURCES = 'Show sources';
export const SOURCE_NOT_RECORDED = `Source: ${NOT_RECORDED}`;
export const SOURCE_NOT_ON_STUDIOOS = 'Source: Not recorded on StudioOS';
export const EMPTY_CARD = 'Nothing on this card yet.';
export const NO_CARDS = 'This version has no cards to present.';
export const READ_FAILED = 'This version could not be read.';
export const NO_VERSION = 'No deck yet. Start from your records.';
export const PRESENTER = 'Presenter view';
export const AUDIENCE = 'Audience view';

const pad2 = (n) => String(n).padStart(2, '0');
const str = (v) => String(v ?? '').trim();

const AREAS = { validate: 'Validate', build: 'Build', raise: 'Raise', grow: 'Grow', team: 'Team', scoring: 'Scoring' };
const GRADED = new Set(['Measured', 'Reviewed', 'Sourced', 'Stated']);

/**
 * The line under a figure in "Show sources": its binding's area, grade and
 * day (D896's `source_key`, `grade`, `as_of`). Bound to a slot nothing filled,
 * "Not recorded on StudioOS"; no binding at all, null.
 */
export function sourceOf(binding) {
  if (!binding || typeof binding !== 'object' || !str(binding.source_key)) return null;
  const grade = GRADED.has(binding.grade) ? binding.grade : null;
  if (!grade) return SOURCE_NOT_ON_STUDIOOS;
  const area = AREAS[str(binding.source_key).split('.')[0]] || 'StudioOS';
  const day = binding.as_of ? dayLabel(binding.as_of) : null;
  return `Source: ${area} · ${grade}${day && day !== 'Date not recorded' ? ` · ${day}` : ''}`;
}

/**
 * One card as present mode draws it, from the version's slide JSON and
 * nothing else. A field the template left unfilled reads "Not recorded";
 * an empty figure is "Not recorded", never 0.
 */
export function cardOf(slide, i) {
  const s = slide && typeof slide === 'object' ? slide : {};
  const card = {
    n: pad2(i + 1),
    title: str(s.title) || `Card ${i + 1}`,
    sub: str(s.subtitle),
    lines: [],
    bullets: [],
    figures: [],
    image: typeof s.image_url === 'string' && /^https:\/\//.test(s.image_url) ? s.image_url : null,
    notes: str(s.notes) || null,
    appendix: Boolean(s.appendix),
  };
  if (Array.isArray(s.fields) && s.fields.length) {
    for (const f of s.fields) {
      const unfilled = f?.source === 'placeholder';
      if (f?.kind === 'title') continue;
      if (f?.kind === 'subtitle') { if (!unfilled && str(f.value)) card.sub = str(f.value); continue; }
      if (f?.kind === 'image') { if (!unfilled && /^https:\/\//.test(str(f.value))) card.image = card.image || str(f.value); continue; }
      if (f?.kind === 'bullets') {
        const items = Array.isArray(f.value) ? f.value.map(str).filter(Boolean) : [];
        if (unfilled || !items.length) card.lines.push(`${str(f.label) || 'List'}: ${NOT_RECORDED}`);
        else card.bullets.push(...items);
        continue;
      }
      if (f?.kind === 'metric_grid') {
        const cells = Array.isArray(f.value) ? f.value : [];
        for (const c of cells) card.figures.push({ k: str(c?.label), v: unfilled || !str(c?.value) ? NOT_RECORDED : str(c.value), source: sourceOf(c?.binding || f.binding) });
        if (!cells.length) card.lines.push(`${str(f.label) || 'Figures'}: ${NOT_RECORDED}`);
        continue;
      }
      if (f?.binding?.source_key) {
        // A figure New deck filled (D897): a read-only field, "<label> · <value>".
        const label = str(f.label);
        const value = str(f.value);
        const v = unfilled || !value ? NOT_RECORDED : label && value.startsWith(`${label} · `) ? value.slice(label.length + 3) : value;
        card.figures.push({ k: label || 'Figure', v, source: sourceOf(f.binding), key: str(f.binding.source_key) });
        continue;
      }
      if (unfilled) { card.lines.push(`${str(f?.label) || 'Text'}: ${NOT_RECORDED}`); continue; }
      if (str(f?.value)) card.lines.push(str(f.value));
    }
  } else {
    if (str(s.body)) card.lines.push(str(s.body));
    if (Array.isArray(s.bullets)) card.bullets.push(...s.bullets.map(str).filter(Boolean));
  }
  // A bound metric block the fields do not already show: one the founder placed in the editor.
  const shown = new Set(card.figures.map((f) => f.key).filter(Boolean));
  for (const b of Array.isArray(s.blocks) ? s.blocks : []) {
    const key = str(b?.binding?.source_key);
    if (b?.kind !== 'metric' || !key || shown.has(key)) continue;
    shown.add(key);
    card.figures.push({ k: str(b.label) || 'Figure', v: str(b.value) || NOT_RECORDED, source: sourceOf(b.binding), key });
  }
  card.blocks = gridBlocks(s);
  card.empty = !card.blocks.length && !card.sub && !card.lines.length && !card.bullets.length && !card.figures.length && !card.image;
  return card;
}

export const cardsOf = (deck) => (Array.isArray(deck?.slides) ? deck.slides.map(cardOf) : []);

/**
 * D1112 (#2992): the blocks a card lays out on D898's 12 × 6 grid, those with
 * a whole range on it. A card with any is drawn from them, as the editor
 * draws it; a card with none is drawn from its fields.
 */
export function gridBlocks(card) {
  const ok = (n) => Number.isInteger(n);
  return (Array.isArray(card?.blocks) ? card.blocks : [])
    .filter((b) => b && b.grid && ok(b.grid.c1) && ok(b.grid.c2) && ok(b.grid.r1) && ok(b.grid.r2));
}

/** "Ranked bars": a chart type as the editor's library names it. */
export function chartLabel(t) {
  const v = str(t).replace(/_/g, ' ');
  return v ? `${v.charAt(0).toUpperCase()}${v.slice(1)}` : 'Chart';
}

/** What a key does in present mode: the canvas's arrows and Esc, plus Page keys, Space, Home and End. */
export function stepFor(key) {
  switch (key) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': return 'next';
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp': return 'prev';
    case 'Home': return 'first';
    case 'End': return 'last';
    case 'Escape': return 'exit';
    default: return null;
  }
}

/** The card a step lands on, never before the first or after the last. */
export function moveTo(i, step, n) {
  if (!n) return 0;
  const at = Math.max(0, Math.min(n - 1, Number(i) || 0));
  if (step === 'next') return Math.min(n - 1, at + 1);
  if (step === 'prev') return Math.max(0, at - 1);
  if (step === 'first') return 0;
  if (step === 'last') return n - 1;
  return at;
}

/** A swipe, from where the touch started to where it ended: 40 px or more across, more across than down. */
export function swipeStep(dx, dy) {
  if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? 'next' : 'prev';
}

/** The presenter's timer, as the canvas draws it: 00:04:12. */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

export const countLabel = (i, n) => `${i + 1} / ${n}`;
export const swipeLine = (i, n) => `Swipe for the next card · ${i + 1} of ${n}`;
export const dotsOf = (i, n) => Array.from({ length: n }, (_, k) => ({ k, on: k === i }));
export const notesOf = (card) => card?.notes || NO_NOTES;

// ── export (PD17, PD25) ──

export const EXPORT_TITLE = (v) => `Export ${versionLabel(v)}`;

export const FORMATS = [
  { id: 'pdf', label: 'PDF', line: 'Every card, as it prints', available: true },
  { id: 'pptx', label: 'PowerPoint', line: 'One picture per card', available: true },
  // D904 (#2683): a new, editable presentation in the member's own Drive.
  { id: 'google_slides', label: 'Google Slides', line: 'Created in your Drive, editable', available: true },
  { id: 'html', label: 'HTML', line: 'One file, offline', available: true },
];

const LABEL = Object.fromEntries(FORMATS.map((f) => [f.id, f.label]));
export const formatLabel = (id) => LABEL[id] || NOT_RECORDED;

export const exportButton = (format) => `Export ${formatLabel(format)}`;

/**
 * D1112 (#2992): the two options apply to every format the dialog offers. The
 * PDF puts the notes on a page after the cards and the Sources appendix last;
 * PowerPoint puts each card's notes in its speaker notes and the appendix on
 * a last slide; the HTML file under each card and at the end.
 */
export const optionsApply = (format) => FORMATS.some((f) => f.id === format && f.available);
export const OPTIONS_WHERE = {
  pdf: 'In the PDF, the notes are a page after the cards, and the Sources appendix is the last page.',
  pptx: 'In PowerPoint, each card\'s notes are its speaker notes, and the Sources appendix is the last slide.',
  html: 'In the HTML file, the notes sit under each card, and the Sources appendix is the last card.',
  google_slides: 'In Google Slides, each card\'s notes are its speaker notes, and the Sources appendix is the last slide.',
};

/** What the write changes, said before it happens. */
export const whatExportDoes = (v, format) => (format === 'google_slides'
  ? `This creates a new presentation of ${versionLabel(v)} in your Google Drive and records the export in this venture's history. Axal VC creates only this file and changes nothing else in your Drive. Nothing is shared.`
  : `This makes a file of ${versionLabel(v)} and records the export in this venture's history: the format, the version and the file's fingerprint. Nothing is shared.`);

// ── Google Slides (PD17's Google states, D904) ──

/** Before Google is connected (or its files allowed): what to do, and what Axal VC will and will not touch. */
export const GOOGLE_CONNECT = 'Connect Google to create this presentation in your Drive. Axal VC creates only the file you export.';
export const GOOGLE_CONNECT_HREF = '/account/connectors/google_workspace';
export const GOOGLE_CONNECT_LINK = 'Connect Google ›';
export const GOOGLE_STATE_UNREADABLE = 'Your Google connection could not be read just now. You can still try; Google answers if it is not connected.';
/** D1091's connection read (`googleWorkspace.mine()`): ready, not yet, or unreadable. */
export function googleState(mine) {
  if (!mine) return 'unreadable';
  return mine.state === 'ready' ? 'ready' : 'connect';
}
export const OPEN_LINK = 'Open ›';
/** After the export: where the presentation is. A file Google kept as PowerPoint is never called a Slides deck. */
export const googleCreatedLine = (converted) => (converted === false
  ? 'Created in your Drive as a PowerPoint file: Google did not turn it into Slides.'
  : 'Created in Google Slides');
/** Only Google's own addresses open from the dialog. */
export function googleOpenHref(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && ['docs.google.com', 'drive.google.com'].includes(u.hostname) ? u.href : null;
  } catch { return null; }
}
/** Charts the print page could not picture went in as text; said, never hidden. */
export function chartsAsTextLine(charts) {
  const n = Number(charts?.as_text) || 0;
  if (!n) return null;
  return n === 1 ? 'One chart went in as text: its type and series, as the HTML file writes it.' : `${n} charts went in as text: their type and series, as the HTML file writes them.`;
}
const GOOGLE_REFUSED = {
  google_not_connected: GOOGLE_CONNECT,
  workspace_not_allowed: GOOGLE_CONNECT,
  company_not_enabled: 'Google files are not switched on for this venture\'s company. Allow them on the Google page, then export again. Nothing was created.',
  project_not_available: 'You cannot export this venture\'s deck to Google. Nothing was created.',
  support_session_refused: 'A support session cannot create files in a member\'s Google Drive. Nothing was created.',
  presentation_too_large: 'The presentation is over 5 MB, the most Google takes in one upload. Download the PowerPoint instead. Nothing was created.',
  google_rate_limited: 'Google is busy just now. Try again in a minute. Nothing was created.',
  google_not_created: 'Google did not create the presentation. Try again in a moment. Nothing was shared.',
};
/** A refusal that means "connect first": the dialog shows the connect link with it. */
export const needsConnect = (body) => ['google_not_connected', 'workspace_not_allowed', 'company_not_enabled'].includes(body?.error);
export const NOT_RECORDED_CREATED = 'The presentation was created in your Drive, but the export could not be recorded here. Nothing was shared.';

export const NOTHING_SHARED = 'Try again in a moment. Nothing was shared.';
const PRODUCED = { pdf: 'The PDF could not be produced.', pptx: 'The PowerPoint file could not be produced.', html: 'The HTML file could not be produced.', google_slides: 'The presentation could not be created.' };

/** The sentence a failed export shows (PD25); the Worker's own sentence when it could not record the export. */
export function exportFailure(format, status, body) {
  if (body?.error === 'export_not_recorded' && str(body.message)) return str(body.message);
  if (format === 'google_slides') {
    if (body?.error === 'export_not_recorded_created') return NOT_RECORDED_CREATED;
    if (GOOGLE_REFUSED[body?.error]) return GOOGLE_REFUSED[body.error];
  }
  return `${PRODUCED[format] || 'The file could not be produced.'} ${NOTHING_SHARED}`;
}

export function exportFileName(title, version, format) {
  const ext = format === 'pptx' ? 'pptx' : format === 'html' ? 'html' : 'pdf';
  const base = (str(title) || 'pitch-deck').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80);
  return `${base}${version == null ? '' : `-v${version}`}.${ext}`;
}

export const NO_EXPORT_YET = 'No export recorded yet.';

/** The ledger's newest row, as one line. */
export function lastExportLine(rows) {
  const r = Array.isArray(rows) ? rows[0] : null;
  if (!r) return NO_EXPORT_YET;
  const by = str(r.by) ? ` · by ${str(r.by)}` : '';
  return `Last exported ${dayLabel(r.created_at)} · ${formatLabel(r.format)} · ${versionLabel(r)}${by}`;
}

export const exportedLine = (format, v) => `Exported ${formatLabel(format)} of ${versionLabel(v)}. The export is recorded.`;

/** D903 (#2682): a placed image's crop as a CSS object-position, from the point it keeps in view. */
export const objectPosition = (crop) => (crop && Number.isFinite(crop.x) && Number.isFinite(crop.y) ? `${crop.x}% ${crop.y}%` : '50% 50%');

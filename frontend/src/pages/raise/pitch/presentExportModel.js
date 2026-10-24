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
 * asks to carry them, never in a share link. WHAT IS NOT THERE YET. No card records its
 * source yet (part 2), so "Show sources" says that on each card. Google
 * Slides is part 10: its option is drawn, unavailable, with the reason.
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
export const EMPTY_CARD = 'Nothing on this card yet.';
export const NO_CARDS = 'This version has no cards to present.';
export const READ_FAILED = 'This version could not be read.';
export const NO_VERSION = 'No deck yet. Start from your records.';
export const PRESENTER = 'Presenter view';
export const AUDIENCE = 'Audience view';

const pad2 = (n) => String(n).padStart(2, '0');
const str = (v) => String(v ?? '').trim();

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
        for (const c of cells) card.figures.push({ k: str(c?.label), v: unfilled || !str(c?.value) ? NOT_RECORDED : str(c.value) });
        if (!cells.length) card.lines.push(`${str(f.label) || 'Figures'}: ${NOT_RECORDED}`);
        continue;
      }
      if (unfilled) { card.lines.push(`${str(f?.label) || 'Text'}: ${NOT_RECORDED}`); continue; }
      if (str(f?.value)) card.lines.push(str(f.value));
    }
  } else {
    if (str(s.body)) card.lines.push(str(s.body));
    if (Array.isArray(s.bullets)) card.bullets.push(...s.bullets.map(str).filter(Boolean));
  }
  card.empty = !card.sub && !card.lines.length && !card.bullets.length && !card.figures.length && !card.image;
  return card;
}

export const cardsOf = (deck) => (Array.isArray(deck?.slides) ? deck.slides.map(cardOf) : []);

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
  {
    id: 'google_slides', label: 'Google Slides', line: 'Created in your Drive', available: false,
    reason: 'Not available yet: creating the presentation in your Drive comes with a later part of the studio.',
  },
  { id: 'html', label: 'HTML', line: 'One file, offline', available: true },
];

const LABEL = Object.fromEntries(FORMATS.map((f) => [f.id, f.label]));
export const formatLabel = (id) => LABEL[id] || NOT_RECORDED;

export const exportButton = (format) => `Export ${formatLabel(format)}`;

/** The options apply to the HTML file; the PDF and PowerPoint routes carry the cards only, for now. */
export const optionsApply = (format) => format === 'html';
export const OPTIONS_HTML_ONLY = 'Speaker notes and the Sources appendix go in the HTML file for now. The PDF and PowerPoint files carry the cards.';

/** What the write changes, said before it happens. */
export const whatExportDoes = (v) =>
  `This makes a file of ${versionLabel(v)} and records the export in this venture's history: the format, the version and the file's fingerprint. Nothing is shared.`;

export const NOTHING_SHARED = 'Try again in a moment. Nothing was shared.';
const PRODUCED = { pdf: 'The PDF could not be produced.', pptx: 'The PowerPoint file could not be produced.', html: 'The HTML file could not be produced.' };

/** The sentence a failed export shows (PD25); the Worker's own sentence when it could not record the export. */
export function exportFailure(format, status, body) {
  if (body?.error === 'export_not_recorded' && str(body.message)) return str(body.message);
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

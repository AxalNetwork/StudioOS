/**
 * D1563 (#3810, deck v2 D2) — the words and rules of pd1's "Import a
 * document". Pure: no React, no network.
 *
 *   DOCUMENT_*        the sheet's title, drop, paste and progress lines
 *   documentProblem   why a chosen file cannot be sent, or null
 *   pasteProblem      why a paste cannot be sent, or null
 *   importedLine      what the import made: an outline's or a deck's count line
 *
 * The Worker's checks (`routes/deck_imports.ts`) are the rule; these only say
 * so first. A count the answer does not hold is left out, never shown as 0.
 */

export const DOCUMENT_TITLE = 'Import a document';
export const DOCUMENT_DROP = 'Word (.docx) or PDF up to 20 MB, or a PowerPoint deck (.pptx) up to 50 MB';
export const DOCUMENT_PRIVACY = 'Your document’s words become the outline or the cards. Figures still come from your records.';
export const DOCUMENT_PASTE = 'Or paste the text';
export const DOCUMENT_READING = 'Reading your document…';
export const DOCUMENT_SEND = 'Import';
export const PASTE_MAX = 40000;
const DOC_MAX = 20 * 1024 * 1024;
const PPTX_MAX = 50 * 1024 * 1024;
const KINDS = [['.docx', DOC_MAX], ['.pdf', DOC_MAX], ['.pptx', PPTX_MAX]];

/** Whether a chosen file can be sent; otherwise the sentence why not. */
export function documentProblem(file) {
  if (!file) return 'Choose a document to import.';
  const name = String(file.name || '').toLowerCase();
  const kind = KINDS.find(([ext]) => name.endsWith(ext));
  if (!kind) return 'Import a Word document (.docx), a PDF or a PowerPoint deck (.pptx).';
  if (Number(file.size) > kind[1]) return kind[0] === '.pptx' ? 'A .pptx deck can be up to 50 MB.' : 'A document can be up to 20 MB.';
  return null;
}

/** Whether a paste can be sent; otherwise the sentence why not. */
export function pasteProblem(text) {
  const t = typeof text === 'string' ? text : '';
  if (!t.trim()) return 'Paste the text of your document.';
  if (t.length > PASTE_MAX) return 'A paste can be up to 40,000 characters. Import the file instead.';
  return null;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const whole = (n) => Number.isInteger(n) && n >= 0;

/** What the import made, in one line; null when the answer holds no count to say. */
export function importedLine(answer) {
  const c = answer?.counts;
  if (!c) return null;
  if (answer.kind === 'cards') {
    if (!whole(c.cards)) return null;
    const parts = [`${plural(c.cards, 'slide', 'slides')} imported as editable cards`];
    if (typeof c.placed_share === 'number') parts.push(`${Math.floor(c.placed_share * 100)}% of the text placed on the grid`); // floor: never “100%” while words were left out
    if (whole(c.not_placed) && c.not_placed > 0) parts.push(`${plural(c.not_placed, 'box', 'boxes')} moved to the notes`);
    return parts.join(' · ');
  }
  const rows = Array.isArray(answer?.outline?.rows) ? answer.outline.rows.length : null;
  if (!whole(rows)) return null;
  const parts = [`An outline of ${plural(rows, 'card', 'cards')}`];
  if (whole(c.matched)) parts.push(`${plural(c.matched, 'section', 'sections')} of your document placed`);
  if (whole(c.figures_left_out) && c.figures_left_out > 0) parts.push(`${plural(c.figures_left_out, 'line', 'lines')} with figures left out`);
  return parts.join(' · ');
}

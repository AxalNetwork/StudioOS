/**
 * D696: one letter page; only personaViewModel's allowlisted segment content.
 * Fixed row budgets and measured ellipses keep even an unbroken word in bounds.
 */
import { board, BOARD } from './pdfBoard.js';
import { personaModel, personaFilename } from './personaViewModel.js';

const INK = '#241d35';
const MUTED = '#6b6577';
const VIOLET = '#6d28d9';
const EDGE = '#ececf1';

/** Fit at most N measured lines. The last line signals clipped content. */
function fitLines(b, value, width, count, options) {
  let rest = String(value ?? '');
  const result = [];
  for (let row = 0; rest && row < count; row += 1) {
    if (b.width(rest, options) <= width) { result.push(rest); rest = ''; break; }
    const suffix = row === count - 1 ? '…' : '';
    let low = 0; let high = rest.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (b.width(rest.slice(0, mid) + suffix, options) <= width) low = mid;
      else high = mid - 1;
    }
    let end = low;
    if (!suffix) {
      const space = rest.lastIndexOf(' ', low);
      if (space > low / 2) end = space;
    }
    result.push(rest.slice(0, end).trimEnd() + suffix);
    rest = rest.slice(Math.max(1, end)).trimStart();
  }
  return result;
}

export function renderPersona(doc, model) {
  const b = board(doc);
  const write = (value, x, y, width, count = 1, options = {}) => {
    const opts = { size: 12, color: INK, ...options };
    fitLines(b, value, width, count, opts).forEach((line, index) => b.text(line, x, y + index * opts.size * 1.25, opts));
  };
  b.rect(0, 0, BOARD.w, BOARD.h, '#ffffff');
  write('AXAL VC · PERSONA', 40, 32, 500, 1, { size: 10, style: 'bold', color: VIOLET });
  write(model.date, 636, 32, 140, 1, { size: 10, color: MUTED });
  write(model.title, 40, 64, 736, 2, { size: 26, style: 'bold' });
  write(model.sub, 40, 136, 736, 2, { size: 12, color: MUTED });
  b.hline(40, 776, 186, EDGE);

  model.facts.forEach((fact, index) => {
    const x = 40 + (index % 2) * 374; const y = 202 + Math.floor(index / 2) * 96;
    b.rrect(x, y, 362, 86, 10, { fill: '#faf9fc', stroke: EDGE });
    write(fact.label, x + 12, y + 10, 338, 1, { size: 10, style: 'bold', color: MUTED });
    write(fact.value, x + 12, y + 29, 338, 2, { size: 14, style: 'bold' });
    write(fact.reason, x + 12, y + 65, 338, 1, { size: 10, color: MUTED });
  });

  write('Five steps', 40, 412, 736, 1, { size: 16, style: 'bold' });
  if (!model.steps.rows.length) write('Nothing recorded here yet.', 40, 444, 736, 1, { color: MUTED });
  model.steps.rows.forEach((row, index) => {
    const y = 444 + index * 56;
    write(row.label, 40, y, 190, 2, { size: 11, style: 'bold' });
    write(row.value, 246, y, 530, 3, { size: 12 });
    b.hline(40, 776, y + 49, EDGE);
  });
  if (model.steps.omitted) write('… ' + model.steps.omitted + ' more steps', 40, 728, 736, 1, { size: 10, color: MUTED });

  write('Pain themes', 40, 758, 736, 1, { size: 16, style: 'bold' });
  if (!model.themes.rows.length) write('Nothing recorded here yet.', 40, 790, 736, 1, { color: MUTED });
  model.themes.rows.forEach((row, index) => {
    const x = 40 + (index % 2) * 374; const y = 790 + Math.floor(index / 2) * 44;
    write(row.label, x, y, 350, 1, { size: 11, style: 'bold' });
    write(row.value, x, y + 16, 350, 1, { size: 11, color: MUTED });
  });
  if (model.themes.omitted) write('… ' + model.themes.omitted + ' more themes', 40, 974, 736, 1, { size: 10, color: MUTED });
  b.hline(40, 776, 1000, EDGE);
  write('Axal VC StudioOS · Persona', 40, 1012, 736, 1, { size: 10, color: MUTED });
}

/** Browser download; jsPDF stays out of the initial record bundle. */
export async function exportPersonaPdf(record, { generatedAt } = {}) {
  const model = personaModel(record, { generatedAt });
  const jspdfMod = await import('jspdf');
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default;
  const doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
  doc.setProperties({ title: 'Persona', subject: 'Segment persona', author: 'Axal VC', creator: 'Axal VC StudioOS' });
  renderPersona(doc, model);
  const filename = personaFilename(model);
  doc.save(filename);
  return { filename };
}

/**
 * D693 (#1704, decision 11): the decision memo as one letter page, drawn in
 * the browser on `pdfBoard.js` from `decisionMemoViewModel.js`. There is no
 * Worker PDF route. Fixed row budgets and measured lines keep every string
 * inside the page; a list the page cannot hold ends with the model's
 * "<n> more in StudioOS".
 */
import { board, BOARD } from './pdfBoard.js';
import { decisionMemoModel, decisionMemoFilename } from './decisionMemoViewModel.js';

const INK = '#241d35';
const MUTED = '#6b6577';
const VIOLET = '#6d28d9';
const EDGE = '#ececf1';
const OK = '#047857';
const BAD = '#b91c1c';

/** At most `count` measured lines; the last ends with an ellipsis when the text runs on. */
function fitLines(b, value, width, count, options) {
  let rest = String(value ?? '');
  const out = [];
  for (let row = 0; rest && row < count; row += 1) {
    if (b.width(rest, options) <= width) { out.push(rest); break; }
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
    out.push(rest.slice(0, end).trimEnd() + suffix);
    rest = rest.slice(Math.max(1, end)).trimStart();
  }
  return out;
}

export function renderDecisionMemo(doc, model) {
  const b = board(doc);
  const write = (value, x, y, width, count = 1, options = {}) => {
    const opts = { size: 12, color: INK, ...options };
    fitLines(b, value, width, count, opts).forEach((text, i) => b.text(text, x, y + i * opts.size * 1.25, opts));
  };
  b.rect(0, 0, BOARD.w, BOARD.h, '#ffffff');
  write('AXAL VC · DECISION MEMO', 40, 32, 500, 1, { size: 10, style: 'bold', color: VIOLET });
  write(model.date, 636, 32, 140, 1, { size: 10, color: MUTED });
  write(model.venture, 40, 56, 736, 1, { size: 12, style: 'bold', color: MUTED });
  write(model.title, 40, 78, 736, 2, { size: 24, style: 'bold' });
  write(model.sub, 40, 142, 736, 1, { size: 12, color: MUTED });
  if (model.withheld) write(model.withheld, 40, 162, 736, 1, { size: 12, style: 'bold', color: BAD });
  b.hline(40, 776, 186, EDGE);

  const facts = [
    { label: 'Decision', value: [model.decision, model.status].filter(Boolean).join(' · ') },
    { label: 'For', value: model.scope },
    { label: 'Supersedes', value: model.supersedes, reason: model.supersedesReason },
  ];
  facts.forEach((fact, i) => {
    const x = 40 + i * 248;
    b.rrect(x, 200, 240, 70, 10, { fill: '#faf9fc', stroke: EDGE });
    write(fact.label, x + 12, 210, 216, 1, { size: 10, style: 'bold', color: MUTED });
    write(fact.value, x + 12, 228, 216, 1, { size: 13, style: 'bold' });
    write(fact.reason, x + 12, 250, 216, 1, { size: 9, color: MUTED });
  });

  write('Reasoning', 40, 290, 736, 1, { size: 15, style: 'bold' });
  write(model.reasoning, 40, 314, 736, 5, { size: 12 });

  write('Evidence it rests on', 40, 410, 736, 1, { size: 15, style: 'bold' });
  if (model.evidence.empty) write(model.evidence.empty, 40, 438, 736, 1, { color: MUTED });
  model.evidence.rows.forEach((row, i) => {
    const y = 438 + i * 36;
    write(row.label, 40, y, 470, 1, { size: 11, style: 'bold' });
    write(row.meta, 40, y + 16, 470, 1, { size: 10, color: MUTED });
    write(row.direction, 680, y, 96, 1, { size: 11, style: 'bold', color: row.direction === 'Contradicts' ? BAD : OK });
    b.hline(40, 776, y + 32, EDGE);
  });
  if (model.evidence.more) write(model.evidence.more, 40, 728, 736, 1, { size: 10, color: MUTED });

  write('Commitments it created', 40, 756, 736, 1, { size: 15, style: 'bold' });
  if (model.commitments.empty) write(model.commitments.empty, 40, 784, 736, 1, { color: MUTED });
  model.commitments.rows.forEach((row, i) => {
    const y = 784 + i * 30;
    write(row.label, 40, y, 520, 1, { size: 11 });
    write(row.meta, 576, y, 200, 1, { size: 10, color: MUTED });
  });
  if (model.commitments.more) write(model.commitments.more, 40, 966, 736, 1, { size: 10, color: MUTED });
  b.hline(40, 776, 1000, EDGE);
  write('Axal VC StudioOS · Verdict', 40, 1012, 736, 1, { size: 10, color: MUTED });
}

/** Browser download; jsPDF stays out of the initial record bundle. */
export async function exportDecisionMemoPdf(record, { venture, generatedAt } = {}) {
  const model = decisionMemoModel(record, { venture, generatedAt });
  const jspdfMod = await import('jspdf');
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default;
  const doc = new JsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
  doc.setProperties({ title: 'Decision memo', subject: 'Verdict decision', author: 'Axal VC', creator: 'Axal VC StudioOS' });
  renderDecisionMemo(doc, model);
  const filename = decisionMemoFilename(model);
  doc.save(filename);
  return { filename };
}

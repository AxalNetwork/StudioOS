/**
 * D711 (#1776) — a legal body as typed blocks: one body per rule of step 4.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { paperBlocks, paperText, runsText, type Block } from '../src/services/legalPaperBlocks.ts';

const kinds = (bs: Block[]) => bs.map((b) => b.t);
const one = <T extends Block['t']>(bs: Block[], t: T) => bs.find((b) => b.t === t) as Extract<Block, { t: T }>;

test('D711 headings: # is a title unless it repeats the document title, ## an article, ### a section', () => {
  const bs = paperBlocks('# Mutual NDA\n# Part One\n## Article 1 Definitions\n### Notes', { title: 'Mutual NDA' });
  assert.deepEqual(kinds(bs), ['title', 'article', 'section']);
  assert.equal(runsText(one(bs, 'title').runs), 'Part One');
  assert.deepEqual([one(bs, 'article').id, one(bs, 'article').text], ['art-1', 'Article 1 Definitions']);
});

test('D711 a Recitals heading and its WHEREAS paragraphs are recitals; a schedule title takes its "As of" dateline', () => {
  const bs = paperBlocks('## Recitals\nWHEREAS the parties met.\nWHEREAS they agree.\n## Schedule A — Fees\nAs of January 1, 2026\nThe fees.');
  assert.deepEqual(kinds(bs), ['recitals', 'recital', 'recital', 'schedule', 'para']);
  assert.equal(runsText(one(bs, 'schedule').dateline!), 'As of January 1, 2026');
  assert.deepEqual(kinds(paperBlocks('## Exhibit B\nAs of today')), ['schedule']);
});

test('D711 "1.1" and "(a)" are numbers with a hanging indent, one step deeper for (a); a ### over a paragraph is its run-in heading', () => {
  const bs = paperBlocks('### Confidentiality\n1.1 Each party keeps secrets.\n(a) including this one.\n2. Term.');
  const paras = bs.filter((b) => b.t === 'para') as Extract<Block, { t: 'para' }>[];
  assert.deepEqual(paras.map((p) => [p.num, p.depth]), [['1.1', 1], ['(a)', 2], ['2.', 1]]);
  assert.equal(runsText(paras[0].runIn!), 'Confidentiality');
  assert.equal(paras[1].runIn, null);
  assert.equal(kinds(bs).includes('section'), false, 'the run-in heading is not also a section');
});

test('D711 a defined term is bold; bold and oblique are runs; "Section 4.2" stays plain text', () => {
  const p = one(paperBlocks('The Fund (the "Fund") and Axal (“Axal”) agree **firmly**, *so*, per Section 4.2.'), 'para');
  const terms = p.runs.filter((r) => r.k === 'term').map((r) => (r as any).text);
  assert.deepEqual(terms, ['"Fund"', '“Axal”']);
  assert.ok(p.runs.some((r) => r.k === 'bold' && r.text === 'firmly'));
  assert.ok(p.runs.some((r) => r.k === 'em' && r.text === 'so'));
  assert.ok(p.runs.some((r) => r.k === 'text' && r.text.includes('per Section 4.2.')));
});

test('D711 a table keeps per-column alignment, right-aligns an all-figures column in mono, and marks a "Total" last row', () => {
  const t = one(paperBlocks('| Item | Note | Amount | Pct |\n| :--- | :---: | --- | ---: |\n| Fees | n/a | $1,000 | 5% |\n| Costs | — | (250.00) | 2% |\n| Total | | $750 | 7% |'), 'table');
  assert.deepEqual(t.align, ['left', 'center', 'right', 'right']);
  assert.deepEqual(t.mono, [false, false, true, false]);
  assert.equal(t.total, true);
  assert.equal(t.rows.length, 3);
  const words = one(paperBlocks('| A | B |\n| --- | --- |\n| x | y |'), 'table');
  assert.deepEqual([words.align, words.total], [['left', 'left'], false]);
});

test('D711 a blockquote is a legend and "Warning: …" a warning; [x] and ✓ are checked boxes; ____ is a fill-in', () => {
  const bs = paperBlocks('> NOT REGISTERED.\n>\n> SECOND PARA.\n\n> Warning: this is not an offer.\n- [x] done\n- [ ] open\n✓ ticked\nSign: ____');
  const legends = bs.filter((b) => b.t === 'legend') as Extract<Block, { t: 'legend' }>[];
  assert.deepEqual(legends.map((l) => [l.warning, l.paras.length]), [[false, 2], [true, 1]]);
  const checks = bs.filter((b) => b.t === 'check') as Extract<Block, { t: 'check' }>[];
  assert.deepEqual(checks.map((c) => c.checked), [true, false, true]);
  const sign = bs[bs.length - 1] as Extract<Block, { t: 'para' }>;
  assert.deepEqual(sign.runs.map((r) => r.k), ['text', 'fill']);
});

test('D711 brackets marks known merge tokens only, and filled marks none', () => {
  const body = 'Between {{company.legal_name}} and {{not.a_token}}.';
  const b = one(paperBlocks(body, { merge: 'brackets' }), 'para');
  assert.deepEqual(b.runs.filter((r) => r.k === 'merge').map((r) => (r as any).text), ['[COMPANY LEGAL NAME]']);
  assert.ok(runsText(b.runs).includes('{{not.a_token}}'));
  assert.equal(one(paperBlocks(body, { merge: 'filled' }), 'para').runs.some((r) => r.k === 'merge'), false);
  assert.equal(one(paperBlocks(body, { merge: 'raw' }), 'para').runs.some((r) => r.k === 'merge'), false);
});

test('D711 paperText: ↔ becomes an en dash, emoji go, ☐ ☑ ✓ ✔ are drawn boxes, and HTML stays text', () => {
  assert.equal(paperText('Founder ↔ Investor 🎉'), 'Founder – Investor ');
  assert.equal(paperText('© 2026 ≥ 5 Łukasz'), '© 2026 ≥ 5 Łukasz');
  const p = one(paperBlocks('Boxes ☐ ☑ ✔ and <b>x</b>'), 'para');
  assert.deepEqual(p.runs.filter((r) => r.k === 'box').map((r) => (r as any).checked), [false, true, true]);
  assert.ok(runsText(p.runs).includes('<b>x</b>'));
});

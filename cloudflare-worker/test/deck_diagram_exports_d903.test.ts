/**
 * D903 §11 (#3660) — a typed diagram in every export: the offline HTML file,
 * the editable PowerPoint (Google Slides), the OpenDocument file, and the
 * print page's mirror of the layout (which the PDF and the PowerPoint pictures
 * photograph). Before this, the three files wrote a "Graphic · …" line and the
 * print page drew the same.
 *
 *   1. The layout: every type, every word the stored one, no word or number
 *      added, every shape inside its block; a diagram that does not sanitize
 *      has none.
 *   2. The frontend mirror lays out every fixture exactly as the Worker does.
 *   3. Each writer draws the diagram's words as text (editable shapes in the
 *      PowerPoint and ODP), its connectors as lines, and keeps "Graphic · …"
 *      for a graphic with no diagram.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_diagram_exports_d903.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramLayout, diagramWords } from '../src/services/decks/diagramLayout.ts';
import { diagramLayout as pageLayout } from '../../frontend/src/pages/raise/pitch/diagramLayout.js';
import { writeOfflineDeck } from '../src/services/decks/offlineHtml.ts';
import { writeEditableDeck } from '../src/services/decks/pptxEditable.ts';
import { writeOdp } from '../src/services/decks/odp.ts';

const items = (n: number, extra: (i: number) => Record<string, unknown> = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ label: `Step ${String.fromCharCode(65 + i)}`, ...extra(i) }));

const TIMELINE = { v: 1, type: 'timeline', items: [
  { label: 'Private beta', detail: 'Ten design partners', date: '2026-03' },
  { label: 'Public launch', date: '2026-06-15' },
  { label: 'Teams plan', detail: 'Seats and roles', date: '2026-09' },
] };
const FLOW = { v: 1, type: 'flow', items: [{ label: 'Hire engineers' }, { label: 'Ship the API' }, { label: 'Win pilots' }] };
const CYCLE = { v: 1, type: 'cycle', items: [{ label: 'Interview' }, { label: 'Build' }, { label: 'Measure' }, { label: 'Learn' }] };
const MATRIX = { v: 1, type: 'matrix', axes: { x: 'Price against ours', y: 'Depth against ours' }, items: [
  { label: 'Northwind' }, { label: 'Kestrel' }, { label: 'Tallow' }, { label: 'Us', detail: 'Deeper, cheaper' },
] };

const FIXTURES: unknown[] = [
  TIMELINE, FLOW, CYCLE, MATRIX,
  ...[2, 3, 4, 5, 6, 7, 8].flatMap((n) => ['timeline', 'flow', 'cycle'].map((type) => ({ v: 1, type, items: items(n, (i) => (i % 2 ? { detail: `Detail ${i}` } : {})) }))),
  { v: 1, type: 'flow', items: items(9) },                         // cut to eight
  { v: 1, type: 'flow', items: [{ label: '  spaced   out  ' }, { label: 'B' }] },
  { v: 1, type: 'matrix', axes: { x: 'X' }, items: items(4) },      // an axis missing: none
  { v: 1, type: 'flow', items: [{ label: 'Only one' }] },           // too few: none
  { v: 2, type: 'flow', items: items(3) },                          // another version: none
  { v: 1, type: 'pyramid', items: items(3) },                       // an unknown type: none
  null, 'flow', { v: 1, type: 'timeline', items: [{ label: 'A', date: '2026-13' }, { label: 'B', date: 'soon' }] },
];

// ---------------------------------------------------------------------------

test('D903 §11: every type lays out its stored words and nothing else, inside its block', () => {
  // Mutation checked: a step number added to a label → the words check fails; the snake's second row left to right → the order check fails.
  for (const raw of [TIMELINE, FLOW, CYCLE, MATRIX]) {
    const l = diagramLayout(raw)!;
    assert.ok(l, (raw as any).type);
    for (const s of l.shapes) {
      const box = s.kind === 'line' ? [s.x1, s.y1, s.x2, s.y2] : [s.x, s.y, s.x + s.w, s.y + s.h];
      for (const v of box) assert.ok(v >= -0.0001 && v <= 1.0001, `${l.type} ${s.kind} ${v}`);
    }
  }
  assert.deepEqual(diagramWords(diagramLayout(TIMELINE)!), ['2026-03 · Private beta · Ten design partners', '2026-06-15 · Public launch', '2026-09 · Teams plan · Seats and roles']);
  assert.deepEqual(diagramWords(diagramLayout(FLOW)!), ['Hire engineers', 'Ship the API', 'Win pilots']);
  assert.deepEqual(diagramWords(diagramLayout(MATRIX)!), ['Northwind', 'Kestrel', 'Tallow', 'Us · Deeper, cheaper', 'Price against ours', 'Depth against ours']);

  // Lines: a flow of three has two arrows, a cycle of four four (the last back to the first), a timeline its axis.
  const lines = (raw: unknown) => diagramLayout(raw)!.shapes.filter((s) => s.kind === 'line');
  assert.equal(lines(FLOW).length, 2);
  assert.ok(lines(FLOW).every((l: any) => l.arrow && l.x2 > l.x1), 'a flow reads left to right');
  assert.equal(lines(CYCLE).length, 4);
  assert.equal(lines(TIMELINE).length, 1);
  assert.equal(diagramLayout(TIMELINE)!.shapes.filter((s) => s.kind === 'dot').length, 3);
  // A matrix: two axes, the y axis's name vertical.
  const axes = diagramLayout(MATRIX)!.shapes.filter((s: any) => s.kind === 'node' && s.role === 'axis') as any[];
  assert.deepEqual(axes.map((a) => [a.label, a.vertical === true]), [['Price against ours', false], ['Depth against ours', true]]);

  // Past four, a flow snakes: the second row runs back under the first, joined by a downward arrow.
  const six = diagramLayout({ v: 1, type: 'flow', items: items(6) })!;
  const nodes = six.shapes.filter((s) => s.kind === 'node') as any[];
  assert.deepEqual(nodes.map((n) => n.y < 0.5 ? 'top' : 'bottom'), ['top', 'top', 'top', 'bottom', 'bottom', 'bottom']);
  assert.ok(nodes[3].x > nodes[4].x && nodes[4].x > nodes[5].x, 'the second row runs right to left');
  assert.ok(Math.abs(nodes[2].x - nodes[3].x) < 1e-6, 'and turns under the last item of the first');
  const down = (six.shapes.filter((s) => s.kind === 'line') as any[])[2];
  assert.ok(down.x1 === down.x2 && down.y2 > down.y1);

  // No layout for a diagram that does not sanitize.
  for (const bad of FIXTURES.slice(-7)) if (bad && (bad as any).type !== 'timeline') assert.equal(diagramLayout(bad), null, JSON.stringify(bad));
  // A timeline's bad dates are dropped, not drawn.
  assert.deepEqual(diagramWords(diagramLayout(FIXTURES.at(-1))!), ['A', 'B']);
});

test('D903 §11: the print page lays out every fixture exactly as the Worker does', () => {
  // Mutation checked: the mirror's cycle radius or flow gap changed → this fails on the first such fixture.
  for (const raw of FIXTURES) assert.deepEqual(pageLayout(raw), diagramLayout(raw), JSON.stringify(raw));
});

// --------------------------------------------------------------------------- the writers

const SLIDE = {
  title: 'Roadmap',
  blocks: [
    { id: 'h', kind: 'text', style: 'heading', text: 'Where we go next', grid: { c1: 1, c2: 12, r1: 1, r2: 1 } },
    { id: 'tl', kind: 'graphic', graphic: 'timeline', diagram: TIMELINE, grid: { c1: 1, c2: 12, r1: 2, r2: 4 } },
    { id: 'mx', kind: 'graphic', graphic: 'matrix', diagram: MATRIX, grid: { c1: 1, c2: 6, r1: 5, r2: 6 } },
    { id: 'plain', kind: 'graphic', graphic: 'star', grid: { c1: 7, c2: 12, r1: 5, r2: 6 } },
  ],
};
const BRAND = { show_footer: false, footer_text: '', watermark_url: null } as any;
const LABELS = ['Private beta', 'Ten design partners', 'Public launch', 'Teams plan', 'Northwind', 'Kestrel', 'Tallow', 'Us', 'Deeper, cheaper', 'Price against ours', 'Depth against ours'];

function unzip(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = new Map<string, string>();
  let p = 0;
  while (v.getUint32(p, true) === 0x04034b50) {
    const size = v.getUint32(p + 18, true), nameLen = v.getUint16(p + 26, true), extra = v.getUint16(p + 28, true);
    const name = new TextDecoder().decode(b.subarray(p + 30, p + 30 + nameLen));
    const start = p + 30 + nameLen + extra;
    out.set(name, new TextDecoder().decode(b.subarray(start, start + size)));
    p = start + size;
  }
  return out;
}
function wellFormed(xml: string) {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  const stack: string[] = [];
  let roots = 0;
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<|&(?!(?:amp|lt|gt|quot|apos);)/g)) {
    if (m[0] === '<') throw new Error('a stray <');
    if (m[0].startsWith('&')) throw new Error('an unescaped &');
    if (m[1]) { if (stack.pop() !== m[2]) throw new Error(`mismatched </${m[2]}>`); continue; }
    if (!stack.length) roots += 1;
    if (!m[4]) stack.push(m[2]);
  }
  if (stack.length || roots !== 1) throw new Error('unbalanced');
  return true;
}

test('D903 §11: the offline HTML file draws each diagram, its words as text, its lines inline, nothing loaded', async () => {
  // Mutation checked: the graphic case back to its name line → the figure check fails; the marker id shared → the uniqueness check fails.
  const html = await writeOfflineDeck({ title: 'Deck', version: 1, slides: [SLIDE], images: new Map(), footer: null, watermark: null, notes: false, sources: false });
  assert.match(html, /<figure class="dg dg-timeline" aria-label="Timeline diagram">/);
  assert.match(html, /<figure class="dg dg-matrix" aria-label="Matrix diagram">/);
  for (const w of LABELS) assert.ok(html.includes(w), w);
  assert.ok(!html.includes('Graphic · timeline') && !html.includes('Graphic · matrix'));
  assert.ok(html.includes('Graphic · star'), 'a graphic with no diagram keeps its name line');
  assert.equal((html.match(/<line /g) || []).length, 1 + 2, 'the timeline axis and the matrix two axes');
  assert.equal((html.match(/class="dot"/g) || []).length, 3);
  assert.ok(html.includes('id="dga-tl"') && html.includes('id="dga-mx"'), 'each diagram its own arrow marker');
  assert.match(html, /class="ax v"[^>]*>(?:<b>)?Depth against ours/);
  assert.ok(!/(?:src|href)="https?:/.test(html), 'nothing to load');
});

test('D903 §11: the editable PowerPoint draws each diagram as one group of editable shapes and connectors', async () => {
  // Mutation checked: the graphic case not taken → no grpSp named Diagram; a line's flip dropped → the cycle's leftward arrows lose flipH.
  const out = await writeEditableDeck({ slides: [SLIDE, { blocks: [{ id: 'c', kind: 'graphic', graphic: 'cycle', diagram: CYCLE, grid: { c1: 1, c2: 12, r1: 1, r2: 6 } }] }],
    renderable: [{ title: 'Roadmap', fields: [] }, { title: 'Loop', fields: [] }], brand: BRAND, notes: false, images: new Map() });
  const zip = unzip(out.bytes);
  const s1 = zip.get('ppt/slides/slide1.xml')!;
  const s2 = zip.get('ppt/slides/slide2.xml')!;
  wellFormed(s1); wellFormed(s2);
  assert.match(s1, /<p:cNvPr id="\d+" name="Diagram tl" descr="Timeline diagram"\/>/);
  assert.match(s1, /name="Diagram mx" descr="Matrix diagram"/);
  for (const w of LABELS) assert.ok(s1.includes(`<a:t>${w}</a:t>`), w);
  assert.equal((s1.match(/prst="roundRect"/g) || []).length, 3 + 4, 'an editable box per item');
  assert.equal((s1.match(/<p:cxnSp>/g) || []).length, 3);
  assert.equal((s1.match(/prst="ellipse"/g) || []).length, 3, "the timeline's dots");
  assert.ok(s1.includes('vert="vert270"'), "the matrix's y axis reads up its side");
  assert.ok(s1.includes('Graphic · star') && !s1.includes('Graphic · timeline'));
  assert.equal((s2.match(/<a:tailEnd type="triangle"/g) || []).length, 4, 'a cycle of four, four arrows');
  assert.ok(s2.includes('flipH="1"') && s2.includes('flipV="1"'), 'arrows that run left or up are flipped, not reversed');
});

test('D903 §11: the ODP file draws each diagram as a group of rectangles with paragraphs, lines and the Arrow marker', async () => {
  // Mutation checked: the diagram styles left out of content.xml → grN is unresolved; the marker left out of styles.xml → Arrow is.
  const out = await writeOdp({ title: 'Deck', version: 1, slides: [SLIDE], renderable: [{ title: 'Roadmap', fields: [] }], images: new Map(), brand: BRAND, notes: false });
  const zip = unzip(out.bytes);
  const content = zip.get('content.xml')!, styles = zip.get('styles.xml')!;
  wellFormed(content); wellFormed(styles);
  assert.match(content, /<draw:g draw:name="Diagram 1\.\d+"><svg:title>Timeline diagram<\/svg:title>/);
  assert.match(content, /<svg:title>Matrix diagram<\/svg:title>/);
  for (const w of LABELS) assert.ok(content.includes(`>${w}</text:p>`), w);
  assert.equal((content.match(/<draw:rect draw:style-name="grN"/g) || []).length, 3 + 4);
  assert.equal((content.match(/<draw:line /g) || []).length, 3);
  assert.equal((content.match(/<draw:ellipse /g) || []).length, 3);
  for (const style of ['grN', 'grA', 'grL', 'grP', 'grD', 'PD', 'PI', 'PX', 'PA']) assert.ok(content.includes(`style:name="${style}"`), style);
  assert.ok(styles.includes('<draw:marker draw:name="Arrow"'));
  assert.ok(content.includes('Graphic · star') && !content.includes('Graphic · timeline'));
});

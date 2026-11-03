/**
 * D1574 (#3821, deck v2 E1) — the structured PowerPoint writer.
 *
 *   1. placement: every area sits where The Grid draws it — the editor's
 *      `gridModel.boxOf`, the .odp writer's `designSystem.boxOf`;
 *   2. native charts: a chart part with its numbers in its cache and an
 *      embedded sheet; a missing point is a gap, never a 0; a bound series is
 *      the store's points up to the binding's `as_of`;
 *   3. pd8b: "A projection keeps its label in every format" — PowerPoint
 *      (native and words), .odp and HTML;
 *   4. reading order, text that stays inside its area, SVG decor with a PNG
 *      fallback;
 *   5. the one-click bar: a complete deck exports with no "Not recorded" and
 *      no 0, a cut card is not in the file, and every word is editable text;
 *   6. the route: POST /export {format:'pptx'} answers the editable file, and
 *      the Google Slides export is the same writer.
 *
 * Every venture, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_pptx_writer_d1574.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { CLEAR_PNG, FIT_FLOOR, blockRect, fitParagraphs, readingOrder, setHeight, writeEditableDeck } from '../src/services/decks/pptxEditable.ts';
import { NATIVE_CHART_TYPES, chartPlan, seriesPoints } from '../src/services/decks/pptxChart.ts';
import { boxOf } from '../src/services/decks/designSystem.ts';
import { writeOdp } from '../src/services/decks/odp.ts';
import { NOT_RECORDED, writeOfflineDeck } from '../src/services/decks/offlineHtml.ts';
import { tf } from '../src/services/decks/pptx.ts';
import { TONE_COLOURS } from '../src/services/decks/arrange.ts';
import { visibleCards } from '../src/services/decks/slideModel.ts';
import * as grid from '../../frontend/src/pages/raise/pitch/gridModel.js';
import deckExports from '../src/routes/deck_exports.ts';
import decks from '../src/routes/decks.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const BRAND: any = { show_footer: false, footer_text: '', watermark_url: null };
const TODAY = '2026-11-03';
const EMU = 12192000 / 1920;
const g = (c1: number, c2: number, r1: number, r2: number) => ({ c1, c2, r1, r2 });

function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  while (i + 30 <= bytes.length && v.getUint32(i, true) === 0x04034b50) {
    const size = v.getUint32(i + 18, true);
    const nameLen = v.getUint16(i + 26, true);
    const extra = v.getUint16(i + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extra;
    out.set(name, bytes.subarray(start, start + size));
    i = start + size;
  }
  return out;
}
const txt = (parts: Map<string, Uint8Array>, name: string) => new TextDecoder().decode(parts.get(name) ?? new Uint8Array());
const write = (slides: any[], extra: Record<string, unknown> = {}) => writeEditableDeck({
  slides, renderable: slides.map((s) => ({ title: s.title, fields: [] })) as any, brand: BRAND, notes: false, images: new Map(), today: TODAY, ...extra,
});

// A complete card: every area holds what it shows.
const TRACTION = {
  title: 'Traction',
  blocks: [
    { id: 'h', kind: 'text', style: 'heading', text: 'Traction', grid: g(1, 12, 1, 1) },
    { id: 'm', kind: 'metric', label: 'Pilots', value: '3', grid: g(1, 4, 2, 3) },
    { id: 'c', kind: 'chart', chart_type: 'columns', grid: g(5, 12, 2, 6), range: 'all', labels: true,
      series: [
        { label: 'Pilots', points: [{ x: '2026-07', y: 1 }, { x: '2026-08', y: 2 }, { x: '2026-09', y: 3 }] },
        { label: 'Signed', points: [{ x: '2026-07', y: 1 }, { x: '2026-09', y: 2 }] },
      ] },
    { id: 'p', kind: 'text', style: 'paragraph', text: 'Three paying pilots since July.', grid: g(1, 4, 4, 6) },
  ],
};

test('1. placement: every area sits at The Grid’s box, the editor’s and the .odp writer’s', async () => {
  // Mutation checked: the print card's 3% padding kept → the x/y match fails; one block off by a column → its box fails.
  for (const b of TRACTION.blocks) {
    assert.deepEqual(blockRect(b.grid), boxOf(b.grid), 'the Worker’s boxOf');
    assert.deepEqual(blockRect(b.grid), grid.boxOf(b.grid), 'the editor’s gridModel.boxOf');
  }
  const s1 = txt(unzip((await write([TRACTION])).bytes), 'ppt/slides/slide1.xml');
  for (const b of TRACTION.blocks) {
    const r = boxOf(b.grid);
    assert.ok(s1.includes(`<a:off x="${Math.round(r.x * EMU)}" y="${Math.round(r.y * EMU)}"/><a:ext cx="${Math.round(r.w * EMU)}" cy="${Math.round(r.h * EMU)}"/>`), `block ${b.id} at its box`);
  }
});

test('2. a native chart: a chart part with its cache and an embedded sheet; a missing point is a gap, never 0', async () => {
  // Mutation checked: a missing point written 0 → the gap check fails; the override left out → the content-type check fails;
  // the workbook relationship dropped → the externalData check fails.
  const out = await write([TRACTION]);
  assert.deepEqual(out.charts, { native: 1, pictured: 0, as_text: 0 });
  const parts = unzip(out.bytes);
  const s1 = txt(parts, 'ppt/slides/slide1.xml');
  assert.match(s1, /<p:graphicFrame>[\s\S]*name="Chart c"[\s\S]*<c:chart [^>]*r:id="rId3"\/>/);
  assert.match(txt(parts, 'ppt/slides/_rels/slide1.xml.rels'), /Id="rId3" Type="[^"]+\/chart" Target="..\/charts\/chart1.xml"/);
  const chart = txt(parts, 'ppt/charts/chart1.xml');
  assert.match(chart, /<c:barChart><c:barDir val="col"\/><c:grouping val="clustered"\/>/);
  assert.match(chart, /<c:v>Pilots<\/c:v>[\s\S]*<c:v>Signed<\/c:v>/);
  // "Signed" has no August point: its cache holds idx 0 and 2, and the chart shows gaps.
  const signed = chart.slice(chart.indexOf('<c:v>Signed</c:v>'));
  const numCache = signed.slice(signed.indexOf('<c:numCache>'), signed.indexOf('</c:numCache>'));
  assert.deepEqual([...numCache.matchAll(/<c:pt idx="(\d)"><c:v>([^<]+)<\/c:v>/g)].map((m) => [m[1], m[2]]), [['0', '1'], ['2', '2']]);
  assert.match(chart, /<c:dispBlanksAs val="gap"\/>/);
  assert.match(chart, /<c:externalData r:id="rId1">/);
  assert.match(txt(parts, 'ppt/charts/_rels/chart1.xml.rels'), /Target="..\/embeddings\/chart1.xlsx"/);
  const ct = txt(parts, '[Content_Types].xml');
  assert.match(ct, /PartName="\/ppt\/charts\/chart1.xml" ContentType="application\/vnd.openxmlformats-officedocument.drawingml.chart\+xml"/);
  assert.match(ct, /Extension="xlsx"/);
  // The embedded sheet holds the same numbers, the missing one an empty cell.
  const sheet = txt(unzip(parts.get('ppt/embeddings/chart1.xlsx')!), 'xl/worksheets/sheet1.xml');
  assert.match(sheet, /<row r="3"><c r="A3" t="inlineStr"><is><t>2026-08<\/t><\/is><\/c><c r="B3"><v>2<\/v><\/c><\/row>/);
  assert.doesNotMatch(sheet, /<c r="C3">/);
});

test('2b. a bound series is the store’s points up to its binding’s as_of; one with none falls back to words', async () => {
  // Mutation checked: the as_of cut removed → the October point appears; the store map ignored → no native chart.
  const store = new Map([['grow.mrr', [{ x: '2026-08', y: 4000 }, { x: '2026-09', y: 4200 }, { x: '2026-10', y: 4500 }]]]);
  const sr = { label: 'MRR', binding: { source_key: 'grow.mrr', as_of: '2026-09-30' } };
  assert.deepEqual(seriesPoints(sr, store), [{ x: '2026-08', y: 4000 }, { x: '2026-09', y: 4200 }]);
  const card = { title: 'Revenue', blocks: [{ id: 'r', kind: 'chart', chart_type: 'line', series: [sr], grid: g(1, 12, 1, 6) }] };
  let out = await write([card], { series: store });
  assert.equal(out.charts.native, 1);
  const chart = txt(unzip(out.bytes), 'ppt/charts/chart1.xml');
  assert.match(chart, /<c:lineChart>/);
  assert.doesNotMatch(chart, /2026-10/);
  out = await write([card]);
  assert.deepEqual(out.charts, { native: 0, pictured: 0, as_text: 1 }, 'no store points, no native chart and no made-up one');
  // Every type the writer draws natively; the rest answer null.
  assert.deepEqual([...NATIVE_CHART_TYPES].sort(), ['columns', 'funnel', 'line', 'nested_bars', 'percent_bar', 'projection', 'ranked_bars', 'stacked', 'waterfall']);
  assert.equal(chartPlan({ kind: 'chart', chart_type: 'cohort_heatmap', series: [{ label: 'x', points: [{ x: 'a', y: 1 }] }] }, null, TODAY), null);
  const ranked = chartPlan({ kind: 'chart', chart_type: 'ranked_bars', series: [{ label: 'Pain', points: [{ x: 'Cost', y: 2 }, { x: 'Speed', y: 5 }, { x: 'Trust', y: 3 }] }] }, null, TODAY)!;
  assert.deepEqual([ranked.dir, ranked.categories], ['bar', ['Speed', 'Trust', 'Cost']], 'biggest first');
});

test('3. pd8b: a projection keeps its label in every format — PowerPoint (native and words), .odp and HTML', async () => {
  // Mutation checked: the projection title dropped from the chart part → the PowerPoint check fails; chartCaption's heading
  // left plain → the .odp check fails; the HTML heading left plain → the HTML check fails.
  const forecast = { id: 'f', kind: 'chart', chart_type: 'line', grid: g(1, 12, 1, 6), series: [{ label: 'Revenue', points: [{ x: '2026-10', y: 4 }, { x: '2026-12', y: 6 }, { x: '2027-02', y: 9 }] }] };
  const card = { title: 'Plan', blocks: [forecast] };
  const parts = unzip((await write([card])).bytes);
  const chart = txt(parts, 'ppt/charts/chart1.xml');
  assert.match(chart, /<c:title>[\s\S]*<a:t>Projection<\/a:t>/);
  // The points past today's month are dashed; October (this side of November) is not.
  assert.equal((chart.match(/<a:prstDash val="dash"\/>/g) || []).length, 2);
  assert.match(txt(parts, 'ppt/slides/slide1.xml'), /descr="Projection · Line chart"/);
  // A past-only chart carries no projection label.
  const past = txt(unzip((await write([TRACTION])).bytes), 'ppt/charts/chart1.xml');
  assert.doesNotMatch(past, /Projection/);
  assert.match(past, /<c:autoTitleDeleted val="1"\/>/);
  // As words (no native counterpart), as the .odp caption, and in the HTML file.
  const heat = { ...forecast, id: 'h', chart_type: 'cohort_heatmap' };
  assert.match(txt(unzip((await write([{ title: 'Plan', blocks: [heat] }])).bytes), 'ppt/slides/slide1.xml'), /Projection · Cohort heatmap chart/);
  const odp = unzip((await writeOdp({ title: 'Plan', version: 1, slides: [card], renderable: [{ title: 'Plan', fields: [] } as any], images: new Map(), brand: BRAND, notes: false, today: TODAY })).bytes);
  assert.match(txt(odp, 'content.xml'), /Projection · Line chart/);
  const html = await writeOfflineDeck({ title: 'Plan', version: 1, slides: [card], images: new Map(), footer: null, watermark: null, notes: false, sources: false });
  assert.match(html, /Projection · Line chart/);
});

test('4a. reading order: top to bottom, then start to end; overlapping areas keep their stacking order', async () => {
  // Mutation checked: the sort removed → the stored order (paragraph first) fails; overlaps sorted anyway → the overlap check fails.
  const shuffled = { title: 'x', blocks: [TRACTION.blocks[3], TRACTION.blocks[2], TRACTION.blocks[0], TRACTION.blocks[1]] };
  assert.deepEqual(readingOrder(shuffled.blocks).map((b: any) => b.id), ['h', 'm', 'c', 'p']);
  const s1 = txt(unzip((await write([shuffled])).bytes), 'ppt/slides/slide1.xml');
  const at = (name: string) => s1.indexOf(`name="${name}"`);
  assert.ok(at('text h') < at('metric m') && at('metric m') < at('Chart c') && at('Chart c') < at('text p'));
  const over = [{ id: 'a', grid: g(1, 12, 3, 6) }, { id: 'b', grid: g(1, 6, 1, 4) }];
  assert.deepEqual(readingOrder(over).map((b: any) => b.id), ['a', 'b']);
});

test('4b. text stays inside its area: a long paragraph is set smaller until it fits; a short one keeps its size', () => {
  // Mutation checked: fitParagraphs returning its input → the fits check fails; scaling a short text → the unchanged check fails.
  const box = boxOf(g(1, 3, 2, 2)); // one row, a quarter of the width
  const long = Array.from({ length: 4 }, (_, i) => tf(`Line ${i} of a paragraph that runs on well past one narrow cell of the grid.`, { size: 15 }));
  assert.ok(setHeight(long, box.w / 2) > box.h / 2, 'the fixture overflows at its own size');
  const fitted = fitParagraphs(long, box);
  assert.notDeepEqual(fitted, long);
  assert.ok(setHeight(fitted, box.w / 2) <= box.h / 2 || fitted.every((p) => Number(/sz="(\d+)"/.exec(p)![1]) <= 1500 * FIT_FLOOR + 1), 'fits, or is at the floor');
  const short = [tf('Three', { size: 15 })];
  assert.deepEqual(fitParagraphs(short, box), short);
});

test('4c. an icon is SVG with a PNG fallback, in its tone’s colour, never a CSS variable', async () => {
  // Mutation checked: the tone left as var(--deck-…) → the colour check fails; the PNG fallback dropped → the blip check fails.
  const card = { title: 'x', blocks: [TRACTION.blocks[0]], decor: [{ id: 'd1', kind: 'icon', ref: 'rocket', tone: 'accent', at: { x: 1600, y: 96, w: 160, h: 160 } }] };
  const out = await write([card]);
  assert.deepEqual(out.decor, { shapes: 0, svg: 1 });
  const parts = unzip(out.bytes);
  const svg = [...parts.keys()].find((k) => k.endsWith('.svg'))!;
  const body = txt(parts, svg);
  assert.match(body, /^<svg[\s>]/);
  assert.ok(body.includes(TONE_COLOURS.accent));
  assert.doesNotMatch(body, /var\(/);
  const png = [...parts.keys()].find((k) => k.startsWith('ppt/media/') && k.endsWith('.png'))!;
  assert.deepEqual(parts.get(png), CLEAR_PNG);
  assert.match(txt(parts, 'ppt/slides/slide1.xml'), /<a:blip r:embed="rId3"><a:extLst><a:ext uri="\{96DAC541-7B7A-43D3-8B79-37D633B846F1\}"><asvg:svgBlip [^>]*r:embed="rId4"\/>/);
  assert.match(txt(parts, '[Content_Types].xml'), /Extension="svg" ContentType="image\/svg\+xml"/);
});

test('5. the one-click bar: a complete deck has no "Not recorded" and no 0, no cut card, and every word is editable text', async () => {
  // Mutation checked: a hidden card kept → the slide count fails; the chart pictured instead of native → the editable-text check fails.
  const cut = { ...TRACTION, title: 'Cut card', hidden: true, blocks: [{ id: 'z', kind: 'text', style: 'heading', text: 'Cut words', grid: g(1, 12, 1, 1) }] };
  const slides = visibleCards([TRACTION, cut] as any);
  assert.equal(slides.length, 1, 'the cut card is not exported');
  const out = await write(slides, { chartShot: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
  const parts = unzip(out.bytes);
  const all = [...parts.entries()].filter(([n]) => /^ppt\/(slides\/slide|charts\/chart)\d+\.xml$/.test(n)).map(([, b]) => new TextDecoder().decode(b)).join('\n');
  assert.ok(!all.includes(NOT_RECORDED));
  assert.doesNotMatch(all, /<a:t>0<\/a:t>|<c:v>0<\/c:v>/);
  assert.doesNotMatch(all, /Cut words/);
  // 100% editable text: every word the card shows is a text run or a chart value, and nothing is a picture.
  for (const w of ['Traction', 'PILOTS', 'Three paying pilots since July.', 'Pilots', 'Signed', '2026-08']) assert.ok(all.includes(w), w);
  assert.equal((all.match(/<p:pic>/g) || []).length, 0);
  assert.deepEqual(out.charts, { native: 1, pictured: 0, as_text: 0 });
});

// ── the route ──

const JWT_SECRET = 'unit-test-jwt-secret-d1574-0123456789-abcdef';
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
  for (const t of ['users', 'projects', 'pitch_decks', 'activity_logs']) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)!));
  db.exec(read('cloudflare-worker/sql/migrations/537_deck_exports.sql'));
  db.prepare(`INSERT INTO users (id, email, name, role, founder_id, is_active) VALUES (1, 'owner.d1574@example.test', 'Founder', 'founder', 100, 1)`).run();
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (1, 'Testventure Labs', 100)`).run();
  db.prepare(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (10, 1, 2, ?, 'Seed deck', 1, 1)`).run(JSON.stringify([TRACTION]));
  const app = new Hono<any>();
  app.route('/api/decks', deckExports);
  app.route('/api/decks', decks);
  return { db, app, env: { DB: d1Over(db), JWT_SECRET, PUBLIC_BASE_URL: 'https://axal.test' } as any };
}

test('6. POST /export {format:"pptx"} answers the editable file, recorded once; Google Slides is the same writer', async () => {
  // Mutation checked: the handler not passing on a PDF → the PDF answer fails; the ledger skipped → the ledger check fails.
  const f = fixture();
  const jwt = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const post = (body: unknown) => f.app.request('/api/decks/10/export', { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, f.env);
  const res = await post({ format: 'pptx' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Deck-Export-Mode'), 'editable');
  assert.match(res.headers.get('X-Content-SHA256') || '', /^[0-9a-f]{64}$/, 'the ledger middleware recorded it');
  const parts = unzip(new Uint8Array(await res.arrayBuffer()));
  assert.ok(parts.has('ppt/charts/chart1.xml'), 'a native chart');
  assert.deepEqual(f.db.prepare('SELECT format FROM deck_exports').all().map((r: any) => r.format), ['pptx']);
  // A PDF passes on to decks.ts (here: no browser bound, so it says so).
  const pdf = await post({ format: 'pdf' });
  assert.equal(pdf.status, 503);
  assert.equal((await pdf.json() as any).error, 'browser_binding_unavailable');
  // Both editable exports read the stores' series and call the one writer.
  const src = read('cloudflare-worker/src/routes/deck_exports.ts');
  assert.equal((src.match(/writeEditableDeck\(\{[\s\S]*?series[,\s:]/g) || []).length, 2);
  assert.doesNotMatch(read('cloudflare-worker/src/routes/decks.ts'), /renderDeckPPTXWithImages|print_mode=single/);
  f.db.close();
});

/**
 * D8771 (#8771) — what an exported deck carries, said accurately.
 *
 *   1. the presets: `copyOf` names an investor copy (no notes, the Sources
 *      appendix), a working copy (both) and custom (anything else), and the
 *      client's `exportDisclosureModel.PRESETS` is the same table;
 *   2. the PowerPoint writer's report on a fixture holding a text box, a
 *      native chart, a chart with no native type, an image (fetched and not),
 *      a diagram, a long title, notes and a card made of fields: every count
 *      is what the file holds, the slide is 13.33 × 7.5 in, the long title is
 *      set smaller (never below FIT_FLOOR), and the speaker notes are empty
 *      unless asked for;
 *   3. the route: the PowerPoint answers its report and fingerprint headers,
 *      the ledger row keeps notes, appendix and copy, and `GET /exports`
 *      returns them, with null (Not recorded) for a row written before;
 *   4. the HTML and .odp routes record the same; the .odp answers its report.
 *
 * Every venture, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_export_disclosure_8771.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckExports, { EXPORT_COPIES, REPORT_HEADER, copyOf, reportOf } from '../src/routes/deck_exports.ts';
import decks from '../src/routes/decks.ts';
import { FIT_FLOOR, writeEditableDeck } from '../src/services/decks/pptxEditable.ts';
import { NATIVE_CHART_TYPES } from '../src/services/decks/pptxChart.ts';
import { NO_NOTES } from '../src/services/decks/offlineHtml.ts';
import * as client from '../../frontend/src/pages/raise/pitch/exportDisclosureModel.js';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { dohAnswer } from './_doh_fake.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const BRAND: any = { show_footer: false, footer_text: '', watermark_url: null };
const TODAY = '2026-11-03';
const g = (c1: number, c2: number, r1: number, r2: number) => ({ c1, c2, r1, r2 });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const LONG = 'A very long title that cannot possibly fit inside one narrow heading area on this card at its full size';

// The fixture: [Testventure] · Seed deck, made up.
const SLIDES = [
  {
    title: 'Traction', notes: 'Private: the second pilot has not signed yet.',
    blocks: [
      { id: 'h', kind: 'text', style: 'heading', text: LONG, grid: g(1, 3, 1, 1) },
      { id: 'c', kind: 'chart', chart_type: 'columns', grid: g(4, 12, 1, 3), series: [{ label: 'Pilots', points: [{ x: '2026-07', y: 1 }, { x: '2026-08', y: 2 }] }] },
      { id: 'k', kind: 'chart', chart_type: 'cohort_heatmap', grid: g(4, 12, 4, 6), series: [{ label: 'Retention', points: [] }] },
      { id: 'i', kind: 'image', image_url: 'https://img.example.test/a.png', alt: 'A photo', grid: g(1, 3, 2, 3) },
      { id: 'j', kind: 'image', image_url: 'https://img.example.test/gone.png', alt: 'Gone', grid: g(1, 3, 4, 4) },
      { id: 'd', kind: 'graphic', diagram: { v: 1, type: 'flow', items: [{ label: 'Sign' }, { label: 'Pilot' }, { label: 'Pay' }] }, grid: g(1, 3, 5, 6) },
    ],
  },
  { title: 'Ask', fields: [{ key: 'p', label: 'Ask', kind: 'paragraph', value: 'Raising a seed round.' }] },
];

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

test('1. the presets: investor (no notes, appendix), working (both), custom (anything else); the client keeps the same table', () => {
  // Mutation checked: the investor copy given notes → the first line fails; the client's table drifting → the drift line fails.
  assert.equal(copyOf(false, true), 'investor');
  assert.equal(copyOf(true, true), 'working');
  assert.equal(copyOf(false, false), 'custom');
  assert.equal(copyOf(true, false), 'custom');
  assert.deepEqual(JSON.parse(JSON.stringify(client.PRESETS)), JSON.parse(JSON.stringify(EXPORT_COPIES)), 'the client presets are the Worker’s');
  for (const [n, s] of [[false, true], [true, true], [false, false], [true, false]] as const) assert.equal(client.presetOf(n, s), copyOf(n, s));
  assert.deepEqual([...client.NATIVE_CHART_TYPES].sort(), [...NATIVE_CHART_TYPES].sort(), 'the preview’s native chart list is the writer’s');
  assert.equal(client.FIT_FLOOR, FIT_FLOOR);
});

test('2. the PowerPoint writer reports what the file holds, at 13.33 × 7.5 in, with notes only when asked for', async () => {
  // Mutation checked: a diagram not counted → `diagrams` fails; the shrink not counted → `text.shrunk` fails;
  // notes written when not asked → the empty-notes check fails; the slide size changed → the sldSz check fails.
  const images = new Map<string, any>([['https://img.example.test/a.png', { kind: 'png', bytes: PNG }], ['https://img.example.test/gone.png', null]]);
  const renderable: any[] = SLIDES.map((s) => ({ title: s.title, fields: [], notes: undefined }));
  const plain = await writeEditableDeck({ slides: SLIDES, renderable, brand: BRAND, notes: false, images, today: TODAY });
  assert.deepEqual(plain.charts, { native: 1, pictured: 0, as_text: 1 }, 'no headless browser: the heatmap goes in as words');
  assert.deepEqual(plain.images, { placed: 1, not_placed: 1 });
  assert.equal(plain.diagrams, 1);
  assert.deepEqual(plain.slides, { total: 2, from_blocks: 1, text_frames: 1 });
  // The heading and the heatmap's words are the block text boxes.
  assert.equal(plain.text.boxes, 2);
  assert.ok(plain.text.shrunk >= 1, 'the long title is set smaller');
  assert.ok(plain.text.smallest < 1 && plain.text.smallest >= FIT_FLOOR, `smallest ${plain.text.smallest}`);
  const parts = unzip(plain.bytes);
  assert.match(txt(parts, 'ppt/presentation.xml'), /<p:sldSz cx="12192000" cy="6858000" type="screen16x9"\/>/, '13.33 × 7.5 in');
  assert.ok(parts.has('ppt/charts/chart1.xml') && !parts.has('ppt/charts/chart2.xml'), 'one native chart');
  for (const n of [1, 2]) assert.doesNotMatch(txt(parts, `ppt/notesSlides/notesSlide${n}.xml`), /Private|No notes on this card/, `slide ${n}’s notes are empty`);

  const withNotes = await writeEditableDeck({ slides: SLIDES, renderable, brand: BRAND, notes: true, images, today: TODAY });
  const np = unzip(withNotes.bytes);
  assert.match(txt(np, 'ppt/notesSlides/notesSlide1.xml'), /Private: the second pilot has not signed yet\./);
  assert.match(txt(np, 'ppt/notesSlides/notesSlide2.xml'), new RegExp(NO_NOTES.replace('.', '\\.')));

  assert.deepEqual(reportOf(plain), {
    charts: { native: 1, pictured: 0, as_text: 1 }, images: { placed: 1, not_placed: 1 },
    text: plain.text, diagrams: 1, slides: { total: 2, from_blocks: 1, text_frames: 1 },
  });
  assert.deepEqual(reportOf({ charts: { pictured: 2, as_text: 0 }, images: { placed: 0, not_placed: 0 } }),
    { charts: { native: 0, pictured: 2, as_text: 0 }, images: { placed: 0, not_placed: 0 }, text: null, diagrams: null, slides: null }, 'the .odp writes no native chart');
});

// ── the routes ──

const JWT_SECRET = 'unit-test-jwt-secret-d8771-0123456789-abcdef';
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
  for (const t of ['users', 'projects', 'pitch_decks', 'activity_logs']) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)!));
  db.exec(read('cloudflare-worker/sql/migrations/537_deck_exports.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/754_deck_exports_odp.sql'));
  // A row written before this change: it never said what it carried.
  db.exec("INSERT INTO deck_exports (deck_id, version, format, content_hash, created_by) VALUES (10, 2, 'pptx', '" + 'a'.repeat(64) + "', 1)");
  db.exec(read('cloudflare-worker/sql/migrations/202611270209_8771_deck_exports_disclosure.sql'));
  // D8772 part 3: the ledger also keeps the warnings an export confirmed.
  db.exec(read('cloudflare-worker/sql/migrations/202611271712_8772_deck_exports_confirmed.sql'));
  db.prepare(`INSERT INTO users (id, email, name, role, founder_id, is_active) VALUES (1, 'owner.d8771@example.test', 'Founder', 'founder', 100, 1)`).run();
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (1, 'Testventure Labs', 100)`).run();
  db.prepare(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (10, 1, 2, ?, 'Seed deck', 1, 1)`).run(JSON.stringify(SLIDES));
  const app = new Hono<any>();
  app.route('/api/decks', deckExports);
  app.route('/api/decks', decks);
  return { db, app, env: { DB: d1Over(db), JWT_SECRET, PUBLIC_BASE_URL: 'https://axal.test' } as any };
}
function images() {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url ?? input);
    const dns = dohAnswer(url); if (dns) return dns;
    if (url === 'https://img.example.test/a.png') return new Response(PNG, { status: 200 });
    return new Response('', { status: 404 });
  }) as any;
  return () => { globalThis.fetch = real; };
}
async function client_(f: ReturnType<typeof fixture>) {
  const jwt = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  return (method: string, path: string, body?: unknown) => f.app.request(`/api/decks${path}`, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }, f.env);
}
const rows = (db: DatabaseSync) => db.prepare('SELECT format, notes, sources, copy FROM deck_exports ORDER BY id').all().map((r) => ({ ...r }));

test('3. the PowerPoint answers its report and fingerprint; the ledger keeps notes, appendix and copy; GET /exports returns them', async () => {
  // Mutation checked: the middleware not passing the options → the row reads 0/0/custom; the report header dropped →
  // the header parse fails; GET not returning the columns → its deepEqual fails; an old row read as false → its null check fails.
  const f = fixture();
  const restore = images();
  try {
    const call = await client_(f);
    const res = await call('POST', '/10/export', { format: 'pptx', notes: false, sources: true });
    assert.equal(res.status, 200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.equal(res.headers.get('X-Content-SHA256'), createHash('sha256').update(bytes).digest('hex'), 'the fingerprint is the file’s');
    const report = JSON.parse(res.headers.get(REPORT_HEADER) || 'null');
    assert.deepEqual(report.charts, { native: 1, pictured: 0, as_text: 1 });
    assert.deepEqual(report.images, { placed: 1, not_placed: 1 });
    assert.equal(report.diagrams, 1);
    assert.deepEqual(report.slides, { total: 3, from_blocks: 1, text_frames: 2 }, 'two cards and the Sources appendix');
    const parts = unzip(bytes);
    assert.doesNotMatch(txt(parts, 'ppt/notesSlides/notesSlide1.xml'), /Private/, 'an investor copy carries no private note');

    const work = await call('POST', '/10/export', { format: 'pptx', notes: true, sources: true });
    assert.equal(work.status, 200);
    assert.match(txt(unzip(new Uint8Array(await work.arrayBuffer())), 'ppt/notesSlides/notesSlide1.xml'), /Private: the second pilot/);

    assert.deepEqual(rows(f.db), [
      { format: 'pptx', notes: null, sources: null, copy: null },
      { format: 'pptx', notes: 0, sources: 1, copy: 'investor' },
      { format: 'pptx', notes: 1, sources: 1, copy: 'working' },
    ]);
    const list = await (await call('GET', '/10/exports')).json() as any;
    assert.deepEqual(list.exports.map((e: any) => [e.notes, e.sources, e.copy]), [[true, true, 'working'], [false, true, 'investor'], [null, null, null]]);
  } finally { restore(); f.db.close(); }
});

test('4. the HTML and .odp exports record what they carried; the .odp answers its report', async () => {
  // Mutation checked: the .odp route recording no options → its row fails; its report header dropped → the parse fails.
  const f = fixture();
  const restore = images();
  try {
    const call = await client_(f);
    assert.equal((await call('POST', '/10/export/html', { notes: true, sources: false })).status, 200);
    const odp = await call('POST', '/10/export/odp', { notes: false, sources: false });
    assert.equal(odp.status, 200);
    const report = JSON.parse(odp.headers.get(REPORT_HEADER) || 'null');
    assert.equal(report.charts.native, 0, 'the .odp draws no native chart');
    assert.equal(report.charts.pictured + report.charts.as_text, 2);
    assert.deepEqual(rows(f.db).slice(1), [
      { format: 'html', notes: 1, sources: 0, copy: 'custom' },
      { format: 'odp', notes: 0, sources: 0, copy: 'custom' },
    ]);
  } finally { restore(); f.db.close(); }
});

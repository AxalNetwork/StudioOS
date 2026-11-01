/**
 * D1603 (#3882): the slides-suite export (.odp). The real routers over HTTP
 * (`deck_exports.ts` before `decks.ts`, as index.ts mounts them) on node:sqlite
 * tables sliced from the baseline plus migrations 537 and 754. `fetch` serves
 * the fixture images and nothing else. Each case names the mutation it catches.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_export_odp_d1603.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckExports, { EXPORT_FORMATS } from '../src/routes/deck_exports.ts';
import decks from '../src/routes/decks.ts';
import { ODP_MIMETYPE, PAGE_CM, writeOdp, chartCaption, chartParas } from '../src/services/decks/odp.ts';
import { IMAGE_MISSING, NOT_RECORDED, NO_NOTES } from '../src/services/decks/offlineHtml.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const M537 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/537_deck_exports.sql'), 'utf8');
const M754 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/754_deck_exports_odp.sql'), 'utf8');
const JWT_SECRET = randomBytes(32).toString('hex');
const TABLES = ['users', 'projects', 'pitch_decks', 'activity_logs'];

// Invented content: no real venture, person or figure.
const SLIDES = [
  { title: 'Testventure <b>& co</b>', subtitle: 'Seed', body: 'Line one', bullets: ['First', 'Second'], image_url: 'https://img.example.test/a.png', notes: 'Open with the problem.' },
  {
    title: 'Traction', blocks: [
      { id: 'h', kind: 'text', style: 'heading', text: 'Paying accounts', grid: { c1: 1, c2: 12, r1: 1, r2: 1 } },
      { id: 'm', kind: 'metric', label: 'Pilots', value: '', grid: { c1: 1, c2: 4, r1: 2, r2: 3 } },
      { id: 'c', kind: 'chart', chart_type: 'ranked_bars', grid: { c1: 5, c2: 12, r1: 2, r2: 6 }, series: [
        { label: 'Accounts', points: [{ x: 'Sep', y: 30 }, { x: 'Oct', y: 42 }], binding: { source_key: 'grow.paying_accounts', as_of: '2026-10-10' } },
        { label: 'Churned', points: [] },
      ] },
      { id: 'i', kind: 'image', image_url: 'https://img.example.test/gone.png', alt: 'A photo', grid: { c1: 1, c2: 4, r1: 4, r2: 6 } },
    ],
  },
  { title: 'Ask' },
];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)!));
  db.exec(M537);
  // An export recorded before 754, to survive the rebuild.
  db.exec("INSERT INTO deck_exports (deck_id, version, format, content_hash, created_by) VALUES (10, 4, 'html', '" + 'a'.repeat(64) + "', 1)");
  db.exec(M754);
  db.prepare(`INSERT INTO users (id, email, name, role, founder_id, is_active) VALUES (1, 'owner.d1603@example.test', 'Founder', 'founder', 100, 1)`).run();
  db.exec("INSERT INTO users (id, email, name, role, is_active) VALUES (2, 'other.d1603@example.test', 'Other', 'founder', 1), (3, 'admin.d1603@example.test', 'Admin', 'admin', 1), (4, 'advisor.d1603@example.test', 'Advisor', 'advisor', 1)");
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (1, 'Testventure Labs', 100)`).run();
  db.prepare(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (10, 1, 4, ?, 'Seed deck', 1, 1)`).run(JSON.stringify(SLIDES));
  const env: any = { DB: d1Over(db), JWT_SECRET };
  const app = new Hono<any>();
  app.route('/api/decks', deckExports);
  app.route('/api/decks', decks);
  return { db, env, app };
}

async function call(f: ReturnType<typeof fixture>, who: number, role: string, path: string, body: unknown = {}, method = 'POST') {
  const jwt = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(`/api/decks${path}`, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body),
  }, f.env);
  return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
}
function images() {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url ?? input);
    if (url === 'https://img.example.test/a.png') return new Response(PNG, { status: 200 });
    return new Response('', { status: 404 });
  }) as any;
  return () => { globalThis.fetch = real; };
}

/** The stored zip's local entries, in order: name, method, extra length and bytes. */
function unzip(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Array<{ name: string; method: number; extra: number; data: Uint8Array }> = [];
  let p = 0;
  while (v.getUint32(p, true) === 0x04034b50) {
    const method = v.getUint16(p + 8, true), size = v.getUint32(p + 18, true), nameLen = v.getUint16(p + 26, true), extra = v.getUint16(p + 28, true);
    const name = new TextDecoder().decode(b.subarray(p + 30, p + 30 + nameLen));
    const start = p + 30 + nameLen + extra;
    out.push({ name, method, extra, data: b.subarray(start, start + size) });
    p = start + size;
  }
  return out;
}
const text = (e: { data: Uint8Array } | undefined) => new TextDecoder().decode(e!.data);
/** Well-formed XML: one root, every element closed in order, entities only the five. */
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
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const ledger = (db: DatabaseSync) => db.prepare('SELECT deck_id, version, format, content_hash, created_by FROM deck_exports ORDER BY id').all().map((r) => ({ ...r }));
const audits = (db: DatabaseSync) => db.prepare("SELECT action, details FROM activity_logs WHERE entity_type = 'raise.pitch-deck'").all().map((r) => ({ ...r }));

test('a founder exports: 200, the ODP type and name, mimetype first, stored, no extra field, exact content', async () => {
  // Mutations: mimetype second, or deflated (method 8), or with an extra field.
  const f = fixture(); const restore = images();
  try {
    const r = await call(f, 1, 'founder', '/10/export/odp');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), ODP_MIMETYPE);
    assert.equal(r.headers.get('content-disposition'), 'attachment; filename="Seed-deck-v4.odp"');
    assert.equal(r.headers.get('x-content-sha256'), sha(r.bytes));
    const z = unzip(r.bytes);
    assert.deepEqual([z[0].name, z[0].method, z[0].extra, text(z[0])], ['mimetype', 0, 0, 'application/vnd.oasis.opendocument.presentation']);
    assert.ok(z.every((e) => e.method === 0));
    for (const n of ['META-INF/manifest.xml', 'content.xml', 'styles.xml', 'meta.xml']) assert.ok(z.some((e) => e.name === n), n);
  } finally { restore(); }
});

test('the manifest lists content, styles, meta and every picture with its media type', async () => {
  // Mutation: an image entry left out of the manifest.
  const f = fixture(); const restore = images();
  try {
    const z = unzip((await call(f, 1, 'founder', '/10/export/odp')).bytes);
    const manifest = text(z.find((e) => e.name === 'META-INF/manifest.xml'));
    assert.ok(manifest.includes(`manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODP_MIMETYPE}"`));
    for (const n of ['content.xml', 'styles.xml', 'meta.xml']) assert.ok(manifest.includes(`manifest:full-path="${n}" manifest:media-type="text/xml"`), n);
    const pictures = z.filter((e) => e.name.startsWith('Pictures/'));
    assert.equal(pictures.length, 0, 'the first card has no blocks: its image is a field, not placed; the gone image is not a picture');
    // A deck whose blocks place the fetched image carries it, listed.
    const out = await writeOdp({ title: 'T', version: 1, slides: [{ blocks: [{ id: 'i', kind: 'image', image_url: 'u', grid: { c1: 1, c2: 6, r1: 1, r2: 6 } }] }],
      renderable: [{ title: 'T', fields: [] }], images: new Map([['u', { kind: 'png', bytes: PNG }]]), brand: { show_footer: false, footer_text: '', watermark_url: null } as any, notes: false });
    const z2 = unzip(out.bytes);
    const pic = z2.find((e) => e.name.startsWith('Pictures/'))!;
    assert.deepEqual([pic.name, [...pic.data]], ['Pictures/p1.png', [...PNG]]);
    assert.ok(text(z2.find((e) => e.name === 'META-INF/manifest.xml')).includes('manifest:full-path="Pictures/p1.png" manifest:media-type="image/png"'));
    assert.ok(text(z2.find((e) => e.name === 'content.xml')).includes('xlink:href="Pictures/p1.png"'));
  } finally { restore(); }
});

test('content.xml: the title is a text paragraph in a text box, escaped; a page is 28cm × 15.75cm', async () => {
  // Mutations: text rendered as an image; a 4:3 page.
  const f = fixture(); const restore = images();
  try {
    const z = unzip((await call(f, 1, 'founder', '/10/export/odp')).bytes);
    const content = text(z.find((e) => e.name === 'content.xml'));
    assert.match(content, /<draw:text-box><text:p text:style-name="PH">Testventure &lt;b&gt;&amp; co&lt;\/b&gt;<\/text:p><\/draw:text-box>/);
    assert.ok(content.includes('<text:p text:style-name="PH">Paying accounts</text:p>'));
    assert.equal((content.match(/<draw:page /g) || []).length, 3);
    const styles = text(z.find((e) => e.name === 'styles.xml'));
    assert.ok(styles.includes('fo:page-width="28cm" fo:page-height="15.75cm"'));
    assert.deepEqual(PAGE_CM, { width: 28, height: 15.75 });
    assert.ok(wellFormed(content));
    assert.ok(wellFormed(styles));
    assert.ok(wellFormed(text(z.find((e) => e.name === 'meta.xml'))));
    assert.ok(wellFormed(text(z.find((e) => e.name === 'META-INF/manifest.xml'))));
  } finally { restore(); }
});

test('not recorded is never 0: an empty metric, an empty series, a missing image say so; a chart has its label and source', async () => {
  const f = fixture(); const restore = images();
  try {
    const content = text(unzip((await call(f, 1, 'founder', '/10/export/odp')).bytes).find((e) => e.name === 'content.xml'));
    assert.ok(content.includes(`<text:p text:style-name="PM">PILOTS</text:p><text:p text:style-name="PN">${NOT_RECORDED}</text:p>`));
    // The export's sanitizer keeps a series' binding and drops typed points: a bound series with nothing recorded says so.
    assert.ok(content.includes(`<text:p text:style-name="PN">Accounts: ${NOT_RECORDED}</text:p>`));
    assert.ok(!/Accounts: 0/.test(content));
    // Straight to the writer, a series with points reads them, and one with none is "Not recorded", never a 0 bar.
    const direct = text(unzip((await writeOdp({ title: 'T', version: 1, slides: [SLIDES[1]], renderable: [{ title: 'Traction', fields: [] }], images: new Map(),
      brand: { show_footer: false, footer_text: '', watermark_url: null } as any, notes: false })).bytes).find((e) => e.name === 'content.xml'));
    assert.ok(direct.includes('Accounts: Sep 30 · Oct 42'));
    assert.ok(direct.includes(`<text:p text:style-name="PN">Churned: ${NOT_RECORDED}</text:p>`));
    assert.ok(!/Churned: 0/.test(direct));
    assert.ok(content.includes(`<text:p text:style-name="PN">${IMAGE_MISSING}</text:p>`));
    assert.ok(content.includes('<text:p text:style-name="PM">Ranked bars chart</text:p><text:p text:style-name="PS">Source: grow.paying_accounts, as of 2026-10-10</text:p>'));
    assert.deepEqual(chartCaption({ chart_type: 'line', series: [] }).map((p) => p.text), ['Line chart', `Source: ${NOT_RECORDED}`]);
    // A chart with no series at all is "Not recorded" in words, never a 0.
    assert.deepEqual(chartParas({ chart_type: 'line', series: [] }), [{ style: 'N', text: NOT_RECORDED }]);
  } finally { restore(); }
});

test('a chart pictured from the print page is an image above its caption; one that cannot be taken is words', async () => {
  const shot = await writeOdp({ title: 'T', version: 1, slides: [SLIDES[1]], renderable: [{ title: 'Traction', fields: [] }], images: new Map(),
    brand: { show_footer: false, footer_text: '', watermark_url: null } as any, notes: false, chartShot: async () => PNG });
  assert.deepEqual(shot.charts, { pictured: 1, as_text: 0 });
  const c = text(unzip(shot.bytes).find((e) => e.name === 'content.xml'));
  assert.ok(c.includes('<draw:image xlink:href="Pictures/p1.png"'));
  assert.ok(c.includes('Source: grow.paying_accounts, as of 2026-10-10'));
  const none = await writeOdp({ title: 'T', version: 1, slides: [SLIDES[1]], renderable: [{ title: 'Traction', fields: [] }], images: new Map(),
    brand: { show_footer: false, footer_text: '', watermark_url: null } as any, notes: false, chartShot: async () => null });
  assert.deepEqual(none.charts, { pictured: 0, as_text: 1 });
});

test('speaker notes are presentation:notes only when asked for', async () => {
  const f = fixture(); const restore = images();
  try {
    const off = text(unzip((await call(f, 1, 'founder', '/10/export/odp', {})).bytes).find((e) => e.name === 'content.xml'));
    assert.ok(!off.includes('presentation:notes'));
    const on = text(unzip((await call(f, 1, 'founder', '/10/export/odp', { notes: true })).bytes).find((e) => e.name === 'content.xml'));
    assert.equal((on.match(/<presentation:notes>/g) || []).length, 3);
    assert.ok(on.includes('Open with the problem.'));
    assert.ok(on.includes(NO_NOTES));
    const src = text(unzip((await call(f, 1, 'founder', '/10/export/odp', { sources: true })).bytes).find((e) => e.name === 'content.xml'));
    assert.equal((src.match(/<draw:page /g) || []).length, 4, 'the Sources appendix is one more page');
  } finally { restore(); }
});

test('each export is one ledger row with the file’s hash and one audit row; listed by GET /exports', async () => {
  const f = fixture(); const restore = images();
  try {
    const r = await call(f, 1, 'founder', '/10/export/odp');
    assert.deepEqual(ledger(f.db).slice(1), [{ deck_id: 10, version: 4, format: 'odp', content_hash: sha(r.bytes), created_by: 1 }]);
    assert.deepEqual(audits(f.db), [{ action: 'deck_exported', details: 'Deck exported as a slides-suite file (.odp)' }]);
    const list = JSON.parse(new TextDecoder().decode((await call(f, 1, 'founder', '/10/exports', undefined, 'GET')).bytes));
    assert.deepEqual(list.exports.map((e: any) => e.format), ['odp', 'html']);
    assert.ok((EXPORT_FORMATS as readonly string[]).includes('odp'));
  } finally { restore(); }
});

test('someone outside the venture, an advisor or an admin gets 403 and no row', async () => {
  const f = fixture(); const restore = images();
  try {
    for (const [who, role] of [[2, 'founder'], [4, 'advisor'], [3, 'admin']] as const) {
      const r = await call(f, who, role, '/10/export/odp');
      assert.equal(r.status, 403, `${role} ${who}`);
    }
    assert.equal((await call(f, 1, 'founder', '/999/export/odp')).status, 404);
    assert.equal(ledger(f.db).length, 1, 'only the pre-754 row');
    assert.deepEqual(audits(f.db), []);
  } finally { restore(); }
});

test('no ledger, no file: 503 and no audit row left behind', async () => {
  // Mutation: the file sent anyway when the batch fails.
  const f = fixture(); const restore = images();
  try {
    f.db.exec('DROP TABLE deck_exports');
    const r = await call(f, 1, 'founder', '/10/export/odp');
    assert.equal(r.status, 503);
    const body = JSON.parse(new TextDecoder().decode(r.bytes));
    assert.equal(body.error, 'export_not_recorded');
    assert.notEqual(r.headers.get('content-type'), ODP_MIMETYPE);
    assert.deepEqual(audits(f.db), []);
  } finally { restore(); }
});

test('migration 754: an odp row inserts, the pre-754 rows survive with their ids, the old checks still hold', () => {
  const f = fixture();
  assert.deepEqual(ledger(f.db), [{ deck_id: 10, version: 4, format: 'html', content_hash: 'a'.repeat(64), created_by: 1 }]);
  f.db.exec("INSERT INTO deck_exports (deck_id, version, format, content_hash, created_by) VALUES (10, 4, 'odp', '" + 'b'.repeat(64) + "', 1)");
  assert.equal(f.db.prepare('SELECT id FROM deck_exports WHERE format = ?').get('html')!.id, 1);
  assert.throws(() => f.db.exec("INSERT INTO deck_exports (deck_id, format, content_hash) VALUES (10, 'keynote', '" + 'c'.repeat(64) + "')"));
  assert.throws(() => f.db.exec("INSERT INTO deck_exports (deck_id, format, content_hash) VALUES (10, 'odp', NULL)"), 'an odp row needs its hash');
  assert.throws(() => f.db.exec("INSERT INTO deck_exports (deck_id, format, content_hash) VALUES (10, 'odp', 'not-hex')"));
  assert.ok(f.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_deck_exports_deck'").get());
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'deck_exports_new'").get()!.n, 0);
});

test('the brand is the venture owner’s: footer and watermark on every page; nothing logs a URL or a title', async () => {
  const brand = { show_footer: true, footer_text: 'Made with Axal', watermark_url: 'https://img.example.test/w.png' } as any;
  const out = await writeOdp({ title: 'T', version: 1, slides: [{}, {}], renderable: [{ title: 'One', fields: [] }, { title: 'Two', fields: [] }],
    images: new Map([[brand.watermark_url, { kind: 'png', bytes: PNG }]]), brand, notes: false });
  const c = text(unzip(out.bytes).find((e) => e.name === 'content.xml'));
  assert.equal((c.match(/Made with Axal/g) || []).length, 2);
  assert.equal((c.match(/draw:name="Watermark/g) || []).length, 2);
  assert.equal(unzip(out.bytes).filter((e) => e.name.startsWith('Pictures/')).length, 1, 'one watermark picture, used on each page');
  const src = readFileSync(resolve(ROOT, 'cloudflare-worker/src/services/decks/odp.ts'), 'utf8');
  assert.ok(!/console\.(log|warn|error)/.test(src));
});

/**
 * D904 (#2683) — Pitch deck studio part 10: export to Google Slides.
 *
 *  1. The editable PowerPoint puts every block where the print card draws it
 *     (12 × 6 grid, 3% padding, 24 px gap): text and metric blocks are text
 *     boxes, a metric with no figure reads "Not recorded", a PNG/JPEG/GIF image
 *     is a picture, a missing or WebP image says so, a chart is a picture of
 *     its block when one can be taken and its type and series in words when
 *     not; a fielded card is stacked text; notes only when asked for.
 *  2. The route creates exactly one file, by one POST to Drive's upload
 *     endpoint (no file id, no parents), asking for a Slides conversion, and
 *     records it: one `deck_exports` row (google_slides, the uploaded file's
 *     SHA-256, the Drive id in external_ref) and one `raise.pitch-deck` audit row.
 *  3. A file Drive keeps as PowerPoint is never called a Slides deck.
 *  4. Refusals come before any Google call: a support session, no Google, no
 *     drive.file, the company not enabled, someone outside the venture, a
 *     file over 5 MB. A Google failure records nothing; a ledger failure after
 *     the file exists says so and links it. No provider body reaches an answer.
 *  5. The one write is the only one: `driveCreate.ts` has one transport, one
 *     frozen POST, and nothing else in the Worker uploads to Drive.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_google_slides_d904.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckExports from '../src/routes/deck_exports.ts';
import decks from '../src/routes/decks.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { ensureIntegrationsSchema } from '../src/integrations/registry.ts';
import { DRIVE_FILE_SCOPE, ensureWorkspaceIntegration } from '../src/services/google/workspace.ts';
import { DRIVE_UPLOAD_MAX_BYTES, GOOGLE_WORKSPACE_WRITES, SLIDES_MIME, PPTX_MIME, driveName, presentationUrl } from '../src/services/google/driveCreate.ts';
import { CARD_H, CARD_W, CHART_SHOTS_MAX, blockRect, writeEditableDeck } from '../src/services/decks/pptxEditable.ts';
import { IMAGE_MISSING, NOT_RECORDED, NO_NOTES } from '../src/services/decks/offlineHtml.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const JWT_SECRET = 'unit-test-jwt-secret-d904-0123456789-abcdef';

// Invented content: no real venture, person or figure.
const BLOCK_SLIDE = {
  title: 'Traction', notes: 'Say the pilots first.',
  blocks: [
    { id: 'h', kind: 'text', style: 'heading', text: 'Pilots & <growth>', grid: { c1: 1, c2: 12, r1: 1, r2: 1 } },
    { id: 'l', kind: 'text', style: 'list', text: 'First\nSecond', grid: { c1: 1, c2: 6, r1: 2, r2: 3 } },
    { id: 'm', kind: 'metric', label: 'Paying customers', value: null, grid: { c1: 7, c2: 9, r1: 2, r2: 2 } },
    { id: 'n', kind: 'metric', label: 'Pilots', value: '3', grid: { c1: 10, c2: 12, r1: 2, r2: 2 } },
    { id: 'c', kind: 'chart', chart_type: 'columns', series: [{ label: 'Pilots', points: [{ x: 'Q1', y: 1 }, { x: 'Q2', y: 3 }] }], range: 'all', previous: false, labels: true, grid: { c1: 7, c2: 12, r1: 3, r2: 5 } },
    { id: 'i', kind: 'image', image_url: 'https://img.example.test/a.png', alt: 'Team', grid: { c1: 1, c2: 3, r1: 4, r2: 6 } },
    { id: 'w', kind: 'image', image_url: 'https://img.example.test/w.webp', alt: '', grid: { c1: 4, c2: 6, r1: 4, r2: 6 } },
  ],
};
const FIELD_SLIDE = { title: 'Ask', fields: [{ key: 'p', label: 'Ask', kind: 'paragraph', value: 'Raising a seed round.' }] };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);
const BRAND: any = { show_footer: true, footer_text: 'Made with Axal', watermark_url: null };

// ── a store-mode zip reader, for the file the writer makes ──
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
const text = (parts: Map<string, Uint8Array>, name: string) => new TextDecoder().decode(parts.get(name) ?? new Uint8Array());
const EMU = 12192000 / CARD_W;

test('1a. a block sits where the print card draws it: 3% padding, a 24 px gap, 12 columns by 6 rows', () => {
  // Mutation checked: the gap left out → the single-cell width fails; padding of the height → the full-grid y fails.
  const full = blockRect({ c1: 1, c2: 12, r1: 1, r2: 6 });
  assert.deepEqual([full.x, full.y, full.w, full.h].map((n) => Math.round(n * 10) / 10), [57.6, 57.6, 1804.8, 964.8]);
  const cell = blockRect({ c1: 2, c2: 2, r1: 2, r2: 2 });
  assert.deepEqual([cell.x, cell.y, cell.w, cell.h].map((n) => Math.round(n * 10) / 10), [210, 222.4, 128.4, 140.8]);
  assert.equal(Math.round(full.x + full.w + 57.6), CARD_W);
  assert.equal(Math.round(full.y + full.h + 57.6), CARD_H);
});

test('1b. the editable file: text boxes, a metric with no figure "Not recorded", pictures for images and charts, words for what cannot be pictured', async () => {
  // Mutation checked: a WebP placed as a picture → the media check fails; the chart shot ignored → the chart picture check fails;
  // an empty metric written "0" → the Not recorded check fails.
  const images = new Map<string, any>([['https://img.example.test/a.png', { kind: 'png', bytes: PNG }], ['https://img.example.test/w.webp', { kind: 'webp', bytes: WEBP }]]);
  const shots: Array<[number, any]> = [];
  const out = await writeEditableDeck({
    slides: [BLOCK_SLIDE, FIELD_SLIDE], renderable: [{ title: 'Traction', fields: [] } as any, { title: 'Ask', fields: FIELD_SLIDE.fields } as any],
    brand: BRAND, notes: true, images, chartShot: async (i, r) => { shots.push([i, r]); return PNG; },
  });
  const parts = unzip(out.bytes);
  const s1 = text(parts, 'ppt/slides/slide1.xml');
  assert.match(s1, /Pilots &amp; &lt;growth&gt;/, 'the heading is escaped text');
  assert.match(s1, /<a:buChar char="•"\/>.*First/s);
  assert.ok(s1.includes(NOT_RECORDED), 'the empty metric says Not recorded');
  assert.doesNotMatch(s1, /<a:t>0<\/a:t>/);
  assert.match(s1, /<a:t>3<\/a:t>/);
  assert.ok(s1.includes(IMAGE_MISSING), 'the WebP image says it could not be included');
  // The heading box sits at the grid's first row, full width.
  assert.match(s1, new RegExp(`<a:off x="${Math.round(57.6 * EMU)}" y="${Math.round(57.6 * EMU)}"/><a:ext cx="${Math.round(1804.8 * EMU)}"`));
  // Two pictures on the card: the PNG image and the chart; the chart's shot was its own block rectangle on slide 0.
  assert.equal((s1.match(/<p:pic>/g) || []).length, 2);
  assert.equal(shots.length, 1);
  assert.equal(shots[0][0], 0);
  assert.deepEqual(shots[0][1], blockRect(BLOCK_SLIDE.blocks[4].grid as any));
  const media = [...parts.keys()].filter((k) => k.startsWith('ppt/media/'));
  assert.deepEqual(media.map((m) => m.split('.').pop()).sort(), ['png', 'png']);
  assert.deepEqual(out.charts, { pictured: 1, as_text: 0 });
  assert.deepEqual(out.images, { placed: 1, not_placed: 1 });
  const rels = text(parts, 'ppt/slides/_rels/slide1.xml.rels');
  assert.equal((rels.match(/relationships\/image/g) || []).length, 2);
  // The fielded card is the text writer's stacked frames; notes are the card's, or say there are none.
  assert.match(text(parts, 'ppt/slides/slide2.xml'), /Raising a seed round\./);
  assert.match(text(parts, 'ppt/notesSlides/notesSlide1.xml'), /Say the pilots first\./);
  assert.ok(text(parts, 'ppt/notesSlides/notesSlide2.xml').includes(NO_NOTES));
  assert.match(text(parts, '[Content_Types].xml'), /Extension="jpeg"/);
});

test('1c. no picture of a chart: its type and series in words; notes left empty when not asked for', async () => {
  // Mutation checked: the text fallback dropped → the "Columns chart" check fails; notes written when not asked → the empty-notes check fails.
  const out = await writeEditableDeck({
    slides: [BLOCK_SLIDE], renderable: [{ title: 'Traction', fields: [] } as any], brand: BRAND, notes: false, images: new Map(), chartShot: null,
  });
  const parts = unzip(out.bytes);
  const s1 = text(parts, 'ppt/slides/slide1.xml');
  assert.match(s1, /Columns chart/);
  assert.match(s1, /Pilots: Q1 1 · Q2 3/);
  assert.equal((s1.match(/<p:pic>/g) || []).length, 0, 'two images that could not be fetched are not pictures');
  assert.equal((s1.split(IMAGE_MISSING).length - 1), 2);
  assert.deepEqual(out.charts, { pictured: 0, as_text: 1 });
  assert.doesNotMatch(text(parts, 'ppt/notesSlides/notesSlide1.xml'), /Say the pilots first/);
});

test('1d. at most CHART_SHOTS_MAX charts are pictured; the rest go in as words', async () => {
  assert.equal(CHART_SHOTS_MAX, 30, 'one export takes at most thirty browser shots');
  const many = Array.from({ length: CHART_SHOTS_MAX + 2 }, (_, k) => ({ title: `C${k}`, blocks: [{ id: `c${k}`, kind: 'chart', chart_type: 'line', series: [], grid: { c1: 1, c2: 12, r1: 1, r2: 6 } }] }));
  let calls = 0;
  const out = await writeEditableDeck({
    slides: many, renderable: many.map((s) => ({ title: s.title, fields: [] }) as any), brand: BRAND, notes: false, images: new Map(),
    chartShot: async () => { calls += 1; return PNG; },
  });
  assert.equal(calls, CHART_SHOTS_MAX);
  assert.deepEqual(out.charts, { pictured: CHART_SHOTS_MAX, as_text: 2 });
});

// ── the route ──

function fixture(opts: { scope?: string | null; enabled?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'founders', 'projects', 'pitch_decks', 'activity_logs', 'user_company_links']) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)!));
  db.exec(stripForeignKeys(tableFromBaseline(read('cloudflare-worker/sql/migrations/034_unmounted_routes.sql'), 'companies')!));
  db.exec(read('cloudflare-worker/sql/migrations/537_deck_exports.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/445_connector_fed_items.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/588_google_workspace_files.sql'));
  db.exec('CREATE TABLE google_oauth_tokens(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER UNIQUE,refresh_token TEXT,scope TEXT,google_sub TEXT,google_email TEXT,updated_at TEXT)');
  db.exec("INSERT INTO users (id, email, name, role, founder_id, is_active) VALUES (1, 'owner.d904@example.test', 'Founder', 'founder', 100, 1), (2, 'other.d904@example.test', 'Other', 'founder', 200, 1)");
  db.exec("INSERT INTO companies (id, company_name) VALUES (1, 'Testventure Labs')");
  db.exec("INSERT INTO projects (id, name, founder_id, company_id) VALUES (1, 'Testventure Labs', 100, 1)");
  db.exec("INSERT INTO user_company_links (uid, user_id, company_id) VALUES ('l1', 1, 1)");
  db.prepare(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (10, 1, 4, ?, 'Seed deck', 1, 1)`).run(JSON.stringify([BLOCK_SLIDE, FIELD_SLIDE]));
  if (opts.scope !== null) {
    db.prepare('INSERT INTO google_oauth_tokens(user_id,refresh_token,scope,google_sub,google_email,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)')
      .run(1, 'server-refresh-only', opts.scope ?? `openid ${DRIVE_FILE_SCOPE}`, 'google-member', 'owner.d904@example.test');
  }
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', GOOGLE_CAL_CLIENT_ID: 'public-client', GOOGLE_CAL_CLIENT_SECRET: 'synthetic-secret', PUBLIC_BASE_URL: 'https://axal.vc' };
  const app = new Hono<any>();
  app.route('/api/decks', deckExports);
  app.route('/api/decks', decks);
  return {
    db, env, app,
    async ready() {
      await ensureProjectMembershipSchema(env);
      await ensureIntegrationsSchema(env);
      db.exec('CREATE TABLE IF NOT EXISTS integration_companies(integration_id INTEGER,company_id INTEGER,enabled INTEGER,PRIMARY KEY(integration_id,company_id))');
      const integ = await ensureWorkspaceIntegration(env, 1);
      if (opts.enabled !== false) db.prepare('INSERT INTO integration_companies VALUES (?,?,1)').run(integ.id, 1);
    },
  };
}

async function exportGoogle(f: ReturnType<typeof fixture>, who = 1, body: unknown = { notes: true, sources: true }, support = false) {
  const jwt = await new SignJWT({ user_id: who, role: 'founder', ...(support ? { impersonated_by: 9 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request('/api/decks/10/export/google-slides', {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, f.env);
  return { status: res.status, body: await res.json() as any };
}

type Call = { url: string; method: string; body: Uint8Array | null; headers: Record<string, string> };
function google(answer: (call: Call) => Response) {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input?.url ?? input);
    const method = init.method || 'GET';
    const body = init.body instanceof Uint8Array ? init.body : typeof init.body === 'string' ? new TextEncoder().encode(init.body) : null;
    const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
    calls.push({ url, method, body, headers });
    if (url === 'https://oauth2.googleapis.com/token' && method === 'POST') return Response.json({ access_token: 'server-access-only', token_type: 'Bearer' });
    if (url === 'https://img.example.test/a.png') return new Response(PNG);
    if (url === 'https://img.example.test/w.webp') return new Response(WEBP);
    if (url.startsWith('https://www.googleapis.com/')) return answer(calls[calls.length - 1]);
    return new Response('', { status: 404 });
  }) as any;
  const uploads = () => calls.filter((c) => c.url.startsWith('https://www.googleapis.com/'));
  return { calls, uploads, restore: () => { globalThis.fetch = real; } };
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const ledger = (db: DatabaseSync) => db.prepare('SELECT deck_id, version, format, content_hash, external_ref, created_by FROM deck_exports ORDER BY id').all().map((r) => ({ ...r }));
const audits = (db: DatabaseSync) => db.prepare("SELECT action, details FROM activity_logs WHERE entity_type = 'raise.pitch-deck'").all().map((r) => ({ ...r }));

/** The PowerPoint part of a multipart/related body, and its JSON metadata. */
function multipart(call: Call) {
  const boundary = /boundary=([^;]+)/.exec(call.headers['content-type'] || '')?.[1] as string;
  const raw = call.body as Uint8Array;
  const s = Buffer.from(raw).toString('latin1');
  const parts = s.split(`--${boundary}`).slice(1, -1);
  const meta = JSON.parse(Buffer.from(parts[0].split('\r\n\r\n')[1].trim(), 'latin1').toString('utf8'));
  const mediaStart = s.indexOf('\r\n\r\n', s.indexOf(`Content-Type: ${PPTX_MIME}`)) + 4;
  const mediaEnd = s.lastIndexOf(`\r\n--${boundary}--`);
  return { meta, file: raw.subarray(mediaStart, mediaEnd) };
}

test('2. one file is created by one POST to Drive\'s upload endpoint, converted to Slides, and recorded with its fingerprint and Drive id', async () => {
  // Mutation checked: the ledger row without external_ref → the row check fails; a second upload call → the one-call check fails;
  // the metadata asking for no conversion → the mimeType check fails.
  const f = fixture(); await f.ready();
  const g = google(() => Response.json({ id: 'drive_file_1', mimeType: SLIDES_MIME }));
  try {
    const r = await exportGoogle(f);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.created, true);
    assert.equal(r.body.file_id, 'drive_file_1');
    assert.equal(r.body.converted, true);
    assert.equal(r.body.url, 'https://docs.google.com/presentation/d/drive_file_1/edit');
    const ups = g.uploads();
    assert.equal(ups.length, 1, 'exactly one Google call');
    const u = new URL(ups[0].url);
    assert.equal(ups[0].method, 'POST');
    assert.equal(u.origin + u.pathname, 'https://www.googleapis.com/upload/drive/v3/files');
    assert.equal(u.searchParams.get('uploadType'), 'multipart');
    assert.equal(ups[0].headers.authorization, 'Bearer server-access-only');
    const { meta, file } = multipart(ups[0]);
    assert.deepEqual(meta, { name: 'Seed deck · v4', mimeType: SLIDES_MIME }, 'a new file, converted, in My Drive (no parents)');
    assert.equal(r.body.content_hash, sha(file), 'the recorded fingerprint is the uploaded file\'s');
    assert.ok(unzip(file).has('ppt/slides/slide3.xml'), 'the Sources appendix is the last slide');
    assert.deepEqual(ledger(f.db), [{ deck_id: 10, version: 4, format: 'google_slides', content_hash: sha(file), external_ref: 'drive_file_1', created_by: 1 }]);
    const a = audits(f.db);
    assert.equal(a.length, 1);
    assert.equal(a[0].action, 'deck_exported');
    assert.doesNotMatch(String(a[0].details), /Pilots|drive_file_1|Seed deck/, 'the audit row names no figure, title or file');
    assert.deepEqual(r.body.charts, { pictured: 0, as_text: 1 }, 'with no browser bound, the chart is words');
  } finally { g.restore(); }
});

test('3. a file Drive keeps as PowerPoint is said to be one, and opens in Drive\'s viewer', async () => {
  const f = fixture(); await f.ready();
  const g = google(() => Response.json({ id: 'drive_file_2', mimeType: PPTX_MIME }));
  try {
    const r = await exportGoogle(f);
    assert.equal(r.status, 200);
    assert.equal(r.body.converted, false);
    assert.equal(r.body.url, 'https://drive.google.com/file/d/drive_file_2/view');
    assert.equal(ledger(f.db)[0].external_ref, 'drive_file_2');
  } finally { g.restore(); }
});

test('4a. refusals come before any Google call, and record nothing', async () => {
  // Mutation checked: the support-session check removed → that case uploads; the company check removed → that case uploads.
  const cases: Array<[string, () => Promise<{ status: number; body: any }>, number, string]> = [];
  const mk = async (o: any, who = 1, support = false) => { const f = fixture(o); await f.ready(); return { f, run: () => exportGoogle(f, who, {}, support) }; };
  const support = await mk({}, 1, true); cases.push(['support session', support.run, 403, 'support_session_refused']);
  const none = await mk({ scope: null }); cases.push(['no Google', none.run, 409, 'google_not_connected']);
  const narrow = await mk({ scope: 'openid https://www.googleapis.com/auth/calendar.readonly' }); cases.push(['no drive.file', narrow.run, 409, 'workspace_not_allowed']);
  const off = await mk({ enabled: false }); cases.push(['company not enabled', off.run, 409, 'company_not_enabled']);
  const outsider = await mk({}, 2); cases.push(['outside the venture', outsider.run, 403, '']);
  for (const [name, run, status, code] of cases) {
    const g = google(() => Response.json({ id: 'should_not_exist', mimeType: SLIDES_MIME }));
    try {
      const r = await run();
      assert.equal(r.status, status, `${name}: ${JSON.stringify(r.body)}`);
      if (code) assert.equal(r.body.error, code, name);
      assert.equal(g.uploads().length, 0, `${name} reached Google`);
    } finally { g.restore(); }
  }
  for (const s of [support, none, narrow, off, outsider]) assert.deepEqual(ledger(s.f.db), []);
});

test('4b. Google failing records nothing and passes no provider body on; a 403 reads as files not allowed', async () => {
  for (const [status, code, http] of [[500, 'google_not_created', 503], [403, 'workspace_not_allowed', 409], [429, 'google_rate_limited', 503]] as const) {
    const f = fixture(); await f.ready();
    const g = google(() => Response.json({ error: { message: 'raw-private-provider-body' } }, { status }));
    try {
      const r = await exportGoogle(f);
      assert.equal(r.status, http);
      assert.deepEqual(r.body, { error: code });
      assert.deepEqual(ledger(f.db), []);
      assert.deepEqual(audits(f.db), []);
    } finally { g.restore(); }
  }
  // An answer with no usable id is not a created file.
  const f = fixture(); await f.ready();
  const g = google(() => Response.json({ id: '../../etc', mimeType: SLIDES_MIME }));
  try { assert.deepEqual((await exportGoogle(f)).body, { error: 'google_not_created' }); assert.deepEqual(ledger(f.db), []); } finally { g.restore(); }
});

test('4c. when the ledger cannot be written after the file exists, the answer says so and links it', async () => {
  // Mutation checked: the batch failure answered as a plain 503 → the url check fails.
  const f = fixture(); await f.ready();
  f.db.exec('DROP TABLE deck_exports');
  const g = google(() => Response.json({ id: 'drive_file_3', mimeType: SLIDES_MIME }));
  try {
    const r = await exportGoogle(f);
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { error: 'export_not_recorded_created', url: presentationUrl('drive_file_3', true), converted: true });
  } finally { g.restore(); }
});

test('4d. a presentation over 5 MB is refused before any Google call', async () => {
  // Mutation checked: the size check moved after the upload → the no-upload check fails.
  const big = (n: number) => { const b = new Uint8Array(1_900_000); b.set(PNG); b[20] = n; return b; };
  const slide = { title: 'Team', blocks: [1, 2, 3].map((k) => ({ id: `i${k}`, kind: 'image', image_url: `https://img.example.test/big${k}.png`, grid: { c1: k * 4 - 3, c2: k * 4, r1: 1, r2: 6 } })) };
  const f = fixture(); await f.ready();
  f.db.prepare('UPDATE pitch_decks SET slides = ? WHERE id = 10').run(JSON.stringify([slide]));
  const g = google(() => Response.json({ id: 'should_not_exist', mimeType: SLIDES_MIME }));
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input?.url ?? input);
    const m = /big(\d)\.png$/.exec(url);
    return m ? new Response(big(Number(m[1]))) : inner(input, init);
  }) as any;
  try {
    const r = await exportGoogle(f);
    assert.equal(r.status, 413);
    assert.deepEqual(r.body, { error: 'presentation_too_large' });
    assert.equal(g.uploads().length, 0);
    assert.ok(DRIVE_UPLOAD_MAX_BYTES === 5 * 1024 * 1024);
  } finally { globalThis.fetch = inner; g.restore(); }
});

test('5. the one write is the only one: one frozen POST with no file id, one transport, and no other Drive upload in the Worker', () => {
  // Mutation checked: a second key in GOOGLE_WORKSPACE_WRITES → the one-key check fails; a PATCH added → the method scan fails.
  assert.ok(Object.isFrozen(GOOGLE_WORKSPACE_WRITES));
  assert.deepEqual(Object.keys(GOOGLE_WORKSPACE_WRITES), ['files.create']);
  assert.deepEqual({ ...GOOGLE_WORKSPACE_WRITES['files.create'] }, { method: 'POST', origin: 'https://www.googleapis.com', path: '/upload/drive/v3/files' });
  // The code, without its comments (which name what it does not do).
  const src = read('cloudflare-worker/src/services/google/driveCreate.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal((src.match(/fetcher\(/g) || []).length, 1, 'one transport');
  assert.doesNotMatch(src, /method:\s*['"](?:PATCH|PUT|DELETE|GET)['"]/);
  assert.doesNotMatch(src, /parents|permissions|addParents|fileId|\/copy/);
  assert.match(src, /redirect: 'error'/);
  assert.match(src, /AbortSignal\.timeout\(10000\)/);
  // D1091's reader stays GET-only.
  assert.doesNotMatch(read('cloudflare-worker/src/services/google/workspace.ts'), /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/);
  // Nothing else in the Worker uploads to Drive.
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const hits = walk(resolve(ROOT, 'cloudflare-worker/src')).filter((p) => /\.(ts|js|mjs)$/.test(p)).filter((p) => /upload\/drive/.test(readFileSync(p, 'utf8')));
  assert.deepEqual(hits.map((p) => p.slice(ROOT.length + 1)), ['cloudflare-worker/src/services/google/driveCreate.ts']);
  assert.equal(driveName('A\u0000deck\n', 3), 'A deck · v3');
  assert.equal(driveName('', null), 'Pitch deck');
});

test('2b. with the headless browser bound, a chart is the print page\'s picture of its own block, from a signed print link', async () => {
  // Mutation checked: the clip left out (a whole-card shot) → the clip check fails; a non-PNG answer kept → the words fallback check fails.
  const f = fixture(); await f.ready();
  const shots: any[] = [];
  f.env.BROWSER = { fetch: async (_u: string, init: any) => { shots.push(JSON.parse(init.body)); return new Response(PNG); } };
  const g = google(() => Response.json({ id: 'drive_file_4', mimeType: SLIDES_MIME }));
  try {
    const r = await exportGoogle(f);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.charts, { pictured: 1, as_text: 0 });
    assert.equal(shots.length, 1);
    const want = blockRect(BLOCK_SLIDE.blocks[4].grid as any);
    assert.deepEqual(shots[0].screenshotOptions.clip, { x: Math.round(want.x), y: Math.round(want.y), width: Math.round(want.w), height: Math.round(want.h) });
    assert.match(shots[0].url, /^https:\/\/axal\.vc\/deck\/print-export\/[^?]+\?print_mode=single&slide=0$/);
  } finally { g.restore(); }
  // A browser answer that is not a PNG is not a picture: the chart goes in as words.
  const f2 = fixture(); await f2.ready();
  f2.env.BROWSER = { fetch: async () => new Response('<html>error</html>') };
  const g2 = google(() => Response.json({ id: 'drive_file_5', mimeType: SLIDES_MIME }));
  try { assert.deepEqual((await exportGoogle(f2)).body.charts, { pictured: 0, as_text: 1 }); } finally { g2.restore(); }
});

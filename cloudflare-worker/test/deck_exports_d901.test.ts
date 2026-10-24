/**
 * D901 (#2680) — Pitch deck studio part 7: the HTML export and the ledger.
 *
 *  1. The HTML file opens offline: no URL in any src, href or url(), no
 *     <link>, a Content-Security-Policy of `default-src 'none'`, every face
 *     and image a `data:` URI, and one script, admitted by its own hash.
 *  2. The file shows what the version holds: text escaped, an unfilled field
 *     "Not recorded", an image that is SVG or will not download says so, the
 *     notes and the Sources appendix only when asked for.
 *  3. Its keyboard rules (the canvas's "use ← → keys", Esc) work.
 *  4. Every export is recorded: one `deck_exports` row whose hash is the
 *     file's, and for HTML one `raise.pitch-deck` audit row naming no figure;
 *     the PowerPoint file decks.ts answers gets its ledger row on the way out.
 *  5. When the ledger cannot be written no file is handed out, and no audit
 *     row is left behind. Someone outside the venture gets 403 and no row.
 *
 * The real routers over HTTP (`deck_exports.ts` mounted before `decks.ts`, as
 * index.ts mounts them) on node:sqlite tables sliced from the baseline plus
 * migration 537. `fetch` serves the fixture images and nothing else.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_exports_d901.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckExports from '../src/routes/deck_exports.ts';
import decks from '../src/routes/decks.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { IMAGE_MISSING, NAV_SCRIPT, NOT_RECORDED, NO_NOTES, NO_SOURCES } from '../src/services/decks/offlineHtml.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATION = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/537_deck_exports.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-d901-0123456789-abcdef';
const TABLES = ['users', 'projects', 'pitch_decks', 'activity_logs'];

// Invented content: no real venture, person or figure.
const SLIDES = [
  { title: 'Testventure <script>alert(1)</script>', subtitle: 'Seed', body: 'Line one\nLine two', bullets: ['First', 'Second'], image_url: 'https://img.example.test/a.png', notes: 'Open with the problem.' },
  {
    title: 'Traction', fields: [
      { key: 'm', label: 'Figures', kind: 'metric_grid', value: [{ label: 'Paying customers', value: '' }, { label: 'Pilots', value: '3' }], source: 'data' },
      { key: 'p', label: 'Why now', kind: 'paragraph', value: '[Your why now]', source: 'placeholder' },
      { key: 'c', label: 'Chart', kind: 'image', value: 'https://img.example.test/b.svg', source: 'data' },
      { key: 'q', label: 'Pitch line', kind: 'paragraph', value: 'Drafted with help.', source: 'ai' },
    ],
  },
  { title: 'Ask', image_url: 'https://img.example.test/gone.png' },
];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)!));
  db.exec(MIGRATION);
  db.prepare(`INSERT INTO users (id, email, name, role, founder_id, is_active) VALUES (1, 'owner.d901@example.test', 'Founder', 'founder', 100, 1)`).run();
  db.prepare(`INSERT INTO users (id, email, name, role, is_active) VALUES (2, 'other.d901@example.test', 'Other', 'founder', 1)`).run();
  db.exec("INSERT INTO users (id, email, name, role, is_active) VALUES (3, 'admin.d901@example.test', 'Admin', 'admin', 1), (4, 'advisor.d901@example.test', 'Advisor', 'advisor', 1)");
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (1, 'Testventure Labs', 100)`).run();
  db.prepare(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (10, 1, 4, ?, 'Seed deck', 1, 1)`).run(JSON.stringify(SLIDES));
  const env: any = { DB: d1Over(db), JWT_SECRET };
  const app = new Hono<any>();
  app.route('/api/decks', deckExports);
  app.route('/api/decks', decks);
  return { db, env, app };
}

async function call(f: ReturnType<typeof fixture>, who: number, role: string, method: string, path: string, body: unknown = {}) {
  const jwt = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(`/api/decks${path}`, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body),
  }, f.env);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, bytes, text: new TextDecoder().decode(bytes) };
}

const fetched: string[] = [];
function images() {
  const real = globalThis.fetch;
  fetched.length = 0;
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url ?? input);
    fetched.push(url);
    if (url === 'https://img.example.test/a.png') return new Response(PNG, { status: 200 });
    if (url === 'https://img.example.test/b.svg') return new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', { status: 200 });
    return new Response('', { status: 404 });
  }) as any;
  return () => { globalThis.fetch = real; };
}

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const ledger = (db: DatabaseSync) => db.prepare('SELECT deck_id, version, format, content_hash, external_ref, created_by FROM deck_exports ORDER BY id').all().map((r) => ({ ...r }));
const audits = (db: DatabaseSync) => db.prepare("SELECT project_id, user_id, entity_type, action, details FROM activity_logs WHERE entity_type = 'raise.pitch-deck'").all().map((r) => ({ ...r }));

test('1. the HTML file opens offline: no URL, no <link>, default-src none, data: faces and images, one script admitted by its hash', async () => {
  // Mutation checked: an image left as its https URL → the URL scan fails; the CSP hash of another script → the hash check fails.
  const f = fixture();
  const restore = images();
  try {
    const r = await call(f, 1, 'founder', 'POST', '/10/export/html', { notes: true, sources: true });
    assert.equal(r.status, 200, r.text);
    assert.match(r.headers.get('content-type')!, /^text\/html/);
    assert.match(r.headers.get('content-disposition')!, /filename="Seed-deck-v4\.html"/);
    const html = r.text;
    assert.equal(/<link\b/i.test(html), false, 'no <link>');
    for (const m of html.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/gi)) assert.match(m[1], /^data:/, `a src/href that is not data: ${m[1].slice(0, 40)}`);
    for (const m of html.matchAll(/url\(([^)]*)\)/g)) assert.match(m[1], /^data:/, 'a CSS url() that is not data:');
    assert.equal(/https?:\/\//i.test(html.replace(/<meta http-equiv[^>]*>/, '')), false, 'no http(s) address anywhere in the file');
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1] ?? '';
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /img-src data:;/);
    assert.match(csp, /font-src data:;/);
    // Counted on the lower-cased file, so <SCRIPT>, <Script src=…> and the like count too.
    const lower = html.toLowerCase();
    assert.equal(lower.split('<script').length - 1, 1, 'exactly one script element, in any case');
    const open = lower.indexOf('<script>');
    assert.ok(open > 0, 'the one script has no attributes (no src)');
    const body = html.slice(open + '<script>'.length, lower.indexOf('</script', open));
    assert.equal(body, NAV_SCRIPT, 'the one script is the navigation');
    const hash = createHash('sha256').update(NAV_SCRIPT).digest('base64');
    assert.ok(csp.includes(`script-src 'sha256-${hash}'`), 'the policy admits that script by its hash, and nothing else');
    assert.equal((html.match(/@font-face/g) || []).length, 3);
    assert.ok(html.includes(`<img src="data:image/png;base64,${Buffer.from(PNG).toString('base64')}"`), 'the PNG is inline');
    assert.deepEqual(fetched.sort(), ['https://img.example.test/a.png', 'https://img.example.test/b.svg', 'https://img.example.test/gone.png']);
  } finally { restore(); }
});

test('2. the file shows what the version holds: escaped, "Not recorded", missing images said, notes and Sources only when asked', async () => {
  // Mutation checked: placeholder text rendered → the sample check fails; the SVG admitted → the missing count fails; notes always on → the off case fails.
  const f = fixture();
  const restore = images();
  try {
    const on = (await call(f, 1, 'founder', 'POST', '/10/export/html', { notes: true, sources: true })).text;
    assert.ok(!on.includes('<script>alert(1)'), 'a title cannot open a script');
    assert.ok(on.includes('Testventure &lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(on.includes('Line one<br>Line two'));
    assert.ok(!on.includes('[Your why now]'), 'an unfilled template field is never shown as if it were content');
    assert.ok(on.includes(`Why now: ${NOT_RECORDED}`));
    assert.ok(on.includes(`<dt>Paying customers</dt><dd>${NOT_RECORDED}</dd>`), 'an empty figure is Not recorded, never 0');
    assert.ok(on.includes('<dt>Pilots</dt><dd>3</dd>'));
    assert.equal(on.split(IMAGE_MISSING).length - 1, 2, 'the SVG and the image that would not download each say so');
    assert.ok(on.includes('Open with the problem.'));
    assert.equal(on.split(NO_NOTES).length - 1, 2, 'the two cards with no notes say so');
    assert.ok(on.includes(NO_SOURCES));
    assert.ok(on.includes('Written with AI help: card 2 (Traction).'));
    assert.ok(on.includes('<span id="count">4 cards</span>'), 'three cards and the Sources appendix');

    const off = (await call(f, 1, 'founder', 'POST', '/10/export/html', {})).text;
    assert.ok(!off.includes('Speaker notes') && !off.includes('Open with the problem.'), 'notes stay out unless asked for');
    assert.ok(!off.includes(NO_SOURCES), 'no appendix unless asked for');
    assert.ok(off.includes('<span id="count">3 cards</span>'));
    assert.ok(off.includes('Built with Axal VC'), 'a venture with no paid owner keeps the footer');
  } finally { restore(); }
});

test('3. the keyboard rules: → and ← move one card, Home and End, Esc shows all and back', () => {
  // Mutation checked: Esc not toggling → the all-cards check fails; no clamp at the end → End then → leaves no card shown.
  const cards = [0, 1, 2, 3].map(() => ({ hidden: false, scrollIntoView() {} }));
  const count = { textContent: '' };
  let onKey: (e: any) => void = () => {};
  const document = {
    querySelectorAll: () => cards,
    getElementById: () => count,
    addEventListener: (_t: string, fn: any) => { onKey = fn; },
  };
  new Function('document', NAV_SCRIPT)(document);
  const shown = () => cards.map((c, i) => (c.hidden ? null : i)).filter((i) => i !== null);
  const key = (k: string) => onKey({ key: k, preventDefault() {} });
  assert.deepEqual(shown(), [0]);
  assert.equal(count.textContent, '1 of 4 · use ← → keys · Esc shows all');
  key('ArrowRight'); assert.deepEqual(shown(), [1]);
  key('ArrowLeft'); key('ArrowLeft'); assert.deepEqual(shown(), [0], 'no card before the first');
  key('End'); key('ArrowRight'); assert.deepEqual(shown(), [3], 'no card after the last');
  key('Home'); assert.deepEqual(shown(), [0]);
  key('PageDown'); key(' '); assert.deepEqual(shown(), [2]);
  key('Escape'); assert.deepEqual(shown(), [0, 1, 2, 3]);
  assert.match(count.textContent, /^All 4 cards/);
  key('Escape'); assert.deepEqual(shown(), [2], 'Esc again returns to the card you were on');
});

test('4. every export is recorded: the HTML file and its audit row, the PowerPoint file on its way out of decks.ts', async () => {
  // Mutation checked: the batch without the audit row → the audit count fails; the middleware skipped → the pptx row is missing.
  const f = fixture();
  const restore = images();
  try {
    const html = await call(f, 1, 'founder', 'POST', '/10/export/html', { notes: true });
    assert.equal(html.headers.get('x-content-sha256'), sha(html.bytes));
    const pptx = await call(f, 1, 'founder', 'POST', '/10/export', { format: 'pptx' });
    assert.equal(pptx.status, 200, pptx.text);
    assert.equal(pptx.headers.get('x-content-sha256'), sha(pptx.bytes), 'the hash is of the file handed out');
    assert.deepEqual(ledger(f.db), [
      { deck_id: 10, version: 4, format: 'html', content_hash: sha(html.bytes), external_ref: null, created_by: 1 },
      { deck_id: 10, version: 4, format: 'pptx', content_hash: sha(pptx.bytes), external_ref: null, created_by: 1 },
    ]);
    // The PDF and PowerPoint audit row is part 1's (#2674): this middleware writes none.
    assert.deepEqual(audits(f.db), [{ project_id: 1, user_id: 1, entity_type: 'raise.pitch-deck', action: 'deck_exported', details: 'Deck exported as HTML' }, { project_id: 1, user_id: 1, entity_type: 'raise.pitch-deck', action: 'deck_exported', details: 'Deck exported' }]);
    assert.doesNotMatch(audits(f.db)[0].details as string, /\d/, 'the audit row names no figure');

    const list = await call(f, 1, 'founder', 'GET', '/10/exports');
    const rows = JSON.parse(list.text).exports;
    assert.deepEqual(rows.map((r: any) => [r.format, r.version, r.by]), [['pptx', 4, 'Founder'], ['html', 4, 'Founder']]);

    const again = await call(f, 1, 'founder', 'POST', '/10/export/html', { notes: true });
    assert.equal(sha(again.bytes), sha(html.bytes), 'the same version and options make the same file');
    const bad = await call(f, 1, 'founder', 'POST', '/10/export', { format: 'html' });
    assert.equal(bad.status, 400);
    assert.equal(ledger(f.db).length, 3, 'a refused export records nothing');
  } finally { restore(); }
});

test('5. no ledger, no file; someone outside the venture gets 403 and no row', async () => {
  // Mutation checked: the file returned when the insert fails → the 503 check fails; the audit written outside the batch → an audit row is left.
  const f = fixture();
  const restore = images();
  try {
    const outsider = await call(f, 2, 'founder', 'POST', '/10/export/html', {});
    assert.equal(outsider.status, 403);
    assert.equal((await call(f, 2, 'founder', 'GET', '/10/exports')).status, 403);
    assert.equal((await call(f, 1, 'founder', 'POST', '/999/export/html', {})).status, 404);
    assert.deepEqual(ledger(f.db), []);

    f.db.exec('DROP TABLE deck_exports');
    const r = await call(f, 1, 'founder', 'POST', '/10/export/html', {});
    assert.equal(r.status, 503);
    const body = JSON.parse(r.text);
    assert.equal(body.error, 'export_not_recorded');
    assert.ok(body.message.includes('Nothing was shared.'));
    assert.ok(!r.text.includes('<html'), 'no file is handed out');
    assert.deepEqual(audits(f.db), [], 'HTML audit and ledger fail atomically');
    const p = await call(f, 1, 'founder', 'POST', '/10/export', { format: 'pptx' });
    assert.equal(p.status, 503, 'the PowerPoint file is held back too');
    // D895 logs the route attempt before the recording middleware can withhold its file.
    assert.deepEqual(audits(f.db), [{ project_id: 1, user_id: 1, entity_type: 'raise.pitch-deck', action: 'deck_exported', details: 'Deck exported' }]);
  } finally { restore(); }
});

test('D895 remains the export boundary: founders export, admins only read, advisors read nothing', async () => {
  const f = fixture();
  await ensureProjectMembershipSchema(f.env);
  f.db.exec("INSERT INTO project_members (project_id, user_id, role, status) VALUES (1, 4, 'advisor', 'accepted')");
  const restore = images();
  try {
    assert.equal((await call(f, 1, 'founder', 'POST', '/10/export/html', {})).status, 200);
    const before = ledger(f.db);
    const beforeAudit = audits(f.db);
    for (const [who, role] of [[3, 'admin'], [4, 'advisor']] as const) {
      assert.equal((await call(f, who, role, 'POST', '/10/export/html', {})).status, 403);
      for (const format of ['pdf', 'pptx']) assert.equal((await call(f, who, role, 'POST', '/10/export', { format })).status, 403);
    }
    assert.equal((await call(f, 3, 'admin', 'GET', '/10/exports')).status, 200);
    const advisor = await call(f, 4, 'advisor', 'GET', '/10/exports');
    assert.equal(advisor.status, 403);
    assert.equal(JSON.stringify(JSON.parse(advisor.text)).includes('content_hash'), false);
    assert.deepEqual(ledger(f.db), before);
    assert.deepEqual(audits(f.db), beforeAudit);
  } finally { restore(); }
});

/**
 * D1112 (#2992, part of #2434) — the Worker half of the Pitch deck frontend
 * gaps S1's check confirmed on D894:
 *
 *   1. PD2's Shared links column: each version's links ever made, from the
 *      versions read, and null (never 0) when the count cannot be read;
 *   2. PD17's two options travel inside the signed print token, and the print
 *      payload carries the notes and the Sources appendix only when it says so;
 *   3. PDF and PowerPoint take the options: the token the headless browser
 *      opens carries them; PowerPoint photographs one more page for the
 *      appendix and puts each card's notes in its speaker notes;
 *   4. the HTML file draws a card from D898's blocks, and still asks for nothing.
 *
 * The real routers (`deck_exports.ts` before `decks.ts`, as index.ts mounts
 * them) on node:sqlite tables sliced from the baseline plus migration 537.
 * Every venture, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/pitch_deck_gaps_d1112.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckExports from '../src/routes/deck_exports.ts';
import decks, { printDeckOf, signDeckPrintToken, verifyDeckPrintToken } from '../src/routes/decks.ts';
import { NOT_RECORDED, imageUrlsOf, writeOfflineDeck } from '../src/services/decks/offlineHtml.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATION = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/537_deck_exports.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-d1112-0123456789-abcdef';
const TABLES = ['users', 'projects', 'pitch_decks', 'activity_logs'];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

const BINDING = { source_key: 'validate.interviews', record_ref: 'r1', as_of: '2026-10-12', grade: 'Measured', snapshot_hash: 'a'.repeat(64) };
// Invented content. Card 1 is fielded and bound, with notes; card 2 is laid out on the grid; card 3 has no notes.
const SLIDES = [
  { title: 'Traction', fields: [{ key: 'r', label: 'Round size', kind: 'paragraph', value: 'Round size · $2M', source: 'data', binding: BINDING }], notes: 'Lead with the pilots.' },
  {
    title: 'Grid', notes: 'Point at the tile.', blocks: [
      { id: 'h', kind: 'text', style: 'heading', text: 'Why we win', grid: { c1: 1, c2: 12, r1: 1, r2: 1 } },
      { id: 'm1', kind: 'metric', label: 'Pilots', value: '3', grid: { c1: 1, c2: 3, r1: 2, r2: 3 }, binding: BINDING },
      { id: 'm2', kind: 'metric', label: 'Paying customers', value: null, grid: { c1: 4, c2: 6, r1: 2, r2: 3 } },
      { id: 'c', kind: 'chart', chart_type: 'ranked_bars', series: [{ label: 'Signups', points: [{ x: 'Jan', y: 4 }, { x: 'Feb', y: 9 }] }], grid: { c1: 7, c2: 12, r1: 2, r2: 4 } },
      { id: 'v', kind: 'video', provider: 'youtube', video_id: 'abc', url: 'https://www.youtube.com/watch?v=abc', title: 'Demo', grid: { c1: 1, c2: 4, r1: 4, r2: 5 } },
      { id: 'l', kind: 'link', url: 'https://example.test/data-room', label: 'Data room', grid: { c1: 5, c2: 7, r1: 5, r2: 5 } },
      { id: 'i', kind: 'image', image_url: 'https://img.example.test/team.png', alt: 'Team', grid: { c1: 8, c2: 12, r1: 5, r2: 6 } },
    ],
  },
  { title: 'Ask', fields: [{ key: 'a', label: 'Ask', kind: 'paragraph', value: 'Raising $2M', source: 'data' }] },
];

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)!));
  db.exec(MIGRATION);
  db.prepare(`INSERT INTO users (id, email, name, role, founder_id, is_active) VALUES (1, 'owner.d1112@example.test', 'Founder', 'founder', 100, 1)`).run();
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (1, 'Testventure Labs', 100)`).run();
  db.prepare(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (10, 1, 4, ?, 'Seed deck', 1, 1), (11, 1, 3, '[]', 'Seed deck', 0, 1)`).run(JSON.stringify(SLIDES));
  const env: any = { DB: d1Over(db), JWT_SECRET, PUBLIC_BASE_URL: 'https://axal.test' };
  const app = new Hono<any>();
  app.route('/api/decks', deckExports);
  app.route('/api/decks', decks);
  return { db, env, app };
}

async function call(f: ReturnType<typeof fixture>, method: string, path: string, body: unknown = {}, env = f.env) {
  const jwt = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await f.app.request(`/api/decks${path}`, {
      method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body),
    }, env);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, bytes, text: new TextDecoder().decode(bytes) };
  } finally { [console.warn, console.error] = saved; }
}

/** A Browser Rendering stand-in: records each URL it is asked to open; PDF and PNG bytes back. */
function browser() {
  const urls: string[] = [];
  return {
    urls,
    binding: { fetch: async (u: string, init: any) => { urls.push(JSON.parse(init.body).url); return new Response(u.endsWith('/pdf') ? new TextEncoder().encode('%PDF-1.4') : PNG, { status: 200 }); } },
  };
}
const tokenOf = (url: string) => decodeURIComponent(/print-export\/([^?]+)/.exec(url)![1]);

test('1. the versions read carries each version\'s Shared links, and null when the count cannot be read', async () => {
  // Mutation checked: the count read as 0 when it fails → the null assertion fails; one count for every version → v3's 0 fails.
  const f = fixture();
  await call(f, 'GET', '/by-project/1');
  f.db.exec(`INSERT INTO pitch_deck_share_tokens (deck_id, token_hash, expires_at) VALUES (10, 'h1', '2999-01-01'), (10, 'h2', '2999-01-01')`);
  let r = await call(f, 'GET', '/by-project/1');
  assert.equal(r.status, 200);
  let body = JSON.parse(r.text);
  assert.deepEqual(body.versions.map((v: any) => [v.version, v.shared_links]), [[4, 2], [3, 0]], 'a version with none is a counted 0');
  assert.equal(body.shared_links_readable, true);

  const broken = { ...f.env, DB: new Proxy(f.env.DB, { get: (t: any, k) => (k === 'prepare' ? (sql: string) => { if (/COUNT\(\*\) AS n FROM pitch_deck_share_tokens/.test(sql)) throw new Error('no such table'); return t.prepare(sql); } : t[k]) }) };
  r = await call(f, 'GET', '/by-project/1', {}, broken);
  body = JSON.parse(r.text);
  assert.equal(r.status, 200, 'the versions still read');
  assert.deepEqual(body.versions.map((v: any) => v.shared_links), [null, null], 'an unread count is null, never 0');
  assert.equal(body.shared_links_readable, false);
});

test('2. the options ride the signed token; the print payload carries notes and sources only when it says so', async () => {
  // Mutation checked: notes always kept → the plain payload's notes fail; the flags ignored by verify → the flagged one fails.
  const f = fixture();
  const plain = await verifyDeckPrintToken(f.env, await signDeckPrintToken(f.env, 10));
  assert.deepEqual(plain, { deckId: 10, notes: false, sources: false });
  assert.deepEqual(await verifyDeckPrintToken(f.env, await signDeckPrintToken(f.env, 10, 60, { notes: true, sources: false })), { deckId: 10, notes: true, sources: false });
  assert.deepEqual(await verifyDeckPrintToken(f.env, await signDeckPrintToken(f.env, 10, 60, { notes: false, sources: true })), { deckId: 10, notes: false, sources: true });
  // A token edited to add a flag no longer verifies.
  const t = await signDeckPrintToken(f.env, 10);
  const [p, sig] = t.split('.');
  const forged = `${Buffer.from(`${Buffer.from(p, 'base64url').toString()}|ns`).toString('base64url')}.${sig}`;
  assert.equal(await verifyDeckPrintToken(f.env, forged), null);

  let r = await call(f, 'GET', `/print-export/${await signDeckPrintToken(f.env, 10)}`);
  let deck = JSON.parse(r.text);
  assert.ok(deck.slides.every((s: any) => !('notes' in s)), 'no notes leave without the option');
  assert.equal(deck.sources_appendix, undefined);
  assert.deepEqual(deck.export_options, { notes: false, sources: false });

  r = await call(f, 'GET', `/print-export/${await signDeckPrintToken(f.env, 10, 60, { notes: true, sources: true })}`);
  deck = JSON.parse(r.text);
  assert.deepEqual(deck.slides.map((s: any) => s.notes), ['Lead with the pilots.', 'Point at the tile.', null]);
  assert.deepEqual(deck.sources_appendix.lines.map((l: any) => [l.card, l.figure]), [[1, 'Interviews'], [2, 'Interviews']]);
  assert.match(deck.sources_appendix.lines[0].line, /Measured · as of 2026-10-12/);
  assert.equal(printDeckOf({ ...f.db.prepare('SELECT * FROM pitch_decks WHERE id = 11').get() }, { notes: false, sources: true }).sources_appendix.lines.length, 0);
});

test('3. PDF and PowerPoint take the options: the token carries them, the appendix is one more page, the notes are the speaker notes', async () => {
  // Mutation checked: the options dropped from the token → PDF's flags fail; no extra page → 4 screenshots fail;
  // the notes slide always the card's text → the notes assertion fails.
  const f = fixture();
  let b = browser();
  let r = await call(f, 'POST', '/10/export', { format: 'pdf', notes: true, sources: true }, { ...f.env, BROWSER: b.binding });
  assert.equal(r.status, 200);
  assert.deepEqual(await verifyDeckPrintToken(f.env, tokenOf(b.urls[0])), { deckId: 10, notes: true, sources: true });
  b = browser();
  await call(f, 'POST', '/10/export', { format: 'pdf' }, { ...f.env, BROWSER: b.binding });
  assert.deepEqual(await verifyDeckPrintToken(f.env, tokenOf(b.urls[0])), { deckId: 10, notes: false, sources: false }, 'nothing asked, nothing carried');

  b = browser();
  r = await call(f, 'POST', '/10/export', { format: 'pptx', notes: true, sources: true }, { ...f.env, BROWSER: b.binding });
  assert.equal(r.status, 200);
  assert.deepEqual(b.urls.map((u) => /slide=(\d+)/.exec(u)![1]), ['0', '1', '2', '3'], 'three cards and the Sources appendix');
  assert.ok(r.text.includes('ppt/slides/slide4.xml'));
  assert.ok(r.text.includes('Lead with the pilots.') && r.text.includes('Point at the tile.'), 'the speaker notes');
  assert.ok(r.text.includes('No notes on this card.'), 'a card with none says so');

  b = browser();
  r = await call(f, 'POST', '/10/export', { format: 'pptx' }, { ...f.env, BROWSER: b.binding });
  assert.equal(b.urls.length, 3, 'no appendix unasked');
  assert.ok(!r.text.includes('Lead with the pilots.'), 'no speaker notes unasked');
  assert.ok(r.text.includes('Raising $2M'), 'the notes slide keeps the card\'s text, as before');
});

test('4. the HTML file draws a card from its blocks, and still asks for nothing', async () => {
  // Mutation checked: blocks ignored → the tile and chart assertions fail; a link as an href → the href scan fails;
  // an empty tile as 0 → the Not recorded assertion fails.
  assert.deepEqual(imageUrlsOf(SLIDES), ['https://img.example.test/team.png'], 'a block\'s image is fetched like any other');
  const html = await writeOfflineDeck({
    title: 'Seed deck', version: 4, slides: SLIDES, images: new Map([['https://img.example.test/team.png', 'data:image/png;base64,iVBORw0KGgo=']]),
    footer: null, watermark: null, notes: false, sources: false,
  });
  const grid = html.slice(html.indexOf('id="card-2"'), html.indexOf('id="card-3"'));
  assert.match(grid, /<div class="blocks">/);
  assert.match(grid, /grid-column:1 \/ 13;grid-row:1 \/ 2"><h3>Why we win<\/h3>/);
  assert.match(grid, /<div class="tile"><span>Pilots<\/span><b>3<\/b><\/div>/);
  assert.match(grid, new RegExp(`<span>Paying customers</span><b class="nr">${NOT_RECORDED}</b>`));
  assert.match(grid, /Ranked bars chart<\/b><ul><li>Signups: Jan 4 · Feb 9<\/li>/);
  assert.match(grid, /<p class="btn">▶ Demo<\/p><p class="addr">www\.youtube\.com\/watch\?v=abc<\/p>/);
  assert.match(grid, /<p class="btn">Data room<\/p><p class="addr">example\.test\/data-room<\/p>/);
  assert.match(grid, /<img src="data:image\/png;base64,/);
  assert.doesNotMatch(html, /(src|href)="https?:/, 'no URL the file would load or follow');
  // A fielded card is still drawn from its fields.
  assert.match(html.slice(html.indexOf('id="card-3"')), /<p>Raising \$2M<\/p>/);
});

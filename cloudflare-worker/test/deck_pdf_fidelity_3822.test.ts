/**
 * D1575 (#3822, deck v2 E2) — the PDF matches the screen: it prints at the
 * deck's aspect and is checked before it is handed out.
 *
 *   · `printPageOf`: a studio deck prints at its aspect (1440 × 1080 at 4:3),
 *     a template deck at 1920 × 1080;
 *   · `pdfRenderOptions`: the viewport, the `@page` size and the PDF size agree;
 *   · `expectedLinks` / `hasWords`: what the print cards draw live;
 *   · `checkDeckPdf`: page size, fonts embedded, words as text, links live;
 *   · the route: a 4:3 deck renders at 1440, and a PDF that fails the check
 *     is a 502 `pdf_fidelity_failed` with codes only, no ledger row, no audit.
 *
 * Every venture, person, figure and URL is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_pdf_fidelity_3822.test.ts
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
import decks from '../src/routes/decks.ts';
import { SLIDE_SIZES, checkDeckPdf, expectedLinks, hasWords, pdfRenderOptions, printPageOf } from '../src/services/decks/pdfExport.ts';
import { deckPdf } from './_deck_pdf.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATION = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/537_deck_exports.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-3822-0123456789-abcdef';
const TABLES = ['users', 'projects', 'pitch_decks', 'activity_logs'];

const SITE = 'https://example.test/pilot';
const STUDIO = [
  { title: 'Problem', blocks: [
    { id: 'b1', kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 2 }, style: 'heading', text: 'Ledgers drift' },
    { id: 'b2', kind: 'link', grid: { c1: 1, c2: 4, r1: 5, r2: 5 }, label: 'Pilot', url: SITE },
  ] },
  { title: 'Ask', blocks: [{ id: 'b3', kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 3 }, style: 'paragraph', text: 'Raising $2M' }] },
];
const TEMPLATE = [{ title: 'Problem', method_id: 'synthetic-method', fields: [{ key: 'p', label: 'Problem', kind: 'paragraph', value: 'Ledgers drift', source: 'data' }] }];
const P169 = { aspect: '16:9' as const, ...SLIDE_SIZES['16:9'] };
const P43 = { aspect: '4:3' as const, ...SLIDE_SIZES['4:3'] };

test('1. printPageOf: a studio deck prints at its aspect, a template deck at 1920 × 1080', () => {
  // Mutation checked: the aspect read for every deck → the template case is 1440; the studio rule dropped → the 4:3 studio case is 1920.
  assert.deepEqual(printPageOf({ slides: STUDIO, theme: { aspect: '4:3' }, methodId: null }), { aspect: '4:3', width: 1440, height: 1080 });
  assert.deepEqual(printPageOf({ slides: STUDIO, theme: null, methodId: null }), { aspect: '16:9', width: 1920, height: 1080 });
  assert.deepEqual(printPageOf({ slides: STUDIO, theme: { aspect: 'square' }, methodId: null }), P169, 'an aspect it does not know prints 16:9');
  assert.deepEqual(printPageOf({ slides: TEMPLATE, theme: { aspect: '4:3' }, methodId: 'synthetic-method' }), P169, 'a template deck stays 1920 × 1080');
  assert.deepEqual(printPageOf({ slides: [{ title: 'Only a title' }], theme: { aspect: '4:3' }, methodId: null }), P169, 'no card on The Grid: as before');
});

test('2. pdfRenderOptions: the viewport, the @page size and the PDF size are one page', () => {
  // Mutation checked: the PDF width left at 1920px → the 4:3 width check fails.
  for (const page of [P169, P43]) {
    const o: any = pdfRenderOptions('https://axal.test/deck/print-export/t?print_mode=pdf', page, 1000);
    assert.deepEqual(o.viewport, { width: page.width, height: page.height, deviceScaleFactor: 1 });
    assert.match(o.addStyleTag[0].content, new RegExp(`@page \\{ size: ${page.width}px ${page.height}px; margin: 0; \\}`));
    assert.deepEqual([o.pdfOptions.width, o.pdfOptions.height], [`${page.width}px`, `${page.height}px`]);
    assert.equal(o.pdfOptions.preferCSSPageSize, true);
    assert.equal(o.pdfOptions.printBackground, true);
    assert.equal(o.gotoOptions.timeout, 1000);
  }
});

test('3. expectedLinks: only the links the print cards draw live, normalised once each; hasWords reads every place words live', () => {
  // Mutation checked: mp4 counted → the uploaded video's URL appears; http runs kept → the http run appears; the text-with-words rule dropped → the empty block's run appears.
  const slides = [{ blocks: [
    { kind: 'link', url: 'https://example.test/a' },
    { kind: 'button', url: 'https://example.test/a' },
    { kind: 'audio', url: 'https://example.test/clip.mp3' },
    { kind: 'video', provider: 'youtube', url: 'https://video.example.test/watch?v=1' },
    { kind: 'video', provider: 'mp4', url: 'https://example.test/upload.mp4' },
    { kind: 'link', url: 'javascript:alert(1)' },
    { kind: 'link', url: '' },
    { kind: 'text', text: 'Read more', paras: [{ runs: [{ text: 'Read ', href: 'https://Example.test' }, { text: 'more', href: 'http://example.test/plain' }, { text: '', href: 'https://example.test/empty-run' }] }] },
    { kind: 'text', text: '   ', paras: [{ runs: [{ text: 'hidden', href: 'https://example.test/hidden' }] }] },
    { kind: 'image', url: 'https://example.test/not-a-link.png' },
  ] }];
  assert.deepEqual(expectedLinks(slides), [
    'https://example.test/',
    'https://example.test/a',
    'https://example.test/clip.mp3',
    'https://video.example.test/watch?v=1',
  ]);
  assert.deepEqual(expectedLinks([{ title: 'No blocks' }]), []);

  assert.equal(hasWords(STUDIO), true);
  assert.equal(hasWords(TEMPLATE), true);
  assert.equal(hasWords([{ title: '  ', blocks: [{ kind: 'image', url: 'https://example.test/i.png' }] }]), false, 'a picture-only deck needs no font');
});

test('4. checkDeckPdf: page size, fonts embedded, words as text and links live — each a code, the URL never one', async () => {
  // Mutation checked: the size tolerance widened to 400pt → the 4:3 page passes as 16:9; FontFile2 not counted → the embedded font fails;
  // the Type0 descendant not followed → the Type0 font fails; the URI read skipped → links_missing on a PDF that has the link.
  assert.deepEqual(await checkDeckPdf(await deckPdf({ pages: 2, links: [SITE] }), P169, { links: [SITE], words: true }), { ok: true, pages: 2 });
  assert.deepEqual(await checkDeckPdf(await deckPdf({ width: 1440, height: 1080 }), P43), { ok: true, pages: 1 });
  assert.deepEqual(await checkDeckPdf(await deckPdf({ font: 'type0' }), P169), { ok: true, pages: 1 });

  assert.deepEqual(await checkDeckPdf(await deckPdf({ width: 1440, height: 1080 }), P169), { ok: false, codes: ['page_size'], pages: 1 });
  assert.deepEqual(await checkDeckPdf(await deckPdf(), P43), { ok: false, codes: ['page_size'], pages: 1 }, 'a 4:3 deck on a 16:9 sheet');
  assert.deepEqual(await checkDeckPdf(await deckPdf({ font: 'not_embedded' }), P169), { ok: false, codes: ['font_not_embedded'], pages: 1 });
  assert.deepEqual(await checkDeckPdf(await deckPdf({ font: 'none' }), P169, { words: true }), { ok: false, codes: ['text_flattened'], pages: 1 });
  assert.deepEqual(await checkDeckPdf(await deckPdf({ font: 'none' }), P169, { words: false }), { ok: true, pages: 1 }, 'a deck with no words needs no font');

  const missing = await checkDeckPdf(await deckPdf({ links: ['https://example.test/other'] }), P169, { links: [SITE] });
  assert.deepEqual(missing, { ok: false, codes: ['links_missing'], pages: 1 });
  assert.doesNotMatch(JSON.stringify(missing), /example\.test/, 'no URL in a code');

  const several = await checkDeckPdf(await deckPdf({ width: 1440, height: 1080, font: 'not_embedded' }), P169, { links: [SITE] });
  assert.deepEqual(several.ok ? [] : [...several.codes].sort(), ['font_not_embedded', 'links_missing', 'page_size']);

  assert.deepEqual(await checkDeckPdf(new TextEncoder().encode('%PDF-1.7 synthetic'), P169), { ok: false, codes: ['unreadable'], pages: 0 });
});

// ── The route ────────────────────────────────────────────────────────────────

function fixture(slides: unknown[], theme: unknown = null) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)!));
  db.exec(MIGRATION);
  try { db.exec('ALTER TABLE pitch_decks ADD COLUMN theme_json TEXT'); } catch { /* already there */ }
  db.prepare(`INSERT INTO users (id, email, name, role, founder_id, is_active) VALUES (1, 'owner.3822@example.test', 'Founder', 'founder', 100, 1)`).run();
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (1, 'Testventure Labs', 100)`).run();
  db.prepare(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by, theme_json) VALUES (10, 1, 2, ?, 'Seed deck', 1, 1, ?)`)
    .run(JSON.stringify(slides), theme ? JSON.stringify(theme) : null);
  const env: any = { DB: d1Over(db), JWT_SECRET, PUBLIC_BASE_URL: 'https://axal.test' };
  const app = new Hono<any>();
  app.route('/api/decks', deckExports);
  app.route('/api/decks', decks);
  return { db, env, app };
}

function browser(pdf: Uint8Array) {
  const calls: any[] = [];
  return {
    calls,
    binding: {
      fetch: async () => { throw new Error('never BROWSER.fetch'); },
      quickAction: async (_action: string, o: any) => { calls.push(o); return new Response(pdf, { status: 200 }); },
    },
  };
}

async function exportPdf(f: ReturnType<typeof fixture>, BROWSER: unknown) {
  const jwt = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await f.app.request('/api/decks/10/export', {
      method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ format: 'pdf' }),
    }, { ...f.env, BROWSER });
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* a file */ }
    return { status: res.status, text, json };
  } finally { [console.warn, console.error] = saved; }
}
const ledger = (f: ReturnType<typeof fixture>) => f.db.prepare('SELECT format FROM deck_exports').all().map((r: any) => r.format);
const audits = (f: ReturnType<typeof fixture>) => (f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs").get() as any).n;

test('5. the route: a 4:3 studio deck renders on 1440 × 1080 and its checked PDF is handed out', async () => {
  // Mutation checked: the route back on the fixed 1920 viewport → the 1440 checks fail; the check fed 16:9 → the 1440 PDF is refused.
  const f = fixture(STUDIO, { kind: 'neutral_light', aspect: '4:3' });
  const b = browser(await deckPdf({ width: 1440, height: 1080, pages: 2, links: [SITE] }));
  const r = await exportPdf(f, b.binding);
  assert.equal(r.status, 200, r.text.slice(0, 300));
  assert.equal(b.calls.length, 1);
  assert.deepEqual(b.calls[0].viewport, { width: 1440, height: 1080, deviceScaleFactor: 1 });
  assert.equal(b.calls[0].pdfOptions.width, '1440px');
  assert.match(b.calls[0].addStyleTag[0].content, /@page \{ size: 1440px 1080px;/);
  assert.deepEqual(ledger(f), ['pdf']);
  assert.ok(audits(f) >= 1, 'the export is audited');
});

test('6. the route: a PDF that does not match the screen is a 502 with codes only — never handed out, recorded or audited', async () => {
  // Mutation checked: the check skipped → 200 and a ledger row; the check fed 16:9 → the 1920 PDF of a 4:3 deck passes.
  let f = fixture(STUDIO, { kind: 'neutral_light', aspect: '4:3' });
  let r = await exportPdf(f, browser(await deckPdf({ width: 1920, height: 1080, links: [SITE] })).binding);
  assert.equal(r.status, 502);
  assert.equal(r.json.error, 'pdf_fidelity_failed');
  assert.equal(r.json.message, 'The PDF did not come out as the deck shows. Try again in a moment.');
  assert.deepEqual(r.json.diagnostic, { reason: 'pdf_fidelity', checks: ['page_size'], pages: 1 });
  assert.doesNotMatch(r.text, /print-export|axal\.test|example\.test/, 'never the signed URL or a link');
  assert.deepEqual(ledger(f), []);
  assert.equal(audits(f), 0);

  f = fixture(STUDIO);
  r = await exportPdf(f, browser(await deckPdf({ width: 1920, height: 1080 })).binding);
  assert.equal(r.status, 502);
  assert.deepEqual(r.json.diagnostic.checks, ['links_missing'], 'the card\'s link is not live in the PDF');

  f = fixture(STUDIO);
  r = await exportPdf(f, browser(await deckPdf({ font: 'none', links: [SITE] })).binding);
  assert.deepEqual(r.json.diagnostic.checks, ['text_flattened']);
  assert.deepEqual(ledger(f), []);
});

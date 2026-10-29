/**
 * #3655 — PDF and PowerPoint exports render through Browser Run's documented
 * `quickAction`, with a bounded retry, a code-only diagnostic and a truthful
 * ledger.
 *
 *   · `renderUrl`: only a checked PDF or PNG is an answer; one retry, only for
 *     what can pass on a second try; a deadline no attempt starts after;
 *   · the PDF and PowerPoint routes: never `BROWSER.fetch`; a failed render is
 *     a 502 with `diagnostic` codes (never the signed print URL) and no ledger
 *     row; a retried render records one export, not two; at most three slide
 *     pictures at once.
 *
 * Every venture, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_export_render_3655.test.ts
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
import decks, { PPTX_RENDER_CONCURRENCY } from '../src/routes/decks.ts';
import { DECK_RENDER_ATTEMPTS, renderUrl } from '../src/services/browserRun.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATION = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/537_deck_exports.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-3655-0123456789-abcdef';
const TABLES = ['users', 'projects', 'pitch_decks', 'activity_logs'];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
const PDF = new TextEncoder().encode('%PDF-1.7 synthetic');
const SLIDES = [
  { title: 'Problem', fields: [{ key: 'p', label: 'Problem', kind: 'paragraph', value: 'Ledgers drift', source: 'data' }] },
  { title: 'Traction', fields: [{ key: 't', label: 'Pilots', kind: 'paragraph', value: 'Three pilots', source: 'data' }] },
  { title: 'Ask', fields: [{ key: 'a', label: 'Ask', kind: 'paragraph', value: 'Raising $2M', source: 'data' }] },
];

const NEVER_FETCH = async () => { throw new Error('BROWSER.fetch is the made-up host; #3655 never calls it'); };

/** A Browser Run stand-in: `answer(action, options, n)` decides each answer; every call is kept. */
function browser(answer: (action: string, o: any, n: number) => Response | Promise<Response>) {
  const calls: { action: string; o: any }[] = [];
  let inFlight = 0;
  const peak = { n: 0 };
  return {
    calls, peak,
    binding: {
      fetch: NEVER_FETCH,
      quickAction: async (action: string, o: any) => {
        const n = calls.push({ action, o });
        inFlight += 1; peak.n = Math.max(peak.n, inFlight);
        try { await new Promise((r) => setTimeout(r, 5)); return await answer(action, o, n); } finally { inFlight -= 1; }
      },
    },
  };
}
const ok = (action: string) => new Response(action === 'pdf' ? PDF : PNG, { status: 200 });

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)!));
  db.exec(MIGRATION);
  db.prepare(`INSERT INTO users (id, email, name, role, founder_id, is_active) VALUES (1, 'owner.3655@example.test', 'Founder', 'founder', 100, 1)`).run();
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (1, 'Testventure Labs', 100)`).run();
  db.prepare(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (10, 1, 2, ?, 'Seed deck', 1, 1)`).run(JSON.stringify(SLIDES));
  const env: any = { DB: d1Over(db), JWT_SECRET, PUBLIC_BASE_URL: 'https://axal.test' };
  const app = new Hono<any>();
  app.route('/api/decks', deckExports);
  app.route('/api/decks', decks);
  return { db, env, app };
}

async function exportDeck(f: ReturnType<typeof fixture>, body: unknown, BROWSER: unknown) {
  const jwt = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await f.app.request('/api/decks/10/export', {
      method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    }, { ...f.env, BROWSER });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    let json: any = null; try { json = JSON.parse(text); } catch { /* a file */ }
    return { status: res.status, bytes, text, json, type: res.headers.get('content-type') || '' };
  } finally { [console.warn, console.error] = saved; }
}
const ledger = (f: ReturnType<typeof fixture>) => f.db.prepare('SELECT format FROM deck_exports').all().map((r: any) => r.format);

test('1. renderUrl: only a checked PDF or PNG is an answer, and an unbound or fetch-only binding is never called', async () => {
  // Mutation checked: the signature check dropped → the HTML answer passes as a PDF; quickAction not required → the fetch-only binding throws.
  assert.deepEqual(await renderUrl({} as any, 'pdf', { url: 'x' }, { kind: 'pdf', maxBytes: 100 }), { ok: false, code: 'browser_unbound', attempts: 0 });
  assert.deepEqual(await renderUrl({ BROWSER: { fetch: NEVER_FETCH } } as any, 'pdf', { url: 'x' }, { kind: 'pdf', maxBytes: 100 }), { ok: false, code: 'browser_unbound', attempts: 0 });

  let b = browser((a) => ok(a));
  let r = await renderUrl({ BROWSER: b.binding } as any, 'pdf', { url: 'https://axal.test/p' }, { kind: 'pdf', maxBytes: 100, backoffMs: 0 });
  assert.equal(r.ok, true);
  assert.deepEqual(b.calls.map((c) => [c.action, c.o.url]), [['pdf', 'https://axal.test/p']]);

  b = browser(() => new Response('<html>Sign in</html>', { status: 200 }));
  r = await renderUrl({ BROWSER: b.binding } as any, 'pdf', { url: 'u' }, { kind: 'pdf', maxBytes: 100, backoffMs: 0 });
  assert.deepEqual(r, { ok: false, code: 'not_pdf', status: undefined, attempts: 1 }, 'a page that is not a PDF is not retried as if it were a hiccup');
  b = browser(() => new Response(PDF));
  assert.equal((await renderUrl({ BROWSER: b.binding } as any, 'screenshot', { url: 'u' }, { kind: 'png', maxBytes: 100, backoffMs: 0 }) as any).code, 'not_png');

  b = browser(() => new Response(PDF, { headers: { 'content-length': '5000' } }));
  assert.equal((await renderUrl({ BROWSER: b.binding } as any, 'pdf', { url: 'u' }, { kind: 'pdf', maxBytes: 100, backoffMs: 0 }) as any).code, 'too_large');
  b = browser(() => new Response(new Uint8Array(200).fill(0x25)));
  assert.equal((await renderUrl({ BROWSER: b.binding } as any, 'pdf', { url: 'u' }, { kind: 'pdf', maxBytes: 100, backoffMs: 0 }) as any).code, 'too_large');
});

test('2. renderUrl retries once, and only what can pass on a second try; a deadline stops it', async () => {
  // Mutation checked: no retry → the 503-then-ok render fails; 4xx retried → the refused render is called twice; deadline ignored → a call is made.
  assert.equal(DECK_RENDER_ATTEMPTS, 2);
  const env = (b: any) => ({ BROWSER: b.binding }) as any;
  const o = { kind: 'pdf' as const, maxBytes: 1000, backoffMs: 0 };

  let b = browser((a, _o, n) => (n === 1 ? new Response('busy', { status: 503 }) : ok(a)));
  let r: any = await renderUrl(env(b), 'pdf', { url: 'u' }, o);
  assert.deepEqual([r.ok, r.attempts, b.calls.length], [true, 2, 2]);

  for (const [status, code] of [[503, 'browser_status'], [429, 'browser_busy']] as const) {
    b = browser(() => new Response('x', { status }));
    r = await renderUrl(env(b), 'pdf', { url: 'u' }, o);
    assert.deepEqual(r, { ok: false, code, status, attempts: 2 });
    assert.equal(b.calls.length, 2, 'bounded: two tries, never more');
  }
  b = browser(() => new Response('bad options', { status: 400 }));
  assert.deepEqual(await renderUrl(env(b), 'pdf', { url: 'u' }, o), { ok: false, code: 'browser_refused', status: 400, attempts: 1 });
  assert.equal(b.calls.length, 1, 'a refused request is not retried');

  b = browser(() => { throw new Error('socket closed'); });
  assert.deepEqual(await renderUrl(env(b), 'pdf', { url: 'u' }, o), { ok: false, code: 'browser_error', status: undefined, attempts: 2 });
  b = browser(() => new Promise<Response>(() => {}));
  assert.deepEqual(await renderUrl(env(b), 'pdf', { url: 'u' }, { ...o, timeoutMs: 20 }), { ok: false, code: 'browser_timeout', status: undefined, attempts: 2 });

  b = browser((a) => ok(a));
  assert.deepEqual(await renderUrl(env(b), 'pdf', { url: 'u' }, { ...o, deadline: Date.now() - 1 }), { ok: false, code: 'budget_exhausted', status: undefined, attempts: 0 });
  assert.equal(b.calls.length, 0, 'past the deadline no attempt starts');
});

test('3. PDF: the documented call with pdfOptions; a failed render is a code-only 502 and no export is recorded', async () => {
  // Mutation checked: printOptions kept → the pdfOptions check fails; the diagnostic carries the URL → the token scan fails;
  // an HTML answer handed out → the not_pdf status fails and a ledger row appears.
  const f = fixture();
  let b = browser((a) => ok(a));
  let r = await exportDeck(f, { format: 'pdf' }, b.binding);
  assert.equal(r.status, 200);
  assert.equal(r.type, 'application/pdf');
  assert.equal(b.calls.length, 1);
  assert.equal(b.calls[0].action, 'pdf');
  assert.match(b.calls[0].o.url, /^https:\/\/axal\.test\/deck\/print-export\/[^?]+\?print_mode=pdf$/);
  assert.equal(b.calls[0].o.pdfOptions.printBackground, true);
  assert.equal(b.calls[0].o.printOptions, undefined, 'printOptions is not a Browser Run field');
  assert.deepEqual(ledger(f), ['pdf']);

  b = browser(() => new Response('<html>error page</html>', { status: 503 }));
  r = await exportDeck(f, { format: 'pdf' }, b.binding);
  assert.equal(r.status, 502);
  assert.equal(r.json.error, 'pdf_render_failed');
  assert.equal(r.json.message, 'The PDF could not be produced. Try again in a moment.');
  assert.deepEqual(r.json.diagnostic, { reason: 'browser_status', attempts: 2, status: 503 });
  assert.doesNotMatch(r.text, /print-export|axal\.test|error page/, 'never the signed URL or the page');
  assert.deepEqual(ledger(f), ['pdf'], 'a failed export is never recorded');

  b = browser(() => new Response('<html>Sign in</html>', { status: 200 }));
  r = await exportDeck(f, { format: 'pdf' }, b.binding);
  assert.equal(r.status, 502, 'an answer that is not a PDF is never handed out as one');
  assert.deepEqual(r.json.diagnostic, { reason: 'not_pdf', attempts: 1 });
  assert.deepEqual(ledger(f), ['pdf']);
});

test('4. PowerPoint: a retried slide records one export; a failed slide names itself and records nothing', async () => {
  // Mutation checked: unbounded parallelism → the peak check fails; the failure's slide dropped → the diagnostic fails.
  const f = fixture();
  let b = browser((a, o, n) => (n === 2 ? new Response('busy', { status: 503 }) : ok(a)));
  let r = await exportDeck(f, { format: 'pptx', sources: true }, b.binding);
  assert.equal(r.status, 200);
  assert.ok(r.bytes.length > 0 && r.text.includes('ppt/slides/slide4.xml'), 'three cards and the Sources appendix');
  assert.equal(b.calls.length, 5, 'four slides, one of them twice');
  assert.deepEqual([...new Set(b.calls.map((c) => /slide=(\d+)/.exec(c.o.url)![1]))].sort(), ['0', '1', '2', '3']);
  assert.ok(b.calls.every((c) => c.action === 'screenshot' && c.o.viewport.width === 1920));
  assert.deepEqual(ledger(f), ['pptx'], 'one export, never two, after a retry');
  assert.equal(PPTX_RENDER_CONCURRENCY, 3);
  assert.ok(b.peak.n <= 3 && b.peak.n > 1, `a few at a time (peak ${b.peak.n})`);

  b = browser((a, o) => (/slide=1$/.test(o.url) ? new Response('nope', { status: 400 }) : ok(a)));
  r = await exportDeck(f, { format: 'pptx' }, b.binding);
  assert.equal(r.status, 502);
  assert.equal(r.json.error, 'pptx_render_failed');
  assert.deepEqual(r.json.diagnostic, { reason: 'browser_refused', attempts: 1, status: 400, slide: 1 });
  assert.doesNotMatch(r.text, /print-export|axal\.test/);
  assert.deepEqual(ledger(f), ['pptx'], 'the failed export is not recorded');
});

test('5. a binding without quickAction is unavailable: PDF says so, PowerPoint is the text-only file, and fetch is never called', async () => {
  // Mutation checked: availability read from fetch → NEVER_FETCH throws and the PDF answers 500.
  const f = fixture();
  let r = await exportDeck(f, { format: 'pdf' }, { fetch: NEVER_FETCH });
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'browser_binding_unavailable');
  r = await exportDeck(f, { format: 'pptx' }, { fetch: NEVER_FETCH });
  assert.equal(r.status, 200);
  assert.deepEqual(ledger(f), ['pptx']);
  const src = readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/decks.ts'), 'utf8') + readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/deck_exports.ts'), 'utf8');
  assert.doesNotMatch(src, /https:\/\/browser\//, 'no deck render posts to the made-up host');
});

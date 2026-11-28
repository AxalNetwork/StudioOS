/**
 * D8772 (#8772) part 3 — the export ledger records the preflight warnings the
 * export dialog confirmed.
 *
 *   1. `confirmedOf`: an array of finding ids is kept (shaped like
 *      `preflightModel.js` ids, duplicates once, at most CONFIRMED_MAX); an
 *      empty array is 0; anything but an array is null (not recorded);
 *   2. the PowerPoint (through the ledger middleware), HTML and .odp routes
 *      write `warnings_confirmed` and `confirmed_findings`; a body without
 *      `confirmed` writes null; `GET /exports` returns both, with null for a
 *      row written before migration 202611271712;
 *   (`pitch_export_gate_8772.test.mjs` checks that the ids a real check
 *   gives the dialog pass `FINDING_ID`.)
 *
 * Every venture, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_export_confirmed_8772.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckExports, { CONFIRMED_MAX, confirmedOf } from '../src/routes/deck_exports.ts';
import decks from '../src/routes/decks.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const g = (c1: number, c2: number, r1: number, r2: number) => ({ c1, c2, r1, r2 });

// [Testventure] · Seed deck: one card, text only, so no image is fetched.
const SLIDES = [{ uid: 'c1', title: 'Traction', blocks: [{ id: 'h', kind: 'text', style: 'heading', text: 'Synthetic traction', grid: g(1, 12, 1, 2) }] }];

test('1. confirmedOf keeps finding ids, says 0 for none, and null when the body did not say', () => {
  // Mutation checked: a non-array read as [] → the null lines fail; ids not filtered → the junk line fails; no cap → the cap line fails.
  assert.deepEqual(confirmedOf({ confirmed: ['sources:2:m1:0', 'sources:2:m2:0'] }), { count: 2, ids: ['sources:2:m1:0', 'sources:2:m2:0'] });
  assert.deepEqual(confirmedOf({ confirmed: [] }), { count: 0, ids: [] }, 'nothing to confirm is 0, not null');
  assert.equal(confirmedOf({}), null, 'not said: not recorded');
  assert.equal(confirmedOf({ confirmed: 3 }), null);
  assert.equal(confirmedOf(null), null);
  assert.deepEqual(confirmedOf({ confirmed: ['sources:2:m1:0', 'sources:2:m1:0', 7, '<b>x</b>', 'no-colon', 'a:'.padEnd(300, 'x'), 'placeholder:10:m:0'] }),
    { count: 2, ids: ['sources:2:m1:0', 'placeholder:10:m:0'] }, 'duplicates once; anything not shaped like a finding id is dropped');
  const many = Array.from({ length: CONFIRMED_MAX + 5 }, (_, i) => `density:${i}:-:0`);
  assert.equal(confirmedOf({ confirmed: many })!.count, CONFIRMED_MAX, 'at most CONFIRMED_MAX');
});

// ── the routes ──

const JWT_SECRET = 'unit-test-jwt-secret-d8772-0123456789-abcdef';
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
  for (const t of ['users', 'projects', 'pitch_decks', 'activity_logs']) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)!));
  db.exec(read('cloudflare-worker/sql/migrations/537_deck_exports.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/754_deck_exports_odp.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/202611270209_8771_deck_exports_disclosure.sql'));
  // A row written before this change: it never said what was confirmed.
  db.exec("INSERT INTO deck_exports (deck_id, version, format, content_hash, created_by, notes, sources, copy) VALUES (10, 2, 'pptx', '" + 'a'.repeat(64) + "', 1, 0, 1, 'investor')");
  db.exec(read('cloudflare-worker/sql/migrations/202611271712_8772_deck_exports_confirmed.sql'));
  db.prepare(`INSERT INTO users (id, email, name, role, founder_id, is_active) VALUES (1, 'owner.d8772@example.test', 'Founder', 'founder', 100, 1)`).run();
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (1, 'Testventure Labs', 100)`).run();
  db.prepare(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (10, 1, 2, ?, 'Seed deck', 1, 1)`).run(JSON.stringify(SLIDES));
  const app = new Hono<any>();
  app.route('/api/decks', deckExports);
  app.route('/api/decks', decks);
  return { db, app, env: { DB: d1Over(db), JWT_SECRET, PUBLIC_BASE_URL: 'https://axal.test' } as any };
}
async function client_(f: ReturnType<typeof fixture>) {
  const jwt = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  return (method: string, path: string, body?: unknown) => f.app.request(`/api/decks${path}`, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }, f.env);
}
const rows = (db: DatabaseSync) => db.prepare('SELECT format, warnings_confirmed, confirmed_findings FROM deck_exports ORDER BY id').all().map((r) => ({ ...r }));

test('2. every export route records the warnings confirmed; GET /exports returns them, null for a row from before', async () => {
  // Mutation checked: the middleware (PowerPoint/PDF) not passing `confirmed` → its row reads null; the .odp route not
  // passing it → its row fails; GET not returning the columns → its deepEqual fails; an old row read as 0 → the null fails.
  const f = fixture();
  try {
    const call = await client_(f);
    assert.equal((await call('POST', '/10/export', { format: 'pptx', notes: false, sources: true, confirmed: ['sources:0:m1:0', 'placeholder:0:b2:0'] })).status, 200);
    assert.equal((await call('POST', '/10/export/html', { notes: false, sources: true, confirmed: [] })).status, 200);
    assert.equal((await call('POST', '/10/export/odp', { notes: false, sources: true, confirmed: ['sources:0:m1:0'] })).status, 200);
    assert.equal((await call('POST', '/10/export/html', { notes: false, sources: true })).status, 200);
    assert.deepEqual(rows(f.db), [
      { format: 'pptx', warnings_confirmed: null, confirmed_findings: null },
      { format: 'pptx', warnings_confirmed: 2, confirmed_findings: '["sources:0:m1:0","placeholder:0:b2:0"]' },
      { format: 'html', warnings_confirmed: 0, confirmed_findings: '[]' },
      { format: 'odp', warnings_confirmed: 1, confirmed_findings: '["sources:0:m1:0"]' },
      { format: 'html', warnings_confirmed: null, confirmed_findings: null },
    ]);
    const list = await (await call('GET', '/10/exports')).json() as any;
    assert.deepEqual(list.exports.map((e: any) => [e.format, e.warnings_confirmed, e.confirmed_findings]), [
      ['html', null, null],
      ['odp', 1, ['sources:0:m1:0']],
      ['html', 0, []],
      ['pptx', 2, ['sources:0:m1:0', 'placeholder:0:b2:0']],
      ['pptx', null, null],
    ]);
  } finally { f.db.close(); }
});

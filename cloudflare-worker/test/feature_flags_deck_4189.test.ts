/**
 * #4189 (K2 of #4155, D4155): deck feature flags. A write takes a reason and
 * leaves one admin audit row; the read names its writer and how many members a
 * row reaches; the deck keys are offered only where a route reads them.
 * Every person and address is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/feature_flags_deck_4189.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminFeatureFlags, { knownKeys } from '../src/routes/admin_feature_flags.ts';
import deckRehearsals from '../src/routes/deck_rehearsals.ts';
import deckVentureElements from '../src/routes/deck_venture_elements.ts';
import { DECK_FEATURES, keyShape } from '../src/services/featureFlags.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { loadSchema } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'feature-flags-4189-'));
const seedPath = join(scratch, 'schema.sqlite');
const seed = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
loadSchema(seed); seed.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
const JWT_SECRET = 'synthetic-4189-only-not-a-real-credential'.repeat(2);
const REASON = 'Pausing while the vendor fixes timing.';
let n = 0;

function fixture() {
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, uid, role, founder_id, name, email, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insert.run(2, 'u-founder', 'founder', 100, 'Fia Founder', 'fia@example.invalid', 1);
  insert.run(3, 'u-founder-2', 'founder', 101, 'Fen Founder', 'fen@example.invalid', 1);
  insert.run(4, 'u-gone', 'founder', 102, 'Gus Gone', 'gus@example.invalid', 0);
  insert.run(9, 'u-admin', 'admin', null, 'Ada Admin', 'ada@example.invalid', 1);
  const m = new Map<string, string>();
  const kv = { async get(k: string, t?: string) { const v = m.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k: string, v: string) { m.set(k, v); }, async delete(k: string) { m.delete(k); } };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', TOKENS: kv, FILES: {} };
  const app = new Hono<any>().route('/api/admin/feature-flags', adminFeatureFlags).route('/api/decks', deckRehearsals).route('/api/decks', deckVentureElements);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app, close: () => db.close() };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, who: number, method: string, path: string, json?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(json === undefined ? {} : { body: JSON.stringify(json) }) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const PUT = (f: F, body: object, who = 9) => call(f, who, 'PUT', '/api/admin/feature-flags', body);
const audits = (f: F) => f.db.prepare("SELECT admin_user_id, action, viewed_user_id, filters_json FROM admin_audit_log WHERE action = 'feature_flag_set' ORDER BY id").all() as any[];

test('a write takes a reason of at least 10 characters; without one nothing is written and nothing is audited', async () => {
  // Mutation checked: the reason check removed → the short and missing cases write a row.
  const f = fixture();
  try {
    for (const reason of [undefined, '', 'too short', '   short   ']) {
      const r = await PUT(f, { key: 'deck:rehearsal', scope: 'global', enabled: false, ...(reason === undefined ? {} : { reason }) });
      assert.deepEqual([r.status, r.body.error], [400, 'reason_required'], String(reason));
      assert.match(r.body.message, /at least 10 characters/);
    }
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM feature_flags').get() as any).n, 0);
    assert.equal(audits(f).length, 0);
    assert.equal((await PUT(f, { key: 'deck:rehearsal', scope: 'global', enabled: false, reason: REASON }, 2)).status, 403, 'only an admin');
  } finally { f.close(); }
});

test('each write leaves one audit row: the admin, the reason, and the value before and after', async () => {
  // Mutation checked: the audit call removed → no row; `before` read after the write → before equals after.
  const f = fixture();
  try {
    assert.equal((await PUT(f, { key: 'deck:rehearsal', scope: 'global', enabled: false, reason: REASON })).status, 200);
    assert.equal((await PUT(f, { key: 'deck:rehearsal', scope: 'global', enabled: true, reason: 'Vendor fixed the timing issue.' })).status, 200);
    assert.equal((await PUT(f, { key: 'deck:logo_wall', scope: 'user', scope_id: 3, enabled: false, reason: 'Logos pending permission review.' })).status, 200);
    assert.equal((await PUT(f, { key: 'deck:rehearsal', scope: 'global', enabled: null, reason: 'Back to the default for everyone.' })).status, 200);
    const rows = audits(f).map((r) => ({ ...r, d: JSON.parse(r.filters_json) }));
    assert.equal(rows.length, 4, 'one row per write');
    assert.deepEqual(rows.map((r) => [r.admin_user_id, r.d.key, r.d.before, r.d.after]), [
      [9, 'deck:rehearsal', null, false], [9, 'deck:rehearsal', false, true], [9, 'deck:logo_wall', null, false], [9, 'deck:rehearsal', true, null],
    ]);
    assert.equal(rows[0].d.reason, REASON);
    assert.equal(rows[2].viewed_user_id, 3, 'a user-scope row names its member as the audit target');
    assert.ok(rows.every((r) => !/@example\.invalid/.test(r.filters_json)), 'no address in the audit payload');
  } finally { f.close(); }
});

test('the read names the writer by uid and name, never an email or a bare id, and counts who a row reaches', async () => {
  // Mutation checked: `updated_by` left as the raw id → the shape assert fails; `affected` counting inactive members → the global count is 4.
  const f = fixture();
  try {
    await PUT(f, { key: 'deck:rehearsal', scope: 'global', enabled: false, reason: REASON });
    await PUT(f, { key: 'deck:pptx_import', scope: 'role', scope_id: 'founder', enabled: false, reason: REASON });
    await PUT(f, { key: 'deck:logo_wall', scope: 'user', scope_id: 2, enabled: false, reason: REASON });
    const r = await call(f, 9, 'GET', '/api/admin/feature-flags');
    assert.equal(r.status, 200);
    const by = Object.fromEntries(r.body.flags.map((x: any) => [x.key, x]));
    assert.deepEqual(by['deck:rehearsal'].updated_by, { uid: 'u-admin', name: 'Ada Admin' });
    assert.deepEqual([by['deck:rehearsal'].affected, by['deck:pptx_import'].affected, by['deck:logo_wall'].affected], [3, 2, 1], 'active members only');
    assert.equal(by['deck:rehearsal'].enabled, false);
    assert.ok(!/@example\.invalid/.test(JSON.stringify(r.body)), 'never an email');
    assert.ok(!/"updated_by":\s*\d/.test(JSON.stringify(r.body)), 'never a bare id');
    assert.deepEqual(Object.keys(r.body.labels).sort(), DECK_FEATURES.map((d) => d.key).sort());
    for (const d of DECK_FEATURES) assert.ok(r.body.labels[d.key].label && r.body.labels[d.key].description.endsWith('.'), d.key);
  } finally { f.close(); }
});

test('an unknown key is refused; the deck keys are the ones a route reads, and only those', async () => {
  // Mutation checked: a deck key with no reader added to DECK_FEATURES → the guard fails.
  const f = fixture();
  try {
    // D1590 (#3837): deck:walkthrough has its reader now (routes/deck_recordings.ts), so it left this list.
    for (const key of ['deck:compare', 'deck:stock_photos', 'deck:anything', 'deck:']) {
      const r = await PUT(f, { key, scope: 'global', enabled: false, reason: REASON });
      assert.deepEqual([r.status, r.body.error], [400, 'invalid_key'], key);
    }
  } finally { f.close(); }
  assert.equal(keyShape('deck:rehearsal'), 'deck');
  assert.equal(keyShape('deck:Rehearsal'), null);
  for (const d of DECK_FEATURES) assert.ok(knownKeys().includes(d.key), d.key);
  // The guard: every deck key is read by a route, through the flags, so no flag switches nothing.
  const dir = new URL('../src/routes/', import.meta.url);
  const src = readdirSync(dir).filter((x) => x.endsWith('.ts')).map((x) => readFileSync(new URL(x, dir), 'utf8')).join('\n');
  for (const d of DECK_FEATURES) {
    assert.match(src, new RegExp(`\\.on\\('${d.key}'\\)`), `${d.key} has no reader: add its gate or leave the key out`);
  }
});

test('a deck flag switched off stops its feature for that member: rehearsal and the logo wall answer "Not switched on yet."', async () => {
  // Mutation checked: the rehearsal gate removed → the quote reaches the deck lookup instead of 404 not_switched_on.
  const f = fixture();
  try {
    await PUT(f, { key: 'deck:rehearsal', scope: 'user', scope_id: 2, enabled: false, reason: REASON });
    await PUT(f, { key: 'deck:logo_wall', scope: 'role', scope_id: 'founder', enabled: false, reason: REASON });
    const q = await call(f, 2, 'POST', '/api/decks/7/rehearsals/quote', { pitch_seconds: 180 });
    assert.deepEqual([q.status, q.body.error, q.body.message], [404, 'not_switched_on', 'Not switched on yet.']);
    const other = await call(f, 3, 'POST', '/api/decks/7/rehearsals/quote', { pitch_seconds: 180 });
    assert.notEqual(other.body.error, 'not_switched_on', 'a user row is that member\'s alone');
    const logos = await call(f, 3, 'POST', '/api/decks/7/logos', { customer_name: 'Acme' });
    assert.deepEqual([logos.status, logos.body.error], [404, 'not_switched_on']);
    // The PowerPoint import's gate sits in the upload, before any import row, and only for .pptx.
    const imports = readFileSync(new URL('../src/routes/imports.ts', import.meta.url), 'utf8');
    const gate = imports.indexOf(".on('deck:pptx_import')");
    assert.ok(gate > 0 && gate < imports.indexOf("const importId = await startImport(c.env, user.id, name.endsWith('.pptx')"));
    assert.match(imports, /name\.endsWith\('\.pptx'\) && !\(await flagsFor\(c\.env, user\)\)\.on\('deck:pptx_import'\)\)/);
  } finally { f.close(); }
});

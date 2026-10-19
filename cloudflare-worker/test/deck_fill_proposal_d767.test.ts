/**
 * D767 (#2096) PR 1 — "Fill from project" proposes a version; it never
 * overwrites one.
 *
 *  - A fill writes one `pitch_deck_proposals` row and leaves every
 *    `pitch_decks` row byte-identical (the version list does not grow).
 *  - Keep makes the proposal the project's new current version, by the same
 *    insert every save uses, and removes the proposal.
 *  - Discard deletes that proposal and nothing else.
 *  - A second fill replaces an unkept proposal; another member's proposal
 *    answers 403 to keep and discard alike.
 *
 * The real `decks.ts` router over HTTP, against node:sqlite tables sliced from
 * `schema_baseline.sql` plus migration 497. No model is reached: with no
 * OPENAI_API_KEY the fill's AI hints are skipped, and `fetch` throws if called.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_fill_proposal_d767.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import decks from '../src/routes/decks.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATION = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/497_pitch_deck_proposals.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-d767-0123456789-abcdef';
const TABLES = ['users', 'projects', 'pitch_decks', 'financial_models', 'cap_table_holders', 'landing_pages'];

const SLIDES_V1 = JSON.stringify([{ title: 'Problem', method_id: 'yc_seed', spec_id: 'problem', body: 'The founder wrote this.', fields: [] }]);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) {
    const ddl = tableFromBaseline(BASELINE, t);
    if (ddl) db.exec(stripForeignKeys(ddl));
  }
  db.exec(MIGRATION);
  db.prepare(`INSERT INTO users (id, email, name, role, is_active) VALUES (1, 'admin.d767@example.test', 'Admin', 'admin', 1)`).run();
  db.prepare(`INSERT INTO users (id, email, name, role, is_active) VALUES (2, 'other.d767@example.test', 'Other', 'founder', 1)`).run();
  db.prepare(`INSERT INTO projects (id, name, sector) VALUES (1, 'Testventure Labs', 'Climate')`).run();
  db.prepare(`INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (10, 1, 1, ?, 'Seed deck', 1, 1)`).run(SLIDES_V1);
  const env: any = { DB: d1Over(db), JWT_SECRET };
  const app = new Hono<any>();
  app.route('/api/decks', decks);
  return { db, env, app };
}

async function call(f: ReturnType<typeof fixture>, who: number, role: string, method: string, path: string) {
  const jwt = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(`/api/decks${path}`, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
  }, f.env);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
}

const decksOf = (db: DatabaseSync) => db.prepare('SELECT id, project_id, version, slides, title, is_current, created_by, created_at FROM pitch_decks ORDER BY id').all();
const proposalsOf = (db: DatabaseSync) => db.prepare('SELECT * FROM pitch_deck_proposals ORDER BY id').all();

function noNetwork() {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  return () => { globalThis.fetch = real; };
}

test('a fill makes a proposal and leaves every deck version byte-identical', async () => {
  const f = fixture();
  const restore = noNetwork();
  try {
    const before = decksOf(f.db);
    const r = await call(f, 1, 'admin', 'POST', '/10/autofill');
    assert.equal(r.status, 200, r.text);
    assert.ok(r.body.proposal?.id, 'the answer carries the proposal');
    assert.equal(r.body.proposal.base_deck_id, 10);
    assert.ok(Array.isArray(r.body.proposal.slides) && r.body.proposal.slides.length > 0);
    assert.equal(r.body.deck, undefined, 'no deck is answered: none was written');
    assert.deepEqual(decksOf(f.db), before, 'pitch_decks is untouched');
    assert.equal(proposalsOf(f.db).length, 1);
    const list = await call(f, 1, 'admin', 'GET', '/by-project/1');
    assert.equal(list.body.versions.length, 1, 'the version list does not grow');
    assert.equal(list.body.proposal.id, r.body.proposal.id, 'the editor reads the unkept proposal back');
  } finally { restore(); }
});

test('Keep makes the proposal the new current version; the first stays as it was', async () => {
  const f = fixture();
  const restore = noNetwork();
  try {
    const first = decksOf(f.db)[0];
    const { body } = await call(f, 1, 'admin', 'POST', '/10/autofill');
    const kept = await call(f, 1, 'admin', 'POST', `/proposals/${body.proposal.id}/keep`);
    assert.equal(kept.status, 200, kept.text);
    assert.equal(kept.body.deck.version, 2);
    assert.equal(kept.body.deck.is_current, true);
    assert.deepEqual(kept.body.deck.slides, body.proposal.slides, 'the kept version is the proposal');
    const rows: any[] = decksOf(f.db);
    assert.equal(rows.length, 2);
    assert.deepEqual({ ...rows[0], is_current: 1 }, { ...(first as any) }, 'v1 is byte-identical but for is_current');
    assert.equal(rows[0].is_current, 0);
    assert.equal(proposalsOf(f.db).length, 0, 'the proposal is gone once kept');
    assert.equal((await call(f, 1, 'admin', 'POST', `/proposals/${body.proposal.id}/keep`)).status, 404, 'a kept proposal cannot be kept twice');
  } finally { restore(); }
});

test('Discard deletes only the proposal', async () => {
  const f = fixture();
  const restore = noNetwork();
  try {
    const before = decksOf(f.db);
    const { body } = await call(f, 1, 'admin', 'POST', '/10/autofill');
    const d = await call(f, 1, 'admin', 'DELETE', `/proposals/${body.proposal.id}`);
    assert.equal(d.status, 200, d.text);
    assert.deepEqual(decksOf(f.db), before);
    assert.equal(proposalsOf(f.db).length, 0);
  } finally { restore(); }
});

test('a second fill replaces the unkept proposal; another member gets 403', async () => {
  const f = fixture();
  const restore = noNetwork();
  try {
    const one = await call(f, 1, 'admin', 'POST', '/10/autofill');
    const two = await call(f, 1, 'admin', 'POST', '/10/autofill');
    const left: any[] = proposalsOf(f.db);
    assert.deepEqual(left.map((p) => p.id), [two.body.proposal.id], 'one unkept proposal per project');
    assert.notEqual(one.body.proposal.id, two.body.proposal.id);
    // A founder who does not own the project.
    for (const [m, p] of [['POST', `/proposals/${two.body.proposal.id}/keep`], ['DELETE', `/proposals/${two.body.proposal.id}`]] as const) {
      const r = await call(f, 2, 'founder', m, p);
      assert.equal(r.status, 403, `${m} ${p}: ${r.text}`);
    }
    assert.equal(proposalsOf(f.db).length, 1, 'refused: nothing deleted');
    assert.equal(decksOf(f.db).length, 1, 'refused: nothing kept');
  } finally { restore(); }
});

test('the route writes no deck version: no UPDATE of pitch_decks in the fill', () => {
  const src = readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/decks.ts'), 'utf8');
  const start = src.indexOf("decks.post('/:id/autofill'");
  const end = src.indexOf('\n});', start);
  const route = src.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(route, /UPDATE pitch_decks|insertVersion\(/);
  assert.match(route, /proposeFill\(/);
});

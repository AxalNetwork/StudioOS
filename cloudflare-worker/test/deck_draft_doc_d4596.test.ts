/**
 * D4596 (#4596, Pitch audit 2/5) — the working copy's deck-level state: which cards it keeps, in order,
 * with its theme and audience, as its own revision (`PUT /api/decks/:id/draft-doc`, `If-Match`).
 *
 *   1. The migration applies twice; the first write is `If-Match: 0`, the revision climbs one per write,
 *      and `GET /draft` carries it as `doc` (null before the first).
 *   2. A card the document no longer keeps is removed with it; a stale revision is 409 with the server's
 *      state and nothing written (cards included); a missing `If-Match` is 428.
 *   3. Order, theme and audience are checked as a save checks them.
 *   4. Two writers of one revision: one wins. Discarding the draft discards the document.
 *
 * In-memory SQLite: the baseline and the migrations. Every row is made up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import decks, { ensureSchema } from '../src/routes/decks.ts';
import deckDraft from '../src/routes/deck_draft.ts';
import { loadSchema } from './_schema_once.mjs';

const DIR = 'cloudflare-worker/sql/migrations';
const M715 = readFileSync(`${DIR}/715_pitch_deck_cards.sql`, 'utf8');
const M4596 = readFileSync(`${DIR}/202611071430_pitch_draft_document.sql`, 'utf8');
const SECRET = 'synthetic-deck-draft-d4596-secret-'.repeat(2);
const FOUNDER = 1, OTHER = 2, P = 10, DECK = 100;

async function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: true });
  db.exec('PRAGMA foreign_keys = OFF');
  loadSchema(db);
  db.exec(M715); db.exec(M4596); db.exec(M4596); // applied twice
  db.exec(`INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES
      (${FOUNDER}, 'founder', 'Synthetic founder', 'draft1501@example.test', 1001, 1),
      (${OTHER}, 'founder', 'Other founder', 'other1501@example.test', 1002, 1);
    INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Draft fixture', 1001);
    INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES
      (${DECK}, ${P}, 1, '${JSON.stringify([{ uid: 'c1', title: 'Saved title' }, { uid: 'c2', title: 'Second' }])}', 'Draft deck', 1, ${FOUNDER});`);
  db.exec('PRAGMA foreign_keys = ON');
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  await ensureSchema(env);
  const app = new Hono<any>();
  app.route('/api/decks', deckDraft);
  app.route('/api/decks', decks);
  const tokenOf = (id: number) => new SignJWT({ user_id: id, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  async function call(method: string, path: string, { as = FOUNDER as number | null, body, ifMatch }: { as?: number | null; body?: unknown; ifMatch?: string } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (as != null) headers.authorization = `Bearer ${await tokenOf(as)}`;
    if (ifMatch != null) headers['if-match'] = ifMatch;
    const res = await withThrownResponses(() => app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  }
  const patch = (uid: string, card: any, ifMatch?: string, extra: Record<string, unknown> = {}, as = FOUNDER) =>
    call('PATCH', `/api/decks/${DECK}/cards/${uid}`, { as, body: { card, ...extra }, ifMatch });
  const rows = () => db.prepare('SELECT deck_id, card_uid, ord, rev FROM pitch_deck_cards ORDER BY card_uid').all().map((r: any) => ({ ...r }));
  return { db, env, call, patch, rows };
}


const put = (f: any, body: any, ifMatch?: string, as = FOUNDER) => f.call('PUT', `/api/decks/${DECK}/draft-doc`, { as, body, ifMatch });
const docs = (f: any) => f.db.prepare('SELECT rev, order_json, theme_json, audience FROM pitch_deck_draft_doc').all().map((r: any) => ({ ...r }));

test('1. the first write is If-Match 0; the revision climbs one per write; GET /draft carries it as doc', async () => {
  const f = await world();
  try {
    assert.equal((await f.call('GET', `/api/decks/${DECK}/draft`)).body.doc, null);
    let r = await put(f, { order: ['c1', 'c2'], theme: { kind: 'brand' }, audience: 'seed_fund' }, '0');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.doc.rev, r.body.doc.order, r.body.doc.audience, r.body.doc.theme.kind], [1, ['c1', 'c2'], 'seed_fund', 'brand']);
    r = await put(f, { order: ['c1', 'c2'], theme: null, audience: 'angel' }, '1');
    assert.deepEqual([r.status, r.body.doc.rev, r.body.doc.theme, r.body.doc.audience], [200, 2, null, 'angel']);
    const g = await f.call('GET', `/api/decks/${DECK}/draft`);
    assert.deepEqual([g.body.doc.rev, g.body.doc.audience], [2, 'angel']);
    assert.equal((await put(f, { order: [] })).status, 428, 'a missing If-Match');
  } finally { f.db.close(); }
});

test('2. a card the document drops is removed with it; a stale revision writes nothing at all', async () => {
  const f = await world();
  try {
    await f.patch('c1', { title: 'One' }, '0', { ord: 0 });
    await f.patch('c2', { title: 'Two' }, '0', { ord: 1 });
    await f.patch('c3', { title: 'Three' }, '0', { ord: 2 });
    assert.equal((await put(f, { order: ['c1', 'c2', 'c3'] }, '0')).status, 200);
    const stale = await put(f, { order: ['c1'] }, '0');
    assert.equal(stale.status, 409); assert.equal(stale.body.error, 'doc_rev_conflict');
    assert.equal(stale.body.server.rev, 1);
    assert.deepEqual(f.rows().map((x: any) => x.card_uid), ['c1', 'c2', 'c3'], 'the loser removed nothing');
    assert.deepEqual(docs(f).map((d: any) => d.order_json), ['["c1","c2","c3"]']);
    assert.equal((await put(f, { order: ['c1', 'c2', 'c3'], audience: 'angel' }, '1')).status, 200);
    const behind = await put(f, { order: ['c1'] }, '1');
    assert.deepEqual([behind.status, behind.body.error, behind.body.server.rev], [409, 'doc_rev_conflict', 2], 'revision 1 is behind now');
    assert.deepEqual(f.rows().map((x: any) => x.card_uid), ['c1', 'c2', 'c3'], 'and removed nothing');
    const won = await put(f, { order: ['c3', 'c1'] }, '2');
    assert.equal(won.status, 200);
    assert.deepEqual(f.rows().map((x: any) => x.card_uid), ['c1', 'c3'], 'c2 is removed from the draft');
    // The last card too.
    assert.equal((await put(f, { order: [] }, '3')).status, 200);
    assert.deepEqual(f.rows(), []);
    assert.deepEqual((await f.call('GET', `/api/decks/${DECK}/draft`)).body.doc.order, []);
  } finally { f.db.close(); }
});

test('3. order, theme and audience are checked as a save checks them', async () => {
  const f = await world();
  try {
    for (const [body, code] of [
      [{ order: 'c1' }, 'invalid_order'],
      [{ order: ['c1', 'c1'] }, 'invalid_order'],
      [{ order: ['bad uid'] }, 'invalid_order'],
      [{ order: Array.from({ length: 61 }, (_, i) => `c${i}`) }, 'invalid_order'],
      [{ order: ['c1'], audience: 'everybody' }, 'invalid_audience'],
      [{ order: ['c1'], theme: { kind: 'nonsense' } }, 'invalid_theme'],
    ] as const) {
      const r = await put(f, body, '0');
      assert.deepEqual([r.status, r.body.error], [400, code], JSON.stringify(body).slice(0, 60));
    }
    assert.equal((await put(f, { order: ['c1'] }, 'x')).status, 400);
    assert.deepEqual(docs(f), [], 'nothing written');
  } finally { f.db.close(); }
});

test('4. two writers of one revision: one wins; readers cannot write; discarding the draft discards the document', async () => {
  const f = await world();
  try {
    const [a, b] = await Promise.all([put(f, { order: ['c1'] }, '0'), put(f, { order: ['c2'] }, '0')]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(docs(f).length, 1);
    assert.equal((await put(f, { order: ['c1'] }, '1', OTHER)).status, 403);
    const d = await f.call('DELETE', `/api/decks/${DECK}/draft`);
    assert.equal(d.status, 200);
    assert.deepEqual(docs(f), []);
    assert.equal((await f.call('GET', `/api/decks/${DECK}/draft`)).body.doc, null);
  } finally { f.db.close(); }
});

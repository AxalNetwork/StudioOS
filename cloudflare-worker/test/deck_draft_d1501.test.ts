/**
 * D1501 (#3751, deck v2 A9) — a deck version's working copy on the Worker, and
 * `If-Match` on the save.
 *
 *   1. 715 applies twice; a card's working copy round-trips, and its revision
 *      climbs one per write.
 *   2. A stale card revision gets 409 with the server's copy, and nothing is
 *      written; a missing `If-Match` is 428; two first saves of one card: one wins.
 *   3. A stale deck `If-Match` on `PUT /:id` gets 409 with the server copy and
 *      writes no version; a matching one saves one version as before.
 *   4. The working copy keeps what a card references (a generated image, a
 *      figure's binding), and is refused by the same model rules as a save.
 *   5. A draft never reaches a share link; only the deck's writers change it,
 *      and its readers alone read it. Deleting the version deletes its copy.
 *
 * In-memory SQLite: the baseline and every post-cutoff migration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import decks, { createShareLink, ensureSchema } from '../src/routes/decks.ts';
import deckDraft, { DRAFT_MAX_CARDS } from '../src/routes/deck_draft.ts';
import { revOf } from '../src/services/decks/ifMatch.ts';
import { MODEL_VERSION } from '../src/services/decks/slideModel.ts';

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations).filter((n) => migrationNumber(n) > BASELINE_CUTOFF).map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));
const M715 = readFileSync(`${DIR}/715_pitch_deck_cards.sql`, 'utf8');
const SECRET = 'synthetic-deck-draft-d1501-secret-'.repeat(2);
const FOUNDER = 1, OTHER = 2, P = 10, DECK = 100;
const IMAGE = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';

async function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: true });
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(BASELINE);
  for (const m of MIGRATIONS) { try { db.exec(m); } catch { /* a view naming an object replayed later */ } }
  db.exec(M715); // applied twice
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

test('715 applies twice; a card\'s working copy round-trips and its revision climbs one per write', async () => {
  const f = await world();
  try {
    let r = await f.patch('c1', { title: 'First edit' }, '0', { ord: 0 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.card.uid, r.body.card.rev, r.body.card.ord, r.body.card.card.title, r.body.card.card.uid], ['c1', 1, 0, 'First edit', 'c1']);
    r = await f.patch('c1', { title: 'Second edit' }, '1');
    assert.deepEqual([r.status, r.body.card.rev, r.body.card.card.title], [200, 2, 'Second edit']);
    r = await f.patch('c1', { title: 'Third edit' }, '"2"', { ord: 1 });
    assert.deepEqual([r.status, r.body.card.rev, r.body.card.ord], [200, 3, 1], 'a quoted ETag-style revision reads too');
    await f.patch('c2', { title: 'Other card' }, '0', { ord: 0 });
    const draft = await f.call('GET', `/api/decks/${DECK}/draft`);
    assert.equal(draft.status, 200);
    assert.deepEqual([draft.body.deck_id, draft.body.version, draft.body.rev], [DECK, 1, 1]);
    assert.deepEqual(draft.body.cards.map((x: any) => [x.uid, x.ord, x.rev, x.card.title]), [['c2', 0, 1, 'Other card'], ['c1', 1, 3, 'Third edit']]);
    assert.ok(draft.body.updated_at, 'when the copy last changed, for "Restore unsaved changes from …"');
    // The saved version is untouched until Save as version.
    assert.equal(JSON.parse((f.db.prepare(`SELECT slides FROM pitch_decks WHERE id = ${DECK}`).get() as any).slides)[0].title, 'Saved title');
    // An empty draft reads as no cards, not a 404.
    const del = await f.call('DELETE', `/api/decks/${DECK}/draft`);
    assert.deepEqual([del.status, del.body.discarded], [200, 2]);
    assert.deepEqual((await f.call('GET', `/api/decks/${DECK}/draft`)).body.cards, []);
  } finally { f.db.close(); }
});

test('a stale card revision is 409 with the server copy and writes nothing; no If-Match is 428; two first saves: one wins', async () => {
  // Mutation checked: the UPDATE without `AND rev = ?3` → the stale write lands and this fails.
  const f = await world();
  try {
    await f.patch('c1', { title: 'Tab A' }, '0');
    await f.patch('c1', { title: 'Tab A again' }, '1');
    const stale = await f.patch('c1', { title: 'Tab B, from rev 1' }, '1');
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, 'card_rev_conflict');
    assert.match(stale.body.message, /changed in another tab/);
    assert.deepEqual([stale.body.rev, stale.body.server.rev, stale.body.server.card.title], [2, 2, 'Tab A again']);
    assert.deepEqual(f.rows().map((r: any) => r.rev), [2], 'nothing written');
    const again = await f.patch('c1', { title: 'Again from zero' }, '0');
    assert.deepEqual([again.status, again.body.error], [409, 'card_rev_conflict'], 'a first save of a card that already has a copy');
    assert.deepEqual([(await f.patch('c1', { title: 'No header' })).status], [428]);
    assert.equal((await f.patch('c1', { title: 'Bad header' }, 'abc')).body.error, 'invalid_if_match');
    assert.equal((await f.patch('c1', null as any, '2')).body.error, 'card_required');
    assert.equal((await f.call('PATCH', `/api/decks/${DECK}/cards/not a uid`, { body: { card: {} }, ifMatch: '0' })).status, 400);
    assert.equal((await f.patch('c3', { title: 'x' }, '0', { ord: DRAFT_MAX_CARDS })).body.error, 'invalid_ord');
    // Two tabs make a card's first copy at once: one wins, the other is told.
    const both = await Promise.all([f.patch('c9', { title: 'One' }, '0'), f.patch('c9', { title: 'Two' }, '0')]);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
  } finally { f.db.close(); }
});

test('PUT /:id: a stale If-Match is 409 with the server copy and writes no version; a matching one saves as before', async () => {
  // Mutation checked: the If-Match check removed from PUT /:id → the stale save writes version 2 and this fails.
  const f = await world();
  try {
    const save = (ifMatch?: string, title = 'Saved') => f.call('PUT', `/api/decks/${DECK}`, { ifMatch, body: { title, slides: [{ uid: 'c1', title }], model_version: MODEL_VERSION } });
    const stale = await save('7');
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, 'deck_version_conflict');
    assert.deepEqual([stale.body.current, stale.body.rev, stale.body.server.id, stale.body.server.version], [{ id: DECK, version: 1 }, 1, DECK, 1]);
    assert.ok(Array.isArray(stale.body.server.slides), 'the server copy');
    assert.match(stale.body.message, /saved somewhere else/);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM pitch_decks').get() as any).n, 1, 'no version written');
    assert.equal((await save('nope')).body.error, 'invalid_if_match');
    const ok = await save('1', 'Version two');
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.version, 2);
    // #3748's stale base answers with the same body: the old version, now not current.
    const old = await f.call('PUT', `/api/decks/${DECK}`, { body: { title: 'From the old tab', slides: [{ uid: 'c1', title: 'x' }], model_version: MODEL_VERSION } });
    assert.equal(old.status, 409);
    assert.deepEqual([old.body.error, old.body.current, old.body.rev, old.body.server.id], ['deck_version_conflict', { id: ok.body.id, version: 2 }, 2, ok.body.id]);
    // And If-Match on an old version id is stale too, even if the number matches it.
    assert.equal((await save('1', 'old id')).status, 409);
    // No header: the save works as it did before this decision.
    const plain = await f.call('PUT', `/api/decks/${ok.body.id}`, { body: { title: 'Three', slides: [{ uid: 'c1', title: 'Three' }], model_version: MODEL_VERSION } });
    assert.deepEqual([plain.status, plain.body.version], [200, 3]);
  } finally { f.db.close(); }
});

test('the copy keeps what a card references, and the model rules refuse what a save would', async () => {
  const f = await world();
  try {
    const card = {
      title: 'With an image and a figure', layout: 'image_text',
      blocks: [
        { id: 'img', kind: 'image', grid: { c1: 1, c2: 6, r1: 1, r2: 6 }, image_url: 'https://images.example.test/generated.png', image_id: IMAGE },
        { id: 'fig', kind: 'metric', grid: { c1: 7, c2: 12, r1: 1, r2: 2 }, label: 'MRR', value: '4200', binding: { source_key: 'revenue.mrr', as_of: '2026-10-01', grade: 'Measured' } },
      ],
    };
    const r = await f.patch('c1', card, '0');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const kept = (await f.call('GET', `/api/decks/${DECK}/draft`)).body.cards[0].card;
    const img = kept.blocks.find((b: any) => b.id === 'img');
    const fig = kept.blocks.find((b: any) => b.id === 'fig');
    assert.equal(img.image_id, IMAGE, 'a generated image stays referenced');
    assert.deepEqual([fig.binding.source_key, fig.value], ['revenue.mrr', '4200'], 'a figure keeps its binding');
    // An overlapping block is refused, as a save refuses it, never trimmed.
    const bad = await f.patch('c1', { title: 'x', blocks: [
      { id: 'a', kind: 'text', grid: { c1: 1, c2: 6, r1: 1, r2: 2 }, text: 'a' },
      { id: 'b', kind: 'text', grid: { c1: 3, c2: 8, r1: 1, r2: 2 }, text: 'b' },
    ] }, '1');
    assert.deepEqual([bad.status, bad.body.error], [400, 'SLIDE_MODEL']);
  } finally { f.db.close(); }
});

test('a draft never reaches a share link; writers change it, readers alone read it; deleting the version deletes its copy', async () => {
  // Mutation checked: the share reader merging pitch_deck_cards → the draft title appears and this fails.
  const f = await world();
  try {
    await f.patch('c1', { title: 'Unsaved secret edit' }, '0');
    const { token } = await createShareLink(f.env, { deckId: DECK, deckVersion: 1, userId: FOUNDER, actorEmail: null, ttlSeconds: 3600, projectId: P });
    const shared = await f.call('GET', `/api/decks/share/${token}`, { as: null });
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    assert.doesNotMatch(JSON.stringify(shared.body), /Unsaved secret edit/, 'the share link reads the saved version only');
    assert.match(JSON.stringify(shared.body), /Saved title/);
    // Nothing outside the draft routes reads the working copy.
    const sources = readdirSync('cloudflare-worker/src', { recursive: true }).filter((n: any) => /\.ts$/.test(n)) as string[];
    const readers = sources.filter((n) => readFileSync(`cloudflare-worker/src/${n}`, 'utf8').includes('pitch_deck_cards'));
    assert.deepEqual(readers.map((n) => n.replace(/\\/g, '/')), ['routes/deck_draft.ts']);
    // Another member: no read, no write.
    assert.equal((await f.call('GET', `/api/decks/${DECK}/draft`, { as: OTHER })).status, 403);
    assert.equal((await f.patch('c1', { title: 'Intruder' }, '1', {}, OTHER)).status, 403);
    assert.equal((await f.call('DELETE', `/api/decks/${DECK}/draft`, { as: OTHER })).status, 403);
    assert.equal((await f.call('GET', '/api/decks/999/draft')).status, 404);
    // The version goes, its copy goes (ON DELETE CASCADE).
    f.db.exec(`DELETE FROM pitch_decks WHERE id = ${DECK}`);
    assert.deepEqual(f.rows(), []);
    assert.deepEqual([revOf('3'), revOf('W/"4"'), revOf('x'), revOf(undefined)], [3, 4, null, null]);
  } finally { f.db.close(); }
});

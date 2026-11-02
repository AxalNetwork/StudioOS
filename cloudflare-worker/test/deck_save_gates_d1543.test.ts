/**
 * D1543 (#3781) — a save refuses a gated block the venture's records do not
 * allow: a logo without its customer's permission (`no_permission`) or an
 * interview quote without recorded consent (`no_consent`), on both paths that
 * persist a founder's cards — `PUT /api/decks/:id` and the working copy's
 * `PATCH /api/decks/:id/cards/:uid`. Nothing is written when refused; a
 * permitted logo and a consented quote save as before.
 *
 * Every name and line is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_save_gates_d1543.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import decks, { ensureSchema } from '../src/routes/decks.ts';
import deckDraft from '../src/routes/deck_draft.ts';
import { MODEL_VERSION } from '../src/services/decks/slideModel.ts';
import { CONSENT_LINE, QUOTE_MIN_CHARS as SAVE_MIN, permissionLine, saveGateRefusal } from '../src/services/decks/saveGates.ts';
import { QUOTE_CONSENT_LINE, QUOTE_MIN_CHARS } from '../src/services/decks/quoteRetrieval.ts';
import { PERMISSION_LINE } from '../src/services/decks/ventureElements.ts';
import { loadSchema } from './_schema_once.mjs';

const SECRET = 'synthetic-deck-save-gates-d1543-secret-'.repeat(2);
const FOUNDER = 1, P = 10, DECK = 100;
const OK_KEY = 'logo_aaaaaaaaaaaaaaaaaaaaaaaa';
const NO_KEY = 'logo_bbbbbbbbbbbbbbbbbbbbbbbb';
const GRID_A = { c1: 1, c2: 6, r1: 1, r2: 2 };
const GRID_B = { c1: 7, c2: 12, r1: 1, r2: 2 };

async function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: true });
  db.exec('PRAGMA foreign_keys = OFF');
  loadSchema(db);
  db.exec(`INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (${FOUNDER}, 'founder', 'Synthetic founder', 'gates1543@example.test', 1001, 1);
    INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Gates fixture', 1001);
    INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES
      (${DECK}, ${P}, 1, '${JSON.stringify([{ uid: 'c1', title: 'Saved title' }])}', 'Gates deck', 1, ${FOUNDER});
    INSERT INTO deck_logos (project_id, logo_key, customer_name, image_uid, permitted, permission_reference, permitted_at) VALUES
      (${P}, '${OK_KEY}', 'Harbor Synth', '11111111-1111-4111-8111-111111111111', 1, 'Email from their CMO', '2026-10-30'),
      (${P}, '${NO_KEY}', 'Quay Synth', '22222222-2222-4222-8222-222222222222', 0, NULL, NULL);
    INSERT INTO discovery_interviews (id, project_id, interviewee_name, interviewee_role, interview_date, quote_consent, stage) VALUES
      (1, ${P}, 'Rowan Synth', 'Head of Operations', '2026-10-01', 1, 'done'),
      (2, ${P}, 'Uma Synth', 'CFO', '2026-10-02', 0, 'done');
    INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, consent_at) VALUES
      (11, 'sess-ok', 1, ${P}, ${FOUNDER}, 'video', 'reviewed', 'given', '2026-10-01 10:00:00'),
      (12, 'sess-no-quote', 2, ${P}, ${FOUNDER}, 'video', 'reviewed', 'given', '2026-10-02 10:00:00');
    INSERT INTO interview_transcript_segments (id, session_id, source, start_ms, end_ms, speaker_label, text) VALUES
      (101, 11, 'final', 1000, 9000, 'Rowan Synth', 'We reconcile every freight invoice by hand and it takes two days.'),
      (102, 12, 'final', 1000, 9000, 'Uma Synth', 'This line comes from an interview that declined to be quoted.');`);
  db.exec('PRAGMA foreign_keys = ON');
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  await ensureSchema(env);
  const app = new Hono<any>();
  app.route('/api/decks', deckDraft);
  app.route('/api/decks', decks);
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  async function call(method: string, path: string, body: unknown, ifMatch?: string) {
    const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
    if (ifMatch != null) headers['if-match'] = ifMatch;
    const res = await withThrownResponses(() => app.request(path, { method, headers, body: JSON.stringify(body) }, env));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  }
  const versions = () => Number((db.prepare(`SELECT COUNT(*) AS n FROM pitch_decks WHERE project_id = ${P}`).get() as any).n);
  const drafts = () => Number((db.prepare('SELECT COUNT(*) AS n FROM pitch_deck_cards').get() as any).n);
  return { db, call, versions, drafts };
}

const logo = (key: string, grid = GRID_A) => ({ id: `l${key.slice(-2)}`, kind: 'text', grid, text: 'Logo', element: 'logo_wall', logo_key: key });
const quote = (session: string, grid = GRID_B) => ({ id: `q${session.length}`, kind: 'text', grid, text: '“A line” — Head of Operations', element: 'interview_quote', session_uid: session });
const card = (blocks: any[]) => ({ uid: 'c1', title: 'Proof', blocks });
const put = (f: any, blocks: any[]) => f.call('PUT', `/api/decks/${DECK}`, { title: 'Gates deck', slides: [card(blocks)], model_version: MODEL_VERSION });

test('PUT /api/decks/:id: a forged unpermitted logo or unconsented quote is refused 409 and no version is written', async () => {
  // Mutations checked: the gate call removed from PUT → 200 and a version written; the permitted test reduced to
  // "a row exists" → the unpermitted logo saves; the consent clause without `quote_consent = 1` → the declined quote saves.
  const f = await world();
  try {
    let r = await put(f, [logo(NO_KEY)]);
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.deepEqual([r.body.error, r.body.message], ['no_permission', "Quay Synth hasn't given permission to show their logo."]);
    r = await put(f, [logo('logo_cccccccccccccccccccccccc')]);
    assert.deepEqual([r.status, r.body.error], [409, 'no_permission'], 'a key the venture never recorded');
    r = await put(f, [quote('sess-no-quote')]);
    assert.deepEqual([r.status, r.body.error, r.body.message], [409, 'no_consent', CONSENT_LINE]);
    r = await put(f, [quote('sess-invented')]);
    assert.deepEqual([r.status, r.body.error], [409, 'no_consent']);
    r = await put(f, [logo(OK_KEY), quote('sess-no-quote')]);
    assert.equal(r.body.error, 'no_consent', 'one bad block refuses the save');
    assert.equal(f.versions(), 1, 'nothing written');

    r = await put(f, [logo(OK_KEY), quote('sess-ok')]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(f.versions(), 2, 'a permitted logo and a consented quote save');
    const saved = JSON.parse((f.db.prepare(`SELECT slides FROM pitch_decks WHERE project_id = ${P} AND is_current = 1`).get() as any).slides);
    assert.deepEqual(saved[0].blocks.map((b: any) => [b.element, b.logo_key ?? b.session_uid]), [['logo_wall', OK_KEY], ['interview_quote', 'sess-ok']]);
    r = await f.call('PUT', `/api/decks/${r.body.id}`, { title: 'Plain', slides: [{ uid: 'c1', title: 'Plain' }], model_version: MODEL_VERSION });
    assert.equal(r.status, 200, 'a save with no gated block reads nothing and saves as before');
  } finally { f.db.close(); }
});

test('PATCH /api/decks/:id/cards/:uid: the working copy refuses the same blocks and writes nothing', async () => {
  // Mutation checked: the gate call removed from deck_draft → 200 and a copy stored.
  const f = await world();
  try {
    let r = await f.call('PATCH', `/api/decks/${DECK}/cards/c1`, { card: card([logo(NO_KEY)]) }, '0');
    assert.deepEqual([r.status, r.body.error], [409, 'no_permission']);
    r = await f.call('PATCH', `/api/decks/${DECK}/cards/c1`, { card: card([quote('sess-no-quote')]) }, '0');
    assert.deepEqual([r.status, r.body.error], [409, 'no_consent']);
    assert.equal(f.drafts(), 0, 'nothing written');
    r = await f.call('PATCH', `/api/decks/${DECK}/cards/c1`, { card: card([logo(OK_KEY), quote('sess-ok')]) }, '0');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(f.drafts(), 1);
  } finally { f.db.close(); }
});

test('the save gate uses the pick\'s clause and lines', () => {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const clauseOf = (src: string, from: string) => {
    const i = src.indexOf(from);
    return norm(src.slice(src.indexOf('WHERE s.project_id = ?', i), src.indexOf('length(trim(g.text)) >= ?', i)));
  };
  const save = readFileSync('cloudflare-worker/src/services/decks/saveGates.ts', 'utf8');
  const pick = readFileSync('cloudflare-worker/src/services/decks/quoteRetrieval.ts', 'utf8');
  const clause = clauseOf(save, 'SELECT DISTINCT s.uid');
  assert.ok(clause.includes("i.quote_consent = 1") && clause.includes("s.consent_status = 'given'"), clause);
  assert.equal(clause, clauseOf(pick, 'export async function quotableLines'), 'the same clause as quotableLines');
  assert.equal(SAVE_MIN, QUOTE_MIN_CHARS);
  assert.equal(CONSENT_LINE, QUOTE_CONSENT_LINE);
  assert.equal(permissionLine('X Co'), PERMISSION_LINE('X Co'));
  assert.doesNotMatch(save, /prepare\(\s*`[^`]*\$\{/, 'every statement is a bound literal');
  assert.doesNotMatch(save, /^import (?!type)/m, 'imports nothing at run time');
});

test('a gate that cannot be read does not pass; a save with no gated block reads nothing', async () => {
  // Mutation checked: the logo read's catch returning null (fail open) → the first assert fails.
  const empty = { DB: d1Over(new DatabaseSync(':memory:')) } as any;
  assert.equal((await saveGateRefusal(empty, P, [card([logo(OK_KEY)])]))?.code, 'no_permission', 'no logo store: refused');
  assert.equal((await saveGateRefusal(empty, P, [card([quote('sess-ok')])]))?.code, 'no_consent', 'no interview tables: refused');
  assert.equal(await saveGateRefusal(empty, P, [card([{ id: 'b1', kind: 'text', grid: GRID_A, text: 'Plain' }])]), null);
});

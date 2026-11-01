/**
 * D1560 (#3807, deck v2 C12): speaker notes, proofread, fix this slide and
 * the translation pipeline, as proposals. Synthetic data, the mounted Worker
 * routes and the real migrated schema; `env.AI` is a stub and `fetch` throws.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_transform_d1560.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckTransform from '../src/routes/deck_transform.ts';
import decks from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import {
  GUARD_LANGUAGES, TITLE_ID, TRANSFORM_OPTIONS, cardsOf, languageWarning, noNewDigits, proposalsFrom, sameDigits, transformMessage,
} from '../src/services/decks/transform.ts';
import { buildCards, buildMessage, wordingFromModel } from '../src/services/decks/newDeck.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'deck-transform-d1560-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
schema.exec(baseline); for (const sql of migrations) schema.exec(sql); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d1560-only-not-a-real-credential'.repeat(2);

const BOUND = { source_key: 'grow.paying_customers', record_ref: 'project_metrics:1', as_of: '2026-10-10', grade: 'Stated', snapshot_hash: 'a'.repeat(24) };
const SLIDES = [
  { uid: 'c-traction', title: 'Traction', layout: 'metric_tiles', notes: '', blocks: [
    { id: 'p1', kind: 'text', grid: { c1: 1, c2: 12, r1: 5, r2: 6 }, style: 'paragraph', text: 'We serve 3 regions and grew 40% in Q3.' },
    { id: 'b1', kind: 'text', grid: { c1: 1, c2: 12, r1: 2, r2: 2 }, style: 'paragraph', text: 'Bound words', binding: BOUND },
    { id: 'm1', kind: 'metric', grid: { c1: 1, c2: 3, r1: 3, r2: 4 }, label: 'Paying customers', value: '42', binding: BOUND },
  ] },
  { uid: 'c-team', title: 'Team', layout: 'default', notes: 'Old notes.', blocks: [
    { id: 'p2', kind: 'text', grid: { c1: 1, c2: 12, r1: 2, r2: 3 }, style: 'paragraph', text: 'Two founders who built finance tools before.' },
  ] },
];

// ─────────────────────────────────────────────────────────── pure

test('translation keeps the same digits per block, in Western digits', () => {
  assert.equal(sameDigits('We grew 40% in Q3 2026.', 'Nous avons grandi de 40 % au T3 2026.'), true);
  assert.equal(sameDigits('1,200 customers', '1 200 clients'), true, 'separators aside');
  assert.equal(sameDigits('1,200 customers', '1.200 Kunden'), true);
  assert.equal(sameDigits('We grew 40% in Q3.', 'Nous avons grandi au T3.'), false, 'a figure dropped');
  assert.equal(sameDigits('We grew 40% in Q3.', 'Nous avons grandi de 45 % au T3.'), false, 'a figure changed');
  assert.equal(sameDigits('We grew 40%.', 'Nous avons grandi de 40 % en 2026.'), false, 'a figure added');
  assert.equal(sameDigits('We grew 10%.', 'Nous avons grandi de 10 % pour 99 clients.'), false, 'a figure added after the others');
  assert.equal(sameDigits('٤٠ عميلا', '٤٠ clients'), false, 'a translation keeps Western digits even when the source had none');
  assert.equal(sameDigits('We grew 40%.', 'نمونا بنسبة ٤٠٪'), false, 'another script is not the same digits');
  assert.equal(noNewDigits('We serve 3 regions.', 'We serve 3 regions well.'), true);
  assert.equal(noNewDigits('We serve 3 regions.', 'We serve 4 regions.'), false);
});

test('a language outside Guard\'s set warns; one inside it does not', () => {
  assert.deepEqual([...GUARD_LANGUAGES], ['English', 'French', 'German', 'Hindi', 'Italian', 'Portuguese', 'Spanish', 'Thai']);
  for (const lang of ['French', 'German', 'Spanish', 'Portuguese', 'Italian', 'Hindi']) assert.equal(languageWarning(lang), null, lang);
  for (const lang of ['Japanese', 'Arabic', 'Korean', 'Dutch', 'Chinese (Simplified)']) {
    const w = languageWarning(lang);
    assert.equal(w?.code, 'guard_language', lang);
    assert.match(String(w?.message), new RegExp(`not trained on ${lang.replace(/[()]/g, '\\$&')}`));
  }
});

test('a run sees only the founder\'s words: titles and unbound text blocks, never a bound block or a figure tile', () => {
  const cards = cardsOf(SLIDES);
  assert.deepEqual(cards.map((c) => [c.uid, c.title, c.blocks.map((b) => b.id)]), [['c-traction', 'Traction', ['p1']], ['c-team', 'Team', ['p2']]]);
  assert.deepEqual(cardsOf(SLIDES, ['c-team']).map((c) => c.uid), ['c-team']);
  assert.deepEqual(cardsOf(SLIDES, ['1']).map((c) => c.uid), ['c-team'], 'a place picks too');
  const msg = transformMessage('translate', cards, { language: 'French' });
  assert.match(msg.user, /Translate each block into French/);
  assert.match(msg.user, new RegExp(TITLE_ID));
  assert.doesNotMatch(msg.user, /Bound words|Paying customers|"42"/);
  for (const action of ['speaker_notes', 'proofread', 'fix_slide', 'translate'] as const) assert.match(TRANSFORM_OPTIONS[action], /^deck:/);
});

test('what may be proposed: a changed, dropped or added figure, a link and a guarantee are each left out with a reason', () => {
  const cards = cardsOf(SLIDES);
  const translated = proposalsFrom('translate', { cards: [
    { uid: 'c-traction', blocks: [{ id: TITLE_ID, text: 'Traction' }, { id: 'p1', text: 'Nous servons 3 régions et avons grandi de 45 % au T3.' }, { id: 'b1', text: 'x' }] },
    { uid: 'c-team', blocks: [{ id: 'p2', text: 'Deux fondateurs qui ont déjà construit des outils financiers.' }] },
  ] }, cards);
  assert.deepEqual(translated.cards.map((c) => [c.card_uid, (c.blocks || []).map((b) => b.id)]), [['c-team', ['p2']]], 'an unchanged title is no change; a block not sent is ignored');
  assert.deepEqual(translated.dropped, [{ card_uid: 'c-traction', index: 0, block: 'p1', reason: 'figures_changed' }]);

  const proofread = proposalsFrom('proofread', { cards: [{ uid: 'c-traction', blocks: [{ id: 'p1', text: 'We serve 3 regions and grew 40% in Q3, see https://x.example.' }] }, { uid: 'c-team', blocks: [{ id: 'p2', text: 'Two founders who have built finance tools before. Returns are guaranteed.' }] }] }, cards);
  assert.deepEqual(proofread.dropped.map((d) => d.reason), ['link_added']);
  assert.equal(proofread.cards[0].blocks?.[0].after, 'Two founders who have built finance tools before.', 'the guarantee sentence is dropped');

  const fixed = proposalsFrom('fix_slide', { cards: [{ uid: 'c-traction', blocks: [{ id: 'p1', text: 'We serve 5 regions.' }] }] }, cards);
  assert.deepEqual(fixed.dropped.map((d) => d.reason), ['figure_added']);

  const notes = proposalsFrom('speaker_notes', { cards: [
    { uid: 'c-traction', notes: 'Three regions, and 40% growth last quarter.' },
    { uid: 'c-team', notes: 'Our 2 founders shipped 9 products.' },
  ] }, cards);
  assert.deepEqual(notes.cards.map((c) => [c.card_uid, c.notes]), [['c-traction', { before: '', after: 'Three regions, and 40% growth last quarter.' }]]);
  assert.deepEqual(notes.dropped.map((d) => [d.card_uid, d.reason]), [['c-team', 'figure_added']]);
});

test('the one-click build run writes each card\'s speaker notes in the same run, checked as its words are', () => {
  const msg = buildMessage({ audience: 'seed_fund', prompt: '', rows: [], items: [], ventureName: 'Synthetic' } as any);
  assert.match(msg, /speaker notes/);
  assert.match(msg, /"notes":"\.\.\."/);
  const w = wordingFromModel({ cards: [{ n: 1, headline: 'Customers on record', body: 'Teams close faster.', notes: 'Say who they are and why they stay.' }, { n: 2, notes: 'We have 12 customers.' }] }, 2);
  assert.equal(w.byIndex[0].notes, 'Say who they are and why they stay.');
  assert.equal(w.byIndex[1].notes ?? null, null, 'notes that name a number are dropped');
  assert.equal(w.dropped, 1);
});

// ─────────────────────────────────────────────────────────── the route

async function fixture(answer: (prompt: string) => string) {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[1, 'admin', null], [2, 'founder', 100], [3, 'founder', 300]] as const) {
    insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Other venture',300)");
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (7, 1, 3, ?, 1)').run(JSON.stringify(SLIDES));
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (8, 1, 4, ?, 0)').run(JSON.stringify([{ uid: 'c-empty', title: '', blocks: [] }]));
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const calls: string[] = [];
  const AI = withGuard({
    run: async (_model: string, input: any) => {
      const prompt = (input?.messages || []).filter((m: any) => m.role === 'user').map((m: any) => String(m.content || '')).join('\n');
      calls.push(prompt);
      return { response: answer(prompt), usage: { prompt_tokens: 60, completion_tokens: 40 } };
    },
  });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckTransform).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT user_id, rail_option FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  const proposals = () => db.prepare('SELECT user_id, rail_option, record_ref, kind, payload_json FROM ai_rail_proposals ORDER BY id').all() as any[];
  const slidesOf = () => (db.prepare('SELECT slides FROM pitch_decks WHERE id = 7').get() as any).slides;
  return { db, app, env, calls, runs, proposals, slidesOf, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function post(f: F, who: number, path: string, json: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const NOTES_ANSWER = JSON.stringify({ cards: [{ uid: 'c-traction', notes: 'Three regions, and 40% growth last quarter.' }, { uid: 'c-team', notes: 'Two founders who have done this before.' }] });

test('speaker notes: quoted, run once under deck:notes, kept as one proposal, and nothing saved', async () => {
  const f = await fixture(() => NOTES_ANSWER);
  try {
    const before = f.slidesOf();
    const q = await post(f, 2, '/api/decks/7/transform/quote', { action: 'speaker_notes' });
    assert.equal(q.status, 200);
    assert.equal(q.body.ai, true);
    assert.equal(q.body.option, 'deck:notes');
    assert.equal(f.calls.length, 0, 'a quote runs nothing');
    const r = await post(f, 2, '/api/decks/7/transform', { action: 'speaker_notes' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.cards.map((c: any) => [c.card_uid, c.notes.after]), [['c-traction', 'Three regions, and 40% growth last quarter.'], ['c-team', 'Two founders who have done this before.']]);
    assert.deepEqual(f.runs().map((x) => [x.user_id, x.rail_option]), [[2, 'deck:notes']]);
    const [p] = f.proposals();
    assert.deepEqual([p.user_id, p.rail_option, p.record_ref, p.kind], [2, 'deck:notes', 'deck:7', 'proposal']);
    assert.equal(JSON.parse(p.payload_json).action, 'speaker_notes');
    assert.equal(f.slidesOf(), before, 'nothing is saved without Accept');
    assert.doesNotMatch(f.calls[0], /Bound words|Paying customers/);
  } finally { f.close(); }
});

test('translate: a block whose figures changed is left out; a language outside Guard\'s set warns in the quote and the answer', async () => {
  const f = await fixture(() => JSON.stringify({ cards: [
    { uid: 'c-traction', blocks: [{ id: 'p1', text: '3つの地域で、第3四半期に45%成長しました。' }] },
    { uid: 'c-team', blocks: [{ id: 'p2', text: '以前に金融ツールを作った二人の創業者。' }] },
  ] }));
  try {
    const q = await post(f, 2, '/api/decks/7/transform/quote', { action: 'translate', language: 'Japanese' });
    assert.equal(q.body.warning?.code, 'guard_language');
    const r = await post(f, 2, '/api/decks/7/transform', { action: 'translate', language: 'Japanese' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.warning?.code, 'guard_language');
    assert.deepEqual(r.body.cards.map((c: any) => c.card_uid), ['c-team']);
    assert.deepEqual(r.body.dropped, [{ card_uid: 'c-traction', index: 0, block: 'p1', reason: 'figures_changed' }]);
    const fr = await post(f, 2, '/api/decks/7/transform/quote', { action: 'translate', language: 'French' });
    assert.equal(fr.body.warning, undefined);
  } finally { f.close(); }
});

test('refused before any run, at no cost: an unknown action, a fix without one card, a language off the list, a deck with no words', async () => {
  const f = await fixture(() => NOTES_ANSWER);
  try {
    assert.equal((await post(f, 2, '/api/decks/7/transform', { action: 'summarise' })).status, 400);
    assert.equal((await post(f, 2, '/api/decks/7/transform', { action: 'fix_slide' })).status, 400);
    assert.equal((await post(f, 2, '/api/decks/7/transform', { action: 'fix_slide', cards: ['c-team', 'c-traction'] })).status, 400);
    assert.equal((await post(f, 2, '/api/decks/7/transform', { action: 'translate', language: 'Klingon' })).status, 400);
    const empty = await post(f, 2, '/api/decks/8/transform', { action: 'speaker_notes' });
    assert.equal(empty.status, 422);
    assert.equal(empty.body.error, 'nothing_to_change');
    assert.equal(f.calls.length, 0);
    assert.equal(f.runs().length, 0);
  } finally { f.close(); }
});

test('an answer with nothing that may be placed is 422, charged for the run, and proposes nothing', async () => {
  const f = await fixture(() => JSON.stringify({ cards: [{ uid: 'c-traction', blocks: [{ id: 'p1', text: 'We serve 9 regions.' }] }] }));
  try {
    const r = await post(f, 2, '/api/decks/7/transform', { action: 'fix_slide', cards: ['c-traction'] });
    assert.equal(r.status, 422);
    assert.equal(r.body.error, 'nothing_proposed');
    assert.equal(f.runs().length, 1);
    assert.equal(f.proposals().length, 0);
  } finally { f.close(); }
});

test('only the deck\'s founders transform it: an admin and another founder are refused before any run', async () => {
  const f = await fixture(() => NOTES_ANSWER);
  try {
    assert.equal((await post(f, 1, '/api/decks/7/transform', { action: 'speaker_notes' })).status, 403);
    assert.ok([403, 404].includes((await post(f, 3, '/api/decks/7/transform', { action: 'speaker_notes' })).status));
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test('buildCards places the run\'s notes on the card and none where the run gave none', () => {
  const src = readFileSync(new URL('../src/services/decks/newDeck.ts', import.meta.url), 'utf8');
  assert.match(src, /return wording\[i\]\?\.notes \? \{ \.\.\.card, notes: wording\[i\]\.notes \} : card;/);
  assert.equal(typeof buildCards, 'function');
});

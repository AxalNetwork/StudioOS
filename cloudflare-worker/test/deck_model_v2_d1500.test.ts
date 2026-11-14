/**
 * D1500 (#3750) — the deck document model v2, through the real mounted deck
 * routes on SQLite (migrations 539, 538 and 714 applied from their files).
 *
 *   1. A save in another model's shape answers 409 upgrade_required and writes
 *      nothing; a v2 save keeps every card's uid and gives one to a card
 *      without (once, never two cards the same).
 *   2. Reordering cards mid-run: a result named by uid lands on its card.
 *   3. Rich text: runs round-trip; a link that is not https is dropped; more
 *      than three accents, or one that does not read on the card, is refused.
 *   4. The caps: a 300 KB card, 17 decor items, 13 areas, each a sentence.
 *   5. The theme's chrome, voice, art direction, language and direction, and
 *      a card's hidden and section, round-trip.
 *
 * Every principal and line is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_model_v2_d1500.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import decks from '../src/routes/decks.ts';
import deckNotes from '../src/routes/deck_notes.ts';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import {
  MAX_ACCENT_RUNS, MODEL_VERSION, assignCardUids, cardIndexOf, cardRefOf, cardUidAt, contrastRatio, modelProblems, parasOf, sanitizeTheme,
} from '../src/services/decks/slideModel.ts';
import { sanitizeImageUrl, sanitizeSlides } from '../src/routes/decks.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const EDITOR = readFileSync(new URL('../sql/migrations/539_pitch_deck_editor.sql', import.meta.url), 'utf8');
const NOTES = readFileSync(new URL('../sql/migrations/538_deck_notes.sql', import.meta.url), 'utf8');
const M714 = readFileSync(new URL('../sql/migrations/714_deck_card_uids.sql', import.meta.url), 'utf8');
const SECRET = 'synthetic-deck-model-v2-secret-d1500'.repeat(2);
const OWNER = 2;

const heading = (id: string, words: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, style: 'heading', text: words, ...extra });
const card = (uid: string | undefined, title: string, extra: Record<string, unknown> = {}) => ({ ...(uid ? { uid } : {}), title, layout: 'statement', blocks: [heading('h', title)], ...extra });

async function call(f: any, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: OWNER }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await f.app.request(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env);
  const text = await res.text();
  let value: any; try { value = JSON.parse(text); } catch { value = text; }
  return { status: res.status, body: value };
}

async function fixture() {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec('PRAGMA foreign_keys=OFF; ALTER TABLE users ADD COLUMN founder_id INTEGER; ALTER TABLE activity_logs ADD COLUMN project_id INTEGER; ALTER TABLE activity_logs ADD COLUMN entity_type TEXT; ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;');
  for (const table of ['projects', 'pitch_decks', 'raise_rounds', 'landing_pages']) f.db.exec(stripForeignKeys(tableFromBaseline(BASELINE, table)));
  f.db.exec(readFileSync(new URL('../sql/migrations/399_landing_brand_voice_dark_logo_archive.sql', import.meta.url), 'utf8'));
  f.db.exec(EDITOR);
  f.db.exec(stripForeignKeys(NOTES));
  // Migration 714's deck_notes column; its other three tables are not in this fixture.
  f.db.exec(M714.split('\n').filter((l) => l.startsWith('ALTER TABLE deck_notes ')).join('\n'));
  f.db.exec(`CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    INSERT INTO user_company_links VALUES(${OWNER},101);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'Synthetic venture',20,101);`);
  f.db.prepare('INSERT OR IGNORE INTO users(id,email,name,role) VALUES(?,?,?,?)').run(OWNER, 'synthetic2@example.test', 'Synthetic 2', 'founder');
  f.db.prepare("UPDATE users SET name = 'Synthetic 2', role = 'founder', founder_id = 20, subscription_tier = 'studio', is_active = 1 WHERE id = ?").run(OWNER);
  const env: any = { DB: f.DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/decks', deckNotes).route('/api/decks', decks);
  app.onError((err: any, c: any) => c.json({ error: String(err?.message) }, 500));
  f.db.prepare('INSERT INTO pitch_decks(id,project_id,version,slides,title,is_current,created_by) VALUES(10,1,1,?,?,1,?)').run(JSON.stringify([card(undefined, 'Synthetic problem'), card(undefined, 'Synthetic traction')]), 'Synthetic deck', OWNER);
  await ensureProjectMembershipSchema(env);
  f.db.exec(`INSERT INTO project_members(project_id,user_id,role,status) VALUES(1,${OWNER},'owner','accepted')`);
  return { ...f, app, env };
}
const versions = (f: any) => (f.db.prepare('SELECT COUNT(*) AS n FROM pitch_decks WHERE project_id = 1').get() as any).n;

test('1. another model\'s shape is refused with 409 and writes nothing; a v2 save keeps uids and gives each card one', async () => {
  const f = await fixture();
  try {
    const read = await call(f, 'GET', '/api/decks/10');
    assert.equal(read.body.model_version, MODEL_VERSION);
    assert.deepEqual(read.body.slides.map((s: any) => s.uid), ['c1', 'c2'], 'a card saved before uids reads one from its place');
    assert.deepEqual((await call(f, 'GET', '/api/decks/10')).body.slides.map((s: any) => s.uid), ['c1', 'c2'], 'and the same one every read');
    // Mutation checked: dropping the model_version check lets both of these through and strips nothing it is told about.
    for (const body of [{ slides: read.body.slides }, { slides: read.body.slides, model_version: 1 }, { slides: read.body.slides, model_version: 3 }]) {
      const r = await call(f, 'PUT', '/api/decks/10', body);
      assert.equal(r.status, 409, JSON.stringify(body.model_version ?? null));
      assert.equal(r.body.error, 'upgrade_required');
      assert.equal(r.body.model_version, 2);
      assert.match(r.body.message, /Reload the page, then save again\. Nothing was saved\./);
    }
    assert.equal(versions(f), 1, 'no refused save wrote a version');
    const saved = await call(f, 'PUT', '/api/decks/10', { model_version: 2, slides: [card('keep-me', 'Synthetic one'), card(undefined, 'Synthetic two'), card('keep-me', 'Synthetic three'), card('bad uid!', 'Synthetic four')] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const uids = saved.body.slides.map((s: any) => s.uid);
    assert.equal(uids[0], 'keep-me', 'a sound uid is kept');
    assert.equal(uids[1], 'c2');
    assert.equal(uids[2], 'c3', 'a uid already used on the deck is not given twice');
    assert.equal(uids[3], 'c4', 'a malformed uid is replaced');
    assert.equal(new Set(uids).size, uids.length);
  } finally { f.db.close(); }
});

test('2. reordering cards mid-run: a result named by uid lands on its card, whatever its place now', async () => {
  const f = await fixture();
  try {
    const first = await call(f, 'PUT', '/api/decks/10', { model_version: 2, slides: [card('card-a', 'Synthetic problem'), card('card-b', 'Synthetic traction'), card('card-c', 'Synthetic team')] });
    assert.equal(first.status, 200);
    // A run on B goes out; meanwhile the founder moves the team card first and saves.
    const moved = await call(f, 'PUT', `/api/decks/${first.body.id}`, { model_version: 2, slides: [card('card-c', 'Synthetic team'), card('card-a', 'Synthetic problem'), card('card-b', 'Synthetic traction')] });
    assert.equal(moved.status, 200);
    const stored = JSON.parse((f.db.prepare('SELECT slides FROM pitch_decks WHERE id = ?').get(moved.body.id) as any).slides);
    // Mutation checked: resolving by the place the run started at (1) names A.
    assert.deepEqual(cardRefOf(stored, { card: 1, card_uid: 'card-b' }), { uid: 'card-b', index: 2 });
    assert.deepEqual(cardRefOf(stored, { card: 1 }), { uid: 'card-a', index: 1 }, 'a place alone reads its card\'s uid');
    assert.deepEqual(cardRefOf(stored, { card: 3, card_uid: 'card-new' }), { uid: 'card-new', index: 3 }, 'a card added since the save keeps the place sent');
    assert.ok('error' in cardRefOf(stored, { card_uid: 'not a uid' }));
    assert.equal(cardIndexOf(stored, 'card-b'), 2);
    assert.equal(cardUidAt(stored, 0), 'card-c');
    // The store: a note named by uid is kept on that card, with its place on the version.
    const note = await call(f, 'POST', `/api/decks/${moved.body.id}/notes`, { body: 'SYNTHETIC-NOTE the growth figure', card_uid: 'card-b' });
    assert.equal(note.status, 201, JSON.stringify(note.body));
    assert.equal(note.body.note.card_uid, 'card-b');
    assert.equal(note.body.note.card_index, 2);
    const row = f.db.prepare('SELECT card_index, card_uid FROM deck_notes ORDER BY id DESC LIMIT 1').get() as any;
    assert.deepEqual({ ...row }, { card_index: 2, card_uid: 'card-b' });
    const missing = await call(f, 'POST', `/api/decks/${moved.body.id}/notes`, { body: 'SYNTHETIC-NOTE x', card_uid: 'card-gone' });
    assert.equal(missing.status, 400, 'a card not on this version takes no note');
  } finally { f.db.close(); }
});

test('3. rich text: runs round-trip, a link that is not https is dropped, accents are capped and must read on the card', async () => {
  const runs = [
    { text: 'Synthetic ' }, { text: 'bold', b: true }, { text: ' and ' }, { text: 'italic', i: true },
    { text: ' see ', u: true }, { text: 'the report', href: 'https://example.com/report', accent: '#1A4F8B' }, { text: ' or ', href: 'javascript:alert(1)' },
    { text: 'http', href: 'http://example.com/plain' },
  ];
  const kept = parasOf([{ runs }], sanitizeImageUrl);
  assert.ok(kept);
  assert.equal(kept!.text, 'Synthetic bold and italic see the report or http', 'the plain copy every older reader shows');
  const flat = kept!.paras[0].runs;
  assert.deepEqual(flat[1], { text: 'bold', b: true });
  assert.deepEqual(flat[5], { text: 'the report', accent: '#1a4f8b', href: 'https://example.com/report' });
  assert.deepEqual(flat[6], { text: ' or ' }, 'a javascript: link is dropped, the words stay');
  assert.deepEqual(flat[7], { text: 'http' }, 'an http link is dropped');
  // Through the save path, the same.
  const [slide] = sanitizeSlides([card('r', 'Synthetic', { blocks: [heading('t', 'ignored', { paras: [{ runs }] })] })]);
  assert.equal(slide.blocks[0].text, kept!.text);
  assert.deepEqual(slide.blocks[0].paras, kept!.paras);
  // Accents: at most three, each readable on the card.
  const accent = (n: number, colour = '#1a4f8b') => [{ runs: Array.from({ length: n }, (_, i) => ({ text: `w${i} `, accent: colour })) }];
  assert.equal(parasOf(accent(5), sanitizeImageUrl)!.paras[0].runs.filter((r: any) => r.accent).length, MAX_ACCENT_RUNS, 'sanitize keeps the first three');
  const problem = (paras: unknown, bg?: string) => modelProblems([{ ...card('p', 'Synthetic'), ...(bg ? { background: { color: bg } } : {}), blocks: [heading('t', 'x', { paras })] }], sanitizeImageUrl);
  assert.match(problem(accent(4)).join(' '), /at most 3 accent runs/);
  assert.ok(contrastRatio('#ffff66', '#ffffff') < 4.5);
  assert.match(problem(accent(1, '#ffff66')).join(' '), /does not read against the card/);
  assert.deepEqual(problem(accent(1, '#ffff66'), '#111111'), [], 'the same accent reads on a dark card');
  assert.deepEqual(problem(accent(3)), []);
});

test('4. the caps: a 300 KB card, 17 decor items and 13 areas are refused with a sentence and write nothing', async () => {
  const f = await fixture();
  try {
    const big = card('big', 'Synthetic', { notes: 'n', blocks: [heading('t', 'x')], decor: [], fields: Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, label: 'L', kind: 'paragraph', value: 'x'.repeat(10_000) })) });
    const r = await call(f, 'PUT', '/api/decks/10', { model_version: 2, slides: [big] });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Card 1: the card is larger than 256 KB\. Remove an image or some text, then save\./);
    const decor = Array.from({ length: 17 }, (_, i) => ({ id: `d${i}`, kind: 'divider' }));
    const d = await call(f, 'PUT', '/api/decks/10', { model_version: 2, slides: [card('d', 'Synthetic', { decor })] });
    assert.equal(d.status, 400);
    assert.match(d.body.error, /Card 1: a card holds at most 16 decor items\./);
    const areas = Array.from({ length: 13 }, (_, i) => ({ id: `a${i}`, grid: { c1: i % 12 + 1, c2: i % 12 + 1, r1: Math.floor(i / 12) + 1, r2: Math.floor(i / 12) + 1 } }));
    const a = await call(f, 'PUT', '/api/decks/10', { model_version: 2, slides: [card('a', 'Synthetic', { structure: 'custom', areas })] });
    assert.equal(a.status, 400);
    assert.match(a.body.problems.join(' '), /at most 12 areas/);
    assert.equal(versions(f), 1);
    const ok = await call(f, 'PUT', '/api/decks/10', { model_version: 2, slides: [card('d', 'Synthetic', { decor: decor.slice(0, 16) })] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.slides[0].decor.length, 16);
  } finally { f.db.close(); }
});

test('5. the theme\'s chrome, voice, art direction, language and direction, and a card\'s hidden and section, round-trip', async () => {
  const f = await fixture();
  try {
    const theme = {
      kind: 'neutral_light', chrome: { page_number: true, footer_text: 'Synthetic Labs · Seed 2026', logo_corner: false, confidential: true },
      compliance_fls: false, confidential: false,
      voice: 'Plain and direct', art_direction: 'Warm light, real people, no stock gradients', lang: 'fr-CA', dir: 'ltr',
    };
    const s = await call(f, 'PUT', '/api/decks/10', { model_version: 2, theme, slides: [card('a', 'Synthetic', { hidden: true, section: 'Appendix A', appendix: true }), card('b', 'Synthetic two')] });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const back = await call(f, 'GET', `/api/decks/${s.body.id}`);
    assert.deepEqual(back.body.theme, { ...theme, background: null });
    assert.equal(back.body.slides[0].hidden, true);
    assert.equal(back.body.slides[0].section, 'Appendix A');
    assert.equal(back.body.slides[0].appendix, true);
    assert.equal(back.body.slides[1].hidden, undefined, 'a shown card carries no flag');
    // Each field kept only when set, so a theme saved before v2 reads as it did.
    assert.deepEqual(sanitizeTheme({ kind: 'brand' }, sanitizeImageUrl), { kind: 'brand', background: null });
    assert.deepEqual(sanitizeTheme({ kind: 'brand', chrome: { page_number: false }, lang: 'not a tag!', dir: 'up' }, sanitizeImageUrl), { kind: 'brand', background: null });
  } finally { f.db.close(); }
});

test('uids are assigned once over the whole deck', () => {
  assert.deepEqual(assignCardUids([{ uid: 'c2' }, {}, {}]).map((c) => c.uid), ['c2', 'c2-2', 'c3'], 'a place-uid already taken gets a suffix');
  assert.deepEqual(assignCardUids([]), []);
});

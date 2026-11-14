/**
 * D4268 (#4268, D4254 P2a): the Script tab's whole-deck script and its
 * notes-only save. Synthetic data, the mounted Worker routes and the real
 * migrated schema; `env.AI` is a stub and `fetch` throws.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_script_d4268.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckScript, { mount } from '../src/routes/deck_script.ts';
import decks from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import {
  DEFAULT_WPM, cardBudgetsS, figuresOf, paceOf, scriptFrom, scriptMessage, wordTarget, wordsOf,
} from '../src/services/decks/script.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { loadSchema } from './_schema_once.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'deck-script-d4268-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
loadSchema(schema); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d4268-only-not-a-real-credential'.repeat(2);

const BOUND = { source_key: 'grow.paying_customers', record_ref: 'project_metrics:1', as_of: '2026-10-10', grade: 'Stated', snapshot_hash: 'a'.repeat(24) };
const SLIDES = [
  { uid: 'c-problem', title: 'Problem', layout: 'default', notes: 'Old problem notes.', blocks: [
    { id: 'p1', kind: 'text', grid: { c1: 1, c2: 12, r1: 2, r2: 3 }, style: 'paragraph', text: 'Finance teams spend 2 days a month matching bank lines by hand.' },
  ] },
  { uid: 'c-traction', title: 'Traction', layout: 'metric_tiles', blocks: [
    { id: 'm1', kind: 'metric', grid: { c1: 1, c2: 3, r1: 3, r2: 4 }, label: 'Paying teams', value: '42', binding: BOUND },
    { id: 'p2', kind: 'text', grid: { c1: 1, c2: 12, r1: 5, r2: 6 }, style: 'paragraph', text: 'Teams close in hours, not days.' },
  ] },
  { uid: 'c-team', title: 'Team', layout: 'default', blocks: [
    { id: 'p3', kind: 'text', grid: { c1: 1, c2: 12, r1: 2, r2: 3 }, style: 'paragraph', text: 'Two founders who built finance tools before.' },
  ] },
  { uid: 'c-blank', title: '', layout: 'default', blocks: [] },
];
const THEME = { kind: 'brand', background: null, voice: 'Plain and direct.' };

// ─────────────────────────────────────────────────────────── pure

test('the budgets are Rehearse\'s split, and a word target is the budget at the pace', () => {
  assert.deepEqual(cardBudgetsS(180, 12), Array(12).fill(15));
  assert.deepEqual(cardBudgetsS(180, 7), [26, 26, 26, 26, 26, 25, 25], 'the first cards take the leftover seconds');
  assert.equal(cardBudgetsS(120, 7).reduce((a, b) => a + b, 0), 120);
  assert.deepEqual(cardBudgetsS(300, 0), []);
  assert.equal(wordTarget(15, 150), 38, '15 s at 150 words a minute is 37.5, rounded');
  assert.equal(wordTarget(25, 142), 59);
  assert.equal(wordTarget(45, 120), 90);
  assert.equal(wordTarget(0, 150), 1, 'never below one word');
  assert.equal(DEFAULT_WPM, 150);
  assert.equal(wordsOf('  MRR is   up. '), 3);
  assert.equal(wordsOf(null), 0);
});

test('the pace is the rehearsal\'s words a minute, inside 80 to 220, or nothing', () => {
  assert.equal(paceOf(JSON.stringify({ totals: { wpm: 142 } })), 142);
  assert.equal(paceOf({ totals: { wpm: 141.6 } }), 142);
  assert.equal(paceOf({ totals: { wpm: 80 } }), 80);
  assert.equal(paceOf({ totals: { wpm: 220 } }), 220);
  assert.equal(paceOf({ totals: { wpm: 79 } }), null);
  assert.equal(paceOf({ totals: { wpm: 221 } }), null);
  assert.equal(paceOf({ totals: { wpm: null } }), null, 'a rehearsal too short to read has no pace');
  assert.equal(paceOf('not json'), null);
  assert.equal(paceOf(null), null);
});

test('a card\'s figures are its metric tiles and bound blocks, and the script may say them and no other', () => {
  assert.deepEqual(figuresOf(SLIDES[1]), ['Paying teams: 42']);
  const card = { uid: 'c-traction', index: 1, title: 'Traction', blocks: [{ id: 'p2', text: 'Teams close in hours, not days.' }], notes: '', figures: figuresOf(SLIDES[1]), budget_s: 45, target_words: 113 };
  assert.deepEqual(scriptFrom({ notes: '42 teams pay us today. They close in hours.' }, card), { ok: true, notes: '42 teams pay us today. They close in hours.', words: 9 });
  assert.deepEqual(scriptFrom({ notes: '42 teams pay us, and MRR is 18,400.' }, card), { ok: false, reason: 'figure_added' });
  assert.deepEqual(scriptFrom({ notes: 'Read more at https://x.example.' }, card), { ok: false, reason: 'link_added' });
  assert.deepEqual(scriptFrom({ notes: 'Investors are guaranteed a return.' }, card), { ok: false, reason: 'guarantee_language' });
  assert.deepEqual(scriptFrom({ notes: '' }, card), { ok: false, reason: 'empty' });
  assert.deepEqual(scriptFrom({}, card), { ok: false, reason: 'empty' });
  const msg = scriptMessage(card, { audience: 'demo_day', tone: 'bold' });
  assert.match(msg.user, /about 113 words \(it has 45 seconds\)/);
  assert.match(msg.user, /demo day stage/);
  assert.match(msg.user, /confident and energetic/);
  assert.match(msg.user, /Paying teams: 42/);
});

// ─────────────────────────────────────────────────────────── the routes

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
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, theme_json, is_current) VALUES (7, 1, 3, ?, ?, ?, 1)')
    .run(JSON.stringify(SLIDES), 'Seed deck', JSON.stringify(THEME));
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (6, 1, 2, ?, 0)').run(JSON.stringify(SLIDES));
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (9, 3, 1, ?, 1)').run(JSON.stringify([{ uid: 'c-blank', title: '', blocks: [] }]));
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
  const app = new Hono<any>().route(mount.path, deckScript).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT id, user_id, rail_option, reservation_uid, charged_microusd FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  const holds = () => db.prepare('SELECT uid, status, actual_included_microusd + actual_topup_microusd AS settled FROM ai_budget_reservations WHERE user_id = 2 ORDER BY created_at').all() as any[];
  const proposals = () => db.prepare('SELECT user_id, rail_option, record_ref, kind, payload_json FROM ai_rail_proposals ORDER BY id').all() as any[];
  const versions = () => db.prepare('SELECT id, version, slides, title, theme_json, is_current FROM pitch_decks WHERE project_id = 1 ORDER BY version').all() as any[];
  const rehearsed = (wpm: number | null, at = '2026-11-02 18:20:00') => db.prepare(
    "INSERT INTO deck_rehearsals (uid, deck_id, project_id, user_id, pitch_seconds, duration_ms, status, report_json, created_at) VALUES (?, 6, 1, 2, 180, 190000, 'reported', ?, ?)",
  ).run(crypto.randomUUID(), JSON.stringify({ totals: { wpm } }), at);
  return { db, app, env, calls, runs, holds, proposals, versions, rehearsed, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, json: unknown, headers: Record<string, string> = {}) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const post = (f: F, who: number, path: string, json: unknown, headers?: Record<string, string>) => call(f, who, 'POST', path, json, headers);
const put = (f: F, who: number, path: string, json: unknown, headers?: Record<string, string>) => call(f, who, 'PUT', path, json, headers);

/** Each card's draft by its title: Traction's says a figure that is not on its card. */
const DRAFTS = (prompt: string) => JSON.stringify({ notes: /"title":"Problem"/.test(prompt)
  ? 'Every month, finance teams lose 2 days matching bank lines by hand.'
  : /"title":"Traction"/.test(prompt) ? '42 teams pay us, and MRR is 18,400.' : 'Two founders who built finance tools before.' });

test('the quote: one hold for every card, each card\'s target from its budget at 150 words a minute, and nothing run', async () => {
  const f = await fixture(DRAFTS);
  try {
    const q = await post(f, 2, '/api/decks/7/script/quote', { length_s: 120 });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.ai, true);
    assert.equal(q.body.count, 3, 'the blank card has nothing to script');
    assert.deepEqual(q.body.pace, { wpm: 150, source: 'default', rehearsal_at: null, pitch_seconds: null });
    assert.deepEqual(q.body.targets.map((t: any) => [t.card_uid, t.budget_s, t.target_words]), [['c-problem', 30, 75], ['c-traction', 30, 75], ['c-team', 30, 75]]);
    assert.ok(q.body.hold_microusd > 0);
    assert.equal(f.calls.length, 0, 'a quote runs nothing');
    assert.equal(f.holds().length, 0, 'and holds nothing');
  } finally { f.close(); }
});

test('the pace is the founder\'s latest rehearsal of the venture\'s deck, on any version', async () => {
  const f = await fixture(DRAFTS);
  try {
    f.rehearsed(100, '2026-10-29 21:10:00');
    f.rehearsed(120, '2026-11-02 18:20:00');
    const q = await post(f, 2, '/api/decks/7/script/quote', { length_s: 300 });
    assert.deepEqual(q.body.pace, { wpm: 120, source: 'rehearsal', rehearsal_at: '2026-11-02 18:20:00', pitch_seconds: 180 }, 'Match my last rehearsal reads its length here');
    assert.deepEqual(q.body.targets.map((t: any) => [t.budget_s, t.target_words]), [[75, 150], [75, 150], [75, 150]], '300 s over four cards, at 120 words a minute');
    f.rehearsed(null, '2026-11-03 09:00:00');
    const later = await post(f, 2, '/api/decks/7/script/quote', {});
    assert.equal(later.body.pace.source, 'default', 'a latest rehearsal with no pace is not passed over for an older one');
  } finally { f.close(); }
});

test('the press: one hold, one run a card under deck:notes, a card naming a new figure fails at zero, settled once, nothing saved', async () => {
  const f = await fixture(DRAFTS);
  try {
    const before = f.versions();
    const r = await post(f, 2, '/api/decks/7/script', { length_s: 180, audience: 'partner', tone: 'warm' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.cards.map((c: any) => [c.card_uid, c.budget_s, c.target_words, c.words]),
      [['c-problem', 45, 113, 12], ['c-team', 45, 113, 7]]);
    assert.equal(r.body.cards[0].notes, 'Every month, finance teams lose 2 days matching bank lines by hand.');
    assert.deepEqual(r.body.failed, [{ card_uid: 'c-blank', index: 3, reason: 'no_words' }, { card_uid: 'c-traction', index: 1, reason: 'figure_added' }]);
    assert.ok(r.body.cards.every((c: any) => typeof c.model === 'string' && c.model), 'each placed card names its model');
    // One hold for the whole deck, each card its own run under it.
    const [hold, ...more] = f.holds();
    assert.equal(more.length, 0, 'one hold');
    const runs = f.runs();
    assert.deepEqual(runs.map((x) => [x.user_id, x.rail_option, x.reservation_uid]), [[2, 'deck:notes', hold.uid], [2, 'deck:notes', hold.uid], [2, 'deck:notes', hold.uid]]);
    assert.equal(runs[1].charged_microusd, 0, 'the failed card\'s run is settled at zero');
    assert.ok(runs[0].charged_microusd > 0 && runs[2].charged_microusd > 0);
    assert.equal(hold.status, 'settled');
    assert.equal(hold.settled, runs[0].charged_microusd + runs[2].charged_microusd, 'settled once, at what the placed cards cost');
    assert.equal(r.body.charged_microusd, hold.settled);
    assert.ok(r.body.charged_microusd <= r.body.hold_microusd);
    // The prompts carry each card's target, the audience and the tone, and only the card's own figures.
    assert.match(f.calls[0], /about 113 words \(it has 45 seconds\)/);
    assert.match(f.calls[0], /partner meeting/);
    assert.match(f.calls[0], /warm and personal/);
    assert.match(f.calls[1], /Paying teams: 42/);
    const [p, ...others] = f.proposals();
    assert.equal(others.length, 0);
    assert.deepEqual([p.user_id, p.rail_option, p.record_ref, p.kind], [2, 'deck:notes', 'deck:7', 'proposal']);
    assert.equal(JSON.parse(p.payload_json).cards.length, 2);
    assert.deepEqual(f.versions(), before, 'nothing is saved: Save script is the notes-only save');
  } finally { f.close(); }
});

test('Regenerate this card runs one card, at the budget it has in the whole deck', async () => {
  const f = await fixture(DRAFTS);
  try {
    const r = await post(f, 2, '/api/decks/7/script', { length_s: 120, cards: ['c-team'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.cards.map((c: any) => [c.card_uid, c.budget_s, c.target_words]), [['c-team', 30, 75]]);
    assert.deepEqual(r.body.failed, []);
    assert.equal(f.calls.length, 1);
    assert.equal((await post(f, 2, '/api/decks/7/script', { cards: ['c-nowhere'] })).status, 400);
  } finally { f.close(); }
});

test('the same Idempotency-Key twice takes one hold and runs each card once', async () => {
  const f = await fixture(DRAFTS);
  try {
    const key = { 'Idempotency-Key': 'script-press-0001' };
    assert.equal((await post(f, 2, '/api/decks/7/script', {}, key)).status, 200);
    const again = await post(f, 2, '/api/decks/7/script', {}, key);
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'already_pressed');
    assert.equal(f.holds().length, 1);
    assert.equal(f.calls.length, 3);
  } finally { f.close(); }
});

test('refused before anything runs: a length, audience or tone off the list, a deck with nothing to script, an admin, another founder', async () => {
  const f = await fixture(DRAFTS);
  try {
    assert.equal((await post(f, 2, '/api/decks/7/script', { length_s: 240 })).status, 400);
    assert.equal((await post(f, 2, '/api/decks/7/script', { audience: 'board' })).status, 400);
    assert.equal((await post(f, 2, '/api/decks/7/script', { tone: 'funny' })).status, 400);
    const blank = await post(f, 3, '/api/decks/9/script', {});
    assert.equal(blank.status, 422);
    assert.equal(blank.body.error, 'nothing_to_change');
    assert.equal((await post(f, 1, '/api/decks/7/script', {})).status, 403);
    assert.ok([403, 404].includes((await post(f, 3, '/api/decks/7/script', {})).status));
    assert.equal(f.calls.length, 0);
    assert.equal(f.holds().length, 0);
  } finally { f.close(); }
});

test('the notes-only save writes exactly one version, changes only the notes, and keeps the theme', async () => {
  const f = await fixture(DRAFTS);
  try {
    const r = await put(f, 2, '/api/decks/7/notes-script', { notes: [
      { card_uid: 'c-traction', notes: '  42 teams pay us today.  ' },
      { card_uid: 'c-problem', notes: '' },
      { card_uid: 'c-team', notes: SLIDES[2].notes ?? '' },
    ] }, { 'If-Match': '3' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.saved, 2, 'an unchanged card is not counted');
    const vs = f.versions();
    assert.deepEqual(vs.map((v) => [v.version, v.is_current]), [[2, 0], [3, 0], [4, 1]], 'one new version');
    const [, prev, now] = vs;
    const a = JSON.parse(prev.slides);
    const b = JSON.parse(now.slides);
    assert.equal(b[1].notes, '42 teams pay us today.');
    assert.equal(b[0].notes, undefined, 'an empty script clears the notes');
    const strip = (s: any[]) => s.map(({ notes, ...rest }: any) => rest);
    assert.deepEqual(strip(b), strip(a), 'nothing but the notes changed');
    assert.equal(now.title, 'Seed deck');
    assert.deepEqual(JSON.parse(now.theme_json), THEME, 'the theme is kept');
    assert.equal(r.body.deck.version, 4);
  } finally { f.close(); }
});

test('the notes-only save refuses and writes nothing: no change, a card not on the deck, notes too long, a stale version, a stranger', async () => {
  const f = await fixture(DRAFTS);
  try {
    const same = await put(f, 2, '/api/decks/7/notes-script', { notes: [{ card_uid: 'c-problem', notes: 'Old problem notes.' }] });
    assert.deepEqual(same.body, { unchanged: true, deck_id: 7 });
    const stray = await put(f, 2, '/api/decks/7/notes-script', { notes: [{ card_uid: 'c-traction', notes: 'Fine.' }, { card_uid: 'c-gone', notes: 'x' }] });
    assert.equal(stray.status, 400);
    assert.equal(stray.body.error, 'card_not_on_deck');
    const long = await put(f, 2, '/api/decks/7/notes-script', { notes: [{ card_uid: 'c-team', notes: 'x'.repeat(4001) }] });
    assert.equal(long.status, 400);
    assert.equal(long.body.error, 'notes_too_long');
    assert.equal((await put(f, 2, '/api/decks/7/notes-script', { notes: [] })).status, 400);
    const stale = await put(f, 2, '/api/decks/6/notes-script', { notes: [{ card_uid: 'c-team', notes: 'From an old version.' }] });
    assert.equal(stale.status, 409, 'an old version is never the base of a save');
    assert.equal(stale.body.error, 'deck_version_conflict');
    const staleMatch = await put(f, 2, '/api/decks/7/notes-script', { notes: [{ card_uid: 'c-team', notes: 'New.' }] }, { 'If-Match': '2' });
    assert.equal(staleMatch.status, 409);
    assert.equal((await put(f, 1, '/api/decks/7/notes-script', { notes: [{ card_uid: 'c-team', notes: 'Admin.' }] })).status, 403);
    assert.deepEqual(f.versions().map((v) => v.version), [2, 3], 'nothing was written');
  } finally { f.close(); }
});

/**
 * D6069 (#6069) — New version starts from a saved pitch deck version's words
 * (NAR11, "Start from: Pitch deck vN's words"), for any venture with a saved
 * deck version. Real SQLite: the D909 fixture plus 202611031522 and the
 * 202611151230 rebuild of narrative_version_meta.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/narrative_start_from_deck_6069.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import cycleRaise from '../src/routes/cycle_raise.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { cardWords, deckWords, titleKey } from '../src/services/narrative/deckWords.ts';
import { basedOnLabel } from '../src/services/raiseCycle.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { raiseEvidenceTables } from './_raise_evidence_fixture.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');

const FOUNDER = 110, OTHER = 120;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder' };
const P = 1, PB = 2;

function fixture(rebuild = true) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of [
    'users', 'projects', 'activity_logs', 'cap_table_scenarios', 'cap_table_holders', 'cap_table_vesting', 'raise_prospects', 'raise_rounds',
    'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens', 'deck_share_views', 'data_room_folders', 'data_room_files',
    'dd_cases', 'dd_requests', 'contacts', 'pain_groups', 'hypotheses', 'mvp_features', 'roadmap_okrs',
  ]) db.exec(tableFromBaseline(BASELINE, t));
  const cols = (t: string) => new Set((db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as any[]).map((r) => r.name));
  if (!cols('pitch_deck_share_tokens').has('revoked_at')) db.exec(sqlOf('248_deck_share_revoked_at.sql'));
  db.exec(sqlOf('129_captable_one_canonical_per_project.sql'));
  db.exec(sqlOf('249_project_metrics.sql'));
  db.exec(sqlOf('410_safe_issuances.sql'));
  db.exec(sqlOf('442_raise_cycle_stores.sql'));
  db.exec(sqlOf('459_cycle_activity_convention.sql'));
  db.exec(sqlOf('463_raise_record_stores.sql'));
  db.exec(sqlOf('544_narrative_sections.sql'));
  db.exec(sqlOf('202611082100_narrative_version_revision.sql'));
  db.exec(sqlOf('202611031522_pitch_decks_narrative_version.sql'));
  if (rebuild) db.exec(sqlOf('202611151230_6069_narrative_start_from_deck.sql'));
  raiseEvidenceTables(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (${PB}, 'Osprey Works', 1002)`);
  // Kestrel holds the Spin-Out deck's wording (version 0), so it is a Spin-Out venture.
  db.prepare('INSERT INTO spinout_deck_overrides (project_id, field_key, value, version) VALUES (?, ?, ?, 0)').run(P, 'problem.framing', 'Finance teams close the month by hand.');
  db.prepare('INSERT INTO project_metrics (project_id, snapshot_date, mrr) VALUES (?, ?, ?)').run(P, '2026-09-30', 16950);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles', createCycleRecords());
app.route('/api/cycles/raise', cycleRaise);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, pid = P) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await app.request(`/api/cycles${path}${sep}project=${pid}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null };
  } finally { [console.warn, console.error] = saved; }
}

const home = async (db: DatabaseSync, pid = P) => {
  const r = await call(db, pid === P ? FOUNDER : OTHER, 'GET', '/raise/modules/investor-narrative', undefined, pid);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};


const SLIDES = [
  { title: 'Kestrel Labs', subtitle: 'The month-end close, done for you.', body: '' },
  { title: 'The Problem', body: 'Finance teams close the month by hand.' },
  { title: 'Market size', bullets: ['Every mid-market finance team', 'Starts in the UK'] },
  { title: 'Traction', fields: [{ kind: 'metric_grid', value: [] }, { kind: 'paragraph', value: 'Pilots with three finance teams.' }] },
  { title: 'Competitive landscape', body: 'Spreadsheets and consultants.' },
  { title: 'The Ask', body: 'Raising a seed round to reach ten customers.' },
  { title: 'Team', body: 'Two founders who ran close at scale.' },
  { title: 'Problem (appendix)', body: 'Not this one.', appendix: true },
  { title: 'Thank you!', body: 'Open to diligence and intros this week.' },
];
const deck = (db: DatabaseSync, id: number, pid: number, version: number, slides: unknown, current: number) =>
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (?, ?, ?, ?, ?)').run(id, pid, version, JSON.stringify(slides), current);
const words = (db: DatabaseSync, pid: number, v: number) => Object.fromEntries((db.prepare(
  "SELECT field_key, value FROM spinout_deck_overrides WHERE project_id = ? AND version = ? AND field_key != '_version' ORDER BY field_key",
).all(pid, v) as any[]).map((r) => [r.field_key, r.value]));
const opts = async (db: DatabaseSync, pid: number) =>
  (await call(db, pid === P ? FOUNDER : OTHER, 'GET', '/raise/modules/investor-narrative/form-options', undefined, pid)).body;

test('deckWords: each card gives words to the deck key its title names; appendix and unmatched cards give none', () => {
  assert.equal(titleKey('The  Ask!'), 'ask');
  assert.equal(cardWords({ bullets: [' a ', '', 'b'] }), 'a\nb');
  assert.equal(cardWords({ fields: [{ kind: 'title', value: 'x' }, { kind: 'quote', value: ' q ' }] }), 'q');
  assert.equal(cardWords({ title: 'Empty' }), null);
  assert.deepEqual(Object.fromEntries(deckWords(SLIDES)), {
    'cover.thesis': 'The month-end close, done for you.',
    'problem.framing': 'Finance teams close the month by hand.',
    'market.assumptions': 'Every mid-market finance team\nStarts in the UK',
    'traction.takeaway': 'Pilots with three finance teams.',
    'competitive.whitespace': 'Spreadsheets and consultants.',
    'ask.title': 'Raising a seed round to reach ten customers.',
    'deal.closingLine': 'Open to diligence and intros this week.',
  });
  assert.equal(deckWords([{ title: 'The Ask', body: 'x'.repeat(400) }]).get('ask.title')!.length, 300, 'clipped to the key\'s limit');
  assert.deepEqual([...deckWords('not slides')], []);
});

test('form-options: Pitch deck vN\'s words for any venture with a saved deck version, none without one', async () => {
  const db = fixture();
  // Osprey is not a Spin-Out venture and has no deck: no deck option.
  const before = await opts(db, PB);
  assert.equal(before.deck, null);
  assert.deepEqual(before.start_from.map((o: any) => o.value), ['version', 'blank']);
  deck(db, 21, PB, 1, SLIDES, 0);
  deck(db, 22, PB, 3, SLIDES, 1);
  const after = await opts(db, PB);
  assert.deepEqual(after.deck, { version: 3 });
  assert.equal(after.spinout, false, 'the Spin-Out wording stays Spin-Out only');
  assert.deepEqual(after.start_from.map((o: any) => [o.value, o.label]),
    [['version', 'A saved version'], ['blank', 'Blank'], ['deck', "Pitch deck v3's words"]]);
});

test('a version started from the deck copies its words by card, reads "Pitch deck vN", and changes no card', async () => {
  const db = fixture();
  deck(db, 22, PB, 3, SLIDES, 1);
  const slidesBefore = (db.prepare('SELECT slides FROM pitch_decks WHERE id = 22').get() as any).slides;
  const r = await call(db, OTHER, 'POST', '/raise/narrative-versions', { investor_type: 'seed_fund', start_from: 'deck', deck_version: 3, one_liner: null, ask: 'Raising $1.5M.' }, PB);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const v = r.body.version;
  const w = words(db, PB, v);
  assert.equal(w['problem.framing'], 'Finance teams close the month by hand.');
  assert.equal(w['cover.thesis'], 'The month-end close, done for you.', 'an empty One-liner keeps the deck\'s words');
  assert.equal(w['ask.title'], 'Raising $1.5M.', 'words typed in the dialog replace the deck\'s');
  const meta = db.prepare('SELECT start_from, based_on_version FROM narrative_version_meta WHERE project_id = ? AND version = ?').get(PB, v) as any;
  assert.deepEqual({ ...meta }, { start_from: 'deck', based_on_version: 3 });
  assert.equal((db.prepare('SELECT slides FROM pitch_decks WHERE id = 22').get() as any).slides, slidesBefore, 'the deck does not change');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pitch_decks WHERE project_id = ?').get(PB)!.n, 1);
  assert.equal((await home(db, PB)).parts.narrative.versions[0].based_on, 'Pitch deck v3');
  // The live wording is not copied: Kestrel's version 0 belongs to project P, and Osprey has none.
  assert.equal(w['market.assumptions'], 'Every mid-market finance team\nStarts in the UK');
});

test('refusals: no such deck version, a deck_version without start_from deck, and a deck start keeps its deck version', async () => {
  const db = fixture();
  deck(db, 22, PB, 3, SLIDES, 1);
  deck(db, 31, P, 7, SLIDES, 1);
  const post = (b: unknown) => call(db, OTHER, 'POST', '/raise/narrative-versions', b, PB);
  assert.equal((await post({ investor_type: 'angel', start_from: 'deck', deck_version: 7 })).status, 404, 'another venture\'s deck');
  assert.equal((await post({ investor_type: 'angel', start_from: 'deck' })).status, 404, 'no deck version named');
  assert.equal((await post({ investor_type: 'angel', start_from: 'blank', deck_version: 3 })).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM narrative_version_meta WHERE project_id = ?').get(PB)!.n, 0, 'a refusal saves nothing');
  const ok = await post({ investor_type: 'angel', start_from: 'deck', deck_version: '3' });
  assert.equal(ok.status, 201);
  assert.equal((await post({ investor_type: 'angel', start_from: 'blank' })).status, 201);
  const patch = await call(db, OTHER, 'PATCH', `/raise/narrative-versions/${ok.body.version}`, { based_on_version: 2 }, PB);
  assert.equal(patch.status, 400, JSON.stringify(patch.body));
  assert.throws(() => db.prepare("INSERT INTO narrative_version_meta (project_id, version, start_from) VALUES (?, 99, 'deck')").run(PB), /CHECK/);
});

test('the rebuild keeps every row and column, and the pitch_decks triggers still bind narrative_version', () => {
  const db = fixture(false);
  db.prepare("INSERT INTO narrative_version_meta (id, uid, project_id, version, start_from, based_on_version, why_now, revision, claim) VALUES (5, 'u5', 1, 2, 'version', 1, 'Now.', 4, 'c')").run();
  assert.throws(() => db.prepare("INSERT INTO narrative_version_meta (project_id, version, start_from) VALUES (1, 3, 'deck')").run(), /CHECK/, 'before the rebuild deck is refused');
  db.exec(sqlOf('202611151230_6069_narrative_start_from_deck.sql'));
  assert.deepEqual({ ...(db.prepare('SELECT id, uid, project_id, version, start_from, based_on_version, why_now, revision, claim FROM narrative_version_meta').get() as any) },
    { id: 5, uid: 'u5', project_id: 1, version: 2, start_from: 'version', based_on_version: 1, why_now: 'Now.', revision: 4, claim: 'c' });
  const triggers = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as any[]).map((r) => r.name);
  assert.deepEqual(triggers, ['pitch_decks_narrative_version_bound', 'pitch_decks_narrative_version_bound_update']);
  assert.throws(() => db.prepare("INSERT INTO pitch_decks (project_id, version, slides, narrative_version) VALUES (1, 1, '[]', 9)").run(), /names no saved narrative version/);
  db.prepare("INSERT INTO pitch_decks (project_id, version, slides, narrative_version) VALUES (1, 1, '[]', 2)").run();
});

test('basedOnLabel: a deck start reads Pitch deck vN; the earlier labels stay', () => {
  assert.equal(basedOnLabel({ start_from: 'deck', based_on_version: 4 }, false), 'Pitch deck v4');
  assert.equal(basedOnLabel({ start_from: 'version', based_on_version: 1 }, false), 'v1');
  assert.equal(basedOnLabel({ start_from: 'live', based_on_version: null }, true), 'The Spin-Out deck wording');
});

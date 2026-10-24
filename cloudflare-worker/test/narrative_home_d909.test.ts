/**
 * D909 (#2693) — what the Investor narrative's Home, New version and Versions
 * read: `parts.narrative` on the module read, the versions table's Based on,
 * Read by deck and By, form-options' Spin-Out choice, and a version record's
 * Read by. Real SQLite: migrations 442, 459, 463 and 544 over schema_baseline.sql.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/narrative_home_d909.test.ts
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
import { readersOf, readBySentence } from '../src/services/narrative/readers.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');

const FOUNDER = 110, OTHER = 120;
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [OTHER]: 'founder' };
const P = 1, PB = 2;
const ref = (v: number) => ({ source_key: 'raise.narrative', record_ref: `narrative_version_meta:v${v}`, as_of: '2026-10-20', grade: 'Stated', snapshot_hash: null });

function fixture() {
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

/** v1 from the Spin-Out wording, v2 from v1 stating an MRR the metrics disagree with, v3 blank. */
async function threeVersions(db: DatabaseSync) {
  assert.equal((await call(db, FOUNDER, 'POST', '/raise/narrative-versions', { investor_type: 'seed_fund' })).status, 201);
  assert.equal((await call(db, FOUNDER, 'POST', '/raise/narrative-versions', { investor_type: 'angel', start_from: 'version', based_on_version: 1 })).status, 201);
  const put = await call(db, FOUNDER, 'PUT', '/raise/narrative/2/sections/traction', { body: 'We reached $18,400 MRR.' });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal((await call(db, FOUNDER, 'POST', '/raise/narrative-versions', { investor_type: 'series_a_fund', start_from: 'blank' })).status, 201);
}

const home = async (db: DatabaseSync, pid = P) => {
  const r = await call(db, pid === P ? FOUNDER : OTHER, 'GET', '/raise/modules/investor-narrative', undefined, pid);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};

test('readersOf: a card reads a version only through a binding naming its record, on the slide, a field or a block', () => {
  const slides = [
    { title: 'Cover', binding: ref(2) },
    { title: 'Problem', fields: [{ key: 'body', binding: ref(2) }, { key: 'b', binding: ref(4) }] },
    { title: 'Traction', blocks: [{ binding: ref(2) }] },
    { title: 'Market', binding: { source_key: 'grow.mrr', record_ref: 'project_metrics:7' } },
    { title: 'Ask', binding: { source_key: 'raise.narrative', record_ref: 'narrative_version_meta:v0' } },
    { title: 'Team', binding: { record_ref: 'narrative_version_meta:v3' } },
  ];
  const r = readersOf(slides);
  assert.deepEqual([...r.entries()], [[2, [1, 2, 3]], [4, [2]]], 'v0, a binding with no source_key and another record are no reader');
  assert.deepEqual([...readersOf(null).entries()], []);
  const deck = { deck: { id: 9, version: 6 }, byVersion: r, spinout: false };
  assert.equal(readBySentence(deck, 2), 'Pitch deck v6 · cards 1, 2, 3');
  assert.equal(readBySentence(deck, 4), 'Pitch deck v6 · card 2');
  assert.equal(readBySentence(deck, 3), 'No deck reads this version.');
  assert.equal(readBySentence({ deck: null, byVersion: r, spinout: false }, 2), 'No deck reads this version.');
});

test('parts.narrative: every version with where it started, when, by whom and who reads it; the newest version\'s check', async () => {
  const db = fixture();
  await threeVersions(db);
  // The current deck (v6) binds v2 on cards 1 and 3; an older deck's binding of v1 is no reader.
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (?, ?, ?, ?, ?)').run(4, P, 5, JSON.stringify([{ title: 'A', binding: ref(1) }]), 0);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (?, ?, ?, ?, ?)')
    .run(5, P, 6, JSON.stringify([{ title: 'A', binding: ref(2) }, { title: 'B' }, { title: 'C', fields: [{ key: 'x', binding: ref(2) }] }]), 1);
  // A restored deck: a higher version that is not current still reads nothing.
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (?, ?, ?, ?, ?)').run(6, P, 7, JSON.stringify([{ title: 'A', binding: ref(3) }]), 0);
  const part = (await home(db)).parts.narrative;
  assert.equal(part.state, 'ok');
  assert.deepEqual(part.versions.map((v: any) => [v.version, v.audience, v.based_on, v.by, v.read_by]), [
    [3, 'Series A fund', 'Blank', 'Fay Founder', null],
    [2, 'Angel', 'v1', 'Fay Founder', { deck_version: 6, cards: [1, 3] }],
    [1, 'Seed fund', 'The Spin-Out deck wording', 'Fay Founder', null],
  ]);
  assert.ok(part.versions.every((v: any) => /^\d{4}-\d{2}-\d{2}$/.test(v.saved)), 'a day each');
  assert.deepEqual(part.deck, { version: 6, reads_narrative: true });
  assert.equal(part.spinout, true);
  // The newest is v3, blank: nothing compared, no mismatch. Never the v2 mismatch.
  assert.deepEqual(part.newest, { version: 3, compared: 0, mismatches: [] });
});

test('the newest version\'s mismatches name the figure and both sources; no version reads null', async () => {
  const db = fixture();
  assert.equal((await home(db)).parts.narrative.newest, null);
  assert.deepEqual((await home(db)).parts.narrative.versions, []);
  assert.equal((await home(db)).parts.narrative.deck, null, 'no deck');
  await call(db, FOUNDER, 'POST', '/raise/narrative-versions', { investor_type: 'seed_fund', start_from: 'blank' });
  await call(db, FOUNDER, 'PUT', '/raise/narrative/1/sections/traction', { body: 'We reached $18,400 MRR.' });
  const n = (await home(db)).parts.narrative.newest;
  assert.equal(n.version, 1);
  assert.equal(n.compared, 1);
  assert.equal(n.mismatches.length, 1);
  assert.equal(n.mismatches[0].figure, 'MRR');
  assert.match(n.mismatches[0].sentence, /\$18,400 in Narrative · traction\.takeaway, \$16,950 in Metrics · project_metrics\.mrr on 2026-09-30/);
});

test('the versions table: Audience, Based on, Read by deck and By; a version saved before 463 reads Not recorded (null)', async () => {
  const db = fixture();
  await threeVersions(db);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (?, ?, ?, ?, ?)').run(5, P, 6, JSON.stringify([{ title: 'A', binding: ref(2) }]), 1);
  // A version from before 463: a marker row and no meta.
  db.prepare("INSERT INTO spinout_deck_overrides (project_id, field_key, value, version, investor_type) VALUES (?, '_version', 'grant', 4, 'grant')").run(P);
  const recs = (await home(db)).records;
  assert.deepEqual(recs.cols.map((c: any) => c.label), ['Version', 'Audience', 'Based on', 'Mismatches', 'Read by deck', 'Saved', 'By']);
  const by = Object.fromEntries(recs.rows.map((r: any) => [r.id, r.cells]));
  assert.deepEqual([by[2].based_on, by[2].deck, by[2].by], ['v1', 'Pitch deck v6 · card 1', 'Fay Founder']);
  assert.deepEqual([by[1].based_on, by[1].deck], ['The Spin-Out deck wording', 'No deck reads this version.']);
  assert.equal(by[3].based_on, 'Blank');
  assert.deepEqual([by[4].based_on, by[4].by], [null, null], 'Not recorded, never a guess');
  assert.equal(recs.filters[0].label, 'Audience');
});

test('Spin-Out: only a Spin-Out venture is offered, and reads, the Spin-Out deck wording', async () => {
  const db = fixture();
  const opts = async (pid: number) => (await call(db, pid === P ? FOUNDER : OTHER, 'GET', '/raise/modules/investor-narrative/form-options', undefined, pid)).body;
  const kestrel = await opts(P);
  assert.equal(kestrel.spinout, true);
  assert.deepEqual(kestrel.start_from.map((o: any) => [o.value, o.label]), [['live', 'The Spin-Out deck wording'], ['version', 'A saved version'], ['blank', 'Blank']]);
  const osprey = await opts(PB);
  assert.equal(osprey.spinout, false);
  assert.deepEqual(osprey.start_from.map((o: any) => o.value), ['version', 'blank'], 'no live wording for a venture that is not a Spin-Out');
  // Osprey's earlier version, saved from the live wording before D909, reads today's name for it.
  assert.equal((await call(db, OTHER, 'POST', '/raise/narrative-versions', { investor_type: 'angel' }, PB)).status, 201);
  assert.equal((await home(db, PB)).parts.narrative.versions[0].based_on, 'The live deck');
  // A current Spin-Out deck makes it a Spin-Out venture.
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (?, ?, ?, ?, ?)')
    .run(8, PB, 1, JSON.stringify([{ title: 'Cover', method_id: 'axal_spinout_demoday' }]), 1);
  assert.equal((await opts(PB)).spinout, true);
  assert.equal((await home(db, PB)).parts.narrative.versions[0].based_on, 'The Spin-Out deck wording');
});

test('a version\'s record says who reads it, from the same bindings', async () => {
  const db = fixture();
  await threeVersions(db);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (?, ?, ?, ?, ?)').run(5, P, 6, JSON.stringify([{ title: 'A' }, { title: 'B', binding: ref(2) }]), 1);
  const rec = async (v: number) => (await call(db, FOUNDER, 'GET', `/raise/modules/investor-narrative/records/${v}`)).body;
  const two = await rec(2);
  assert.match(two.sub, /· Pitch deck v6 · card 2$/);
  assert.deepEqual(two.facts.find((f: any) => f.label === 'Read by'), { label: 'Read by', value: 'Pitch deck v6 · card 2' });
  const one = await rec(1);
  assert.match(one.sub, /No deck reads this version\.$/);
  assert.equal(one.facts.find((f: any) => f.label === 'Based on').value, 'The Spin-Out deck wording');
});

test('the part fails on its own: an unreadable store answers state unreadable and the module still reads', async () => {
  const db = fixture();
  await threeVersions(db);
  db.exec('DROP TABLE narrative_version_meta');
  const body = await home(db);
  assert.deepEqual(body.parts.narrative, { state: 'unreadable', reason: 'The narrative versions could not be read' });
  assert.ok(body.card, 'the card is still drawn');
});

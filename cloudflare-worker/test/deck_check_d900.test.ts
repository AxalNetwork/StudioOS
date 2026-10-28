/**
 * D900 (#2679, part 6 of #2434) — the deck's check against the records,
 * through the real mounted routes on SQLite (the baseline and every later
 * migration, 645 included).
 *
 *   1. A typed "42 paying customers" against Stripe's 38 is a Mismatch with
 *      both figures and both sources, neither presumed right.
 *   2. Who: the venture's founder runs the check; an Admin reads the states
 *      with no figure; a cofounder, another founder and nobody reach no run.
 *   3. When: a version never checked is "not checked", never zeros; a
 *      version with no figure is checked with none.
 *   4. "Use the record's figure" saves a new version with Stripe's figure,
 *      only for the figure the dialog showed.
 *   5. "Keep mine, with a note": only a Mismatch takes one, it stays a
 *      Mismatch, and it no longer applies once another figure is stated.
 *   6. One `raise.pitch-deck` cycle row per write, never a figure.
 *   7. The pure parts: the swap and Stale.
 *
 * Every name and figure is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_check_d900.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckCheck from '../src/routes/deck_check.ts';
import decks from '../src/routes/decks.ts';
import { deckCheckView, deckCheckSummaries, staleClaims, swapFigure, swapInSlide } from '../src/services/deckCheck.ts';
import { checkClaims } from '../src/services/raiseClaims.ts';
import { ClaimNoteError, noteText, setClaimNote } from '../src/services/raiseClaimNotes.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d900-deck-check-0123456789-abcdef';

const OWNER = 1, COFOUNDER = 2, ADMIN = 4, OTHER = 5;
const PID = 7, OTHER_PID = 8;

const para = (value: string) => ({ key: 'body', label: 'Body', kind: 'paragraph', value });
const SLIDES_V1 = [{ title: 'Synthetic problem', fields: [para('Synthetic teams reconcile by hand.')] }];
const SLIDES_V2 = [
  { title: 'Synthetic problem', fields: [para('Synthetic teams reconcile by hand.')] },
  { title: 'Synthetic traction', fields: [para('We serve 42 paying customers and raise $2m.')] },
];

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Synthetic Founder', 'f@example.test'), (11, 'Synthetic Other', 'o@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES
      (${OWNER}, 'owner@example.test', 'Synthetic Owner', 'founder', 10),
      (${COFOUNDER}, 'co@example.test', 'Synthetic Cofounder', 'founder', NULL),
      (${ADMIN}, 'admin@example.test', 'Synthetic Admin', 'admin', NULL),
      (${OTHER}, 'other@example.test', 'Synthetic Other Founder', 'founder', 11);
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Synthetic venture', 10), (${OTHER_PID}, 'Synthetic other venture', 11);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${PID}, ${OWNER}, 'owner', 'accepted'), (${PID}, ${COFOUNDER}, 'cofounder', 'accepted');`);
  const insert = db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insert.run(20, PID, 1, JSON.stringify(SLIDES_V1), 'Synthetic deck', 0, OWNER);
  insert.run(21, PID, 2, JSON.stringify(SLIDES_V2), 'Synthetic deck', 1, OWNER);
  insert.run(22, PID, 3, '[]', 'Synthetic empty', 0, OWNER);
  db.prepare('UPDATE pitch_decks SET theme_json = ?, audience = ? WHERE id = 21').run(JSON.stringify({ kind: 'neutral_dark' }), 'seed_fund');
  insert.run(30, OTHER_PID, 1, JSON.stringify(SLIDES_V2), 'Synthetic other deck', 1, OTHER);
  pin(db, { id: 1, ref: '5:paying_accounts', label: 'connector', provider: 'stripe', value: 38, unit: 'count', on: '2026-10-20' });
  return db;
}

/** A pinned item as D1263's Accept leaves it; the fields the check does not read are filled. */
function pin(db: any, v: { id: number; ref: string; label: string; provider?: string | null; value: number; unit: string; on: string; project?: number }) {
  const row: Record<string, unknown> = {
    id: v.id, uid: `item${v.id}`, project_id: v.project ?? PID, area: 'Investor narrative and Pitch deck', kind: 'kpi-snapshot', source_table: 'project_metrics',
    source_ref: v.ref, source_label: v.label, provider: v.provider ?? null, strength: 'measured', observed_on: v.on, summary: 'Synthetic.', value_num: v.value,
    value_unit: v.unit, snapshot_hash: 'h'.repeat(64), state: 'pinned', visibility: 'after_nda', mutation_uid: `m${v.id}`,
  };
  for (const c of db.prepare('PRAGMA table_info(raise_evidence_items)').all() as any[]) {
    if (c.notnull && !c.pk && c.dflt_value == null && !(c.name in row)) row[c.name] = /INT|REAL|NUM/.test(c.type) ? 1 : 'synthetic';
  }
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO raise_evidence_items (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k] as any));
}

async function call(db: any, who: number | null, method: string, path: string, body?: unknown) {
  const app = new Hono<any>().route('/api/decks', deckCheck).route('/api/decks', decks);
  app.onError((err: any, c: any) => c.json({ error: err?.message === 'Unauthorized' ? 'unauthorized' : 'error', detail: String(err?.message) }, err?.message === 'Unauthorized' ? 401 : 500));
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (who) h.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, { method, headers: h, ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}) }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const claims = (db: any, version = 'v2') => db.prepare("SELECT * FROM raise_claims WHERE surface = 'deck' AND surface_version = ? ORDER BY field_key").all(version) as any[];
/** A check stamps the clock, and claim ids are random hex. Either can contain 42 or 38 without being a figure. */
const withoutClockOrIds = (v: unknown) => JSON.stringify(v).replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/g, '').replace(/[0-9a-f]{16,}/gi, '');
const logs = (db: any) => db.prepare("SELECT action, details FROM activity_logs WHERE entity_type LIKE '%pitch%' OR action LIKE 'deck_%' OR action LIKE 'claim_%' ORDER BY id").all() as any[];

test('D900: the admin figure scan ignores a clock minute and a random id', () => {
  const stamped = { checked_at: '2026-10-27 22:42:35', claims: [{ uid: 'e2e396ad24204627b9efe7fa4e1cad38', state: 'mismatch' }] };
  assert.doesNotMatch(withoutClockOrIds(stamped), /\b42\b|\b38\b/);
  assert.match(withoutClockOrIds({ ...stamped, stated_shown: '42' }), /\b42\b/);
  assert.match(withoutClockOrIds({ ...stamped, record_shown: '38' }), /\b38\b/);
});

// ------------------------------------------------------------------ the check

test('D900: a typed 42 paying customers against Stripe\'s 38 is a Mismatch with both figures and both sources', async () => {
  const db = fixture();
  // The version asked about, never the current one in its place.
  const older = await call(db, OWNER, 'POST', '/api/decks/20/check');
  assert.equal(older.body.version, 'v1');
  assert.equal(older.body.figures, 0);
  assert.equal(claims(db).length, 0, 'checking v1 checks v1 alone');
  const res = await call(db, OWNER, 'POST', '/api/decks/21/check');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.version, 'v2');
  const row = res.body.claims.find((c: any) => c.figure === 'paying_customers');
  assert.equal(row.state, 'mismatch');
  assert.equal(row.slide, 2);
  assert.equal(row.stated_shown, '42');
  assert.equal(row.record.shown, '38');
  assert.equal(row.record.source_label, 'connector');
  assert.equal(row.record.provider, 'stripe');
  assert.equal(row.record.observed_on, '2026-10-20');
  assert.equal(row.note, null, 'neither figure is presumed right: nothing is kept until the founder says so');
  const raise = res.body.claims.find((c: any) => c.figure === 'raise');
  assert.equal(raise.state, 'not_backed', 'no rule records the raise');
  assert.deepEqual(res.body.counts, { backed: 0, founders_figure: 0, mismatch: 1, not_backed: 1, stale: 0 });
  assert.equal(res.body.figures, 2);
  assert.deepEqual(claims(db).map((c) => [c.field_key, c.state]), [['slide:2#paying_customers', 'mismatch'], ['slide:2#raise', 'not_backed']]);
  assert.equal(claims(db, 'v1').length, 0, 'another version is not checked');
  const check = db.prepare('SELECT deck_id, surface_version, figures, checked_by FROM deck_checks').all() as any[];
  assert.deepEqual(check.map((r) => ({ ...r })), [{ deck_id: 20, surface_version: 'v1', figures: 0, checked_by: OWNER }, { deck_id: 21, surface_version: 'v2', figures: 2, checked_by: OWNER }]);
});

test('D900: who runs and who reads — the founder runs; an Admin reads states with no figure; others reach no run', async () => {
  const db = fixture();
  for (const who of [ADMIN, COFOUNDER]) {
    const r = await call(db, who, 'POST', '/api/decks/21/check');
    assert.equal(r.status, 403, `${who}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, 'founder_only');
  }
  assert.equal((await call(db, OTHER, 'POST', '/api/decks/21/check')).status, 403);
  assert.equal((await call(db, null, 'POST', '/api/decks/21/check')).status, 401);
  assert.equal((await call(db, OWNER, 'POST', '/api/decks/999/check')).status, 404);
  assert.equal(claims(db).length, 0, 'a refused run writes nothing');
  await call(db, OWNER, 'POST', '/api/decks/21/check');
  const admin = await call(db, ADMIN, 'GET', '/api/decks/21/check');
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
  assert.equal(admin.body.can_check, false);
  const row = admin.body.claims.find((c: any) => c.figure === 'paying_customers');
  assert.equal(row.state, 'mismatch');
  for (const k of ['stated_value', 'stated_shown', 'record', 'note']) assert.equal(k in row, false, `an Admin reads no ${k}`);
  assert.doesNotMatch(withoutClockOrIds(admin.body), /\b42\b|\b38\b/);
  const owner = await call(db, OWNER, 'GET', '/api/decks/21/check');
  assert.equal(owner.body.can_check, true);
  assert.equal(owner.body.claims.find((c: any) => c.figure === 'paying_customers').stated_shown, '42');
});

test('D900: a version never checked is not checked, never zeros; a version with no figure is checked with none', async () => {
  const db = fixture();
  await call(db, OWNER, 'POST', '/api/decks/21/check');
  await call(db, OWNER, 'POST', '/api/decks/22/check');
  const r = await call(db, OWNER, 'GET', `/api/decks/checks?project_id=${PID}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.versions.map((v: any) => [v.deck_id, v]));
  assert.deepEqual([by[20].checked, by[20].counts, by[20].checked_at], [false, null, null]);
  assert.equal(by[21].checked, true);
  assert.deepEqual(by[21].counts, { backed: 0, founders_figure: 0, mismatch: 1, not_backed: 1 });
  assert.equal(by[22].checked, true);
  assert.deepEqual(by[22].counts, { backed: 0, founders_figure: 0, mismatch: 0, not_backed: 0 });
  assert.equal(r.body.versions.some((v: any) => v.deck_id === 30), false, 'another venture\'s deck is not listed');
  assert.equal((await call(db, OTHER, 'GET', `/api/decks/checks?project_id=${PID}`)).status, 403);
  // The Evidence read checks the current deck too (D1264): its claims count as a check without a deck_checks row.
  const fresh = fixture();
  await checkClaims({ DB: d1Over(fresh) } as any, PID);
  const viaEvidence = (await deckCheckSummaries({ DB: d1Over(fresh) } as any, PID)).find((v) => v.deck_id === 21);
  assert.equal(viaEvidence?.checked, true);
  assert.equal(viaEvidence?.counts?.mismatch, 1);
  const empty = await call(db, OWNER, 'GET', '/api/decks/20/check');
  assert.equal(empty.body.checked, false);
  assert.equal(empty.body.figures, 0);
});

test('D900: Use the record\'s figure saves a new version with Stripe\'s figure, only for the figure the dialog showed', async () => {
  const db = fixture();
  const run = await call(db, OWNER, 'POST', '/api/decks/21/check');
  const uid = run.body.claims.find((c: any) => c.figure === 'paying_customers').uid;
  const before = (db.prepare('SELECT COUNT(*) AS n FROM pitch_decks WHERE project_id = ?').get(PID) as any).n;
  const stale = await call(db, OWNER, 'POST', `/api/decks/21/claims/${uid}/use-record`, { record_value: 37 });
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.error, 'record_changed');
  assert.equal((await call(db, OWNER, 'POST', `/api/decks/21/claims/${uid}/use-record`, {})).status, 400);
  assert.equal((await call(db, ADMIN, 'POST', `/api/decks/21/claims/${uid}/use-record`, { record_value: 38 })).status, 403);
  const notMismatch = run.body.claims.find((c: any) => c.figure === 'raise').uid;
  assert.equal((await call(db, OWNER, 'POST', `/api/decks/21/claims/${notMismatch}/use-record`, { record_value: 38 })).body.error, 'claim_not_mismatch');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM pitch_decks WHERE project_id = ?').get(PID) as any).n, before, 'a refused swap writes no version');

  const ok = await call(db, OWNER, 'POST', `/api/decks/21/claims/${uid}/use-record`, { record_value: 38 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.deck.version, 4);
  const saved = db.prepare('SELECT slides, title FROM pitch_decks WHERE id = ?').get(ok.body.deck.id) as any;
  const text = JSON.stringify(JSON.parse(saved.slides));
  assert.match(text, /We serve 38 paying customers and raise \$2m\./);
  assert.doesNotMatch(text, /42 paying/);
  assert.equal(saved.title, 'Synthetic deck');
  const kept = db.prepare('SELECT theme_json, audience FROM pitch_decks WHERE id = ?').get(ok.body.deck.id) as any;
  assert.equal(JSON.parse(kept.theme_json).kind, 'neutral_dark', 'the version keeps its theme');
  assert.equal(kept.audience, 'seed_fund', 'and its audience');
  const recheck = await call(db, OWNER, 'POST', `/api/decks/${ok.body.deck.id}/check`);
  assert.equal(recheck.body.claims.find((c: any) => c.figure === 'paying_customers').state, 'backed');
  assert.equal(claims(db, 'v2').find((c) => c.claim_kind === 'paying_customers').state, 'mismatch', 'the older version keeps its state');
  // A figure that agrees with its record is not swapped, though it has one.
  const backed = recheck.body.claims.find((c: any) => c.figure === 'paying_customers');
  assert.ok(backed.record, 'a Backed figure carries its record');
  const again = await call(db, OWNER, 'POST', `/api/decks/${ok.body.deck.id}/claims/${backed.uid}/use-record`, { record_value: 38 });
  assert.equal(again.body.error, 'claim_not_mismatch');
});

test('D900: Keep mine, with a note — only a Mismatch takes one, it stays a Mismatch, and it lapses once another figure is stated', async () => {
  const db = fixture();
  const run = await call(db, OWNER, 'POST', '/api/decks/21/check');
  const mismatch = run.body.claims.find((c: any) => c.figure === 'paying_customers').uid;
  const notBacked = run.body.claims.find((c: any) => c.figure === 'raise').uid;
  const env: any = { DB: d1Over(db) };
  await assert.rejects(setClaimNote(env, PID, OWNER, notBacked, 'Synthetic reason.'), (e: any) => e instanceof ClaimNoteError && e.code === 'not_mismatch');
  await assert.rejects(setClaimNote(env, OTHER_PID, OTHER, mismatch, 'Synthetic reason.'), (e: any) => e instanceof ClaimNoteError && e.code === 'not_found');
  assert.throws(() => noteText('   '), (e: any) => e.code === 'note_required');
  assert.throws(() => noteText('x'.repeat(501)), (e: any) => e.code === 'note_too_long');
  const kept = await setClaimNote(env, PID, OWNER, mismatch, noteText('  Stripe counts a trial as unpaid; 4 converted after the sync.  '));
  assert.equal(kept.note.text, 'Stripe counts a trial as unpaid; 4 converted after the sync.');
  const again = await call(db, OWNER, 'POST', '/api/decks/21/check');
  const row = again.body.claims.find((c: any) => c.figure === 'paying_customers');
  assert.equal(row.state, 'mismatch', 'a kept figure is still a Mismatch');
  assert.equal(row.note.text, 'Stripe counts a trial as unpaid; 4 converted after the sync.', 'the check never clears the note');
  // The founder states another figure: the note was not about it.
  db.prepare("UPDATE raise_claims SET stated_value = '40' WHERE uid = ?").run(mismatch);
  const lapsed = await call(db, OWNER, 'GET', '/api/decks/21/check');
  const l = lapsed.body.claims.find((c: any) => c.figure === 'paying_customers');
  assert.equal(l.note, null);
  assert.equal(l.note_outdated, true);
  await setClaimNote(env, PID, OWNER, mismatch, null);
  assert.equal((db.prepare('SELECT note, note_value, noted_at, noted_by FROM raise_claims WHERE uid = ?').get(mismatch) as any).note, null);
});

test('D900: one raise.pitch-deck cycle row per write, never a figure or the note', async () => {
  const db = fixture();
  const run = await call(db, OWNER, 'POST', '/api/decks/21/check');
  const uid = run.body.claims.find((c: any) => c.figure === 'paying_customers').uid;
  await setClaimNote({ DB: d1Over(db) } as any, PID, OWNER, uid, 'Synthetic secret reason.');
  await call(db, OWNER, 'POST', `/api/decks/21/claims/${uid}/use-record`, { record_value: 38 });
  const rows = db.prepare("SELECT action, details, entity_type FROM activity_logs WHERE action IN ('deck_checked', 'claim_kept_with_note', 'deck_figure_replaced') ORDER BY id").all() as any[];
  assert.deepEqual(rows.map((r) => r.action), ['deck_checked', 'claim_kept_with_note', 'deck_figure_replaced']);
  for (const r of rows) {
    assert.match(String(r.entity_type), /pitch/);
    assert.doesNotMatch(String(r.details), /\b42\b|\b38\b|secret/);
  }
  assert.ok(logs(db).length >= 3);
});

// ------------------------------------------------------------------ the pure parts

test('swapFigure: only the number the check read moves, written as the sentence wrote it', () => {
  assert.equal(swapFigure('We serve 42 paying customers.', 'paying_customers', 42, 38), 'We serve 38 paying customers.');
  assert.equal(swapFigure('$18,400 MRR and 42 paying customers', 'mrr', 18400, 18950), '$18,950 MRR and 42 paying customers');
  assert.equal(swapFigure('MRR of $1.2m', 'mrr', 1200000, 1250000), 'MRR of $1,250,000');
  assert.equal(swapFigure('14 months of runway', 'runway', 14, 11.5), '11.5 months of runway');
  assert.equal(swapFigure('3% monthly churn', 'churn', 3, 4.25), '4.25% monthly churn');
  assert.equal(swapFigure('Founded 42 months ago with 42 paying customers', 'paying_customers', 42, 38), 'Founded 42 months ago with 38 paying customers', 'the number the pattern read, not the first 42');
  assert.equal(swapFigure('We serve 42 paying customers.', 'paying_customers', 41, 38), null, 'a stated value it was not asked about');
  assert.equal(swapFigure('No figure here.', 'mrr', 1, 2), null);
  const slide = { title: 'T', fields: [para('Synthetic.'), para('We serve 42 paying customers.')], notes: 'keep' };
  assert.deepEqual(swapInSlide(slide, 'paying_customers', 42, 38), { title: 'T', fields: [para('Synthetic.'), para('We serve 38 paying customers.')], notes: 'keep' });
  assert.equal(swapInSlide(slide, 'mrr', 1, 2), null);
});

test('staleClaims: a stale binding marks the figures its field states, and only those', () => {
  const slides = [
    { title: 'A', fields: [{ key: 'kpi', value: '42 paying customers', binding: { source_key: 'grow.paying' } }, { key: 'other', value: 'MRR of $10,000' }] },
    { title: 'B', blocks: [{ text: '$5,000 MRR', binding: { source_key: 'grow.mrr' } }] },
  ];
  const row = (slide: number, field: string | null, state: any) => ({ slide, field, source_key: 'x.y', bound: { as_of: null, grade: null, snapshot_hash: null }, state, current: null });
  assert.deepEqual([...staleClaims(slides, [row(0, 'kpi', 'stale'), row(1, 'block:0', 'stale')])].sort(), ['slide:1#paying_customers', 'slide:2#mrr']);
  assert.deepEqual([...staleClaims(slides, [row(0, 'kpi', 'fresh'), row(0, 'kpi', 'unknown')])], [], 'fresh and unknown are not stale');
  assert.deepEqual([...staleClaims(slides, [row(0, null, 'stale')])].sort(), ['slide:1#mrr', 'slide:1#paying_customers'], 'a card binding stands behind the whole card');
  const two = [{ title: 'C', blocks: [{ text: '42 paying customers' }, { text: '$5,000 MRR', binding: { source_key: 'grow.mrr' } }] }];
  assert.deepEqual([...staleClaims(two, [row(0, 'block:1', 'stale')])], ['slide:1#mrr'], 'a block binding stands behind its own block only');
});

test('deckCheckView: Stale is drawn over the stored state, and counted as Stale', () => {
  const stored = [
    { uid: 'a', field_key: 'slide:1#mrr', claim_kind: 'mrr', stated_value: '5000', state: 'backed', checked_at: null, note: null, note_value: null, noted_at: null },
    { uid: 'b', field_key: 'slide:2#paying_customers', claim_kind: 'paying_customers', stated_value: '42', state: 'mismatch', checked_at: null, note: null, note_value: null, noted_at: null },
  ];
  const view = deckCheckView(stored, { founder: true, stale: new Set(['slide:1#mrr']) });
  assert.deepEqual(view.claims.map((c: any) => [c.uid, c.state, c.display_state, c.stale]), [['a', 'backed', 'stale', true], ['b', 'mismatch', 'mismatch', false]]);
  assert.deepEqual(view.counts, { backed: 0, founders_figure: 0, mismatch: 1, not_backed: 0, stale: 1 });
});

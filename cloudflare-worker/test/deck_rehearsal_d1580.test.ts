/**
 * D1580 F1 (#3827) — rehearse a deck version and its report.
 *
 *   1. The report is counted in code: exact filler counts, the even share of
 *      the pitch per card ("0:42 of 0:30"), card marks, notes covered.
 *   2. A figure said that disagrees with the deck's LINKED figure is flagged
 *      ("$2M ARR" against a bound $1.4M); one that agrees, a typed one and a
 *      "Not recorded" one are not.
 *   3. The route: one `transcribe` run on the rail option
 *      `transcribe:rehearsal`, the report stored, the audio held until its hour
 *      is up unless kept; Keep off deletes it now; the sweep deletes it later.
 *      The list matches its contract; another member never reads it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_rehearsal_d1580.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckRehearsals, { REHEARSE_OPTION, REHEARSE_PAGE } from '../src/routes/deck_rehearsals.ts';
import { purgeRehearsalAudio } from '../src/services/decks/rehearsalAudio.ts';
import {
  budgetLine, cardBudgetsMs, figureFindings, fillersIn, itemCovered, marksOf, noteItems, rehearsalReport,
} from '../src/services/decks/rehearsal.ts';
import { CONTRACTS } from '../src/contracts/index.ts';
import { contractErrors } from '../src/contracts/validate.ts';
import { FOUNDER_OPTIONS } from '../../frontend/src/lib/railOptions/founder.js';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d1580-rehearse-0123456789';
const FOUNDER = 1; const OTHER = 2; const PID = 7; const DECK = 41;

const ARR_CARD = { title: 'Traction', blocks: [{ kind: 'metric', label: 'ARR', value: '$1.4M', binding: { source_key: 'grow.arr', grade: 'Measured' } }] };
const SLIDES = [{ title: 'Kestrel', notes: '- Introduce the team\n- Mention the pilot customers' }, ARR_CARD];

// ── 1. Counted in code ───────────────────────────────────────────────────

test('1. filler words are counted exactly: whole words, any case, phrases once', () => {
  const f = fillersIn('Um, so, you know, I mean uh basically UM. Umbrella erm — like, literally.');
  assert.equal(f.total, 8);
  assert.deepEqual(f.by, { um: 2, 'you know': 1, 'i mean': 1, uh: 1, basically: 1, erm: 1, literally: 1 } as any, JSON.stringify(f.by));
  assert.equal(fillersIn('Umbrella, summary, album, Uhura.').total, 0, 'a filler inside a word is not one');
  assert.equal(fillersIn('').total, 0);
});

test('1. the pitch is shared evenly across the cards; a card over its share is over', () => {
  assert.deepEqual(cardBudgetsMs(120, 4), [30_000, 30_000, 30_000, 30_000]);
  assert.deepEqual(cardBudgetsMs(180, 7), [26_000, 26_000, 26_000, 26_000, 26_000, 25_000, 25_000]);
  assert.deepEqual(cardBudgetsMs(300, 0), []);
  assert.equal(budgetLine(42_000, 30_000), '0:42 of 0:30');
  const r = rehearsalReport({ pitchSeconds: 120, durationMs: 72_000, marks: [{ card: 1, at_ms: 0 }, { card: 2, at_ms: 42_000 }], segments: [], slides: [{}, {}, {}, {}] });
  assert.equal(r.cards[0].time_line, '0:42 of 0:30');
  assert.equal(r.cards[0].over, true);
  assert.equal(r.cards[1].over, false);
  assert.equal(r.cards[1].wpm, 0, 'thirty silent seconds are 0 words a minute');
  assert.equal(r.cards[2].wpm, null, 'a card never shown has no words a minute, not 0');
});

test('1. card marks: a missing first mark starts card 1; out-of-range cards or times refuse', () => {
  assert.deepEqual(marksOf([{ card: 2, at_ms: 5000 }], 3, 10_000), [{ card: 1, at_ms: 0 }, { card: 2, at_ms: 5000 }]);
  assert.equal(marksOf([{ card: 4, at_ms: 0 }], 3, 10_000), null);
  assert.equal(marksOf([{ card: 1, at_ms: 11_000 }], 3, 10_000), null);
  assert.equal(marksOf('nope', 3, 10_000), null);
});

test('1. notes are a checklist, each item covered when most of its words were said', () => {
  assert.deepEqual(noteItems('- Introduce the team\n- Mention the pilot customers'), ['Introduce the team', 'Mention the pilot customers']);
  assert.deepEqual(noteItems('Open with the problem. Then show the pilot.'), ['Open with the problem.', 'Then show the pilot.']);
  assert.equal(itemCovered('Mention the pilot customers', 'our pilot customers love it'), true);
  assert.equal(itemCovered('Introduce the team', 'let me introduce the team.'), true);
  assert.equal(itemCovered('Introduce the team', 'we sell freight software'), false);
});

// ── 2. Figures said against the linked record ────────────────────────────

test('2. "$2M ARR" said against a bound $1.4M is flagged, with the record\'s grade', () => {
  // Mutation checked: compare with typed text instead of bound blocks → nothing is flagged.
  const f = figureFindings([{ card: 2, text: "We're at $2M ARR, growing fast." }], SLIDES);
  assert.equal(f.length, 1);
  assert.equal(f[0].message, 'You said ‘We\'re at $2M ARR’. Your record says $1.4M.');
  assert.equal(f[0].said_shown, '$2M');
  assert.equal(f[0].record_shown, '$1.4M');
  assert.equal(f[0].grade, 'Measured');
  assert.equal(f[0].source_key, 'grow.arr');
});

test('2. a figure that agrees, an unlinked deck and a Not recorded binding are not flagged', () => {
  assert.deepEqual(figureFindings([{ card: 2, text: 'We are at $1.4M ARR.' }], SLIDES), []);
  const typed = [{}, { blocks: [{ kind: 'metric', label: 'ARR', value: '$1.4M' }] }];
  assert.deepEqual(figureFindings([{ card: 2, text: 'We are at $2M ARR.' }], typed), []);
  const unrecorded = [{}, { blocks: [{ kind: 'metric', value: '$1.4M', binding: { source_key: 'grow.arr', grade: 'Not recorded' } }] }];
  assert.deepEqual(figureFindings([{ card: 2, text: 'We are at $2M ARR.' }], unrecorded), []);
  assert.deepEqual(figureFindings([{ card: 2, text: 'By 2027 we project $2M ARR.' }], SLIDES), [], 'a forward-looking line states no current figure');
});

// ── 3. The route ──────────────────────────────────────────────────────────

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test'), (20, 'Founder B', 'fb@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES (${FOUNDER}, 'founder@example.test', 'Fay Founder', 'founder', 10), (${OTHER}, 'other@example.test', 'Oz Other', 'founder', 20);
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Kestrel Labs', 10);
    INSERT INTO ai_topup_accounts (user_id, balance_microusd) VALUES (${FOUNDER}, 5000000), (${OTHER}, 5000000);`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, 1, ?, ?, 1)').run(DECK, PID, 'Seed deck', JSON.stringify(SLIDES));
  return db;
}

function bucket() {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    async put(k: string, v: Uint8Array) { store.set(k, v); },
    async get(k: string) { const v = store.get(k); return v ? { arrayBuffer: async () => v.buffer.slice(0) } : null; },
    async delete(k: string) { store.delete(k); },
  };
}

const SEGMENTS = [
  { start: 0, end: 6, text: 'Um, let me introduce the team.' },
  { start: 10, end: 16, text: 'Our pilot customers love it.' },
  { start: 43, end: 48, text: "We're at $2M ARR." },
];

async function call(db: any, FILES: any, method: string, path: string, body?: any, user = FOUNDER) {
  const AI = withGuard({ run: async () => ({ text: SEGMENTS.map((s) => s.text).join(' '), transcription_info: { language: 'en' }, segments: SEGMENTS }) });
  const app = new Hono<any>().route('/api/decks', deckRehearsals);
  const token = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let payload: any = body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await app.fetch(new Request(`http://t/api/decks${path}`, { method, headers, body: payload }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), AI, FILES } as any, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

function recording(over: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append('audio', new Blob([new Uint8Array(64).fill(7)], { type: 'audio/webm' }), 'rehearsal.webm');
  fd.append('pitch_seconds', over.pitch_seconds ?? '120');
  fd.append('duration_ms', over.duration_ms ?? '90000');
  fd.append('marks', over.marks ?? JSON.stringify([{ card: 1, at_ms: 0 }, { card: 2, at_ms: 42_000 }]));
  return fd;
}

test('3. the rail option is registered on the pitch deck page as a transcription', () => {
  const rows = FOUNDER_OPTIONS.filter((o: any) => o.key === REHEARSE_OPTION);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].page, REHEARSE_PAGE);
  assert.equal(rows[0].handler, 'transcribe');
});

test('3. a rehearsal is quoted, run once on transcribe:rehearsal, reported, and its audio held', async () => {
  const db = fixture();
  const FILES = bucket();
  const q = await call(db, FILES, 'POST', `/${DECK}/rehearsals/quote`, { pitch_seconds: 180 });
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.minutes, 6);
  assert.ok(q.body.hold_microusd >= 0);
  assert.deepEqual(q.body.balance, { ok: true });

  const r = await call(db, FILES, 'POST', `/${DECK}/rehearsals`, recording());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const rh = r.body.rehearsal;
  assert.equal(rh.report.cards[0].time_line, '0:42 of 1:00');
  assert.equal(rh.report.cards[0].fillers, 1);
  assert.equal(rh.report.cards[0].notes_covered, 2);
  assert.equal(rh.report.figures.length, 1);
  assert.equal(rh.report.figures[0].message, 'You said ‘We\'re at $2M ARR’. Your record says $1.4M.');
  assert.equal(rh.report.questions, null, 'likely questions are a later part: the slot is drawn, never invented');
  assert.equal(rh.audio, 'held');
  assert.ok(rh.audio_delete_after);
  assert.equal(FILES.store.size, 1);
  const runs = db.prepare(`SELECT rail_page, rail_option, record_ref FROM ai_usage_logs WHERE task = 'transcribe' AND guard_for IS NULL`).all() as any[];
  assert.deepEqual(runs.map((x) => [x.rail_page, x.rail_option, x.record_ref]), [[REHEARSE_PAGE, REHEARSE_OPTION, `deck:${DECK}`]]);

  const list = await call(db, FILES, 'GET', `/${DECK}/rehearsals`);
  assert.equal(list.status, 200);
  assert.deepEqual(contractErrors(JSON.parse(readFileSync(resolve(here, '../src/contracts', CONTRACTS.rehearse.schema), 'utf8')), list.body), []);
  assert.equal(list.body.rehearsals[0].figures, 1);

  const kept = await call(db, FILES, 'PUT', `/${DECK}/rehearsals/${rh.uid}/keep-audio`, { keep: true });
  assert.equal(kept.body.rehearsal.audio, 'kept');
  // The sweep leaves kept audio alone, even past its time.
  db.prepare("UPDATE deck_rehearsals SET audio_delete_after = '2000-01-01 00:00:00'").run();
  assert.deepEqual(await purgeRehearsalAudio({ DB: d1Over(db), FILES } as any), { deleted: 0 });
  const off = await call(db, FILES, 'PUT', `/${DECK}/rehearsals/${rh.uid}/keep-audio`, { keep: false });
  assert.equal(off.body.rehearsal.audio, 'deleted', 'Keep off deletes the audio now');
  assert.equal(FILES.store.size, 0);
  assert.equal(off.body.rehearsal.report.figures.length, 1, 'the report stays');
  const again = await call(db, FILES, 'PUT', `/${DECK}/rehearsals/${rh.uid}/keep-audio`, { keep: true });
  assert.equal(again.status, 409);
});

test('3. the sweep deletes unkept audio past its hour, and only that', async () => {
  const db = fixture();
  const FILES = bucket();
  const a = await call(db, FILES, 'POST', `/${DECK}/rehearsals`, recording());
  const b = await call(db, FILES, 'POST', `/${DECK}/rehearsals`, recording());
  assert.equal(FILES.store.size, 2);
  db.prepare("UPDATE deck_rehearsals SET audio_delete_after = '2000-01-01 00:00:00' WHERE uid = ?").run(a.body.rehearsal.uid);
  assert.deepEqual(await purgeRehearsalAudio({ DB: d1Over(db), FILES } as any), { deleted: 1 });
  const rows = db.prepare('SELECT uid, audio_r2_key, audio_deleted_at FROM deck_rehearsals ORDER BY id').all() as any[];
  assert.equal(rows[0].audio_r2_key, null);
  assert.ok(rows[0].audio_deleted_at);
  assert.ok(rows[1].audio_r2_key, `${b.body.rehearsal.uid} is still within its hour`);
});

test('3. bad input refuses before any run; another member cannot rehearse or read the deck', async () => {
  const db = fixture();
  const FILES = bucket();
  assert.equal((await call(db, FILES, 'POST', `/${DECK}/rehearsals`, recording({ pitch_seconds: '240' }))).status, 400);
  assert.equal((await call(db, FILES, 'POST', `/${DECK}/rehearsals`, recording({ marks: JSON.stringify([{ card: 9, at_ms: 0 }]) }))).status, 400);
  assert.equal((await call(db, FILES, 'POST', `/${DECK}/rehearsals`, recording({ duration_ms: '700000' }))).status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_usage_logs WHERE task = 'transcribe'").get()!.n, 0);
  assert.equal(FILES.store.size, 0);
  const mine = await call(db, FILES, 'POST', `/${DECK}/rehearsals`, recording());
  assert.equal(mine.status, 201);
  const theirs = await call(db, FILES, 'GET', `/${DECK}/rehearsals/${mine.body.rehearsal.uid}`, undefined, OTHER);
  assert.ok([403, 404].includes(theirs.status), String(theirs.status));
  assert.ok([403, 404].includes((await call(db, FILES, 'POST', `/${DECK}/rehearsals`, recording(), OTHER)).status));
});

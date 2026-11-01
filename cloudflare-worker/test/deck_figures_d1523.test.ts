/**
 * D1523 (#3775, deck v2 A24) — Linked, Stated and Uncited on every figure.
 *
 *  · `figuresOf`: a bound tile, series, cell or older field is Linked with its
 *    slot, record, as of and grade; a binding that holds nothing, or a tile
 *    with no value, is Not recorded and never 0; a typed tile, series or cell
 *    is Stated; a number in free text is Uncited;
 *  · `GET /api/decks/:id/figures`: whoever reads the deck, 403 otherwise, 404
 *    for no deck; its reply matches `deckFigures.schema.json`;
 *  · the editor's tile badge (`figuresModel.badgeOf`) agrees with the Worker;
 *  · nothing that reaches Present, a share link or an export reads it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_figures_d1523.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import figuresRoutes from '../src/routes/deck_figures.ts';
import { figuresOf, numbersIn } from '../src/services/decks/figures.ts';
import { contractErrors } from '../src/contracts/validate.ts';
import { badgeOf, checkCounts, toReview } from '../../frontend/src/pages/raise/pitch/figuresModel.js';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'synthetic-figures-only-not-a-real-credential'.repeat(2);
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const SCHEMA = JSON.parse(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/contracts/deckFigures.schema.json'), 'utf8'));
const FOUNDER = 10, OTHER = 20, P = 1, Q = 2;

const recorded = (key: string) => ({ source_key: key, record_ref: 'mercury:2026-10', as_of: '2026-10-01', grade: 'Measured', snapshot_hash: 'h1' });
const missing = (key: string) => ({ source_key: key, record_ref: null, as_of: null, grade: 'Not recorded', snapshot_hash: null });

/** One version holding every kind of figure, and an older card with fields. */
const SLIDES = [
  { blocks: [
    { id: 'm1', kind: 'metric', label: 'MRR', value: '$12,400', binding: recorded('grow.mrr') },
    { id: 'm2', kind: 'metric', label: 'Churn', value: '', binding: missing('grow.churn') },
    { id: 'm3', kind: 'metric', label: 'Customers', value: '42' },
    { id: 'm4', kind: 'metric', label: 'Runway', value: '' },
    { id: 't1', kind: 'text', text: 'We grew 40% last quarter to $1.2M ARR.' },
    { id: 't2', kind: 'text', text: 'A calm sentence with no figure.' },
  ] },
  { blocks: [
    { id: 'c1', kind: 'chart', type: 'line', series: [{ label: 'Revenue', binding: recorded('grow.mrr') }, { label: 'Plan', points: [{ x: '2027-01', y: 5 }] }, { label: 'Empty' }] },
    { id: 'tb', kind: 'table', rows: [[{ text: 'Seats' }, { text: '1,200' }], [{ binding: recorded('validate.interviews') }, { check: true }]] },
  ] },
  { fields: [
    { key: 'traction', label: 'Traction', value: ['3 pilots', 'Waitlist open'] },
    { key: 'round', label: 'Round', value: '$1.5M', binding: missing('raise.round_target') },
  ] },
];

test('figuresOf: Linked with its source, Not recorded never 0, Stated for typed, Uncited for free text', () => {
  // Mutations checked: recorded() ignoring 'Not recorded' → m2 reads linked; the text case dropped → no uncited;
  // an unbound tile with no value read as stated → m4 is not not_recorded; value kept for a missing binding → m2's value is ''.
  const { figures, counts } = figuresOf(SLIDES, P);
  const by = (id: string, at: string | null = null) => figures.find((f) => f.block_id === id && f.at === at)!;
  assert.equal(by('m1').state, 'linked');
  assert.equal(by('m1').value, '$12,400');
  assert.deepEqual(by('m1').source, { source_key: 'grow.mrr', label: by('m1').source!.label, module: by('m1').source!.module, href: by('m1').source!.href, record_ref: 'mercury:2026-10', as_of: '2026-10-01', grade: 'Measured' });
  assert.ok(by('m1').source!.label && by('m1').source!.module && by('m1').source!.href?.includes(String(P)), 'the slot is named, with its module and this venture\'s address');
  assert.equal(by('m2').state, 'not_recorded');
  assert.equal(by('m2').value, null, 'Not recorded carries no value: never 0, never ""');
  assert.equal(by('m3').state, 'stated');
  assert.equal(by('m4').state, 'not_recorded');
  assert.equal(by('t1').state, 'uncited');
  assert.deepEqual(by('t1').figures, ['40%', '$1.2M']);
  assert.equal(figures.some((f) => f.block_id === 't2'), false, 'words with no number are no figure');
  assert.equal(by('c1', '0').state, 'linked');
  assert.equal(by('c1', '1').state, 'stated');
  assert.equal(figures.some((f) => f.block_id === 'c1' && f.at === '2'), false, 'an empty series is no figure');
  assert.equal(by('tb', '0:1').state, 'stated');
  assert.equal(figures.some((f) => f.block_id === 'tb' && f.at === '0:0'), false);
  assert.equal(by('tb', '1:0').state, 'linked');
  assert.equal(by('traction').state, 'uncited');
  assert.equal(by('round').state, 'not_recorded');
  assert.deepEqual(counts, { linked: 3, stated: 3, uncited: 2, not_recorded: 3 });
  for (const f of figures) assert.notEqual(f.value, '0', 'no figure is invented as 0');
  assert.deepEqual(figuresOf('not slides', P), { figures: [], counts: { linked: 0, stated: 0, uncited: 0, not_recorded: 0 } });
});

test('numbersIn: digits in any script, currency, separators and suffixes kept; at most 20', () => {
  assert.deepEqual(numbersIn('Revenue €3.4m, up 12 % on ١٢٣ users.'), ['€3.4m', '12 %', '١٢٣']);
  assert.deepEqual(numbersIn('Founded by 2 people, with a 5k waitlist and 3 builders'), ['2', '5k', '3']);
  assert.deepEqual(numbersIn('3 bananas'), ['3'], 'a suffix letter that starts a word is not a suffix');
  assert.equal(numbersIn(Array.from({ length: 30 }, (_, i) => String(i)).join(' ')).length, 20);
  assert.deepEqual(numbersIn(null), []);
});

test('the editor\'s tile badge agrees with the Worker, block by block', () => {
  // Mutation checked: badgeOf's order with 'linked' first → the table (linked + stated) reads linked and fails here.
  const { figures } = figuresOf(SLIDES, P);
  const worst = (states: string[]) => ['uncited', 'stated', 'not_recorded', 'linked'].find((s) => states.includes(s)) ?? null;
  for (const b of SLIDES.flatMap((s: any) => s.blocks ?? [])) {
    const states = figures.filter((f) => f.block_id === b.id).map((f) => f.state);
    assert.equal(badgeOf(b), worst(states), b.id);
  }
  assert.equal(badgeOf({ kind: 'image' }), null);
  const counts = figuresOf(SLIDES, P).counts;
  assert.equal(checkCounts(counts), '▤ Linked 3 · ✎ Stated 3 · ! Uncited 2 · Not recorded 3');
  assert.equal(checkCounts({ linked: 1, stated: 0, uncited: 0, not_recorded: 0 }), '▤ Linked 1 · ✎ Stated 0 · ! Uncited 0');
  assert.equal(checkCounts(null), null, 'no read, no counts: never a row of zeros');
  const review = toReview(figures);
  assert.deepEqual(review.map((r: any) => [r.state, r.card]), [['uncited', 0], ['uncited', 2], ['stated', 0], ['stated', 1], ['stated', 1]]);
  assert.equal(review[0].line, 'This number has no source');
  assert.match(review[2].line, /not linked to a record/);
});

// ── the route ────────────────────────────────────────────────────────────

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations).filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  const add = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Synthetic Founder', 'founder@example.test', 1001);
  add.run(OTHER, 'founder', 'Synthetic Other', 'other@example.test', 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Synthetic venture', 1001), (${Q}, 'Other venture', 1002)`);
  const ins = db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, 1, ?, ?, 1)');
  ins.run(1, P, 'Seed', JSON.stringify(SLIDES));
  ins.run(2, Q, 'Other', '[]');
  return db;
}

async function get(db: DatabaseSync, who: number | null, path: string) {
  const app = new Hono<any>().route('/api/decks', figuresRoutes);
  const headers: Record<string, string> = {};
  if (who != null) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  const res = await withThrownResponses(() => app.request(path, { headers }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('GET /api/decks/:id/figures: the reader gets every figure and the counts, matching its contract', async () => {
  // Mutation checked: the projectOwned gate removed → the other founder reads deck 1 (200, not 403).
  const db = world();
  const r = await get(db, FOUNDER, '/api/decks/1/figures');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(contractErrors(SCHEMA, r.body), []);
  assert.equal(r.body.deck_id, 1);
  assert.deepEqual(r.body.counts, figuresOf(SLIDES, P).counts);
  assert.deepEqual(contractErrors(SCHEMA, { ...r.body, counts: { ...r.body.counts, zero: 0 } }), ['$.counts: zero is not in the contract']);
  assert.equal((await get(db, OTHER, '/api/decks/1/figures')).status, 403, 'another venture\'s founder reads nothing');
  assert.equal((await get(db, FOUNDER, '/api/decks/99/figures')).status, 404);
  const anon = await get(db, null, '/api/decks/1/figures');
  assert.notEqual(anon.status, 200, 'no sign-in, no figures');
  assert.equal(anon.body?.figures, undefined);
  const empty = await get(db, OTHER, '/api/decks/2/figures');
  assert.deepEqual(empty.body, { deck_id: 2, figures: [], counts: { linked: 0, stated: 0, uncited: 0, not_recorded: 0 } });
});

test('the badges are the editor\'s: nothing a share link, Present or an export reads touches them', () => {
  // Every Worker file that reads the classifier: the route alone. A share link, the print page and every export
  // are written elsewhere, so none of them can carry a badge.
  const root = resolve(process.cwd(), 'cloudflare-worker/src');
  const readers: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name) && /services\/decks\/figures['.]|from '\.\/figures'/.test(readFileSync(p, 'utf8'))) readers.push(p.slice(root.length + 1));
    }
  };
  walk(root);
  assert.deepEqual(readers, ['routes/deck_figures.ts']);
  const shareRoutes = readFileSync(resolve(root, 'routes/deck_figures.ts'), 'utf8');
  assert.equal(/share|public/i.test(shareRoutes.replace(/\/\*[\s\S]*?\*\//, '')), false, 'the route is not public');
});

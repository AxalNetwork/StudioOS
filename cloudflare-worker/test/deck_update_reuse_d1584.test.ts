/**
 * D1584 (#3831, deck v2 F5) — investor-update reuse.
 *
 *  · `deriveFromUpdate`: a tile bound to an update's figure is proposed with
 *    the update's words, its source and grade, and the update as its record;
 *    a figure the update did not record is listed, never proposed as 0; a
 *    tile already showing the update's words is unchanged; typed tiles and
 *    other slots are not touched;
 *  · `GET /api/decks/:id/derive-update`: refreshed figures match the latest
 *    SENT update (not an older one, not an unsent draft); nothing is written;
 *    no update → `update: null` and the reason; 403, 404, and nothing without sign-in;
 *  · `GET /api/decks/:id/changes-since`: the figures and cards that changed
 *    between a link's version and the current one; nothing on the current one.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_update_reuse_d1584.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import reuseRoutes, { NO_UPDATE } from '../src/routes/deck_update_reuse.ts';
import { UPDATE_SLOTS, changesSince, deriveFromUpdate, updateText, type LatestUpdate } from '../src/services/decks/updateReuse.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'synthetic-update-reuse-only-not-a-real-credential'.repeat(2);
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const FOUNDER = 10, OTHER = 20, P = 1, Q = 2;

const bound = (key: string) => ({ source_key: key, record_ref: 'project_metrics:1', as_of: '2026-09-30', grade: 'Stated', snapshot_hash: 'h1' });

/** One version: tiles bound to update slots, a typed tile, another slot, a chart. */
const V1 = [
  { blocks: [
    { id: 'mrr', kind: 'metric', label: 'MRR', value: '$10,000', binding: bound('grow.mrr') },
    { id: 'run', kind: 'metric', label: 'Runway', value: '14 months', binding: bound('grow.runway') },
    { id: 'cus', kind: 'metric', label: 'Customers', value: '30', binding: bound('grow.paying_customers') },
    { id: 'typ', kind: 'metric', label: 'Pilots', value: '3' },
    { id: 'chu', kind: 'metric', label: 'Churn', value: '2%', binding: bound('grow.churn') },
  ] },
  { blocks: [
    { id: 'gro', kind: 'metric', label: 'Growth', value: '', binding: bound('grow.mercury_growth') },
    { id: 'c1', kind: 'chart', type: 'line', series: [{ label: 'MRR', binding: bound('grow.mrr') }] },
  ] },
];

const UPDATE: LatestUpdate = {
  uid: 'upd-new', title: 'October update', sent_at: '2026-10-31 09:00:00', period_start: '2026-10-01', period_end: '2026-10-31',
  figures: [
    { key: 'mrr', label: 'MRR', value: 12400, unit: 'usd', source: 'stripe', as_of: '2026-10-28', reason: null },
    { key: 'growth', label: 'Growth', value: 24, unit: 'pct', source: 'manual', as_of: '2026-10-28', reason: null },
    { key: 'customers', label: 'Customers', value: null, unit: 'count', source: null, as_of: null, reason: 'Not recorded: no snapshot in this period records it' },
    { key: 'burn', label: 'Burn', value: 40000, unit: 'usd', source: 'manual', as_of: '2026-10-28', reason: null },
    { key: 'runway', label: 'Runway', value: 14, unit: 'months', source: 'manual', as_of: '2026-10-28', reason: null },
  ],
};

test('deriveFromUpdate: bound tiles take the update\'s words, source and grade; Not recorded is never proposed', () => {
  // Mutations checked: the null-figure branch removed → Customers proposed as "" or 0; the equal-words skip removed
  // → Runway proposed although unchanged; CONNECTORS emptied → MRR graded Stated; the slot map's growth key dropped → no Growth.
  const d = deriveFromUpdate(V1, UPDATE);
  const by = (id: string) => d.proposals.find((p) => p.block_id === id);
  assert.deepEqual(d.proposals.map((p) => p.block_id).sort(), ['gro', 'mrr'], 'only bound tiles the update reports with other words');
  assert.equal(by('mrr')!.was, '$10,000');
  assert.equal(by('mrr')!.now, '$12,400');
  assert.equal(by('mrr')!.source, 'Connector');
  assert.deepEqual(by('mrr')!.binding, { source_key: 'grow.mrr', record_ref: 'portfolio_updates:upd-new', as_of: '2026-10-28', grade: 'Measured', snapshot_hash: 'update:upd-new:mrr' });
  assert.equal(by('gro')!.was, null, 'an empty tile was nothing, never 0');
  assert.equal(by('gro')!.now, '24%');
  assert.equal(by('gro')!.binding.grade, 'Stated', 'a typed figure keeps a Stated grade');
  assert.equal(d.unchanged, 1, 'Runway already shows the update\'s words');
  assert.deepEqual(d.not_in_update, [{ card: 0, block_id: 'cus', label: 'Customers', reason: 'Not recorded: no snapshot in this period records it' }]);
  for (const p of d.proposals) assert.notEqual(p.now, '0');
  assert.deepEqual(Object.values(UPDATE_SLOTS).sort(), ['grow.mercury_growth', 'grow.mrr', 'grow.net_burn', 'grow.paying_customers', 'grow.runway']);
});

test('changesSince: changed, added and removed tiles, and the card count', () => {
  const v2 = [
    { blocks: [
      { id: 'mrr', kind: 'metric', label: 'MRR', value: '$12,400', binding: bound('grow.mrr') },
      { id: 'run', kind: 'metric', label: 'Runway', value: '14 months', binding: bound('grow.runway') },
      { id: 'new', kind: 'metric', label: 'ARR', value: '$148,800', binding: bound('grow.arr') },
    ] },
    { blocks: [] },
    { blocks: [] },
  ];
  const c = changesSince(V1, v2);
  const of = (label: string) => c.figures.find((f) => f.label === label);
  assert.deepEqual(of('MRR'), { label: 'MRR', was: '$10,000', now: '$12,400' });
  assert.equal(of('Runway'), undefined, 'an unchanged figure is not a change');
  assert.deepEqual(of('ARR'), { label: 'ARR', was: null, now: '$148,800' });
  assert.deepEqual(of('Pilots'), { label: 'Pilots', was: '3', now: null });
  assert.deepEqual(c.cards, { before: 2, after: 3 });
  assert.deepEqual(changesSince(V1, V1).figures, []);
});

// ── the routes ───────────────────────────────────────────────────────────

const V2 = [{ blocks: [{ id: 'mrr', kind: 'metric', label: 'MRR', value: '$11,000', binding: bound('grow.mrr') }] }];

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations).filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  const add = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Synthetic Founder', 'founder@example.test', 1001);
  add.run(OTHER, 'founder', 'Synthetic Other', 'other@example.test', 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Synthetic venture', 1001), (${Q}, 'Other venture', 1002)`);
  const deck = db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, ?, ?, ?, ?)');
  deck.run(1, P, 1, 'Seed', JSON.stringify(V1), 0);
  deck.run(2, P, 2, 'Seed', JSON.stringify(V2), 1);
  deck.run(3, Q, 1, 'Other', '[]', 1);
  return db;
}

const upd = (db: DatabaseSync, uid: string, title: string, sentAt: string | null, figures: LatestUpdate['figures']) =>
  db.prepare(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, title, status, metrics_json, sent_at, period_start, period_end)
              VALUES (?, ?, ?, ?, ?, ?, ?, '2026-10-01', '2026-10-31')`)
    .run(uid, P, FOUNDER, title, sentAt ? 'submitted' : 'draft', JSON.stringify(figures), sentAt);

async function get(db: DatabaseSync, who: number | null, path: string) {
  const app = new Hono<any>().route('/api/decks', reuseRoutes);
  const headers: Record<string, string> = {};
  if (who != null) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  const res = await withThrownResponses(() => app.request(path, { headers }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('derive-update: refreshed figures match the latest SENT update, and nothing is written', async () => {
  // Mutations checked: `sent_at IS NOT NULL` dropped → the unsent draft's figures; ORDER BY ASC → the older update's.
  const db = world();
  upd(db, 'upd-old', 'September update', '2026-09-30 09:00:00', [{ ...UPDATE.figures[0], value: 9000 }]);
  upd(db, 'upd-new', 'October update', '2026-10-31 09:00:00', UPDATE.figures);
  upd(db, 'upd-draft', 'November draft', null, [{ ...UPDATE.figures[0], value: 99999 }]);
  const before = JSON.stringify(db.prepare('SELECT * FROM pitch_decks ORDER BY id').all());
  const r = await get(db, FOUNDER, '/api/decks/1/derive-update');
  assert.equal(r.status, 200);
  assert.equal(r.body.update.uid, 'upd-new');
  assert.equal(r.body.update.title, 'October update');
  const latest = new Map(UPDATE.figures.map((f) => [(UPDATE_SLOTS as any)[f.key], updateText(f)]));
  assert.ok(r.body.proposals.length >= 2);
  for (const p of r.body.proposals) {
    assert.equal(p.now, latest.get(p.source_key), `${p.label} matches the latest update`);
    assert.equal(p.binding.record_ref, 'portfolio_updates:upd-new');
  }
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM pitch_decks ORDER BY id').all()), before, 'a read writes nothing');
});

test('derive-update: no update sent → no proposal and the reason; the other founder 403; no deck 404', async () => {
  // Mutation checked: the projectOwned gate removed → the other founder reads deck 1.
  const db = world();
  upd(db, 'upd-draft', 'Draft only', null, UPDATE.figures);
  const r = await get(db, FOUNDER, '/api/decks/1/derive-update');
  assert.equal(r.status, 200);
  assert.equal(r.body.update, null);
  assert.deepEqual(r.body.proposals, []);
  assert.equal(r.body.reason, NO_UPDATE);
  assert.equal((await get(db, OTHER, '/api/decks/1/derive-update')).status, 403);
  assert.equal((await get(db, FOUNDER, '/api/decks/99/derive-update')).status, 404);
  const anon = await get(db, null, '/api/decks/1/derive-update');
  assert.notEqual(anon.status, 200, 'no sign-in, no proposal');
  assert.equal(anon.body?.proposals, undefined);
});

test('changes-since: a link\'s older version lists what changed; the current version lists nothing', async () => {
  // Mutation checked: `latest` computed as false always → the current version draws a line.
  const db = world();
  const old = await get(db, FOUNDER, '/api/decks/1/changes-since');
  assert.equal(old.status, 200);
  assert.deepEqual(old.body.since, { deck_id: 1, version: 1 });
  assert.deepEqual(old.body.current, { deck_id: 2, version: 2 });
  assert.equal(old.body.latest, false);
  assert.deepEqual(old.body.changes.figures.find((f: any) => f.label === 'MRR'), { label: 'MRR', was: '$10,000', now: '$11,000' });
  assert.deepEqual(old.body.changes.cards, { before: 2, after: 1 });
  const cur = await get(db, FOUNDER, '/api/decks/2/changes-since');
  assert.equal(cur.body.latest, true);
  assert.deepEqual(cur.body.changes.figures, []);
  assert.equal((await get(db, OTHER, '/api/decks/1/changes-since')).status, 403);
});

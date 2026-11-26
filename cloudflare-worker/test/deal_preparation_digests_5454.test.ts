/**
 * D5454 (#5454, R4) — the two digest aggregators count new deals the way discovery shows them. Real `node:sqlite`,
 * the full baseline schema and the D5454 migration, through the exported preview and run functions. Every venture,
 * deal and amount is invented.
 *
 * What it proves, for `services/telegramAggregator.ts` and `services/xAggregator.ts` (the investor brief, the only
 * draft in either file that reads `deals`):
 *   - a private preparation (a mixed-version row written past CHECK `dp_private_owns_no_deal`), a withdrawn and an
 *     archived managed release and a deal with unknown preparation metadata are not counted;
 *   - a published release, a legacy deal with no preparation (`legacy_visible_unreviewed`, owner answer Q1=A) and an
 *     unreleased `legacy_attach` are counted;
 *   - the count equals the number of windowed deals the discovery guard leaves in a list (`withoutHidden`);
 *   - an empty database drafts a real zero; a database that has not applied the migration hides nothing (the guard's
 *     own rule), and a preparation table that cannot be read makes the figure unreadable, never an unfiltered count;
 *   - the persisted Telegram and X drafts carry the same guarded figure.
 *
 * MUTATION CHECKS (each was run; each turns at least one test here red), applied to each aggregator in turn:
 *   M1  drop `AND d.id NOT IN (… json_each(?))` from the count                 → guarded count, list match, run fail
 *   M2  read the hidden set in `transactional` mode instead of `discovery`     → withdrawn/archived counted, tests fail
 *   M3  on a guard failure return `[]` (count unfiltered) instead of unreadable → the unreadable test fails
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_preparation_digests_5454.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { previewAudience, runAggregator } from '../src/services/telegramAggregator.ts';
import { previewXAudience, runXAggregator } from '../src/services/xAggregator.ts';
import { hiddenDealIds, withoutHidden } from '../src/services/dealPreparation.ts';
import { d1Over } from './_d1_sqlite.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const D5454 = read('cloudflare-worker/sql/migrations/202611150148_5454_deal_preparations.sql');

/** Deals inside the 7-day window, by what their preparation metadata makes them. */
const LEGACY_VISIBLE = 1, PUBLISHED = 2, WITHDRAWN = 3, ARCHIVED = 4, ATTACHED = 5, CORRUPT = 6, OUTSIDE = 7, PRIVATE_ROW = 8;
const COUNTED = [LEGACY_VISIBLE, PUBLISHED, ATTACHED];

function baseDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  db.exec(`
    INSERT INTO company_profiles (id, uid, company_name) VALUES (70, 'co-70', 'Harbor Ledger Inc');
    INSERT INTO projects (id, name, company_id, sector) VALUES (10, 'Harbor Ledger', 70, 'fintech');
  `);
  return db;
}

function seedDeals(db: DatabaseSync) {
  const recent = `datetime('now', '-1 day')`;
  db.exec(`
    INSERT INTO deals (id, uid, project_id, status, description, amount, created_at) VALUES
      (${LEGACY_VISIBLE}, 'g1', 10, 'active', 'Legacy listing', 100000, ${recent}),
      (${PUBLISHED}, 'g2', 10, 'active', 'Published release', 200000, ${recent}),
      (${WITHDRAWN}, 'g3', 10, 'active', 'Withdrawn release', 300000, ${recent}),
      (${ARCHIVED}, 'g4', 10, 'funded', 'Archived release', 400000, ${recent}),
      (${ATTACHED}, 'g5', 10, 'scored', 'Legacy attached', 500000, ${recent}),
      (${CORRUPT}, 'g6', 10, 'active', 'Corrupt metadata', 600000, ${recent}),
      (${OUTSIDE}, 'g7', 10, 'active', 'Older legacy listing', 700000, datetime('now', '-30 days')),
      (${PRIVATE_ROW}, 'g8', 10, 'applied', 'Private draft row', 800000, ${recent});
  `);
}

function withPreparations(db: DatabaseSync): DatabaseSync {
  db.exec(D5454);
  db.exec(`
    INSERT INTO deal_preparations (id, uid, scope_code, company_id, project_id, deal_id, origin, preparation_state, publication_state, created_by_user_id)
      VALUES (100, 'prep-draft', 'hq', 70, 10, NULL, 'preparation', 'draft', 'unreleased', 1);
    INSERT INTO deal_preparations (id, uid, scope_code, company_id, project_id, deal_id, origin, publication_state, released_revision_id, created_by_user_id) VALUES
      (102, 'prep-pub', 'hq', 70, 10, ${PUBLISHED}, 'preparation', 'published', 1021, 1),
      (103, 'prep-wd', 'hq', 70, 10, ${WITHDRAWN}, 'legacy_attach', 'withdrawn', 1031, 1),
      (104, 'prep-arch', 'hq', 70, 10, ${ARCHIVED}, 'preparation', 'archived', 1041, 1);
    INSERT INTO deal_preparations (id, uid, scope_code, company_id, project_id, deal_id, origin, publication_state, created_by_user_id)
      VALUES (105, 'prep-att', 'hq', 70, 10, ${ATTACHED}, 'legacy_attach', 'unreleased', 1);
  `);
  // Rows no current writer can produce, written past the CHECKs (a mixed-version or corrupted write): an unknown
  // publication state, and a never-released private preparation that owns a deals row. Both must read as private.
  db.exec('PRAGMA ignore_check_constraints = ON');
  db.exec(`INSERT INTO deal_preparations (id, uid, scope_code, company_id, project_id, deal_id, origin, publication_state, created_by_user_id) VALUES
    (106, 'prep-bad', 'hq', 70, 10, ${CORRUPT}, 'legacy_attach', 'mystery', 1),
    (108, 'prep-private-row', 'hq', 70, 10, ${PRIVATE_ROW}, 'preparation', 'unreleased', 1)`);
  db.exec('PRAGMA ignore_check_constraints = OFF');
  return db;
}

const fullDb = () => { const db = withPreparations(baseDb()); seedDeals(db); return db; };
const env = (db: DatabaseSync) => ({ DB: d1Over(db) }) as any;

async function digests(db: DatabaseSync) {
  const tg = await previewAudience(env(db), 'investors', 7);
  const x = await previewXAudience(env(db), 'investors', 7);
  return { tg, x };
}

test('R4 · both investor briefs count legacy, attached and published deals, and leave out private, withdrawn, archived and corrupt ones', async () => {
  const db = fullDb();
  try {
    const { tg, x } = await digests(db);
    assert.equal(tg.payload.new_deals, COUNTED.length, 'Telegram investor brief');
    assert.match(tg.body_md, new RegExp(`• ${COUNTED.length} new deals in pipeline`));
    assert.equal(x.payload.new_deals, COUNTED.length, 'X investor brief');
    assert.match(x.body, new RegExp(`${COUNTED.length} new deals in the Axal pipeline`));
  } finally { db.close(); }
});

test('R4 · each excluded class is excluded on its own, and each kept class is kept on its own', async () => {
  // One windowed deal at a time, so a guard that drops (or keeps) the wrong class cannot be hidden by a sum.
  const cases: Array<[string, number, number]> = [
    ['legacy visible (Q1=A)', LEGACY_VISIBLE, 1], ['published release', PUBLISHED, 1], ['unreleased legacy_attach', ATTACHED, 1],
    ['withdrawn release', WITHDRAWN, 0], ['archived release', ARCHIVED, 0], ['unknown metadata', CORRUPT, 0],
    ['private preparation row', PRIVATE_ROW, 0],
  ];
  for (const [label, keep, expected] of cases) {
    const db = fullDb();
    try {
      db.exec(`UPDATE deals SET created_at = datetime('now', '-60 days') WHERE id <> ${keep}`);
      const { tg, x } = await digests(db);
      assert.equal(tg.payload.new_deals, expected, `Telegram: ${label}`);
      assert.equal(x.payload.new_deals, expected, `X: ${label}`);
    } finally { db.close(); }
  }
});

test('R4 · the digest count equals the windowed deals the discovery guard leaves in a list', async () => {
  const db = fullDb();
  try {
    const rows = db.prepare(`SELECT id FROM deals WHERE datetime(created_at) >= datetime('now', '-7 days') ORDER BY id`).all() as Array<{ id: number }>;
    const listed = withoutHidden(rows, await hiddenDealIds(env(db), 'discovery'), (r) => r.id).map((r) => Number(r.id));
    assert.deepEqual(listed, COUNTED);
    const { tg, x } = await digests(db);
    assert.equal(tg.payload.new_deals, listed.length);
    assert.equal(x.payload.new_deals, listed.length);
  } finally { db.close(); }
});

test('R4 · an empty database drafts a real zero, not an unreadable figure', async () => {
  const db = withPreparations(baseDb());
  try {
    db.exec('DELETE FROM deal_preparations');
    const { tg, x } = await digests(db);
    assert.equal(tg.payload.new_deals, 0);
    assert.match(tg.body_md, /• 0 new deals in pipeline/);
    assert.equal(x.payload.new_deals, 0);
    assert.match(x.body, /0 new deals in the Axal pipeline/);
  } finally { db.close(); }
});

test('R4 · a database without the preparation table hides nothing, as the guard decides (no preparation can exist there)', async () => {
  const db = baseDb();
  try {
    seedDeals(db);
    const { tg, x } = await digests(db);
    const windowed = [LEGACY_VISIBLE, PUBLISHED, WITHDRAWN, ARCHIVED, ATTACHED, CORRUPT, PRIVATE_ROW].length;
    assert.equal(tg.payload.new_deals, windowed);
    assert.equal(x.payload.new_deals, windowed);
  } finally { db.close(); }
});

test('R4 · an unreadable preparation table fails closed: the figure is unreadable, never an unfiltered count', async () => {
  const db = baseDb();
  try {
    seedDeals(db);
    // A real SQLite failure that is not "no such table": the guard's query names columns this table lacks.
    db.exec('CREATE TABLE deal_preparations (broken TEXT)');
    const { tg, x } = await digests(db);
    assert.equal(tg.payload.new_deals, null, 'Telegram counted deals past an unreadable guard');
    assert.match(tg.body_md, /New deals in pipeline — Unreadable/);
    assert.doesNotMatch(tg.body_md, /\d+ new deals in pipeline/);
    assert.equal(x.payload.new_deals, null, 'X counted deals past an unreadable guard');
    assert.match(x.body, /unreadable deal count/);
    assert.equal(tg.drafted, true, 'the brief still drafts its other figures');
  } finally { db.close(); }
});

test('R4 · the persisted Telegram and X drafts carry the guarded figure', async () => {
  const db = fullDb();
  try {
    db.exec(`
      INSERT INTO users (id, email, name, role, is_active) VALUES (1, 'ada@example.test', 'Ada Admin', 'admin', 1);
      INSERT INTO telegram_channels (slug, label, chat_id, audience, enabled) VALUES ('investors-ch', 'investors', '-1001', 'investors', 1);
      INSERT INTO x_accounts (id, handle, enabled) VALUES (1, 'axalvc', 1);
    `);
    await runAggregator(env(db), 1, 7);
    const tg = db.prepare(`SELECT a.payload_json, p.body_md FROM telegram_aggregations a JOIN telegram_posts p ON p.id = a.draft_post_id
      WHERE a.audience = 'investors'`).get() as { payload_json: string; body_md: string } | undefined;
    assert.ok(tg, 'no Telegram investor draft persisted');
    assert.equal(JSON.parse(tg!.payload_json).new_deals, COUNTED.length);
    assert.match(tg!.body_md, new RegExp(`• ${COUNTED.length} new deals in pipeline`));

    await runXAggregator(env(db), { adminId: 1, accountId: 1, periodDays: 7 });
    const x = db.prepare(`SELECT body FROM x_posts WHERE source_kind = 'investor_brief' AND thread_position = 0`).get() as { body: string } | undefined;
    assert.ok(x, 'no X investor draft persisted');
    assert.match(x!.body, new RegExp(`${COUNTED.length} new deals in the Axal pipeline`));
  } finally { db.close(); }
});

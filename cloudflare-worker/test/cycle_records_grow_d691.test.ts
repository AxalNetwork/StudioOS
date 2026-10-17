/**
 * D691 (S19-A, #1698), test 6 — the part that needs nothing of #1697: Grow's
 * six stores in `ownedRow`, and the activity of today's Grow writes read on
 * their records through `activityFor`'s three older shapes.
 *
 * Today's `logWrite` (cycle_grow.ts) writes `entity_type` as a table name, an
 * `entity_id`, a `grow_*` action and no `project_id`. The rows below are seeded
 * in exactly that shape; nothing rewrites them. The closing PR adds the
 * records, actions, form-options and fill tests to this file, and moves the
 * matchers below into `services/records/grow.ts`'s specs.
 *
 * THE DATABASE IS THE BASELINE PLUS EVERY NUMBERED MIGRATION ABOVE THE CUTOFF,
 * IN ORDER, with foreign keys on, as D1 runs them. The names are made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cycle_records_grow_d691.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { ownedRow } from '../src/services/records/owned.ts';
import { activityFor } from '../src/services/cycleActivity.ts';
import type { OldRowsMatcher, Store } from '../src/services/records/types.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = process.cwd();
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);

const FOUNDER = 10, OTHER_FOUNDER = 20;
const A = 1, B = 2;

/** The older shapes each Grow record reads (step 4); the closing PR's specs carry these. */
const OLD_ROWS: Record<string, OldRowsMatcher> = {
  'product-improvement': { entityTypes: ['product_feedback'], unscopedActions: ['grow_feedback_logged', 'grow_feedback_updated'] },
  distribution: { entityTypes: ['growth_channels'], idPrefixTypes: ['channel_spend'],
    unscopedActions: ['grow_channel_added', 'grow_channel_updated', 'grow_channel_spend'] },
  'team-expansion': { entityTypes: ['job_postings'], children: ['job_applications'],
    unscopedActions: ['grow_role_updated', 'grow_application_stage'] },
  'partner-network': { entityTypes: ['growth_partners'], idPrefixTypes: ['partner_revenue'],
    unscopedActions: ['grow_partner_added', 'grow_partner_updated', 'grow_partner_revenue'] },
  'market-expansion': { entityTypes: ['markets'], unscopedActions: ['grow_market_added', 'grow_market_updated'] },
  'durable-company-building': { entityTypes: ['compliance_events'], unscopedActions: ['grow_obligation_added', 'grow_obligation_updated'] },
};

function fixture() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`INSERT INTO founders (id, name, email) VALUES (${FOUNDER}, 'Ana Wren', 'ana@example.test'),
    (${OTHER_FOUNDER}, 'Ola Kestrel', 'ola@example.test')`);
  db.exec(`INSERT INTO users (id, role, name, email, founder_id) VALUES
    (${FOUNDER}, 'founder', 'Ana Wren', 'ana@example.test', ${FOUNDER}),
    (${OTHER_FOUNDER}, 'founder', 'Ola Kestrel', 'ola@example.test', ${OTHER_FOUNDER})`);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER}), (${B}, 'Kestrel Mill', ${OTHER_FOUNDER})`);
  // One row in each store per venture. B's uids extend A's, so a prefix match must stop at the colon.
  db.exec(`INSERT INTO product_feedback (uid, project_id, body, source, created_by, created_at) VALUES
    ('fba1', ${A}, 'Exports are slow', 'customer', ${FOUNDER}, '2026-09-01 09:00:00'),
    ('fba12', ${B}, 'Needs a dark mode', 'customer', ${OTHER_FOUNDER}, '2026-09-01 09:00:00')`);
  db.exec(`INSERT INTO growth_channels (uid, project_id, name, utm_source, created_by) VALUES
    ('cha1', ${A}, 'Newsletter', 'newsletter', ${FOUNDER}), ('cha12', ${B}, 'Podcast', 'podcast', ${OTHER_FOUNDER}),
    ('chb1', ${A}, 'Search', 'search', ${FOUNDER})`);
  db.exec(`INSERT INTO growth_partners (uid, project_id, name, type, created_by) VALUES
    ('pta1', ${A}, 'Lantern Resellers', 'reseller', ${FOUNDER}), ('pta12', ${B}, 'Mill Agency', 'agency', ${OTHER_FOUNDER})`);
  db.exec(`INSERT INTO markets (uid, project_id, name, created_by) VALUES
    ('mka1', ${A}, 'Portugal', ${FOUNDER}), ('mka12', ${B}, 'Chile', ${OTHER_FOUNDER})`);
  db.exec(`INSERT INTO job_postings (id, slug, host_user_id, project_id, title) VALUES
    (31, 'lantern-engineer', ${FOUNDER}, ${A}, 'Engineer'), (32, 'mill-designer', ${OTHER_FOUNDER}, ${B}, 'Designer'),
    (33, 'lantern-analyst', ${FOUNDER}, ${A}, 'Analyst')`);
  db.exec(`INSERT INTO job_applications (id, posting_id, name, email) VALUES
    (41, 31, 'Rui Tomas', 'rui@example.test'), (42, 33, 'Ines Reyes', 'ines@example.test')`);
  db.exec(`INSERT INTO compliance_events (id, project_id, jurisdiction, event_type, title, due_date, created_by_user_id) VALUES
    (51, ${A}, 'Unspecified', 'board_meeting', 'Board meeting', '2026-12-01', ${FOUNDER}),
    (52, ${B}, 'Unspecified', 'annual_report', 'Annual report', '2026-12-01', ${OTHER_FOUNDER})`);
  return { db, env: { DB: d1Over(db) } as any };
}

/** Today's `logWrite`: a table name, an id, a grow_* action, and no project. */
function legacy(db: DatabaseSync, action: string, entity: string, entityId: string, at = '2026-09-02 10:00:00') {
  db.prepare('INSERT INTO activity_logs (action, details, user_id, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(action, `grow:${entity}`, FOUNDER, entity, entityId, at);
}

const read = (env: any, module: string, store: Store, id: string, projectId = A) =>
  activityFor(env, { projectId, entityType: `grow.${module}`, entityId: id, oldRows: OLD_ROWS[module], store });

test('6: ownedRow resolves each Grow store within the venture and refuses another venture\'s ids', async () => {
  const { env } = fixture();
  const cases: Array<[Store, string, string]> = [
    ['product_feedback', 'fba1', 'fba12'], ['growth_channels', 'cha1', 'cha12'], ['growth_partners', 'pta1', 'pta12'],
    ['markets', 'mka1', 'mka12'], ['job_postings', '31', '32'], ['compliance_events', '51', '52'],
  ];
  for (const [store, own, foreign] of cases) {
    assert.equal(await ownedRow(env, store, own, A), true, `${store} ${own} is venture A's`);
    assert.equal(await ownedRow(env, store, foreign, A), false, `${store} ${foreign} is venture B's`);
    assert.equal(await ownedRow(env, store, own, B), false, `${store} ${own} with ?project=B`);
    assert.equal(await ownedRow(env, store, foreign, B), true, `${store} ${foreign} with ?project=B`);
  }
  // Numeric stores refuse anything but a plain positive id; uid stores refuse an id from another table.
  for (const bad of ['031', '31abc', '0', 'cha1']) assert.equal(await ownedRow(env, 'job_postings', bad, A), false, bad);
  assert.equal(await ownedRow(env, 'product_feedback', 'cha1', A), false);
  assert.equal(await ownedRow(env, 'compliance_events', 'Board meeting', A), false);
});

test('6: an old product_feedback row reads on its record, and nothing else does', async () => {
  const { db, env } = fixture();
  legacy(db, 'grow_feedback_updated', 'product_feedback', 'fba1');
  legacy(db, 'grow_feedback_updated', 'product_feedback', 'fba12');
  // Same table and id, but not a Grow write: never admitted without a project.
  legacy(db, 'feedback_imported', 'product_feedback', 'fba1');
  // A venture-B row that names A's id is not A's.
  db.prepare("INSERT INTO activity_logs (project_id, action, details, entity_type, entity_id) VALUES (?, 'grow_feedback_updated', 'Other venture', 'product_feedback', 'fba1')").run(B);
  const out = await read(env, 'product-improvement', 'product_feedback', 'fba1');
  assert.deepEqual(out.items.map((r) => r.action), ['grow_feedback_updated', 'created']);
  assert.equal(out.items[0].a, 'grow:product_feedback by Ana Wren');
  assert.equal(out.items[1].a, 'Created by Ana Wren');
  assert.equal(out.total, 2);
  // The old row is read as written.
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE project_id IS NULL AND entity_id = 'fba1'").get() as any).n, 2);
});

test('6: an old channel_spend row (<uid>:<month>) reads on its channel only', async () => {
  const { db, env } = fixture();
  legacy(db, 'grow_channel_spend', 'channel_spend', 'cha1:2026-09');
  legacy(db, 'grow_channel_spend', 'channel_spend', 'cha12:2026-09');
  legacy(db, 'grow_channel_spend', 'channel_spend', 'chb1:2026-09');
  // An exact id under the spend table is not a month's figure.
  legacy(db, 'grow_channel_spend', 'channel_spend', 'cha1');
  const out = await read(env, 'distribution', 'growth_channels', 'cha1');
  assert.deepEqual(out.items.filter((r) => r.action !== 'created').map((r) => r.action), ['grow_channel_spend']);
  assert.equal(out.total, 2); // the spend row, and the creator from the stored row
  const other = await read(env, 'distribution', 'growth_channels', 'chb1');
  assert.equal(other.items.filter((r) => r.action === 'grow_channel_spend').length, 1);
});

test('6: an old partner_revenue row (<uid>:<month>) reads on its partner only', async () => {
  const { db, env } = fixture();
  legacy(db, 'grow_partner_revenue', 'partner_revenue', 'pta1:2026-08');
  legacy(db, 'grow_partner_revenue', 'partner_revenue', 'pta12:2026-08');
  const out = await read(env, 'partner-network', 'growth_partners', 'pta1');
  assert.deepEqual(out.items.filter((r) => r.action !== 'created').map((r) => r.action), ['grow_partner_revenue']);
});

test('6: an old job_applications stage row reads on its posting, and another posting\'s does not', async () => {
  const { db, env } = fixture();
  legacy(db, 'grow_application_stage', 'job_applications', '41');
  legacy(db, 'grow_application_stage', 'job_applications', '42');
  legacy(db, 'grow_role_updated', 'job_postings', '31', '2026-09-03 10:00:00');
  const out = await read(env, 'team-expansion', 'job_postings', '31');
  assert.deepEqual(out.items.filter((r) => r.action !== 'created').map((r) => r.action), ['grow_role_updated', 'grow_application_stage']);
  assert.equal(out.items.find((r) => r.action === 'created')?.a, 'Created by Ana Wren');
  // The application's own name never reaches activity: the row reads as written.
  assert.equal(JSON.stringify(out).includes('Rui'), false);
  const analyst = await read(env, 'team-expansion', 'job_postings', '33');
  assert.deepEqual(analyst.items.filter((r) => r.action !== 'created').map((r) => r.action), ['grow_application_stage']);
});

test('6: market and obligation rows read on their records, with their stored creators', async () => {
  const { db, env } = fixture();
  legacy(db, 'grow_market_updated', 'markets', 'mka1');
  legacy(db, 'grow_obligation_added', 'compliance_events', '51');
  legacy(db, 'grow_obligation_added', 'compliance_events', '52');
  const market = await read(env, 'market-expansion', 'markets', 'mka1');
  assert.deepEqual(market.items.map((r) => r.action), ['grow_market_updated', 'created']);
  const obligation = await read(env, 'durable-company-building', 'compliance_events', '51');
  assert.deepEqual(obligation.items.map((r) => r.action), ['grow_obligation_added', 'created']);
  assert.equal(obligation.items[1].a, 'Created by Ana Wren');
});

test('6: only grow_* actions are read without a project', async () => {
  const { env } = fixture();
  await assert.rejects(activityFor(env, { projectId: A, entityType: 'grow.product-improvement', entityId: 'fba1',
    oldRows: { entityTypes: ['product_feedback'], unscopedActions: ['feedback_imported'] } }), /Only grow_\* activity/);
});

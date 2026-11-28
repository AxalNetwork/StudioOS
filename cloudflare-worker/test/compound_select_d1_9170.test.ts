/**
 * #9170: D1 refuses a compound SELECT of more than five terms ("too many terms
 * in compound SELECT"); node:sqlite allows 500. So these run on a local D1
 * (Miniflare, the engine `wrangler dev` uses), not on `d1Over`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/compound_select_d1_9170.test.ts
 *
 * The Partner Pipeline activity feed is seeded with one row of each of its six
 * event kinds and read through the route, for its order and its limit. The
 * other four statements the split touched are run once each on the same
 * engine. Every row is synthetic; nothing reaches a remote database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { toLocalD1 } from './_build_rows_read.ts';
import partnerPipeline from '../src/routes/partner_pipeline.ts';
import { PROJECT_CYCLES_SQL } from '../src/routes/account_companies.ts';
import { HISTORY } from '../src/routes/admin_lab_operations.ts';
import { readFundAggregates } from '../src/routes/research_overview.ts';
import { PENDING } from '../src/services/memberFileSizeBackfill.ts';

test.after(removeMigratedDatabases);

const at = (minute: number) => `2026-01-01 00:${String(minute).padStart(2, '0')}:00`;
const SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

function seeded() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO partners (id, name, email) VALUES (1, 'Ours', 'ours@example.test');
    INSERT INTO users (id, email, name, role, partner_id) VALUES (80, 'ours@example.test', 'Ours', 'partner', 1);
    INSERT INTO founders (id, name, email) VALUES (5, 'Fran', 'fran@example.test');
    INSERT INTO user_company_links (uid, user_id, company_id) VALUES ('link-11', 80, 11);
    INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description) VALUES
      (1, 'n-1', 9, 5, 'engineering', 'First', 'desc'),
      (2, 'n-2', 9, 5, 'engineering', 'Second', 'desc');
    INSERT INTO partner_lead_passes (partner_id, need_id, reason, passed_at) VALUES (1, 1, 'timing', '${at(1)}');
    INSERT INTO quotes (id, uid, need_id, partner_id, company_id, price, deliverables, status, decided_at) VALUES
      (1, 'quote-1', 2, 1, 11, 100, '[]', 'accepted', '${at(3)}');
    INSERT INTO quote_versions (quote_id, version, change_summary, created_at) VALUES (1, 1, 'First', '${at(2)}');
    INSERT INTO quote_negotiations (id, uid, quote_id, last_moved_at) VALUES (1, 'neg-1', 1, '${at(4)}');
    INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price, company_id) VALUES
      (1, 'eng-1', 2, 1, 1, 5, 9, 100, 11);
    INSERT INTO partner_retainers (id, uid, engagement_id, created_at, ended_at) VALUES (1, 'ret-1', 1, '${at(5)}', '${at(6)}');
  `);
  return db;
}

/** Each `?` outside a quoted SQL string, bound to `value` (a number: some are LIMITs). */
const placeholders = (sql: string) => (sql.replace(/'(?:[^']|'')*'/g, "''").match(/\?/g) || []).length;

test('the activity feed reads all six kinds on D1, newest first, and honours the limit', async () => {
  const db = seeded();
  const { d1, dispose } = await toLocalD1(db);
  db.close();
  try {
    const token = await new SignJWT({ user_id: 80, role: 'partner' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const get = async (path: string) => {
      const response = await partnerPipeline.request(path, {
        headers: { Authorization: `Bearer ${token}`, 'X-Company-Id': '11' },
      }, { DB: d1, JWT_SECRET: SECRET, ENVIRONMENT: 'development' });
      return { status: response.status, body: await response.json() as any };
    };
    const all = await get('/activity');
    assert.equal(all.status, 200, JSON.stringify(all.body));
    assert.deepEqual(all.body.items.map((e: any) => [e.kind, e.occurred_at, e.opportunity.need_id]), [
      ['retainer_ended', at(6), 2],
      ['retainer_created', at(5), 2],
      ['negotiation_moved', at(4), 2],
      ['proposal_won', at(3), 2],
      ['proposal_version', at(2), 2],
      ['passed', at(1), 1],
    ]);
    const three = await get('/activity?limit=3');
    assert.equal(three.status, 200);
    assert.deepEqual(three.body.items.map((e: any) => e.kind), ['retainer_ended', 'retainer_created', 'negotiation_moved']);
    assert.deepEqual((await get('/activity?need_id=1')).body.items.map((e: any) => e.kind), ['passed']);
  } finally { await dispose(); }
});

test('the other split statements run on D1', async () => {
  const db = migratedDatabase();
  const { d1, dispose } = await toLocalD1(db);
  db.close();
  try {
    const run = async (name: string, sql: string, value: unknown = 0) => {
      try { await d1.prepare(sql).bind(...Array(placeholders(sql)).fill(value)).all(); }
      catch (e: any) { assert.fail(`${name} failed on D1: ${e?.message || e}`); }
    };
    await run('PROJECT_CYCLES_SQL', PROJECT_CYCLES_SQL, '[]');
    await run('admin lab HISTORY', HISTORY);
    await run('member file PENDING', PENDING);
    const funds = await readFundAggregates({ DB: d1 } as any);
    assert.equal(funds.total, 0);
  } finally { await dispose(); }
});

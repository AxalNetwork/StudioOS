/**
 * D712 decision 6 (#1777) — `lp_reports` creates, edits and publishes only
 * through `requireFundGp` on the report's fund; an admin issues LP reports
 * from the reporting queue, so its publish is refused; a published row is
 * never edited.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import lpReports from '../src/routes/lp_reports.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const SCHEMA = ['users', 'vc_funds', 'limited_partners', 'lp_reports', 'user_company_links', 'activity_logs']
  .map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n');
const SECRET = ['d712', 'lp', 'reports', 'fixture', 'secret'].join('-');
const ADMIN = 1, GP = 2, OTHER = 3, LOW_TIER = 4;

function fixture() {
  const { DB, db } = makeD1(SCHEMA);
  const u = db.prepare("INSERT INTO users (id, role, name, email, investor_tier, investor_subscription_status) VALUES (?, ?, ?, ?, ?, 'active')");
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', 'free');
  u.run(GP, 'investor', 'Gus GP', 'gus@example.test', 'institutional');
  u.run(OTHER, 'investor', 'Olive Other', 'olive@example.test', 'institutional');
  u.run(LOW_TIER, 'investor', 'Lou Low', 'lou@example.test', 'free');
  db.exec(`INSERT INTO vc_funds (id, name, gp_user_id) VALUES (10, 'Fund A', ${GP});
    INSERT INTO lp_reports (uid, fund_id, period, status, created_by) VALUES ('draft-a', 10, '2026-Q2', 'draft', ${GP}), ('pub-a', 10, '2026-Q1', 'published', ${GP});`);
  const env = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  async function call(who: number, method: string, path: string, body?: unknown) {
    const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await lpReports.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  }
  return { db, call, row: (uid: string) => ({ ...(db.prepare('SELECT status, narrative FROM lp_reports WHERE uid = ?').get(uid) as any) }) };
}

test('an investor who is not the fund\'s GP of record is refused on create, edit and publish: 402 below the institutional tier, 404 at it', async () => {
  const f = fixture();
  for (const [who, status] of [[LOW_TIER, 402], [OTHER, 404]] as const) {
    assert.equal((await f.call(who, 'POST', '/', { fund_id: 10, period: '2026-Q3' })).status, status, `create ${who}`);
    assert.equal((await f.call(who, 'PUT', '/draft-a', { narrative: 'Rewritten' })).status, status, `edit ${who}`);
    assert.equal((await f.call(who, 'POST', '/draft-a/publish')).status, status, `publish ${who}`);
  }
  assert.deepEqual(f.row('draft-a'), { status: 'draft', narrative: null });
});

test('an admin\'s publish is refused, and so is any edit of a published row', async () => {
  const f = fixture();
  const pub = await f.call(ADMIN, 'POST', '/draft-a/publish');
  assert.deepEqual([pub.status, pub.body.code], [409, 'issue_from_reporting_queue']);
  assert.equal(f.row('draft-a').status, 'draft');
  for (const who of [ADMIN, GP]) {
    const edit = await f.call(who, 'PUT', '/pub-a', { narrative: 'Changed after publishing' });
    assert.deepEqual([edit.status, edit.body.code], [409, 'report_published']);
  }
  assert.equal(f.row('pub-a').narrative, null);
  // An admin may still draft and edit a draft.
  assert.equal((await f.call(ADMIN, 'PUT', '/draft-a', { narrative: 'Admin draft' })).status, 200);
});

test('the GP of record creates, edits and publishes', async () => {
  const f = fixture();
  assert.equal((await f.call(GP, 'POST', '/', { fund_id: 10, period: '2026-Q3' })).status, 201);
  assert.equal((await f.call(GP, 'PUT', '/draft-a', { narrative: 'The quarter.' })).status, 200);
  const pub = await f.call(GP, 'POST', '/draft-a/publish');
  assert.equal(pub.status, 200);
  assert.deepEqual(f.row('draft-a'), { status: 'published', narrative: 'The quarter.' });
  assert.equal((await f.call(GP, 'POST', '/draft-a/publish')).status, 409, 'publishing twice is refused');
});

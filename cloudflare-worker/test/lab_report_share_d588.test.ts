/**
 * D588 (#1215) — a scoring report shared with one named account, on real SQLite.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lab_report_share_d588.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import labReportShares from '../src/routes/lab_report_shares.ts';
import { signScore } from '../src/services/scoreIntegrity.ts';
import { sha256Hex } from '../src/services/shareLink.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SCORING_HMAC_SECRET = 'unit-test-scoring-hmac-secret';
const OWNER = 10;
const OTHER = 20;
const NAMED = 30;
const ADMIN = 1;

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/401_lab_report_shares.sql'), 'utf8');

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'projects', 'score_snapshots', 'activity_logs']) db.exec(ddl(t));
  db.exec(MIG);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'Hq Admin', 'hq@axal.example', null);
  u.run(OWNER, 'founder', 'Fay Owner', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(NAMED, 'investor', 'Ned Named', 'ned@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (1, 'Acme', 1001), (2, 'Beta', 1002)`);
  return db;
}

const app = new Hono<any>();
app.route('/lab-report-shares', labReportShares);
app.onError((err: any, c) => {
  const message = String(err?.message || '');
  const status = message === 'Unauthorized' ? 401 : 500;
  return c.json({ error: 'unhandled', message }, status);
});

const envOf = (db: any) => ({ JWT_SECRET, SCORING_HMAC_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });

async function call(db: any, who: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who !== null) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await app.request(path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }, envOf(db) as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

async function official(db: any, projectId: number, score: number, when: string, extra: Record<string, unknown> = {}) {
  const hash = await signScore({ JWT_SECRET, SCORING_HMAC_SECRET } as any, projectId, score, when);
  db.prepare(
    `INSERT INTO score_snapshots (
       project_id, total_score, tier, created_at, market_total, inputs_json, qualitative_text, ai_notes, scored_by, integrity_hash, is_sandbox
     ) VALUES (?, ?, 'TIER_2', ?, 12, ?, 'secret prose', 'secret note', 'scorer@hidden.test', ?, 0)`,
  ).run(projectId, score, when, JSON.stringify({ tam: 999000000, ...extra }), hash);
}

const BODY = {
  project_id: 1,
  audience: 'summary' as const,
  grantee_email: 'ned@example.test',
  expires_in_days: 7,
  open_limit: 2,
  consent: true,
  report_kind: 'scoring',
};

const GONE = { error: 'lab_report_share_unavailable', message: 'This link is not available.', detail: 'This link is not available.' };

test('only the report owner creates a link, and the token is stored as a hash and shown once', async () => {
  const db = fixture();
  await official(db, 1, 82, '2026-10-01 12:00:00');
  assert.equal((await call(db, OTHER, 'POST', '/lab-report-shares', BODY)).status, 403);
  assert.equal((await call(db, ADMIN, 'POST', '/lab-report-shares', BODY)).status, 403);
  const refused = await call(db, OWNER, 'POST', '/lab-report-shares', { ...BODY, consent: false });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'consent_required');
  assert.equal((await call(db, OWNER, 'POST', '/lab-report-shares', { ...BODY, report_kind: 'profiling' })).body.error, 'report_kind_unsupported');
  assert.equal((await call(db, OWNER, 'POST', '/lab-report-shares', { ...BODY, grantee_email: 'nobody@example.test' })).body.error, 'grantee_not_found');
  const created = await call(db, OWNER, 'POST', '/lab-report-shares', BODY);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(created.body.token);
  assert.equal(created.body.share_path, `/share/lab-report/${created.body.token}`);
  const row = db.prepare('SELECT token_hash, audience, grantee_user_id, open_limit, opens, snapshot_json FROM lab_report_shares').get() as any;
  assert.equal(row.token_hash, await sha256Hex(created.body.token));
  assert.notEqual(row.token_hash, created.body.token);
  assert.equal(row.grantee_user_id, NAMED);
  assert.equal(row.opens, 0);
  assert.equal(JSON.stringify(row).includes(created.body.token), false);
  assert.equal(row.snapshot_json.includes('secret prose'), false);
  assert.equal(row.snapshot_json.includes('999000000'), false);
  const listed = await call(db, OWNER, 'GET', '/lab-report-shares?project_id=1');
  assert.equal(listed.status, 200);
  assert.equal(JSON.stringify(listed.body).includes(created.body.token), false);
  assert.equal(listed.body.items[0].grantee_email, 'ned@example.test');
  const logged = db.prepare(`SELECT action, user_id, project_id FROM activity_logs`).get() as any;
  assert.equal(logged.action, 'lab_report_share_created');
  assert.equal(logged.user_id, OWNER);
});

test('a practice run is not shared, and a newer practice run does not replace the official one', async () => {
  const db = fixture();
  assert.equal((await call(db, OWNER, 'POST', '/lab-report-shares', BODY)).body.error, 'no_official_score');
  await official(db, 1, 82, '2026-10-01 12:00:00');
  db.prepare(
    `INSERT INTO score_snapshots (project_id, total_score, tier, created_at, is_sandbox, inputs_json) VALUES (1, 11, 'TIER_3', '2026-10-06 12:00:00', 1, '{"tam":1}')`,
  ).run();
  const created = await call(db, OWNER, 'POST', '/lab-report-shares', { ...BODY, audience: 'dimensions' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const opened = await call(db, NAMED, 'GET', `/lab-report-shares/open/${created.body.token}`);
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.total_score, 82);
  assert.equal(opened.body.dimensions.market_total, 12);
  assert.equal(JSON.stringify(opened.body).includes('secret'), false);
  assert.equal(JSON.stringify(opened.body).includes('tam'), false);
});

test('summary hides dimension scores; dimensions keeps them; both hide the inputs', async () => {
  const db = fixture();
  await official(db, 1, 82, '2026-10-01 12:00:00');
  const summary = await call(db, OWNER, 'POST', '/lab-report-shares', BODY);
  const summaryOpen = await call(db, NAMED, 'GET', `/lab-report-shares/open/${summary.body.token}`);
  assert.equal(summaryOpen.body.audience, 'summary');
  assert.equal(summaryOpen.body.dimensions, undefined);
  assert.equal(summaryOpen.body.shows, 'The latest official total score and its tier.');
  const dimensions = await call(db, OWNER, 'POST', '/lab-report-shares', { ...BODY, audience: 'dimensions', open_limit: 1 });
  const dimensionsOpen = await call(db, NAMED, 'GET', `/lab-report-shares/open/${dimensions.body.token}`);
  assert.equal(dimensionsOpen.body.dimensions.market_total, 12);
  assert.equal(dimensionsOpen.body.hides, 'The raw inputs, notes, and who scored it.');
});

test('unknown, expired, used-up, revoked and wrong-account tokens are the same 404', async () => {
  const db = fixture();
  await official(db, 1, 82, '2026-10-01 12:00:00');
  const created = await call(db, OWNER, 'POST', '/lab-report-shares', { ...BODY, open_limit: 1 });
  const token = created.body.token;
  assert.deepEqual(await call(db, null, 'GET', `/lab-report-shares/open/${token}`), { status: 401, body: { error: 'unhandled', message: 'Unauthorized' } });
  assert.deepEqual(await call(db, OTHER, 'GET', `/lab-report-shares/open/${token}`), { status: 404, body: GONE });
  assert.equal((db.prepare('SELECT opens FROM lab_report_shares').get() as any).opens, 0, 'a refused open was counted');
  const opened = await call(db, NAMED, 'GET', `/lab-report-shares/open/${token}`);
  assert.equal(opened.status, 200);
  assert.deepEqual(await call(db, NAMED, 'GET', `/lab-report-shares/open/${token}`), { status: 404, body: GONE });
  const second = await call(db, OWNER, 'POST', '/lab-report-shares', BODY);
  assert.equal(second.status, 201, JSON.stringify(second.body));
  db.prepare(`UPDATE lab_report_shares SET expires_at = '2000-01-01 00:00:00' WHERE id = ?`).run(second.body.id);
  assert.deepEqual(await call(db, NAMED, 'GET', `/lab-report-shares/open/${second.body.token}`), { status: 404, body: GONE });
  const third = await call(db, OWNER, 'POST', '/lab-report-shares', BODY);
  assert.equal((await call(db, OWNER, 'POST', `/lab-report-shares/${third.body.id}/revoke`)).status, 200);
  assert.deepEqual(await call(db, NAMED, 'GET', `/lab-report-shares/open/${third.body.token}`), { status: 404, body: GONE });
  assert.deepEqual(await call(db, NAMED, 'GET', '/lab-report-shares/open/not-a-token'), { status: 404, body: GONE });
  assert.equal((await call(db, OTHER, 'POST', `/lab-report-shares/${third.body.id}/revoke`)).status, 404);
});

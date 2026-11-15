/**
 * D6181 (#6181) — `GET /api/dd/cases?subject_id=`: one subject's cases, exactly, under the same reader scope.
 *
 * The filter sits in the shared CASE_FILTER_SQL, so the count and the rows read the same predicate with the
 * bind in the same position. A caller with 201+ cases still gets the one on this company; a case the caller
 * may not read is never returned; a malformed subject_id is a 400, never widened to every case.
 *
 * Harness: the real router over SQLite built from the production baseline plus the dd migrations, a signed
 * JWT per caller, and the app's error mapping. Every value is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/dd_case_subject_filter_6181.test.ts
 *
 * Mutation checked (each fails a test below):
 *   - the `AND (? IS NULL OR c.subject_id = ?)` clause removed from CASE_FILTER_SQL, with its two binds → every
 *     case comes back and the count is 251;
 *   - the clause compared to `c.id` instead of `c.subject_id` → the wrong case (or none) comes back;
 *   - the two `subjectId` binds moved after `status` in caseFilterBinds → the binds shift and nothing matches;
 *   - the 400 for a malformed subject_id dropped → `?subject_id=abc` lists every case the caller reads;
 *   - the reader-scope clause's `everyone` forced to 1 → the partner reads the case they have no part in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import dd from '../src/routes/dd.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'd6181-unit-test-secret-0123456789-abcdef';
const ADMIN = 2, LEAD = 3, OTHER = 4;
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const baseline = read('../sql/schema_baseline.sql').replace(/--[^\n]*/g, '');
const TABLES = ['users', 'super_admins', 'projects', 'founders', 'deals', 'deal_invitations', 'commitments', 'dd_cases', 'dd_sections',
  'dd_findings', 'dd_reviewers', 'dd_checklist_items', 'dd_requests'];

/**
 * LEAD owns 250 cases on companies 1000..1249 (newer) and two on company 10: one live, one archived (oldest).
 * OTHER owns one more live case on company 10, which LEAD may not read.
 */
function world() {
  const { DB, db } = makeD1('');
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(baseline, t)));
  for (const m of ['339_dd_section_signoff', '620_dd_case_lifecycle', '622_dd_documents_due_reminders', '623_dd_team_templates']) db.exec(read(`../sql/migrations/${m}.sql`));
  const u = db.prepare("INSERT INTO users (id, email, name, role, is_active, kyc_status) VALUES (?, ?, ?, ?, 1, 'not_started')");
  for (const [id, role, name] of [[ADMIN, 'admin', 'Ada Admin'], [LEAD, 'partner', 'Lee Lead'], [OTHER, 'partner', 'Ola Other']] as const) {
    u.run(id, `synthetic${id}@example.test`, name, role);
  }
  db.exec("INSERT INTO projects (id, name) VALUES (10, 'Company Alpha'), (11, 'Company Beta')");
  const c = db.prepare(`INSERT INTO dd_cases (uid, subject_type, subject_id, subject_label, owner_user_id, lead_user_id, status, created_at, updated_at, template_depth)
    VALUES (?, 'project', ?, ?, ?, ?, ?, ?, ?, 'standard')`);
  c.run('alpha-archived', 10, 'Company Alpha', LEAD, LEAD, 'archived', '2025-01-01 09:00:00', '2025-01-01 09:00:00');
  c.run('alpha-live', 10, 'Company Alpha', LEAD, LEAD, 'open', '2025-02-01 09:00:00', '2025-02-01 09:00:00');
  c.run('alpha-other', 10, 'Company Alpha', OTHER, OTHER, 'open', '2025-03-01 09:00:00', '2025-03-01 09:00:00');
  for (let i = 0; i < 250; i += 1) {
    const at = `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')} 10:${String(i % 60).padStart(2, '0')}:00`;
    c.run(`filler-${i}`, 1000 + i, `Company ${i}`, LEAD, LEAD, 'open', at, at);
  }
  return { db, env: { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}

const app = new Hono();
app.onError((err: any, c: any) => {
  const msg = String(err?.message || '');
  const status = (AUTH_ERROR_STATUSES as any)[msg] ?? (msg.startsWith('Forbidden') || /required/.test(msg) ? 403 : 500);
  if (status === 500) console.error('[test] unhandled:', err);
  return c.json({ detail: msg }, status);
});
app.route('/api/dd', dd);

async function call(w: any, who: number, path: string) {
  const role = w.db.prepare('SELECT role FROM users WHERE id = ?').get(who).role;
  const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/api/dd${path}`, { headers: { Authorization: `Bearer ${token}` } }, w.env, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const uids = (r: any) => r.body.items.map((x: any) => x.uid);

test('with 252 cases of their own, the caller still gets this company\'s cases exactly, and the count matches', async () => {
  const w = world();
  const all = await call(w, LEAD, '/cases?subject_type=project');
  assert.equal(all.status, 200);
  assert.deepEqual([all.body.total, all.body.items.length], [252, 200], 'without the filter the newest 200 of 252');
  assert.ok(!uids(all).some((u: string) => u.startsWith('alpha-')), 'this company\'s cases are past the first page');

  const alpha = await call(w, LEAD, '/cases?subject_type=project&subject_id=10');
  assert.equal(alpha.status, 200);
  assert.deepEqual(uids(alpha), ['alpha-live', 'alpha-archived'], 'only company 10\'s cases the caller reads, newest first');
  assert.equal(alpha.body.total, 2, 'the count reads the same predicate as the rows');
  assert.ok(alpha.body.items.every((x: any) => x.subject_type === 'project' && Number(x.subject_id) === 10));

  const beta = await call(w, LEAD, '/cases?subject_type=project&subject_id=11');
  assert.deepEqual([beta.body.total, uids(beta)], [0, []], 'a company with no case is an empty list, not every case');

  // Paging inside the filter keeps the same total.
  const p2 = await call(w, LEAD, '/cases?subject_type=project&subject_id=10&page_size=1&page=2');
  assert.deepEqual([p2.body.total, uids(p2)], [2, ['alpha-archived']]);
  // The filter composes with the others: the same company, live only.
  assert.deepEqual(uids(await call(w, LEAD, '/cases?subject_type=project&subject_id=10&status=open')), ['alpha-live']);
});

test('the reader scope holds: a case on this company the caller may not read is not returned', async () => {
  const w = world();
  const lead = await call(w, LEAD, '/cases?subject_type=project&subject_id=10');
  assert.ok(!uids(lead).includes('alpha-other'), 'another partner\'s case is not listed');
  const other = await call(w, OTHER, '/cases?subject_type=project&subject_id=10');
  assert.deepEqual([other.body.total, uids(other)], [1, ['alpha-other']], 'each partner reads only their own case on the company');
  const admin = await call(w, ADMIN, '/cases?subject_type=project&subject_id=10');
  assert.deepEqual([admin.body.total, uids(admin)], [3, ['alpha-other', 'alpha-live', 'alpha-archived']], 'an Admin reads every case on it');
  const adminOwn = await call(w, ADMIN, '/cases?subject_type=project&subject_id=10&owner_only=1');
  assert.deepEqual([adminOwn.body.total, uids(adminOwn)], [0, []], 'owner_only still narrows an Admin to their own');
});

test('a malformed subject_id is refused, never widened to every case; absent or empty is no filter', async () => {
  const w = world();
  for (const bad of ['abc', '0', '-1', '1.5', '10abc', '1e3', '99999999999999999999']) {
    const r = await call(w, LEAD, `/cases?subject_type=project&subject_id=${encodeURIComponent(bad)}`);
    assert.equal(r.status, 400, `subject_id=${bad}`);
    assert.equal(r.body.code, 'invalid_subject_id');
  }
  assert.equal((await call(w, LEAD, '/cases?subject_type=project&subject_id=')).body.total, 252, 'empty is no filter');
  // The overview reads the same predicate with no query: its binds still line up.
  const ov = await call(w, ADMIN, '/overview');
  assert.equal(ov.status, 200);
  assert.equal(ov.body.stages.open, 252);
});

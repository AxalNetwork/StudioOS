/**
 * #2181 (D691 follow-up) — a role's compensation band on the public jobs
 * board, only when its founder switches it on (`job_postings.comp_public`,
 * migration 507). Every band saved before the switch was saved for the record
 * only, so the switch is off by default. Real SQLite: the production baseline
 * plus every numbered migration above BASELINE_CUTOFF, as
 * `grow_writes_d691.test.ts` builds it. Every venture and amount is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/job_comp_public_2181.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow from '../src/routes/cycle_grow.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import jobsPublic from '../src/routes/jobs_public.ts';
import { publicCompensation } from '../src/services/jobBoardCommon.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const M507 = '507_job_postings_comp_public.sql';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1; const PA = 7;

const newer = readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n)).filter((n) => migrationNumber(n) > BASELINE_CUTOFF).sort();

function build(upTo?: string): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of newer) {
    if (upTo && name >= upTo) break;
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  return db;
}

function fixture() {
  const db = build();
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES (${FOUNDER}, 'founder@example.test', 'Fay Founder', 'founder', 10);
    INSERT INTO projects (id, name, founder_id) VALUES (${PA}, 'Kestrel Labs', 10);`);
  // Production: the migrations own the schema, so the public route runs no DDL.
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'production', DB: d1Over(db) } as any };
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
app.route('/api/cycles', createCycleRecords());
app.route('/api/public', jobsPublic);

async function call(f: { env: any }, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), f.env, { waitUntil() {}, passThroughOnException() {} } as any);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`); }
}
const grow = (f: any, method: string, path: string, body: Record<string, unknown> = {}) => call(f, method, `/api/cycles/grow${path}`, { project: PA, ...body });
const one = (f: any, sql: string, ...args: any[]) => ({ ...(f.db.prepare(sql).get(...args) as any) });
/** The admin's publish, as the review queue does it. */
const publish = (f: any, id: number) => f.db.prepare("UPDATE job_postings SET status = 'published', admin_published = 1 WHERE id = ?").run(id);
const slugOf = (f: any, id: number) => one(f, 'SELECT slug FROM job_postings WHERE id = ?', id).slug as string;
const BAND = { comp_min_cents: 9_000_000, comp_max_cents: 12_000_000, equity_pct: 0.5 };

test('migration 507 adds comp_public, off by default, to a column nothing had before', () => {
  const before = build(M507);
  assert.ok(!(before.prepare('PRAGMA table_info(job_postings)').all() as any[]).some((c) => c.name === 'comp_public'), 'no earlier migration has it');
  assert.ok(!readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8').includes('comp_public'), 'nor the baseline');
  before.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'F', 'f@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES (1, 'u@example.test', 'U', 'founder', 10);
    INSERT INTO job_postings (slug, host_user_id, title, comp_min_cents) VALUES ('old-role', 1, 'Old role', 100);`);
  before.exec(readFileSync(resolve(M, M507), 'utf8'));
  assert.equal(({ ...(before.prepare("SELECT comp_public FROM job_postings WHERE slug = 'old-role'").get() as any) }).comp_public, 0, 'an existing band stays off the board');
  assert.throws(() => before.exec("UPDATE job_postings SET comp_public = 2 WHERE slug = 'old-role'"), /CHECK/);
});

test('the public read returns the band only for a published posting whose switch is on; otherwise no key at all', async () => {
  // Mutation checked: drop the comp_public check in publicCompensation → the switched-off posting leaks its band.
  const f = fixture();
  const off = await grow(f, 'POST', '/roles', { title: 'Staff engineer', ...BAND });
  const on = await grow(f, 'POST', '/roles', { title: 'Head of design', ...BAND, comp_public: 1 });
  assert.deepEqual([off.status, on.status], [201, 201], JSON.stringify([off.body, on.body]));
  assert.equal(one(f, 'SELECT comp_public FROM job_postings WHERE id = ?', off.body.id).comp_public, 0, 'off unless the founder turns it on');
  assert.equal(one(f, 'SELECT comp_public FROM job_postings WHERE id = ?', on.body.id).comp_public, 1);

  // A draft with the switch on is not public at all.
  assert.equal((await call(f, 'GET', `/api/public/jobs/${slugOf(f, on.body.id)}`)).status, 404);
  const draft = one(f, 'SELECT * FROM job_postings WHERE id = ?', on.body.id);
  assert.equal(publicCompensation(draft), null, 'a draft has no public band');
  // Mutation checked: drop the status check → a draft marked admin-published would show its band.
  assert.equal(publicCompensation({ ...draft, admin_published: 1 }), null, 'only a published posting, whatever else it carries');

  publish(f, off.body.id); publish(f, on.body.id);
  const hidden = await call(f, 'GET', `/api/public/jobs/${slugOf(f, off.body.id)}`);
  assert.equal(hidden.status, 200);
  assert.equal('compensation' in hidden.body.job, false, 'switch off: the key is absent, never null');
  assert.equal(JSON.stringify(hidden.body).includes('9000000'), false, 'and no amount anywhere in the body');
  const shown = await call(f, 'GET', `/api/public/jobs/${slugOf(f, on.body.id)}`);
  assert.deepEqual(shown.body.job.compensation, { min_cents: 9_000_000, max_cents: 12_000_000, currency: 'usd', equity_pct: 0.5 });
  // The feed is unchanged: it never carries a band.
  const feed = await call(f, 'GET', '/api/public/jobs');
  assert.ok(feed.body.jobs.every((j: any) => !('compensation' in j)));
});

test('comp_public: 1 with no band answers 400 on Open a role and on Edit, and writes nothing', async () => {
  // Mutation checked: drop the refusal → 201 with a switch on and no band.
  const f = fixture();
  const bare = await grow(f, 'POST', '/roles', { title: 'Ops lead', comp_public: 1 });
  assert.equal(bare.status, 400);
  assert.equal(bare.body.field ?? bare.body.detail?.field, 'comp_public', JSON.stringify(bare.body));
  assert.equal(one(f, "SELECT COUNT(*) AS n FROM job_postings WHERE title = 'Ops lead'").n, 0);
  assert.equal((await grow(f, 'POST', '/roles', { title: 'Odd', ...BAND, comp_public: 'yes' })).status, 400, 'a switch is 1 or 0');

  const r = await grow(f, 'POST', '/roles', { title: 'Data lead' });
  const refused = await grow(f, 'PATCH', `/roles/${r.body.id}`, { comp_public: 1 });
  assert.equal(refused.status, 400);
  assert.equal(one(f, 'SELECT comp_public FROM job_postings WHERE id = ?', r.body.id).comp_public, 0);

  // Edit turns it on with a band, and off again; clearing the band turns it off.
  assert.equal((await grow(f, 'PATCH', `/roles/${r.body.id}`, { ...BAND, comp_public: 1 })).status, 200);
  assert.equal(one(f, 'SELECT comp_public FROM job_postings WHERE id = ?', r.body.id).comp_public, 1);
  assert.equal((await grow(f, 'PATCH', `/roles/${r.body.id}`, { team: 'Data' })).status, 200);
  assert.equal(one(f, 'SELECT comp_public FROM job_postings WHERE id = ?', r.body.id).comp_public, 1, 'an Edit that does not send it keeps it');
  assert.equal((await grow(f, 'PATCH', `/roles/${r.body.id}`, { comp_min_cents: null, comp_max_cents: null })).status, 200);
  assert.equal(one(f, 'SELECT comp_public FROM job_postings WHERE id = ?', r.body.id).comp_public, 0, 'no band, nothing to show');
});

test('the record\'s Edit draws the switch only once the role has a band, and saves it', async () => {
  const f = fixture();
  const none = await grow(f, 'POST', '/roles', { title: 'Writer' });
  const banded = await grow(f, 'POST', '/roles', { title: 'Seller', ...BAND });
  const fieldsOf = async (id: number) => {
    const r = await call(f, 'GET', `/api/cycles/grow/modules/team-expansion/records/${id}?project=${PA}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.actions.find((a: any) => a.key === 'edit').form.fields.map((x: any) => x.key) as string[];
  };
  assert.equal((await fieldsOf(none.body.id)).includes('comp_public'), false);
  assert.ok((await fieldsOf(banded.body.id)).includes('comp_public'));
  const act = (id: number, body: unknown) => call(f, 'POST', `/api/cycles/grow/modules/team-expansion/records/${id}/actions/edit?project=${PA}`, body);
  assert.equal((await act(banded.body.id, { title: 'Seller', comp_public: ['1'] })).status, 200);
  assert.equal(one(f, 'SELECT comp_public FROM job_postings WHERE id = ?', banded.body.id).comp_public, 1);
  assert.equal((await act(banded.body.id, { title: 'Seller', comp_public: [] })).status, 200, 'unchecked turns it off');
  assert.equal(one(f, 'SELECT comp_public FROM job_postings WHERE id = ?', banded.body.id).comp_public, 0);
});

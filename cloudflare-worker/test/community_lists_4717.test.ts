/**
 * #4717 package 4 — the Jobs and Circles lightboxes are server-paged.
 *
 *   1. One page (25 by default, 100 at most) and the total that matched,
 *      whatever the dataset's size; every row once across the pages.
 *   2. Search, filters and sorts run in SQL; LIKE's own characters are
 *      searched for; a value the read cannot take is a 400.
 *   3. Days open sorts the longest-open published posting first and a
 *      posting not open, or approved before 609, last (D1121).
 *   4. Admins only; no host, applicant or member leaves the read.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/community_lists_4717.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminCommunityRoute from '../src/routes/admin_community.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SQL = resolve(process.cwd(), 'cloudflare-worker/sql');
const BASELINE = readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const i = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(i >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(i, BASELINE.indexOf(');', i) + 2);
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return api;
    },
  };
}

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 901;
const MEMBER = 903;
const SENIORITY = ['junior', 'mid', 'senior'];
const STATUS = ['published', 'pending_review', 'draft', 'closed', 'rejected'];
const TYPES = ['founder', 'investor', 'partner', 'advisor', 'city', 'topic'];

/** 260 postings and 130 circles: far past any one page. */
function seeded() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'user_sessions', 'projects', 'job_postings', 'job_applications', 'circles']) db.exec(ddl(t));
  db.exec(readFileSync(resolve(SQL, 'migrations/550_job_postings_submitted_at.sql'), 'utf8'));
  db.exec(readFileSync(resolve(SQL, 'migrations/609_job_postings_published_at.sql'), 'utf8'));
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(1, 'founder', 'Host Private', 'host@secret.example');
  u.run(ADMIN, 'admin', 'Admin Private', 'admin@secret.example');
  u.run(MEMBER, 'founder', 'Member Private', 'member@secret.example');
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const id of [ADMIN, MEMBER]) ss.run(id, `j-${id}`);
  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(10, 'Acme_Robotics');
  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(11, 'Bluefern Health');
  const p = db.prepare(`INSERT INTO job_postings (id, slug, host_user_id, project_id, title, status, remote, seniority, created_at, published_at)
                        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`);
  const a = db.prepare('INSERT INTO job_applications (posting_id, user_id, name, email, created_at) VALUES (?, NULL, ?, ?, ?)');
  for (let i = 1; i <= 260; i += 1) {
    const status = STATUS[i % 5];
    // Published postings approved on day i; every seventh before 609 (no day recorded).
    const published = status === 'published' && i % 7 !== 0 ? `2026-0${1 + (i % 9)}-${String(1 + (i % 27)).padStart(2, '0')} 10:00:00` : null;
    p.run(i, `p-${i}`, i % 2 ? 10 : 11, `Role ${String(i).padStart(3, '0')}`, status, i % 3 === 0 ? 1 : 0, SENIORITY[i % 3],
      `2026-01-01 00:${String(i % 60).padStart(2, '0')}:00`, published);
    for (let k = 0; k < i % 6; k += 1) a.run(i, 'Applicant Private', `applicant${k}@secret.example`, '2026-10-01 10:00:00');
  }
  const c = db.prepare('INSERT INTO circles (slug, name, type, access, members, featured, published, activity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 1; i <= 130; i += 1) {
    c.run(`c-${i}`, `Circle ${String(i).padStart(3, '0')}${i === 42 ? ' 100%' : ''}`, TYPES[i % 6], i % 4 ? 'public' : 'private', (i * 37) % 500, i % 5 === 0 ? 1 : 0, i % 3 ? 1 : 0, 'active');
  }
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/community', adminCommunityRoute);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

async function get(db: InstanceType<typeof DatabaseSync>, path: string, as = ADMIN) {
  const t = await new SignJWT({ user_id: as, role: as === MEMBER ? 'founder' : 'admin', jti: `j-${as}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/admin/community${path}`, { headers: { Authorization: `Bearer ${t}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);
  return { status: res.status, body: await res.json() as any };
}

async function all(db: InstanceType<typeof DatabaseSync>, path: string, key = 'id') {
  const ids: number[] = [];
  let total = -1;
  for (let offset = 0; offset < 1000; offset += 25) {
    const r = await get(db, `${path}${path.includes('?') ? '&' : '?'}offset=${offset}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    total = r.body.total;
    ids.push(...r.body.rows.map((x: any) => x[key]));
    if (offset + 25 >= total) break;
  }
  return { ids, total };
}

test('#4717 jobs: one page of 25 and the total, every posting once across the pages, in one stable order', async () => {
  const db = seeded();
  const first = await get(db, '/jobs');
  assert.equal(first.status, 200);
  assert.equal(first.body.rows.length, 25);
  assert.equal(first.body.total, 260);
  assert.equal((await get(db, '/jobs?limit=500')).body.rows.length, 100, 'a page is never more than 100');
  for (const sort of ['applications', 'created', 'days_open', 'title']) {
    const { ids, total } = await all(db, `/jobs?sort=${sort}`);
    assert.equal(total, 260);
    assert.equal(new Set(ids).size, 260, `${sort}: a posting appeared twice or not at all`);
  }
  // Applications, most first: every row has a count, never undefined.
  const apps = first.body.rows.map((r: any) => r.application_count);
  assert.deepEqual(apps, [...apps].sort((x: number, y: number) => y - x));
});

test('#4717 jobs: filters and search run in SQL, before the page, and the total counts the matches', async () => {
  const db = seeded();
  const pub = await get(db, '/jobs?status=published');
  assert.equal(pub.body.total, 52);
  assert.ok(pub.body.rows.every((r: any) => r.status === 'published'));
  assert.equal((await get(db, '/jobs?place=remote')).body.total, 86);
  assert.ok((await get(db, '/jobs?place=onsite')).body.rows.every((r: any) => r.remote === false));
  assert.equal((await get(db, '/jobs?seniority=senior&status=draft')).body.rows.every((r: any) => r.seniority === 'senior' && r.status === 'draft'), true);
  assert.deepEqual((await get(db, '/jobs?q=Role%20007')).body.rows.map((r: any) => r.id), [7]);
  // A company search, with LIKE's own underscore searched for rather than obeyed.
  assert.equal((await get(db, '/jobs?q=Acme_Rob')).body.total, 130);
  assert.equal((await get(db, '/jobs?q=Acme%25Rob')).body.total, 0);
  for (const bad of ['status=archived', 'place=moon', 'sort=random', 'seniority=Senior%20Lead']) {
    const r = await get(db, `/jobs?${bad}`);
    assert.equal(r.status, 400, bad);
    assert.match(r.body.error, /^bad_/);
  }
});

test('#4717 jobs: days open puts the longest-open published posting first and the not-open and not-recorded last (D1121)', async () => {
  const db = seeded();
  const { ids } = await all(db, '/jobs?sort=days_open');
  const rows = db.prepare('SELECT id, status, published_at FROM job_postings').all() as any[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const open = ids.filter((id) => byId.get(id).status === 'published' && byId.get(id).published_at);
  // Mutation checked: sort published_at DESC → the oldest approval is no longer first.
  assert.deepEqual(ids.slice(0, open.length), open, 'an open posting sorted after one that is not');
  const days = open.map((id) => byId.get(id).published_at);
  assert.deepEqual(days, [...days].sort(), 'the longest open first');
});

test('#4717 circles: one page and the total; filters, sort by members as entered, search with LIKE characters', async () => {
  const db = seeded();
  const first = await get(db, '/circles');
  assert.equal(first.body.rows.length, 25);
  assert.equal(first.body.total, 130);
  for (const sort of ['name', 'members']) {
    const { ids, total } = await all(db, `/circles?sort=${sort}`);
    assert.equal(total, 130);
    assert.equal(new Set(ids).size, 130, `${sort}: a circle appeared twice or not at all`);
  }
  const members = (await get(db, '/circles?sort=members')).body.rows.map((r: any) => r.members);
  assert.deepEqual(members, [...members].sort((x: number, y: number) => y - x));
  const f = await get(db, '/circles?type=city&access=private&published=yes');
  assert.ok(f.body.rows.every((r: any) => r.type === 'city' && r.access === 'private' && r.published === true));
  assert.equal(f.body.total, f.body.rows.length);
  assert.equal((await get(db, '/circles?featured=yes')).body.total, 26);
  assert.deepEqual((await get(db, '/circles?q=100%25')).body.rows.map((r: any) => r.name), ['Circle 042 100%'], 'a literal % is searched for');
  for (const bad of ['type=club', 'access=secret', 'published=maybe', 'sort=newest']) {
    assert.equal((await get(db, `/circles?${bad}`)).status, 400, bad);
  }
});

test('#4717 admins only, and no person leaves the read', async () => {
  const db = seeded();
  assert.equal((await get(db, '/jobs', MEMBER)).status, 403);
  assert.equal((await get(db, '/circles', MEMBER)).status, 403);
  for (const path of ['/jobs?limit=100', '/circles?limit=100']) {
    const text = JSON.stringify((await get(db, path)).body);
    assert.doesNotMatch(text, /Private|secret|host_user_id|email/, `${path} carried a person`);
  }
});

/**
 * The founder's co-marketing read — `GET /api/comarketing/founder/by-project/:pid`.
 *
 * THE BUG. The founder's Grow desk (`/grow`), Launch and Partnerships pages read
 * `/api/comarketing/me/pitches` and `/me/attributions`. Those are the PARTNER
 * side: `requirePartnerProfile` refuses anyone who is not a partner, so every
 * founder got 403 and every one of those pages showed "Some selected-project
 * sources are unavailable" on every load. Retry could not clear it.
 *
 * WHAT THIS PINS, on node:sqlite over the real schema:
 *   1. The partner routes still refuse a founder (so the pages must not use them).
 *   2. The founder route answers the project's own founder with the pitches and
 *      attributions recorded against THAT project, and nothing from another.
 *   3. It never returns a lead's email, the referrer, landing path or notes,
 *      nor the partner's personal name or email.
 *   4. A project that is not the caller's is the same 404 as one that does not
 *      exist — for another founder, a partner, and a founder whose active
 *      company does not own it. An admin reads it.
 *   5. A result past the ceiling says it stopped.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/comarketing_founder_read.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import comarketing, { FOUNDER_ATTRIBUTIONS_CAP } from '../src/routes/comarketing.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FAY = 1;      // founder of project 77
const GUS = 2;      // founder of project 88
const PIA = 3;      // partner
const ADA = 4;      // admin
const ROLE: Record<number, string> = { [FAY]: 'founder', [GUS]: 'founder', [PIA]: 'partner', [ADA]: 'admin' };

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'projects', 'partners', 'comarketing_pitches', 'comarketing_attributions', 'user_company_links']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  const u = db.prepare('INSERT INTO users (id, email, role, name, founder_id, partner_id) VALUES (?,?,?,?,?,?)');
  u.run(FAY, 'fay@axal.example', 'founder', 'Fay Founder', 50, null);
  u.run(GUS, 'gus@axal.example', 'founder', 'Gus Founder', 60, null);
  u.run(PIA, 'pia@agency.example', 'partner', 'Pia Partner', null, 7);
  u.run(ADA, 'ada@axal.example', 'admin', 'Ada Admin', null, null);
  db.prepare('INSERT INTO projects (id, name, founder_id, company_id) VALUES (?,?,?,?)').run(77, 'DeFi Scoring', 50, 500);
  db.prepare('INSERT INTO projects (id, name, founder_id, company_id) VALUES (?,?,?,?)').run(88, 'Other Startup', 60, null);
  db.prepare(`INSERT INTO partners (id, name, company, email) VALUES (7, 'Pia Partner', 'Loud Agency', 'pia@agency.example')`).run();
  const p = db.prepare(`INSERT INTO comarketing_pitches (id, uid, partner_id, submitter_user_id, title, summary, asset_type, status, published_url, created_at, updated_at)
                        VALUES (?,?,7,?,?,?,?,?,?,?,?)`);
  p.run(1, 'pitch-a', PIA, 'Webinar with DeFi Scoring', 'A summary', 'webinar', 'published', 'https://agency.example/w', '2026-09-01', '2026-09-01');
  p.run(2, 'pitch-b', PIA, 'Other founder campaign', 'B summary', 'blog', 'published', null, '2026-09-02', '2026-09-02');
  p.run(3, 'pitch-c', PIA, 'Never tracked', 'C summary', 'podcast', 'approved', null, '2026-09-03', '2026-09-03');
  const a = db.prepare(`INSERT INTO comarketing_attributions (uid, pitch_id, partner_id, event_kind, project_id, lead_email, referrer, landing_path, notes, created_at)
                        VALUES (?,?,7,?,?,?,?,?,?,?)`);
  a.run('a1', 1, 'visit', 77, 'lead-one@synthetic.example', 'https://ref.example/x', '/l/defi', 'private note', '2026-09-10T10:00:00Z');
  a.run('a2', 1, 'signup', 77, 'lead-two@synthetic.example', null, null, null, '2026-09-11T10:00:00Z');
  a.run('a3', 2, 'lead', 88, 'lead-three@synthetic.example', null, null, null, '2026-09-12T10:00:00Z');
  // The same pitch reaching another founder's startup: it must not add to this
  // project's count, nor appear in this project's attributions.
  a.run('a4', 1, 'visit', 88, 'lead-four@synthetic.example', null, null, null, '2026-09-13T10:00:00Z');
  return db;
}

async function call(db: InstanceType<typeof DatabaseSync>, as: number, path: string, headers: Record<string, string> = {}) {
  const app = new Hono<any>();
  app.route('/api/comarketing', comarketing);
  app.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  const token = await new SignJWT({ user_id: as, role: ROLE[as] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/comarketing${path}`, { headers: { Authorization: `Bearer ${token}`, ...headers } },
    { DB: makeD1(db), JWT_SECRET } as any);
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* the status says it */ }
  return { status: res.status, body, text };
}

test('the partner-side reads refuse a founder — which is why the Grow pages must not call them', async () => {
  const db = freshDb();
  for (const path of ['/me/pitches', '/me/attributions']) {
    const r = await call(db, FAY, path);
    assert.equal(r.status, 403, `${path} answered a founder: ${r.text}`);
  }
});

test('the founder reads their own project: its pitches and attributions, and nothing from another project', async () => {
  const r = await call(freshDb(), FAY, '/founder/by-project/77');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.project_id, 77);
  assert.equal(r.body.complete, true);
  assert.deepEqual(r.body.attributions.map((x: any) => [x.uid, x.event_kind, x.pitch_id, x.project_id]),
    [['a2', 'signup', 1, 77], ['a1', 'visit', 1, 77]], 'newest first, this project only');
  assert.deepEqual(r.body.pitches.map((p: any) => p.uid), ['pitch-a'],
    'a pitch with no attribution on this project, or one on another project, was listed');
  const p = r.body.pitches[0];
  assert.equal(p.title, 'Webinar with DeFi Scoring');
  assert.equal(p.status, 'published');
  assert.equal(p.partner_company, 'Loud Agency');
  assert.equal(p.project_id, 77, 'the pitch carries the project it was read for, so the pages can link it');
  assert.equal(p.attribution_count, 2, 'the count took in the same pitch\'s attributions on another project');
});

test('no lead email, referrer, landing path or note, and no partner name or email, leaves the route', async () => {
  const r = await call(freshDb(), FAY, '/founder/by-project/77');
  for (const a of r.body.attributions) {
    assert.deepEqual(Object.keys(a).sort(), ['created_at', 'event_kind', 'id', 'pitch_id', 'project_id', 'uid']);
  }
  const text = JSON.stringify(r.body);
  for (const leak of ['lead-one@', 'lead-two@', 'ref.example', '/l/defi', 'private note', 'Pia Partner', 'pia@agency', 'A summary']) {
    assert.ok(!text.includes(leak), `the founder read carries ${leak}`);
  }
});

test('a project that is not the caller\'s is the same 404 as one that does not exist', async () => {
  const db = freshDb();
  const missing = await call(db, FAY, '/founder/by-project/999');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'project_not_found');
  for (const [who, label] of [[GUS, 'another founder'], [PIA, 'a partner']] as const) {
    const r = await call(db, who, '/founder/by-project/77');
    assert.equal(r.status, 404, `${label}: ${r.text}`);
    assert.deepEqual(r.body, missing.body, `${label} can tell a real project from a missing one`);
  }
  assert.equal((await call(db, FAY, '/founder/by-project/abc')).status, 404);
  assert.equal((await call(db, ADA, '/founder/by-project/77')).status, 200, 'an admin cannot read it');
});

test('a founder whose active company does not own the project is refused like a stranger', async () => {
  const db = freshDb();
  db.prepare('INSERT INTO user_company_links (uid, user_id, company_id) VALUES (?, ?, ?)').run('ucl-1', FAY, 500);
  db.prepare('INSERT INTO user_company_links (uid, user_id, company_id) VALUES (?, ?, ?)').run('ucl-2', FAY, 600);
  assert.equal((await call(db, FAY, '/founder/by-project/77', { 'X-Company-Id': '500' })).status, 200);
  const other = await call(db, FAY, '/founder/by-project/77', { 'X-Company-Id': '600' });
  assert.equal(other.status, 404, `project 77 belongs to company 500, read under 600: ${other.text}`);
});

test('past the ceiling the result says it stopped', async () => {
  const db = freshDb();
  const a = db.prepare(`INSERT INTO comarketing_attributions (uid, pitch_id, partner_id, event_kind, project_id, created_at) VALUES (?, 1, 7, 'visit', 77, ?)`);
  for (let i = 0; i < FOUNDER_ATTRIBUTIONS_CAP; i += 1) a.run(`bulk-${i}`, `2026-08-01T00:00:${String(i % 60).padStart(2, '0')}Z`);
  const r = await call(db, FAY, '/founder/by-project/77');
  assert.equal(r.body.attributions.length, FOUNDER_ATTRIBUTIONS_CAP);
  assert.equal(r.body.complete, false);
});

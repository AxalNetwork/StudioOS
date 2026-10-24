/**
 * D702 — the founder's profile pages: migration 467, routes/founder_profile.ts,
 * "Let investors find my venture" (services/investorFindable.ts) and the
 * effective profile visibility (services/userSettings.ts).
 *
 * Built on node:sqlite from the whole baseline plus every migration after its
 * cutoff, 467 included, built once and copied per test.
 *
 *   1. Migration 467 adds both columns, nullable, and refuses investor_findable = 2.
 *   2. You (/profile/me): the caller's own data, never users.city.
 *   3. Your venture read: each module row is its module's own export.
 *   4. Your venture write: the seven facts only; search is re-embedded.
 *   5. Gates on every new read and write.
 *   6. The preview is each audience's real read.
 *   7. Findable: NULL is today; 0 hides the venture from investors without an
 *      introduction, in every read that lists or opens it.
 *   8. Visibility: the effective value is enforced on the public reads.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/profile_pages_d702.test.ts
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import founderProfile, { ventureUpdate, figureRows, previewNotes } from '../src/routes/founder_profile.ts';
import profileHistory from '../src/routes/profile_history.ts';
import projects from '../src/routes/projects.ts';
import publicRoutes from '../src/routes/public.ts';
import search from '../src/routes/search.ts';
import privateData from '../src/routes/private-data.ts';
import watchlist from '../src/routes/watchlist.ts';
import follows from '../src/routes/follows.ts';
import settings from '../src/routes/settings.ts';
import ic from '../src/routes/ic.ts';
import journal from '../src/routes/journal.ts';
import dashboard from '../src/routes/dashboard.ts';
import decks from '../src/routes/decks.ts';
import brand from '../src/routes/brand.ts';
import compliance from '../src/routes/compliance.ts';
import { indexCountsOf } from '../src/services/validateFocus.ts';
import { figures as validateFigures } from '../src/services/cycleValidate.ts';
import { growFigures } from '../src/services/growCycle.ts';
import { buildLifecycleResponse } from '../src/routes/progress.ts';
import { effectiveVisibility } from '../src/services/userSettings.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { splitStatements } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const MIGRATION = read('cloudflare-worker/sql/migrations/467_founder_profile_pages.sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

// Accounts. Every name and address is made up.
const ADA = 1;   // admin
const FAY = 2;   // founder of venture 100 (founder_id 10)
const IAN = 3;   // investor, no relationship with venture 100
const PIA = 4;   // partner
const OLI = 5;   // founder of venture 200 (founder_id 11)
const AVA = 6;   // advisor, an accepted advisor member of venture 100
const COL = 7;   // founder role, an accepted co-founder member of venture 100
const NIA = 8;   // investor with an active pairwise NDA with FAY
const IRA = 9;   // investor with an introduction row to venture 100
const DRE = 10;  // investor in a deal room for venture 100
const WES = 11;  // investor who watched venture 100 before the founder chose
const ROLE: Record<number, string> = {
  [ADA]: 'admin', [FAY]: 'founder', [IAN]: 'investor', [PIA]: 'partner', [OLI]: 'founder',
  [AVA]: 'advisor', [COL]: 'founder', [NIA]: 'investor', [IRA]: 'investor', [DRE]: 'investor', [WES]: 'investor',
};
const V = 100;   // "Testventure Labs"
const B = 200;   // another founder's venture

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

// ---------------------------------------------------------------------------
// The fresh build, made once
// ---------------------------------------------------------------------------

let TEMPLATE = '';
function buildWithout467(): InstanceType<typeof DatabaseSync> {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const s of splitStatements(read('cloudflare-worker/sql/schema_baseline.sql'))) {
    try { db.exec(s); } catch { /* the baseline's two lp_investors triggers do not split; unrelated */ }
  }
  const dir = resolve(ROOT, 'cloudflare-worker/sql/migrations');
  for (const f of readdirSync(dir).filter((x) => /^\d+_.*\.sql$/.test(x) && Number(x.split('_')[0]) > 219).sort()) {
    if (f.startsWith('467_')) continue;
    db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  return db;
}
before(() => {
  const db = buildWithout467();
  db.exec(MIGRATION);
  const dir = mkdtempSync(join(tmpdir(), 'd702-'));
  TEMPLATE = join(dir, 'template.db');
  db.exec(`VACUUM INTO '${TEMPLATE}'`);
  db.close();
});
// The template and its copies come to about 0.5 GB per run; left behind, a few
// full suites fill the disk.
after(() => rmSync(dirname(TEMPLATE), { recursive: true, force: true }));

let copies = 0;
function freshDb() {
  const path = join(dirname(TEMPLATE), `copy-${copies++}.db`);
  copyFileSync(TEMPLATE, path);
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  const u = db.prepare(`INSERT INTO users (id, uid, email, role, name, founder_id, is_active, city, bio, socials, profile_completion_pct)
                        VALUES (?,?,?,?,?,?,1,?,?,?,?)`);
  u.run(ADA, 'ada-admin', 'ada@example.test', 'admin', 'Ada Admin', null, null, null, null, 90);
  u.run(FAY, 'sam-example', 'sam@example.test', 'founder', 'Sam Example', 10, 'Kycville',
    'Builds tools for small labs.', JSON.stringify({ linkedin: 'https://linkedin.example.test/sam', github: null }), 40);
  u.run(IAN, 'ian-investor', 'ian@example.test', 'investor', 'Ian Investor', null, null, null, null, 90);
  u.run(PIA, 'pia-partner', 'pia@example.test', 'partner', 'Pia Partner', null, null, null, null, 90);
  u.run(OLI, 'oli-other', 'oli@example.test', 'founder', 'Oli Other', 11, null, null, null, 90);
  u.run(AVA, 'ava-advisor', 'ava@example.test', 'advisor', 'Ava Advisor', null, null, null, null, 90);
  u.run(COL, 'col-cofounder', 'col@example.test', 'founder', 'Col Cofounder', null, null, null, null, 90);
  u.run(NIA, 'nia-nda', 'nia@example.test', 'investor', 'Nia Nda', null, null, null, null, 90);
  u.run(IRA, 'ira-intro', 'ira@example.test', 'investor', 'Ira Intro', null, null, null, null, 90);
  u.run(DRE, 'dre-dealroom', 'dre@example.test', 'investor', 'Dre Dealroom', null, null, null, null, 90);
  u.run(WES, 'wes-watcher', 'wes@example.test', 'investor', 'Wes Watcher', null, null, null, null, 90);
  db.prepare(`INSERT INTO founders (id, name, email) VALUES (10, 'Sam Example', 'sam@example.test'), (11, 'Oli Other', 'oli@example.test')`).run();
  const p = db.prepare(`INSERT INTO projects (id, uid, name, founder_id, status, sector, stage, description, problem_statement,
                          revenue, users_count, funding_needed, mrr, founded_year, hq, employee_count, website, lifecycle_stage)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  p.run(V, 'testventure', 'Testventure Labs', 10, 'active', 'Climate', 'seed', 'Sensors for small labs.',
    'Small labs cannot afford sensor kits.', 1200, 40, 500000, 900, 2024, 'Sampleton', '4', 'https://testventure.example.test', 'validate');
  p.run(B, 'otherventure', 'Otherventure', 11, 'active', 'Health', 'seed', 'Another venture.',
    null, null, null, null, null, null, null, null, null, null);
  const m = db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (?,?,?,'accepted')`);
  m.run(V, AVA, 'advisor');
  m.run(V, COL, 'cofounder');
  db.prepare(`INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (?, ?, 'active')`).run(FAY, NIA);
  db.prepare(`INSERT INTO investor_introductions (uid, investor_user_id, project_id, quarter) VALUES ('intro-1', ?, ?, '2026Q4')`).run(IRA, V);
  db.prepare(`INSERT INTO deals (id, uid, project_id, status) VALUES (500, 'deal-500', ?, 'active')`).run(V);
  db.prepare(`INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (?, 500)`).run(DRE);
  db.prepare(`INSERT INTO watchlist_items (uid, owner_user_id, project_id, status) VALUES ('w-wes', ?, ?, 'watching')`).run(WES, V);
  return db;
}

function app() {
  const a = new Hono<any>();
  a.route('/api/profile', profileHistory);
  a.route('/api/profile', founderProfile);
  a.route('/api/projects', projects);
  a.route('/api/public', publicRoutes);
  a.route('/api/search', search);
  a.route('/api/private-data', privateData);
  a.route('/api', watchlist);
  a.route('/api/follows', follows);
  a.route('/api/settings', settings);
  a.route('/api/ic', ic);
  a.route('/api/journal', journal);
  a.route('/api/dashboard', dashboard);
  a.route('/api/decks', decks);
  a.route('/api/brand', brand);
  a.route('/api/compliance', compliance);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  return a;
}

/** A stand-in Vectorize + AI pair that returns one hit: venture 100's project vector. */
const searchEnv = {
  AI: { run: async () => ({ data: [new Array(768).fill(0.01)] }) },
  VECTORIZE: {
    query: async () => ({
      matches: [{ id: `project:${V}`, score: 0.9, metadata: { type: 'project', entity_id: V, title: 'Testventure Labs', url: `/projects/${V}`, snippet: 'Small labs cannot afford sensor kits.' } }],
    }),
  },
};

async function call(db: InstanceType<typeof DatabaseSync>, as: number | null, method: string, path: string, payload?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  if (as != null) {
    const token = await new SignJWT({ user_id: as, role: ROLE[as] })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await app().request(path, {
    method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  }, { DB: makeD1(db), JWT_SECRET, ...searchEnv } as any);
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* the status says it */ }
  return { status: res.status, body, text };
}
const get = (db: any, as: number | null, path: string) => call(db, as, 'GET', path);
const findable = (db: any, v: number | null) => db.prepare('UPDATE projects SET investor_findable = ? WHERE id = ?').run(v, V);
const envOf = (db: any) => ({ DB: makeD1(db), JWT_SECRET, ...searchEnv } as any);

/* ------------------------------------------------------------------ *
 * 1 · migration 467                                                   *
 * ------------------------------------------------------------------ */

test('1. migration 467 adds both columns, nullable, stands alone, and refuses investor_findable = 2', () => {
  const sql = MIGRATION.replace(/^\s*--.*$/gm, '');
  assert.ok(!/\bBEGIN\b|\bCOMMIT\b|DROP /i.test(sql), 'the migration carries a transaction or a drop');
  const db = buildWithout467();
  assert.ok(!db.prepare(`PRAGMA table_info(projects)`).all().some((c: any) => c.name === 'investor_findable'),
    'investor_findable already existed before 467');
  db.exec(MIGRATION);
  const col = (t: string, n: string) => db.prepare(`PRAGMA table_info(${t})`).all().find((c: any) => c.name === n) as any;
  assert.ok(col('projects', 'investor_findable'), 'projects.investor_findable is missing');
  assert.equal(col('projects', 'investor_findable').notnull, 0);
  assert.ok(col('user_settings', 'visibility_chosen_at'), 'user_settings.visibility_chosen_at is missing');
  assert.equal(col('user_settings', 'visibility_chosen_at').notnull, 0);
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (1, 'X', 1)`).run();
  assert.throws(() => db.prepare(`UPDATE projects SET investor_findable = 2 WHERE id = 1`).run(), /CHECK/);
  db.prepare(`UPDATE projects SET investor_findable = 0 WHERE id = 1`).run();
  db.prepare(`UPDATE projects SET investor_findable = NULL WHERE id = 1`).run();
  db.close();
});

/* ------------------------------------------------------------------ *
 * 2 · You                                                             *
 * ------------------------------------------------------------------ */

test('2. /profile/me is the caller\'s own, ignores ?user_id, and never reads users.city', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO cofounder_profiles (user_id, looking_for, commitment, location_city, remote_ok) VALUES (?, 'CTO', 'full_time', 'Sampleton', 1)`).run(FAY);
  db.prepare(`INSERT INTO user_profile_ext (user_id, experience, education, website) VALUES (?, ?, ?, NULL)`).run(FAY,
    JSON.stringify([{ title: 'Lab manager', company: 'Example Lab', start: '2019', end: '2023' }]),
    JSON.stringify([{ degree: 'MSc Physics', school: 'Example University', end: '2018-06' }]));
  const r = await get(db, FAY, `/api/profile/me?user_id=${OLI}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.person.name, 'Sam Example', 'the ?user_id was honoured');
  assert.equal(r.body.person.role_line, 'Founder · Sampleton');
  assert.ok(!r.text.includes('Kycville'), 'the KYC city reached the profile');
  assert.equal(r.body.bio, 'Builds tools for small labs.');
  assert.deepEqual(r.body.background.experience, [{ line: 'Lab manager at Example Lab', period: '2019 – 2023' }]);
  assert.deepEqual(r.body.background.education, [{ line: 'MSc Physics, Example University', year: '2018' }]);
  assert.deepEqual(r.body.links.map((l: any) => [l.key, l.url]), [
    ['linkedin', 'https://linkedin.example.test/sam'], ['website', null], ['github', null]]);
  assert.deepEqual(r.body.preferences, { recorded: true, looking_for: 'CTO', commitment: 'full_time', commitment_label: 'Full-time', location: 'Sampleton · remote' });
  assert.equal((await get(db, null, '/api/profile/me')).status, 401);
});

test('2b. without a co-founder profile, preferences are Not recorded with the reason, and the line is "Founder"', async () => {
  const db = freshDb();
  const r = await get(db, FAY, '/api/profile/me');
  assert.deepEqual(r.body.preferences, { recorded: false, reason: 'No co-founder profile yet' });
  assert.equal(r.body.person.role_line, 'Founder');
});

/* ------------------------------------------------------------------ *
 * 3 · Your venture, read                                              *
 * ------------------------------------------------------------------ */

test('3. each module row equals its module\'s own export, and the stage is the lifecycle\'s', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO discovery_interviews (project_id, interviewee_name, stage) VALUES (?, 'Pat Example', 'done'), (?, 'Lee Example', 'booked')`).run(V, V);
  db.prepare(`INSERT INTO metric_targets (project_id, metric_key, target_value) VALUES (?, 'waitlist_target', 50)`).run(V);
  const env = envOf(db);
  const r = await get(db, FAY, `/api/profile/venture?project=${V}`);
  assert.equal(r.status, 200, r.text);
  const row = (k: string) => r.body.modules.find((m: any) => m.key === k);

  assert.equal(row('interviews').value, String((await indexCountsOf(env, V)).interviews_total));
  const today = new Date().toISOString().slice(0, 10);
  const vf = await validateFigures({ env, projectId: V, today });
  const hyp = vf.find((f: any) => f.key === 'hypotheses_supported')!;
  assert.equal(row('hypotheses_supported').value, hyp.value == null ? null : `${hyp.value} ${hyp.unit}`);
  assert.equal(row('hypotheses_supported').reason, hyp.value == null ? hyp.reason : null);
  const wl = vf.find((f: any) => f.key === 'waitlist_signups')!;
  assert.equal(row('waitlist_signups').value, wl.value == null ? null : `${wl.value} of 50`);

  const lc = await buildLifecycleResponse(env, V);
  assert.equal(r.body.card.stage.label, lc.stages.find((s: any) => s.id === lc.stage)!.label);
  assert.equal(r.body.card.stage.label, 'Validate');
  assert.deepEqual(r.body.facts, { founded_year: 2024, hq: 'Sampleton', employee_count: '4', website: 'https://testventure.example.test' });
  assert.equal(r.body.problem_statement, 'Small labs cannot afford sensor kits.');
});

test('3b. MRR is Grow\'s figure: Not recorded with no snapshot, the snapshot\'s value with one', async () => {
  const db = freshDb();
  const mrr = async () => (await get(db, FAY, `/api/profile/venture?project=${V}`)).body.modules.find((m: any) => m.key === 'mrr');
  const none = await mrr();
  assert.equal(none.value, null);
  assert.equal(none.reason, 'Not recorded');
  assert.equal(none.sub, 'Grow · no MRR recorded yet');
  db.prepare(`INSERT INTO project_metrics (project_id, snapshot_date, source, mrr) VALUES (?, '2026-10-01', 'manual', 4200)`).run(V);
  const gf = await growFigures({ env: envOf(db), projectId: V, now: Date.now(), href: () => '' } as any);
  const one = await mrr();
  assert.equal(one.value, String(gf.find((f: any) => f.key === 'mrr')!.value));
  assert.equal(one.value, '4200');
  assert.equal(one.sub, 'Grow · Revenue and traction');
});

/* ------------------------------------------------------------------ *
 * 4 · Your venture, write                                             *
 * ------------------------------------------------------------------ */

test('4. PATCH writes the seven facts, and a changed description re-embeds the venture for search', async () => {
  const db = freshDb();
  const body = {
    description: 'Cheap sensors for small labs.', sector: 'Deep tech', problem_statement: 'Kits cost too much.',
    founded_year: 2023, hq: 'Exampleton', employee_count: '6', website: 'https://new.example.test',
  };
  const r = await call(db, FAY, 'PATCH', `/api/profile/venture?project=${V}`, body);
  assert.equal(r.status, 200, r.text);
  const row: any = db.prepare(`SELECT description, sector, problem_statement, founded_year, hq, employee_count, website FROM projects WHERE id = ?`).get(V);
  assert.deepEqual({ ...row }, body);
  const jobs = db.prepare(`SELECT payload FROM queue_jobs WHERE job_type = 'embed_entity'`).all() as any[];
  assert.ok(jobs.some((j) => JSON.parse(j.payload).id === V), 'no embed_entity job for the venture');
});

test('4b. a fact that does not change search writes no embed job', async () => {
  const db = freshDb();
  const r = await call(db, FAY, 'PATCH', `/api/profile/venture?project=${V}`, { hq: 'Elsewhere' });
  assert.equal(r.status, 200);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM queue_jobs WHERE job_type = 'embed_entity'`).get() as any).n, 0);
});

test('4c. name, status or stage in the body is refused, naming the key, and nothing is written', async () => {
  for (const bad of [{ name: 'Renamed' }, { status: 'archived' }, { stage: 'series_a' }]) {
    const db = freshDb();
    const r = await call(db, FAY, 'PATCH', `/api/profile/venture?project=${V}`, { hq: 'Should not land', ...bad });
    assert.equal(r.status, 400);
    assert.equal(r.body.field, Object.keys(bad)[0]);
    const row: any = db.prepare(`SELECT name, status, stage, hq FROM projects WHERE id = ?`).get(V);
    assert.deepEqual({ ...row }, { name: 'Testventure Labs', status: 'active', stage: 'seed', hq: 'Sampleton' });
  }
});

test('4d. a bad founded year or website is refused', async () => {
  const db = freshDb();
  for (const bad of [{ founded_year: 1899 }, { founded_year: new Date().getUTCFullYear() + 1 }, { founded_year: 'soon' },
    { website: 'ftp://x.example.test' }, { website: 'not a url' }]) {
    const r = await call(db, FAY, 'PATCH', `/api/profile/venture?project=${V}`, bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal(ventureUpdate({ founded_year: 2020 }, 2026).ok, true);
});

/* ------------------------------------------------------------------ *
 * 5 · gates                                                           *
 * ------------------------------------------------------------------ */

test('5. venture read, write and preview: 403 to everyone but the founder and an admin, and nothing is written', async () => {
  const db = freshDb();
  for (const as of [PIA, IAN, AVA, COL, OLI]) {
    for (const [m, path, body] of [
      ['GET', `/api/profile/venture?project=${V}`, undefined],
      ['PATCH', `/api/profile/venture?project=${V}`, { hq: 'Hijacked' }],
      ['GET', `/api/profile/preview?project=${V}&audience=investors`, undefined],
    ] as const) {
      const r = await call(db, as, m, path, body);
      assert.equal(r.status, 403, `${ROLE[as]} ${as} got ${r.status} on ${m} ${path}`);
      assert.ok(r.body.error, 'a refusal without `error`');
    }
  }
  assert.equal((db.prepare(`SELECT hq FROM projects WHERE id = ?`).get(V) as any).hq, 'Sampleton');
  assert.equal((await get(db, ADA, `/api/profile/venture?project=${V}`)).status, 200);
  assert.equal((await get(db, FAY, `/api/profile/venture?project=999`)).status, 404);
  db.prepare(`UPDATE projects SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`).run(B);
  assert.equal((await get(db, OLI, `/api/profile/venture?project=${B}`)).status, 404);
  assert.equal((await get(db, FAY, `/api/profile/preview?project=${V}&audience=lps`)).status, 400);
});

test('5b. the privacy route naming another founder\'s venture is 403 on GET and PUT, and nothing moves', async () => {
  const db = freshDb();
  assert.equal((await get(db, FAY, `/api/settings/privacy?project=${B}`)).status, 403);
  const put = await call(db, FAY, 'PUT', `/api/settings/privacy?project=${B}`, { investor_findable: false, visibility: 'private' });
  assert.equal(put.status, 403);
  assert.equal((db.prepare(`SELECT investor_findable FROM projects WHERE id = ?`).get(B) as any).investor_findable, null);
  assert.equal(db.prepare(`SELECT 1 FROM user_settings WHERE user_id = ?`).get(FAY), undefined, 'the founder\'s own settings were written');
  const loose = await call(db, FAY, 'PUT', '/api/settings/privacy', { investor_findable: false });
  assert.equal(loose.status, 400);
  assert.equal(loose.body.field, 'investor_findable');
  const own = await call(db, FAY, 'PUT', `/api/settings/privacy?project=${V}`, { investor_findable: false });
  assert.equal(own.status, 200);
  assert.equal(own.body.investor_findable, false);
  assert.equal((db.prepare(`SELECT investor_findable FROM projects WHERE id = ?`).get(V) as any).investor_findable, 0);
  assert.equal((await get(db, FAY, `/api/settings/privacy?project=${V}`)).body.investor_findable, false);
});

test('5d. a founder\'s venture outside the company they have selected answers 404 on the venture, the preview and the privacy route', async () => {
  const db = freshDb();
  for (const id of [900, 901]) db.prepare(`INSERT INTO user_company_links (uid, company_id, user_id) VALUES (?, ?, ?)`).run(`link-${id}`, id, FAY);
  db.prepare(`UPDATE projects SET company_id = 900 WHERE id = ?`).run(V);
  const paths = [`/api/profile/venture?project=${V}`, `/api/profile/preview?project=${V}&audience=investors`, `/api/settings/privacy?project=${V}`];
  for (const path of paths) {
    assert.equal((await call(db, FAY, 'GET', path, undefined, { 'X-Company-Id': '900' })).status, 200, `${path} in its own company`);
    assert.equal((await call(db, FAY, 'GET', path)).status, 200, `${path} with no company selected`);
    assert.equal((await call(db, FAY, 'GET', path, undefined, { 'X-Company-Id': '901' })).status, 404, `${path} from the other company`);
    assert.equal((await call(db, ADA, 'GET', path, undefined, { 'X-Company-Id': '901' })).status, 200, `${path} as an admin`);
  }
  const before = db.prepare(`SELECT hq, investor_findable FROM projects WHERE id = ?`).get(V) as any;
  assert.equal((await call(db, FAY, 'PATCH', `/api/profile/venture?project=${V}`, { hq: 'Elsewhere' }, { 'X-Company-Id': '901' })).status, 404);
  assert.equal((await call(db, FAY, 'PUT', `/api/settings/privacy?project=${V}`, { investor_findable: false }, { 'X-Company-Id': '901' })).status, 404);
  assert.deepEqual({ ...(db.prepare(`SELECT hq, investor_findable FROM projects WHERE id = ?`).get(V) as any) }, { ...before });
});

test('5c. GET privacy with a venture reads a never-chosen flag as findable', async () => {
  const db = freshDb();
  const r = await get(db, FAY, `/api/settings/privacy?project=${V}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.investor_findable, true);
});

/* ------------------------------------------------------------------ *
 * 6 · the preview is the real read                                    *
 * ------------------------------------------------------------------ */

const preview = (db: any, audience: string) => get(db, FAY, `/api/profile/preview?project=${V}&audience=${audience}`);
const fig = (p: any, key: string) => p.body.figures.find((f: any) => f.key === key);

test('6. investors: figures and card equal the public startup read and the masked investor read', async () => {
  const db = freshDb();
  const p = await preview(db, 'investors');
  assert.equal(p.status, 200, p.text);
  const startup = await get(db, IAN, '/api/public/startup/testventure');
  const appRead = await get(db, IAN, `/api/projects/${V}`);
  assert.equal(appRead.body.__masked, true);
  assert.equal(fig(p, 'revenue').value, startup.body.traction.revenue);
  assert.equal(fig(p, 'users').value, startup.body.traction.users);
  assert.equal(fig(p, 'raise').value, startup.body.traction.funding_needed);
  assert.equal(fig(p, 'mrr').display, 'masked', 'MRR is masked in the app read and served nowhere else');
  assert.equal(appRead.body.mrr, null);
  assert.equal(p.body.card.venture_name, startup.body.name);
  assert.equal(p.body.card.sector, startup.body.sector);
  assert.ok(!p.body.figures.some((f: any) => f.key === 'interviews'), 'an Interviews row no read serves');
  assert.ok(p.body.notes.includes('Revenue, users and the raise are on your public venture page, for anyone with its address.'));
  assert.ok(p.body.notes.includes('In the app, figures stay masked until an NDA is signed through an introduction.'));
  // The NDA sentence is true: an investor WITH an active pairwise NDA reads them unmasked.
  const nda = await get(db, NIA, `/api/projects/${V}`);
  assert.equal(nda.body.__masked, undefined);
  assert.equal(nda.body.mrr, 900);
  assert.deepEqual(p.body.addresses.profile.url, 'https://axal.vc/u/sam-example');
  assert.deepEqual(p.body.addresses.venture.url, 'https://axal.vc/startups/testventure');
});

test('6b. founders: the app read refuses, so MRR is left out; partners: none until on the team, then every figure (D889)', async () => {
  const db = freshDb();
  const f = await preview(db, 'founders');
  assert.equal((await get(db, OLI, `/api/projects/${V}`)).status, 403);
  assert.equal(fig(f, 'mrr'), undefined, 'a row no founder read serves was drawn');
  assert.equal(fig(f, 'revenue').value, 1200);
  assert.ok(f.body.notes.includes('Other founders cannot open your venture in the app.'));

  // D889 (#2438): a partner with no tie opens nothing, and the preview says so.
  const untied = await preview(db, 'partners');
  assert.equal((await get(db, PIA, `/api/projects/${V}`)).status, 403);
  assert.equal(fig(untied, 'mrr'), undefined);
  assert.ok(untied.body.notes.includes('Partners cannot open your venture in the app unless you add them to its team.'));
  assert.ok(!untied.body.notes.includes('Partners can open your venture in the app and read every figure.'));
  // The preview reads as a partner who matches no row, so it stays the same once one partner joins the team;
  // that partner opens the whole row.
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'cofounder', 'accepted')`).run(V, PIA);
  const whole = await get(db, PIA, `/api/projects/${V}`);
  assert.equal(whole.status, 200);
  assert.equal(whole.body.__masked, undefined);
  assert.deepEqual((await preview(db, 'partners')).body.notes, untied.body.notes);
});

test('6c. intake: the public rows drop out and the note names the status; findable 0: the investor note says so', async () => {
  const db = freshDb();
  db.prepare(`UPDATE projects SET status = 'intake' WHERE id = ?`).run(V);
  const p = await preview(db, 'investors');
  assert.ok(p.body.notes.includes('Your venture page is not public while the venture is in intake.'));
  assert.equal(fig(p, 'revenue').display, 'masked', 'only the masked app read serves revenue now');
  assert.equal(p.body.addresses.venture.served_to, 'no_one');

  db.prepare(`UPDATE projects SET status = 'active' WHERE id = ?`).run(V);
  findable(db, 0);
  const hidden = await preview(db, 'investors');
  assert.ok(hidden.body.notes.includes('Investors without an introduction cannot find your venture in the app.'));
  assert.equal(fig(hidden, 'mrr'), undefined, 'the app read answers 404, so it serves no figure');
});

test('6d. the archetype chip is drawn only while the founder\'s archetype is published', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO profile_snapshots (user_id, persona, engine_version, trigger_kind, displayed_slug, traits_json, skills_json, values_json, axal_values_json, computed_at)
              VALUES (?, 'founder', 'profiling-v2.1', 'answer', 'missionary', '{}', '{}', '{}', '{}', '2026-10-01 00:00:00')`).run(FAY);
  assert.equal((await preview(db, 'investors')).body.card.archetype, null, 'an unpublished archetype was drawn');
  db.prepare(`INSERT INTO profile_archetype_publish (user_id, published) VALUES (?, 1)`).run(FAY);
  for (const a of ['investors', 'founders', 'partners']) {
    assert.equal((await preview(db, a)).body.card.archetype?.slug, 'missionary', a);
  }
  db.prepare(`UPDATE profile_archetype_publish SET published = 0 WHERE user_id = ?`).run(FAY);
  assert.equal((await preview(db, 'partners')).body.card.archetype, null);
});

test('6e. the figure rows and notes are composed from what the reads returned, never a rule of their own', () => {
  const startup = { status: 200, body: { traction: { revenue: 5, users: null, funding_needed: null } } };
  const masked = { status: 200, body: { __masked: true, mrr: null, revenue: null, users_count: null, funding_needed: null } };
  assert.deepEqual(figureRows(startup, masked).map((r) => [r.key, r.display]),
    [['mrr', 'masked'], ['revenue', 'value'], ['users', 'value'], ['raise', 'value']]);
  assert.deepEqual(figureRows({ status: 404, body: {} }, { status: 403, body: {} }), []);
  assert.deepEqual(previewNotes('investors', startup, masked, 'active'),
    ['Revenue is on your public venture page, for anyone with its address.',
      'In the app, figures stay masked until an NDA is signed through an introduction.']);
  // The NDA sentence is drawn from the mask, not from the audience: an unmasked
  // read says nothing about an NDA.
  const unmasked = { status: 200, body: { mrr: 900, revenue: 5 } };
  assert.ok(!previewNotes('investors', startup, unmasked, 'active').some((n) => n.includes('NDA')));
});

/* ------------------------------------------------------------------ *
 * 7 · findable                                                        *
 * ------------------------------------------------------------------ */

async function investorReach(db: any, as: number) {
  const list = await get(db, as, '/api/projects');
  const readOne = await get(db, as, `/api/projects/${V}`);
  const searched = await get(db, as, '/api/search?q=sensors');
  const portfolio = await get(db, as, '/api/private-data/portfolio/metrics');
  return {
    listed: (list.body as any[]).some((p) => p.id === V),
    read: readOne.status,
    searched: (searched.body.hits || []).some((h: any) => h.type === 'project' && h.entity_id === V),
    portfolio: (portfolio.body.portfolio || []).some((p: any) => p.id === V),
    count: portfolio.body.fund_metrics?.portfolio_companies,
  };
}

test('7. with the flag never chosen, an investor finds the venture exactly as before', async () => {
  const db = freshDb();
  const r = await investorReach(db, IAN);
  assert.deepEqual({ listed: r.listed, read: r.read, searched: r.searched, portfolio: r.portfolio }, { listed: true, read: 200, searched: true, portfolio: true });
  assert.equal((await call(db, IAN, 'POST', '/api/watchlist', { project_id: V })).status, 201);
  assert.equal((await call(db, IAN, 'POST', '/api/follows', { entity_type: 'project', entity_id: V })).status, 200);
});

test('7b. with 0, an investor with no introduction finds it nowhere, and nothing is written', async () => {
  const db = freshDb();
  const before = await investorReach(db, IAN);
  findable(db, 0);
  const r = await investorReach(db, IAN);
  assert.deepEqual({ listed: r.listed, read: r.read, searched: r.searched, portfolio: r.portfolio }, { listed: false, read: 404, searched: false, portfolio: false });
  assert.equal(r.count, before.count - 1, 'the portfolio count still counts the hidden venture');
  for (const body of [{ project_id: V }, { project_uid: 'testventure' }]) {
    const w = await call(db, IAN, 'POST', '/api/watchlist', body);
    assert.equal(w.status, 404, JSON.stringify(body));
    assert.equal(w.body.detail, 'Project not found');
  }
  const f = await call(db, IAN, 'POST', '/api/follows', { entity_type: 'project', entity_id: V });
  assert.equal(f.status, 404);
  assert.equal(f.body.detail, 'Not found');
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM watchlist_items WHERE owner_user_id = ?`).get(IAN) as any).n, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM follows WHERE follower_user_id = ?`).get(IAN) as any).n, 0);
  const readBody = (await get(db, IAN, `/api/projects/${V}`)).body;
  assert.deepEqual(readBody, { error: 'Project not found' }, 'the hidden venture answered differently from a missing one');
});

test('7c. with 0, an introduction, a deal room or an active NDA still reaches it', async () => {
  const db = freshDb();
  findable(db, 0);
  for (const as of [IRA, DRE, NIA]) {
    const r = await investorReach(db, as);
    assert.equal(r.listed, true, `${as} lost the list`);
    assert.equal(r.read, 200, `${as} lost the read`);
    assert.equal(r.searched, true, `${as} lost search`);
    assert.equal((await call(db, as, 'POST', '/api/follows', { entity_type: 'project', entity_id: V })).status, 200);
  }
});

test('7d. a watchlist item made before the flag turned 0 stays in that investor\'s list', async () => {
  const db = freshDb();
  findable(db, 0);
  const r = await get(db, WES, '/api/watchlist');
  assert.equal(r.status, 200);
  assert.ok((r.body.items || []).some((i: any) => i.uid === 'w-wes'));
});

test('7e. admins, partners on the team and the founder are unaffected by the flag', async () => {
  const db = freshDb();
  findable(db, 0);
  // D889 (#2438): a partner reaches the venture as a team member.
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'advisor', 'accepted')`).run(V, PIA);
  for (const as of [ADA, PIA]) {
    assert.ok((await get(db, as, '/api/projects')).body.some((p: any) => p.id === V), `${ROLE[as]} lost the list`);
    assert.equal((await get(db, as, `/api/projects/${V}`)).status, 200);
  }
  assert.equal((await get(db, FAY, `/api/projects/${V}`)).status, 200);
});

test('7f. the census reads beyond the six: IC, journal, dashboard deal flow, decks, brand and compliance', async () => {
  const db = freshDb();
  db.prepare(`UPDATE projects SET status = 'tier_1' WHERE id = ?`).run(V);
  const dealFlow = async (as: number) => ((await get(db, as, '/api/dashboard?fresh=1')).body.proprietary_deal_flow || []).some((p: any) => p.id === V);
  assert.equal(await dealFlow(IAN), true, 'the dashboard never listed the venture, so this test proves nothing');
  assert.equal((await call(db, IAN, 'POST', '/api/ic', { title: 'Look', project_id: V })).status, 201);
  findable(db, 0);
  assert.equal(await dealFlow(IAN), false);
  assert.equal(await dealFlow(IRA), true);
  const icPost = await call(db, IAN, 'POST', '/api/ic', { title: 'Look again', project_id: V });
  assert.equal(icPost.status, 404);
  const entry = { project_id: V, decision: 'pass', thesis: 'Too early for our fund.' };
  assert.equal((await call(db, IAN, 'POST', '/api/journal', entry)).status, 404);
  assert.equal((await call(db, IAN, 'POST', '/api/journal', { ...entry, project_id: undefined, project_uid: 'testventure' })).status, 404);
  assert.equal((await call(db, IRA, 'POST', '/api/journal', entry)).status, 201);
  assert.notEqual((await get(db, IAN, `/api/decks/by-project/${V}`)).status, 200);
  assert.equal((await get(db, IAN, `/api/brand/landing/by-project/${V}`)).status, 404);
  assert.equal((await get(db, IAN, `/api/compliance/events?project_id=${V}`)).status, 404);
  assert.equal((await get(db, IRA, `/api/compliance/events?project_id=${V}`)).status, 200);
});

/* ------------------------------------------------------------------ *
 * 8 · visibility                                                      *
 * ------------------------------------------------------------------ */

const setVis = (db: any, vis: string, chosen: string | null) => db.prepare(
  `INSERT INTO user_settings (user_id, visibility, visibility_chosen_at) VALUES (?, ?, ?)
   ON CONFLICT(user_id) DO UPDATE SET visibility = excluded.visibility, visibility_chosen_at = excluded.visibility_chosen_at`,
).run(FAY, vis, chosen);

test('8. the effective visibility table, on /api/public/u/:handle', async () => {
  const cases: Array<[string, string | null, number, number, number]> = [
    // stored,   chosen,                 signed out, other member, self
    ['private', null, 404, 404, 200],
    ['private', '2026-10-01 00:00:00', 404, 404, 200],
    ['network', '2026-10-01 00:00:00', 404, 200, 200],
    ['network', null, 200, 200, 200],
    ['public', null, 200, 200, 200],
  ];
  for (const [stored, chosen, out, other, self] of cases) {
    const db = freshDb();
    setVis(db, stored, chosen);
    const label = `${stored}/${chosen ? 'chosen' : 'never'}`;
    assert.equal((await get(db, null, '/api/public/u/sam-example')).status, out, `${label} signed out`);
    assert.equal((await get(db, OLI, '/api/public/u/sam-example')).status, other, `${label} another member`);
    assert.equal((await get(db, FAY, '/api/public/u/sam-example')).status, self, `${label} self`);
  }
  // No row at all is the default: Public.
  const db = freshDb();
  assert.equal((await get(db, null, '/api/public/u/sam-example')).status, 200);
  assert.equal(effectiveVisibility('network', null), 'public');
});

test('8b. the startup read drops a Hidden founder\'s card, and a Members-only card for a signed-out caller', async () => {
  const db = freshDb();
  const cards = async (as: number | null) => (await get(db, as, '/api/public/startup/testventure')).body.founders.map((f: any) => f.handle);
  assert.deepEqual(await cards(null), ['sam-example']);
  setVis(db, 'network', '2026-10-01 00:00:00');
  assert.deepEqual(await cards(null), []);
  assert.deepEqual(await cards(OLI), ['sam-example']);
  setVis(db, 'private', '2026-10-01 00:00:00');
  assert.deepEqual(await cards(OLI), []);
  assert.deepEqual(await cards(FAY), ['sam-example']);
});

test('8c. PUT with visibility stamps the choice; without it does not; GET returns the effective value', async () => {
  const db = freshDb();
  const first = await get(db, FAY, '/api/settings/privacy');
  assert.equal(first.body.visibility, 'public', 'a member who never chose was not shown as public');
  assert.equal(first.body.visibility_chosen, false);
  await call(db, FAY, 'PUT', '/api/settings/privacy', { show_in_directory: false });
  assert.equal((db.prepare(`SELECT visibility_chosen_at FROM user_settings WHERE user_id = ?`).get(FAY) as any).visibility_chosen_at, null);
  const chose = await call(db, FAY, 'PUT', '/api/settings/privacy', { visibility: 'network' });
  assert.equal(chose.body.visibility, 'network');
  assert.equal(chose.body.visibility_chosen, true);
  assert.ok((db.prepare(`SELECT visibility_chosen_at FROM user_settings WHERE user_id = ?`).get(FAY) as any).visibility_chosen_at);
  // The matching gate is unchanged: FAY is 40% complete.
  const gate = await call(db, FAY, 'PUT', '/api/settings/privacy', { matching_opt_in: true });
  assert.equal(gate.status, 400);
  assert.equal(gate.body.field, 'matching_opt_in');
});

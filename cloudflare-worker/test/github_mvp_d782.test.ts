/**
 * D782 (#2112) — GitHub feeds Prototype / MVP: a fed must-have follows its pull
 * request (draft Planned, open In progress, review requested or approved In
 * review, merged Built, closed unmerged Dropped), written only when GitHub's
 * state moves so the founder's own edits stand, and each release records an
 * MVP release check on each must-have, in or not in. GitHub is stubbed; the D1
 * binding runs the real SQL (`_d1_sqlite.mjs`).
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/github_mvp_d782.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import { syncGithub } from '../src/integrations/providers/github.ts';
import { approvedBy, mvpRun, prState, releaseChecks, REVIEWS_READ } from '../src/integrations/providers/github/mvp.ts';
import { CONNECTOR_METADATA } from '../src/integrations/registry.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { addMvpStores } from './_github_mvp_stores.mjs';

const JWT_SECRET = 'm'.repeat(64); // synthetic test fixture
const mig = (n: string) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8');
const M501 = mig('501_github_mvp.sql');

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

/** Project 101 in company 10; member 1's GitHub connection syncs acme/app into it. `withMvp: false` leaves migration 501 out. */
async function world(opts: { withMvp?: boolean } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, founder_id INTEGER, spinout_lab_active INTEGER DEFAULT 0, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0, subscription_tier TEXT DEFAULT 'free');
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, mvp_target_date TEXT, incorporation_meta TEXT, cofounder_decision_meta TEXT, spinout_ip_meta TEXT, deleted_at TEXT);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, display_name TEXT, status TEXT DEFAULT 'active', auth_type TEXT,
      credentials_enc TEXT, webhook_secret_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT, external_account_id TEXT, external_account_name TEXT,
      last_synced_at TEXT, last_error TEXT, last_error_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_companies(integration_id INTEGER, company_id INTEGER, enabled INTEGER DEFAULT 1);
    CREATE TABLE pain_groups(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT);
    CREATE TABLE hypotheses(id INTEGER PRIMARY KEY, project_id INTEGER, claim TEXT);
    CREATE TABLE roadmap_okrs(id INTEGER PRIMARY KEY, project_id INTEGER, objective TEXT, key_results_json TEXT, kanban_status TEXT, quarter TEXT, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id, role, founder_id, name, email) VALUES (1, 'founder', 11, 'One', 'one@example.test'), (2, 'founder', 22, 'Owner', 'owner@example.test');
    INSERT INTO company_profiles VALUES (10);
    INSERT INTO projects(id, founder_id, company_id) VALUES (101, 11, 10);
    INSERT INTO user_company_links VALUES (1, 10);
    INSERT INTO hypotheses(id, project_id, claim) VALUES (7, 101, 'Founders export weekly');`);
  // The must-have's columns from 153, 441 and 461, as a live database has them.
  db.exec(mig('153_mvp_features.sql'));
  for (const line of [...mig('441_build_cycle_stores.sql').matchAll(/^ALTER TABLE (mvp_features|roadmap_okrs) ADD COLUMN [^\n]+;$/gm)].map((m) => m[0])) db.exec(line);
  for (const line of [...mig('461_build_record_stores.sql').matchAll(/^ALTER TABLE mvp_features ADD COLUMN [^\n]+;$/gm)].map((m) => m[0])) db.exec(line);
  db.exec(mig('445_connector_fed_items.sql'));
  db.exec(mig('499_github_roadmap.sql'));
  if (opts.withMvp !== false) addMvpStores(db);
  else db.exec(/CREATE TABLE IF NOT EXISTS mvp_release_checks \([\s\S]*?\n\);/.exec(mig('461_build_record_stores.sql'))![0]);
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: kv(), KEK_PII: 'fixture-cipher-key-'.repeat(4) } as any;
  const enc = await encryptCredentials(env, 'gh-m', { access_token: 'ghu_fixture' });
  db.prepare(`INSERT INTO integrations(id, uid, user_id, provider_key, auth_type, credentials_enc, config_json) VALUES (31, 'gh-m', 1, 'github', 'oauth2', ?, ?)`)
    .run(enc, JSON.stringify({ repositories: ['acme/app'], project_id: 101 }));
  db.exec('INSERT INTO integration_companies(integration_id, company_id, enabled) VALUES (31, 10, 1)');
  const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];
  const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
  return { db, env, all, one, row: () => one('SELECT * FROM integrations WHERE id = 31') };
}

type Repo = { pulls: any[]; releases: any[]; reviews: Record<number, any[]> };
/** A GitHub that answers acme/app from `repo`, and records each path it was asked. */
function fakeGithub(repo: Repo) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.github.com' && /^\/repos\/[^/]+\/[^/]+\/git\/ref\/tags\//.test(url.pathname)) return new Response('{}', { status: 404 });
    calls.push(url.pathname);
    const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    const rv = url.pathname.match(/^\/repos\/acme\/app\/pulls\/(\d+)\/reviews$/);
    if (rv) return j(repo.reviews[Number(rv[1])] ?? []);
    const m = url.pathname.match(/^\/repos\/acme\/app\/(issues|pulls|releases|milestones)$/);
    if (m) {
      const page = Number(url.searchParams.get('page'));
      const list = m[1] === 'pulls' ? repo.pulls : m[1] === 'releases' ? repo.releases : [];
      return j(list.slice((page - 1) * 100, page * 100));
    }
    // #2114: Solution design reads each repository first; this one is not served, so it reads nothing more.
    if (url.pathname === '/repos/acme/app') return j({ message: 'Not Found' }, 404);
    // #2115: contributors are outside this fixture's MVP scope.
    if (url.pathname === '/repos/acme/app/contributors') return j({ message: 'Not Found' }, 404);
    throw new Error(`unexpected GET ${url.pathname}`);
  }) as any;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const T = (d: string) => `2026-${d}T12:00:00Z`;
const pull = (number: number, title: string, extra: Record<string, unknown> = {}) => ({
  number, title, state: 'open', draft: false, created_at: T('09-01'), merged_at: null, closed_at: null,
  html_url: `https://github.com/acme/app/pull/${number}`, requested_reviewers: [], requested_teams: [], ...extra,
});
const release = (id: number, tag: string, at: string, extra = {}) =>
  ({ id, tag_name: tag, name: `Release ${tag}`, published_at: at, html_url: `https://github.com/acme/app/releases/tag/${tag}`, body: '', draft: false, prerelease: false, ...extra });

/** The repository every case starts from: one pull request in each state, and two releases. */
const repoOf = (): Repo => ({
  pulls: [
    pull(1, 'Sketch onboarding', { draft: true }), // planned
    pull(2, 'Add CSV export'), // open, no reviewer asked, no approval: in progress
    pull(3, 'Login with Google', { requested_reviewers: [{ login: 'reviewer' }] }), // review requested
    pull(4, 'Billing page'), // approved below
    pull(5, 'Search', { state: 'closed', merged_at: T('10-01'), closed_at: T('10-01') }), // merged before v1.0
    pull(6, 'Dark mode', { state: 'closed', merged_at: T('10-07'), closed_at: T('10-07') }), // open at v1.0, merged before v1.1
    pull(7, 'Old idea', { state: 'closed', closed_at: T('09-20') }), // closed unmerged before v1.0
    pull(8, 'Late feature', { created_at: T('10-12') }), // opened after both releases
  ],
  releases: [
    release(900, 'v1.0', T('10-02')),
    release(901, 'v1.1', T('10-09')),
    release(902, 'v2.0-draft', T('10-10'), { draft: true }),
  ],
  reviews: {
    4: [{ user: { id: 9 }, state: 'COMMENTED' }, { user: { id: 9 }, state: 'APPROVED' }],
    2: [{ user: { id: 9 }, state: 'APPROVED' }, { user: { id: 9 }, state: 'CHANGES_REQUESTED' }],
  },
});

const musts = (w: any) => w.all('SELECT title, pr_state, delivery_status, is_must_have, done_at FROM mvp_features ORDER BY id')
  .map((x: any) => [x.title, x.pr_state, x.delivery_status, x.is_must_have, x.done_at]);
const checks = (w: any) => w.all(`SELECT f.title, k.label, k.done_at, k.in_release, r.tag AS release
  FROM mvp_release_checks k JOIN mvp_features f ON f.id = k.feature_id LEFT JOIN roadmap_releases r ON r.id = k.release_id ORDER BY k.id`)
  .map((x: any) => [x.title, x.label, x.done_at, x.in_release, x.release]);
const snapshot = (w: any) => JSON.stringify({
  musts: w.all('SELECT * FROM mvp_features ORDER BY id'),
  checks: w.all('SELECT id, feature_id, label, done_at, in_release, release_id FROM mvp_release_checks ORDER BY id'),
  ledger: w.all('SELECT integration_id, project_id, module, kind, external_id, local_table, local_id FROM connector_fed_items ORDER BY id'),
});

test('the migration adds only what no earlier schema has, and nothing is backfilled', () => {
  // Mutation checked: add `ALTER TABLE mvp_features ADD COLUMN is_must_have` to 501 → fails here.
  const earlier = [readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8'),
    ...readdirSync('cloudflare-worker/sql/migrations').filter((f) => f.endsWith('.sql') && f < '501').map(mig)].join('\n');
  for (const [table, col] of [['mvp_features', 'pr_state'], ['mvp_features', 'pr_url'], ['mvp_release_checks', 'release_id'], ['mvp_release_checks', 'in_release']]) {
    assert.ok(!new RegExp(`ALTER TABLE ${table} ADD COLUMN ${col}\\b`).test(earlier), `${table}.${col} already exists`);
    assert.match(M501, new RegExp(`ALTER TABLE ${table} ADD COLUMN ${col}\\b`));
  }
  for (const col of ['delivery_status', 'is_must_have', 'done_at']) assert.doesNotMatch(M501, new RegExp(`ADD COLUMN ${col}\\b`), `${col} is an earlier column`);
  const statements = M501.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(statements, /^\s*(UPDATE|DELETE|INSERT|BEGIN|COMMIT|DROP)\b/im, 'additive only');
});

test('each pull request state sets its must-have: Planned, In progress, In review (asked or approved), Built, Dropped', async () => {
  const w = await world();
  const gh = fakeGithub(repoOf());
  try {
    const r = await syncGithub(w.env, w.row());
    assert.deepEqual(musts(w), [
      ['Sketch onboarding', 'planned', 'Backlog', 1, null],
      ['Add CSV export', 'in_progress', 'In Progress', 1, null], // approved, then changes requested: not approved
      ['Login with Google', 'in_review', 'Review', 1, null],
      ['Billing page', 'in_review', 'Review', 1, null], // approved
      ['Search', 'built', 'Done', 1, T('10-01')],
      ['Dark mode', 'built', 'Done', 1, T('10-07')],
      ['Old idea', 'dropped', 'Blocked', 0, null], // off the must-haves
      ['Late feature', 'in_progress', 'In Progress', 1, null],
    ]);
    assert.equal(w.one('SELECT pr_url FROM mvp_features WHERE title = ?', 'Search').pr_url, 'https://github.com/acme/app/pull/5');
    // Reviews are read only for open pull requests no one was asked to review: 2, 4 and 8.
    assert.deepEqual(gh.calls.filter((c) => c.endsWith('/reviews')).sort(), ['/repos/acme/app/pulls/2/reviews', '/repos/acme/app/pulls/4/reviews', '/repos/acme/app/pulls/8/reviews']);
    assert.equal(r.counts.reviews_read, 3);
    assert.equal(r.counts.must_haves_moved, 8);
  } finally { gh.restore(); }
});

test('the founder\'s own fields survive a re-sync, and their state stands until GitHub\'s moves', async () => {
  // Mutation checked: write delivery_status on every sync (drop `pr_state IS NOT ?`) → the founder's Blocked is lost.
  const w = await world();
  const repo = repoOf();
  const gh = fakeGithub(repo);
  try {
    await syncGithub(w.env, w.row());
    w.db.exec(`UPDATE mvp_features SET delivery_status = 'Blocked', owner_user_id = 2, due_date = '2026-12-01', description = 'Must ship first',
      hypothesis_id = 7, added_value = 'Low', effort = 'XL', scope = 'core' WHERE title = 'Add CSV export'`);
    // Undo a Dropped: mark it a must-have again.
    w.db.exec("UPDATE mvp_features SET is_must_have = 1 WHERE title = 'Old idea'");
    await syncGithub(w.env, w.row());
    assert.deepEqual({ ...w.one(`SELECT delivery_status, owner_user_id, due_date, description, hypothesis_id, added_value, effort, scope, is_must_have
      FROM mvp_features WHERE title = 'Add CSV export'`) },
    { delivery_status: 'Blocked', owner_user_id: 2, due_date: '2026-12-01', description: 'Must ship first', hypothesis_id: 7, added_value: 'Low', effort: 'XL', scope: 'core', is_must_have: 1 });
    assert.equal(w.one("SELECT is_must_have FROM mvp_features WHERE title = 'Old idea'").is_must_have, 1, 'the undone Dropped stands');
    // GitHub's state moves: the pull request merges.
    repo.pulls[1] = { ...repo.pulls[1], state: 'closed', merged_at: T('10-15'), closed_at: T('10-15') };
    await syncGithub(w.env, w.row());
    assert.deepEqual({ ...w.one("SELECT pr_state, delivery_status, done_at, owner_user_id, description FROM mvp_features WHERE title = 'Add CSV export'") },
      { pr_state: 'built', delivery_status: 'Done', done_at: T('10-15'), owner_user_id: 2, description: 'Must ship first' });
  } finally { gh.restore(); }
});

test('a release check lists the must-haves merged before it as in, and those still open as not in', async () => {
  const w = await world();
  const gh = fakeGithub(repoOf());
  try {
    const r = await syncGithub(w.env, w.row());
    assert.deepEqual(checks(w), [
      ['Sketch onboarding', 'Not in v1.0', null, 0, 'v1.0'],
      ['Sketch onboarding', 'Not in v1.1', null, 0, 'v1.1'],
      ['Add CSV export', 'Not in v1.0', null, 0, 'v1.0'],
      ['Add CSV export', 'Not in v1.1', null, 0, 'v1.1'],
      ['Login with Google', 'Not in v1.0', null, 0, 'v1.0'],
      ['Login with Google', 'Not in v1.1', null, 0, 'v1.1'],
      ['Billing page', 'Not in v1.0', null, 0, 'v1.0'],
      ['Billing page', 'Not in v1.1', null, 0, 'v1.1'],
      ['Search', 'In v1.0', T('10-02'), 1, 'v1.0'], // merged 1 Oct; not repeated for v1.1
      ['Dark mode', 'Not in v1.0', null, 0, 'v1.0'], // open on 2 Oct
      ['Dark mode', 'In v1.1', T('10-09'), 1, 'v1.1'], // merged 7 Oct
      // Old idea: closed unmerged before v1.0. Late feature: opened after both. The draft release: none.
    ]);
    assert.equal(r.counts.release_checks_created, 11);
    assert.deepEqual(w.all("SELECT DISTINCT module, local_table FROM connector_fed_items WHERE kind = 'release_check'").map((x: any) => [x.module, x.local_table]),
      [['prototype_mvp', 'mvp_release_checks']]);
  } finally { gh.restore(); }
});

test('a re-sync changes nothing twice', async () => {
  const w = await world();
  const gh = fakeGithub(repoOf());
  try {
    await syncGithub(w.env, w.row());
    const before = snapshot(w);
    const again = await syncGithub(w.env, w.row());
    assert.equal(snapshot(w), before, 'the same read writes the same rows');
    assert.equal(again.counts.release_checks_created, 0);
  } finally { gh.restore(); }
});

test('a deleted must-have stays deleted and gets no check; a deleted check stays deleted', async () => {
  const w = await world();
  const repo = repoOf();
  const gh = fakeGithub(repo);
  try {
    await syncGithub(w.env, w.row());
    w.db.exec("DELETE FROM mvp_features WHERE title = 'Dark mode'");
    // An open must-have, deleted before a new release it would be "not in".
    w.db.exec("DELETE FROM mvp_features WHERE title = 'Add CSV export'");
    repo.releases.push(release(903, 'v1.2', T('10-11')));
    const firstCheck = w.one("SELECT k.id FROM mvp_release_checks k JOIN mvp_features f ON f.id = k.feature_id WHERE f.title = 'Search'").id;
    w.db.exec(`DELETE FROM mvp_release_checks WHERE id = ${firstCheck}`);
    for (let i = 0; i < 2; i += 1) await syncGithub(w.env, w.row()); // the second reads the unlinked ledger rows
    assert.equal(w.one("SELECT COUNT(*) AS n FROM mvp_features WHERE title = 'Dark mode'").n, 0, 'the must-have is not re-created');
    assert.equal(w.one("SELECT COUNT(*) AS n FROM mvp_release_checks k JOIN mvp_features f ON f.id = k.feature_id WHERE f.title = 'Search'").n, 0, 'the check is not re-created');
    assert.deepEqual({ ...w.one("SELECT local_table, local_id FROM connector_fed_items WHERE external_id = 'release-check:acme/app@900#5'") },
      { local_table: 'mvp_release_checks', local_id: null }, 'its ledger row is unlinked, and reads as deleted');
    assert.equal(w.one("SELECT COUNT(*) AS n FROM connector_fed_items WHERE external_id = 'release-check:acme/app@903#2'").n, 0, 'no new check for a deleted must-have');
    assert.equal(w.one("SELECT COUNT(*) AS n FROM mvp_release_checks WHERE label = 'Not in v1.2'").n, 3, 'the new release checks the open must-haves that remain (Late feature opens after it)');
    // The deleted must-have's checks went with it, and their ledger rows are unlinked, so they no longer count as linked.
    assert.deepEqual(w.all("SELECT external_id, local_id FROM connector_fed_items WHERE external_id LIKE 'release-check:acme/app@%#6' ORDER BY id").map((x: any) => [x.external_id, x.local_id]),
      [['release-check:acme/app@900#6', null], ['release-check:acme/app@901#6', null]]);
  } finally { gh.restore(); }
});

test('the state and the checks, alone', () => {
  assert.equal(prState({ state: 'open', draft: true, requested_reviewers: [{}] }), 'planned', 'a draft asked for review is still Planned');
  assert.equal(prState({ state: 'open', requested_teams: [{}] }), 'in_review');
  assert.equal(prState({ state: 'open' }, true), 'in_review');
  assert.equal(prState({ state: 'closed', merged_at: '2026-10-01' }), 'built');
  assert.equal(prState({ state: 'closed' }), 'dropped');
  assert.equal(approvedBy([{ user: { id: 1 }, state: 'APPROVED' }, { user: { id: 2 }, state: 'CHANGES_REQUESTED' }]), true, 'one reviewer\'s approval stands');
  assert.equal(approvedBy([{ user: { id: 1 }, state: 'APPROVED' }, { user: { id: 1 }, state: 'DISMISSED' }]), false, 'a dismissed approval is not one');
  assert.equal(approvedBy([{ user: { id: 1 }, state: 'COMMENTED' }]), false);
  const at = (d: string) => T(d);
  const rels = [release(1, 'a', at('10-02')), release(2, 'b', at('10-09'))];
  assert.deepEqual(releaseChecks([pull(9, 'x', { merged_at: at('10-02'), state: 'closed', closed_at: at('10-02') })], rels).map((c) => [c.release.tag_name, c.in]), [['a', true]], 'merged at the moment of publishing is in');
  assert.deepEqual(releaseChecks([pull(9, 'x', { created_at: at('10-02') })], rels).map((c) => [c.release.tag_name, c.in]), [['a', false], ['b', false]], 'opened at the moment of publishing is open then');
  assert.deepEqual(releaseChecks([pull(9, 'x', { state: 'closed', closed_at: at('10-05') })], rels).map((c) => [c.release.tag_name, c.in]), [['a', false]], 'closed unmerged between releases: open at the first only');
});

test('the reviews read stops at REVIEWS_READ a sync, and the work stops inside its budget', async () => {
  const w = await world();
  const many = { pulls: Array.from({ length: REVIEWS_READ + 5 }, (_, i) => pull(100 + i, `PR ${i}`)), releases: [], reviews: {} };
  const gh = fakeGithub(many);
  try {
    const r = await syncGithub(w.env, w.row());
    assert.equal(r.counts.reviews_read, REVIEWS_READ);
    assert.equal(gh.calls.filter((c) => c.endsWith('/reviews')).length, REVIEWS_READ);
    const run = mvpRun(w.env, 31, 101);
    run.saw('acme/app', 'pulls', many.pulls);
    const before = gh.calls.length;
    const counts = await run.finish((p) => fetch(`https://api.github.com${p}`), ['acme/app'], 0);
    assert.equal(counts.mvp_partial, true);
    assert.equal(gh.calls.length, before, 'no read past the budget');
  } finally { gh.restore(); }
});

test('the connector page names release checks under Prototype / MVP', () => {
  // Mutation checked: drop Release checks from the registry's pulls → this fails.
  const pulls = CONNECTOR_METADATA.github.pulls.map((x: any) => `${x.what} → ${x.module}`);
  assert.ok(pulls.includes('Release checks → prototype_mvp') && pulls.includes('Pull requests → prototype_mvp'));
  // Mutation checked: land the reviews tool nowhere → this fails.
  const reviews = (CONNECTOR_PAGES.github as any).tools.find((t: any) => t.name === 'read_pull_request_reviews');
  assert.deepEqual([reviews?.access, reviews?.lands_in], ['read', 'prototype_mvp']);
});

// ── the module read ──────────────────────────────────────────────────────────

const app = (() => { const a = new Hono<any>(); a.route('/api/cycles/build', build); a.onError((e, c) => c.json({ error: e.message }, 500)); return a; })();
async function mvpRead(env: any) {
  const token = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request('/api/cycles/build/modules/prototype-mvp?project=101', { headers: { Authorization: 'Bearer ' + token, 'X-Company-Id': '10' } }, env);
  return { status: r.status, body: await r.json() as any };
}

test('Prototype / MVP\'s read carries each fed must-have\'s state and link, and each release\'s checks', async () => {
  const w = await world();
  const gh = fakeGithub(repoOf());
  try { await syncGithub(w.env, w.row()); } finally { gh.restore(); }
  const { status, body } = await mvpRead(w.env);
  assert.equal(status, 200, JSON.stringify(body));
  const g = body.parts.github;
  assert.equal(g.state, 'ok');
  assert.deepEqual(g.must_haves.map((m: any) => [m.title, m.label, m.must_have]), [
    ['Sketch onboarding', 'Planned', true], ['Add CSV export', 'In progress', true], ['Login with Google', 'In review', true], ['Billing page', 'In review', true],
    ['Search', 'Built', true], ['Dark mode', 'Built', true], ['Old idea', 'Dropped', false], ['Late feature', 'In progress', true],
  ]);
  assert.equal(g.must_haves[4].url, 'https://github.com/acme/app/pull/5');
  assert.deepEqual(g.releases.map((r: any) => [r.tag, r.in.map((i: any) => i.title), r.not_in.map((i: any) => i.title)]), [
    ['v1.1', ['Dark mode'], ['Sketch onboarding', 'Add CSV export', 'Login with Google', 'Billing page']],
    ['v1.0', ['Search'], ['Sketch onboarding', 'Add CSV export', 'Login with Google', 'Billing page', 'Dark mode']],
  ], 'newest first: in, then not in');
  assert.equal(g.releases_total, 2);
  // The canvas's table is unchanged, and a Dropped must-have has left it.
  const table = body.records ?? body;
  assert.deepEqual(table.cols.map((c: any) => c.label), ['Must-have', 'Tests', 'State', 'Owner', 'Due']);
  assert.ok(table.rows.length === 7 && !JSON.stringify(table.rows).includes('Old idea'), 'seven must-haves; the Dropped one has left the table');
});

test('with nothing from GitHub the part says so, and an unreadable store is Unreadable, never empty', async () => {
  const w = await world();
  const empty = (await mvpRead(w.env)).body.parts.github;
  assert.deepEqual([empty.state, empty.releases_total], ['empty', 0]);
  assert.match(empty.reason, /No pull request or release from GitHub yet/);
  const old = await world({ withMvp: false });
  const quiet = console.error; console.error = () => {};
  try {
    const { status, body } = await mvpRead(old.env);
    assert.equal(status, 200);
    assert.deepEqual([body.parts.github.state, body.parts.github.releases_total], ['unreadable', null]);
    assert.notEqual(body.card.state, 'unreadable', 'the must-haves still read');
  } finally { console.error = quiet; }
});

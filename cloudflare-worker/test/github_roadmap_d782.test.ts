/**
 * D782 (#2111) — GitHub feeds Product roadmap: a milestone gives its items
 * their group and target, a release is a row through the ledger and marks
 * Shipped only the items it closed, a re-sync changes nothing twice, and a
 * deleted item or release stays deleted. GitHub is stubbed; the D1 binding
 * runs the real SQL (`_d1_sqlite.mjs`).
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/github_roadmap_d782.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import cycleRecords from '../src/routes/cycle_records.ts';
import { syncGithub } from '../src/integrations/providers/github.ts';
import { issuesClosedBy, issuesNamed, packBatches, roadmapRun, shippedBy } from '../src/integrations/providers/github/roadmap.ts';
import { fedCounts } from '../src/integrations/fed.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'r'.repeat(64); // synthetic test fixture
const mig = (n: string) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8');
const M499 = mig('499_github_roadmap.sql');

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}

/** Project 101 in company 10; member 1's GitHub connection syncs acme/app into it. `withRoadmap: false` leaves migration 499 out. */
async function world(opts: { withRoadmap?: boolean } = {}) {
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
    CREATE TABLE mvp_features(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, added_value TEXT DEFAULT 'High', effort TEXT DEFAULT 'M', delivery_status TEXT DEFAULT 'Backlog', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE roadmap_okrs(id INTEGER PRIMARY KEY, project_id INTEGER, objective TEXT, key_results_json TEXT, kanban_status TEXT, quarter TEXT, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE okr_column_moves(id INTEGER PRIMARY KEY, project_id INTEGER, okr_id INTEGER, to_status TEXT, moved_at TEXT);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, action TEXT, details TEXT, actor TEXT, entity_type TEXT, entity_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id, role, founder_id, name, email) VALUES (1, 'founder', 11, 'One', 'one@example.test'), (4, 'partner', NULL, 'Partner', 'partner@example.test');
    INSERT INTO company_profiles VALUES (10);
    INSERT INTO projects(id, founder_id, company_id) VALUES (101, 11, 10);
    INSERT INTO user_company_links VALUES (1, 10);`);
  // The roadmap's columns from 441 and 461, as a live database has them.
  for (const line of [...mig('441_build_cycle_stores.sql').matchAll(/^ALTER TABLE roadmap_okrs ADD COLUMN [^\n]+;$/gm)].map((m) => m[0])) db.exec(line);
  for (const line of [...mig('461_build_record_stores.sql').matchAll(/^ALTER TABLE roadmap_okrs ADD COLUMN feedback_theme [^\n]+;$/gm)].map((m) => m[0])) db.exec(line);
  db.exec('ALTER TABLE roadmap_okrs ADD COLUMN feature_id INTEGER');
  db.exec('ALTER TABLE roadmap_okrs ADD COLUMN created_by INTEGER');
  // The item record's other sections read these; they stay empty here.
  db.exec(mig('254_roadmap_dependencies.sql'));
  db.exec(/CREATE TABLE IF NOT EXISTS product_feedback \([\s\S]*?\n\);/.exec(mig('443_grow_stores.sql'))![0]);
  db.exec(mig('445_connector_fed_items.sql'));
  if (opts.withRoadmap !== false) db.exec(M499);
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: kv(), KEK_PII: 'fixture-cipher-key-'.repeat(4) } as any;
  const enc = await encryptCredentials(env, 'gh-r', { access_token: 'ghu_fixture' });
  db.prepare(`INSERT INTO integrations(id, uid, user_id, provider_key, auth_type, credentials_enc, config_json) VALUES (31, 'gh-r', 1, 'github', 'oauth2', ?, ?)`)
    .run(enc, JSON.stringify({ repositories: ['acme/app'], project_id: 101 }));
  db.exec('INSERT INTO integration_companies(integration_id, company_id, enabled) VALUES (31, 10, 1)');
  const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];
  const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
  return { db, env, all, one, row: () => one("SELECT * FROM integrations WHERE id = 31") };
}

type Repo = { issues: any[]; pulls: any[]; releases: any[]; milestones: any[] };
/** A GitHub that answers acme/app from `repo`, and records each path it was asked. */
function fakeGithub(repo: Repo) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}?${url.searchParams.get('state') ?? ''}`);
    const m = url.pathname.match(/^\/repos\/acme\/app\/(issues|pulls|releases|milestones)$/);
    // #2114: Solution design reads each repository first; this one is not served, so it reads nothing more.
    if (!m && url.pathname === '/repos/acme/app') return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    if (!m) throw new Error(`unexpected GET ${url.pathname}`);
    const page = Number(url.searchParams.get('page'));
    return new Response(JSON.stringify(repo[m[1] as keyof Repo].slice((page - 1) * 100, page * 100)), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const V1 = { number: 1, title: 'v1.0', due_on: '2026-11-30T08:00:00Z' };
const LATER = { number: 2, title: 'Later', due_on: null };
const BETA = { number: 3, title: 'Beta', due_on: '2026-10-15T08:00:00Z' };
const issue = (n: number, title: string, state = 'open', milestone: any = null) => ({ number: n, title, state, milestone });
const release = (id: number, tag: string, at: string, body = '', extra = {}) =>
  ({ id, tag_name: tag, name: `Release ${tag}`, published_at: at, html_url: `https://github.com/acme/app/releases/tag/${tag}`, body, draft: false, prerelease: false, ...extra });

/** The repository every case starts from. */
const repoOf = (): Repo => ({
  milestones: [V1, LATER, BETA],
  issues: [
    issue(1, 'Export to CSV', 'closed', V1), // closed by PR 10, merged before v1.0
    issue(2, 'Fix login', 'closed', V1), // named in v1.1's notes
    issue(3, 'Dark mode', 'open', LATER), // open: never shipped, even if named
    issue(4, 'Old cleanup', 'closed'), // closed with no evidence at all
    issue(5, 'Faster import', 'closed', BETA), // closed by PR 11, merged after v1.0
    { number: 10, title: 'A PR the issues endpoint lists', state: 'closed', pull_request: {} },
  ],
  pulls: [
    { number: 10, title: 'Add CSV export', body: 'Closes #1', state: 'closed', merged_at: '2026-10-01T10:00:00Z' },
    { number: 11, title: 'Speed up import', body: 'This fixes #5 for good.', state: 'closed', merged_at: '2026-10-05T10:00:00Z' },
    { number: 12, title: 'Unmerged', body: 'Closes #4', state: 'closed', merged_at: null },
  ],
  releases: [
    release(900, 'v1.0', '2026-10-02T12:00:00Z', 'First release. Mentions #3 too.'),
    release(901, 'v1.1', '2026-10-09T12:00:00Z', '## Fixed\n- Login (#2)\n- https://github.com/acme/app/pull/11'),
    release(902, 'v2.0-draft', '2026-10-10T12:00:00Z', 'Closes #4', { draft: true }),
  ],
});

const items = (w: any) => w.all(`SELECT o.objective, o.milestone_title, o.milestone_due, o.target_date, r.tag AS shipped
  FROM roadmap_okrs o LEFT JOIN roadmap_releases r ON r.id = o.shipped_release_id ORDER BY o.id`)
  .map((x: any) => [x.objective, x.milestone_title, x.milestone_due, x.target_date, x.shipped]);
const snapshot = (w: any) => JSON.stringify({
  okrs: w.all('SELECT * FROM roadmap_okrs ORDER BY id'),
  releases: w.all('SELECT id, project_id, repository, tag, name, published_at, url, prerelease FROM roadmap_releases ORDER BY id'),
  ledger: w.all('SELECT integration_id, project_id, module, kind, external_id, local_table, local_id FROM connector_fed_items ORDER BY id'),
});

test('the migration adds only what no earlier schema has, and nothing is backfilled', () => {
  // Mutation checked: add `ALTER TABLE roadmap_okrs ADD COLUMN target_date` to 499 → fails here.
  const earlier = [readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8'),
    ...readdirSync('cloudflare-worker/sql/migrations').filter((f) => f.endsWith('.sql') && f < '499').map(mig)].join('\n');
  for (const col of ['milestone_title', 'milestone_due', 'shipped_release_id']) {
    assert.ok(!new RegExp(`ALTER TABLE roadmap_okrs ADD COLUMN ${col}\\b`).test(earlier), `${col} already exists`);
    assert.match(M499, new RegExp(`ALTER TABLE roadmap_okrs ADD COLUMN ${col}\\b`));
  }
  assert.ok(!/CREATE TABLE (IF NOT EXISTS )?roadmap_releases\b/.test(earlier), 'roadmap_releases already exists');
  assert.match(earlier, /ALTER TABLE roadmap_okrs ADD COLUMN target_date/, 'the target is 441\'s column');
  const statements = M499.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(statements, /ADD COLUMN target_date|^\s*(UPDATE|DELETE|INSERT|BEGIN|COMMIT|DROP)\b/im, 'additive only');
});

test('a milestone sets the item\'s group and target; one with no due date sets the group only', async () => {
  const w = await world();
  const gh = fakeGithub(repoOf());
  try {
    const r = await syncGithub(w.env, w.row());
    assert.equal(r.counts.milestones, 3);
    assert.equal(r.counts.milestone_items, 4);
    assert.deepEqual(items(w).map((x: any[]) => x.slice(0, 4)), [
      ['Export to CSV', 'v1.0', '2026-11-30', '2026-11-30'],
      ['Fix login', 'v1.0', '2026-11-30', '2026-11-30'],
      ['Dark mode', 'Later', null, null],
      ['Old cleanup', null, null, null],
      ['Faster import', 'Beta', '2026-10-15', '2026-10-15'],
    ]);
    assert.ok(gh.calls.includes('/repos/acme/app/milestones?all'), 'milestones are read with state=all');
    // A target the founder set on an item whose milestone has no due date is theirs: a re-sync keeps it.
    w.db.exec("UPDATE roadmap_okrs SET target_date = '2027-01-15' WHERE objective = 'Dark mode'");
    await syncGithub(w.env, w.row());
    assert.deepEqual(items(w)[2].slice(0, 4), ['Dark mode', 'Later', null, '2027-01-15']);
  } finally { gh.restore(); }
});

test('an issue taken out of its milestone loses the group; its target, maybe the founder\'s now, stays', async () => {
  const w = await world();
  const repo = repoOf();
  const gh = fakeGithub(repo);
  try {
    await syncGithub(w.env, w.row());
    repo.issues[0] = issue(1, 'Export to CSV', 'closed', null);
    repo.milestones[0] = { ...V1, title: 'v1.0 GA' };
    await syncGithub(w.env, w.row());
    assert.deepEqual(items(w).slice(0, 2).map((x: any[]) => x.slice(0, 4)), [
      ['Export to CSV', null, null, '2026-11-30'],
      ['Fix login', 'v1.0 GA', '2026-11-30', '2026-11-30'],
    ], 'the group follows GitHub; the milestones read renames it');
  } finally { gh.restore(); }
});

test('a release makes one row, and marks Shipped only the items it closed, by the named rule', async () => {
  const w = await world();
  const gh = fakeGithub(repoOf());
  try {
    const r = await syncGithub(w.env, w.row());
    assert.equal(r.counts.releases, 3, 'the main loop still counts what it read');
    assert.equal(r.counts.release_rows_created, 2, 'a draft is not a release');
    assert.deepEqual(w.all('SELECT repository, tag, name, published_at, url, prerelease FROM roadmap_releases ORDER BY id').map((x: any) => Object.values(x)), [
      ['acme/app', 'v1.0', 'Release v1.0', '2026-10-02T12:00:00Z', 'https://github.com/acme/app/releases/tag/v1.0', 0],
      ['acme/app', 'v1.1', 'Release v1.1', '2026-10-09T12:00:00Z', 'https://github.com/acme/app/releases/tag/v1.1', 0],
    ]);
    assert.deepEqual(items(w).map((x: any[]) => [x[0], x[4]]), [
      ['Export to CSV', 'v1.0'], // PR 10 merged 1 Oct, v1.0 published 2 Oct
      ['Fix login', 'v1.1'], // named in v1.1's notes
      ['Dark mode', null], // named in v1.0's notes, but open
      ['Old cleanup', null], // closed, no evidence; the unmerged PR and the draft do not count
      ['Faster import', 'v1.1'], // PR 11 merged 5 Oct, after v1.0: the first release at or after it
    ]);
    assert.equal(r.counts.items_shipped, 3);
    // Every release row is in the ledger, linked, under Product roadmap.
    assert.deepEqual(w.all("SELECT external_id, local_table FROM connector_fed_items WHERE kind = 'release' ORDER BY id").map((x: any) => [x.external_id, x.local_table]),
      [['release:acme/app@900', 'roadmap_releases'], ['release:acme/app@901', 'roadmap_releases']]);
    const fed = Object.fromEntries((await fedCounts(w.env, 31, 'github')).map((m) => [m.module, m]));
    assert.deepEqual([fed.product_roadmap.count, fed.product_roadmap.linked, fed.product_roadmap.reason], [7, 7, null], 'five issues and two releases, all linked');
  } finally { gh.restore(); }
});

test('a re-sync changes nothing twice', async () => {
  // Mutation checked: drop `shipped_release_id IS NULL` → a later release moves the mark.
  const w = await world();
  const repo = repoOf();
  const gh = fakeGithub(repo);
  try {
    const first = await syncGithub(w.env, w.row());
    const before = snapshot(w);
    const second = await syncGithub(w.env, w.row());
    assert.equal(snapshot(w), before, 'the same read writes the same rows');
    assert.equal(second.counts.release_rows_created, 0);
    assert.deepEqual([second.counts.milestone_items, second.counts.items_shipped], [first.counts.milestone_items, first.counts.items_shipped]);
    // A later release that also names #1 does not move its mark.
    repo.releases.push(release(903, 'v1.2', '2026-10-12T12:00:00Z', 'Again: #1'));
    await syncGithub(w.env, w.row());
    assert.equal(items(w)[0][4], 'v1.0');
    assert.equal(w.one('SELECT COUNT(*) AS n FROM roadmap_releases').n, 3);
  } finally { gh.restore(); }
});

test('a deleted item stays deleted, and so does a deleted release; the item it shipped loses the mark', async () => {
  const w = await world();
  const gh = fakeGithub(repoOf());
  try {
    await syncGithub(w.env, w.row());
    w.db.exec("DELETE FROM roadmap_okrs WHERE objective = 'Fix login'");
    w.db.exec("DELETE FROM roadmap_releases WHERE tag = 'v1.0'");
    assert.equal(items(w)[0][4], null, 'the release\'s FK clears the mark');
    const r = await syncGithub(w.env, w.row());
    assert.equal(r.counts.release_rows_created, 0);
    assert.equal(w.one("SELECT COUNT(*) AS n FROM roadmap_okrs WHERE objective = 'Fix login'").n, 0, 'the item is not re-created');
    assert.equal(w.one("SELECT COUNT(*) AS n FROM roadmap_releases WHERE tag = 'v1.0'").n, 0, 'the release is not re-created');
    assert.deepEqual({ ...w.one("SELECT local_table, local_id FROM connector_fed_items WHERE external_id = 'release:acme/app@900'") },
      { local_table: 'roadmap_releases', local_id: null }, 'its ledger row is unlinked, and reads as deleted');
    assert.equal(items(w)[0][4], null, 'no mark from a deleted release');
    // The next sync reads that unlinked row: still deleted, never re-created.
    const third = await syncGithub(w.env, w.row());
    assert.equal(third.counts.release_rows_created, 0);
    assert.equal(w.one("SELECT COUNT(*) AS n FROM roadmap_releases WHERE tag = 'v1.0'").n, 0, 'the release is not re-created on the next sync either');
    const fed = Object.fromEntries((await fedCounts(w.env, 31, 'github')).map((m) => [m.module, m]));
    assert.match(fed.product_roadmap.reason, /deleted in Product roadmap; a sync does not bring them back/);
  } finally { gh.restore(); }
});

test('a release an earlier sync only counted (D655) lands as a row now', async () => {
  const w = await world();
  w.db.exec(`INSERT INTO connector_fed_items(integration_id, project_id, module, kind, external_id, local_table, local_id)
    VALUES (31, 101, 'product_roadmap', 'release', 'release:acme/app@900', NULL, NULL)`);
  const gh = fakeGithub(repoOf());
  try {
    const r = await syncGithub(w.env, w.row());
    assert.equal(r.counts.release_rows_created, 2);
    const l = w.one("SELECT local_table, local_id FROM connector_fed_items WHERE external_id = 'release:acme/app@900'");
    assert.equal(l.local_table, 'roadmap_releases');
    assert.equal(w.one('SELECT tag FROM roadmap_releases WHERE id = ?', l.local_id).tag, 'v1.0');
  } finally { gh.restore(); }
});

test('the evidence rules, alone', () => {
  assert.deepEqual([...issuesNamed('Fixed #2, acme/app#3 and https://github.com/acme/app/issues/4; not other/repo#5, not #x, not a/b/pull/6 or &#7;', 'acme/app')].sort(), [2, 3, 4]);
  assert.deepEqual([...issuesNamed('https://github.com/acme/app/pull/11', 'acme/app')], [], 'a pull request URL names no issue');
  assert.deepEqual([...issuesClosedBy('Closes #1. fixes: #2, Resolved acme/app#3, see #4, close other/x#5, Fixes https://github.com/acme/app/issues/6', 'acme/app')].sort(), [1, 2, 3, 6]);
  const releases = [release(1, 'a', '2026-01-02T00:00:00Z'), release(2, 'b', '2026-01-05T00:00:00Z', 'with #7')];
  const pr = (merged: string | null, body: string) => ({ merged_at: merged, title: '', body });
  assert.deepEqual(shippedBy('acme/app', [issue(7, 'x', 'closed')], [pr('2026-01-01T00:00:00Z', 'closes #7')], releases), [{ issue: 7, release: 'release:acme/app@2', rule: 'listed' }], 'a naming wins over a merge');
  assert.deepEqual(shippedBy('acme/app', [issue(8, 'x', 'closed')], [pr('2026-01-02T00:00:00Z', 'fixes #8')], releases), [{ issue: 8, release: 'release:acme/app@1', rule: 'closed_by_pull_request' }], 'merged at the moment of publishing counts');
  assert.deepEqual(shippedBy('acme/app', [issue(9, 'x', 'closed')], [pr('2026-02-01T00:00:00Z', 'fixes #9')], releases), [], 'merged after every release');
  assert.deepEqual(shippedBy('acme/app', [issue(8, 'x', 'open')], [pr('2026-01-01T00:00:00Z', 'fixes #8')], releases), [], 'an open issue is not shipped');
  assert.deepEqual(shippedBy('acme/app', [issue(8, 'x', 'closed')], [pr(null, 'fixes #8')], releases), [], 'an unmerged pull request is no evidence');
});

test('a batch never splits a release\'s INSERT from its ledger row', () => {
  // Mutation checked: pack by fixed slices → the pair at the boundary splits.
  const groups = [['a'], ['b'], ['c', 'c-ledger'], ['d']];
  assert.deepEqual(packBatches(groups, 3), [['a', 'b'], ['c', 'c-ledger', 'd']]);
  assert.deepEqual(packBatches([['x', 'x-ledger']], 1), [['x', 'x-ledger']], 'a group larger than a batch is one batch');
});

test('the roadmap work stops inside its budget and says so', async () => {
  const w = await world();
  const gh = fakeGithub(repoOf());
  try {
    const run = roadmapRun(w.env, 31, 101);
    const counts = await run.finish((p) => fetch(`https://api.github.com${p}`), ['acme/app'], 0);
    assert.equal(counts.roadmap_partial, true);
    assert.deepEqual(gh.calls, [], 'no read past the budget');
  } finally { gh.restore(); }
});

// ── the module read ──────────────────────────────────────────────────────────

const app = (() => { const a = new Hono<any>(); a.route('/api/cycles', cycleRecords); a.route('/api/cycles/build', build); a.onError((e, c) => c.json({ error: e.message }, 500)); return a; })();
async function roadmapRead(env: any, id = 1) {
  const token = await new SignJWT({ user_id: id, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request('/api/cycles/build/modules/product-roadmap?project=101', { headers: { Authorization: 'Bearer ' + token, 'X-Company-Id': '10' } }, env);
  return { status: r.status, body: await r.json() as any };
}

test('Product roadmap\'s read carries the milestone groups, the releases and each item\'s Shipped mark', async () => {
  const w = await world();
  const gh = fakeGithub(repoOf());
  try { await syncGithub(w.env, w.row()); } finally { gh.restore(); }
  const { status, body } = await roadmapRead(w.env);
  assert.equal(status, 200, JSON.stringify(body));
  const g = body.parts.github;
  assert.equal(g.state, 'ok');
  assert.deepEqual(g.groups.map((x: any) => [x.title, x.due, x.items.map((i: any) => [i.title, i.shipped?.tag ?? null]), x.shipped]), [
    ['Beta', '2026-10-15', [['Faster import', 'v1.1']], 1],
    ['v1.0', '2026-11-30', [['Export to CSV', 'v1.0'], ['Fix login', 'v1.1']], 2],
    ['Later', null, [['Dark mode', null]], 0],
  ], 'soonest target first, a group with no target last');
  assert.equal(g.groups[1].items[0].shipped.url, 'https://github.com/acme/app/releases/tag/v1.0');
  assert.deepEqual(g.releases.map((r: any) => [r.tag, r.shipped, r.items.map((i: any) => i.title)]), [
    ['v1.1', 2, ['Fix login', 'Faster import']],
    ['v1.0', 1, ['Export to CSV']],
  ], 'newest first, each with what it shipped');
  assert.equal(g.releases_total, 2);
  // The canvas's table is unchanged.
  assert.deepEqual(body.records?.cols?.map((c: any) => c.label) ?? body.cols?.map((c: any) => c.label), ['Item', 'Column', 'Moves', 'Owner', 'Date']);
});

test('with nothing from GitHub the part says so, and an unreadable store is Unreadable, never empty', async () => {
  const w = await world();
  const empty = (await roadmapRead(w.env)).body.parts.github;
  assert.deepEqual([empty.state, empty.releases_total], ['empty', 0]);
  assert.match(empty.reason, /No milestone or release from GitHub yet/);
  const old = await world({ withRoadmap: false });
  const quiet = console.error; console.error = () => {};
  try {
    const { status, body } = await roadmapRead(old.env);
    assert.equal(status, 200);
    assert.deepEqual([body.parts.github.state, body.parts.github.releases_total], ['unreadable', null]);
    assert.notEqual(body.card.state, 'unreadable', 'the roadmap itself still reads');
  } finally { console.error = quiet; }
});

test('the connector page names every feed this part builds', async () => {
  // Mutation checked: drop Milestones from the registry's pulls → this fails.
  const { CONNECTOR_METADATA } = await import('../src/integrations/registry.ts');
  const { GITHUB_LANDINGS } = await import('../src/integrations/githubFeeds.ts');
  const pulls = CONNECTOR_METADATA.github.pulls.map((x: any) => `${x.what} → ${x.module}`);
  for (const l of GITHUB_LANDINGS.filter((x) => x.store !== null)) assert.ok(pulls.includes(`${l.what} → ${l.module}`), `${l.what} → ${l.module} is not on the page`);
  assert.ok(pulls.includes('Milestones → product_roadmap') && pulls.includes('Releases → product_roadmap'));
});

test('the item\'s record names its milestone and the release that shipped it, linking to GitHub', async () => {
  // Mutation checked: drop the Shipped row → no row names the release.
  const w = await world();
  const gh = fakeGithub(repoOf());
  try { await syncGithub(w.env, w.row()); } finally { gh.restore(); }
  const token = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const record = async (objective: string) => {
    const id = w.one('SELECT id FROM roadmap_okrs WHERE objective = ?', objective).id;
    const r = await app.request(`/api/cycles/build/modules/product-roadmap/records/${id}?project=101`, { headers: { Authorization: 'Bearer ' + token, 'X-Company-Id': '10' } }, w.env);
    const body = await r.json() as any;
    assert.equal(r.status, 200, JSON.stringify(body));
    return [...body.main, ...body.side].find((s: any) => s.key === 'github').rows.map((x: any) => [x.a, x.b, x.href ?? null]);
  };
  const shipped = await record('Export to CSV');
  assert.deepEqual(shipped.slice(2), [['Milestone', 'v1.0 · due 30 Nov 2026', null], ['Shipped', 'v1.0 · 2 Oct 2026', 'https://github.com/acme/app/releases/tag/v1.0']]);
  const open = await record('Dark mode');
  assert.deepEqual(open.slice(2), [['Milestone', 'Later', null], ['Shipped', 'Not shipped: no release names it or closes it.', null]]);
  const loose = await record('Old cleanup');
  assert.deepEqual(loose[2], ['Milestone', 'In no milestone', null]);
});

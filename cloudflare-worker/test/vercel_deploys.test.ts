/**
 * D1098 (#2963, #2408 part 3) — Vercel's deployments on Prototype / MVP and
 * Product roadmap. Vercel is stubbed (`_vercel_api_fake.mjs`); the D1 binding
 * runs the real SQL (`_d1_sqlite.mjs`) over the real migrations.
 *
 *   - A Preview chip is matched to a must-have by repository and pull request
 *     number only: never by branch name, never by time.
 *   - "In production since" and "Live on" are drawn only on SHA equality with
 *     GitHub's own, and only for a READY production deployment.
 *   - No Vercel sync writes a must-have, a roadmap item, a release or a release
 *     check: the four tables are diffed around a sync.
 *   - Retention keeps 180 days or the newest 500; a deployment removed stays
 *     removed.
 *   - A store that cannot be read makes the part Unreadable; the module reads.
 *   - One Live line per host (D1083's `liveHost.ts`): a Lovable app address
 *     equal to a Vercel production domain is Vercel's line, drawn once.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/vercel_deploys.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import { syncVercel } from '../src/integrations/providers/vercel.ts';
import { deploymentRow, fullSha, KEEP_NEWEST, retainDeployments } from '../src/services/vercel/deployments.ts';
import { DEPLOY_WEEKS, median, mvpVercel, pullKey, roadmapVercel, weekStart } from '../src/services/vercel/buildReads.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { addMvpStores } from './_github_mvp_stores.mjs';
import { fakeVercel } from './_vercel_api_fake.mjs';

const JWT_SECRET = 'd'.repeat(64); // synthetic test fixture
const mig = (n: string) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8');
const SHA_A = 'a'.repeat(40), SHA_B = 'b'.repeat(40), SHA_C = 'c'.repeat(40);
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-21T12:00:00Z'); // a Wednesday

/** Venture 101 in company 10; member 1 holds GitHub connection 31 and Vercel connection 41. `withDeploys: false` leaves 591 out. */
async function world(opts: { withDeploys?: boolean } = {}) {
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
    CREATE TABLE okr_column_moves(id INTEGER PRIMARY KEY, project_id INTEGER, okr_id INTEGER, to_status TEXT, moved_at TEXT);
    INSERT INTO users(id, role, founder_id, name, email) VALUES (1, 'founder', 11, 'One', 'one@example.test'), (2, 'founder', 22, 'Outsider', 'out@example.test');
    INSERT INTO company_profiles VALUES (10);
    INSERT INTO projects(id, founder_id, company_id) VALUES (101, 11, 10);
    INSERT INTO user_company_links VALUES (1, 10);`);
  db.exec(mig('153_mvp_features.sql'));
  for (const line of [...mig('441_build_cycle_stores.sql').matchAll(/^ALTER TABLE (mvp_features|roadmap_okrs) ADD COLUMN [^\n]+;$/gm)].map((m) => m[0])) db.exec(line);
  for (const line of [...mig('461_build_record_stores.sql').matchAll(/^ALTER TABLE (mvp_features|roadmap_okrs) ADD COLUMN [^\n]+;$/gm)].map((m) => m[0])) db.exec(line);
  db.exec(mig('445_connector_fed_items.sql'));
  db.exec(mig('499_github_roadmap.sql'));
  addMvpStores(db);
  db.exec(mig('589_vercel_installations.sql'));
  if (opts.withDeploys !== false) db.exec(mig('591_vercel_deployments.sql'));
  db.exec(mig('585_lovable_app_links.sql'));
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'fixture-cipher-key-'.repeat(4) } as any;
  const enc = await encryptCredentials(env, 'vc-d', { access_token: 'fixture_vercel_token', configuration_id: 'icfg_fixture', team_id: 'team_fixture' });
  db.prepare(`INSERT INTO integrations(id, uid, user_id, provider_key, auth_type, credentials_enc, config_json) VALUES (41, 'vc-d', 1, 'vercel', 'oauth2', ?, ?)`)
    .run(enc, JSON.stringify({ projects: ['prj_web'], project_id: 101 }));
  db.exec(`INSERT INTO integrations(id, uid, user_id, provider_key, auth_type) VALUES (31, 'gh-d', 1, 'github', 'oauth2');
    INSERT INTO integration_companies(integration_id, company_id, enabled) VALUES (41, 10, 1), (31, 10, 1);`);
  const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];
  const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
  return { db, env, all, one, row: () => one('SELECT * FROM integrations WHERE id = 41') };
}

/** A must-have GitHub fed from `repo#n`, with GitHub's merge SHA when given. */
function fedMustHave(db: DatabaseSync, id: number, repo: string, n: number, sha: string | null = null) {
  db.prepare(`INSERT INTO mvp_features(id, project_id, title, is_must_have, pr_state, merge_commit_sha, sort_order) VALUES (?, 101, ?, 1, 'built', ?, ?)`).run(id, `Feature ${id}`, sha, id);
  db.prepare(`INSERT INTO connector_fed_items(integration_id, project_id, module, kind, external_id, local_table, local_id) VALUES (31, 101, 'prototype_mvp', 'pull_request', ?, 'mvp_features', ?)`)
    .run(`pull:${repo}#${n}`, id);
}

let seq = 0;
/** One deployment row as the sync keeps it. */
function deploy(db: DatabaseSync, d: Partial<Record<string, unknown>> & { target: string; created_at: string }) {
  seq += 1;
  db.prepare(`INSERT INTO vercel_deployments (integration_id, project_id, vercel_project_id, deployment_id, target, state, created_at, ready_at, build_seconds,
      commit_sha, branch, pr_number, repository, is_rollback, promoted_at, preview_url)
    VALUES (41, 101, 'prj_web', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    String(d.deployment_id ?? `dpl_${seq}`), d.target, String(d.state ?? 'READY'), d.created_at, (d.ready_at as string) ?? null, (d.build_seconds as number) ?? null,
    (d.commit_sha as string) ?? null, (d.branch as string) ?? null, (d.pr_number as number) ?? null, (d.repository as string) ?? null,
    (d.is_rollback as number) ?? 0, (d.promoted_at as string) ?? null, (d.preview_url as string) ?? null);
}

function project(db: DatabaseSync, state = 'live') {
  db.exec(`INSERT INTO vercel_projects (integration_id, project_id, vercel_project_id, name, production_domain, live_state, live_since)
    VALUES (41, 101, 'prj_web', 'acme-web', 'app.acme.example', '${state}', '2026-10-20T09:00:00.000Z')`);
}

const app = (() => { const a = new Hono<any>(); a.route('/api/cycles/build', build); a.onError((e, c) => c.json({ error: e.message }, 500)); return a; })();
async function moduleRead(env: any, slug: string, user = 1) {
  const token = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request(`/api/cycles/build/modules/${slug}?project=101`, { headers: { Authorization: 'Bearer ' + token, 'X-Company-Id': '10' } }, env);
  return { status: r.status, body: await r.json() as any };
}

// ── what is kept ─────────────────────────────────────────────────────────────

test('a deployment keeps the full SHA, the PR number and repository; never its creator or commit message', () => {
  const r = deploymentRow({
    uid: 'dpl_1', target: 'production', readyState: 'READY', createdAt: NOW - 120_000, buildingAt: NOW - 100_000, ready: NOW - 10_000, url: 'acme-abc.vercel.app',
    creator: { uid: 'u1', username: 'someone' } as any,
    meta: { githubCommitSha: SHA_A.toUpperCase(), githubCommitRef: 'feature/x', githubPrId: '12', githubCommitOrg: 'Acme', githubCommitRepo: 'web', githubCommitMessage: 'never kept', githubCommitAuthorLogin: 'never-kept' },
  } as any, null)!;
  assert.equal(r.commit_sha, SHA_A, 'lowercased');
  assert.deepEqual([r.pr_number, r.repository, r.branch, r.build_seconds, r.preview_url], [12, 'Acme/web', 'feature/x', 90, null], 'a production deploy carries no preview link');
  assert.ok(!JSON.stringify(r).includes('never'), 'no commit message, no author');
  assert.ok(!JSON.stringify(r).includes('someone'), 'no creator');
  assert.equal(fullSha(SHA_A.slice(0, 7)), null, 'a short SHA never marks anything');
  const p = deploymentRow({ uid: 'dpl_2', target: null, state: 'BUILDING', created: NOW, url: 'Acme-Pr.vercel.app', meta: {} } as any, 'acme/web')!;
  assert.deepEqual([p.target, p.state, p.repository, p.preview_url, p.commit_sha], ['preview', 'BUILDING', 'acme/web', 'https://acme-pr.vercel.app', null]);
  assert.equal(deploymentRow({ target: 'production', createdAt: NOW } as any, null), null, 'no id: not kept');
});

// ── Prototype / MVP ──────────────────────────────────────────────────────────

test('a Preview chip is matched by repository and PR number only: never by branch, never by time', async () => {
  const w = await world();
  project(w.db);
  fedMustHave(w.db, 1, 'acme/web', 12);
  fedMustHave(w.db, 2, 'acme/web', 13);
  fedMustHave(w.db, 3, 'acme/api', 12);
  // Same repo and number, case aside: the chip. Newest first.
  deploy(w.db, { target: 'preview', created_at: '2026-10-19T10:00:00.000Z', pr_number: 12, repository: 'Acme/Web', state: 'ERROR', preview_url: 'https://old.vercel.app' });
  deploy(w.db, { target: 'preview', created_at: '2026-10-20T10:00:00.000Z', pr_number: 12, repository: 'acme/web', state: 'READY', preview_url: 'https://new.vercel.app' });
  // #13's branch, created right after its PR: no number, so no chip.
  deploy(w.db, { target: 'preview', created_at: '2026-10-20T11:00:00.000Z', branch: 'pull/13', repository: 'acme/web' });
  // Another repository's #13 is not acme/web#13.
  deploy(w.db, { target: 'preview', created_at: '2026-10-20T12:00:00.000Z', pr_number: 13, repository: 'acme/api' });
  const out = await mvpVercel(w.env, 101, true) as any;
  assert.equal(out.state, 'ok');
  const by = new Map(out.must_haves.map((m: any) => [m.feature_id, m]));
  assert.deepEqual([(by.get(1) as any).preview.state, (by.get(1) as any).preview.url], ['READY', 'https://new.vercel.app'], 'the newest preview of acme/web#12');
  assert.equal((by.get(2) as any).preview, null, 'a branch name or a time never matches');
  assert.match((by.get(2) as any).preview_reason, /^Not recorded: no preview deploy/);
  assert.equal((by.get(3) as any).preview, null, 'acme/api#12 has no preview: acme/web#12\'s is not its');
  assert.deepEqual(pullKey('pull:Acme/Web#12'), { repository: 'acme/web', number: 12 });
  assert.equal(pullKey('issue:acme/web#12'), null);
});

test('"In production since" only when a READY production deploy carries GitHub\'s merge SHA exactly', async () => {
  const w = await world();
  project(w.db);
  fedMustHave(w.db, 1, 'acme/web', 1, SHA_A);
  fedMustHave(w.db, 2, 'acme/web', 2, SHA_B);
  fedMustHave(w.db, 3, 'acme/web', 3, SHA_C);
  fedMustHave(w.db, 4, 'acme/web', 4, null);
  deploy(w.db, { target: 'production', created_at: '2026-10-18T10:00:00.000Z', ready_at: '2026-10-18T10:02:00.000Z', commit_sha: SHA_A });
  deploy(w.db, { target: 'production', created_at: '2026-10-19T10:00:00.000Z', ready_at: '2026-10-19T10:02:00.000Z', commit_sha: SHA_A });
  deploy(w.db, { target: 'production', created_at: '2026-10-19T11:00:00.000Z', state: 'ERROR', commit_sha: SHA_B });
  deploy(w.db, { target: 'preview', created_at: '2026-10-19T12:00:00.000Z', ready_at: '2026-10-19T12:01:00.000Z', commit_sha: SHA_C });
  const out = await mvpVercel(w.env, 101, true) as any;
  const by = new Map(out.must_haves.map((m: any) => [m.feature_id, m]));
  assert.equal((by.get(1) as any).in_production_since, '2026-10-18T10:02:00.000Z', 'the first READY production deploy of that SHA');
  assert.equal((by.get(2) as any).in_production_since, null, 'a failed deploy of the SHA is not in production');
  assert.equal((by.get(3) as any).in_production_since, null, 'a preview of the SHA is not in production');
  assert.match((by.get(3) as any).production_reason, /^No production deploy carries/);
  assert.equal((by.get(4) as any).in_production_since, null);
  assert.match((by.get(4) as any).production_reason, /^Needs the GitHub connection's commit links/);
});

test('the Live strip: live, failing and not deployed; names, domains and links only for the venture\'s members', async () => {
  const w = await world();
  project(w.db, 'failing');
  fedMustHave(w.db, 1, 'acme/web', 12);
  deploy(w.db, { target: 'production', created_at: '2026-10-20T10:00:00.000Z', state: 'ERROR', commit_sha: SHA_A, build_seconds: 31 });
  w.db.exec(`UPDATE vercel_deployments SET error_code = 'BUILD_FAILED'`);
  deploy(w.db, { target: 'preview', created_at: '2026-10-20T11:00:00.000Z', pr_number: 12, repository: 'acme/web', preview_url: 'https://pr12.vercel.app' });
  const mine = await mvpVercel(w.env, 101, true) as any;
  assert.deepEqual(mine.live, [{ state: 'failing', label: 'Failing', since: '2026-10-20T09:00:00.000Z', name: 'acme-web', domain: 'app.acme.example',
    commit: 'aaaaaaa', build_seconds: 31, error_code: 'BUILD_FAILED' }]);
  const theirs = await mvpVercel(w.env, 101, false) as any;
  assert.deepEqual([theirs.live[0].name, theirs.live[0].domain, theirs.must_haves[0].preview.url], [null, null, null], 'counts and states, never a name, a domain or a link');
  assert.equal(theirs.must_haves[0].preview.state, 'READY');
  // Through the module read: a member sees the name; someone outside the company does not reach the board at all.
  const { status, body } = await moduleRead(w.env, 'prototype-mvp');
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.parts.vercel.live[0].name, 'acme-web');
  assert.equal(body.parts.github.state, 'ok', 'GitHub\'s part stands beside it');
  assert.deepEqual([mine.must_haves[0].title, mine.must_haves[0].pr_state], ['Feature 1', 'built'], 'the must-have and GitHub\'s state beside its preview');
  assert.deepEqual(mine.connection, { as_of: null, reconnect: null });
  // VC5's Reconnect: Vercel's sign-in lapsed; the project is named for members only.
  w.db.exec(`UPDATE integrations SET status = 'error', last_error_at = '2026-10-20T08:00:00Z', last_synced_at = '2026-10-19T08:00:00Z' WHERE id = 41`);
  assert.deepEqual((await mvpVercel(w.env, 101, true) as any).connection, { as_of: '2026-10-19T08:00:00Z', reconnect: { since: '2026-10-20T08:00:00Z', project: 'acme-web' } });
  assert.equal((await mvpVercel(w.env, 101, false) as any).connection.reconnect.project, null);
  w.db.exec(`UPDATE vercel_projects SET live_state = 'not_deployed', live_since = NULL`);
  assert.deepEqual((await mvpVercel(w.env, 101, true) as any).live[0].label, 'Not deployed');
});

test('nothing from Vercel is empty with its reason; a store that cannot be read is Unreadable and the module still reads', async () => {
  const w = await world();
  const empty = await mvpVercel(w.env, 101, true) as any;
  assert.equal(empty.state, 'empty');
  assert.match(empty.reason, /^Vercel has not brought anything/);
  const old = await world({ withDeploys: false });
  project(old.db);
  const quiet = console.error; const logged: unknown[][] = []; console.error = (...a: unknown[]) => { logged.push(a); };
  try {
    for (const slug of ['prototype-mvp', 'product-roadmap']) {
      const { status, body } = await moduleRead(old.env, slug);
      assert.equal(status, 200, JSON.stringify(body));
      assert.deepEqual([body.parts.vercel.state, body.parts.vercel.reason], ['unreadable', 'What Vercel brought could not be read.'], slug);
      assert.notEqual(body.card.state, 'unreadable', `${slug} still reads`);
      assert.equal(body.parts.vercel.weeks, undefined, 'no zero stands in for an unread count');
    }
    assert.ok(logged.every((a) => !JSON.stringify(a).includes('acme')), 'the log names the module only');
  } finally { console.error = quiet; }
});

test('one Live line per host: a Lovable app on a Vercel production domain is Vercel\'s line, drawn once (D1083, D1311)', async () => {
  const w = await world();
  project(w.db);
  w.db.exec(`INSERT INTO lovable_app_links (uid, project_id, module, record_table, record_id, app_url, last_status, checked_at)
    VALUES ('lov-1', 101, 'prototype-mvp', 'projects', 101, 'https://App.Acme.example/', 'live', '2026-10-23T14:05:00Z')`);
  const { status, body } = await moduleRead(w.env, 'prototype-mvp');
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.parts.vercel.live.map((l: any) => [l.domain, l.label]), [['app.acme.example', 'Live']], 'Vercel draws the Live line');
  assert.equal(body.parts.lovable.slots[0].link.hosted_on, 'vercel', 'From Lovable reads "Hosted on Vercel" and draws no Live line of its own');
  // Another host is Lovable's own line; a project name never matches.
  w.db.exec(`UPDATE lovable_app_links SET app_url = 'https://www.app.acme.example'`);
  assert.equal((await moduleRead(w.env, 'prototype-mvp')).body.parts.lovable.slots[0].link.hosted_on, null);
  w.db.exec(`UPDATE lovable_app_links SET app_url = 'https://acme-web.lovable.app'`);
  assert.equal((await moduleRead(w.env, 'prototype-mvp')).body.parts.lovable.slots[0].link.hosted_on, null);
  // An unchosen project's domain claims nothing.
  w.db.exec(`UPDATE lovable_app_links SET app_url = 'https://app.acme.example'; DELETE FROM vercel_projects`);
  assert.equal((await moduleRead(w.env, 'prototype-mvp')).body.parts.lovable.slots[0].link.hosted_on, null);
});

// ── Product roadmap ──────────────────────────────────────────────────────────

test('the Deploys strip: 12 weeks, null before the first deploy, the failed share, the median build, rollbacks and promotions', async () => {
  const w = await world();
  project(w.db);
  const thisWeek = weekStart(NOW);
  const at = (weeksAgo: number, h = 10) => new Date(thisWeek - weeksAgo * 7 * DAY + h * 3_600_000).toISOString();
  deploy(w.db, { target: 'production', created_at: at(3), build_seconds: 60 });
  deploy(w.db, { target: 'production', created_at: at(3, 11), state: 'ERROR' });
  deploy(w.db, { target: 'production', created_at: at(1), build_seconds: 100 });
  deploy(w.db, { target: 'production', created_at: at(0), build_seconds: 30, is_rollback: 1 });
  deploy(w.db, { target: 'production', created_at: at(0, 12), state: 'BUILDING' });
  deploy(w.db, { target: 'production', created_at: at(0, 13), build_seconds: 40, promoted_at: at(0, 14) });
  deploy(w.db, { target: 'preview', created_at: at(0, 15), build_seconds: 999 });
  const out = await roadmapVercel(w.env, 101, 12, true, NOW) as any;
  assert.equal(out.weeks.length, DEPLOY_WEEKS);
  assert.deepEqual(out.weeks.map((x: any) => x.count), [null, null, null, null, null, null, null, null, 2, 0, 1, 3 + 0],
    'before the first deploy: not measured; after it, a quiet week is a measured 0; a preview is not a production deploy');
  assert.equal(out.weeks.at(-1).week_of, new Date(thisWeek).toISOString().slice(0, 10));
  assert.equal(out.failed_share, 20, '1 of the 5 finished failed; the one still building is not finished');
  assert.equal(out.median_build_seconds, 50, 'READY production builds 30, 40, 60, 100');
  assert.deepEqual(out.events.map((e: any) => e.kind), ['rollback', 'promotion']);
  assert.equal(median([]), null);
  const quiet = await world();
  project(quiet.db);
  const none = await roadmapVercel(quiet.env, 101, 12, true, NOW) as any;
  assert.deepEqual([none.weeks.every((x: any) => x.count === null), none.failed_share, none.median_build_seconds], [true, null, null], 'nothing read: nothing drawn as zero');
  assert.match(none.failed_reason, /^No production deploy finished/);
  assert.equal(none.median_reason, 'Not recorded: no build finished in the last 12 weeks.');
  assert.equal(out.median_reason, null);
});

test('a release is "Live on" only when a READY production deploy carries its tag\'s SHA exactly', async () => {
  const w = await world();
  project(w.db);
  w.db.exec(`INSERT INTO roadmap_releases(id, project_id, repository, tag, published_at, commit_sha) VALUES
    (1, 101, 'acme/web', 'v1.0', '2026-10-01T00:00:00Z', '${SHA_A}'),
    (2, 101, 'acme/web', 'v1.1', '2026-10-10T00:00:00Z', '${SHA_B}'),
    (3, 101, 'acme/web', 'v1.2', '2026-10-15T00:00:00Z', NULL)`);
  deploy(w.db, { target: 'production', created_at: '2026-10-02T10:00:00.000Z', ready_at: '2026-10-02T10:03:00.000Z', commit_sha: SHA_A });
  deploy(w.db, { target: 'production', created_at: '2026-10-11T10:00:00.000Z', state: 'ERROR', commit_sha: SHA_B });
  deploy(w.db, { target: 'preview', created_at: '2026-10-11T11:00:00.000Z', ready_at: '2026-10-11T11:01:00.000Z', commit_sha: SHA_B });
  const out = await roadmapVercel(w.env, 101, 12, true, NOW) as any;
  assert.deepEqual(out.releases.map((r: any) => [r.release_id, r.tag, r.state, r.live_on]), [
    [3, 'v1.2', 'needs_github', null], [2, 'v1.1', 'no_match', null], [1, 'v1.0', 'live', '2026-10-02T10:03:00.000Z'],
  ], 'newest first, as GitHub\'s strip lists them');
  const { body } = await moduleRead(w.env, 'product-roadmap');
  assert.equal(body.parts.vercel.releases[2].live_on, '2026-10-02T10:03:00.000Z');
  assert.deepEqual(body.parts.github.releases.map((r: any) => r.id), out.releases.map((r: any) => r.release_id), 'the same releases, in the same order');
});

// ── the sync ─────────────────────────────────────────────────────────────────

const PROJECT = { id: 'prj_web', name: 'acme-web', link: { type: 'github', org: 'acme', repo: 'web', productionBranch: 'main' },
  targets: { production: { id: 'dpl_p1', readyState: 'READY', ready: NOW - DAY } } };
const vd = (uid: string, ms: number, extra: Record<string, unknown> = {}) =>
  ({ uid, readyState: 'READY', target: 'production', createdAt: ms, buildingAt: ms + 1000, ready: ms + 61_000, url: `${uid}.vercel.app`, meta: { githubCommitSha: SHA_A }, ...extra });

async function synced(w: Awaited<ReturnType<typeof world>>, deployments: unknown[]) {
  const f = fakeVercel({ projects: [PROJECT], deployments: { prj_web: deployments } as any });
  const real = globalThis.fetch;
  globalThis.fetch = f.fetch as typeof fetch;
  try { return { out: await syncVercel(w.env, w.row()), f }; } finally { globalThis.fetch = real; }
}
const snapshot = (w: Awaited<ReturnType<typeof world>>) =>
  ['mvp_features', 'roadmap_okrs', 'roadmap_releases', 'mvp_release_checks'].map((t) => JSON.stringify(w.all(`SELECT * FROM ${t} ORDER BY id`)));

test('no Vercel sync touches a must-have, a roadmap item, a release or a release check', async () => {
  const w = await world();
  fedMustHave(w.db, 1, 'acme/web', 12, SHA_A);
  w.db.exec(`INSERT INTO roadmap_okrs(id, project_id, objective, kanban_status) VALUES (5, 101, 'Ship it', 'now');
    INSERT INTO roadmap_releases(id, project_id, repository, tag, published_at, commit_sha) VALUES (1, 101, 'acme/web', 'v1.0', '2026-10-01T00:00:00Z', '${SHA_A}');
    INSERT INTO mvp_release_checks(release_id, feature_id, label, in_release) VALUES (1, 1, 'v1.0', 1);`);
  const before = snapshot(w);
  const { out, f } = await synced(w, [vd('dpl_p1', NOW - DAY), vd('dpl_pr', NOW - 2 * DAY, { target: null, meta: { githubCommitSha: SHA_A, githubPrId: '12', githubCommitOrg: 'acme', githubCommitRepo: 'web' } })]);
  assert.equal(out.counts.deployments, 2);
  assert.deepEqual(snapshot(w), before, 'the four tables are byte-for-byte what they were');
  assert.ok(f.calls.every((x: any) => x.method === 'GET'), 'the sync only reads');
  assert.deepEqual(w.all(`SELECT external_id, module, kind, local_table FROM connector_fed_items WHERE integration_id = 41 ORDER BY external_id`).map((r) => ({ ...r })), [
    { external_id: 'deploy:dpl_p1', module: 'product_roadmap', kind: 'deployment', local_table: 'vercel_deployments' },
    { external_id: 'deploy:dpl_pr', module: 'prototype_mvp', kind: 'deployment', local_table: 'vercel_deployments' },
  ]);
  // A second sync updates in place: no second row.
  await synced(w, [vd('dpl_p1', NOW - DAY, { readyState: 'ERROR' })]);
  assert.deepEqual(w.all('SELECT deployment_id, state FROM vercel_deployments ORDER BY deployment_id').map((r) => ({ ...r })), [{ deployment_id: 'dpl_p1', state: 'ERROR' }, { deployment_id: 'dpl_pr', state: 'READY' }]);
  assert.deepEqual(snapshot(w), before);
});

test('retention keeps 180 days or the newest 500; a removed deployment stays removed, and unchoosing a project is not removing', async () => {
  const w = await world();
  const real = Date.now();
  await synced(w, [vd('dpl_new', real - DAY), vd('dpl_old', real - 181 * DAY)]);
  assert.deepEqual(w.all('SELECT deployment_id FROM vercel_deployments').map((r) => r.deployment_id), ['dpl_new'], 'older than 180 days is not kept');
  assert.deepEqual({ ...w.one(`SELECT local_table, local_id FROM connector_fed_items WHERE external_id = 'deploy:dpl_old'`) }, { local_table: null, local_id: null });
  // Removed by hand: the next sync does not bring it back.
  w.db.exec(`DELETE FROM vercel_deployments WHERE deployment_id = 'dpl_new'`);
  await synced(w, [vd('dpl_new', real - DAY), vd('dpl_old', real - 181 * DAY), vd('dpl_next', real - 3_600_000)]);
  assert.deepEqual(w.all('SELECT deployment_id FROM vercel_deployments').map((r) => r.deployment_id), ['dpl_next'], 'a deleted deployment stays deleted');
  // Unchoose, then choose again: the project's deployments come back.
  w.db.exec(`UPDATE integrations SET config_json = '{"projects":[],"project_id":101}' WHERE id = 41`);
  await (async () => { const { pruneDeployments } = await import('../src/services/vercel/deployments.ts'); await pruneDeployments(w.env, 41, 101, []); })();
  assert.equal(w.one('SELECT COUNT(*) AS n FROM vercel_deployments').n, 0);
  w.db.exec(`UPDATE integrations SET config_json = '{"projects":["prj_web"],"project_id":101}' WHERE id = 41`);
  await synced(w, [vd('dpl_next', real - 3_600_000)]);
  assert.deepEqual(w.all('SELECT deployment_id FROM vercel_deployments').map((r) => r.deployment_id), ['dpl_next']);
  // The newest 500 per venture.
  const stmt = w.db.prepare(`INSERT INTO vercel_deployments (integration_id, project_id, vercel_project_id, deployment_id, target, state, created_at) VALUES (41, 101, 'prj_web', ?, 'production', 'READY', ?)`);
  for (let i = 0; i < KEEP_NEWEST + 5; i += 1) stmt.run(`dpl_bulk_${i}`, new Date(real - (i + 2) * 3_600_000).toISOString());
  await retainDeployments(w.env, 41, 101, real);
  assert.equal(w.one('SELECT COUNT(*) AS n FROM vercel_deployments').n, KEEP_NEWEST);
  assert.equal(w.one(`SELECT COUNT(*) AS n FROM vercel_deployments WHERE deployment_id = 'dpl_next'`).n, 1, 'the newest is kept');
});

test('the sync reads at most two pages per project, following Vercel\'s `until`', async () => {
  const w = await world();
  const real = Date.now();
  const list = Array.from({ length: 250 }, (_, i) => vd(`dpl_${i}`, real - (i + 1) * 60_000));
  const { out, f } = await synced(w, list);
  assert.equal(f.calls.filter((x: any) => x.path === '/v7/deployments').length, 2);
  assert.equal(out.counts.deployments, 200, 'the newest 200');
});

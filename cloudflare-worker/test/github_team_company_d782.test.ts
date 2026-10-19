/**
 * D782 (#2115): GitHub feeds Build › Founding team and Company creation.
 *
 * - Founding team: each repository's contributors and their commits in the
 *   last 90 days land per login; bots are left out. Only the project's members
 *   read a login or a count. The founder maps a login to a founder once; a
 *   login is never attached by the code, and only one a sync brought may be
 *   mapped, and only to the venture's own founder. A mapped login counts as
 *   fed; unmapping undoes it.
 * - Company creation: a repository a personal account owns proposes the IP
 *   step once; Accept makes the formation step and its ledger row, Dismiss
 *   keeps it away for good. One an organisation owns records evidence on the
 *   IP assignment step and withdraws a pending proposal. No licence is said
 *   as a fact.
 * - Disconnecting deletes the connection's logins and owner facts; the
 *   founder's mapping stays.
 *
 * Real SQL on node:sqlite and real JWT routes; GitHub is stubbed. Each case
 * names the mutations it was checked against.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/github_team_company_d782.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import { fedCounts } from '../src/integrations/fed.ts';
import {
  COMMIT_WINDOW_DAYS, MAX_LOGINS, commitsByLogin, deleteContributorsOf, loginKey, syncTeam, teamLogins,
} from '../src/integrations/providers/github/team.ts';
import { MOVE_STEP_TITLE, deleteFactsOf, isIpAssignmentStep, repoFacts, syncCompany } from '../src/integrations/providers/github/company.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'x'.repeat(64); // synthetic test fixture
const mig = (n: string) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, founder_id INTEGER, spinout_lab_active INTEGER DEFAULT 0, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0, subscription_tier TEXT DEFAULT 'free');
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, incorporation_meta TEXT, cofounder_decision_meta TEXT, deleted_at TEXT);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, display_name TEXT, status TEXT DEFAULT 'active', auth_type TEXT,
      credentials_enc TEXT, config_json TEXT, last_synced_at TEXT, last_error_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_companies(integration_id INTEGER, company_id INTEGER, enabled INTEGER DEFAULT 1);
    CREATE TABLE mvp_features(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, added_value TEXT DEFAULT 'High', effort TEXT DEFAULT 'M', delivery_status TEXT DEFAULT 'Backlog', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE pain_groups(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT);
    CREATE TABLE hypotheses(id INTEGER PRIMARY KEY, project_id INTEGER, claim TEXT);
    CREATE TABLE roadmap_okrs(id INTEGER PRIMARY KEY, project_id INTEGER, objective TEXT, kanban_status TEXT, sort_order INTEGER DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE okr_column_moves(id INTEGER PRIMARY KEY, project_id INTEGER, okr_id INTEGER, to_status TEXT, moved_at TEXT);
    CREATE TABLE spinout_applications(id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, answers_json TEXT);
    CREATE TABLE ritual_runs(id INTEGER PRIMARY KEY, project_id INTEGER, run_date TEXT, state TEXT);
    CREATE TABLE cap_table_holders(id INTEGER PRIMARY KEY, user_id INTEGER, project_id INTEGER, name TEXT, shares REAL, ownership_pct REAL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE cap_table_vesting(id INTEGER PRIMARY KEY, user_id INTEGER, holder_id INTEGER, start_date TEXT, cliff_months INTEGER, total_months INTEGER, vested_shares REAL);
    CREATE TABLE cap_table_scenarios(id INTEGER PRIMARY KEY, project_id INTEGER, is_variant INTEGER DEFAULT 0, inputs_json TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE documents(id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, template_name TEXT, created_at TEXT);
    CREATE TABLE cofounder_agreement_parties(id INTEGER PRIMARY KEY, document_id INTEGER, user_id INTEGER);
    CREATE TABLE entity_obligations(id INTEGER PRIMARY KEY, entity_id INTEGER, title TEXT, due_date TEXT, status TEXT, kind TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE entities(id INTEGER PRIMARY KEY, jurisdiction TEXT);
    CREATE TABLE incorporations(id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, paid_at TEXT, packet_ready_at TEXT, filed_on TEXT, jurisdiction_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, action TEXT, details TEXT, actor TEXT, entity_type TEXT, entity_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id, role, founder_id, name, email) VALUES (1, 'founder', 11, 'One', 'one@example.test'), (2, 'founder', 22, 'Two', 'two@example.test'), (4, 'partner', NULL, 'Partner', 'partner@example.test');
    INSERT INTO company_profiles VALUES (10), (20);
    INSERT INTO projects(id, founder_id, company_id) VALUES (101, 11, 10), (202, 22, 20);
    INSERT INTO user_company_links VALUES (1, 10), (2, 20);
  `);
  for (const m of ['441_build_cycle_stores.sql', '445_connector_fed_items.sql', '459_cycle_activity_convention.sql', '461_build_record_stores.sql', '501_github_team_company.sql']) db.exec(mig(m));
  db.exec(`INSERT INTO integrations(id, uid, user_id, provider_key, status, auth_type, config_json)
      VALUES (31, 'gh-one', 1, 'github', 'active', 'oauth2', '${JSON.stringify({ repositories: ['acme/app'], project_id: 101 })}');
    INSERT INTO integration_companies(integration_id, company_id, enabled) VALUES (31, 10, 1);
    INSERT INTO cap_table_holders(id, user_id, project_id, name, ownership_pct, founder_role) VALUES (7, 1, 101, 'Ada', 60, 'CEO'), (8, NULL, 101, 'Investor', 10, NULL), (9, 2, 202, 'Bo', 100, 'CEO');`);
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any;
  const one = (sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any;
  const all = (sql: string, ...args: any[]) => db.prepare(sql).all(...args).map((r: any) => ({ ...r }));
  return { db, env, one, all };
}

const app = (() => {
  const a = new Hono<any>();
  a.route('/api/cycles/build', build);
  a.onError((e, c) => c.json({ error: e.message }, 500));
  return a;
})();
async function call(env: any, path: string, id = 1, method = 'GET', body?: unknown) {
  const token = await new SignJWT({ user_id: id, role: id === 4 ? 'partner' : 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request(path, { method, headers: { Authorization: 'Bearer ' + token, 'X-Company-Id': id === 2 ? '20' : '10', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, env);
  return { status: r.status, text: await r.text() };
}
const json = (r: { text: string }) => JSON.parse(r.text);
const part = async (env: any, slug: 'founding-team' | 'company-creation', id = 1) => json(await call(env, `/api/cycles/build/modules/${slug}?project=101`, id)).parts.github;

// ───────────────────────────────────────────── a stubbed GitHub

type Fake = { owner?: { login: string; type: 'User' | 'Organization' }; license?: string | null; contributors?: unknown[]; commits?: unknown[]; status?: number };
/** GitHub's REST API for one repository: itself, its contributors and its commits (100 a page). `calls` is every path asked for. */
function fake(name: string, repo: Fake) {
  const calls: string[] = [];
  const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const get = async (path: string) => {
    calls.push(path);
    if (repo.status) return res({ message: 'x' }, repo.status);
    const u = new URL(`https://api.github.com${path}`);
    const p = decodeURIComponent(u.pathname);
    if (p === `/repos/${name}`) return res({ full_name: name, owner: repo.owner ?? { login: 'ada', type: 'User' }, license: repo.license == null ? null : { spdx_id: repo.license } });
    if (p === `/repos/${name}/contributors`) return res(repo.contributors ?? []);
    if (p === `/repos/${name}/commits`) {
      const page = Number(u.searchParams.get('page') || 1);
      return res((repo.commits ?? []).slice((page - 1) * 100, page * 100));
    }
    return res({ message: 'Not Found' }, 404);
  };
  return { get, calls };
}
const commit = (login: string | null, type = 'User') => ({ sha: 'x', author: login == null ? null : { login, type } });
const user = (login: string, type = 'User') => ({ login, type, contributions: 3 });

// ───────────────────────────────────────────── pure rules

test('logins: lower-cased and checked; bots and author-less commits are not people; contributors and recent authors, most active first', () => {
  // Mutations checked: the bot rule dropped; a commit with no GitHub author counted; the cap dropped.
  assert.equal(loginKey(' Ada-L '), 'ada-l');
  for (const bad of ['', '-ada', 'a b', 'x'.repeat(40), null, 7]) assert.equal(loginKey(bad), null, String(bad));
  const recent = commitsByLogin([[commit('Ada'), commit('ada'), commit('bo'), commit(null), commit('dependabot[bot]', 'User'), commit('ci', 'Bot')]]);
  assert.deepEqual([...recent], [['ada', 2], ['bo', 1]]);
  assert.deepEqual(teamLogins([user('cy'), user('renovate[bot]'), user('ada')], recent), [{ login: 'ada', commits: 2 }, { login: 'bo', commits: 1 }, { login: 'cy', commits: 0 }]);
  const many = new Map([...Array(MAX_LOGINS + 5).keys()].map((i) => [`u${i}`, i]));
  assert.equal(teamLogins([], many).length, MAX_LOGINS);
});

test('the IP assignment step is one whose title names IP assignment; a repository\'s facts are its owner\'s kind and its licence', () => {
  // Mutations checked: any title matched; an organisation read as personal; "NOASSERTION" or a missing licence confused.
  for (const t of ['IP assignment', 'Sign the IP assignment agreement', 'Assignment of intellectual property', 'Assign IP to the company']) assert.equal(isIpAssignmentStep(t), true, t);
  for (const t of ['File the 83(b)', 'EIN', 'Pay the franchise tax', MOVE_STEP_TITLE]) assert.equal(isIpAssignmentStep(t), false, t);
  assert.deepEqual(repoFacts({ owner: { login: 'acme', type: 'Organization' }, license: { spdx_id: 'MIT' } }), { owner_kind: 'organisation', owner_login: 'acme', licence: 'MIT' });
  assert.deepEqual(repoFacts({ owner: { login: 'ada', type: 'User' }, license: null }), { owner_kind: 'personal', owner_login: 'ada', licence: null });
  assert.equal(repoFacts({}), null);
});

// ───────────────────────────────────────────── Founding team

test('the sync lands each login with its commits in the last 90 days; a re-sync updates and drops a login it no longer sees', async () => {
  // Mutations checked: the window not 90 days; a gone login kept; the 409 of an empty repository thrown.
  const { env, all } = fixture();
  const now = new Date('2026-10-19T12:00:00Z');
  const gh = fake('acme/app', { contributors: [user('ada'), user('cy'), user('bot[bot]', 'Bot')], commits: [commit('ada'), commit('ada'), commit('bo')] });
  assert.deepEqual(await syncTeam(env, 31, 101, gh.get, ['acme/app'], 100, now), { contributors: 3 });
  const since = new URL(`https://x${gh.calls.find((c) => c.includes('/commits'))}`).searchParams.get('since');
  assert.equal(new Date(String(since)).getTime(), now.getTime() - COMMIT_WINDOW_DAYS * 86_400_000);
  assert.deepEqual(all('SELECT login, commits_90d FROM github_contributors ORDER BY login'), [
    { login: 'ada', commits_90d: 2 }, { login: 'bo', commits_90d: 1 }, { login: 'cy', commits_90d: 0 },
  ]);
  const again = fake('acme/app', { contributors: [user('ada')], commits: [commit('ada')] });
  await syncTeam(env, 31, 101, again.get, ['acme/app'], 100, now);
  assert.deepEqual(all('SELECT login, commits_90d FROM github_contributors'), [{ login: 'ada', commits_90d: 1 }]);
  const empty = fake('acme/app', { status: 409 });
  assert.deepEqual(await syncTeam(env, 31, 101, empty.get, ['acme/app'], 100, now), { contributors: 0 });
  assert.deepEqual(await syncTeam(env, 31, 101, again.get, ['acme/app'], 2, now), { contributors: 0, partial: true }, 'the budget stops it');
});

test('only the project\'s members read a login or a count; anyone else reads how many, never which', async () => {
  // Mutations checked: the member check dropped; a non-member handed the unmatched logins.
  const { env } = fixture();
  await syncTeam(env, 31, 101, fake('acme/app', { contributors: [user('ada'), user('secret-login')], commits: [commit('ada')] }).get, ['acme/app'], 100);
  const own = await part(env, 'founding-team', 1);
  assert.equal(own.state, 'ok');
  assert.equal(own.members_only, false);
  assert.deepEqual(own.unmatched.map((u: any) => u.login).sort(), ['ada', 'secret-login']);
  assert.deepEqual(own.founders, [{ record_id: 'h-7', holder_id: 7, name: 'Ada' }], 'only founders, never the investor');
  const partner = await call(env, '/api/cycles/build/modules/founding-team?project=101', 4);
  assert.equal(partner.status, 200);
  const theirs = json(partner).parts.github;
  assert.deepEqual({ members_only: theirs.members_only, logins: theirs.logins, unmatched: theirs.unmatched, builds: theirs.builds }, { members_only: true, logins: 2, unmatched: [], builds: [] });
  assert.doesNotMatch(partner.text, /secret-login/);
});

test('the founder maps a login to a founder once: only a login a sync brought, only to the venture\'s own founder; it then counts as fed, and unmapping undoes it', async () => {
  // Mutations checked: an unseen login mapped; another venture's holder accepted; a non-founder holder accepted; the ledger row not written; a re-sync's ledger row for a mapped login not written; the login in the activity line.
  const { db, env, all, one } = fixture();
  await syncTeam(env, 31, 101, fake('acme/app', { contributors: [user('ada')], commits: [commit('ada'), commit('ada')] }).get, ['acme/app'], 100);
  const map = (body: unknown, user = 1) => call(env, '/api/cycles/build/founding-team/github-logins?project=101', user, 'POST', body);
  assert.equal((await map({ login: 'never-synced', holder_id: 7 })).status, 404);
  assert.equal((await map({ login: 'ada', holder_id: 9 })).status, 404, 'another venture\'s founder');
  assert.equal((await map({ login: 'ada', holder_id: 8 })).status, 404, 'not a founder');
  assert.equal((await map({ login: 'ada', holder_id: 7 }, 2)).status, 403, 'not this venture\'s founder');
  assert.equal(all('SELECT * FROM github_login_map').length, 0, 'nothing was attached');
  assert.equal((await map({ login: 'Ada', holder_id: 7 })).status, 200);
  const own = await part(env, 'founding-team');
  assert.deepEqual(own.builds, [{ record_id: 'h-7', repositories: [{ repository: 'acme/app', commits_90d: 2, login: 'ada' }] }]);
  assert.deepEqual(own.unmatched, []);
  const fed = (await fedCounts(env, 31, 'github', null, 101)).find((m) => m.module === 'founding_team');
  assert.equal(fed?.count, 1, 'a mapped contributor counts as fed');
  assert.equal(one("SELECT local_table, local_id FROM connector_fed_items WHERE kind = 'contributor'").local_id, 7);
  const log = all("SELECT details FROM activity_logs WHERE action = 'build_github_login_matched'");
  assert.equal(log.length, 1);
  assert.doesNotMatch(JSON.stringify(log), /ada/i, 'the activity line never names the login');

  // A re-sync keeps the mapping and its ledger row.
  await syncTeam(env, 31, 101, fake('acme/app', { contributors: [user('ada')], commits: [commit('ada')] }).get, ['acme/app'], 100);
  assert.equal((await part(env, 'founding-team')).builds[0].repositories[0].commits_90d, 1);
  // A second connection that brings the mapped login links it to its founder too: the mapping is the project's.
  db.exec(`INSERT INTO integrations(id, uid, user_id, provider_key, status, auth_type, config_json) VALUES (32, 'gh-two', 1, 'github', 'active', 'oauth2', '{}')`);
  await syncTeam(env, 32, 101, fake('acme/site', { contributors: [user('ada')], commits: [commit('ada')] }).get, ['acme/site'], 100);
  assert.equal(one("SELECT local_id FROM connector_fed_items WHERE integration_id = 32 AND kind = 'contributor'")?.local_id, 7);
  db.exec('DELETE FROM github_contributors WHERE integration_id = 32; DELETE FROM connector_fed_items WHERE integration_id = 32; DELETE FROM integrations WHERE id = 32');

  assert.equal((await call(env, '/api/cycles/build/founding-team/github-logins/ada?project=101', 1, 'DELETE')).status, 200);
  assert.deepEqual((await part(env, 'founding-team')).unmatched.map((u: any) => u.login), ['ada']);
  assert.equal(all("SELECT * FROM connector_fed_items WHERE kind = 'contributor'").length, 0);
  assert.equal((await call(env, '/api/cycles/build/founding-team/github-logins/ada?project=101', 1, 'DELETE')).status, 404);
});

// ───────────────────────────────────────────── Company creation

test('a personal account\'s repository proposes the IP step once; Dismiss keeps it away; Accept makes the formation step and its ledger row', async () => {
  // Mutations checked: the proposal made again on a re-sync; a dismissed proposal brought back; Accept without its ledger row; Accept twice.
  const { env, all, one } = fixture();
  const personal = fake('acme/app', { owner: { login: 'ada', type: 'User' }, license: null });
  assert.deepEqual(await syncCompany(env, 31, 101, personal.get, ['acme/app'], 100), { ip_proposals: 1 });
  assert.deepEqual(await syncCompany(env, 31, 101, personal.get, ['acme/app'], 100), { ip_proposals: 0 }, 'proposed once');
  const own = await part(env, 'company-creation');
  assert.deepEqual(own.repositories.map((r: any) => [r.repository, r.owner_kind, r.owner, r.licence, r.licence_note]), [['acme/app', 'personal', 'ada', null, 'No licence file']]);
  assert.equal(own.proposals.length, 1);
  assert.equal(own.proposals[0].title, MOVE_STEP_TITLE);
  assert.match(own.proposals[0].reason, /IP/);
  assert.equal(all('SELECT * FROM formation_steps').length, 0, 'nothing is written before Accept');
  const id = own.proposals[0].id;
  const decide = (how: string, user = 1) => call(env, `/api/cycles/build/company-creation/proposals/${id}/${how}?project=101`, user, 'POST');
  assert.equal((await decide('accept', 2)).status, 403);
  assert.equal((await decide('accept')).status, 200);
  assert.equal((await decide('accept')).status, 409);
  assert.deepEqual(all('SELECT title, state, kind FROM formation_steps'), [{ title: MOVE_STEP_TITLE, state: 'todo', kind: 'other' }]);
  const ledger = one("SELECT module, local_table, local_id FROM connector_fed_items WHERE kind = 'ip_step'");
  assert.deepEqual({ ...ledger }, { module: 'company_creation', local_table: 'formation_steps', local_id: one('SELECT id FROM formation_steps').id });
  assert.equal((await fedCounts(env, 31, 'github', null, 101)).find((m) => m.module === 'company_creation')?.count, 1);
  await syncCompany(env, 31, 101, personal.get, ['acme/app'], 100);
  assert.equal((await part(env, 'company-creation')).proposals.length, 0, 'an accepted one is not proposed again');

  // Another repository, dismissed, stays dismissed.
  const second = fake('ada/side', { owner: { login: 'ada', type: 'User' }, license: 'MIT' });
  await syncCompany(env, 31, 101, second.get, ['ada/side'], 100);
  const pid = (await part(env, 'company-creation')).proposals[0].id;
  assert.equal((await call(env, `/api/cycles/build/company-creation/proposals/${pid}/dismiss?project=101`, 1, 'POST')).status, 200);
  await syncCompany(env, 31, 101, second.get, ['ada/side'], 100);
  assert.equal((await part(env, 'company-creation')).proposals.length, 0);
});

test('an organisation\'s repository records evidence on the IP assignment step and withdraws a pending proposal; a non-member reads no repository', async () => {
  // Mutations checked: the evidence on any step; a pending proposal kept after the move; the owner shown to a non-member.
  const { env, all, db } = fixture();
  await syncCompany(env, 31, 101, fake('acme/app', { owner: { login: 'ada', type: 'User' } }).get, ['acme/app'], 100);
  assert.equal(all("SELECT * FROM company_creation_proposals WHERE status = 'pending'").length, 1);
  db.exec(`INSERT INTO formation_steps(id, project_id, title, state, created_by) VALUES (51, 101, 'Sign the IP assignment', 'todo', 1), (52, 101, 'File the 83(b)', 'todo', 1)`);
  await syncCompany(env, 31, 101, fake('acme/app', { owner: { login: 'acme', type: 'Organization' }, license: 'Apache-2.0' }).get, ['acme/app'], 100);
  assert.equal(all("SELECT * FROM company_creation_proposals WHERE status = 'pending'").length, 0, 'the move happened');
  assert.deepEqual(all('SELECT step_id, key FROM formation_step_checks'), [{ step_id: 51, key: 'github_org:acme/app' }]);
  const own = await part(env, 'company-creation');
  assert.deepEqual(own.evidence, [{ record_id: 'step-51', step: 'Sign the IP assignment', repository: 'acme/app' }]);
  assert.equal(own.repositories[0].licence_note, null);
  const partner = await call(env, '/api/cycles/build/modules/company-creation?project=101', 4);
  const theirs = json(partner).parts.github;
  assert.deepEqual({ members_only: theirs.members_only, total: theirs.repositories_total, repositories: theirs.repositories }, { members_only: true, total: 1, repositories: [] });
  assert.doesNotMatch(partner.text, /acme\/app/);
});

// ───────────────────────────────────────────── the connection

test('disconnecting deletes the connection\'s logins and owner facts, and the logins\' ledger rows; the founder\'s mapping stays', async () => {
  // Mutations checked: the contributors kept; the owner facts kept; the mapping deleted with them; github.ts not calling either.
  const { env, all } = fixture();
  await syncTeam(env, 31, 101, fake('acme/app', { contributors: [user('ada'), user('cy')] }).get, ['acme/app'], 100);
  await syncCompany(env, 31, 101, fake('acme/app', { owner: { login: 'ada', type: 'User' } }).get, ['acme/app'], 100);
  await call(env, '/api/cycles/build/founding-team/github-logins?project=101', 1, 'POST', { login: 'ada', holder_id: 7 });
  await deleteContributorsOf(env, 31);
  await deleteFactsOf(env, 31);
  assert.deepEqual(all('SELECT * FROM github_contributors'), []);
  assert.deepEqual(all('SELECT * FROM github_repo_facts'), []);
  assert.deepEqual(all("SELECT * FROM company_creation_proposals WHERE status = 'pending'"), []);
  assert.deepEqual(all("SELECT * FROM connector_fed_items WHERE kind = 'contributor'"), []);
  assert.deepEqual(all('SELECT login, holder_id FROM github_login_map'), [{ login: 'ada', holder_id: 7 }], 'the mapping is the founder\'s');
  const src = readFileSync('cloudflare-worker/src/integrations/providers/github.ts', 'utf8');
  assert.match(src, /await Promise\.allSettled\(\[deleteContributorsOf\(c\.env, row\.id\), deleteFactsOf\(c\.env, row\.id\)\]\);/);
  assert.equal((src.match(/await syncTeam\(/g) || []).length, 1, 'one call in the sync');
  assert.equal((src.match(/await syncCompany\(/g) || []).length, 1, 'one call in the sync');
  const sql = readFileSync('cloudflare-worker/sql/migrations/501_github_team_company.sql', 'utf8');
  assert.match(sql, /github_contributors \([\s\S]*?integration_id INTEGER NOT NULL REFERENCES integrations\(id\) ON DELETE CASCADE/);
});

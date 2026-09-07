/**
 * Task #55 — the founder→advisor grant, and the four properties that make it
 * safe to have built at all.
 *
 * THE GRANT IS THE FIRST TIME AN ADVISOR CAN READ A FOUNDER'S RECORD. Until
 * migration 218 the answer was structural: `canAccessFounderResource` admits
 * admin, partner and the owning founder, and an advisor matches no branch. So
 * every assertion here is about the fence that replaces that structure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
/**
 * Comments stripped before any "must not appear" assertion. The route file's
 * own docblock QUOTES the symbols it must never call — `searchSemantic`,
 * `ALL_ENTITY_TYPES` — because explaining why they are absent is the point of
 * the docblock. `advisor_bucket_overview.test.mjs` records the same
 * distinction: what must never come back is the CODE, not the explanation.
 */
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, '');

const routesRaw = read('cloudflare-worker/src/routes/advisor_grants.ts');
const routes = routesRaw;
const routesCode = stripComments(routesRaw);
const sql = read('cloudflare-worker/sql/migrations/218_advisor_client_grants.sql');
const index = read('cloudflare-worker/src/index.ts');

test('the route is mounted exactly once', () => {
  const mounts = index.match(/app\.route\('\/api\/advisor-grants'/g) || [];
  assert.equal(mounts.length, 1);
});

test('every read re-checks the advisor role, not just the grant', () => {
  // `advisors.ts:1410` makes this argument for cohort assignments and it holds
  // identically: the grant is the founder's decision, the role is the
  // eligibility that decision presumes. Without the second check, an advisor
  // who is later demoted keeps an active row and keeps reading indefinitely.
  assert.match(routes, /const isAdvisorNow = \(u: any\) => u\?\.role === 'advisor'/);
  for (const handler of ['/shared/list', "'/shared/:projectUid/brief'"]) {
    const at = routes.indexOf(handler);
    assert.ok(at > -1, `${handler} is gone`);
    assert.match(routes.slice(at, at + 600), /isAdvisorNow\(user\)/,
      `${handler} must re-check the role on every read`);
  }
});

test('a missing project and a missing grant answer identically', () => {
  // Otherwise the endpoint is a probe for which projects exist.
  assert.match(routes, /if \(!project \|\| !grant\) return c\.json\(\{ detail: 'No client record is open to you' \}, 404\)/);
});

test('the grant is checked live — active, and not expired', () => {
  const at = routes.indexOf('async function activeGrant');
  assert.ok(at > -1);
  const fn = routes.slice(at, at + 500);
  assert.match(fn, /status = 'active'/);
  assert.match(fn, /expires_at IS NULL OR expires_at > datetime\('now'\)/);
});

test('each scope gates its own field, not the whole request', () => {
  // A grant with only `scope_project` must not leak a data-room file or a
  // session. The reader assembles scope by scope.
  for (const scope of ['grant.scope_project', 'grant.scope_data_room', 'grant.scope_sessions']) {
    assert.ok(routes.includes(scope), `${scope} must gate its own block`);
  }
  // And the response says which scopes it did NOT read, so a brief cannot look
  // complete while missing the half it was not granted — which is the exact
  // failure the zone's card has warned about since it existed.
  assert.match(routes, /withheld\.push\(/);
  assert.match(routes, /withheld_note/);
});

test('the data room stays behind its NDA for an advisor too', () => {
  // The rule does not relax because the reader is an advisor rather than an
  // investor: a count, never the names.
  assert.match(routes, /hasActivePairwiseNda\(c\.env, grant\.granted_by_user_id, user\.id\)/);
  assert.match(routes, /withheld_behind_nda/);
  const at = routes.indexOf('data_room_files');
  assert.ok(at > -1);
  const stmt = routes.slice(at - 300, at + 200);
  assert.match(stmt, /COUNT\(\*\)/);
  assert.doesNotMatch(stmt, /f\.name|SELECT name/);
});

test('revoking is a state, never a delete', () => {
  assert.match(routesCode, /UPDATE advisor_client_grants SET status = 'revoked'/);
  assert.doesNotMatch(routesCode, /DELETE FROM advisor_client_grants/);
  assert.match(sql, /status TEXT NOT NULL DEFAULT 'active'/);
});

test('the founder side is narrowed to the company they are acting as', () => {
  assert.match(routes, /companyScope\(user, companyId, 'p'\)/);
  assert.match(routes, /resolveActiveCompany\(c\.env, user, c\.req\.header\(ACTIVE_COMPANY_HEADER\)\)/);
});

test('a shared document is resolved by id, never by widening a namespace', () => {
  // DECISIONS D37: adding `research_doc` to `ALL_ENTITY_TYPES` in
  // `routes/search.ts` would publish every user's private documents to every
  // other user's global search box, in one line that looks exactly like
  // following the existing pattern.
  assert.match(routesCode, /FROM advisor_client_document_shares s/);
  assert.doesNotMatch(routesCode, /searchSemantic|ALL_ENTITY_TYPES|researchNamespace/);
  const search = stripComments(read('cloudflare-worker/src/routes/search.ts'));
  assert.doesNotMatch(search, /advisor_client_document_shares/);
});

test('the grant is keyed on users, not on an advisor profile row', () => {
  // Migration 206's argument: the read is authorisation, and an advisor who
  // has not built a practice profile has no `advisors` row — keying there
  // would make them ungrantable for a reason a founder could never discover.
  assert.match(sql, /advisor_user_id INTEGER NOT NULL REFERENCES users\(id\)/);
  assert.doesNotMatch(sql, /REFERENCES advisors\(id\)/);
  assert.match(sql, /UNIQUE \(project_id, advisor_user_id\)/);
});

test('the three scopes are three columns, and only the project record defaults on', () => {
  assert.match(sql, /scope_project INTEGER NOT NULL DEFAULT 1/);
  assert.match(sql, /scope_data_room INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql, /scope_sessions INTEGER NOT NULL DEFAULT 0/);
});

test('granting to a non-advisor is refused at the door', () => {
  // The role is re-checked on every read anyway, so such a grant would be
  // inert — but a founder who ticked three scopes deserves to be told it did
  // nothing rather than believing they had shared something.
  assert.match(routes, /That account is not an advisor/);
});

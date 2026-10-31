/**
 * D1415 (#3697, part 2) — the switcher read, the settings scope and project
 * create's company choice, on real SQLite (see `_portfolio_d1415_fixture.ts`).
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/account_portfolio_d1415.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, envOf, call, ADA, BEN, CY, DEE, EVE, NORTH, SOUTH, VENTURE, SOLO, DOCK, RELIC, PRIVATE } from './_portfolio_d1415_fixture.ts';

// ── Switcher ────────────────────────────────────────────────────────────────

test('switcher: projects nested under their companies, standalone apart, seated ones elsewhere, archived companies out, nothing unowned', async () => {
  // Mutations checked: the archived filter dropped (Oldwind listed); the owned-or-seated rule replaced by every
  // project (Private listed); the elsewhere filter dropped (Dock missing for Ben).
  const db = fixture(); const env = envOf(db);
  const ada = await call(env, ADA, 'GET', '/api/account/switcher');
  assert.equal(ada.status, 200, ada.text);
  assert.deepEqual(ada.body.companies.map((c: any) => [c.uid, c.path, c.my_role, c.is_primary_admin]), [
    ['co-north', '/c/northwind', 'Admin', true],
    ['co-south', '/c/co-south', 'Member', false],
  ], 'primary admin first; a company without a slug is addressed by uid; Oldwind is archived and left out');
  const north = ada.body.companies[0];
  assert.deepEqual(north.projects.value.map((p: any) => [p.id, p.path, p.my_seat]), [[VENTURE, '/c/northwind/p/venture', 'owner']]);
  assert.deepEqual(ada.body.companies[1].projects.value.map((p: any) => [p.id, p.path]), [[DOCK, `/c/co-south/p/${DOCK}`]]);
  assert.deepEqual(ada.body.standalone.value.map((p: any) => [p.id, p.path]), [[SOLO, '/p/solo']]);
  assert.deepEqual(ada.body.elsewhere.value.map((p: any) => [p.id, p.company_name]), [[RELIC, 'Oldwind']], 'a project in an archived company is not lost');
  const all = JSON.stringify(ada.body);
  assert.ok(!all.includes(String(`"id":${PRIVATE}`)), 'Dee\'s project never appears');

  const ben = await call(env, BEN, 'GET', '/api/account/switcher');
  assert.deepEqual(ben.body.companies.map((c: any) => c.uid), ['co-north']);
  assert.deepEqual(ben.body.companies[0].projects.value.map((p: any) => [p.id, p.my_seat]), [[VENTURE, 'cofounder']]);
  assert.deepEqual(ben.body.elsewhere.value.map((p: any) => [p.id, p.company_name, p.my_seat]), [[DOCK, 'Southwind', 'cofounder']]);
  assert.deepEqual(ben.body.standalone.value, []);

  const cy = await call(env, CY, 'GET', '/api/account/switcher');
  assert.deepEqual(cy.body.companies, []);
  assert.deepEqual(cy.body.elsewhere.value.map((p: any) => p.id), [DOCK]);
});

test('switcher: a failed projects read is a block, never an empty list; a failed companies read is 503', async () => {
  // Mutation checked: the projects block replaced by `[]` on failure.
  const db = fixture(); const env = envOf(db);
  db.exec('ALTER TABLE project_members RENAME TO project_members_gone');
  db.exec('CREATE TABLE project_members (id INTEGER PRIMARY KEY)');
  const res = await call(env, ADA, 'GET', '/api/account/switcher');
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.companies[0].projects.available, false);
  assert.match(res.body.companies[0].projects.reason, /not the same as none/);
  assert.equal(res.body.standalone.available, false);
  assert.equal(res.body.elsewhere.available, false);

  const db2 = fixture(); const env2 = envOf(db2);
  db2.exec('DROP TABLE user_company_links');
  const down = await call(env2, ADA, 'GET', '/api/account/switcher');
  assert.equal(down.status, 503);
  assert.equal(down.body.error, 'switcher_unreadable');
});

// ── Settings scope ──────────────────────────────────────────────────────────

test('settings scope: company, project in a company, and a standalone project', async () => {
  // Mutations checked: open_tab always 'general' (the project-in-company case reads the wrong tab); a project in the
  // caller's company answered as a standalone project.
  const db = fixture(); const env = envOf(db);
  const company = await call(env, BEN, 'GET', '/api/account/settings-scope?company=co-north');
  assert.equal(company.status, 200, company.text);
  assert.equal(company.body.scope, 'company');
  assert.equal(company.body.label, 'Company settings');
  assert.equal(company.body.open_tab, 'general');
  assert.deepEqual(company.body.tabs.map((t: any) => t.key), ['general', 'legal', 'team', 'billing', 'projects']);
  const billing = company.body.tabs.find((t: any) => t.key === 'billing');
  assert.equal(billing.available, false, 'billing is per account (owner question B, answer a)');
  assert.equal(billing.path, '/account/billing');
  assert.deepEqual(company.body.tabs.find((t: any) => t.key === 'projects').children.map((c: any) => [c.key, c.path]), [[`projects:${VENTURE}`, '/c/northwind/p/venture/settings/general']]);

  const inCompany = await call(env, BEN, 'GET', `/api/account/settings-scope?company=co-north&project=${VENTURE}`);
  assert.equal(inCompany.body.scope, 'company_project');
  assert.equal(inCompany.body.open_tab, `projects:${VENTURE}`);
  assert.equal(inCompany.body.project.path, '/c/northwind/p/venture');
  const projectOnly = await call(env, BEN, 'GET', `/api/account/settings-scope?project=${VENTURE}`);
  assert.equal(projectOnly.body.scope, 'company_project', 'a project in the caller\'s company opens in its company\'s settings');

  const solo = await call(env, ADA, 'GET', `/api/account/settings-scope?project=${SOLO}`);
  assert.equal(solo.body.scope, 'project');
  assert.equal(solo.body.label, 'Project settings');
  assert.equal(solo.body.company, null);
  assert.deepEqual(solo.body.tabs.map((t: any) => [t.key, t.path]), [['general', '/p/solo/settings/general'], ['team', '/p/solo/settings/team'], ['billing', '/account/billing']]);

  const elsewhere = await call(env, BEN, 'GET', `/api/account/settings-scope?project=${DOCK}`);
  assert.equal(elsewhere.body.scope, 'project', 'a seat on a project in someone else\'s company gives project settings only');
});

test('settings scope: a missing scope is 400, a mismatched pair 409, and anything the caller cannot see 404', async () => {
  // Mutations checked: the company membership check dropped (Dee reads Northwind); the project visibility check
  // dropped (Dee reads Venture); the pair check dropped.
  const db = fixture(); const env = envOf(db);
  assert.equal((await call(env, ADA, 'GET', '/api/account/settings-scope')).body.error, 'scope_missing');
  const pair = await call(env, ADA, 'GET', `/api/account/settings-scope?company=co-north&project=${SOLO}`);
  assert.equal(pair.status, 409);
  assert.equal(pair.body.error, 'project_not_in_company');
  assert.equal((await call(env, DEE, 'GET', '/api/account/settings-scope?company=co-north')).status, 404);
  assert.equal((await call(env, DEE, 'GET', `/api/account/settings-scope?project=${VENTURE}`)).status, 404);
  assert.equal((await call(env, ADA, 'GET', `/api/account/settings-scope?project=${PRIVATE}`)).status, 404);
  assert.equal((await call(env, ADA, 'GET', '/api/account/settings-scope?project=99999')).status, 404);
  assert.equal((await call(env, EVE, 'GET', '/api/account/settings-scope?company=co-west')).status, 200, 'a platform admin reads any');
});

// ── Project create: the company and the slug ────────────────────────────────

test('POST /api/projects: company_id null is standalone even with a company selected; a company the caller is not in is 404', async () => {
  // Mutations checked: the body's null ignored (the header company wins); the membership check on company_id dropped.
  const db = fixture(); const env = envOf(db);
  const header = { 'X-Company-Id': String(NORTH) };
  db.prepare('DELETE FROM projects WHERE founder_id = 101').run();
  const standalone = await call(env, ADA, 'POST', '/api/projects', { name: 'Side Thing', company_id: null }, header);
  assert.equal(standalone.status, 201, standalone.text);
  assert.equal(standalone.body.company_id, null);
  assert.equal(standalone.body.slug, 'side-thing', 'a slug is made from the name');

  db.prepare('DELETE FROM projects WHERE founder_id = 101').run();
  const refused = await call(env, ADA, 'POST', '/api/projects', { name: 'Wrong Home', company_id: 4 }, header);
  assert.equal(refused.status, 404);
  assert.equal(refused.body.error, 'company_not_found');
  assert.equal((db.prepare("SELECT COUNT(*) n FROM projects WHERE name = 'Wrong Home'").get() as any).n, 0, 'nothing created');

  const placed = await call(env, ADA, 'POST', '/api/projects', { name: 'Placed', company_id: SOUTH }, header);
  assert.equal(placed.status, 201, placed.text);
  assert.equal(placed.body.company_id, SOUTH, 'an explicit company the caller belongs to wins over the header');

  db.prepare('DELETE FROM projects WHERE founder_id = 101').run();
  const headerOnly = await call(env, ADA, 'POST', '/api/projects', { name: 'By Header' }, header);
  assert.equal(headerOnly.body.company_id, NORTH, 'no company_id keeps the header rule');
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildCoverage, declaredRoutes, describeHints, family, menuFacts, renderCoverage } from '../../scripts/build-section-coverage.mjs';

test('coverage reads JSX route syntax, inherited guards, redirects and unresolved paths', () => {
  const src = `
    export const routes = <Route path="/admin" element={hqOnly(<Frame />)}>
      <Route path="accounts/:id" element={<Account />} />
      <Route index element={<Home />} />
      <Route path="/former" element={<Navigate to="/admin" />} />
      <Route path={computed.path} element={<Deferred />} />
      {/* <Route path="/comment" element={<Ignored />} /> */}
    </Route>;
  `;
  const routes = declaredRoutes(src, 'fixture.jsx');
  assert.deepEqual(routes.map(({ template, guarded, isForward }) => [template, guarded, isForward]), [
    ['/admin', true, false],
    ['/admin/accounts/:id', true, false],
    ['/admin', true, false],
    ['/former', true, true],
    [null, true, false],
  ]);
  assert.equal(family(routes[1].template), '/admin/accounts');
  assert.equal(family(routes[4].template), '(dynamic expression)');
  assert.equal(family('/:handle'), '/:handle or wildcard');
});

test('diagnostic probes keep context-dependent origins, resource types and null hints explicit', () => {
  const settings = Object.fromEntries(describeHints('/account').matches);
  assert.equal(settings.super_admin, 'all/account');
  assert.equal(settings['super_admin sidebar'], 'superadmin/settings');
  const portfolio = Object.fromEntries(describeHints('/account/portfolio').matches);
  assert.equal(portfolio['create project'], 'all/projects');
  assert.equal(portfolio['create company'], 'all/companies');
  const diligence = describeHints('/due-diligence/:id');
  assert.equal(Object.fromEntries(diligence.matches)['founder with one eligible licence'], 'advisor/due-diligence');
  assert.ok(diligence.gaps.includes('founder with ambiguous owner'));
  const unknown = describeHints('/unknown');
  assert.deepEqual(unknown.matches, []);
  assert.ok(unknown.gaps.includes('direct without shell'));
});

test('the checked-in route-family table matches declarations, menus, catalogue and producers', () => {
  const model = buildCoverage();
  const expected = readFileSync(new URL('../../documentation/architecture/decisions/D5682-p2.md', import.meta.url), 'utf8');
  assert.equal(renderCoverage(model) === expected, true, 'Review and regenerate with node scripts/build-section-coverage.mjs --write');
  assert.ok(model.families.size > 100);
  assert.ok(model.access.size > 100);
  assert.match(expected, /credential-bearing template: exclude/);
  assert.match(expected, /role\/query-dependent forward/);

  const [menu, ...rest] = model.menus;
  const changed = menuFacts('function UserDropdown() { return <Link to={allowed ? "/account" : "/unreviewed"} />; }', menu.file);
  assert.ok(changed.paths.includes('/unreviewed'));
  assert.notEqual(renderCoverage({ ...model, menus: [{ ...menu, ...changed }, ...rest] }), expected);

  const routes = new Map(model.families);
  const added = declaredRoutes('const page = <Route path="/unreviewed" element={guard([], <Page />)} />;', 'fixture.jsx');
  routes.set('/unreviewed', added);
  assert.notEqual(renderCoverage({ ...model, families: routes }), expected);
});

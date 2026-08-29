/**
 * CompanySwitcher — creation works, and the switcher does not overclaim.
 *
 * Two separate facts are pinned here because they failed together in the
 * product: "Add a new company" was hardcoded `disabled` with the title
 * "Creating additional companies is coming soon", while `POST /company/create`
 * on the worker had been complete the whole time — it inserts the
 * `company_profiles` row AND the `user_company_links` row that makes the
 * creator its primary admin. The feature read as unbuilt because of one
 * attribute.
 *
 * The second fact is the one that matters more. Enabling creation is only safe
 * while the UI is honest about what selecting a company does, because today it
 * does almost nothing: no business table carries a `company_id` — only
 * `user_company_links` does — and `services/tenancyScope.ts` scopes by user,
 * founder_id, LP email and fund GP, never by company. A second company would
 * therefore show the same rows as the first, which reads as data loss.
 *
 * So the notice and the absence of company scoping are asserted as ONE
 * coupled fact. When company scoping lands, the last test here fails and tells
 * the author to delete the notice — rather than leaving a stale disclaimer
 * that undersells the product.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const switcher = read('frontend/src/ui/CompanySwitcher.jsx');
const api = read('frontend/src/lib/api.js');
const scope = read('cloudflare-worker/src/services/tenancyScope.ts');

test('the add-company control is not disabled', () => {
  assert.ok(
    !/Creating additional companies is coming soon/.test(switcher),
    'the "coming soon" title is gone',
  );
  // `disabled` on the SUBMIT button is correct (empty name / in-flight save).
  // What must not come back is a bare `disabled` with no expression, which is
  // how the add button was switched off.
  assert.ok(
    !/^\s*disabled\s*$/m.test(switcher),
    'no unconditionally-disabled button remains',
  );
});

test('creating a company posts to the endpoint that also links the creator', () => {
  assert.match(switcher, /api\.createCompany\(/, 'the switcher calls createCompany');
  assert.match(
    api, /createCompany:\s*\(data\)\s*=>\s*request\('\/company\/create'/,
    'createCompany targets /company/create',
  );
});

test('the new company becomes the active one', () => {
  // Creating a company and leaving the previous one selected would look like
  // the create silently failed.
  assert.match(switcher, /setCompany\(created\)/);
  assert.match(switcher, /setCompanies\(\[\.\.\.companies, created\]\)/);
});

test('the scope notice stands exactly as long as scoping is incomplete', () => {
  // The first version of this asked a yes/no question — "does any company
  // scoping exist?" — and went red the moment the first route adopted it,
  // demanding the notice be deleted while 50 of 51 route files still ignored
  // the active company. Adoption is a rollout, so the guard measures the
  // rollout: the notice stands until every route file that reads `projects`
  // narrows through `companyScope`, and must be gone once they all do.
  const routes = readdirSync(resolve(root, 'cloudflare-worker/src/routes'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ f, src: read(`cloudflare-worker/src/routes/${f}`) }));
  const queriesProjects = routes.filter(({ src }) => /\b(FROM|JOIN)\s+projects\b/.test(codeOnly(src)));
  const unscoped = queriesProjects.filter(({ src }) => !/companyScope/.test(codeOnly(src)));

  assert.ok(queriesProjects.length > 0, 'sanity: some route reads projects');
  const hasNotice = /SCOPE_NOTICE/.test(switcher);

  if (unscoped.length === 0) {
    assert.equal(
      hasNotice, false,
      'every route that reads projects now narrows through companyScope — ' +
      'delete SCOPE_NOTICE from CompanySwitcher.jsx and this test',
    );
  } else {
    assert.ok(
      hasNotice,
      `${unscoped.length} of ${queriesProjects.length} route files that read ` +
      'projects still ignore the active company, so the switcher must keep ' +
      'saying separation is incomplete',
    );
  }
});

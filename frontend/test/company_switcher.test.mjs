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
import { readFileSync } from 'node:fs';
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

test('the scope notice stands exactly as long as company scoping is absent', () => {
  // Comments must be stripped first. The bare substring `company_id` appears
  // three times in tenancyScope.ts — every one of them inside prose saying the
  // column does NOT exist ("esign_envelopes has no company_id, so this is
  // user-scoped"). Matching those read the file as already company-scoped and
  // failed this test against correct code, which is the exact failure mode
  // `codeOnly` was written for.
  const scopeCode = codeOnly(scope);
  const scopesByCompany =
    /export function companyScope/.test(scopeCode) || /company_id/.test(scopeCode);
  const hasNotice = /SCOPE_NOTICE/.test(switcher);
  if (scopesByCompany) {
    assert.equal(
      hasNotice, false,
      'tenancyScope.ts now scopes by company — delete SCOPE_NOTICE from ' +
      'CompanySwitcher.jsx and this test, the switcher no longer overclaims',
    );
  } else {
    assert.ok(
      hasNotice,
      'nothing scopes by company yet, so the switcher must say switching does ' +
      'not separate workspace data',
    );
  }
});

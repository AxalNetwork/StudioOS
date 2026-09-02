/**
 * Company scoping — the active company persists across reloads, and the
 * company directory is private to its members.
 *
 * Two facts the user asked for, pinned together because they are the same
 * feature seen from opposite sides:
 *
 *   1. The sidebar selection must survive a refresh. `setActiveCompanyId`
 *      writes to localStorage and `CompanySwitcher` restores it on mount,
 *      falling back to the primary company when the saved one is no longer a
 *      membership.
 *   2. A company one user creates must not be visible to another user. The
 *      worker's `/companies` directory and `/company/:uid` detail now require
 *      membership (or platform admin), so a private company cannot be
 *      discovered or read by someone outside it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const api = read('frontend/src/lib/api.js');
const switcher = read('frontend/src/ui/CompanySwitcher.jsx');
const companyRoute = read('cloudflare-worker/src/routes/company.ts');

test('the active company id is persisted to localStorage', () => {
  assert.match(api, /localStorage\.setItem\('active_company_id'/);
  assert.match(api, /localStorage\.removeItem\('active_company_id'/);
});

test('the switcher restores the persisted company on mount', () => {
  assert.match(switcher, /initActiveCompanyId\(\)/);
  assert.match(switcher, /arr\.find\(\(co\) => co\.id === savedId\)/);
});

test('the company directory is scoped to the caller\'s memberships', () => {
  const code = codeOnly(companyRoute);
  assert.match(
    code,
    /id IN \(SELECT company_id FROM user_company_links WHERE user_id = \?\)/,
    '/companies must not list companies the caller does not belong to',
  );
});

test('a non-member cannot read a company profile', () => {
  const code = codeOnly(companyRoute);
  assert.match(
    code,
    /!\(await viewerIsMember[\s\S]*?return c\.json\(\{ detail: 'Company not found' \}, 404\)/,
    '/company/:uid must 404 for non-members',
  );
});

test('admins keep the full directory for support', () => {
  const code = codeOnly(companyRoute);
  assert.match(code, /if \(!isAdmin\(user\)\) \{[\s\S]*?user_company_links/);
});

/**
 * The half of the feature the first cut left out: SWITCHING.
 *
 * Persisting the selection and hiding companies from non-members are the
 * create-and-privacy half. The other half of "everything below is dedicated to
 * that company" is that changing the selection changes what is on screen —
 * and it did not. Pages do not read the active company from context; it rides
 * in the X-Company-Id header on each request, so a switch changed only FUTURE
 * requests. A page fetched under company A kept showing A's rows with B
 * selected in the sidebar until the next navigation happened to refetch.
 */
const app = read('frontend/src/App.jsx');

test('the saved company is restored before any page effect can fetch', () => {
  // Restoring it inside the switcher's own effect is too late: sibling page
  // effects fire in the same commit, so their first requests went out with no
  // company, or a stale one.
  assert.match(app, /useState\(\(\) => initActiveCompanyId\(\)\)/,
    'App must prime the active company id in a state initialiser');
});

test('switching company remounts everything below the sidebar', () => {
  assert.match(app, /<div\s+key=\{activeCompany\?\.id \?\? savedCompanyId[^}]*\}[^>]*data-app-main/,
    'the routed content must be keyed on the active company id');
});

test('signing out forgets the saved company', () => {
  // localStorage is per browser, not per account. The worker ignores a company
  // the caller does not belong to, so nothing leaks — but the next account's
  // first paint would be unscoped rather than its own company.
  assert.match(app, /const clearSession = useCallback\(async \(\) => \{[\s\S]*?setActiveCompanyId\(null\)/,
    'clearSession must clear the persisted company id');
});

test('the notice says what is shared, and does not claim the whole sidebar is scoped', () => {
  // "Everything below is dedicated to the selected company" contradicted the
  // switcher's own contract: shared marketplaces and account-level rows sit
  // below it and stay the same in every company by design.
  const m = /const SHARED_NOTICE = '([^']*)'/.exec(switcher);
  assert.ok(m, 'SHARED_NOTICE is a single-quoted string literal');
  assert.match(m[1], /shared across your companies/i, 'it must say what stays shared');
  assert.doesNotMatch(m[1], /everything below/i, 'it must not claim everything below is scoped');
});

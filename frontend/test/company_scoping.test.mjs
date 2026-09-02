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

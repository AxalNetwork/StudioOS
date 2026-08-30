/**
 * The Account canvas against what shipped, and the two pieces most likely to
 * disappear in a refactor.
 *
 * The canvas declares twelve nav entries. SettingsPage declares eight
 * SECTIONS, which looks like a four-way gap and mostly is not: two of the
 * canvas's entries are shipped as CARDS inside the `account` section rather
 * than as nav rows of their own.
 *
 *   canvas "Roles & access"  → <YourCompaniesSection />
 *   canvas "Documents"       → <DocumentsAgreementsSection />
 *   canvas "Profile"         → ProfileTabs, sub-tab 'personal'
 *   canvas "Identity & tax"  → ProfileTabs, sub-tab 'verification'
 *
 * That is a defensible arrangement — four cards on one pane beats four panes
 * with one card each — but it makes those two the easiest things in the file
 * to lose. A nav row that vanishes is obvious; a card dropped from a fragment
 * is not. This pins them.
 *
 * THE ONE REAL GAP is the canvas's "Legal entity", and it is not the person's
 * to hold: an entity belongs to the company, so it falls on the Company
 * Settings side of the split. It is not built, because the link does not
 * exist — `company_profiles` has no entity_id, jurisdiction or registered
 * address, and `entities` carries no owner column at all (its link is
 * `projects.entity_id`, which is why GET /legal/entities scopes through
 * projects). Building the card first would mean a pane reading "Not recorded"
 * for every field on every company. The last test records that rather than
 * leaving the absence to be read as an oversight.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const settings = read('frontend/src/pages/SettingsPage.jsx');
const company = read('frontend/src/pages/CompanySettingsPage.jsx');

const sections = () => {
  const block = settings.slice(
    settings.indexOf('const SECTIONS = ['),
    settings.indexOf('];', settings.indexOf('const SECTIONS = [')),
  );
  return [...block.matchAll(/id: '([a-z-]+)'/g)].map((m) => m[1]);
};

test('every canvas nav entry with a section has one, under its own id', () => {
  const have = new Set(sections());
  const expected = {
    onboarding: 'Onboarding',
    'security-privacy': 'Security',
    notifications: 'Notifications',
    integrations: 'Integrations',
    billing: 'Billing',
    appearance: 'Appearance',
    activity: 'Activity',
    account: 'Profile + Identity & tax + Roles & access + Documents',
  };
  for (const [id, canvasName] of Object.entries(expected)) {
    assert.ok(have.has(id), `no section for the canvas's "${canvasName}"`);
  }
});

test('the four cards folded into the account pane are all still rendered', () => {
  // Each of these is a canvas nav entry that ships as a card. Losing one is
  // losing a designed section, silently.
  const pane = settings.slice(
    settings.indexOf("safeActive === 'account' && ("),
    settings.indexOf("safeActive === 'security-privacy'"),
  );
  for (const card of ['<ProfileTabs', '<EmailSection', '<YourCompaniesSection', '<DocumentsAgreementsSection']) {
    assert.ok(pane.includes(card), `${card} left the account pane`);
  }
});

test('Profile and Identity & tax are the two profile sub-tabs', () => {
  assert.match(settings, /\{ id: 'personal', label: 'Personal' \}/);
  assert.match(settings, /\{ id: 'verification', label: 'Verification' \}/);
});

test('Documents lists the caller’s own envelopes, scoped by the server', () => {
  // GET /legal/esign is scoped by esignEnvelopeScope(user). The page must not
  // add a client-side filter that could be mistaken for the boundary.
  assert.match(settings, /api\.esignList\(\)/);
  assert.match(settings, /scoped server-side by/);
});

test('Legal entity is absent on BOTH sides, and the blocker is the missing link', () => {
  // Not built, and not silently: the canvas's twelfth entry needs a company →
  // entity link that does not exist. If any of these three facts changes, this
  // test should fail so the card can be reconsidered.
  assert.doesNotMatch(company, /Legal entity/i, 'if this shipped, delete this test');

  const schema = read('cloudflare-worker/sql/t13_t14_t15.sql');
  const profiles = schema.slice(
    schema.indexOf('CREATE TABLE IF NOT EXISTS company_profiles'),
    schema.indexOf(');', schema.indexOf('CREATE TABLE IF NOT EXISTS company_profiles')),
  );
  assert.ok(profiles.length > 100, 'could not read company_profiles');
  for (const col of ['entity_id', 'jurisdiction', 'registered_address']) {
    assert.ok(!profiles.includes(col),
      `company_profiles gained ${col} — the Legal entity card is now buildable`);
  }
});

test('Company Settings still owns the company half of the split', () => {
  // The person's pane must not grow company-scoped cards, and vice versa.
  assert.match(company, /function CompanyProfileCard/);
  assert.match(company, /function MembersCard/);
  assert.doesNotMatch(settings, /function CompanyProfileCard/);
});

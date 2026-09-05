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
 * THE CANVAS'S "Legal entity" IS TWO OBJECTS, and this file used to treat it
 * as one. That is why it once read "absent on BOTH sides".
 *
 *   PER-ACCOUNT  `corporate_profiles` — one row per user (user_id is the
 *                PRIMARY KEY). Entity name and type, registration number, an
 *                encrypted tax id, registered address, signing authority,
 *                UBOs, directors, screening flags. Served by
 *                GET/PUT /settings/profile/legal-entity. This one IS built:
 *                ProfileTabs' `corporate` sub-tab, the tab the comment above
 *                ENTITY_TYPE_OPTIONS has named since Task #16.
 *
 *   PER-COMPANY  the card the canvas draws on Company Settings. Still not
 *                built, and still not for want of trying: `company_profiles`
 *                has no entity_id, jurisdiction or registered address, and
 *                `entities` carries no owner column at all (its link is
 *                `projects.entity_id`, which is why GET /legal/entities
 *                scopes through projects). Building it would mean a pane
 *                reading "Not recorded" for every field on every company.
 *
 * The two are not interchangeable and must not drift into each other: the
 * account's entity is who signs YOUR contracts, the company's is who the
 * workspace belongs to. The tests below pin each to its own page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { codeOnly } from './_codeOnly.mjs';

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

test('Profile, Legal entity and Identity & tax are the three profile sub-tabs', () => {
  assert.match(settings, /\{ id: 'personal', label: 'Personal' \}/);
  assert.match(settings, /\{ id: 'corporate', label: 'Corporate' \}/);
  assert.match(settings, /\{ id: 'verification', label: 'Verification' \}/);
  // A tab in the list with no body renders an empty pane, which is worse than
  // no tab: the reader concludes the record is empty rather than unbuilt.
  assert.match(settings, /sub === 'corporate' && <CorporateEntityCard/);
});

test('Documents lists the caller’s own envelopes, scoped by the server', () => {
  // GET /legal/esign is scoped by esignEnvelopeScope(user). The page must not
  // add a client-side filter that could be mistaken for the boundary.
  assert.match(settings, /api\.esignList\(\)/);
  assert.match(settings, /scoped server-side by/);
});

test('the COMPANY-scoped Legal entity card stays absent, and the blocker is the missing link', () => {
  // The per-account record is built (see the corporate sub-tab tests below);
  // this one is not, and not silently: it needs a company → entity link that
  // does not exist. If any of these three facts changes, this test should fail
  // so the card can be reconsidered.
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

// ===========================================================================
// The corporate sub-tab. Everything under it was already built EXCEPT the
// card: ENTITY_TYPE_OPTIONS was written and never read, api.getLegalEntity /
// api.updateLegalEntity had zero callers, and the worker's side — 26 entity
// types, an encrypted tax id, a cross-field guard, per-field 400s — was
// complete. These pin the wiring so it cannot rot back into dead code.

test('the entity-type list the user picks from is the one the worker accepts', () => {
  // Two copies of an enum drift. The client's is a [value, label] map so it
  // can print "GmbH" rather than "gmbh"; the worker's is a bare Set used for
  // validation. A value in the picker that the worker rejects is a select
  // option that 400s, which is the same defect class as a button with no
  // endpoint — so compare the VALUE sets, not the labels.
  const opts = settings.slice(
    settings.indexOf('const ENTITY_TYPE_OPTIONS = ['),
    settings.indexOf('];', settings.indexOf('const ENTITY_TYPE_OPTIONS = [')),
  );
  assert.ok(opts.length > 100, 'could not read ENTITY_TYPE_OPTIONS');
  const client = new Set(
    [...opts.matchAll(/\['([a-z_]*)',/g)].map((m) => m[1]).filter(Boolean),
  );

  const svc = read('cloudflare-worker/src/services/profileExpansion.ts');
  const setBlock = svc.slice(
    svc.indexOf('const ENTITY_TYPES = new Set(['),
    svc.indexOf(']);', svc.indexOf('const ENTITY_TYPES = new Set([')),
  );
  assert.ok(setBlock.length > 100, 'could not read ENTITY_TYPES');
  const worker = new Set([...setBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

  assert.equal(client.size, worker.size,
    `picker has ${client.size} types, worker accepts ${worker.size}`);
  for (const v of worker) {
    assert.ok(client.has(v), `worker accepts '${v}' and the picker cannot offer it`);
  }
  for (const v of client) {
    assert.ok(worker.has(v), `picker offers '${v}' and the worker would 400 it`);
  }
});

test('the corporate card reads and writes the legal-entity route, not a sibling', () => {
  const card = settings.slice(
    settings.indexOf('function CorporateEntityCard'),
    settings.indexOf('function VerificationStubCard'),
  );
  assert.ok(card.length > 500, 'could not read CorporateEntityCard');
  assert.match(card, /api\.getLegalEntity\(\)/);
  assert.match(card, /api\.updateLegalEntity\(patch\)/);
  // /profile/corporate is the same handler under an older name. One caller,
  // one name, so a grep for either finds every writer.
  assert.doesNotMatch(codeOnly(card), /api\.(get|update)CorporateProfile/);
});

test('a rejected save lands on the field the worker names, not in a toast', () => {
  // updateCorporateProfile throws ProfileValidationError with a `field` — the
  // cross-field guard reports 'registration_number' when entity_type is set
  // without one. A toast would name neither field and leave both inputs
  // looking accepted.
  const card = settings.slice(
    settings.indexOf('function CorporateEntityCard'),
    settings.indexOf('function VerificationStubCard'),
  );
  assert.match(card, /e\?\.field/, 'the field-scoped error path is gone');
  assert.match(card, /setFieldErrors\(\{ \[e\.field\]: e\.message \}\)/);
  assert.match(card, /if \(!e\?\.field && !errsMap\) flash/,
    'a field-scoped error must not ALSO raise a toast');
  // And the coupling is stated before the user trips it.
  assert.match(card, /requires a registration number/);
});

test('the array columns save explicitly, and the derived flag is not a toggle', () => {
  const card = settings.slice(
    settings.indexOf('function CorporateEntityCard'),
    settings.indexOf('function VerificationStubCard'),
  );
  // The worker revalidates and replaces the whole array, so a per-row
  // autosave would race its own siblings against one endpoint.
  assert.match(card, /onSave=\{\(\) => save\(\{ ubos \}\)\}/);
  assert.match(card, /onSave=\{\(\) => save\(\{ directors \}\)\}/);
  // ubo_disclosed is computed server-side from ownership_pct >= 25. Drawing it
  // as an input would invite a user to contradict the rows above it.
  assert.match(card, /const disclosed = !!r\.ubo_disclosed/);
  assert.doesNotMatch(card, /save\(\{ ubo_disclosed/);
  assert.doesNotMatch(card, /save\(\{ aml_high_risk_jurisdiction/);
  assert.doesNotMatch(card, /save\(\{ sanctions_last_checked_at/);
});

test('insurance carriers are stated as unbuilt rather than drawn empty', () => {
  const card = settings.slice(
    settings.indexOf('function CorporateEntityCard'),
    settings.indexOf('function VerificationStubCard'),
  );
  // The column exists and the worker validates it; there is just no editor.
  // An empty table would read as "you have no carriers", which is a different
  // claim from "this page cannot record them".
  assert.doesNotMatch(codeOnly(card), /onSave=\{\(\) => save\(\{ insurance_carriers \}\)\}/);
  assert.match(card, /no editor here yet/);
});

test('the verification card no longer cites a block that does not exist', () => {
  // It used to read "The Identity and Legal entity blocks above are already
  // used to auto-fill contracts" — naming a Legal entity block that had never
  // been built, on the very page a reader would look for it.
  const stub = settings.slice(
    settings.indexOf('function VerificationStubCard'),
    settings.indexOf('function ProfileSection'),
  );
  assert.ok(stub.length > 200, 'could not read VerificationStubCard');
  assert.doesNotMatch(stub, /blocks above/,
    'the footnote points at a block again — check it exists');
  assert.match(stub, /Personal and Corporate tabs/);
});

test('Company Settings still owns the company half of the split', () => {
  // The person's pane must not grow company-scoped cards, and vice versa.
  assert.match(company, /function CompanyProfileCard/);
  assert.match(company, /function MembersCard/);
  assert.doesNotMatch(settings, /function CompanyProfileCard/);
});

// ===========================================================================
// The page moved from /settings to /account, and the URL-sync effect is where
// that hurt.
//
// The effect canonicalises: whatever alias you arrive on, it rewrites the URL
// to the section's own id, so /account/security becomes
// /account/security-privacy and the four legacy aliases in PATH_TO_SECTION
// resolve to their real tab. That behaviour predates the rename and is fine.
//
// Two things about it were not fine, and neither was visible to this suite
// until the page was opened in a browser. They are pinned here because the
// only other way to catch them is to render.
// ===========================================================================

const syncEffect = () => {
  const i = settings.indexOf('const bare = active ===');
  assert.ok(i > 0, 'the URL-sync effect must still exist — nothing else keeps the URL honest');
  return settings.slice(i, i + 500);
};

test('the landing pane has no segment of its own', () => {
  // Before the rename the landing pane's section id produced /settings/account,
  // which read fine. After it that is /account/account, which reads like a
  // mistake — and is what the page actually navigated to until this was fixed.
  const e = syncEffect();
  assert.match(e, /active === 'profile' \|\| active === 'account'/,
    "both the sentinel and the real landing section must map to the bare /account");
  // The whole line, not its halves: `doesNotMatch(/`\/account\/${active}`;/)`
  // was the first attempt and it cannot tell a conditional template from an
  // unconditional one — the conditional ends in exactly that string too, so it
  // failed against the code it was written to accept.
  assert.match(e, /const want = bare \? '\/account' : `\/account\/\$\{active\}`;/,
    'the segment must be conditional on `bare`, or the landing pane lands at /account/account');
});

test('the canonicalising rewrite keeps the query and the anchor', () => {
  // It navigated to a bare pathname, so it dropped both. That was survivable
  // while nothing sent one. It is not now: the Google OAuth link callback
  // redirects to /account?tab=…, and account recovery to
  // /account#security-recovery-codes. A hop that tidies the path must not eat
  // the part of the link that said why it was sent.
  const e = syncEffect();
  assert.match(e, /navigate\(\{\s*pathname: want, search: location\.search, hash: location\.hash\s*\}/,
    'the rewrite must carry search and hash through, not just the pathname');
});

test('both prefixes resolve a section, because /settings/* still renders this page for one hop', () => {
  assert.match(settings, /match\(\/\^\\\/\(\?:account\|settings\)\\\/\(\[\^\/\]\+\)\/\)/,
    'a deep link arriving on the old prefix must resolve its section on that render');
  assert.match(settings, /\/\^\\\/\(\?:account\|settings\)\\b\//,
    'the sync guard must recognise the old prefix or the rewrite never fires');
});

test('the email-change routes stay public under BOTH prefixes', () => {
  // isPublicPath decides whether a 401 hard-redirects to /login. These two
  // routes are followed from a mail client, usually signed out, and links
  // already sent point at /settings/email/*. Losing either prefix breaks an
  // email change at the moment the user clicks the link.
  const api = read('frontend/src/lib/api.js');
  assert.match(api, /startsWith\('\/account\/email\/'\)/);
  assert.match(api, /startsWith\('\/settings\/email\/'\)/,
    'confirmation links already in inboxes still carry the old prefix');
});

/**
 * D989 (#2380) — Partner profiles at /admin/partner-profiles: the owner's
 * canvas (PRF1–PRF12) integrated under D936's header, out of the Admin
 * Console. To review and All profiles draw what the list read and Approvals'
 * lane carry; the review is today's dialog until part 6.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partner_profiles_d989.test.mjs
 */
import test from 'node:test';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MOVED_NOTICES, categoryBars, rowView, tabOf } from '../src/pages/admin/profiles/ppModel.js';
import { legacyContractsTarget } from '../src/pages/admin/LegacyContractsRedirect.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// D994 moved the page onto D990's list read, whose `status` tells Drafts apart.
const ROWS = [
  { email: 'eva@example.com', user_name: 'Eva Demo', persona: 'Legal Counsel', status: 'pending' },
  { email: 'dev@example.com', user_name: 'Dev Testcase', persona: 'Operating Partner', legal_entity_name: 'Placeholder Labs Ltd', status: 'pending' },
  { email: 'finn@example.com', user_name: 'Finn Mock', persona: 'Founder', founder_track: 'Strategic Scale (Existing)', company_established: 1, status: 'verified', agreement_type: 'Strategic Scale Partnership Agreement' },
  { email: 'chloe@example.com', user_name: 'Chloé Placeholder', persona: 'Investor — LP', legal_entity_name: 'Example Holdings LLC', status: 'rejected' },
  { email: 'draft@example.com', user_name: null, persona: null, status: 'draft' },
  { email: 'ada@example.com', user_name: 'Ada Example', persona: 'Founder', founder_track: 'Spin-Out (New)', company_established: 0, status: 'pending' },
  { email: 'odd@example.com', user_name: 'Odd Row', persona: 'Founder', status: null },
];

// ---------------------------------------------------------------- the model

test('the addresses, the tabs and the moved notice', () => {
  assert.equal(tabOf('/admin/partner-profiles'), 'review');
  assert.equal(tabOf('/admin/partner-profiles/all/'), 'all');
  assert.equal(tabOf('/admin/partner-profiles/pp_7f3a21'), null, 'one profile\'s address waits for a reference');
  assert.equal(legacyContractsTarget('?tab=profiles'), '/admin/partner-profiles?moved=profiles');
  assert.equal(MOVED_NOTICES.profiles, 'The Admin Console has moved: Partner profiles now lives under Approvals.');
});

test('a row in the canvas\'s words: founder track and company, "Not given", and an unknown status is not drawn as a known one', () => {
  const ada = rowView(ROWS[5]);
  assert.deepEqual([ada.track, ada.incorporated, ada.entity, ada.agreement, ada.status], ['Spin-Out', 'Not incorporated', null, 'Not sent', 'Waiting']);
  const finn = rowView(ROWS[2]);
  assert.deepEqual([finn.track, finn.incorporated, finn.status], ['Strategic Scale', 'Incorporated', 'Verified']);
  assert.equal(rowView(ROWS[6]).track, 'Track not given');
  assert.equal(rowView(ROWS[6]).incorporated, 'Not answered');
  assert.deepEqual([rowView(ROWS[6]).status, rowView(ROWS[6]).statusKey], ['Not recorded', 'other']);
  assert.equal(rowView(ROWS[1]).track, null, 'a track pill on a non-founder');
});

test('onboarding categories: by count, Founder split by track, no category a line and never a bar', () => {
  const { bars, none, max } = categoryBars(ROWS);
  assert.equal(bars[0].category, 'Founder');
  assert.deepEqual([bars[0].count, bars[0].spinout, bars[0].scale, bars[0].untracked], [3, 1, 1, 1]);
  assert.equal(none, 1);
  assert.equal(max, 3);
  assert.ok(!bars.some((b) => !b.category));
});

// The mounted page (To review, All profiles, the failed and empty reads, the
// failed record read) is D994's: partner_profiles_d994.test.mjs mounts it on
// D990's reads.

// ---------------------------------------------------------------- the source

test('the routes, the redirect, the console mount gone, the lane doors, and the rail frame outermost', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/admin/partner-profiles" element={guard(['admin'], <PartnerProfiles />)} />`));
  assert.ok(app.includes(`<Route path="/admin/partner-profiles/all" element={guard(['admin'], <PartnerProfiles />)} />`));
  const admin = read('frontend/src/pages/admin/ConsolePages.jsx');
  assert.ok(!admin.includes('<PartnerProfilesConsole'), 'the console still mounts the tab');
  assert.ok(read('frontend/src/pages/admin/HeldApprovals.jsx').includes('<Link to="/admin/partner-profiles"'));
  assert.match(read('frontend/src/pages/admin/adminStudioOverview.js'), /partner_profiles: '\/admin\/partner-profiles'/);
  assert.ok(SIDEBAR_GROUPS.admin.flatMap((g) => g.items).find((r) => r.label === 'Approvals').match.includes('/admin/partner-profiles'));
  const page = read('frontend/src/pages/admin/profiles/PartnerProfiles.jsx');
  assert.match(page, /export default function PartnerProfiles\(\) \{\s*return \(\s*<AdminBoardFrame workspace="Entity profiles"/);
  assert.ok(!/\balert\(/.test(page), 'a browser pop-up on the page');
  assert.ok(!/\bpersona\b/i.test(page.replace(/r\.persona|\.persona/g, '')), 'the page says "persona"');
});

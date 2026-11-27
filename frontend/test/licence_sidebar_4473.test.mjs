/**
 * D4473 (#4473, part 2 of #3704): one sidebar that is the union of held licences.
 *
 *   · the owner's seven expected lists, exactly (the test fixtures of the issue);
 *   · input order does not matter, unknown values are dropped, an empty set falls back to the primary role;
 *   · rows are the per-role blocks' own objects (taken by `to`, never copied), Fund keeps its tier lock;
 *   · in a licence shell Diligence and Influencer sit after the last licence row and before Trust, Diligence first;
 *     a staff shell keeps today's positions;
 *   · the held set: a "View as" preview is the previewed licence, an impersonation the member's own set;
 *   · the Account menu and the phone account sheet: Companies + Portfolio for an investor, Licences for a member.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_sidebar_4473.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LICENCE_ORDER, buildLicenceSidebar, orderedLicences } from '../src/lib/licenceSidebar.js';
import { SIDEBAR_GROUPS, withDiligenceRow, withInfluencerRow } from '../src/sidebarConfig.js';
import { resolveHeldLicences } from '../src/lib/activeRole.js';
import { accountRowsFor } from '../src/ui/phone/AccountSheet.jsx';
import { grantedLabel, licencesView, planLabel, sourceLabel, NOT_RECORDED } from '../src/pages/account/licencesModel.js';
import { refusalWords } from '../src/pages/admin/accounts/AccountLicencesBlock.jsx';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const labels = (set, primaryRole = set[0]) => buildLicenceSidebar(set, { primaryRole }).items.map((r) => r.label);
const S = 'Studio, Spin-Out Lab';
const F = 'Trust, Network, Research';
const list = (...parts) => parts.join(', ').split(', ');

test('the seven expected sidebars, exactly', () => {
  // Mutation checked: FOOT reordered to Network, Research, Trust → every list fails.
  assert.deepEqual(labels(['founder']), list(S, 'Validate, Build, Raise, Grow', F));
  assert.deepEqual(labels(['investor']), list(S, 'Deals, Axal VC Fund, Fund', F));
  assert.deepEqual(labels(['advisor']), list(S, 'Practice, Cohorts, Expertise', F));
  assert.deepEqual(labels(['partner']), list(S, 'Pipeline, Delivery, Offers', F));
  assert.deepEqual(labels(['founder', 'investor']), list(S, 'Validate, Build, Raise, Grow', 'Deals, Axal VC Fund, Fund', F));
  assert.deepEqual(labels(['investor', 'advisor']), list(S, 'Deals, Axal VC Fund, Fund', 'Practice, Cohorts, Expertise', F));
  assert.deepEqual(labels(['founder', 'investor', 'advisor', 'partner']),
    list(S, 'Validate, Build, Raise, Grow', 'Deals, Axal VC Fund, Fund', 'Practice, Cohorts, Expertise', 'Pipeline, Delivery, Offers', F));
});

test('licence order wins over input order; unknown values drop; empty falls back to the primary role', () => {
  assert.deepEqual(orderedLicences(['partner', 'Founder', 'admin', 'investor']), ['founder', 'investor', 'partner']);
  assert.deepEqual(labels(['advisor', 'investor'], 'advisor'), labels(['investor', 'advisor'], 'advisor'));
  assert.deepEqual(orderedLicences([], 'advisor'), ['advisor']);
  assert.deepEqual(orderedLicences(null, 'admin'), []);
  assert.equal(buildLicenceSidebar([], { primaryRole: 'admin' }), null);
  assert.deepEqual(LICENCE_ORDER, ['founder', 'investor', 'advisor', 'partner']);
});

test('rows are the blocks\' own objects, taken by `to`; Fund keeps its institutional lock; every row once', () => {
  const g = buildLicenceSidebar(['founder', 'investor'], { primaryRole: 'founder' });
  assert.equal(g.key, 'home');
  assert.equal(g.label, '');
  assert.equal(g.licenceShell, true);
  const founderRows = SIDEBAR_GROUPS.founder.flatMap((x) => x.items);
  const investorRows = SIDEBAR_GROUPS.investor.flatMap((x) => x.items);
  assert.equal(g.items.find((r) => r.to === '/validate'), founderRows.find((r) => r.to === '/validate'), 'the same object');
  assert.equal(g.items.find((r) => r.to === '/studio'), founderRows.find((r) => r.to === '/studio'), 'a shared row from the primary block');
  assert.equal(g.items.find((r) => r.to === '/trust/me'), investorRows.find((r) => r.to === '/trust/me'));
  assert.equal(g.items.find((r) => r.to === '/funds').requiredInvestorTier, 'institutional');
  const tos = g.items.map((r) => r.to);
  assert.equal(new Set(tos).size, tos.length);
});

test('in a licence shell the conditional rows sit before Trust, Diligence first; a staff shell is unchanged', () => {
  // Mutation checked: beforeLicenceFoot returning null → Influencer lands after Research.
  const shell = [buildLicenceSidebar(['investor', 'advisor'], { primaryRole: 'investor' })];
  const both = withDiligenceRow(withInfluencerRow(shell, 'investor', true), 'investor', true);
  const ls = both[0].items.map((r) => r.label);
  assert.deepEqual(ls.slice(-5), ['Diligence', 'Influencer', 'Trust', 'Network', 'Research']);
  assert.equal(ls[ls.indexOf('Diligence') - 1], 'Expertise', 'after the last licence row');
  const influencerOnly = withInfluencerRow(shell, 'investor', true)[0].items.map((r) => r.label);
  assert.deepEqual(influencerOnly.slice(-4), ['Influencer', 'Trust', 'Network', 'Research']);
  const admin = withInfluencerRow(SIDEBAR_GROUPS.admin, 'admin', true);
  assert.equal(admin[0].items.at(-1).label, 'Influencer', 'a staff shell keeps the row last in its first group');
});

test('the held set: preview is the previewed licence; impersonation is the member\'s own; else licences or role', () => {
  const admin = { role: 'admin', licences: ['founder'] };
  assert.deepEqual(resolveHeldLicences({ user: admin, viewMode: 'investor' }), ['investor']);
  const member = { role: 'founder', licences: ['founder', 'investor'] };
  assert.deepEqual(resolveHeldLicences({ user: member, realUser: admin, isImpersonating: true }), ['founder', 'investor']);
  assert.deepEqual(resolveHeldLicences({ user: member }), ['founder', 'investor']);
  assert.deepEqual(resolveHeldLicences({ user: { role: 'advisor' } }), ['advisor']);
  assert.deepEqual(resolveHeldLicences({ user: { role: 'advisor', licences: [] } }), ['advisor']);
});

test('the shell is built from the held set for licence shells; staff shells keep their blocks', () => {
  const app = read('App.jsx');
  assert.match(app, /const licenceGroup = isLicence\(shell\) \? buildLicenceSidebar\(heldLicences \|\| \[role\], \{ primaryRole: role \}\) : null;/);
  assert.match(app, /getSidebarGroups\(activeRole \|\| 'founder', primaryPersonaId, user, hqView, heldLicences\)/);
  assert.match(app, /const held = resolveHeldLicences\(\{ user, realUser, viewMode, isImpersonating \}\);\n\s+if \(!allowedRoles\.includes\(effectiveRole\) && !held\.some\(\(l\) => allowedRoles\.includes\(l\)\)\)/,
    'RoleGuard admits a held licence');
  for (const [route, licence] of [['/funds"', 'investor'], ['/deals"', 'investor'], ['/funds/performance"', 'investor'], ['/pipeline"', 'partner']]) {
    const at = app.indexOf(`path="${route}`);
    const element = app.slice(at, app.indexOf('<Route', at + 1));
    assert.ok(at >= 0 && element.includes(`holds('${licence}')`), `${route} picks its page with holds('${licence}')`);
  }
});

test('Account menu and phone sheet: Companies + Portfolio for an investor; Licences for a member, not an admin', () => {
  const rows = (u) => accountRowsFor(u).map(([t, to]) => `${t} ${to}`);
  const founder = rows({ role: 'founder', licences: ['founder'] });
  assert.ok(founder.includes('Portfolio /account/portfolio'));
  assert.ok(!founder.some((r) => r.endsWith(' /portfolio')));
  assert.ok(founder.includes('Licences /account/licences'));
  const both = rows({ role: 'founder', licences: ['founder', 'investor'] });
  const i = both.indexOf('Companies /account/portfolio');
  assert.ok(i >= 0);
  assert.deepEqual(both.slice(i, i + 3), ['Companies /account/portfolio', 'Portfolio /portfolio', 'Licences /account/licences']);
  assert.ok(!rows({ role: 'admin' }).includes('Licences /account/licences'));
  const dd = read('App.jsx').slice(read('App.jsx').indexOf('function UserDropdown('), read('App.jsx').indexOf('function PortalSwitcher('));
  assert.match(dd, /\{holdsInvestor \? 'Companies' : 'Portfolio'\}/);
  assert.ok(dd.indexOf('to="/account/portfolio"') < dd.indexOf('to="/portfolio"'));
  assert.ok(dd.indexOf('to="/portfolio"') < dd.indexOf('to="/account/licences"'));
  assert.ok(dd.indexOf('to="/account/licences"') < dd.indexOf('to="/account/billing"'), 'still above Billing (D4416)');
});

test('Licences page words: absent values are "Not recorded"; refusals are fixed sentences by code', () => {
  assert.equal(grantedLabel(null), NOT_RECORDED);
  assert.equal(grantedLabel('not a date'), NOT_RECORDED);
  assert.equal(grantedLabel('2026-11-05 08:19:22'), '5 Nov 2026');
  assert.equal(sourceLabel('admin'), 'Granted by Axal VC');
  assert.equal(sourceLabel('something_new'), NOT_RECORDED);
  assert.equal(planLabel(null), NOT_RECORDED);
  assert.equal(planLabel({ key: 'founder:free', name: 'Founder Free' }), 'Founder Free');
  assert.deepEqual(licencesView({ held: 'x' }), { held: [], addable: [] });
  assert.equal(refusalWords({ code: 'primary_licence', message: 'raw' }), 'The primary licence cannot be revoked here.');
  assert.equal(refusalWords(new Error('boom')), 'That change could not be saved. Nothing was changed.');
  const page = read('pages/account/AccountLicences.jsx');
  assert.doesNotMatch(page, /e\.message|error\.message/, 'a failed read never shows the error text');
  assert.match(page, /to="\/help"/);
});

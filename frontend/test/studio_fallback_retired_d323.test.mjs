/**
 * D323 — the old "Welcome back" page that Dashboard.jsx drew after its role
 * branches is retired, and so are the two pages nothing imported.
 *
 * Dashboard.jsx cannot be imported here (every Studio home mounts
 * PersonalAdvisor, whose imports reach Worker modules), so its dispatch is
 * pinned in source; the moved badges are rendered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusBadge, WeekBadge } from '../src/components/StatusBadges.jsx';
import { codeOnly } from './_codeOnly.mjs';

const src = (rel) => fileURLToPath(new URL(`../src/${rel}`, import.meta.url));
const read = (rel) => readFileSync(src(rel), 'utf8');
const DASH = codeOnly(read('pages/Dashboard.jsx'));

test('the "Welcome back" page is gone from the Studio dispatcher', () => {
  assert.doesNotMatch(DASH, /Welcome back/);
  for (const gone of ['SemanticSearch', 'InvestorTrialBanner', 'VentureNextStep', 'NotifDropdown', 'InvestorHome', 'refreshDashboardScores', 'PageExplainer']) {
    assert.ok(!DASH.includes(gone), `${gone} is still referenced by Dashboard.jsx`);
  }
});

test('after the four role homes, a Lab member gets the founder home and anyone else holds at /exploring', () => {
  const partner = DASH.indexOf("=== 'partner') {");
  const tail = DASH.slice(DASH.indexOf('<PartnerStudioHome', partner));
  const lab = tail.indexOf('spinout_lab_active === 1');
  const founder = tail.indexOf('<FounderStudioHome user={user} />');
  const redirect = tail.indexOf("<Navigate to={{ pathname: '/exploring', search: location.search, hash: location.hash }} replace />");
  assert.ok(lab > 0, 'the Lab-member branch follows the partner home');
  assert.ok(founder > lab, 'a Lab member is drawn the founder home');
  assert.ok(redirect > founder, 'everyone else is redirected, with the query string and hash kept');
  assert.match(tail.slice(lab - 80, lab + 80), /authUser\?\.spinout_lab_active === 1 \|\| user\?\.spinout_lab_active === 1/);
  // Nothing renders after the redirect: it is the component's last return.
  const afterRedirect = tail.slice(redirect).split('\n').slice(1, 3).join('\n');
  assert.match(afterRedirect, /^\}/, 'the redirect is the last thing Dashboard returns');
});

test('the retired files are deleted, not left orphaned', () => {
  for (const rel of [
    'components/SemanticSearch.jsx',
    'components/InvestorTrialBanner.jsx',
    'components/VentureNextStep.jsx',
    'pages/SkillsProfilePage.jsx',
    'pages/ValuesAssessmentPage.jsx',
  ]) assert.equal(existsSync(src(rel)), false, `${rel} still exists`);
  assert.doesNotMatch(read('lib/api.js'), /refreshDashboardScores/, 'the api.js method only the old page called');
});

test('the /skills and /values routes still redirect, now that their pages are gone', () => {
  const app = codeOnly(read('App.jsx'));
  assert.match(app, /<Route path="\/skills" element=\{<Navigate to="\/studio" replace \/>\} \/>/);
  assert.match(app, /<Route path="\/values" element=\{<Navigate to="\/studio" replace \/>\} \/>/);
  assert.doesNotMatch(app, /SkillsProfilePage|ValuesAssessmentPage/);
});

test('StatusBadge and WeekBadge moved, not deleted, and their importers follow', () => {
  assert.match(read('components/StartupList.jsx'), /import \{ StatusBadge, WeekBadge \} from '\.\/StatusBadges';/);
  assert.match(read('pages/ProjectDetail.jsx'), /import \{ StatusBadge \} from '\.\.\/components\/StatusBadges';/);
  assert.match(renderToStaticMarkup(createElement(StatusBadge, { status: 'tier_1' })), />tier 1</);
  assert.match(renderToStaticMarkup(createElement(WeekBadge, { week: 'week_2' })), />W2</);
  assert.match(renderToStaticMarkup(createElement(WeekBadge, { week: 'complete' })), />Complete</);
  assert.equal(renderToStaticMarkup(createElement(WeekBadge, { week: null })), '');
});

test('no tour step points at an anchor only the retired page had', () => {
  const tour = codeOnly(read('components/ProductTour.jsx'));
  const anchors = [...tour.matchAll(/anchor: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(anchors.length >= 3, 'the tour still has its steps');
  assert.ok(!anchors.includes('search') && !anchors.includes('notifications'));
});

/**
 * #3704 / D4473 (#4473): there is no licence switcher anywhere, and Portfolio and Companies are never sidebar rows.
 *
 *   · the sidebar, the company switcher, the phone company sheet and App.jsx carry no profile or licence switcher,
 *     no "active licence" state and no control that maps over `licences`; the admin `PortalSwitcher` ("View as", a
 *     staff preview) is the one allowed exception and is named here;
 *   · `buildLicenceSidebar` never emits Portfolio or Companies, for all 15 non-empty licence sets;
 *   · `SidebarNav.jsx` no longer references `/account/portfolio`.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/no_licence_switcher_3704.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LICENCE_ORDER, buildLicenceSidebar } from '../src/lib/licenceSidebar.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const FILES = ['ui/SidebarNav.jsx', 'ui/CompanySwitcher.jsx', 'ui/phone/CompanySheet.jsx', 'App.jsx'];

test('no licence switcher: no switcher component, no active-licence state, no control over `licences`', () => {
  // Mutation checked: a `<select>` over user.licences added to SidebarNav → the map test fails.
  for (const f of FILES) {
    const src = read(f);
    assert.doesNotMatch(src, /\b(ProfileSwitcher|LicenceSwitcher|LicenseSwitcher)\b/, `${f}: no licence switcher component`);
    assert.doesNotMatch(src, /\b(active_profile|activeLicence|activeLicense|active_licence)\b/, `${f}: no active-licence state`);
    assert.doesNotMatch(src, /licences\s*\)?\s*\.map\s*\(/, `${f}: nothing maps over licences to draw a choice`);
  }
  // The one exception: the admin "View as" preview, which is a staff preview of a shell, not a member's licences.
  const app = read('App.jsx');
  assert.match(app, /function PortalSwitcher\(/, 'the admin PortalSwitcher is the named exception');
  assert.doesNotMatch(read('ui/SidebarNav.jsx'), /<select\b/, 'the sidebar has no select');
});

const nonEmptySets = () => {
  const out = [];
  for (let mask = 1; mask < 1 << LICENCE_ORDER.length; mask += 1) out.push(LICENCE_ORDER.filter((_, i) => mask & (1 << i)));
  return out;
};

test('buildLicenceSidebar never returns Portfolio or Companies, for all 15 licence sets', () => {
  const sets = nonEmptySets();
  assert.equal(sets.length, 15);
  for (const set of sets) {
    const g = buildLicenceSidebar(set, { primaryRole: set[0] });
    for (const row of g.items) {
      assert.ok(!['Portfolio', 'Companies'].includes(row.label), `${set}: no ${row.label} row`);
      assert.ok(!['/portfolio', '/account/portfolio', '/account/companies'].includes(row.to), `${set}: no ${row.to}`);
    }
  }
});

test('the sidebar no longer references the account Portfolio', () => {
  assert.doesNotMatch(read('ui/SidebarNav.jsx'), /['"`]\/account\/portfolio/);
});

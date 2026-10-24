/** D998 / #2813 — execute the real shell grouping rule over its real taxonomy/config. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { PERSONA_BY_ID } from '../src/lib/personas.js';
import { SIDEBAR_GROUPS, filterItemsByTier } from '../src/sidebarConfig.js';
import { shellRoleFor } from '../src/lib/shellRole.js';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/App.jsx');
const source = app.slice(app.indexOf('function getSidebarGroups('), app.indexOf('// Carta-style user dropdown'));
const groupsFor = vm.runInNewContext('(' + source + ')', { SIDEBAR_GROUPS, PERSONA_LOOKUP: PERSONA_BY_ID, shellRoleFor, filterItemsByTier, Sparkles: 'icon' });
const personaGroup = (role, id) => groupsFor(role, id, { role }).find(g => g.key.startsWith('persona-'));
test('Investor segment links are drawn for Angel, institutional LP and external GP', () => {
  for (const [id, path] of [['angel_scout', '/refer'], ['lp_institutional', '/funds'], ['gp_external', '/pipeline']]) {
    const groups = groupsFor('investor', id, { role: 'investor' });
    assert.ok(groups.flatMap(g => g.items).some(x => x.to === path), id);
    const inBase = SIDEBAR_GROUPS.investor.some(g => g.items.some(x => x.to === path));
    if (!inBase) assert.ok(personaGroup('investor', id), id);
  }
});
test('a different profile or unknown segment adds no persona links, and existing links are not duplicated', () => {
  assert.equal(personaGroup('investor', 'founder_existing'), undefined);
  assert.equal(personaGroup('partner', 'angel_scout'), undefined);
  assert.equal(personaGroup('investor', 'unknown'), undefined);
  assert.equal(personaGroup('advisor', 'operator_advisor'), undefined, 'Practice is already in the Advisor sidebar');
  for (const [role, id] of [['investor', 'angel_scout'], ['investor', 'lp_institutional'], ['founder', 'founder_existing']]) {
    const links = groupsFor(role, id, { role }).flatMap(g => g.items.map(x => x.to));
    assert.equal(links.length, new Set(links).size);
  }
  assert.deepEqual(PERSONA_BY_ID.operator_advisor.nav_extras, [{ to: '/practice', label: 'Practice' }]);
});
test('persona onboarding admits Advisors without widening the other route guards', () => {
  const route = app.split('\n').find(line => line.includes('path="/onboarding/persona"'));
  const roles = [...route.matchAll(/'([a-z]+)'/g)].map(m => m[1]);
  assert.deepEqual(roles, ['admin', 'founder', 'partner', 'investor', 'advisor']);
  assert.match(route, /<OnboardingPersonaPage \/>/);
});
test('the guide names the six Investor segments and the Advisor segment without promising a profile change', () => {
  const guide = read('../src/pages/docs/sections/getting-started.js');
  assert.match(guide, /Investors have six segments/);
  for (const name of ['LP — Individual', 'LP — Institutional', 'GP — External Fund', 'Angel / Scout', 'Corporate VC', 'Sovereign / Family Office', 'Operator / Advisor']) assert.ok(guide.includes(name), name);
  assert.match(guide, /A segment does not change your account profile/);
  assert.doesNotMatch(guide, /Investors and Advisors each have one persona/);
});

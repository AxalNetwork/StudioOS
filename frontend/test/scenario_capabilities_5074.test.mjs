/**
 * D5074 part 6 (#5074) — the cap table scenarios and Use of funds' Runway pages draw their writes from the Worker's
 * maps alone. Pure view and source checks here; the mounted cases are in `captable_scenarios_d1024.test.mjs` (the
 * owner's, a reader's, a plan-less and an admin's Today) and `use_of_funds_d1178.test.mjs` (the founder's map, a
 * support session's and none). The Worker's side is `cloudflare-worker/test/cap_table_scenario_capabilities_5074.test.ts`
 * and `uof_capabilities_5074.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarioStanding } from '../src/pages/raise/captable/scenariosModel.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

test('scenarioStanding: a write needs edit and plan; the plan line needs only plan; nothing else allows', () => {
  assert.deepEqual(scenarioStanding({ edit: true, plan: true }), { plan: true, writes: true });
  assert.deepEqual(scenarioStanding({ edit: false, plan: true }), { plan: true, writes: false });
  assert.deepEqual(scenarioStanding({ edit: true, plan: false }), { plan: false, writes: false });
  for (const caps of [null, undefined, {}, 'yes', { edit: 'true', plan: 'true' }, { edit: 1, plan: 1 }]) {
    assert.deepEqual(scenarioStanding(caps), { plan: false, writes: false }, JSON.stringify(caps));
  }
});

test('the Scenarios pages read the Today map, never the account, its plan helper or the grants read', () => {
  const src = read('src/pages/raise/captable/ScenariosPages.jsx');
  for (const gone of ['useAuth', 'hasTier', 'capTableHolderApi', 'readGrants', "role || ''"]) assert.ok(!src.includes(gone), gone);
  assert.match(src, /const standingOf = \(today\) => scenarioStanding\(today\.status === 'ready' \? today\.data\?\.capabilities : null\);/);
  assert.equal((src.match(/= standingOf\(today\);/g) || []).length, 3, 'the list, a scenario and Compare');
});

test('Runway\'s Forecast, Scenarios and Compare read their own read\'s map through uofViewer', () => {
  const src = read('src/pages/raise/useoffunds/ScenariosForecast.jsx');
  assert.match(src, /const canEdit = uofViewer\(d\?\.capabilities\)\.can_write;/);
  assert.match(src, /const canEdit = uofViewer\(read\.data\?\.capabilities\)\.can_write;/);
  assert.match(src, /compareTable\(d, uofViewer\(d\.capabilities\)\)/);
  for (const id of ['uof-drivers-edit', 'uof-forecast-save', 'uof-scenarios-new', 'uof-scenario-edit', 'uof-scenario-make-base', 'uof-scenario-delete']) {
    const at = src.indexOf(`data-testid="${id}"`);
    assert.ok(at > 0, id);
    assert.match(src.slice(src.lastIndexOf('\n', at), at), /canEdit/, `${id} is drawn under canEdit`);
  }
  for (const gone of ['useAuth', 'hasTier', 'plan.viewer', "role === 'admin'"]) assert.ok(!src.includes(gone), gone);
});

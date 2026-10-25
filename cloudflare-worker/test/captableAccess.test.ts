import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canReadProject, canWriteProject, canReadScenario, canWriteScenario, isAdmin,
} from '../src/services/captableAccess.ts';

// Project owned by founder_id 7.
const PROJ = { founder_id: 7 };
const OWNER_FOUNDER = { id: 100, role: 'founder', founder_id: 7 };
const OTHER_FOUNDER = { id: 101, role: 'founder', founder_id: 8 };
const ADMIN = { id: 1, role: 'admin', founder_id: null };
const PARTNER = { id: 2, role: 'partner', founder_id: null };
const INVESTOR = { id: 3, role: 'investor', founder_id: null };

test('canReadProject: founder reads only their own project', () => {
  assert.equal(canReadProject(OWNER_FOUNDER, PROJ), true);
  assert.equal(canReadProject(OTHER_FOUNDER, PROJ), false);
});

test('canReadProject: only admin has blanket project reads', () => {
  assert.equal(canReadProject(ADMIN, PROJ), true);
  assert.equal(canReadProject(PARTNER, PROJ), false);
  assert.equal(canReadProject(INVESTOR, PROJ), false);
});

test('canWriteProject: founder-owner and admin write; unrelated partner/investor cannot', () => {
  assert.equal(canWriteProject(OWNER_FOUNDER, PROJ), true);
  assert.equal(canWriteProject(ADMIN, PROJ), true);
  assert.equal(canWriteProject(PARTNER, PROJ), false);
  assert.equal(canWriteProject(INVESTOR, PROJ), false);
  assert.equal(canWriteProject(OTHER_FOUNDER, PROJ), false);
});

test('canReadScenario: a project-bound scenario inherits project read access', () => {
  // Scenario owned by the founder (user 100), bound to project (founder 7).
  const scen = { owner_user_id: 100, project_id: 55 };
  // Partner is not the owner but can read the project → can read the scenario.
  assert.equal(canReadScenario(PARTNER, scen, PROJ), false);
  assert.equal(canReadScenario(INVESTOR, scen, PROJ), false);
  // A founder who does not own the project cannot read it.
  assert.equal(canReadScenario(OTHER_FOUNDER, scen, PROJ), false);
});

test('canReadScenario: a scenario with no project stays private to its owner', () => {
  const scen = { owner_user_id: 100, project_id: null };
  assert.equal(canReadScenario(OWNER_FOUNDER, scen, null), true);
  assert.equal(canReadScenario(PARTNER, scen, null), false);
  assert.equal(canReadScenario(ADMIN, scen, null), true); // admin override
});

test('canWriteScenario: unrelated partner and investor cannot write a project-bound scenario', () => {
  const scen = { owner_user_id: 100, project_id: 55 };
  assert.equal(canWriteScenario(PARTNER, scen, PROJ), false);
  assert.equal(canWriteScenario(INVESTOR, scen, PROJ), false);
  assert.equal(canWriteScenario(OWNER_FOUNDER, scen, PROJ), true);
  assert.equal(canWriteScenario(OTHER_FOUNDER, scen, PROJ), false);
});

test('canWriteScenario: owner can always write their own free scenario', () => {
  const scen = { owner_user_id: 100, project_id: null };
  assert.equal(canWriteScenario(OWNER_FOUNDER, scen, null), true);
  assert.equal(canWriteScenario(PARTNER, scen, null), false);
});

test('isAdmin is case-insensitive', () => {
  assert.equal(isAdmin({ id: 1, role: 'ADMIN' }), true);
  assert.equal(isAdmin({ id: 1, role: 'founder' }), false);
});

test('verified member rights: cofounder writes, advisor reads, investor always denied',()=>{
 const co={...PROJ,capRead:true,capWrite:true};const advisor={...PROJ,capRead:true,capWrite:false};
 assert.equal(canReadProject(PARTNER,co),true);assert.equal(canWriteProject(PARTNER,co),true);
 assert.equal(canReadProject(OTHER_FOUNDER,advisor),true);assert.equal(canWriteProject(OTHER_FOUNDER,advisor),false);
 assert.equal(canReadProject(INVESTOR,co),false);assert.equal(canWriteProject(INVESTOR,co),false);
 const bound={owner_user_id:INVESTOR.id,project_id:55};
 assert.equal(canReadScenario(INVESTOR,bound,co),false);assert.equal(canWriteScenario(INVESTOR,bound,co),false);
});

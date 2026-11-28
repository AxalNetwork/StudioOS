/**
 * D9199 (#9199) — Due diligence's Cases tab tells a plan gate from a failure.
 * A 402 from the `/api/dd` paywall prefix is the locked state with See plans
 * and no Try again (a retry cannot change a plan); any other failure keeps the
 * failure state with Try again; and no sentence names Approvals, which is a
 * different page. Every name and id is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/dd_cases_plan_gate_9199.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { ddDeskApi } from '../src/lib/api.js';
import { DdListPage } from '../src/pages/AdminDueDiligencePage.jsx';
import * as model from '../src/pages/duediligence/ddListModel.js';

const { LIST_FAILED_SUB, LIST_LOCKED_SUB, PLANS_PATH, listFailure, lockedTitle } = model;
const INVESTOR = { id: 6, role: 'investor', name: 'Ivy Example' };
const ORIG = { ...ddDeskApi };
const restore = () => Object.assign(ddDeskApi, ORIG);
const refusal = (status, data = null) => Object.assign(new Error(`HTTP ${status}`), { status, data });
const PLAN_GATE = refusal(402, { error: 'investor_tier_required', required: 'professional', plan: { tier: 'professional', name: 'Professional' } });

const textOf = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || '' : node.childNodes?.length ? node.childNodes.map(textOf).join('') : node.textContent || '');
const byId = (v, id) => v.nodes().filter((n) => v.props(n)?.['data-testid'] === id);
const settle = async (v) => { await act(async () => { await new Promise((r) => setImmediate(r)); }); await v.flush(); };

async function desk(fail) {
  ddDeskApi.cases = async () => { throw fail; };
  ddDeskApi.overview = async () => { throw fail; };
  ddDeskApi.templates = async () => ({ templates: [], can_edit: false });
  const v = await mountContracts(React.createElement(DdListPage, { me: INVESTOR }), '/due-diligence');
  await settle(v);
  await settle(v);
  return v;
}

test('the rules: a 402 is locked, a 404 is the dev environment, anything else is a failure', () => {
  assert.equal(listFailure(PLAN_GATE), 'locked');
  assert.equal(listFailure(refusal(402)), 'locked', 'a 402 with no body is still the plan gate');
  assert.equal(listFailure(refusal(404)), 'unavailable');
  for (const s of [500, 503, 403, 401, undefined]) assert.equal(listFailure(refusal(s)), 'failed', String(s));
  assert.equal(lockedTitle(PLAN_GATE), 'Due diligence is on the Professional plan.');
  assert.equal(lockedTitle(refusal(402)), 'Due diligence is not on your plan.');
});

test('no sentence the list model draws names Approvals; the failure sub-copy names Due diligence', () => {
  assert.match(LIST_FAILED_SUB, /Due diligence/);
  for (const [name, value] of Object.entries(model)) {
    if (typeof value === 'string') assert.doesNotMatch(value, /Approvals/, name);
  }
});

test('a 402 draws the locked state: See plans, and no Try again anywhere', async () => {
  const v = await desk(PLAN_GATE);
  try {
    const [locked] = byId(v, 'dd-list-locked');
    assert.ok(locked, 'the locked state is drawn');
    assert.equal(textOf(locked), `Due diligence is on the Professional plan.${LIST_LOCKED_SUB}See plans`);
    const [plans] = byId(v, 'dd-see-plans');
    assert.equal(v.props(plans).href, '/pricing?for=investor', 'the investor plans, as every other investor plan gate links');
    assert.equal(PLANS_PATH, '/pricing?for=investor');
    assert.equal(byId(v, 'dd-list-failed').length, 0, 'the plan gate was drawn as a failure');
    assert.equal(byId(v, 'dd-overview-failed').length, 0, 'the figures offered a retry the plan refuses');
    assert.equal(byId(v, 'dd-open-case').length, 0, 'Open a case is offered behind the gate');
    assert.ok(!v.nodes().some((n) => /Try again/.test(textOf(n))), 'a Try again is drawn behind the plan gate');
  } finally { await v.unmount(); restore(); }
});

test('a 500 keeps the failure state with Try again, and no locked state', async () => {
  const v = await desk(refusal(500));
  try {
    const [failed] = byId(v, 'dd-list-failed');
    assert.ok(failed, 'the failure state is drawn');
    assert.match(textOf(failed), /We could not load the cases\.The rest of Due diligence still works\. This is not an empty list\.Try again/);
    assert.equal(byId(v, 'dd-list-locked').length, 0);
    assert.equal(byId(v, 'dd-see-plans').length, 0);
  } finally { await v.unmount(); restore(); }
});

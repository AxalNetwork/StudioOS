/**
 * #6425 (D6425) — the Pass dialog says "The studio that invited you is told you passed" only when the pass
 * really answers the viewer's own invitation: a flow row carries `my_invitation`, and New for you's invitation
 * items are always the viewer's own open invitation.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_flow_pass_invitation_6425.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flowRows, passAnswersInvitation } from '../src/pages/investor/dealflow/flowModel.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('a row says whether a pass answers the viewer\'s own invitation', () => {
  // Mutation checked: the rule read from entered_via → a colleague's invited row claims the studio is told;
  // 'interested' left out → an interested invitation is re-answered with no line.
  const flow = { items: [
    { deal_id: 1, venture: 'Synthetic A', entered_via: 'invited', my_invitation: 'invited' },
    { deal_id: 2, venture: 'Synthetic B', entered_via: 'invited', my_invitation: null },
    { deal_id: 3, venture: 'Synthetic C', entered_via: 'added', my_invitation: 'interested' },
    { deal_id: 4, venture: 'Synthetic D', entered_via: 'invited', my_invitation: 'passed' },
  ] };
  const rows = flowRows('mine', { flow, deals: [] });
  assert.deepEqual(rows.map((r) => [r.name, r.myInvitation, passAnswersInvitation(r)]), [
    ['Synthetic A', 'invited', true],
    ['Synthetic B', null, false],
    ['Synthetic C', 'interested', true],
    ['Synthetic D', 'passed', false],
  ]);
  assert.equal(passAnswersInvitation(null), false);
});

test('the flow table\'s Pass dialog takes its line from that rule; New for you keeps its invitation items', () => {
  const flowPage = read('frontend/src/pages/investor/dealflow/DealFlow.jsx');
  assert.match(flowPage, /<PassDialog row=\{dialog\.row\} invited=\{passAnswersInvitation\(dialog\.row\)\}/);
  assert.doesNotMatch(flowPage, /invited=\{dialog\.row\.enteredVia === 'invited'\}/);
  assert.match(read('frontend/src/pages/investor/dealflow/NewForYou.jsx'), /invited=\{dialog\.item\.source === 'invitation'\}/);
  // New for you lists only the viewer's own invitations that are still 'invited' (the Worker's source query).
  assert.match(read('cloudflare-worker/src/services/dealFlow.ts'), /FROM deal_invitations x WHERE x\.investor_user_id = \? AND x\.status = 'invited'/);
});

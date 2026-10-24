import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMUNITY_CONSOLES } from '../src/pages/branch/BranchCommunity.jsx';
import { ADMIN_PLACEMENT } from '../src/lib/adminPlacement.js';
import { hqApprovalsView } from '../src/pages/admin/adminStudioOverview.js';

test('D935: the branch expert card names the existing resource library', () => {
  const card = COMMUNITY_CONSOLES.find((c) => c.key === 'wellbeing');
  assert.equal(card.to, '/admin?tab=wellbeing');
  assert.match(card.what, /Curated resources are managed in the Wellbeing resource library\./);
  assert.doesNotMatch(card.what, /nothing in the admin product calls|have no console/);
});

test('D935: Circles has a Community card and no secondary Approvals placement', () => {
  const circles = ADMIN_PLACEMENT.find((c) => c.label === 'Communities Admin');
  assert.equal(circles.route, '/admin/circles');
  assert.equal(circles.row, 'Community');
  assert.equal(circles.how, 'Card link. Circles have no approval queue.');
  assert.deepEqual(circles.also || [], []);
});

test('D935: only the creation-based Jobs age says oldest created, in the card and summary', () => {
  for (const [key, label, hours, age] of [
    ['jobs', 'Jobs', 5, 'created 5h'],
    ['jobs', 'Jobs', null, 'created undated'],
    // #2700 already moved Events to submitted_at on current main.
    ['events', 'Events', 5, '5h'],
    ['kyc', 'KYC', 96, '4 days'],
  ]) {
    const input = { pending_total: 1, lanes: [{ key, label, count: 1, oldest_age_hours: hours, sla: 'ok' }] };
    const view = hqApprovalsView(input);
    assert.equal(view.lanes[0].age, age);
    assert.equal(view.text, `1 pending · worst: ${label}, oldest ${age}`);
    assert.equal(input.lanes[0].oldest_age_hours, hours, 'formatting leaves the recorded age intact');
  }
});

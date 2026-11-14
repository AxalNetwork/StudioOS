import test from 'node:test';
import assert from 'node:assert/strict';
import { eventRules, jobState, mainPush, renderInventory, withInventory } from '../../scripts/workflow-inventory.mjs';

test('checks plain event comparisons and leaves compound conditions visible', () => {
  assert.deepEqual(eventRules('push'), { push: null });
  assert.deepEqual(eventRules(['push', 'schedule']), { push: null, schedule: null });
  assert.equal(jobState("${{ github.event_name != 'merge_group' }}", 'merge_group'), 'excluded');
  assert.equal(jobState('github.event_name == "merge_group"', 'merge_group'), 'runs');
  assert.equal(jobState("github.event_name == 'push' && success()", 'pull_request'), 'conditional');
  assert.equal(jobState(false, 'push'), 'excluded');
  assert.equal(mainPush({ branches: ['agent/**'] }), 'excluded');
  assert.equal(mainPush({ branches: ['**', '!main'] }), 'excluded');
  assert.equal(mainPush({ 'branches-ignore': ['release/**'] }), 'runs');
  assert.equal(mainPush({ tags: ['v*'] }), 'excluded');
});

test('reports trigger families, required contexts, shadow jobs and shared definitions', () => {
  const jobs = [
    { id: 'verify', name: 'Verify' },
    { id: 'shadow', name: 'Shadow', condition: "github.event_name == 'merge_group'" },
    { id: 'guard', name: 'Advisory guard', condition: "github.event_name != 'push' && success()" },
  ];
  const events = { pull_request: {}, pull_request_target: {}, merge_group: {}, push: { branches: ['main'] }, schedule: {} };
  const fixture = { file: 'checks.yml', name: 'Checks', events, jobs };
  const markdown = renderInventory([fixture], { Verify: 'checks.yml' }, { Shadow: 'checks.yml' });
  assert.match(markdown, /pull_request_target/);
  assert.match(markdown, /Verify \(required context\)/);
  assert.match(markdown, /Shadow \(shadow\)/);
  assert.match(markdown, /Advisory guard \(advisory, conditional\)/);
  assert.match(markdown, /Verify · pull_request, merge_group, push/);
  assert.match(markdown, /listen for `merge_group` \(1\): `checks\.yml`/);
  const withoutQueue = renderInventory([{ ...fixture, events: { pull_request: {} } }], {}, {});
  assert.match(withoutQueue, /listen for `merge_group` \(0\): none/);
  const readme = '<!-- workflow-inventory:start -->\n<!-- workflow-inventory:end -->';
  assert.notEqual(withInventory(readme, markdown), withInventory(readme, withoutQueue));
});

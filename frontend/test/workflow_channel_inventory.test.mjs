import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const catalog = JSON.parse(readFileSync(new URL('../../engineering-notifications/workflow-channels.json', import.meta.url)));
const directory = new URL('../../.github/workflows/', import.meta.url);
const snapshot = process.env.STUDIOOS_ACTIONS_WORKFLOW_SNAPSHOT;

test('each workflow has a distinct identity, path and Slack hashtag', () => {
  assert.equal(catalog.repository, 'AxalNetwork/StudioOS');
  const paths = new Set(), ids = new Set(), channels = new Set();
  for (const { id, path, channel } of catalog.workflows) {
    assert.match(path, /^(?:\.github\/workflows\/[\w.-]+\.ya?ml|dynamic\/[\w.-]+\/[\w.-]+)$/);
    assert.match(channel, /^#axalvc-actions-[a-z0-9-]+$/);
    assert.ok(channel.length <= 81, channel);
    assert.ok(!paths.has(path), `duplicate path: ${path}`);
    assert.ok(!channels.has(channel), `duplicate hashtag: ${channel}`);
    paths.add(path);
    channels.add(channel);
    // New YAML may land before GitHub assigns it a workflow ID.
    if (id === null) continue;
    assert.ok(Number.isSafeInteger(id) && id > 0, `invalid ID: ${path}`);
    assert.ok(!ids.has(id), `duplicate workflow ID: ${id}`);
    ids.add(id);
  }
  for (const name of readdirSync(directory).filter(name => /\.ya?ml$/.test(name))) {
    assert.ok(paths.has(`.github/workflows/${name}`), `missing Slack hashtag for ${name}`);
  }
});

function checkRegistrations(data) {
  const pages = Array.isArray(data) ? data : [data];
  const workflows = pages.flatMap(page => page.workflows);
  assert.equal(new Set(workflows.map(row => row.id)).size, pages[0].total_count, 'incomplete Actions API response');
  const paths = new Map(catalog.workflows.map(row => [row.id, row.path]));
  for (const { id, path, state } of workflows) {
    if (state === 'active') assert.equal(paths.get(id), path, `review and register active workflow ${id}: ${path}`);
  }
}

test('registration checks handle pagination, drift and retired workflows', () => {
  const [row] = catalog.workflows.filter(row => row.id !== null);
  const registered = { ...row, state: 'active' };
  const retired = { id: -1, path: 'old.yml', state: 'deleted' };
  checkRegistrations([{ total_count: 2, workflows: [registered] }, { total_count: 2, workflows: [retired] }]);
  assert.throws(() => checkRegistrations({ total_count: 2, workflows: [registered] }), /incomplete/);
  assert.throws(() => checkRegistrations({ total_count: 1, workflows: [{ ...registered, path: 'renamed.yml' }] }), /register active/);
  if (snapshot) checkRegistrations(JSON.parse(readFileSync(snapshot)));
});

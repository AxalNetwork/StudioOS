// D6387: exercise the signed event through Cloudflare intake and the exact GitHub workflow dispatch.
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';
import sender, { dispatchFailures } from '../../engineering-notifications/workflow-failure-dispatch.mjs';
import catalog from '../../engineering-notifications/workflow-channels.json' with { type: 'json' };

const source = catalog.workflows.find(w => w.path === '.github/workflows/ci.yml');
const reporter = catalog.workflows.find(w => w.path === '.github/workflows/github-alerts.yml');
function setup() {
  const queue = [], secret = randomBytes(32).toString('hex');
  const env = { WEBHOOK_SECRET: secret, REPOSITORY_ID: '123', INGRESS_LIMIT: { limit: async () => ({ success: true }) },
    FAILURES: { send: async pair => queue.push(pair) } };
  const run = { id: 26, run_attempt: 2, workflow_id: source.id, status: 'completed', conclusion: 'failure' };
  const event = { action: 'completed', repository: { id: 123, full_name: catalog.repository }, workflow_run: run };
  const request = (data, { sign = secret, type = 'workflow_run' } = {}) => {
    const body = JSON.stringify(data);
    return new Request('https://example.test/github', { method: 'POST', body, headers: {
      'x-hub-signature-256': 'sha256=' + createHmac('sha256', sign).update(body).digest('hex'), 'x-github-event': type
    } });
  };
  return { queue, env, run, event, request };
}

test('verified completions carry only run and attempt into a single bounded dispatch to main', async () => {
  const { queue, env, run, event, request } = setup();
  for (const conclusion of ['failure', 'startup_failure', 'action_required', 'timed_out']) {
    const response = await sender.fetch(request({ ...event, workflow_run: { ...run, conclusion, display_title: '@untrusted', head_branch: 'unknown' } }), env);
    assert.equal(response.status, 202);
  }
  assert.deepEqual(queue, [[26, 2],[26, 2],[26, 2],[26, 2]]);
  queue.push([26, 3]);
  let sent = 0;
  await dispatchFailures({ messages: queue.map(body => ({ body })) }, { WORKFLOW_DISPATCH_TOKEN: 'test' }, async (url, options) => {
    sent++;
    assert.equal(url, 'https://api.github.com/repos/AxalNetwork/StudioOS/actions/workflows/github-alerts.yml/dispatches');
    assert.deepEqual(JSON.parse(options.body), { ref: 'main', inputs: { check: 'workflow-failures', attempts: '[[26,2],[26,3]]' } });
    assert.equal(options.redirect, 'error');
    return new Response(null, { status: 204 });
  });
  assert.equal(sent, 1);
});

test('refuses wrong sources and malformed attempts, ignores benign outcomes and its own reporter', async () => {
  const { queue, env, run, event, request } = setup();
  const send = async (payload, opts) => (await sender.fetch(request(payload, opts), env)).status;
  assert.equal(await send(event, { sign: 'other' }), 401);
  assert.equal(await send({ ...event, repository: { id: 99, full_name: catalog.repository } }), 403);
  assert.equal(await send({ ...event, workflow_run: { ...run, run_attempt: 0 } }), 400);
  assert.equal(await send({ ...event, workflow_run: { ...run, workflow_id: reporter.id } }), 204);
  for (const conclusion of ['success', 'skipped', 'neutral', 'cancelled']) {
    assert.equal(await send({ ...event, workflow_run: { ...run, conclusion } }), 204);
  }
  assert.equal(await send(event, { type: 'issues' }), 204);
  env.INGRESS_LIMIT.limit = async () => ({ success: false });
  assert.equal(await send(event), 429);
  assert.deepEqual(queue, []);
});

test('failed dispatch retries the queue; corrupt and oversized batches never make a request', async () => {
  const send = (pairs, env, fetcher) => dispatchFailures({ messages: pairs.map(body => ({ body })) }, env, fetcher);
  const env = { WORKFLOW_DISPATCH_TOKEN: 'test' };
  const never = () => assert.fail('unexpected request');
  await assert.rejects(send([[1,1]], {}, never), /not_configured/);
  await assert.rejects(send([[1,1]], env, async () => new Response(null, { status: 503 })), /http_503/);
  await assert.rejects(send([[1,'1']], env, never), /invalid/);
  await assert.rejects(send(Array.from({length:21}, (_, i) => [i + 1,1]), env, never), /too_large/);
});

// D6370: reconcile complete run attempts to their dedicated private channel through the production outbox and Slack transport.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { SlackOutbox } from '../../engineering-slack/outbox.mjs';
import { WorkflowLogRelay } from '../../engineering-slack/workflow-channels.mjs';
import { slackTransport } from '../../engineering-slack/transport.mjs';
import { registryOf } from '../../engineering-slack/presentation-v1.mjs';
import catalog from '../../engineering-notifications/workflow-channels.json' with { type: 'json' };

const workflow = catalog.workflows.find(row => row.path === '.github/workflows/ci.yml');
const managed = catalog.workflows.find(row => row.path === 'dynamic/dependabot/dependabot-updates');
const now = Date.parse('2026-11-14T12:00:00Z');
const destination = id => ({ id, private: true, enabled: true, retentionDays: 30, publisher: 'internal-bot' });
function config(routes) {
  return { schema: 1, version: 1, reviewedBy: 'guillaumelauzier', approvedAt: new Date(now).toISOString(), teamId: 'TTEST', channels: routes };
}
function event(sequence, row, state = 'success', attempt = 1) {
  return { sequence, schema: 1, visibility: 'public', repository: catalog.repository,
    family: 'ci', kind: 'workflow_run', ids: { workflow: String(row.id), run: String(row.id + 3), attempt: String(attempt) },
    state, occurredAt: new Date(now).toISOString(), title: '<!channel> untrusted title', name: 'bogus', url: 'https://example.invalid' };
}
function fixture(t, routes) {
  let clock = now;
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql = { exec(statement, ...bindings) {
    const rows = db.prepare(statement).all(...bindings);
    return { toArray: () => rows };
  } };
  const transaction = fn => {
    db.exec('BEGIN');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const sent = [];
  let rejectChannel;
  function make(channels) {
    const outbox = new SlackOutbox({ sql, transaction, registry: config(channels), now: () => clock, jitter: () => 0,
      deliver: async request => {
        sent.push(request);
        if (request.channel.id === rejectChannel) return { state: 'retry', code: 'rate_limited', retryAfterMs: 5000 };
        return { state: 'acknowledged', receipt: { channel: request.channel.id, ts: '123.000123', transport: 'adapter', status: 200 } };
      } });
    return { outbox, relay: new WorkflowLogRelay(outbox) };
  }
  return { ...make(routes), make, sent, advance: ms => clock += ms, reject: id => rejectChannel = id };
}
function source(rows) {
  return { history: async ({ after, limit }) => rows.filter(row => row.sequence > after).slice(0, limit) };
}
const key = (row, attempt) => ['workflow-attempt', catalog.repository, row.id, row.id + 3, attempt].join(':');

test('terminal run attempts survive duplicate events, restarts and delayed route registration; Slack failure is isolated', async t => {
  const ci = 'workflow:' + workflow.id, assistant = 'workflow:' + managed.id;
  const routes = { [ci]: destination('CONE') };
  const f = fixture(t, routes);
  const rows = [event(1, workflow, 'in_progress'), event(2, workflow, 'failure'), event(3, workflow, 'failure'),
    event(4, workflow, 'success', 2), event(5, managed, 'cancelled'), { ...event(6, managed), kind: 'workflow_job' }];
  await f.relay.poll(source(rows));
  assert.deepEqual(f.relay.summary(), { cursor: 6, unmapped: 1 });
  assert.equal(f.outbox.get(key(workflow, 1)).channel, 'CONE');
  assert.equal(f.outbox.get(key(managed, 1)), null);
  const { relay, outbox } = f.make({ ...routes, [assistant]: destination('CTWO') });
  await relay.poll(source(rows));
  assert.deepEqual(relay.summary(), { cursor: 6, unmapped: 0 });
  f.reject('CONE');
  assert.equal((await outbox.tick()).state, 'retry');
  assert.equal((await outbox.tick()).key, key(managed, 1));
  f.reject(undefined); f.advance(5000);
  assert.equal((await outbox.tick()).key, key(workflow, 1)); f.advance(1000);
  assert.equal((await outbox.tick()).key, key(workflow, 2));
  for (const [record, attempt, result, channelId] of [[workflow, 1, 'failure', 'CONE'], [workflow, 2, 'success', 'CONE'], [managed, 1, 'cancelled', 'CTWO']]) {
    const post = outbox.get(key(record, attempt));
    assert.equal(post.text, `[${result}] Run ${record.id + 3}, attempt ${attempt} · <https://github.com/${catalog.repository}/actions/runs/${record.id + 3}/attempts/${attempt}|Open GitHub Actions logs>`);
    assert.equal(post.receipt.channel, channelId);
  }
  assert.equal(f.sent.length, 4);
});

test('page transactions roll back on invalid source; a backlog drains across multiple full pages', async t => {
  const f = fixture(t, { ['workflow:' + workflow.id]: destination('CONE') });
  await assert.rejects(f.relay.poll(source([event(1, workflow), { ...event(2, managed), visibility: 'restricted' }])), /source_page_invalid/);
  assert.deepEqual(f.relay.summary(), { cursor: 0, unmapped: 0 });
  assert.equal(f.outbox.get(key(workflow, 1)), null);
  const rows = Array.from({ length: 212 }, (_, i) => event(i + 1, workflow));
  await f.relay.poll(source(rows));
  assert.deepEqual(f.relay.summary(), { cursor: 212, unmapped: 0 });
  assert.equal((await f.outbox.tick()).state, 'acknowledged');
  assert.equal((await f.outbox.tick()).state, 'idle');
});

test('send-time checks bind exact Slack workspace, private nonshared membership, hashtag and receipt', async () => {
  const role = 'workflow:' + workflow.id, registry = registryOf(config({ [role]: destination('CONE') }));
  assert.throws(() => registryOf(config({ [role]: { ...destination('CONE'), private: false } })), /public/);
  assert.throws(() => registryOf(config({ ['workflow:9999999999999']: destination('CONE') })), /invalid/);
  const room = { id: 'CONE', name: workflow.channel.slice(1), is_private: true, is_archived: false, is_shared: false, is_ext_shared: false, is_pending_ext_shared: false };
  async function send({ channel = room, team = 'TTEST', receipt = 'CONE' } = {}) {
    let posts = 0;
    const transport = slackTransport({ token: 'fixture', fetchImpl: async (url, options) => {
      const method = new URL(url).pathname.split('/').at(-1);
      if (method === 'auth.test') return Response.json({ ok: true, team_id: team, bot_id: 'BFIXTURE' });
      if (method === 'users.conversations') {
        assert.equal(options.method, 'GET');
        const second = new URL(url).searchParams.get('cursor') === 'page2';
        return Response.json(second ? { ok: true, channels: [channel] } : { ok: true, channels: [], response_metadata: { next_cursor: 'page2' } });
      }
      assert.equal(method, 'chat.postMessage'); posts++;
      return Response.json({ ok: true, channel: receipt, ts: '123.000123' });
    } });
    const outcome = await transport({ registry, channel: registry.channels[role], operation: 'post', text: 'fixture', clientId: 'fixture' });
    return [outcome.state, posts];
  }
  assert.deepEqual(await send(), ['acknowledged', 1]);
  for (const overrides of [{ name: 'wrong' }, { is_shared: true }, { is_ext_shared: true }, { is_pending_ext_shared: true }, { is_private: false }, { id: 'CMISSING' }, { is_archived: true }]) {
    assert.deepEqual(await send({ channel: { ...room, ...overrides } }), ['dead', 0]);
  }
  assert.deepEqual(await send({ team: 'TOTHER' }), ['dead', 0]);
  assert.deepEqual(await send({ receipt: 'COTHER' }), ['ambiguous', 1]);
});

test('a pilot channel drains past hundreds of held attempts and a held-only queue stays asleep', async t => {
  const f = fixture(t, {
    ['workflow:' + workflow.id]: { ...destination('CONE'), enabled: false },
    ['workflow:' + managed.id]: destination('CTWO'),
  });
  const rows = Array.from({ length: 250 }, (_, i) => event(i + 1, workflow, 'failure', i + 1));
  rows.push(event(251, managed, 'success'));
  await f.relay.poll(source(rows));
  assert.equal(f.outbox.nextWake(), now + 1000);
  assert.equal((await f.outbox.tick()).key, key(managed, 1));
  assert.equal(f.outbox.nextWake(), null);
  assert.equal((await f.outbox.tick()).state, 'idle');
  assert.equal(f.sent.length, 1);
});

test('the sender cron polls its service binding and its durable alarm acknowledges only the enabled workflow', async t => {
  const { createRequire } = await import('node:module');
  const require = createRequire(new URL('../../cloudflare-worker/package.json', import.meta.url));
  const { build } = require('esbuild');
  const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
  const worker = new URL('../../engineering-slack/worker.mjs', import.meta.url).pathname;
  const fixtureEntry = `
    import sender, { DeliveryActor } from ${JSON.stringify(worker)};
    export class RecordingActor extends DeliveryActor {
      constructor(ctx, env) {
        super(ctx, env);
        ctx.blockConcurrencyWhile(async () => {
          this.outbox.now = () => Number(env.FIXTURE_TIME);
          this.outbox.deliver = async request => ({ state: 'acknowledged', receipt: {
            channel: request.channel.id, ts: '123.000123', transport: 'adapter', status: 200
          } });
        });
      }
    }
    export default {
      async fetch(request, env) {
        const actor = env.OUTBOX.getByName('workspace:TTEST');
        const url = new URL(request.url);
        if (url.pathname === '/cron') {
          const work = [];
          await sender.scheduled({}, env, { waitUntil: promise => work.push(promise) });
          await Promise.all(work);
          return Response.json(await actor.summary());
        }
        return Response.json(await actor.receipt(url.searchParams.get('key')));
      }
    };`;
  const bundle = await build({ stdin: { contents: fixtureEntry, resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers'] });
  const rows = [event(1, workflow, 'failure'), event(2, managed, 'cancelled')];
  const mf = new Miniflare(convertV4MiniflareOptions({
    workers: [
      { name: 'sender', script: bundle.outputFiles[0].text, modules: true, compatibilityDate: '2026-11-08', compatibilityFlags: ['nodejs_compat'],
        durableObjects: { OUTBOX: { className: 'RecordingActor', useSQLite: true } },
        bindings: { FIXTURE_TIME: String(now), WORKFLOW_LOGS_ENABLED: 'true', DELIVERY_ENABLED: 'true', ROUTING_REGISTRY: JSON.stringify(config({
          ['workflow:' + workflow.id]: destination('CONE'), ['workflow:' + managed.id]: { ...destination('CTWO'), enabled: false },
        })) },
        serviceBindings: { ENGINEERING_EVENTS: { name: 'source', entrypoint: 'EngineeringEvents' } } },
      { name: 'source', modules: true, compatibilityDate: '2026-11-08', script: `
        import { WorkerEntrypoint } from 'cloudflare:workers';
        export class EngineeringEvents extends WorkerEntrypoint {
          async history({ visibility, after, limit }) {
            if (visibility !== 'public') throw Error('wrong_partition');
            return ${JSON.stringify(rows)}.filter(row => row.sequence > after).slice(0, limit);
          }
        }
        export default { async fetch() { return new Response('service binding only', { status: 404 }); } };` },
    ],
  }));
  t.after(() => mf.dispose());
  const read = async path => {
    const response = await mf.dispatchFetch('https://fixture' + path);
    const body = await response.text();
    assert.equal(response.status, 200, body);
    return JSON.parse(body);
  };
  assert.deepEqual((await read('/cron')).workflowLogs, { cursor: 2, unmapped: 0 });
  let receipt;
  await t.waitFor(async () => {
    receipt = await read('/receipt?key=' + key(workflow, 1));
    assert.equal(receipt.state, 'acknowledged');
  }, { timeout: 10_000 });
  assert.equal(receipt.receipt.channel, 'CONE');
  await read('/cron');
  assert.equal((await read('/receipt?key=' + key(workflow, 1))).attempts, 1);
  const held = await read('/receipt?key=' + key(managed, 1));
  assert.equal(held.state, 'pending');
  assert.equal(held.attempts, 0);
});

/**
 * D1528 (#3847, E3 of #3742) — the runtime's bindings, in all three of
 * wrangler.toml's tables and in a branch's generated config:
 *   · `AGENT_QUEUE` (producer, consumer and its DLQ), `AGENT_SCOPE` and
 *     `AGENT_TASK` at the top level, under `[env.production]` with the same
 *     names, and under `[env.preview]` with `-preview` names;
 *   · the `v3-agent-scope` migration tag in all three migration tables;
 *   · `AGENT_ENGINE`, `AGENT_AUTONOMY` and `AGENT_RUNTIME` default to `off`,
 *     `manual` and `do`, and `AGENT_AI_GATEWAY` is set nowhere;
 *   · the cron lists are unchanged (the sweep has no cron line of its own);
 *   · a branch gets its own agent queue, DLQ and Workflow, and the branch
 *     check fails one that keeps HQ's Workflow or sends AGENT_QUEUE to the
 *     job queue.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_engine_bindings_d1528.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkRendered, derivedNames, parseToml, renderBranchConfig } from '../../scripts/lib/branchConfig.mjs';
import { missingFromProduction } from '../../scripts/check-wrangler-binding-parity.mjs';

const TOML = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
const EXAMPLE = JSON.parse(readFileSync(new URL('../../infra/branches/_example.json', import.meta.url), 'utf8'));
const { sections } = parseToml(TOML);
const unq = (v: string | undefined) => (v === undefined ? undefined : JSON.parse(v));
const TABLES = [['top', '', ''], ['production', 'env.production.', ''], ['preview', 'env.preview.', '-preview']] as const;
const inTable = (prefix: string, table: string) => sections.filter((s: any) => s.name === `${prefix}${table}`);

for (const [label, prefix, sfx] of TABLES) {
  test(`${label}: the agent queue, its consumer and DLQ, the scope object and the task Workflow`, () => {
    const producers = inTable(prefix, 'queues.producers').filter((s: any) => unq(s.kv.get('binding')) === 'AGENT_QUEUE');
    assert.deepEqual(producers.map((s: any) => unq(s.kv.get('queue'))), [`studioos-agent-queue${sfx}`]);
    const consumers = inTable(prefix, 'queues.consumers');
    const main = consumers.find((s: any) => unq(s.kv.get('queue')) === `studioos-agent-queue${sfx}`);
    assert.ok(main, 'the agent queue has a consumer');
    assert.deepEqual(['max_batch_size', 'max_batch_timeout', 'max_retries', 'max_concurrency', 'retry_delay', 'dead_letter_queue'].map((k) => unq(main.kv.get(k))),
      [5, 5, 3, 10, 30, `studioos-agent-queue${sfx}-dlq`]);
    assert.ok(consumers.find((s: any) => unq(s.kv.get('queue')) === `studioos-agent-queue${sfx}-dlq`), 'the DLQ has its consumer (the mirror)');
    const dos = inTable(prefix, 'durable_objects.bindings').filter((s: any) => unq(s.kv.get('name')) === 'AGENT_SCOPE');
    assert.deepEqual(dos.map((s: any) => unq(s.kv.get('class_name'))), ['AgentScope']);
    assert.ok(!dos[0].kv.has('jurisdiction') && !dos[0].kv.has('script_name'), 'no jurisdiction in v1; the class is this Worker\'s');
    const wf = inTable(prefix, 'workflows');
    assert.deepEqual(wf.map((s: any) => [unq(s.kv.get('name')), unq(s.kv.get('binding')), unq(s.kv.get('class_name'))]),
      [[`studioos-agent-task${sfx}`, 'AGENT_TASK', 'AgentTaskWorkflow']]);
    assert.equal(wf[0].kv.get('default_retention'), '{ success_retention = "7 days", error_retention = "30 days" }', 'owner Q6 A');
    const migs = inTable(prefix, 'migrations');
    assert.deepEqual(migs.map((s: any) => unq(s.kv.get('tag'))), ['v1-realtime', 'v2-meeting-bot', 'v3-agent-scope'], 'append-only');
    assert.equal(migs[2].kv.get('new_sqlite_classes'), '["AgentScope"]');
  });

  test(`${label}: the engine's vars default to off, manual and do; no gateway is set`, () => {
    const vars = inTable(prefix, 'vars')[0];
    assert.ok(vars);
    assert.deepEqual(['AGENT_ENGINE', 'AGENT_AUTONOMY', 'AGENT_RUNTIME'].map((k) => unq(vars.kv.get(k))), ['off', 'manual', 'do']);
    assert.equal(vars.kv.has('AGENT_AI_GATEWAY'), false, 'the owner creates the gateway first');
  });
}

test('the production table mirrors every agent binding, and the parity guard agrees', () => {
  assert.deepEqual(missingFromProduction(), []);
  const prodBindings = sections.filter((s: any) => s.name.startsWith('env.production.')).map((s: any) => unq(s.kv.get('binding') ?? s.kv.get('name')));
  for (const b of ['AGENT_QUEUE', 'AGENT_SCOPE', 'AGENT_TASK']) assert.ok(prodBindings.includes(b), `${b} under [env.production]`);
});

test('the cron lists are unchanged: the sweep runs inside the every-minute dispatcher', () => {
  const crons = (prefix: string) => {
    const v = inTable(prefix, 'triggers')[0]?.kv.get('crons');
    return v ? JSON.parse(v.replace(/,\s*\]/, ']')) : null;
  };
  // Pinned literally: the lists as they were before D1528.
  const HQ = ['* * * * *', '0 3 * * *', '0 */6 * * *', '0 4 * * *', '0 9 * * *', '0 9 * * 2'];
  assert.deepEqual(crons(''), HQ);
  assert.deepEqual(crons('env.production.'), HQ);
  assert.deepEqual(crons('env.preview.'), ['* * * * *', '0 */6 * * *', '0 4 * * *']);
});

test('a branch gets its own agent queue, DLQ and Workflow; the check fails one that keeps HQ\'s', () => {
  const n = derivedNames(EXAMPLE.code);
  const rendered = renderBranchConfig(TOML, EXAMPLE);
  assert.deepEqual(checkRendered(TOML, EXAMPLE, rendered), []);
  const out = parseToml(rendered).sections;
  const producer = out.find((s: any) => s.name === 'queues.producers' && unq(s.kv.get('binding')) === 'AGENT_QUEUE');
  assert.equal(unq(producer.kv.get('queue')), n.agentQueue);
  assert.equal(n.agentQueue, `studioos-${EXAMPLE.code}-agent-queue`);
  const consumer = out.find((s: any) => s.name === 'queues.consumers' && unq(s.kv.get('queue')) === n.agentQueue);
  assert.equal(unq(consumer.kv.get('dead_letter_queue')), `studioos-${EXAMPLE.code}-agent-queue-dlq`);
  assert.ok(out.find((s: any) => s.name === 'queues.consumers' && unq(s.kv.get('queue')) === n.agentDlq));
  const wf = out.find((s: any) => s.name === 'workflows');
  assert.equal(unq(wf.kv.get('name')), `studioos-${EXAMPLE.code}-agent-task`);
  assert.ok(out.find((s: any) => s.name === 'migrations' && unq(s.kv.get('tag')) === 'v3-agent-scope'));
  // A branch that kept HQ's Workflow, or sent AGENT_QUEUE to its job queue, fails the check.
  const keptWorkflow = rendered.replace(`name = "${n.agentTask}"`, 'name = "studioos-agent-task"');
  assert.ok(checkRendered(TOML, EXAMPLE, keptWorkflow).some((p: string) => /Workflow .*AGENT_TASK.* must be/.test(p)));
  const toJobQueue = rendered.replace(`binding = "AGENT_QUEUE"\nqueue = "${n.agentQueue}"`, `binding = "AGENT_QUEUE"\nqueue = "${n.queue}"`);
  assert.notEqual(toJobQueue, rendered, 'the substitution happened');
  assert.ok(checkRendered(TOML, EXAMPLE, toJobQueue).some((p: string) => /producer "AGENT_QUEUE" must send to/.test(p)));
});

test('index.ts exports both classes and keeps `main` unchanged', () => {
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(index, /^export \{ AgentScope \} from '\.\/agents\/doRuntime';$/m);
  assert.match(index, /^export \{ AgentTaskWorkflow \} from '\.\/agents\/taskWorkflow';$/m);
  const { root } = parseToml(TOML);
  assert.equal(unq(root.get('main')), 'cloudflare-worker/src/index.ts');
});

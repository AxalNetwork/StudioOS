// D8769 (#8769) — choosing an agent's model by the work it supports.
//
//   1. agentModels: each model carries the jobs it is listed for (USE_KINDS,
//      in AGENT_JOBS order, agent kinds only), its catalogue capabilities and
//      its context window, never a guessed one;
//   2. skillCountOf: an agent's skill count, null (never 0) when unreadable.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/team_agent_model_choice_8769.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_JOBS, agentModels, modelJobs } from '../src/services/agents/modelOffers.ts';
import { USE_KINDS } from '../src/services/ai/modelUseCases.ts';
import { CATALOGUE } from '../src/services/ai/catalogue.ts';
import { skillCountOf } from '../src/routes/team_agents.ts';

const ADMIN = { id: 1, role: 'admin', is_super_admin: 1, subscription_tier: 'growth', subscription_status: 'active' } as any;

test('1: each offered model carries its jobs, capabilities and context window from the catalogue and USE_KINDS', () => {
  // Mutations checked: jobs read from every USE_KINDS kind (voice and image kinds leak in) → the agent-kinds check fails;
  // jobs left in USE_KINDS key order → the order check fails; context_window defaulted to 0 → the catalogue check fails.
  const models = agentModels({} as any, ADMIN);
  assert.ok(models.length > 3);
  for (const m of models) {
    const row = CATALOGUE.find((c) => c.id === m.id)!;
    assert.deepEqual(m.capabilities, [...row.capabilities], m.id);
    assert.equal(m.context_window, row.context_window ?? null, m.id);
    assert.ok(m.jobs.every((j) => AGENT_JOBS.includes(j.key)), `${m.id}: only the jobs an agent's run does`);
    const order = m.jobs.map((j) => AGENT_JOBS.indexOf(j.key));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${m.id}: in AGENT_JOBS order`);
    for (const j of m.jobs) {
      assert.ok(USE_KINDS[j.key].models.includes(m.id), `${m.id} is listed for ${j.key}`);
      assert.equal(j.label, USE_KINDS[j.key].label);
    }
  }
  // Research lists four models (TMM05's "Suited to research"); each offered one says so.
  for (const id of USE_KINDS.research.models) {
    const m = models.find((x) => x.id === id);
    if (m) assert.equal(m.jobs[0].key, 'research', `${id} leads with research`);
  }
  assert.ok(models.some((m) => m.jobs.some((j) => j.key === 'research')), 'at least one research model is offered');
  assert.deepEqual(modelJobs('@cf/deepgram/aura-1'), [], 'a voice model is listed for no agent job');
  assert.deepEqual(modelJobs('not-a-model'), []);
});

test('2: skillCountOf — the agent\'s links, and null (never 0) when the count cannot be read', async () => {
  // Mutation checked: the catch returns 0 → the unreadable case fails.
  const seen: unknown[] = [];
  const db = (row: unknown, fail = false) => ({ DB: { prepare: (q: string) => ({ bind: (...a: unknown[]) => { seen.push([q, ...a]); return { first: async () => { if (fail) throw new Error('no such table: agent_skill_links'); return row; } }; } }) } }) as any;
  assert.equal(await skillCountOf(db({ n: 3 }), 7), 3);
  assert.match(String((seen[0] as unknown[])[0]), /FROM agent_skill_links WHERE agent_id = \?/);
  assert.equal((seen[0] as unknown[])[1], 7);
  assert.equal(await skillCountOf(db({ n: 0 }), 7), 0, 'a recorded 0 is 0');
  assert.equal(await skillCountOf(db(null, true), 7), null, 'unreadable is null');
  assert.equal(await skillCountOf(db(null), 7), null, 'no row is null');
});

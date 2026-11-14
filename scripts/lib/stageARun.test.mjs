// D4594 part 3 (#4594) — hosted Stage A's pure half (`stageARun.mjs`).
//   1. names are the run's own, and a non-run id is refused;
//   2. the rendered config: flat, workers.dev, no route, no cron, no browser, no service, every identity the run's;
//      it passes the real #4566 preflight as `isolated` with a matching observation, and NOT otherwise;
//   3. `checkFlat` refuses every way the config could reach production;
//   4. `reconcile` fails on a pending hold, a duplicate, settled ≠ charged, a live run, no proposal or a failed read.
//
//   node --test scripts/lib/stageARun.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CEILINGS, SKILL_RUNTIME_VARS, STAGE_A_ENV, STAGE_A_VARS, checkFlat, envView, extraSeed, fixtureIds, reconcile, renderFlat,
  skillRunVerdict, skillSeed, stageANames, stageASections, toCreate,
} from './stageARun.mjs';
import { buildFresh, postCutoffMigrations } from '../check-baseline-drift.mjs';
import { seedStatements, toSqlFile } from './agentSyntheticFixtures.mjs';
import { preflight } from './previewIsolation.mjs';
import { parseToml } from './branchConfig.mjs';

const TOML = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
const RUN = 'abc123';
const IDS = { d1: '11111111-2222-3333-4444-555555555555', kv: { TOKENS: 'a'.repeat(32), RATE_LIMITS: 'b'.repeat(32), OAUTH_KV: 'c'.repeat(32) } };
const rendered = () => stageASections(TOML, RUN, IDS);
const observation = (r, over = {}) => {
  const t = toCreate(r);
  return {
    taken_at: '2026-11-13T00:00:00Z', account_permissions: ['d1:read'], worker: r.names.worker,
    d1: { DB: { database_id: IDS.d1, database_name: r.names.d1.name } }, kv: IDS.kv,
    queues: t.queues, workflows: t.workflows, r2: t.buckets, secrets: ['JWT_SECRET'], vars: {}, inference: 'stub', browser: 'unused',
    ...over,
  };
};

test('names: every resource carries the run, and a non-run id is refused', () => {
  const n = stageANames(RUN);
  assert.equal(n.worker, 'studioos-s4594-abc123');
  assert.deepEqual(n.d1, { id: 'abc123-src', name: 'studioos-rehearsal-abc123-src' }, 'a #4591 rehearsal side, so migrate-d1 --rehearsal provisions it');
  assert.equal(n.queue('studioos-agent-queue-preview'), 'studioos-agent-queue-s4594-abc123');
  assert.equal(n.queue('studioos-agent-queue-preview-dlq'), 'studioos-agent-queue-s4594-abc123-dlq');
  assert.equal(n.workflow('studioos-agent-task-preview'), 'studioos-agent-task-s4594-abc123');
  assert.equal(n.bucket('studioos-files-preview'), 'studioos-files-s4594-abc123');
  assert.throws(() => n.queue('studioos-agent-queue'), /not a preview queue/, 'production\'s queue name is never renamed into the run');
  for (const bad of ['', 'ABC123', 'abc', 'a'.repeat(21), 'abc-12', "abc'1", undefined]) assert.throws(() => stageANames(bad), /run id/, String(bad));
  assert.deepEqual(fixtureIds(RUN), { sponsorEmail: 'syn-abc123-t0@synthetic.invalid', agentUid: 'syn-abc123-t0-a0', taskUid: 'syn-abc123-t0-a0-k0', skillUid: 'syn-abc123-skill' });
});

test('the config: flat, on workers.dev, no route, no cron, no browser, every identity the run\'s, the engine and the stub on', () => {
  const r = rendered();
  const flat = renderFlat(r);
  assert.equal(checkFlat(flat, TOML), true);
  const { root, sections } = parseToml(flat);
  assert.equal(root.get('name'), '"studioos-s4594-abc123"');
  assert.equal(root.get('workers_dev'), 'true');
  assert.ok(!sections.some((s) => /^(routes|services|tail_consumers|browser|vectorize|analytics_engine_datasets|assets)$/.test(s.name) || s.name.startsWith('env.')), 'nothing that routes, calls out or shares a store');
  assert.equal(sections.find((s) => s.name === 'triggers').kv.get('crons'), '[]');
  const vars = sections.find((s) => s.name === 'vars').kv;
  for (const [k, v] of Object.entries(STAGE_A_VARS)) assert.equal(vars.get(k), JSON.stringify(v), k);
  assert.ok(!sections.some((s) => s.name === 'durable_objects.bindings' && s.kv.has('script_name')), 'no other Worker\'s Durable Object');
  assert.ok(r.dropped.includes('durable_objects.bindings:MEETING_BOT_CONTAINER'));
  assert.ok(r.dropped.includes('browser') && r.dropped.includes('triggers'));
  const plan = toCreate(r);
  assert.equal(plan.d1, 'studioos-rehearsal-abc123-src');
  for (const name of [...plan.queues, ...plan.workflows, ...plan.buckets]) assert.match(name, /-s4594-abc123(-dlq)?$/, name);
  assert.ok(plan.queues.includes('studioos-agent-queue-s4594-abc123-dlq'), 'the agent DLQ is the run\'s own');
  assert.throws(() => stageASections(TOML, RUN, { ...IDS, d1: 'REPLACE_WITH_PREVIEW_D1_ID' }), /database id/);
  assert.throws(() => stageASections(TOML, RUN, { ...IDS, kv: { TOKENS: 'x' } }), /no namespace was created/);
});

test('the real #4566 preflight: isolated with a matching observation, and nothing less otherwise', () => {
  const r = rendered();
  const view = envView(TOML, r);
  assert.equal(preflight(view, { env: STAGE_A_ENV, observed: observation(r) }).verdict, 'isolated');
  // Mutation checked: the inference stub not observed, an outbound secret, a queue not seen, a missing permission list.
  assert.equal(preflight(view, { env: STAGE_A_ENV, observed: observation(r, { inference: 'live' }) }).verdict, 'unsafe');
  assert.equal(preflight(view, { env: STAGE_A_ENV, observed: observation(r, { secrets: ['JWT_SECRET', 'RESEND_API_KEY'] }) }).verdict, 'unsafe');
  assert.equal(preflight(view, { env: STAGE_A_ENV, observed: observation(r, { queues: [] }) }).verdict, 'unsafe');
  assert.equal(preflight(view, { env: STAGE_A_ENV, observed: observation(r, { account_permissions: undefined }) }).verdict, 'unverified');
  assert.equal(preflight(view, { env: STAGE_A_ENV, observed: null }).verdict, 'unverified');
});

test('checkFlat refuses every way the config could reach production', () => {
  const flat = renderFlat(rendered());
  const refuse = (text, re) => assert.throws(() => checkFlat(text, TOML), re);
  refuse(`${flat}\n[[routes]]\npattern = "axal.vc"\ncustom_domain = true\n`, /route/);
  refuse(flat.replace('APP_URL = "https://studioos-s4594-abc123.workers.dev"', 'APP_URL = "https://axal.vc"'), /axal\.vc host/);
  refuse(flat.replace('workers_dev = true', 'workers_dev = false'), /workers\.dev/);
  refuse(flat.replace('crons = []', 'crons = ["* * * * *"]'), /crons/);
  refuse(`${flat}\n[browser]\nbinding = "BROWSER"\n`, /shared or outbound/);
  refuse(`${flat}\n[[services]]\nbinding = "HQ"\nservice = "studioos"\n`, /shared or outbound/);
  refuse(`${flat}\n[env.production]\nname = "x"\n`, /\[env\.\*\]/);
  refuse(flat.replace('name = "studioos-s4594-abc123"', 'name = "studioos"'), /production's studioos/);
  // A production identity read from wrangler.toml itself, never a hard-coded list.
  const prodQueue = /\[\[env\.production\.queues\.producers\]\][\s\S]*?queue\s*=\s*"([^"]+)"/.exec(TOML)[1];
  refuse(flat.replace('"studioos-agent-queue-s4594-abc123"', JSON.stringify(prodQueue)), /names production's/);
  const prodDb = /\[\[env\.production\.d1_databases\]\][\s\S]*?database_id\s*=\s*"([^"]+)"/.exec(TOML)[1];
  refuse(flat.replace(IDS.d1, prodDb), /names production's/);
});

test('the extra seed: the sponsor\'s plan and the licence cap row only, synthetic and bound', () => {
  const s = extraSeed(RUN);
  assert.equal(s.length, 2);
  for (const x of s) assert.deepEqual(x.args, ['syn-abc123-t0@synthetic.invalid']);
  assert.throws(() => extraSeed("x'; DROP TABLE users; --"), /run id/);
});

test('reconcile: one proposal and one settled hold per key, settled equals charged, no pending hold, no live run', () => {
  const good = {
    holds: [{ idempotency_key: 'agent:r1:run', status: 'settled', actual: 120 }, { idempotency_key: 'k2', status: 'settled', actual: 80 }],
    usage: [{ id: 1, charged_microusd: 120 }, { id: 2, charged_microusd: 80 }],
    proposals: [{ uid: 'p1', run_key: 'agent:r1' }, { uid: 'p2', run_key: 'manual:1' }],
    runs: [{ uid: 'r1', status: 'done' }],
  };
  const ok = reconcile(good);
  assert.equal(ok.ok, true, ok.reason);
  assert.deepEqual([ok.counts.settled_microusd, ok.counts.charged_microusd, ok.counts.proposals], [200, 200, 2]);
  const bad = (over, re) => { const v = reconcile({ ...good, ...over }); assert.equal(v.ok, false); assert.match(v.reason, re); };
  bad({ holds: [...good.holds, { idempotency_key: 'k3', status: 'pending', actual: 0 }] }, /pending/);
  bad({ proposals: [...good.proposals, { uid: 'p3', run_key: 'agent:r1' }] }, /more than one proposal/);
  bad({ holds: [...good.holds, { idempotency_key: 'k2', status: 'settled', actual: 0 }] }, /settled more than once/);
  bad({ usage: [{ id: 1, charged_microusd: 999 }] }, /settled 200 is not charged 999/);
  bad({ runs: [{ uid: 'r1', status: 'running' }] }, /still live/);
  bad({ proposals: [] }, /no proposal/);
  assert.equal(reconcile({ ...good, usage: null }).ok, false, 'a failed read is a failure, never a pass');
});

test('the ceilings are the owner\'s decision 2 = A', () => {
  assert.deepEqual({ ...CEILINGS }, { wallClockMs: 3_600_000, d1RowsWritten: 1000, modelSpendMicrousd: 0, lifecyclesPerPath: 1 });
});

test('#4555 pass: the SDK variable is the redeploy\'s only change, and the flat config still passes checkFlat', () => {
  const plain = renderFlat(stageASections(TOML, RUN, IDS));
  const sdk = renderFlat(stageASections(TOML, RUN, IDS, { skillRuntime: true }));
  assert.equal(checkFlat(sdk, TOML), true);
  const a = plain.split('\n'); const b = sdk.split('\n');
  const added = b.filter((l) => !a.includes(l));
  assert.deepEqual(added, ['AGENT_SKILL_RUNTIME = "cloudflare_sdk"'], 'one line differs, and no identity');
  assert.deepEqual(a.filter((l) => !b.includes(l)), []);
  assert.deepEqual({ ...SKILL_RUNTIME_VARS }, { AGENT_SKILL_RUNTIME: 'cloudflare_sdk' });
  assert.doesNotMatch(plain, /AGENT_SKILL_RUNTIME/, 'off unless the pass asks for it');
});

test('#4555 pass: the seed lands on the committed schema with foreign keys on, and pins version 1 to the agent', () => {
  const ROOT = new URL('../../', import.meta.url).pathname;
  const db = buildFresh(readFileSync(new URL('../../cloudflare-worker/sql/schema_baseline.sql', import.meta.url), 'utf8'), postCutoffMigrations(ROOT).map((m) => m.sql));
  try {
    db.exec(toSqlFile([...seedStatements({ run: RUN, tenants: 1, agentsPerTenant: 1, tasksPerAgent: 2 }), ...extraSeed(RUN), ...skillSeed(RUN)]));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const link = db.prepare(`SELECT l.version, s.status, s.scope, s.uid, a.uid AS agent FROM agent_skill_links l
      JOIN agent_skills s ON s.id = l.skill_id JOIN team_agents a ON a.id = l.agent_id`).all();
    assert.deepEqual(link.map((r) => ({ ...r })), [{ version: 1, status: 'published', scope: 'hq', uid: 'syn-abc123-skill', agent: 'syn-abc123-t0-a0' }]);
    const v = db.prepare('SELECT version, roles_json FROM agent_skill_versions').get();
    assert.deepEqual([v.version, JSON.parse(v.roles_json)], [1, ['ceo']], 'the agent\'s own role (fixture agent 0 is the ceo)');
    for (const x of skillSeed(RUN)) for (const a of x.args) assert.match(String(a), /abc123|synthetic|Synthetic/, 'every value is synthetic');
  } finally { db.close(); }
  assert.throws(() => skillSeed("x'; --"), /run id/);
});

test('#4555 pass: a skill run\'s verdict needs one usage row on the pinned version and the runtime it asked for', () => {
  const one = [{ skill_version: 1 }];
  assert.deepEqual(skillRunVerdict({ event: {}, usage: one, want: 'legacy' }), { ok: true, reason: null, runtime: 'legacy', fallback: null });
  const sdk = skillRunVerdict({ event: { skill_runtime: { runtime: 'cloudflare_sdk', fallback: null } }, usage: one, want: 'cloudflare_sdk' });
  assert.equal(sdk.ok, true); assert.equal(sdk.runtime, 'cloudflare_sdk');
  const fell = skillRunVerdict({ event: { skill_runtime: { runtime: 'legacy', fallback: 'sdk_error' } }, usage: one, want: 'cloudflare_sdk' });
  assert.deepEqual([fell.ok, fell.fallback], [true, 'sdk_error'], 'a recorded fallback is a result, reported as such');
  const bad = (x, re) => { const v = skillRunVerdict(x); assert.equal(v.ok, false); assert.match(v.reason, re); };
  bad({ event: {}, usage: one, want: 'cloudflare_sdk' }, /names no runtime/);
  bad({ event: { skill_runtime: { runtime: 'cloudflare_sdk' } }, usage: one, want: 'legacy' }, /asked for legacy/);
  bad({ event: {}, usage: [{ skill_version: 2 }], want: 'legacy' }, /not the pinned 1/);
  bad({ event: {}, usage: [...one, ...one], want: 'legacy' }, /2 usage rows/);
  bad({ event: null, usage: one, want: 'legacy' }, /could not be read/);
});

/**
 * D4667-p2 (#4667): a run of one of the first ten skills is refused before the model when its required evidence
 * cannot be supplied, on the manual path (`agentRun`) and the scheduled path (`runStep`) alike, through the real
 * readers on the real migrated schema. Synthetic records only; the model is a stub and nothing is charged for real.
 *
 *   · ready: the run goes ahead, carries the evidence it judged as data, and its usage rows name the skill version;
 *   · a required input withheld by its source's rule (the sponsor is not on the venture's team), a source never
 *     connected (nothing recorded), a source that cannot be read, and a key the rule book does not read: each is
 *     422 `skill_not_ready`, naming the input, with no hold, no usage row and no model call;
 *   · conditional (stale evidence): the run goes ahead and its system prompt states the limit;
 *   · a retried step that already proposed answers that proposal before any check: one hold, one charge;
 *   · a skill outside the first ten is not checked.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/skill_run_evidence_4667.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { ADMIN, AGENT, PROJECT, SPONSOR, fakeAgentRun, loopDeps, world, type World } from './_agent_engine_fixture.ts';
import { AI_FIXTURE_PLANS } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { agentRun, type AgentRunInput } from '../src/services/agents/agentRun.ts';
import { load, context, runStep } from '../src/agents/loop.ts';
import { roleOf } from '../src/services/agents/catalogue.ts';
import { READERS } from '../src/services/agents/reads.ts';
import { preflight } from '../src/services/agents/skillInputs.ts';
import { skillEvidenceForRun } from '../src/services/agents/skillEvidence.ts';

after(removeMigratedDatabases);

const RUN_MODEL = '@cf/openai/gpt-oss-120b';
const GUARD = '@cf/meta/llama-guard-3-8b';
const SKILL_UID = 'e'.repeat(32);
const STEP = { module: 'use-of-funds', option: 'draft:raise/use-of-funds-runway', prompt: 'How long is our runway?' };
const P = { kind: 'project' as const, id: PROJECT };
// The readers' default windows follow the real clock, so the synthetic records are dated relative to it.
const NOW = Date.now(); // clock-ok: relative
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);
const CASH_CENTS = 7_654_321;

type Opts = { sponsor?: number; reads?: string[]; slug?: string; facts?: boolean; burnAgo?: number };

/** A project CFO agent with `cash-runway-snapshot` pinned, its rule book reading `reads`, and synthetic Mercury and burn records. */
function skillWorld(o: Opts = {}) {
  __resetForTest();
  const w = world();
  const sponsor = o.sponsor ?? SPONSOR;
  w.agent(AGENT, 'cfo', { sponsor });
  w.db.exec(AI_FIXTURE_PLANS);
  w.db.prepare("UPDATE users SET subscription_tier = 'growth', subscription_status = 'active' WHERE id = ?").run(sponsor);
  w.db.prepare("INSERT INTO ai_licence_caps(licence_key, daily_microusd, monthly_microusd, recorded_by) VALUES ('founder:growth', 0, 0, 1), ('admin', 0, 0, 1)").run();
  w.db.prepare('INSERT INTO ai_topup_accounts(user_id, balance_microusd) VALUES (?, 50000000)').run(sponsor);
  w.db.prepare('UPDATE team_agents SET model_id = ? WHERE id = ?').run(RUN_MODEL, AGENT);
  const rules = { ...roleOf('cfo')!.default_rules, reads: o.reads ?? ['project.summary', 'mercury.balances', 'grow.burn'] };
  w.db.prepare(`INSERT INTO team_rulebooks (uid, scope_kind, project_id, role_key, version, rules_json, created_by)
    VALUES ('book-4667', 'project', ?, 'cfo', 1, ?, ?)`).run(PROJECT, JSON.stringify(rules), SPONSOR);
  w.db.prepare(`INSERT INTO agent_skills (id, uid, scope, slug, name, purpose, steps_json, allowed_tools_json, output_kind, status, current_version, created_by)
    VALUES (1, ?, 'hq', ?, 'Cash runway snapshot', 'A runway note from recorded figures.', '["Read the balances"]', '[]', 'brief', 'published', 1, ?)`)
    .run(SKILL_UID, o.slug ?? 'cash-runway-snapshot', ADMIN);
  w.db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    VALUES (1, 1, 'md', 'Cash runway snapshot', 'A runway note from recorded figures.', '["Read the balances","Say runway is Not recorded unless burn is recorded"]', '[]', 'brief', '[]', '["cfo"]', ?)`).run(ADMIN);
  w.db.prepare('INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) VALUES (?, 1, 1, ?)').run(AGENT, sponsor);
  if (o.facts !== false) {
    w.db.prepare("INSERT INTO mercury_grow_facts(integration_id, project_id, module, kind, period, amount_cents, as_of) VALUES (1, ?, 'durable_company_building', 'cash', 'current', ?, ?)")
      .run(PROJECT, CASH_CENTS, day(1));
  }
  const burn = w.db.prepare('INSERT INTO project_metrics(project_id, snapshot_date, net_burn, source) VALUES (?, ?, ?, ?)');
  for (const m of [0, 30, 60]) burn.run(PROJECT, day((o.burnAgo ?? 2) + m), 41000 + m, 'typed');
  const prompts: string[] = [];
  const calls: string[] = [];
  w.env.AI = withGuard({ run: async (model: string, input: any) => {
    calls.push(model);
    if (model !== GUARD) prompts.push(JSON.stringify(input.messages ?? input));
    return { response: 'Runway is about eighteen months.', usage: { prompt_tokens: 40, completion_tokens: 10 } };
  } });
  return { w, prompts, calls };
}
const agentOf = (w: World) => w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(AGENT) as any;
const count = (w: World, sql: string) => (w.db.prepare(sql).get() as any).n as number;
const modelCalls = (calls: string[]) => calls.filter((m) => m !== GUARD).length;
const manual = (w: World, over: Partial<AgentRunInput> = {}) => agentRun(w.env, { agent: agentOf(w), ...STEP, skill: SKILL_UID, ...over });

/** Nothing was held, logged as usage or proposed, and no model was called. */
function nothingCharged(f: ReturnType<typeof skillWorld>) {
  assert.equal(modelCalls(f.calls), 0, 'no model call');
  assert.equal(count(f.w, 'SELECT COUNT(*) AS n FROM ai_usage_logs'), 0, 'no usage row');
  assert.equal(count(f.w, 'SELECT COUNT(*) AS n FROM ai_rail_proposals'), 0, 'no proposal');
}

// ── Manual path ─────────────────────────────────────────────────────────────

test('manual: a ready skill runs on the evidence it judged, as data, and its usage rows carry the skill and version', async () => {
  const f = skillWorld();
  try {
    const r = await manual(f.w);
    assert.equal(r.ok, true, JSON.stringify(r));
    const turn = f.prompts.join('\n');
    // Mutation checked: the evidence blocks not bound into the message → the record is not in the turn.
    assert.match(turn, /source=\\"read:mercury\.balances\\" trust=\\"data\\"/);
    assert.match(turn, /source=\\"read:grow\.burn\\" trust=\\"data\\"/);
    assert.ok(turn.includes(String(CASH_CENTS)), 'the balance the check read is the one the run carries');
    assert.doesNotMatch(turn, /evidence for this skill is incomplete/);
    const rows = f.w.db.prepare('SELECT skill_id, skill_version FROM ai_usage_logs').all() as any[];
    assert.ok(rows.length >= 1);
    for (const row of rows) assert.deepEqual([row.skill_id, row.skill_version], [1, 1]);
  } finally { f.w.close(); }
});

test('manual: a required input withheld by its source\'s rule is refused skill_not_ready before any hold or model call', async () => {
  // An admin sponsor manages the team, but is not on the venture's team, so Mercury's and burn's own rule withholds both.
  const f = skillWorld({ sponsor: ADMIN });
  try {
    const r: any = await manual(f.w);
    assert.deepEqual([r.ok, r.status, r.code], [false, 422, 'skill_not_ready'], JSON.stringify(r));
    assert.deepEqual(r.extra.inputs.map((i: any) => [i.read, i.status]), [['mercury.balances', 'withheld'], ['grow.burn', 'withheld']]);
    assert.ok(!JSON.stringify(r).includes(String(CASH_CENTS)), 'statuses only, never a figure');
    nothingCharged(f);
    const ev = f.w.db.prepare("SELECT detail_json FROM team_agent_events WHERE kind = 'refused'").get() as any;
    assert.equal(JSON.parse(ev.detail_json).code, 'skill_not_ready');
    // Only the task loop's engine run hands its check over; a manual run naming one is checked all the same.
    // Mutation checked: `readiness` taken on any run → this forged one skips the check and the run goes ahead.
    assert.equal((await manual(f.w, { readiness: { slug: 'cash-runway-snapshot', limits: [] } }) as any).code, 'skill_not_ready');
    nothingCharged(f);
  } finally { f.w.close(); }
});

test('manual: a source never connected, a source that cannot be read, and a key the rule book does not read are refused', async () => {
  const never = skillWorld({ facts: false });
  try {
    const r: any = await manual(never.w);
    assert.equal(r.code, 'skill_not_ready');
    assert.deepEqual(r.extra.inputs.map((i: any) => [i.read, i.status]), [['mercury.balances', 'empty']]);
    nothingCharged(never);
  } finally { never.w.close(); }
  const broken = skillWorld();
  try {
    broken.w.db.exec('DROP TABLE mercury_grow_facts');
    const r: any = await manual(broken.w);
    assert.equal(r.code, 'skill_not_ready');
    assert.deepEqual(r.extra.inputs.map((i: any) => [i.read, i.status]), [['mercury.balances', 'unreadable']]);
    nothingCharged(broken);
  } finally { broken.w.close(); }
  const ungranted = skillWorld({ reads: ['project.summary', 'mercury.balances'] });
  try {
    const r: any = await manual(ungranted.w);
    assert.equal(r.code, 'skill_not_ready');
    // Mutation checked: the rule book's reads not passed as `granted` → burn is read anyway and the run goes ahead.
    assert.deepEqual(r.extra.inputs.map((i: any) => [i.read, i.status]), [['grow.burn', 'not_granted']]);
    assert.match(r.message, /rule book does not read grow\.burn/);
    nothingCharged(ungranted);
  } finally { ungranted.w.close(); }
});

test('manual: a conditional skill runs and its system prompt states the limit', async () => {
  const f = skillWorld({ burnAgo: 60 });
  try {
    const r = await manual(f.w);
    assert.equal(r.ok, true, JSON.stringify(r));
    // Mutation checked: `limitsPrompt` not appended → the turn says nothing of the stale burn.
    assert.match(f.prompts.join('\n'), /The evidence for this skill is incomplete[^"]*monthly burn for the last three months: The newest record is more than 45 days old/);
  } finally { f.w.close(); }
});

test('manual: a retried step that already proposed answers its proposal before any check; one hold, one charge', async () => {
  const f = skillWorld();
  try {
    const runUid = 'run-4667-retry-1';
    const first = await manual(f.w, { runUid });
    assert.equal(first.ok, true, JSON.stringify(first));
    f.w.db.exec('DELETE FROM mercury_grow_facts');
    const again: any = await manual(f.w, { runUid });
    assert.deepEqual([again.ok, again.replayed, again.proposal?.uid], [true, true, (first as any).proposal.uid]);
    assert.equal(modelCalls(f.calls), 1);
    assert.equal(count(f.w, 'SELECT COUNT(*) AS n FROM ai_rail_proposals'), 1);
    assert.equal(count(f.w, 'SELECT COUNT(*) AS n FROM ai_usage_logs WHERE guard_for IS NULL'), 1);
    // A fresh run on the same, now empty, source is refused.
    assert.equal((await manual(f.w) as any).code, 'skill_not_ready');
  } finally { f.w.close(); }
});

test('manual: a skill outside the first ten is not checked', async () => {
  const f = skillWorld({ slug: 'synthetic-runway-note', facts: false });
  try {
    const r = await manual(f.w);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.doesNotMatch(f.prompts.join('\n'), /read:mercury\.balances/);
  } finally { f.w.close(); }
});

// ── Scheduled path ──────────────────────────────────────────────────────────

/** A session task (`session-1`) saved for the skill, admitted and driven to its run step with a fake agentRun. */
async function scheduled(f: ReturnType<typeof skillWorld>, readers = READERS) {
  const { w } = f;
  w.db.prepare(`INSERT INTO agent_duties (uid, agent_id, kind, title, cadence, hour_utc, minute_utc, zone, run_at, skill_id, skill_version, instruction, next_due_at, status, created_by)
    VALUES ('session-1', ?, 'session', 'Runway', 'once', 9, 0, 'UTC', '2027-03-16 09:00:00', 1, 1, 'Write the runway note.', '2027-03-16 09:00:00', 'active', ?)`).run(AGENT, SPONSOR);
  w.task(200, AGENT);
  w.db.prepare("UPDATE scope_tasks SET source_kind = 'duty', source_ref = 'session-1' WHERE id = 200").run();
  const a = await w.runtime.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
  assert.ok(a.ok, JSON.stringify(a));
  const inputs: AgentRunInput[] = [];
  const inner = fakeAgentRun(w);
  const d = loopDeps(w, async (env, input) => { inputs.push(input); return inner.fn(env, input); }, readers);
  assert.ok((await load(d, a.run.uid)).go);
  assert.ok((await context(d, a.run.uid)).go, 'the context step reads the rule book\'s keys');
  return { uid: a.run.uid, d, inputs, inner };
}

test('scheduled: a ready skill reaches agentRun with the loop\'s check, so agentRun binds nothing twice', async () => {
  const f = skillWorld();
  try {
    const s = await scheduled(f);
    assert.ok((await runStep(s.d, s.uid)).go);
    assert.equal(s.inputs.length, 1);
    assert.equal(s.inputs[0].skill, SKILL_UID);
    assert.deepEqual(s.inputs[0].readiness, { slug: 'cash-runway-snapshot', limits: [] });
    assert.equal(s.inner.state.charges, 1);
  } finally { f.w.close(); }
});

/** The real Mercury reader for its first `n` reads, then a synthetic outage. */
function flaky(n: number) {
  let reads = 0;
  return async (env: any, c: any) => {
    reads += 1;
    if (reads > n) throw new Error('synthetic outage');
    return READERS['mercury.balances']!(env, c);
  };
}

test('scheduled: withheld, never connected and unreadable sources end the run skill_not_ready before agentRun', async () => {
  for (const [label, o, readers] of [
    ['withheld', { sponsor: ADMIN }, READERS],
    ['never connected', { facts: false }, READERS],
    // The context step and the run step's context read it; then the source fails, at the check.
    ['unreadable', {}, { ...READERS, 'mercury.balances': flaky(2) }],
  ] as const) {
    const f = skillWorld(o as Opts);
    try {
      const s = await scheduled(f, readers as typeof READERS);
      // Mutation checked: the check skipped in `runStep` → the fake agentRun is called and charges once.
      assert.deepEqual(await runStep(s.d, s.uid), { go: false, status: 'refused', refusal: 'skill_not_ready' }, label);
      assert.equal(s.inputs.length, 0, `${label}: agentRun is never called`);
      assert.equal(s.inner.state.charges, 0, `${label}: nothing held or charged`);
      const run = f.w.db.prepare('SELECT status, refusal FROM agent_task_runs WHERE uid = ?').get(s.uid) as any;
      assert.deepEqual([run.status, run.refusal], ['refused', 'skill_not_ready'], label);
      assert.equal((f.w.db.prepare('SELECT status FROM scope_tasks WHERE id = 200').get() as any).status, 'open', `${label}: the task is open again`);
    } finally { f.w.close(); }
  }
});

test('scheduled: a conditional skill hands its limits to agentRun', async () => {
  const f = skillWorld({ burnAgo: 60 });
  try {
    const s = await scheduled(f);
    assert.ok((await runStep(s.d, s.uid)).go);
    assert.equal(s.inputs[0].readiness?.limits.length, 1);
    assert.match(s.inputs[0].readiness!.limits[0], /^monthly burn for the last three months: The newest record is more than 45 days old/);
  } finally { f.w.close(); }
});

test('scheduled: a retried step that already proposed is answered by its proposal, not checked again', async () => {
  const f = skillWorld();
  try {
    const s = await scheduled(f);
    assert.ok((await runStep(s.d, s.uid)).go);
    f.w.db.exec('DELETE FROM mercury_grow_facts');
    // Mutation checked: the replay guard dropped → the retry is refused skill_not_ready instead of answering.
    assert.ok((await runStep(s.d, s.uid)).go, 'the retry answers the first proposal');
    assert.equal(s.inner.state.charges, 1);
    assert.equal(count(f.w, 'SELECT COUNT(*) AS n FROM ai_rail_proposals WHERE task_id = 200'), 1);
  } finally { f.w.close(); }
});

// ── The check itself ────────────────────────────────────────────────────────

test('a granted key the run\'s context left out for length is not evidence; the route and the run read the same binding', async () => {
  const f = skillWorld();
  try {
    const a = agentOf(f.w);
    const scope = { kind: 'project', id: PROJECT, name: 'Kestrel', founder_id: 100, company_id: 1 } as any;
    const rules = { reads: ['project.summary', 'mercury.balances', 'grow.burn'] };
    const bound = await skillEvidenceForRun(f.w.env, { agent: a, scope, rules, slug: 'cash-runway-snapshot', projectId: PROJECT, bound: ['project.summary', 'mercury.balances'] });
    assert.equal(bound.ok, false);
    // Mutation checked: `bound` ignored → burn is read from the source and the check passes.
    assert.deepEqual((bound as any).extra.inputs, [{ field: 'monthly burn for the last three months', read: 'grow.burn', status: 'missing', reason: 'not_bound' }]);
    const ok = await skillEvidenceForRun(f.w.env, { agent: a, scope, rules, slug: 'cash-runway-snapshot', projectId: PROJECT });
    assert.ok(ok.ok && ok.evidence?.state === 'ready' && ok.evidence.blocks.length === 2);
    assert.deepEqual(await skillEvidenceForRun(f.w.env, { agent: a, scope, rules, slug: 'synthetic-runway-note', projectId: PROJECT }), { ok: true, evidence: null });
    // The preflight with no binding is unchanged: it reads every key, as before.
    const open = await preflight(f.w.env, 'cash-runway-snapshot', { scope, agent: a, projectId: PROJECT });
    assert.equal(open!.state, 'ready');
    const narrow = await preflight(f.w.env, 'cash-runway-snapshot', { scope, agent: a, projectId: PROJECT }, READERS, NOW, undefined, {}, { granted: ['mercury.balances'] });
    assert.equal(narrow!.state, 'not_ready');
    assert.equal(narrow!.inputs.find((i) => i.read === 'grow.burn')!.status, 'not_granted');
  } finally { f.w.close(); }
});

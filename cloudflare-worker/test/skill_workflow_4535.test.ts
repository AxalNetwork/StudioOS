/**
 * #4535 (slice 1): the workflow definition, its validator, the run plan and the assembly, all pure. The skill
 * and agent facts come in through the context, as the execution slice will read them through the existing
 * gates. Every uid, slug and output below is made up for the test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKFLOW_CEILINGS, POLICY_VERSION, STARTUP_ASSESSMENT_SKILLS, STARTUP_ASSESSMENT_NOTICE,
  assembleSections, attemptsOf, canonical, checkShape, fanOut, lateResult, planRun, readiness, resumeRefusal,
  startupAssessment, topoOrder, validateWorkflow,
  type AgentFact, type NodeOutcome, type RunPlan, type SkillFact, type StartupNode, type ValidationContext, type WorkflowDefinition,
} from '../src/services/agents/skillWorkflow.ts';

const hex = (c: string) => c.repeat(32);
const UIDS: Record<StartupNode, string> = { market_research: hex('1'), financial_analysis: hex('2'), product_assessment: hex('3'), legal_compliance_review: hex('4') };
const WF_UID = hex('a');
const OTHER_SKILL = hex('5');
const COMPANY = 41;

function skillFact(node: StartupNode, over: Partial<SkillFact> = {}): SkillFact {
  const s = STARTUP_ASSESSMENT_SKILLS[node];
  return {
    uid: UIDS[node], slug: s.slug, scope: 'hq', company_id: null, status: 'published', readable: true,
    versions: [
      { version: 1, published: true, suspended: false, roles: [s.role_key, 'ceo'], tools: [...s.tools], output_kind: 'brief', content_hash: `h-${node}-1` },
      { version: 2, published: true, suspended: false, roles: [s.role_key, 'ceo'], tools: [...s.tools], output_kind: 'brief', content_hash: `h-${node}-2` },
    ],
    ...over,
  };
}
function agentFact(node: StartupNode, over: Partial<AgentFact> = {}): AgentFact {
  const s = STARTUP_ASSESSMENT_SKILLS[node];
  return { uid: `agent-${node}`, role_key: s.role_key, company_id: COMPANY, status: 'active', grants: [...s.tools, 'compliance.read'], pins: { [UIDS[node]]: 1 }, model: 'configured-model', ...over };
}
function ctx(over: { skills?: Partial<Record<string, SkillFact>>; agents?: Partial<Record<string, AgentFact>>; ceilings?: ValidationContext['ceilings'] } = {}): ValidationContext {
  const nodes = Object.keys(UIDS) as StartupNode[];
  const skills: Record<string, SkillFact> = Object.fromEntries(nodes.map((n) => [UIDS[n], skillFact(n)]));
  const agents: Record<string, AgentFact> = Object.fromEntries(nodes.map((n) => [STARTUP_ASSESSMENT_SKILLS[n].role_key, agentFact(n)]));
  for (const [k, v] of Object.entries(over.skills ?? {})) { if (v) skills[k] = v; else delete skills[k]; }
  for (const [k, v] of Object.entries(over.agents ?? {})) { if (v) agents[k] = v; else delete agents[k]; }
  return { scope: { company_id: COMPANY, project_id: 7 }, skills, agents, ...(over.ceilings ? { ceilings: over.ceilings } : {}) };
}
const def = (versions?: Partial<Record<StartupNode, number>>): WorkflowDefinition => startupAssessment(UIDS, { uid: WF_UID, versions });
const published = (d: WorkflowDefinition = def()): WorkflowDefinition => ({ ...d, lifecycle: 'published' });
const edit = (fn: (d: any) => void, d: WorkflowDefinition = def()): WorkflowDefinition => { const c = structuredClone(d); fn(c); return c; };
const codes = (r: ReturnType<typeof validateWorkflow>) => (r.ok ? [] : r.refusals.map((x) => x.code));
const refusal = (r: ReturnType<typeof validateWorkflow>, code: string) => (r.ok ? undefined : r.refusals.find((x) => x.code === code));
const nodeIx = (d: WorkflowDefinition, k: StartupNode) => d.nodes.findIndex((n) => n.key === k);

async function plan(d: WorkflowDefinition = published(), c: ValidationContext = ctx(), key = 'request-0001'): Promise<RunPlan> {
  const r = await planRun(d, c, key);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.refusals));
  return r.plan;
}
const ok = (p: RunPlan, key: string, output: Record<string, unknown>, extra: Partial<NodeOutcome> = {}): NodeOutcome => {
  const n = p.nodes.find((x) => x.key === key)!;
  return { state: 'succeeded', attempt_key: n.attempts[0].key, skill_uid: n.skill.uid, skill_version: n.skill.version, output, evidence_refs: [`evidence:${key}`], output_ref: null, ...extra };
};
const OUT = (k: string) => ({ summary: `${k} summary`, findings: [`${k} finding`], strengths: [`${k} strength`], risks: [`${k} risk`], open_questions: [`${k} question`], missing_information: ['Not recorded: churn'], evidence_refs: [`evidence:${k}`] });

// ── A valid DAG and its order ───────────────────────────────────────────────

test('the Startup Assessment validates, in a deterministic order that puts product after market research', () => {
  const r = validateWorkflow(def(), ctx());
  assert.ok(r.ok, JSON.stringify(!r.ok && r.refusals));
  assert.deepEqual(r.order, ['market_research', 'financial_analysis', 'legal_compliance_review', 'product_assessment']);
  assert.deepEqual(r.levels, [['market_research', 'financial_analysis', 'legal_compliance_review'], ['product_assessment']]);
  assert.equal(r.resolved.legal_compliance_review.skill.version, 1);
  assert.equal(r.resolved.legal_compliance_review.agent_uid, 'agent-legal_compliance_review');
  assert.equal(fanOut(def().nodes), 3);
});

test('topological order breaks ties by the definition order and reports every node a loop holds', () => {
  const t = topoOrder([{ key: 'c', depends_on: ['a'] }, { key: 'b', depends_on: [] }, { key: 'a', depends_on: [] }, { key: 'd', depends_on: ['c', 'b'] }]);
  assert.deepEqual(t.order, ['b', 'a', 'c', 'd']);
  assert.deepEqual(t.cycle, []);
  const loop = topoOrder([{ key: 'a', depends_on: ['c'] }, { key: 'b', depends_on: [] }, { key: 'c', depends_on: ['a'] }, { key: 'd', depends_on: ['a'] }]);
  assert.deepEqual(loop.order, ['b']);
  assert.deepEqual(loop.cycle, ['a', 'c', 'd']);
});

// ── Missing skill or version, and a cycle ───────────────────────────────────

test('a missing skill, a missing version, an unpinned version and an unknown policy are refused', () => {
  assert.deepEqual(codes(validateWorkflow(def(), ctx({ skills: { [UIDS.market_research]: undefined } }))), ['skill_not_found']);
  assert.deepEqual(codes(validateWorkflow(def({ financial_analysis: 3 }), ctx())), ['version_not_published']);
  const unpinned = edit((d) => { delete d.nodes[0].version; });
  assert.deepEqual(codes(validateWorkflow(unpinned, ctx())), ['version_unpinned']);
  const badPolicy = edit((d) => { d.nodes[0].version = { pin: 'policy', policy: 'latest_published' }; });
  assert.equal(refusal(validateWorkflow(badPolicy, ctx()), 'version_unpinned')?.detail?.reason, 'unknown_policy');
  const unpublishedVersion = skillFact('market_research');
  unpublishedVersion.versions[1].published = false;
  assert.deepEqual(codes(validateWorkflow(def({ market_research: 2 }), ctx({ skills: { [UIDS.market_research]: unpublishedVersion } }))), ['version_not_published']);
});

test('the documented policy resolves to the agent\'s pin, and refuses when the agent has none', () => {
  const byPolicy = edit((d) => { d.nodes[0].version = { pin: 'policy', policy: 'agent_pin_at_plan' }; });
  const pinned2 = validateWorkflow(byPolicy, ctx({ agents: { research_analyst: agentFact('market_research', { pins: { [UIDS.market_research]: 2 } }) } }));
  assert.ok(pinned2.ok);
  assert.equal(pinned2.resolved.market_research.skill.version, 2);
  assert.equal(pinned2.resolved.market_research.skill.content_hash, 'h-market_research-2');
  assert.deepEqual(codes(validateWorkflow(byPolicy, ctx({ agents: { research_analyst: agentFact('market_research', { pins: {} }) } }))), ['version_unpinned']);
});

test('a circular dependency and a self-dependency are refused before anything is planned; so is an unknown dependency', () => {
  const loop = edit((d) => { d.nodes[nodeIx(d, 'market_research')].depends_on = ['product_assessment']; });
  const r = refusal(validateWorkflow(loop, ctx()), 'cycle');
  assert.deepEqual(r?.detail?.nodes, ['market_research', 'product_assessment']);
  const self = edit((d) => { d.nodes[1].depends_on = ['financial_analysis']; });
  assert.ok(codes(validateWorkflow(self, ctx())).includes('cycle'));
  const missing = edit((d) => { d.nodes[1].depends_on = ['valuation']; });
  assert.equal(refusal(validateWorkflow(missing, ctx()), 'node_missing')?.detail?.missing, 'valuation');
  const dup = edit((d) => { d.nodes[1].key = 'market_research'; });
  assert.ok(codes(validateWorkflow(dup, ctx())).includes('node_duplicate'));
});

// ── Lifecycle and scope of skills (via context) ─────────────────────────────

test('an unpublished, retired, suspended, unreadable or other company\'s skill is refused', () => {
  const k = UIDS.legal_compliance_review;
  assert.deepEqual(codes(validateWorkflow(def(), ctx({ skills: { [k]: skillFact('legal_compliance_review', { status: 'draft' }) } }))), ['skill_unpublished']);
  assert.deepEqual(codes(validateWorkflow(def(), ctx({ skills: { [k]: skillFact('legal_compliance_review', { status: 'retired' }) } }))), ['skill_retired']);
  const suspended = skillFact('legal_compliance_review'); suspended.versions[0].suspended = true;
  assert.deepEqual(codes(validateWorkflow(def(), ctx({ skills: { [k]: suspended } }))), ['skill_suspended']);
  assert.deepEqual(codes(validateWorkflow(def(), ctx({ skills: { [k]: skillFact('legal_compliance_review', { readable: false }) } }))), ['skill_not_found']);
  const otherCompany = validateWorkflow(def(), ctx({ skills: { [k]: skillFact('legal_compliance_review', { scope: 'company', company_id: COMPANY + 1 }) } }));
  assert.deepEqual(codes(otherCompany), ['skill_not_found'], 'another company\'s skill reads as one that does not exist');
  assert.ok(validateWorkflow(def(), ctx({ skills: { [k]: skillFact('legal_compliance_review', { scope: 'company', company_id: COMPANY }) } })).ok, 'the own company\'s skill is fine');
  const theirs = edit((d) => { d.owner = { scope: 'company', company_id: COMPANY + 1 }; });
  assert.deepEqual(codes(validateWorkflow(theirs, ctx())), ['workflow_out_of_scope']);
});

// ── Roles and grants (via context) ──────────────────────────────────────────

test('a role the version does not list, no agent for the role, and a revoked grant are refused', () => {
  const roleless = skillFact('financial_analysis'); roleless.versions[0].roles = ['ceo'];
  assert.equal(refusal(validateWorkflow(def(), ctx({ skills: { [UIDS.financial_analysis]: roleless } })), 'role_mismatch')?.node, 'financial_analysis');
  assert.deepEqual(codes(validateWorkflow(def(), ctx({ agents: { cfo: undefined } }))), ['agent_unavailable']);
  assert.deepEqual(codes(validateWorkflow(def(), ctx({ agents: { cfo: agentFact('financial_analysis', { status: 'paused' }) } }))), ['agent_unavailable']);
  assert.deepEqual(codes(validateWorkflow(def(), ctx({ agents: { cfo: agentFact('financial_analysis', { company_id: COMPANY + 1 }) } }))), ['agent_unavailable']);
  const revoked = validateWorkflow(def(), ctx({ agents: { cfo: agentFact('financial_analysis', { grants: ['grow.read'] }) } }));
  assert.deepEqual(codes(revoked), ['tool_not_granted']);
  assert.equal(refusal(revoked, 'tool_not_granted')?.detail?.tool, 'stripe.read');
});

test('a node may not name a tool its skill version does not list', () => {
  const wider = edit((d) => { d.nodes[0].tools.push('compliance.read'); });
  assert.equal(refusal(validateWorkflow(wider, ctx()), 'tool_outside_skill')?.detail?.tool, 'compliance.read');
});

// ── Handoffs ────────────────────────────────────────────────────────────────

test('input and output handoffs: undeclared outputs, unknown inputs, non-upstream nodes, types and unmapped inputs', () => {
  const p = (d: WorkflowDefinition) => d.nodes[nodeIx(d, 'product_assessment')];
  const undeclared = edit((d) => { p(d).mapping.market_findings = { from: 'node', node: 'market_research', field: 'tam' }; });
  assert.deepEqual(codes(validateWorkflow(undeclared, ctx())), ['output_undeclared']);
  const notUp = edit((d) => { p(d).mapping.market_findings = { from: 'node', node: 'financial_analysis', field: 'findings' }; });
  assert.deepEqual(codes(validateWorkflow(notUp, ctx())), ['mapping_not_upstream']);
  const unknownInput = edit((d) => { p(d).mapping.profile = { from: 'input', field: 'pitch_deck' }; });
  assert.deepEqual(codes(validateWorkflow(unknownInput, ctx())), ['input_unknown']);
  const typed = edit((d) => { p(d).mapping.market_findings = { from: 'node', node: 'market_research', field: 'summary' }; });
  assert.deepEqual(refusal(validateWorkflow(typed, ctx()), 'mapping_type_mismatch')?.detail, { from: 'text', to: 'text_list' });
  const optional = edit((d) => { p(d).mapping.market_findings = { from: 'node', node: 'market_research', field: 'risks' }; });
  assert.equal(refusal(validateWorkflow(optional, ctx()), 'mapping_type_mismatch')?.detail?.reason, 'optional_into_required');
  const unmapped = edit((d) => { delete p(d).mapping.market_findings; });
  assert.deepEqual(codes(validateWorkflow(unmapped, ctx())), ['input_unmapped']);
  const target = edit((d) => { p(d).mapping.secret = { from: 'input', field: 'profile' }; });
  assert.deepEqual(codes(validateWorkflow(target, ctx())), ['mapping_target_unknown']);
  const ghost = edit((d) => { p(d).mapping.market_findings = { from: 'node', node: 'valuation', field: 'findings' }; });
  assert.deepEqual(codes(validateWorkflow(ghost, ctx())), ['node_missing']);
  const section = edit((d) => { d.output.sections[1].sources = [{ node: 'market_research', field: 'tam' }]; });
  assert.deepEqual(codes(validateWorkflow(section, ctx())), ['output_undeclared']);
  const empty = edit((d) => { d.output.sections[1].sources = []; });
  assert.deepEqual(codes(validateWorkflow(empty, ctx())), ['section_unmapped']);
});

// ── Grants cannot widen at a branch or a fallback ───────────────────────────

test('a fallback cannot widen grants: another role, a tool the node lacks, or a skill that needs more', () => {
  const fallbackTo = (fb: object) => edit((d) => { d.budget.max_total_cost_cents = 2_000; d.budget.max_total_attempts = 10; d.budget.max_run_ms = 7_200_000; d.nodes[0].failure = { on_failure: 'fallback', then: 'continue_when_safe', fallback: fb }; });
  const other = { [OTHER_SKILL]: { ...skillFact('market_research'), uid: OTHER_SKILL } };
  const narrow = fallbackTo({ skill_uid: OTHER_SKILL, version: { pin: 'exact', version: 1 }, role_key: 'research_analyst', tools: ['research.read'] });
  const narrowSkill = { [OTHER_SKILL]: { ...skillFact('market_research'), uid: OTHER_SKILL, versions: [{ ...skillFact('market_research').versions[0], tools: ['research.read'] }] } };
  const good = validateWorkflow(narrow, ctx({ skills: narrowSkill }));
  assert.ok(good.ok, JSON.stringify(!good.ok && good.refusals));
  assert.equal(good.resolved.market_research.fallback?.skill.uid, OTHER_SKILL);
  const role = fallbackTo({ skill_uid: OTHER_SKILL, version: { pin: 'exact', version: 1 }, role_key: 'ceo', tools: ['research.read'] });
  assert.equal(refusal(validateWorkflow(role, ctx({ skills: other })), 'fallback_widens_grants')?.detail?.reason, 'other_role');
  const tool = fallbackTo({ skill_uid: OTHER_SKILL, version: { pin: 'exact', version: 1 }, role_key: 'research_analyst', tools: ['research.read', 'compliance.read'] });
  assert.equal(refusal(validateWorkflow(tool, ctx({ skills: other })), 'fallback_widens_grants')?.detail?.tool, 'compliance.read');
  const wideSkill = { [OTHER_SKILL]: { ...skillFact('market_research'), uid: OTHER_SKILL, versions: [{ ...skillFact('market_research').versions[0], tools: ['research.read', 'validate.read', 'compliance.read'] }] } };
  const needsMore = fallbackTo({ skill_uid: OTHER_SKILL, version: { pin: 'exact', version: 1 }, role_key: 'research_analyst', tools: ['research.read'] });
  assert.equal(refusal(validateWorkflow(needsMore, ctx({ skills: wideSkill })), 'fallback_widens_grants')?.detail?.reason, 'skill_tool');
  assert.deepEqual(codes(validateWorkflow(narrow, ctx())), ['skill_not_found'], 'a fallback skill is checked like any other');
});

test('a branch cannot inherit grants, and conditions are deferred in v1', () => {
  for (const k of ['inherit_grants', 'grants_from', 'run_as']) {
    const inherit = edit((d) => { d.nodes[nodeIx(d, 'product_assessment')][k] = k === 'inherit_grants' ? true : 'market_research'; });
    assert.deepEqual(codes(validateWorkflow(inherit, ctx())), ['grant_inheritance'], k);
  }
  for (const k of ['condition', 'when', 'if']) {
    const cond = edit((d) => { d.nodes[1][k] = { field: 'revenue', op: 'gt', value: 0 }; });
    assert.deepEqual(codes(validateWorkflow(cond, ctx())), ['condition_unsupported'], k);
  }
  assert.deepEqual(checkShape(edit((d) => { d.branches = []; })).map((x) => x.code), ['condition_unsupported']);
  assert.deepEqual(checkShape(edit((d) => { d.nodes[0].prompt = 'x'; })).map((x) => x.code), ['definition_invalid']);
});

// ── Approval checkpoints ────────────────────────────────────────────────────

test('a consequential node, a record-change skill and the final output each need an approval checkpoint', () => {
  const legal = edit((d) => { d.nodes[nodeIx(d, 'legal_compliance_review')].approval = 'none'; });
  assert.equal(refusal(validateWorkflow(legal, ctx()), 'approval_missing')?.node, 'legal_compliance_review');
  const change = skillFact('market_research'); change.versions[0].output_kind = 'record_change';
  assert.equal(refusal(validateWorkflow(def(), ctx({ skills: { [UIDS.market_research]: change } })), 'approval_missing')?.detail?.output_kind, 'record_change');
  const final = edit((d) => { d.output.approval = 'none'; });
  assert.equal(refusal(validateWorkflow(final, ctx()), 'approval_missing')?.path, '$.output.approval');
});

test('a required section cannot be built from a node that continues on failure', () => {
  const req = edit((d) => { d.output.sections[1].required = true; });
  assert.equal(refusal(validateWorkflow(req, ctx()), 'continue_unsafe')?.node, 'market_research');
  const stops = edit((d) => { d.output.sections[1].required = true; d.nodes[0].failure = { on_failure: 'stop' }; });
  assert.ok(validateWorkflow(stops, ctx()).ok);
});

// ── Budgets ─────────────────────────────────────────────────────────────────

test('budget ceilings: each run and node budget, the worst case against the total, fan-out and a missing budget', () => {
  const over = (fn: (d: any) => void) => refusal(validateWorkflow(edit(fn), ctx()), 'budget_over_ceiling')?.detail;
  assert.deepEqual(over((d) => { d.budget.max_total_cost_cents = WORKFLOW_CEILINGS.max_total_cost_cents + 1; }),
    { budget: 'max_total_cost_cents', value: WORKFLOW_CEILINGS.max_total_cost_cents + 1, ceiling: WORKFLOW_CEILINGS.max_total_cost_cents });
  assert.equal(over((d) => { d.nodes[0].budget.max_cost_cents = WORKFLOW_CEILINGS.node_max_cost_cents + 1; d.budget.max_total_cost_cents = 2000; })?.budget, 'node_max_cost_cents');
  assert.equal(over((d) => { d.nodes[0].max_retries = WORKFLOW_CEILINGS.max_retries + 1; d.budget.max_total_attempts = 40; })?.budget, 'max_retries');
  assert.equal(over((d) => { d.nodes[0].timeout_ms = WORKFLOW_CEILINGS.node_timeout_ms + 1; d.budget.max_run_ms = WORKFLOW_CEILINGS.max_run_ms; })?.budget, 'node_timeout_ms');
  assert.equal(over((d) => { d.budget.max_concurrency = WORKFLOW_CEILINGS.max_concurrency + 1; })?.budget, 'max_concurrency');
  assert.equal(over((d) => { d.budget.max_artifact_bytes = WORKFLOW_CEILINGS.max_artifact_bytes + 1; })?.budget, 'max_artifact_bytes');
  assert.equal(over((d) => { d.budget.approval_expiry_hours = WORKFLOW_CEILINGS.approval_expiry_hours + 1; })?.budget, 'approval_expiry_hours');
  assert.equal(over((d) => { d.nodes[0].budget.max_output_bytes = WORKFLOW_CEILINGS.node_max_output_bytes + 1; })?.budget, 'node_max_output_bytes');
  assert.equal(over((d) => { d.budget.max_input_bytes = WORKFLOW_CEILINGS.max_input_bytes + 1; })?.budget, 'max_input_bytes');
  // A company's lower ceiling applies; a higher one is ignored.
  assert.equal(refusal(validateWorkflow(def(), ctx({ ceilings: { max_total_cost_cents: 1_000 } })), 'budget_over_ceiling')?.detail?.ceiling, 1_000);
  assert.ok(validateWorkflow(def(), ctx({ ceilings: { max_total_cost_cents: 99_999 } })).ok);
  const above = edit((d) => { d.budget.max_total_cost_cents = WORKFLOW_CEILINGS.max_total_cost_cents + 1; });
  assert.equal(refusal(validateWorkflow(above, ctx({ ceilings: { max_total_cost_cents: 99_999 } })), 'budget_over_ceiling')?.detail?.ceiling, WORKFLOW_CEILINGS.max_total_cost_cents);
  // Retries and parallel nodes both count against the total: 4 nodes, 2 attempts each, at 150 cents is 1,200.
  assert.equal(attemptsOf(def().nodes[0]), 2);
  const tight = refusal(validateWorkflow(edit((d) => { d.budget.max_total_cost_cents = 1_199; }), ctx()), 'budget_over_total');
  assert.deepEqual(tight?.detail, { budget: 'cost_cents', worst_case: 1_200, total: 1_199 });
  assert.equal(refusal(validateWorkflow(edit((d) => { d.budget.max_total_attempts = 7; }), ctx()), 'budget_over_total')?.detail?.worst_case, 8);
  assert.equal(refusal(validateWorkflow(edit((d) => { d.budget.max_run_ms = 40 * 60_000 - 1; }), ctx()), 'budget_over_total')?.detail?.budget, 'run_ms');
  // A fallback doubles a node's attempts.
  const fb = edit((d) => { d.nodes[0].failure = { on_failure: 'fallback', then: 'stop', fallback: { skill_uid: UIDS.market_research, version: { pin: 'exact', version: 2 }, role_key: 'research_analyst', tools: ['research.read'] } }; });
  assert.equal(attemptsOf(fb.nodes[0]), 4);
  const fbr = validateWorkflow(fb, ctx());
  assert.ok(!fbr.ok);
  assert.deepEqual(fbr.refusals.filter((x) => x.code === 'budget_over_total').map((x) => [x.detail?.budget, x.detail?.worst_case]), [['attempts', 10], ['cost_cents', 1_500]]);
  assert.deepEqual(refusal(validateWorkflow(edit((d) => { d.budget.max_fan_out = 2; }), ctx()), 'fan_out_exceeded')?.detail, { fan_out: 3, budget: 2 });
  assert.deepEqual(codes(validateWorkflow(edit((d) => { delete d.budget.max_total_cost_cents; }), ctx())), ['budget_missing'], 'an unstated budget is never 0');
  assert.deepEqual(codes(validateWorkflow(edit((d) => { d.nodes[2].budget.max_cost_cents = 0; }), ctx())), ['budget_missing']);
});

// ── The plan and its keys ───────────────────────────────────────────────────

test('the plan is immutable and names the exact skill revisions, agents, contracts and policy', async () => {
  const p = await plan();
  assert.equal(p.policy_version, POLICY_VERSION);
  assert.deepEqual(p.order, ['market_research', 'financial_analysis', 'legal_compliance_review', 'product_assessment']);
  const legal = p.nodes.find((n) => n.key === 'legal_compliance_review')!;
  assert.deepEqual(legal.skill, { uid: UIDS.legal_compliance_review, version: 1, content_hash: 'h-legal_compliance_review-1', output_kind: 'brief' });
  assert.equal(legal.agent_uid, 'agent-legal_compliance_review');
  assert.equal(legal.requested_model, 'configured-model');
  assert.equal(legal.attempts.length, 2);
  assert.match(legal.attempts[0].run_uid, /^wf-[a-f0-9]{40}$/, 'an agentRun uid: letters, digits and dashes');
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.nodes[0]) && Object.isFrozen(p.nodes[0].contract.mapping));
  assert.throws(() => { (p.nodes[0].skill as any).version = 2; });
  assert.equal(p.workflow.definition_hash.length, 64);
  // Editing the definition after planning changes nothing in the plan.
  const d = published();
  const p2 = await plan(d);
  d.nodes[0].version = { pin: 'exact', version: 2 };
  assert.equal(p2.nodes.find((n) => n.key === 'market_research')!.skill.version, 1);
  d.nodes[0].budget.max_cost_cents = 1;
  d.output.sections[0].title = 'Edited';
  assert.equal(p2.nodes.find((n) => n.key === 'market_research')!.budget.max_cost_cents, 150, 'the plan holds its own copy');
  assert.equal(p2.output.sections[0].title, 'Overall findings');
});

test('a draft is not planned, nor a bad request key; a refused definition plans nothing', async () => {
  const draft = await planRun(def(), ctx(), 'request-0001');
  assert.ok(!draft.ok && draft.refusals[0].detail?.reason === 'not_published');
  const badKey = await planRun(published(), ctx(), 'x y');
  assert.ok(!badKey.ok && badKey.refusals[0].path === 'request_key');
  const refused = await planRun(published(), ctx({ agents: { cfo: undefined } }), 'request-0001');
  assert.ok(!refused.ok && refused.refusals[0].code === 'agent_unavailable');
});

test('idempotency keys are stable across re-planning the same version, and change for a new version or skill revision', async () => {
  const a = await plan(); const b = await plan();
  assert.equal(a.run_key, b.run_key);
  assert.deepEqual(a.nodes.map((n) => n.attempts), b.nodes.map((n) => n.attempts));
  assert.equal(canonical({ b: 1, a: [2, { d: 3, c: 4 }] }), canonical({ a: [2, { c: 4, d: 3 }], b: 1 }));
  const nextVersion = await plan({ ...published(), version: 2 });
  assert.notEqual(nextVersion.run_key, a.run_key);
  assert.notEqual(nextVersion.nodes[0].attempts[0].key, a.nodes[0].attempts[0].key);
  const repinned = await plan(published(def({ market_research: 2 })));
  assert.notEqual(repinned.run_key, a.run_key, 'a changed pin is a changed definition');
  const otherRequest = await plan(published(), ctx(), 'request-0002');
  assert.notEqual(otherRequest.run_key, a.run_key);
  const otherScope = await plan(published(), { ...ctx(), scope: { company_id: COMPANY, project_id: 8 } });
  assert.notEqual(otherScope.run_key, a.run_key);
  const keys = a.nodes.flatMap((n) => n.attempts.map((x) => x.run_uid));
  assert.equal(new Set(keys).size, keys.length, 'every attempt has its own run uid');
  // The same request on a revised skill version (same definition, the policy pin moved) is not resumable.
  const byPolicy = published(edit((d) => { d.nodes[0].version = { pin: 'policy', policy: 'agent_pin_at_plan' }; }));
  const v1 = await plan(byPolicy);
  const v2 = await plan(byPolicy, ctx({ agents: { research_analyst: agentFact('market_research', { pins: { [UIDS.market_research]: 2 } }) } }));
  assert.equal(v1.run_key, v2.run_key);
  assert.notEqual(v1.nodes[0].attempts[0].run_uid, v2.nodes[0].attempts[0].run_uid);
  assert.deepEqual(resumeRefusal(v1, v2), { code: 'plan_incompatible', changed: ['skill:market_research'] });
  assert.equal(resumeRefusal(a, b), null);
  assert.deepEqual(resumeRefusal(a, nextVersion)?.changed, ['definition', 'run_key']);
});

// ── Readiness, failure and cancellation ─────────────────────────────────────

test('a failed prerequisite makes its dependents unrunnable; independent nodes go on', async () => {
  const p = await plan();
  const r = readiness(p, { market_research: { state: 'failed', reason: 'skill_unavailable' } });
  const by = Object.fromEntries(r.nodes.map((n) => [n.key, n]));
  assert.deepEqual(by.product_assessment, { key: 'product_assessment', status: 'unrunnable', reason: 'prerequisite_failed' });
  assert.equal(by.financial_analysis.status, 'runnable');
  assert.equal(by.legal_compliance_review.status, 'runnable');
  assert.equal(r.run, 'active');
  const waiting = readiness(p, { market_research: { state: 'waiting_approval' } });
  assert.equal(waiting.nodes.find((n) => n.key === 'product_assessment')!.reason, 'dependencies');
  const skipped = readiness(p, { market_research: { state: 'skipped' } });
  assert.equal(skipped.nodes.find((n) => n.key === 'product_assessment')!.status, 'unrunnable');
  const go = readiness(p, { market_research: ok(p, 'market_research', OUT('m')) });
  assert.equal(go.nodes.find((n) => n.key === 'product_assessment')!.status, 'runnable');
});

test('a node that stops on failure leaves nothing runnable; cancellation stops pending nodes; concurrency is bounded', async () => {
  const stopping = await plan(published(edit((d) => { d.nodes[1].failure = { on_failure: 'stop' }; })));
  const r = readiness(stopping, { financial_analysis: { state: 'failed' }, market_research: ok(stopping, 'market_research', OUT('m')) });
  assert.equal(r.run, 'stopped');
  assert.deepEqual(r.nodes.filter((n) => n.status === 'unrunnable').map((n) => [n.key, n.reason]), [['legal_compliance_review', 'run_stopped'], ['product_assessment', 'run_stopped']]);
  const p = await plan();
  const c = readiness(p, { market_research: { state: 'running', attempt_key: p.nodes[0].attempts[0].key } }, { cancelled: true });
  assert.equal(c.run, 'cancelled');
  assert.ok(c.nodes.every((n) => n.status === 'unrunnable' && n.reason === 'run_cancelled'));
  const two = await plan(published(edit((d) => { d.budget.max_concurrency = 2; })));
  const q = readiness(two, {});
  assert.deepEqual(q.nodes.map((n) => n.status), ['runnable', 'runnable', 'waiting', 'waiting']);
  assert.equal(q.nodes[2].reason, 'concurrency');
  const done = readiness(p, Object.fromEntries(p.nodes.map((n) => [n.key, ok(p, n.key, OUT(n.key))])));
  assert.equal(done.run, 'finished');
});

test('a late result is never accepted after cancellation, or for an attempt the plan did not make or no longer runs', async () => {
  const p = await plan();
  const k = p.nodes[0].attempts[0].key;
  const running = { market_research: { state: 'running' as const, attempt_key: k } };
  assert.deepEqual(lateResult(p, running, k), { accept: true, node: 'market_research' });
  assert.deepEqual(lateResult(p, running, k, { cancelled: true }), { accept: false, reason: 'run_cancelled' });
  assert.deepEqual(lateResult(p, running, 'wfrun:forged:market_research:a1'), { accept: false, reason: 'unknown_attempt' });
  assert.deepEqual(lateResult(p, { market_research: { state: 'failed' } }, k), { accept: false, reason: 'node_not_running' });
  assert.deepEqual(lateResult(p, { market_research: { state: 'running', attempt_key: p.nodes[0].attempts[1].key } }, k), { accept: false, reason: 'stale_attempt' });
});

// ── Assembly ────────────────────────────────────────────────────────────────

test('a partial Startup Assessment marks the failed node\'s sections missing and never reads as complete', async () => {
  const p = await plan();
  const outcomes: Record<string, NodeOutcome> = {
    market_research: ok(p, 'market_research', OUT('market')),
    financial_analysis: { state: 'failed', reason: 'tool_not_approved' },
    product_assessment: ok(p, 'product_assessment', OUT('product')),
    legal_compliance_review: { state: 'skipped', reason: 'run_stopped' },
  };
  const a = assembleSections(p, outcomes);
  assert.equal(a.proposal, true);
  assert.equal(a.notice, STARTUP_ASSESSMENT_NOTICE);
  assert.match(a.notice, /not an investment decision/);
  assert.match(a.notice, /not legal advice/);
  assert.equal(a.approval, 'required');
  assert.equal(a.complete, false);
  assert.deepEqual(a.missing_nodes, ['financial_analysis', 'legal_compliance_review']);
  const s = Object.fromEntries(a.sections.map((x) => [x.key, x]));
  assert.equal(s.financials.status, 'missing');
  assert.equal(s.financials.sources[0].status, 'failed');
  assert.equal(s.legal_compliance.sources[0].status, 'skipped');
  assert.equal(s.market.status, 'complete');
  assert.equal(s.overall_findings.status, 'partial');
  assert.deepEqual(s.risks.sources.map((x) => x.status), ['included', 'failed', 'included', 'skipped']);
  assert.equal(s.financials.sources[0].skill_version, null, 'no version is claimed for a node that did not run');
  const notRun = assembleSections(p, {});
  assert.ok(notRun.sections.every((x) => x.status === 'missing' && x.sources.every((y) => y.status === 'not_run')));
  const cancelled = assembleSections(p, { ...outcomes, legal_compliance_review: { state: 'cancelled' } });
  assert.equal(cancelled.sections.find((x) => x.key === 'legal_compliance')!.sources[0].status, 'cancelled');
  const noField = assembleSections(p, { ...outcomes, market_research: ok(p, 'market_research', { ...OUT('market'), summary: null }) });
  assert.equal(noField.sections.find((x) => x.key === 'market')!.sources[0].status, 'output_missing');
  assert.ok(!noField.missing_nodes.includes('market_research'), 'the node ran; only its field is missing');
});

test('every included section resolves to the exact skill version and attempt the plan pinned, with its evidence', async () => {
  const p = await plan(published(def({ legal_compliance_review: 2 })));
  const all = Object.fromEntries(p.nodes.map((n) => [n.key, ok(p, n.key, OUT(n.key))]));
  const a = assembleSections(p, all);
  assert.equal(a.complete, true);
  assert.deepEqual(a.missing_nodes, []);
  const legal = a.sections.find((x) => x.key === 'legal_compliance')!.sources[0];
  assert.deepEqual([legal.skill_uid, legal.skill_version, legal.attempt_key, legal.evidence_refs, legal.value],
    [UIDS.legal_compliance_review, 2, p.nodes.find((n) => n.key === 'legal_compliance_review')!.attempts[0].key, ['evidence:legal_compliance_review'], 'legal_compliance_review summary']);
  // An outcome on another version, from an attempt the plan did not make, or of another skill is not used.
  const drift = assembleSections(p, { ...all, legal_compliance_review: { ...all.legal_compliance_review, skill_version: 1 } });
  assert.equal(drift.sections.find((x) => x.key === 'legal_compliance')!.sources[0].status, 'version_mismatch');
  assert.ok(drift.missing_nodes.includes('legal_compliance_review') && !drift.complete);
  assert.equal(drift.sections.find((x) => x.key === 'legal_compliance')!.sources[0].skill_version, null, 'an unverified outcome claims no version');
  const forged = assembleSections(p, { ...all, market_research: { ...all.market_research, attempt_key: 'wfrun:x:market_research:a1' } });
  assert.equal(forged.sections.find((x) => x.key === 'market')!.sources[0].status, 'version_mismatch');
  const swapped = assembleSections(p, { ...all, market_research: { ...all.market_research, skill_uid: OTHER_SKILL } });
  assert.equal(swapped.sections.find((x) => x.key === 'market')!.sources[0].status, 'version_mismatch');
  // A fallback's output is used on the fallback's own pinned version.
  const fbDef = published(edit((d) => { d.budget.max_total_cost_cents = 2_000; d.budget.max_total_attempts = 10; d.budget.max_run_ms = 7_200_000; d.nodes[0].failure = { on_failure: 'fallback', then: 'continue_when_safe', fallback: { skill_uid: UIDS.market_research, version: { pin: 'exact', version: 2 }, role_key: 'research_analyst', tools: ['research.read'] } }; }));
  const fp = await plan(fbDef);
  const m = fp.nodes.find((n) => n.key === 'market_research')!;
  const viaFallback = assembleSections(fp, { market_research: { state: 'succeeded', attempt_key: m.fallback!.attempts[0].key, skill_uid: UIDS.market_research, skill_version: 2, output: OUT('m') } });
  assert.deepEqual([viaFallback.sections[1].sources[0].status, viaFallback.sections[1].sources[0].skill_version], ['included', 2]);
});

test('the shape is closed: identity, owner, provenance and node fields are checked', () => {
  const shape = (fn: (d: any) => void) => checkShape(edit(fn)).map((x) => x.path);
  assert.deepEqual(checkShape(def()), []);
  assert.deepEqual(shape((d) => { d.uid = 'nope'; }), ['$.uid']);
  assert.deepEqual(shape((d) => { d.slug = 'Startup Assessment'; }), ['$.slug']);
  assert.deepEqual(shape((d) => { d.owner = { scope: 'hq', company_id: 3 }; }), ['$.owner']);
  assert.deepEqual(shape((d) => { d.provenance = { origin: 'copied', source_uid: null, note: null }; }), ['$.provenance']);
  assert.deepEqual(shape((d) => { d.lifecycle = 'live'; }), ['$.lifecycle']);
  assert.deepEqual(shape((d) => { d.nodes[0].skill_uid = 'market-entry-brief'; }), ['nodes[0].skill_uid']);
  assert.deepEqual(shape((d) => { d.nodes[0].tools = ['research']; }), ['nodes[0].tools']);
  assert.deepEqual(shape((d) => { d.input_schema.push({ name: 'profile', type: 'text', required: true }); }), ['$.input_schema[2].name']);
  assert.deepEqual(shape((d) => { d.nodes[0].outputs[0].type = 'blob'; }), ['nodes[0].outputs[0].type']);
  assert.deepEqual(shape((d) => { d.nodes = []; }), ['$.nodes']);
  assert.deepEqual(checkShape(null).map((x) => x.code), ['definition_invalid']);
});

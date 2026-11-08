/**
 * D4535 (#4535, slice 1) — a composable skill workflow as data: its definition, the validator that refuses an
 * unsafe one before anything runs, the immutable run plan, and the pure readiness and assembly rules the
 * execution slice will apply. NOTHING HERE RUNS A SKILL. No binding, no fetch, no D1 read, no write, no model.
 *
 * A DEFINITION (`WorkflowDefinition`, closed shape, untrusted until `validateWorkflow` passes it):
 *   identity     uid (32 hex), slug, name, purpose, owner (HQ or one company), provenance, version, lifecycle
 *   contracts    `input_schema` (the workflow's inputs) and `output.sections` (the final output, each section
 *                mapped to the node outputs it is built from: the provenance map)
 *   nodes        each names a skill uid and a version pin (`exact`, or the one documented policy
 *                `agent_pin_at_plan`: the executing agent's `agent_skill_links` pin, read once and frozen into
 *                the plan), the role that runs it, the tools it uses (never more than the skill's allow-list),
 *                explicit `depends_on`, its own declared inputs and outputs, an input mapping from workflow
 *                inputs or DECLARED outputs of nodes it depends on, a timeout, a retry budget, a failure policy
 *                (`stop`, `continue_when_safe`, or a `fallback` skill that cannot widen grants), an approval
 *                checkpoint and a cost and size budget
 *   budget       the run's total cost, active time, concurrency, fan-out, attempts, input and artifact sizes,
 *                and how long an approval may wait
 * Conditions are DEFERRED in v1: a `condition` (or `when`, `if`, `branches`) is refused `condition_unsupported`,
 * so no half-specified condition engine ships.
 *
 * THE FACTS a check needs (is the skill readable, published, retired, suspended, which roles and tools does its
 * version list, which agent runs a role and what it is granted) come in through `ValidationContext`, which the
 * caller reads from D1 through the existing gates (`attachCheck`, `skillForRun`, `skillRunRefusal`, `grantsOf`).
 * The execution slice re-checks every one at each node's start through `skillForRun`; see D4535 §5.
 *
 * Money is integer cents; a budget that is not stated is refused, never read as 0.
 */

// ── Ceilings ────────────────────────────────────────────────────────────────

/** The policy this module enforces; a plan records it, and a resume under another is refused (`resumeRefusal`). */
export const POLICY_VERSION = 'skill-workflow/1';
export const DEFINITION_SCHEMA = 1;

/**
 * The most any definition may ask for. A context may pass lower ceilings (a company's policy), never higher.
 * Approval expiry matches the run loop's 7-day `decision_expired` (agents/loop.ts).
 */
export const WORKFLOW_CEILINGS = Object.freeze({
  nodes: 12,
  depends_on: 8,
  max_total_cost_cents: 2_000,
  node_max_cost_cents: 500,
  node_timeout_ms: 10 * 60_000,
  max_run_ms: 2 * 3_600_000,
  max_retries: 2,
  max_total_attempts: 40,
  max_concurrency: 4,
  max_fan_out: 4,
  max_input_bytes: 64 * 1024,
  node_max_output_bytes: 32 * 1024,
  max_artifact_bytes: 5 * 1024 * 1024,
  approval_expiry_hours: 168,
});
export type Ceilings = { -readonly [K in keyof typeof WORKFLOW_CEILINGS]: number };

// ── The definition ──────────────────────────────────────────────────────────

export const FIELD_TYPES = ['text', 'number', 'boolean', 'text_list', 'record_ref', 'record_ref_list'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export type Field = { name: string; type: FieldType; required: boolean };

export type Source = { from: 'input'; field: string } | { from: 'node'; node: string; field: string };
export type VersionPin = { pin: 'exact'; version: number } | { pin: 'policy'; policy: 'agent_pin_at_plan' };
export const VERSION_POLICIES = ['agent_pin_at_plan'] as const;

export type Fallback = { skill_uid: string; version: VersionPin; role_key: string; tools: string[] };
export type FailurePolicy =
  | { on_failure: 'stop' }
  | { on_failure: 'continue_when_safe' }
  | { on_failure: 'fallback'; fallback: Fallback; then: 'stop' | 'continue_when_safe' };

export type NodeDef = {
  key: string; title: string;
  skill_uid: string; version: VersionPin; role_key: string; tools: string[];
  depends_on: string[];
  inputs: Field[]; mapping: Record<string, Source>; outputs: Field[];
  timeout_ms: number; max_retries: number; failure: FailurePolicy;
  approval: 'required' | 'none'; consequential: boolean;
  budget: { max_cost_cents: number; max_output_bytes: number };
};

export type Section = { key: string; title: string; required: boolean; sources: Array<{ node: string; field: string }> };
export type OwnerScope = { scope: 'hq'; company_id: null } | { scope: 'company'; company_id: number };
export type Provenance = { origin: 'hq_reference' | 'company_authored' | 'copied'; source_uid: string | null; note: string | null };
export type Lifecycle = 'draft' | 'published' | 'retired';

export type RunBudget = {
  max_total_cost_cents: number; max_run_ms: number; max_concurrency: number; max_fan_out: number;
  max_total_attempts: number; max_input_bytes: number; max_artifact_bytes: number; approval_expiry_hours: number;
};

export type WorkflowDefinition = {
  schema: 1; uid: string; slug: string; name: string; purpose: string;
  owner: OwnerScope; provenance: Provenance; version: number; lifecycle: Lifecycle;
  input_schema: Field[];
  output: { approval: 'required' | 'none'; notice: string; sections: Section[] };
  nodes: NodeDef[];
  budget: RunBudget;
};

// ── The context (facts read elsewhere, through the existing gates) ──────────

export type SkillVersionFact = {
  version: number; published: boolean; suspended: boolean;
  roles: string[]; tools: string[]; output_kind: 'draft' | 'record_change' | 'brief';
  /** The version's own content identity (e.g. #4532's draftHash), when the caller has one. */
  content_hash: string | null;
};
export type SkillFact = {
  uid: string; slug: string; scope: 'hq' | 'company'; company_id: number | null;
  status: 'draft' | 'published' | 'retired';
  /** The caller's read gate on the skill (`mayRead`). False reads exactly as a skill that does not exist. */
  readable: boolean;
  versions: SkillVersionFact[];
};
export type AgentFact = {
  uid: string; role_key: string; company_id: number | null; status: 'active' | 'paused' | 'removed';
  /** The sponsor's approved tools now (`grantsOf(tool_grants_json)`). */
  grants: string[];
  /** skill uid → the version pinned in `agent_skill_links`. */
  pins: Record<string, number>;
  /** The model the agent is configured with, when known; the plan records it as REQUESTED, the run the actual. */
  model: string | null;
};
export type ValidationContext = {
  /** The caller-authorized scope the run would be in. */
  scope: { company_id: number | null; project_id: number | null };
  skills: Record<string, SkillFact>;
  /** role key → the agent that runs nodes of that role in this scope. */
  agents: Record<string, AgentFact>;
  ceilings?: Partial<Ceilings>;
};

// ── Refusals ────────────────────────────────────────────────────────────────

export const REFUSAL_CODES = [
  'definition_invalid', 'condition_unsupported', 'grant_inheritance', 'workflow_out_of_scope',
  'node_duplicate', 'node_missing', 'cycle',
  'skill_not_found', 'skill_unpublished', 'skill_retired', 'version_unpinned', 'version_not_published', 'skill_suspended',
  'role_mismatch', 'agent_unavailable', 'tool_outside_skill', 'tool_not_granted',
  'mapping_target_unknown', 'input_unknown', 'mapping_not_upstream', 'output_undeclared', 'mapping_type_mismatch', 'input_unmapped',
  'section_unmapped', 'continue_unsafe', 'fallback_widens_grants', 'approval_missing',
  'budget_missing', 'budget_over_ceiling', 'budget_over_total', 'fan_out_exceeded',
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];
export type Refusal = { code: RefusalCode; path: string; node?: string; detail?: Record<string, unknown> };

export type Validated = { ok: true; definition: WorkflowDefinition; order: string[]; levels: string[][]; resolved: Record<string, Resolved> }
  | { ok: false; refusals: Refusal[] };
/** What a node resolves to in this context: the exact version and the agent that would run it. */
export type Resolved = {
  skill: { uid: string; version: number; content_hash: string | null; output_kind: string };
  agent_uid: string; requested_model: string | null;
  fallback: { skill: { uid: string; version: number; content_hash: string | null }; agent_uid: string } | null;
};

// ── Shape ───────────────────────────────────────────────────────────────────

const UID_RE = /^[a-f0-9]{32}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const TOOL_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const DEFERRED = ['condition', 'when', 'if', 'branches', 'conditions'];
const INHERIT = ['inherit_grants', 'grants', 'grants_from', 'run_as', 'tool_grants'];

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown, max: number) => typeof v === 'string' && v.trim().length >= 1 && v.length <= max;
const isInt = (v: unknown, min = 0) => Number.isSafeInteger(v) && (v as number) >= min;

function closed(v: Record<string, any>, keys: readonly string[], path: string, out: Refusal[], node?: string): void {
  for (const k of Object.keys(v)) {
    if (keys.includes(k)) continue;
    if (DEFERRED.includes(k)) out.push({ code: 'condition_unsupported', path: `${path}.${k}`, ...(node ? { node } : {}) });
    else if (INHERIT.includes(k)) out.push({ code: 'grant_inheritance', path: `${path}.${k}`, ...(node ? { node } : {}) });
    else out.push({ code: 'definition_invalid', path: `${path}.${k}`, ...(node ? { node } : {}), detail: { reason: 'unknown_key' } });
  }
}

function fields(v: unknown, path: string, out: Refusal[]): void {
  if (!Array.isArray(v)) { out.push({ code: 'definition_invalid', path, detail: { reason: 'not_a_list' } }); return; }
  const seen = new Set<string>();
  v.forEach((f, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(f)) { out.push({ code: 'definition_invalid', path: p }); return; }
    closed(f, ['name', 'type', 'required'], p, out);
    if (typeof f.name !== 'string' || !KEY_RE.test(f.name) || seen.has(f.name)) out.push({ code: 'definition_invalid', path: `${p}.name` });
    else seen.add(f.name);
    if (!FIELD_TYPES.includes(f.type)) out.push({ code: 'definition_invalid', path: `${p}.type` });
    if (typeof f.required !== 'boolean') out.push({ code: 'definition_invalid', path: `${p}.required` });
  });
}

function pin(v: unknown, path: string, out: Refusal[], node: string): void {
  if (v == null) { out.push({ code: 'version_unpinned', path, node }); return; }
  if (!isObj(v)) { out.push({ code: 'definition_invalid', path, node }); return; }
  if (v.pin === 'exact') { closed(v, ['pin', 'version'], path, out, node); if (!isInt(v.version, 1)) out.push({ code: 'version_unpinned', path: `${path}.version`, node }); return; }
  if (v.pin === 'policy') {
    closed(v, ['pin', 'policy'], path, out, node);
    if (!(VERSION_POLICIES as readonly string[]).includes(v.policy)) out.push({ code: 'version_unpinned', path: `${path}.policy`, node, detail: { reason: 'unknown_policy' } });
    return;
  }
  out.push({ code: 'version_unpinned', path, node });
}

function tools(v: unknown, path: string, out: Refusal[], node: string): void {
  if (!Array.isArray(v) || v.some((t) => typeof t !== 'string' || !TOOL_RE.test(t)) || new Set(v).size !== v.length) {
    out.push({ code: 'definition_invalid', path, node });
  }
}

const NODE_KEYS = ['key', 'title', 'skill_uid', 'version', 'role_key', 'tools', 'depends_on', 'inputs', 'mapping', 'outputs',
  'timeout_ms', 'max_retries', 'failure', 'approval', 'consequential', 'budget'] as const;
const BUDGET_KEYS = ['max_total_cost_cents', 'max_run_ms', 'max_concurrency', 'max_fan_out', 'max_total_attempts',
  'max_input_bytes', 'max_artifact_bytes', 'approval_expiry_hours'] as const;

function shapeNode(n: unknown, i: number, out: Refusal[]): void {
  const p = `nodes[${i}]`;
  if (!isObj(n)) { out.push({ code: 'definition_invalid', path: p }); return; }
  const key = typeof n.key === 'string' && KEY_RE.test(n.key) ? n.key : undefined;
  if (!key) out.push({ code: 'definition_invalid', path: `${p}.key` });
  closed(n, NODE_KEYS, p, out, key);
  if (!isText(n.title, 120)) out.push({ code: 'definition_invalid', path: `${p}.title`, node: key });
  if (typeof n.skill_uid !== 'string' || !UID_RE.test(n.skill_uid)) out.push({ code: 'definition_invalid', path: `${p}.skill_uid`, node: key });
  pin(n.version, `${p}.version`, out, key ?? `#${i}`);
  if (typeof n.role_key !== 'string' || !isText(n.role_key, 100)) out.push({ code: 'definition_invalid', path: `${p}.role_key`, node: key });
  tools(n.tools, `${p}.tools`, out, key ?? `#${i}`);
  if (!Array.isArray(n.depends_on) || n.depends_on.some((d: unknown) => typeof d !== 'string')) out.push({ code: 'definition_invalid', path: `${p}.depends_on`, node: key });
  fields(n.inputs, `${p}.inputs`, out);
  fields(n.outputs, `${p}.outputs`, out);
  if (!isObj(n.mapping)) out.push({ code: 'definition_invalid', path: `${p}.mapping`, node: key });
  else for (const [k, s] of Object.entries(n.mapping)) {
    const okSource = isObj(s) && ((s.from === 'input' && typeof s.field === 'string' && Object.keys(s).length === 2)
      || (s.from === 'node' && typeof s.node === 'string' && typeof s.field === 'string' && Object.keys(s).length === 3));
    if (!okSource) out.push({ code: 'definition_invalid', path: `${p}.mapping.${k}`, node: key });
  }
  for (const b of ['timeout_ms', 'max_retries'] as const) if (!isInt(n[b], b === 'timeout_ms' ? 1 : 0)) out.push({ code: 'budget_missing', path: `${p}.${b}`, node: key });
  if (!isObj(n.budget)) out.push({ code: 'budget_missing', path: `${p}.budget`, node: key });
  else {
    closed(n.budget, ['max_cost_cents', 'max_output_bytes'], `${p}.budget`, out, key);
    for (const b of ['max_cost_cents', 'max_output_bytes']) if (!isInt(n.budget[b], 1)) out.push({ code: 'budget_missing', path: `${p}.budget.${b}`, node: key });
  }
  if (n.approval !== 'required' && n.approval !== 'none') out.push({ code: 'definition_invalid', path: `${p}.approval`, node: key });
  if (typeof n.consequential !== 'boolean') out.push({ code: 'definition_invalid', path: `${p}.consequential`, node: key });
  const f = n.failure;
  if (!isObj(f) || !['stop', 'continue_when_safe', 'fallback'].includes(f.on_failure)) { out.push({ code: 'definition_invalid', path: `${p}.failure`, node: key }); return; }
  if (f.on_failure !== 'fallback') { closed(f, ['on_failure'], `${p}.failure`, out, key); return; }
  closed(f, ['on_failure', 'fallback', 'then'], `${p}.failure`, out, key);
  if (f.then !== 'stop' && f.then !== 'continue_when_safe') out.push({ code: 'definition_invalid', path: `${p}.failure.then`, node: key });
  const fb = f.fallback;
  if (!isObj(fb)) { out.push({ code: 'definition_invalid', path: `${p}.failure.fallback`, node: key }); return; }
  closed(fb, ['skill_uid', 'version', 'role_key', 'tools'], `${p}.failure.fallback`, out, key);
  if (typeof fb.skill_uid !== 'string' || !UID_RE.test(fb.skill_uid)) out.push({ code: 'definition_invalid', path: `${p}.failure.fallback.skill_uid`, node: key });
  pin(fb.version, `${p}.failure.fallback.version`, out, key ?? `#${i}`);
  if (typeof fb.role_key !== 'string' || !isText(fb.role_key, 100)) out.push({ code: 'definition_invalid', path: `${p}.failure.fallback.role_key`, node: key });
  tools(fb.tools, `${p}.failure.fallback.tools`, out, key ?? `#${i}`);
}

/** The closed shape. Every refusal names its path; a definition that fails here gets no semantic check. */
export function checkShape(def: unknown): Refusal[] {
  const out: Refusal[] = [];
  if (!isObj(def)) return [{ code: 'definition_invalid', path: '$' }];
  closed(def, ['schema', 'uid', 'slug', 'name', 'purpose', 'owner', 'provenance', 'version', 'lifecycle', 'input_schema', 'output', 'nodes', 'budget'], '$', out);
  if (def.schema !== DEFINITION_SCHEMA) out.push({ code: 'definition_invalid', path: '$.schema' });
  if (typeof def.uid !== 'string' || !UID_RE.test(def.uid)) out.push({ code: 'definition_invalid', path: '$.uid' });
  if (typeof def.slug !== 'string' || def.slug.length > 64 || !SLUG_RE.test(def.slug)) out.push({ code: 'definition_invalid', path: '$.slug' });
  if (!isText(def.name, 80)) out.push({ code: 'definition_invalid', path: '$.name' });
  if (!isText(def.purpose, 300)) out.push({ code: 'definition_invalid', path: '$.purpose' });
  const o = def.owner;
  if (!isObj(o) || !((o.scope === 'hq' && o.company_id === null) || (o.scope === 'company' && isInt(o.company_id, 1)))) out.push({ code: 'definition_invalid', path: '$.owner' });
  const pv = def.provenance;
  if (!isObj(pv) || !['hq_reference', 'company_authored', 'copied'].includes(pv.origin)
    || !(pv.source_uid === null || (typeof pv.source_uid === 'string' && UID_RE.test(pv.source_uid)))
    || !(pv.note === null || isText(pv.note, 300)) || (pv.origin === 'copied') !== (pv.source_uid !== null)) out.push({ code: 'definition_invalid', path: '$.provenance' });
  if (!isInt(def.version, 1)) out.push({ code: 'definition_invalid', path: '$.version' });
  if (!['draft', 'published', 'retired'].includes(def.lifecycle)) out.push({ code: 'definition_invalid', path: '$.lifecycle' });
  fields(def.input_schema, '$.input_schema', out);
  const op = def.output;
  if (!isObj(op)) out.push({ code: 'definition_invalid', path: '$.output' });
  else {
    closed(op, ['approval', 'notice', 'sections'], '$.output', out);
    if (op.approval !== 'required' && op.approval !== 'none') out.push({ code: 'definition_invalid', path: '$.output.approval' });
    if (!isText(op.notice, 300)) out.push({ code: 'definition_invalid', path: '$.output.notice' });
    if (!Array.isArray(op.sections) || !op.sections.length) out.push({ code: 'definition_invalid', path: '$.output.sections' });
    else op.sections.forEach((s: any, i: number) => {
      const p = `$.output.sections[${i}]`;
      if (!isObj(s)) { out.push({ code: 'definition_invalid', path: p }); return; }
      closed(s, ['key', 'title', 'required', 'sources'], p, out);
      if (typeof s.key !== 'string' || !KEY_RE.test(s.key)) out.push({ code: 'definition_invalid', path: `${p}.key` });
      if (!isText(s.title, 120)) out.push({ code: 'definition_invalid', path: `${p}.title` });
      if (typeof s.required !== 'boolean') out.push({ code: 'definition_invalid', path: `${p}.required` });
      if (!Array.isArray(s.sources) || s.sources.some((x: any) => !isObj(x) || typeof x.node !== 'string' || typeof x.field !== 'string')) out.push({ code: 'definition_invalid', path: `${p}.sources` });
    });
  }
  if (!Array.isArray(def.nodes) || !def.nodes.length) out.push({ code: 'definition_invalid', path: '$.nodes' });
  else def.nodes.forEach((n: unknown, i: number) => shapeNode(n, i, out));
  if (!isObj(def.budget)) out.push({ code: 'budget_missing', path: '$.budget' });
  else {
    closed(def.budget, BUDGET_KEYS, '$.budget', out);
    for (const b of BUDGET_KEYS) if (!isInt(def.budget[b], 1)) out.push({ code: 'budget_missing', path: `$.budget.${b}` });
  }
  return out;
}

// ── The graph ───────────────────────────────────────────────────────────────

/**
 * Kahn's order, ties broken by the definition's own node order, so the same definition always gives the same
 * order. `cycle` is the nodes left over (every node on or behind a loop), in definition order.
 */
export function topoOrder(nodes: ReadonlyArray<Pick<NodeDef, 'key' | 'depends_on'>>): { order: string[]; levels: string[][]; cycle: string[] } {
  const index = new Map(nodes.map((n, i) => [n.key, i]));
  const indegree = new Map(nodes.map((n) => [n.key, new Set(n.depends_on.filter((d) => index.has(d))).size]));
  const done = new Set<string>();
  const order: string[] = []; const levels: string[][] = [];
  for (;;) {
    const level = nodes.filter((n) => !done.has(n.key) && indegree.get(n.key) === 0).map((n) => n.key);
    if (!level.length) break;
    levels.push(level);
    for (const k of level) { done.add(k); order.push(k); }
    for (const n of nodes) if (!done.has(n.key)) indegree.set(n.key, new Set(n.depends_on.filter((d) => index.has(d) && !done.has(d))).size);
  }
  return { order, levels, cycle: nodes.filter((n) => !done.has(n.key)).map((n) => n.key) };
}

/** Every node `key` depends on, directly or not. */
export function upstreamOf(nodes: ReadonlyArray<Pick<NodeDef, 'key' | 'depends_on'>>, key: string): Set<string> {
  const by = new Map(nodes.map((n) => [n.key, n]));
  const seen = new Set<string>(); const stack = [...(by.get(key)?.depends_on ?? [])];
  while (stack.length) {
    const k = stack.pop()!;
    if (seen.has(k) || !by.has(k)) continue;
    seen.add(k); stack.push(...by.get(k)!.depends_on);
  }
  return seen;
}

// ── The validator ───────────────────────────────────────────────────────────

function ceilingsOf(ctx: ValidationContext): Ceilings {
  const c: Ceilings = { ...WORKFLOW_CEILINGS };
  for (const [k, v] of Object.entries(ctx.ceilings ?? {})) {
    if (k in c && Number.isSafeInteger(v) && (v as number) >= 0) (c as any)[k] = Math.min((c as any)[k], v as number);
  }
  return c;
}

type SkillCheck = { ok: true; version: SkillVersionFact; agent: AgentFact } | { ok: false; refusal: Refusal };

/**
 * One skill reference, in `attachCheck`'s order: found and readable in this scope; published; not retired; a
 * version pinned and published; not suspended; its roles include the node's; an agent runs that role here; the
 * node's tools within the version's allow-list; the version's tools all granted to that agent now.
 */
function checkSkill(ctx: ValidationContext, ref: { skill_uid: string; version: VersionPin; role_key: string; tools: string[] }, path: string, node: string): SkillCheck {
  const no = (code: RefusalCode, detail?: Record<string, unknown>): SkillCheck => ({ ok: false, refusal: { code, path, node, ...(detail ? { detail } : {}) } });
  const s = ctx.skills[ref.skill_uid];
  // Another company's skill, a skill the caller cannot read and one that does not exist answer the same.
  if (!s || s.uid !== ref.skill_uid || !s.readable || (s.scope === 'company' && s.company_id !== ctx.scope.company_id)) return no('skill_not_found');
  if (s.status === 'draft') return no('skill_unpublished');
  if (s.status === 'retired') return no('skill_retired');
  const agent = ctx.agents[ref.role_key];
  let version: number | null = null;
  if (ref.version.pin === 'exact') version = ref.version.version;
  else if (agent && Number.isSafeInteger(agent.pins[s.uid])) version = agent.pins[s.uid];
  if (version == null) return no('version_unpinned', { policy: (ref.version as any).policy ?? null });
  const v = s.versions.find((x) => x.version === version);
  if (!v || !v.published) return no('version_not_published', { version });
  if (v.suspended) return no('skill_suspended', { version });
  if (!v.roles.includes(ref.role_key)) return no('role_mismatch', { role_key: ref.role_key });
  if (!agent || agent.status !== 'active' || agent.role_key !== ref.role_key || agent.company_id !== ctx.scope.company_id) return no('agent_unavailable', { role_key: ref.role_key });
  const outside = ref.tools.find((t) => !v.tools.includes(t));
  if (outside) return no('tool_outside_skill', { tool: outside });
  const ungranted = v.tools.find((t) => !agent.grants.includes(t));
  if (ungranted) return no('tool_not_granted', { tool: ungranted });
  return { ok: true, version: v, agent };
}

const fieldOf = (fs: readonly Field[], name: string) => fs.find((f) => f.name === name);

/**
 * The whole check, before anything is created or run. Returns every refusal found (a shape failure stops
 * there), or the definition with its deterministic order and the exact versions it resolves to in `ctx`.
 */
export function validateWorkflow(input: unknown, ctx: ValidationContext): Validated {
  const shape = checkShape(input);
  if (shape.length) return { ok: false, refusals: shape };
  const def = input as WorkflowDefinition;
  const out: Refusal[] = [];
  const cap = ceilingsOf(ctx);

  if (def.owner.scope === 'company' && def.owner.company_id !== ctx.scope.company_id) out.push({ code: 'workflow_out_of_scope', path: '$.owner' });

  // Nodes and edges.
  const keys = new Set<string>();
  def.nodes.forEach((n, i) => { if (keys.has(n.key)) out.push({ code: 'node_duplicate', path: `nodes[${i}].key`, node: n.key }); keys.add(n.key); });
  if (def.nodes.length > cap.nodes) out.push({ code: 'budget_over_ceiling', path: '$.nodes', detail: { budget: 'nodes', value: def.nodes.length, ceiling: cap.nodes } });
  def.nodes.forEach((n, i) => {
    if (n.depends_on.length > cap.depends_on) out.push({ code: 'budget_over_ceiling', path: `nodes[${i}].depends_on`, node: n.key, detail: { budget: 'depends_on', value: n.depends_on.length, ceiling: cap.depends_on } });
    for (const d of n.depends_on) if (!keys.has(d)) out.push({ code: 'node_missing', path: `nodes[${i}].depends_on`, node: n.key, detail: { missing: d } });
  });
  const { order, levels, cycle } = topoOrder(def.nodes);
  if (cycle.length) out.push({ code: 'cycle', path: '$.nodes', detail: { nodes: cycle } });

  // Skills, versions, roles, agents and grants; fallbacks.
  const resolved: Record<string, Resolved> = {};
  def.nodes.forEach((n, i) => {
    const p = `nodes[${i}]`;
    const primary = checkSkill(ctx, n, p, n.key);
    if (!primary.ok) { out.push(primary.refusal); return; }
    let fallback: Resolved['fallback'] = null;
    if (n.failure.on_failure === 'fallback') {
      const fb = n.failure.fallback;
      const widened = fb.role_key !== n.role_key ? { reason: 'other_role', role_key: fb.role_key } : (fb.tools.find((t) => !n.tools.includes(t)) ? { reason: 'tool', tool: fb.tools.find((t) => !n.tools.includes(t)) } : null);
      const f = checkSkill(ctx, fb, `${p}.failure.fallback`, n.key);
      if (widened) out.push({ code: 'fallback_widens_grants', path: `${p}.failure.fallback`, node: n.key, detail: widened });
      else if (!f.ok) out.push(f.refusal);
      else {
        // The fallback's version may not need a tool the primary's version does not (its runtime grant check covers all its tools).
        const extra = f.version.tools.find((t) => !primary.version.tools.includes(t));
        if (extra) out.push({ code: 'fallback_widens_grants', path: `${p}.failure.fallback`, node: n.key, detail: { reason: 'skill_tool', tool: extra } });
        else fallback = { skill: { uid: fb.skill_uid, version: f.version.version, content_hash: f.version.content_hash }, agent_uid: f.agent.uid };
      }
    }
    resolved[n.key] = {
      skill: { uid: n.skill_uid, version: primary.version.version, content_hash: primary.version.content_hash, output_kind: primary.version.output_kind },
      agent_uid: primary.agent.uid, requested_model: primary.agent.model, fallback,
    };
    // A record change is consequential whatever the definition says.
    if ((n.consequential || primary.version.output_kind === 'record_change') && n.approval !== 'required') {
      out.push({ code: 'approval_missing', path: `${p}.approval`, node: n.key, detail: { output_kind: primary.version.output_kind } });
    }
  });

  // Handoffs: declared inputs only, from declared upstream outputs only, type for type.
  const byKey = new Map(def.nodes.map((n) => [n.key, n]));
  def.nodes.forEach((n, i) => {
    const p = `nodes[${i}].mapping`;
    const up = upstreamOf(def.nodes, n.key);
    for (const [target, src] of Object.entries(n.mapping)) {
      const to = fieldOf(n.inputs, target);
      if (!to) { out.push({ code: 'mapping_target_unknown', path: `${p}.${target}`, node: n.key }); continue; }
      let from: Field | undefined;
      if (src.from === 'input') {
        from = fieldOf(def.input_schema, src.field);
        if (!from) { out.push({ code: 'input_unknown', path: `${p}.${target}`, node: n.key, detail: { field: src.field } }); continue; }
      } else {
        const sn = byKey.get(src.node);
        if (!sn) { out.push({ code: 'node_missing', path: `${p}.${target}`, node: n.key, detail: { missing: src.node } }); continue; }
        if (!up.has(src.node)) { out.push({ code: 'mapping_not_upstream', path: `${p}.${target}`, node: n.key, detail: { from: src.node } }); continue; }
        from = fieldOf(sn.outputs, src.field);
        if (!from) { out.push({ code: 'output_undeclared', path: `${p}.${target}`, node: n.key, detail: { from: src.node, field: src.field } }); continue; }
      }
      if (from.type !== to.type) out.push({ code: 'mapping_type_mismatch', path: `${p}.${target}`, node: n.key, detail: { from: from.type, to: to.type } });
      else if (to.required && !from.required) out.push({ code: 'mapping_type_mismatch', path: `${p}.${target}`, node: n.key, detail: { reason: 'optional_into_required' } });
    }
    for (const f of n.inputs) if (f.required && !(f.name in n.mapping)) out.push({ code: 'input_unmapped', path: `${p}.${f.name}`, node: n.key });
  });

  // The final output: every section from declared node outputs; a required section's nodes cannot be skipped.
  def.output.sections.forEach((s, i) => {
    const p = `$.output.sections[${i}]`;
    if (!s.sources.length) out.push({ code: 'section_unmapped', path: p });
    for (const src of s.sources) {
      const sn = byKey.get(src.node);
      if (!sn) out.push({ code: 'node_missing', path: `${p}.sources`, detail: { missing: src.node } });
      else if (!fieldOf(sn.outputs, src.field)) out.push({ code: 'output_undeclared', path: `${p}.sources`, node: src.node, detail: { field: src.field } });
      else if (s.required && failsOpen(sn)) out.push({ code: 'continue_unsafe', path: `${p}.sources`, node: src.node, detail: { section: s.key } });
    }
  });
  if (def.output.approval !== 'required') out.push({ code: 'approval_missing', path: '$.output.approval' });

  // Budgets: each within its ceiling, and the worst case within the run's total.
  const b = def.budget;
  const over = (path: string, budget: string, value: number, ceiling: number, node?: string) => {
    if (value > ceiling) out.push({ code: 'budget_over_ceiling', path, ...(node ? { node } : {}), detail: { budget, value, ceiling } });
  };
  over('$.budget.max_total_cost_cents', 'max_total_cost_cents', b.max_total_cost_cents, cap.max_total_cost_cents);
  over('$.budget.max_run_ms', 'max_run_ms', b.max_run_ms, cap.max_run_ms);
  over('$.budget.max_concurrency', 'max_concurrency', b.max_concurrency, cap.max_concurrency);
  over('$.budget.max_fan_out', 'max_fan_out', b.max_fan_out, cap.max_fan_out);
  over('$.budget.max_total_attempts', 'max_total_attempts', b.max_total_attempts, cap.max_total_attempts);
  over('$.budget.max_input_bytes', 'max_input_bytes', b.max_input_bytes, cap.max_input_bytes);
  over('$.budget.max_artifact_bytes', 'max_artifact_bytes', b.max_artifact_bytes, cap.max_artifact_bytes);
  over('$.budget.approval_expiry_hours', 'approval_expiry_hours', b.approval_expiry_hours, cap.approval_expiry_hours);
  let worstCents = 0; let attempts = 0; let worstMs = 0;
  def.nodes.forEach((n, i) => {
    const p = `nodes[${i}]`;
    over(`${p}.timeout_ms`, 'node_timeout_ms', n.timeout_ms, cap.node_timeout_ms, n.key);
    over(`${p}.max_retries`, 'max_retries', n.max_retries, cap.max_retries, n.key);
    over(`${p}.budget.max_cost_cents`, 'node_max_cost_cents', n.budget.max_cost_cents, cap.node_max_cost_cents, n.key);
    over(`${p}.budget.max_output_bytes`, 'node_max_output_bytes', n.budget.max_output_bytes, cap.node_max_output_bytes, n.key);
    const tries = attemptsOf(n);
    attempts += tries; worstCents += tries * n.budget.max_cost_cents; worstMs += tries * n.timeout_ms;
  });
  if (attempts > b.max_total_attempts) out.push({ code: 'budget_over_total', path: '$.budget.max_total_attempts', detail: { budget: 'attempts', worst_case: attempts, total: b.max_total_attempts } });
  if (worstCents > b.max_total_cost_cents) out.push({ code: 'budget_over_total', path: '$.budget.max_total_cost_cents', detail: { budget: 'cost_cents', worst_case: worstCents, total: b.max_total_cost_cents } });
  if (worstMs > b.max_run_ms) out.push({ code: 'budget_over_total', path: '$.budget.max_run_ms', detail: { budget: 'run_ms', worst_case: worstMs, total: b.max_run_ms } });
  const fan = fanOut(def.nodes);
  if (fan > b.max_fan_out) out.push({ code: 'fan_out_exceeded', path: '$.budget.max_fan_out', detail: { fan_out: fan, budget: b.max_fan_out } });

  return out.length ? { ok: false, refusals: out } : { ok: true, definition: def, order, levels, resolved };
}

/** A node whose failure lets the run go on (its dependents are skipped, its sections marked missing). */
const failsOpen = (n: Pick<NodeDef, 'failure'>) => n.failure.on_failure === 'continue_when_safe' || (n.failure.on_failure === 'fallback' && n.failure.then === 'continue_when_safe');
/** Attempts a node may take: its own tries, and its fallback's at the same retry budget. */
export const attemptsOf = (n: Pick<NodeDef, 'max_retries' | 'failure'>) => (1 + n.max_retries) * (n.failure.on_failure === 'fallback' ? 2 : 1);
/** The most nodes that can start together off one point: the roots, or one node's direct dependents. */
export function fanOut(nodes: ReadonlyArray<Pick<NodeDef, 'key' | 'depends_on'>>): number {
  let most = nodes.filter((n) => !n.depends_on.length).length;
  for (const n of nodes) most = Math.max(most, nodes.filter((m) => m.depends_on.includes(n.key)).length);
  return most;
}

// ── The run plan ────────────────────────────────────────────────────────────

/** The same JSON for the same value, whatever the key order: what a hash is taken over. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type PlannedNode = {
  key: string; title: string; depends_on: string[];
  skill: { uid: string; version: number; content_hash: string | null; output_kind: string };
  role_key: string; agent_uid: string; tools: string[]; requested_model: string | null;
  contract: { inputs: Field[]; mapping: Record<string, Source>; outputs: Field[] };
  timeout_ms: number; max_retries: number; failure: FailurePolicy; approval: 'required' | 'none';
  budget: { max_cost_cents: number; max_output_bytes: number };
  /** One key per allowed attempt; `run_uid` is the agentRun uid that attempt uses, so a replay is answered, never rerun. */
  attempts: Array<{ attempt: number; key: string; run_uid: string }>;
  fallback: null | { skill: { uid: string; version: number; content_hash: string | null }; agent_uid: string; attempts: Array<{ attempt: number; key: string; run_uid: string }> };
};
export type RunPlan = {
  plan_schema: 1; policy_version: string;
  workflow: { uid: string; slug: string; version: number; definition_hash: string };
  scope: { company_id: number | null; project_id: number | null };
  run_key: string; order: string[]; levels: string[][];
  nodes: PlannedNode[];
  output: WorkflowDefinition['output'];
  input_schema: Field[];
  budget: RunBudget;
};

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v); }
  return v;
}

/**
 * The immutable plan a run is bound to: the definition version and its hash, each node's identity, the exact
 * skill revisions, the policy version, the contracts and an idempotency key per run and per node attempt.
 * Planning the same published version with the same request key in the same scope gives the same keys; a new
 * version, a changed definition or a different pinned skill version gives different ones. Nothing runs.
 */
export async function planRun(input: unknown, ctx: ValidationContext, requestKey: string):
  Promise<{ ok: true; plan: RunPlan } | { ok: false; refusals: Refusal[] }> {
  const v = validateWorkflow(input, ctx);
  if (!v.ok) return v;
  const def = v.definition;
  if (def.lifecycle !== 'published') return { ok: false, refusals: [{ code: 'definition_invalid', path: '$.lifecycle', detail: { reason: 'not_published', lifecycle: def.lifecycle } }] };
  if (typeof requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(requestKey)) return { ok: false, refusals: [{ code: 'definition_invalid', path: 'request_key' }] };
  const definition_hash = await sha256(canonical(def));
  const scope = { company_id: ctx.scope.company_id, project_id: ctx.scope.project_id };
  const run_key = `wfrun:${(await sha256(canonical({ uid: def.uid, version: def.version, definition_hash, scope, requestKey, policy: POLICY_VERSION }))).slice(0, 40)}`;
  const keysFor = async (node: string, kind: 'a' | 'f', skill: { uid: string; version: number; content_hash: string | null }, n: number) => {
    const list: PlannedNode['attempts'] = [];
    for (let attempt = 1; attempt <= n; attempt++) {
      const key = `${run_key}:${node}:${kind}${attempt}:${skill.uid}@${skill.version}`;
      list.push({ attempt, key, run_uid: `wf-${(await sha256(canonical({ key, content: skill.content_hash }))).slice(0, 40)}` });
    }
    return list;
  };
  const byKey = new Map(def.nodes.map((n) => [n.key, n]));
  const nodes: PlannedNode[] = [];
  for (const key of v.order) {
    const n = byKey.get(key)!; const r = v.resolved[key];
    nodes.push({
      key, title: n.title, depends_on: [...n.depends_on],
      skill: r.skill, role_key: n.role_key, agent_uid: r.agent_uid, tools: [...n.tools], requested_model: r.requested_model,
      contract: { inputs: n.inputs, mapping: n.mapping, outputs: n.outputs },
      timeout_ms: n.timeout_ms, max_retries: n.max_retries, failure: n.failure, approval: n.approval, budget: n.budget,
      attempts: await keysFor(key, 'a', r.skill, 1 + n.max_retries),
      fallback: r.fallback ? { ...r.fallback, attempts: await keysFor(key, 'f', r.fallback.skill, 1 + n.max_retries) } : null,
    });
  }
  const plan: RunPlan = {
    plan_schema: 1, policy_version: POLICY_VERSION,
    workflow: { uid: def.uid, slug: def.slug, version: def.version, definition_hash },
    scope, run_key, order: v.order, levels: v.levels, nodes,
    output: structuredClone(def.output), input_schema: structuredClone(def.input_schema), budget: { ...def.budget },
  };
  return { ok: true, plan: deepFreeze(structuredClone(plan)) };
}

/**
 * R2-10 §4: may a stored plan be resumed by code that would now plan `fresh`? Only when nothing an attempt's
 * effects depend on moved: the policy, the definition hash, and every node's skill revision, agent and keys.
 * Otherwise the run pauses for a person (an explicit migration or review), and old effects are never replayed
 * under new instructions.
 */
export function resumeRefusal(stored: RunPlan, fresh: RunPlan): null | { code: 'plan_incompatible'; changed: string[] } {
  const changed: string[] = [];
  if (stored.policy_version !== fresh.policy_version) changed.push('policy_version');
  if (stored.workflow.definition_hash !== fresh.workflow.definition_hash) changed.push('definition');
  if (stored.run_key !== fresh.run_key) changed.push('run_key');
  for (const n of stored.nodes) {
    const f = fresh.nodes.find((x) => x.key === n.key);
    if (!f) { changed.push(`node:${n.key}`); continue; }
    if (canonical(n.skill) !== canonical(f.skill) || canonical(n.fallback?.skill ?? null) !== canonical(f.fallback?.skill ?? null)) changed.push(`skill:${n.key}`);
    if (n.agent_uid !== f.agent_uid) changed.push(`agent:${n.key}`);
  }
  return changed.length ? { code: 'plan_incompatible', changed } : null;
}

// ── Readiness (what the execution slice may start) ──────────────────────────

/**
 * A node's state as the execution slice records it. `succeeded` is an output a dependent may read: for a node
 * with `approval: 'required'`, only after a person accepted or edited its proposal; until then
 * `waiting_approval`. `failed` is after every attempt (and the fallback's) ran out.
 */
export type NodeState = 'pending' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
export type NodeOutcome = {
  state: NodeState;
  /** The attempt that produced the output, and the skill version it actually ran. */
  attempt_key?: string; skill_uid?: string; skill_version?: number;
  output?: Record<string, unknown>;
  /** Scoped references to the evidence the node cited, and to a large output in the artifact store. */
  evidence_refs?: string[]; output_ref?: string | null;
  reason?: string;
};
export type Readiness = { key: string; status: 'done' | 'runnable' | 'waiting' | 'unrunnable'; reason: string | null };

/**
 * Which nodes may start now. A cancelled run starts nothing. A failed node that stops the run leaves every
 * node not yet started unrunnable; one that continues when safe leaves only its dependents unrunnable. A node
 * is runnable when every node it depends on has `succeeded` and the run's concurrency has room.
 */
export function readiness(plan: RunPlan, outcomes: Readonly<Record<string, NodeOutcome>>, opts: { cancelled?: boolean } = {}): { run: 'active' | 'stopped' | 'cancelled' | 'finished'; nodes: Readiness[] } {
  const st = (k: string): NodeState => outcomes[k]?.state ?? 'pending';
  const terminal = (s: NodeState) => s === 'succeeded' || s === 'failed' || s === 'skipped' || s === 'cancelled';
  const stopped = plan.nodes.some((n) => st(n.key) === 'failed' && !failsOpen(n));
  const dead = new Set<string>();
  for (const n of plan.nodes) {
    if (['failed', 'skipped', 'cancelled'].includes(st(n.key)) || n.depends_on.some((d) => dead.has(d))) dead.add(n.key);
  }
  let running = plan.nodes.filter((n) => st(n.key) === 'running').length;
  const nodes: Readiness[] = [];
  for (const n of plan.nodes) {
    const s = st(n.key);
    if (terminal(s)) { nodes.push({ key: n.key, status: 'done', reason: s }); continue; }
    if (opts.cancelled) { nodes.push({ key: n.key, status: 'unrunnable', reason: 'run_cancelled' }); continue; }
    if (s === 'running' || s === 'waiting_approval') { nodes.push({ key: n.key, status: 'waiting', reason: s }); continue; }
    if (stopped) { nodes.push({ key: n.key, status: 'unrunnable', reason: 'run_stopped' }); continue; }
    if (dead.has(n.key)) { nodes.push({ key: n.key, status: 'unrunnable', reason: 'prerequisite_failed' }); continue; }
    if (!n.depends_on.every((d) => st(d) === 'succeeded')) { nodes.push({ key: n.key, status: 'waiting', reason: 'dependencies' }); continue; }
    if (running >= plan.budget.max_concurrency) { nodes.push({ key: n.key, status: 'waiting', reason: 'concurrency' }); continue; }
    running++;
    nodes.push({ key: n.key, status: 'runnable', reason: null });
  }
  const run = opts.cancelled ? 'cancelled' : stopped ? 'stopped' : nodes.every((x) => x.status === 'done' || x.status === 'unrunnable') ? 'finished' : 'active';
  return { run, nodes };
}

/**
 * R2-10 §6: a result that arrives for `attemptKey`. It is recorded only for a node that is running that exact
 * planned attempt in a run that is not cancelled; a late result never restarts a cancelled graph and is left
 * to the existing reconciliation (its proposal stays a proposal; its charge settles through the hold).
 */
export function lateResult(plan: RunPlan, outcomes: Readonly<Record<string, NodeOutcome>>, attemptKey: string, opts: { cancelled?: boolean } = {}):
  { accept: true; node: string } | { accept: false; reason: 'run_cancelled' | 'unknown_attempt' | 'node_not_running' | 'stale_attempt' } {
  const node = plan.nodes.find((n) => n.attempts.some((a) => a.key === attemptKey) || n.fallback?.attempts.some((a) => a.key === attemptKey));
  if (!node) return { accept: false, reason: 'unknown_attempt' };
  if (opts.cancelled) return { accept: false, reason: 'run_cancelled' };
  const o = outcomes[node.key];
  if (o?.state !== 'running') return { accept: false, reason: 'node_not_running' };
  if (o.attempt_key !== attemptKey) return { accept: false, reason: 'stale_attempt' };
  return { accept: true, node: node.key };
}

// ── Assembly (the final proposal) ───────────────────────────────────────────

export type SourceStatus = 'included' | 'failed' | 'skipped' | 'cancelled' | 'not_run' | 'output_missing' | 'version_mismatch';
export type AssembledSection = {
  key: string; title: string; required: boolean; status: 'complete' | 'partial' | 'missing';
  sources: Array<{
    node: string; field: string; status: SourceStatus;
    skill_uid: string; skill_version: number | null; attempt_key: string | null;
    evidence_refs: string[]; output_ref: string | null; value?: unknown;
  }>;
};
export type Assembly = {
  proposal: true; notice: string; approval: 'required' | 'none';
  workflow: RunPlan['workflow']; run_key: string;
  complete: boolean; missing_nodes: string[];
  nodes: Array<{ key: string; state: NodeState; skill_uid: string; skill_version: number | null }>;
  sections: AssembledSection[];
};

/**
 * The final brief's section map over the node outcomes. A section reads only nodes that `succeeded` on the
 * exact skill revision the plan pinned (or its fallback's); a failed, skipped, cancelled or unrun node, a
 * missing field, or a different version is named, so a partial brief cannot read as if every node ran.
 * It is a proposal for a person to review, never a decision.
 */
export function assembleSections(plan: RunPlan, outcomes: Readonly<Record<string, NodeOutcome>>): Assembly {
  const byKey = new Map(plan.nodes.map((n) => [n.key, n]));
  const verified = (n: PlannedNode, o: NodeOutcome | undefined): boolean => {
    if (!o) return false;
    const primary = n.attempts.some((a) => a.key === o.attempt_key) && o.skill_uid === n.skill.uid && o.skill_version === n.skill.version;
    const fb = !!n.fallback && n.fallback.attempts.some((a) => a.key === o.attempt_key) && o.skill_uid === n.fallback.skill.uid && o.skill_version === n.fallback.skill.version;
    return primary || fb;
  };
  const sections: AssembledSection[] = plan.output.sections.map((s) => {
    const sources = s.sources.map((src) => {
      const n = byKey.get(src.node)!; const o = outcomes[src.node];
      const state = o?.state ?? 'pending';
      let status: SourceStatus;
      if (state === 'succeeded') status = !verified(n, o) ? 'version_mismatch' : (o!.output && o!.output[src.field] !== undefined && o!.output[src.field] !== null ? 'included' : 'output_missing');
      else if (state === 'failed' || state === 'skipped' || state === 'cancelled') status = state;
      else status = 'not_run';
      const ok = status === 'included';
      return {
        node: src.node, field: src.field, status,
        skill_uid: ok ? o!.skill_uid! : n.skill.uid, skill_version: ok ? o!.skill_version! : null,
        attempt_key: ok ? o!.attempt_key! : null,
        evidence_refs: ok ? [...(o!.evidence_refs ?? [])] : [], output_ref: ok ? o!.output_ref ?? null : null,
        ...(ok ? { value: o!.output![src.field] } : {}),
      };
    });
    const got = sources.filter((x) => x.status === 'included').length;
    return { key: s.key, title: s.title, required: s.required, status: got === sources.length ? 'complete' : got ? 'partial' : 'missing', sources };
  });
  const nodes = plan.nodes.map((n) => {
    const o = outcomes[n.key];
    return { key: n.key, state: o?.state ?? 'pending', skill_uid: n.skill.uid, skill_version: o?.state === 'succeeded' && verified(n, o) ? o.skill_version! : null };
  });
  const missing_nodes = nodes.filter((n) => n.state !== 'succeeded' || n.skill_version == null).map((n) => n.key);
  return {
    proposal: true, notice: plan.output.notice, approval: plan.output.approval,
    workflow: plan.workflow, run_key: plan.run_key,
    complete: !missing_nodes.length && sections.every((s) => s.status === 'complete'),
    missing_nodes, nodes, sections,
  };
}

// ── The reference workflow: Startup Assessment ──────────────────────────────

/** The library skills its four nodes use, by slug (HQ skills; their uids are D1's, bound at authoring). */
export const STARTUP_ASSESSMENT_SKILLS = Object.freeze({
  market_research: { slug: 'market-entry-brief', role_key: 'research_analyst', tools: ['research.read', 'validate.read'] },
  financial_analysis: { slug: 'unit-economics-summary', role_key: 'cfo', tools: ['stripe.read', 'grow.read'] },
  product_assessment: { slug: 'roadmap-review-brief', role_key: 'cpo', tools: ['build.read', 'project.read'] },
  legal_compliance_review: { slug: 'legal-due-diligence-coordination', role_key: 'general_counsel', tools: ['data_room.read', 'raise.read'] },
});
export type StartupNode = keyof typeof STARTUP_ASSESSMENT_SKILLS;
export const STARTUP_ASSESSMENT_NOTICE = 'A proposal for human review: not an investment decision, and not legal advice. Sections marked missing were not assessed.';

const ASSESSMENT_OUTPUTS: Field[] = [
  { name: 'summary', type: 'text', required: true },
  { name: 'findings', type: 'text_list', required: true },
  { name: 'strengths', type: 'text_list', required: false },
  { name: 'risks', type: 'text_list', required: false },
  { name: 'open_questions', type: 'text_list', required: false },
  { name: 'missing_information', type: 'text_list', required: true },
  { name: 'evidence_refs', type: 'record_ref_list', required: true },
];
const BASE_INPUTS: Field[] = [
  { name: 'profile', type: 'record_ref', required: true },
  { name: 'evidence', type: 'record_ref_list', required: true },
];
const NODE_TITLES: Record<StartupNode, string> = {
  market_research: 'Market research', financial_analysis: 'Financial analysis',
  product_assessment: 'Product assessment', legal_compliance_review: 'Legal and compliance review',
};

/**
 * The Startup Assessment definition, as data, with each library skill's D1 uid bound in and pinned to version
 * `versions[node]` (1 when not given: the library's version). It is a DRAFT: nothing here publishes it.
 * Product assessment reads market research's findings, so it waits on it; the other three start together.
 * Financial analysis and the legal review are consequential and wait for a person's decision before their
 * output is used. Every node continues when safe: a failed node is marked missing in the brief.
 */
export function startupAssessment(uids: Record<StartupNode, string>, opts: { uid: string; versions?: Partial<Record<StartupNode, number>>; owner?: OwnerScope } ): WorkflowDefinition {
  const node = (key: StartupNode, extra: Partial<NodeDef> = {}): NodeDef => ({
    key, title: NODE_TITLES[key], skill_uid: uids[key],
    version: { pin: 'exact', version: opts.versions?.[key] ?? 1 },
    role_key: STARTUP_ASSESSMENT_SKILLS[key].role_key, tools: [...STARTUP_ASSESSMENT_SKILLS[key].tools],
    depends_on: [], inputs: BASE_INPUTS.map((f) => ({ ...f })),
    mapping: { profile: { from: 'input', field: 'profile' }, evidence: { from: 'input', field: 'evidence' } },
    outputs: ASSESSMENT_OUTPUTS.map((f) => ({ ...f })),
    timeout_ms: 5 * 60_000, max_retries: 1, failure: { on_failure: 'continue_when_safe' },
    approval: 'none', consequential: false, budget: { max_cost_cents: 150, max_output_bytes: 16 * 1024 },
    ...extra,
  });
  const each = (field: string) => (Object.keys(NODE_TITLES) as StartupNode[]).map((n) => ({ node: n, field }));
  return {
    schema: 1, uid: opts.uid, slug: 'startup-assessment', name: 'Startup Assessment',
    purpose: 'An investment-readiness brief from four independent skill assessments, each section traced to its skill version and evidence.',
    owner: opts.owner ?? { scope: 'hq', company_id: null },
    provenance: { origin: 'hq_reference', source_uid: null, note: 'D4535 reference workflow' },
    version: 1, lifecycle: 'draft',
    input_schema: BASE_INPUTS.map((f) => ({ ...f })),
    output: {
      approval: 'required', notice: STARTUP_ASSESSMENT_NOTICE,
      sections: [
        { key: 'overall_findings', title: 'Overall findings', required: false, sources: each('findings') },
        { key: 'market', title: 'Market', required: false, sources: [{ node: 'market_research', field: 'summary' }] },
        { key: 'financials', title: 'Financials', required: false, sources: [{ node: 'financial_analysis', field: 'summary' }] },
        { key: 'product', title: 'Product', required: false, sources: [{ node: 'product_assessment', field: 'summary' }] },
        { key: 'legal_compliance', title: 'Legal and compliance', required: false, sources: [{ node: 'legal_compliance_review', field: 'summary' }] },
        { key: 'strengths', title: 'Evidence-backed strengths', required: false, sources: each('strengths') },
        { key: 'risks', title: 'Risks', required: false, sources: each('risks') },
        { key: 'open_questions', title: 'Open questions', required: false, sources: each('open_questions') },
        { key: 'missing_information', title: 'Missing information', required: false, sources: each('missing_information') },
      ],
    },
    nodes: [
      node('market_research'),
      node('financial_analysis', { approval: 'required', consequential: true }),
      node('product_assessment', {
        depends_on: ['market_research'],
        inputs: [...BASE_INPUTS.map((f) => ({ ...f })), { name: 'market_findings', type: 'text_list', required: true }],
        mapping: { profile: { from: 'input', field: 'profile' }, evidence: { from: 'input', field: 'evidence' }, market_findings: { from: 'node', node: 'market_research', field: 'findings' } },
      }),
      node('legal_compliance_review', { approval: 'required', consequential: true }),
    ],
    budget: {
      max_total_cost_cents: 1_200, max_run_ms: 3_600_000, max_concurrency: 3, max_fan_out: 3, max_total_attempts: 8,
      max_input_bytes: 32 * 1024, max_artifact_bytes: 1024 * 1024, approval_expiry_hours: 168,
    },
  };
}

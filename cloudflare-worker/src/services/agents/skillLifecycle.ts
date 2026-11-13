/**
 * D4160 (#4160, H2 of #4137) — the lifecycle of Axal's own skills: draft →
 * in review → published → retired, the second admin's approval, the golden
 * cases and their results per model, the diff between versions, and the
 * publish gate.
 *
 * THE DRAFT'S NAME. `draftHash` is SHA-256 of a draft's parts in a fixed
 * order. An approval and an eval result count only for the hash they were
 * given on, so an edit after either needs them again.
 *
 * THE RELEASE EVIDENCE (D4533, `evidenceOf`). What a draft is qualified on is
 * four parts: its definition (`draftHash`), its case suite (the live cases'
 * immutable identities, `suiteRevision`), the evaluator version (`JUDGE_VERSION`,
 * #4531's) and the REQUIRED model set (declared on the draft, else the default
 * set; never read from the results). `evidence_hash` names all four. A review
 * and an eval result count only for the evidence hash they were given on, so a
 * change to any part needs a new review and new results.
 *
 * THE PUBLISH GATE (`publishRefusalOf` over `releaseDecision`), for an HQ skill
 * only, in order:
 *   needs_approval         409: no approval by a second Super Admin on the current evidence
 *   evaluation_incomplete  409: a live case has no result on a required model under the
 *                          current evidence: it reads `not_evaluated`, is never left
 *                          out of the matrix and never counts as a pass
 *   golden_cases_failing   409: below the bar, 9 of 10 (`PASS_BAR`), over every live
 *                          case on every required model; a skill with no case is below it
 * Each refusal carries the decision as `freshness`, the same object GET /:uid
 * answers, so the HQ screen and the gate never disagree.
 * `routes/team_skills.ts`'s publish and the bulk publish both call it.
 *
 * A golden case's inputs are made-up records keyed by the read they stand in
 * for (`{ records: { "stripe.read": {...} } }`), never a member's email; its
 * expectation is the output kind and the words it must and must not contain,
 * the shape `services/agents/skills/cases/*.json` (#3953) uses.
 */
import type { Env } from '../../types';
import { run as aiRun, type RunOptions, type RunResult } from '../aiRouter';
import { OUTPUT_KINDS, type OutputKind, type Tag } from './skills';
import { JUDGE_VERSION, NUMBERS_MAX, assertionsMiss, checkAssertions, checkNumberAssertion, missingDataMiss, numberMiss, statements, type NumberAssertion, type SliceTwo } from './skillAssertions';
import { agentModels } from './modelOffers';
import type { User } from '../../types';

export const PASS_BAR = { pass: 9, of: 10 };
export const CASES_MAX = 20;
export const CASE_JSON_MAX = 20_000;

export type DraftParts = { name: string; purpose: string; steps: string[]; tools: string[]; output_kind: OutputKind; tags: Tag[]; roles: string[] };

/** The draft's name: SHA-256 hex of its parts, in a fixed order. */
export async function draftHash(p: DraftParts): Promise<string> {
  const canonical = JSON.stringify([p.name, p.purpose, p.steps, p.tools, p.output_kind, p.tags.map((t) => [t.slug, t.level]), p.roles]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Golden cases ────────────────────────────────────────────────────────────

/**
 * `numbers` (#4531) is optional: a case without it is judged exactly as before
 * apart from the field-specific missing-data rule (`skillAssertions.ts`). So
 * are `output_schema`, `structure`, `evidence`, `refusal` and `claims` (#4531
 * slice 2, judge version 3): a case without them is judged as under version 2.
 */
export type CaseExpect = { output: OutputKind; must_include: string[]; must_say_not_recorded: string[]; must_not_include: string[]; numbers?: NumberAssertion[] } & SliceTwo;
export type CaseInput = { records: Record<string, unknown> };
export type CaseCheck = { ok: true; name: string; input: CaseInput; expect: CaseExpect } | { ok: false; code: 'case_invalid' | 'case_has_email'; message: string };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const words = (v: unknown): string[] | null => (v == null ? [] : Array.isArray(v) && v.length <= 20 && v.every((w) => typeof w === 'string' && w.trim() && w.length <= 200) ? v.map((w) => w.trim()) : null);

/** A golden case as every writer must give it. */
export function checkCase(raw: unknown): CaseCheck {
  const bad = (message: string): CaseCheck => ({ ok: false, code: 'case_invalid', message });
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, any> : null;
  if (!b) return bad('Send each case as an object with name, input and expect.');
  const text = JSON.stringify(b);
  if (text.length > CASE_JSON_MAX) return bad('A case is at most 20,000 characters.');
  // Inputs are references and made-up records: never a member's email.
  if (EMAIL.test(text)) return { ok: false, code: 'case_has_email', message: 'A golden case never holds an email address. Use made-up records.' };
  const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : '';
  if (!name || name.length > 120) return bad('Name the case in up to 120 characters.');
  const records = b.input?.records;
  if (!records || typeof records !== 'object' || Array.isArray(records) || !Object.keys(records).length) return bad('Give the case its input records, keyed by the read each stands in for.');
  const e = b.expect && typeof b.expect === 'object' ? b.expect : null;
  if (!e || !(OUTPUT_KINDS as readonly string[]).includes(e.output)) return bad('Say what the case expects: a draft, a record change or a brief.');
  const must = words(e.must_include), nr = words(e.must_say_not_recorded), not = words(e.must_not_include);
  if (!must || !nr || !not) return bad('Each expectation is a list of up to 20 short phrases.');
  let numbers: NumberAssertion[] | null = null;
  if (e.numbers != null) {
    const list = Array.isArray(e.numbers) && e.numbers.length <= NUMBERS_MAX ? e.numbers.map(checkNumberAssertion) : null;
    if (!list || list.some((n: NumberAssertion | null) => n == null)) {
      return bad(`Each number the case expects names its metric, value, unit (use "" for none) and tolerance; at most ${NUMBERS_MAX}.`);
    }
    numbers = list as NumberAssertion[];
  }
  // #4531 slice 2: each assertion is checked against its schema (and evidence against these records).
  const more = checkAssertions(e, records);
  if (!more.ok) return bad(more.message);
  if (!must.length && !nr.length && !not.length && !numbers?.length && !Object.keys(more.value).length) {
    return bad('Give the case at least one phrase it must or must not contain, or another assertion.');
  }
  return {
    ok: true, name, input: { records },
    expect: { output: e.output, must_include: must, must_say_not_recorded: nr, must_not_include: not, ...(numbers ? { numbers } : {}), ...more.value },
  };
}

/**
 * Whether an output meets a case's expectation; `detail` says the first miss.
 * The draft and the published evaluation both judge through here. The
 * missing-data, number and slice-2 rules are `skillAssertions.ts`'s (judge
 * version 3); `input` is the case's, which its evidence citations must name.
 */
export function judge(expect: CaseExpect, output: string, input: CaseInput | null = null): { result: 'pass' | 'fail'; detail: string | null } {
  const text = output.toLowerCase();
  const parts = statements(output);
  for (const w of expect.must_include) if (!text.includes(w.toLowerCase())) return { result: 'fail', detail: `It left out "${w}".` };
  for (const w of expect.must_say_not_recorded) {
    const miss = missingDataMiss(w, parts);
    if (miss) return { result: 'fail', detail: miss };
  }
  for (const n of expect.numbers ?? []) {
    const miss = numberMiss(n, parts);
    if (miss) return { result: 'fail', detail: miss };
  }
  for (const w of expect.must_not_include) if (text.includes(w.toLowerCase())) return { result: 'fail', detail: `It said "${w}", which it must not.` };
  const miss = assertionsMiss(expect, output, parts, input?.records ?? null);
  if (miss) return { result: 'fail', detail: miss };
  return { result: 'pass', detail: null };
}

/** The run, behind a seam the tests replace; production is `aiRouter.run`. */
export const EVAL_DEPS: { run: (env: Env, opts: RunOptions) => Promise<RunResult> } = { run: aiRun };

/** The most a case run may write, in tokens. */
export const CASE_MAX_TOKENS = 900;

/** What a case run sends: the skill as its system prompt and the case's made-up records. */
export function casePrompt(p: DraftParts, input: CaseInput, expect: CaseExpect): { system: string; user: string } {
  const system = [
    `You are running the skill "${p.name}": ${p.purpose}`,
    `Propose ${expect.output === 'record_change' ? 'a record change' : `a ${expect.output}`}; a named person decides. Never invent a figure: say "Not recorded" for anything the records do not hold.`,
    'Steps:', ...p.steps.map((s, i) => `${i + 1}. ${s}`),
  ].join('\n');
  return { system, user: `Records (made up, for a golden case):\n${JSON.stringify(input.records, null, 2)}` };
}

/**
 * One case on one model, through `run()`: the output, or why there is none. The output is the
 * caller's to judge and drop; nothing here stores it. D4531 part 5's rubric passes its own surface,
 * so its spend is read apart from the evaluation's.
 */
export async function caseOutput(env: Env, p: DraftParts, input: CaseInput, expect: CaseExpect, model: string, adminId: number, surface = '/hq/ai-agents'):
  Promise<{ ok: true; output: string; usage_log_id: number | null } | { ok: false; detail: string; usage_log_id: number | null }> {
  const { system, user } = casePrompt(p, input, expect);
  let r: RunResult;
  try {
    r = await EVAL_DEPS.run(env, {
      task: 'module_chat', model, pinned: true, userId: adminId, surface, systemPrompt: system, maxTokens: CASE_MAX_TOKENS, temperature: 0,
      messages: [{ role: 'user', content: user }],
    });
  } catch {
    return { ok: false, detail: 'The run failed before the model answered.', usage_log_id: null };
  }
  if (!r.ok || typeof r.output !== 'string') return { ok: false, detail: r.refusal ? `The run was refused: ${r.refusal}.` : 'The model gave no answer.', usage_log_id: r.usageLogId ?? null };
  return { ok: true, output: r.output, usage_log_id: r.usageLogId ?? null };
}

/** One case on one model, through `run()`, charged to the admin who pressed Re-run (HQ). */
export async function runCase(env: Env, p: DraftParts, input: CaseInput, expect: CaseExpect, model: string, adminId: number):
  Promise<{ result: 'pass' | 'fail' | 'not_run'; detail: string | null; usage_log_id: number | null }> {
  const r = await caseOutput(env, p, input, expect, model, adminId);
  if (!r.ok) return { result: 'not_run', detail: r.detail, usage_log_id: r.usage_log_id };
  return { ...judge(expect, r.output, input), usage_log_id: r.usage_log_id };
}

// ── Release evidence (D4533) ────────────────────────────────────────────────

/** The most models one evaluation runs on, and the size of the default required set. */
export const MODELS_MAX = 5;

/**
 * The evaluator version the evidence is bound to: #4531's `JUDGE_VERSION`,
 * read through the import, behind a seam the tests move to show a new
 * evaluator makes earlier evidence stale.
 */
export const EVALUATOR: { version: number } = { version: JUDGE_VERSION };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** D4531 slice 3's case fingerprint; it lives beside the case identity since D5336 (`skillCaseIdentity.ts`). */
export { caseSha } from './skillCaseIdentity';

export type EvidencePart = 'definition' | 'cases' | 'evaluator' | 'models';
export type SuiteCase = { uid: string; name: string; sha256: string };
export type RequiredModels = { required: string[]; source: 'declared' | 'default' };
export type Evidence = {
  definition_hash: string;
  suite: { revision: string; cases: SuiteCase[] };
  evaluator_version: number;
  models: RequiredModels;
  evidence_hash: string;
};
export type CaseRow = { id: number; uid: string; name: string; input_json: string; expect_json: string };

// The models agents may run on as HQ sees them: a Super Admin's plan never locks one.
const HQ_VIEW = { role: 'admin' } as User;

/** The default required set: the first models agents may run on, as Re-run evals without a choice runs them. */
export function defaultModels(env: Env): string[] {
  return agentModels(env, HQ_VIEW).filter((m) => !m.plan_locked).map((m) => m.id).slice(0, MODELS_MAX);
}

/** The draft's required model set: the declared one, else the default. Sorted, so its order is never a change. */
export function requiredModels(env: Env, declaredJson: string | null | undefined): RequiredModels {
  let declared: unknown = null;
  try { declared = declaredJson ? JSON.parse(declaredJson) : null; } catch { declared = null; }
  if (Array.isArray(declared) && declared.length && declared.every((m) => typeof m === 'string' && m)) {
    return { required: [...new Set(declared as string[])].sort(), source: 'declared' };
  }
  return { required: [...new Set(defaultModels(env))].sort(), source: 'default' };
}

/** A skill's live cases, oldest first. */
export async function liveCases(env: Env, skillId: number): Promise<CaseRow[]> {
  return (await env.DB.prepare('SELECT id, uid, name, input_json, expect_json FROM agent_skill_cases WHERE skill_id = ? AND removed_at IS NULL ORDER BY id')
    .bind(skillId).all<CaseRow>()).results ?? [];
}

/**
 * The suite revision: SHA-256 of the live cases' uids, oldest first. A case is
 * never edited in place (a changed case is a new row with a new uid, and the
 * row itself is immutable in D1), so its uid names its text, and an added,
 * removed or changed case is a new revision.
 */
export const suiteRevision = (uids: readonly string[]): Promise<string> => sha256Hex(JSON.stringify(uids));

/** The evidence hash: the definition, the suite revision, the evaluator version and the required models. */
export const evidenceHashOf = (definitionHash: string, revision: string, models: RequiredModels): Promise<string> =>
  sha256Hex(JSON.stringify([definitionHash, revision, EVALUATOR.version, models.required]));

export async function evidenceFrom(p: DraftParts, rows: readonly Pick<CaseRow, 'uid' | 'name' | 'input_json' | 'expect_json'>[], models: RequiredModels): Promise<Evidence> {
  const definition_hash = await draftHash(p);
  // Each case's text is fingerprinted for the record; the revision is its uids.
  const cases = await Promise.all(rows.map(async (k) => ({ uid: k.uid, name: k.name, sha256: await sha256Hex(JSON.stringify([k.name, k.input_json, k.expect_json])) })));
  const revision = await suiteRevision(rows.map((k) => k.uid));
  return { definition_hash, suite: { revision, cases }, evaluator_version: EVALUATOR.version, models, evidence_hash: await evidenceHashOf(definition_hash, revision, models) };
}

/** The current draft's evidence, read now. */
export async function evidenceOf(env: Env, s: { id: number; required_models_json?: string | null }, p: DraftParts): Promise<Evidence> {
  return evidenceFrom(p, await liveCases(env, s.id), requiredModels(env, s.required_models_json));
}

export const parseEvidence = (json: string | null | undefined): Evidence | null => {
  try { const v = json ? JSON.parse(json) : null; return v && typeof v.evidence_hash === 'string' ? v as Evidence : null; } catch { return null; }
};

/**
 * Which parts of `now` differ from what a review was asked on. `definition` is
 * always known (every review row has its draft hash); the other three are null
 * on a review from before D4533, which recorded nothing else.
 */
export function evidenceChanges(definitionHash: string, was: Evidence | null, now: Evidence): Record<EvidencePart, boolean | null> {
  return {
    definition: definitionHash !== now.definition_hash,
    cases: was ? was.suite.revision !== now.suite.revision : null,
    evaluator: was ? was.evaluator_version !== now.evaluator_version : null,
    models: was ? JSON.stringify(was.models.required) !== JSON.stringify(now.models.required) : null,
  };
}

type LatestResult = { id: number; case_uid: string; model_id: string; result: 'pass' | 'fail' | 'not_run'; detail: string | null; run_at: string };

/** The latest result per case and model under one evidence hash. */
async function latestResults(env: Env, skillId: number, evidenceHash: string): Promise<LatestResult[]> {
  return (await env.DB.prepare(
    `SELECT r.id, k.uid AS case_uid, r.model_id, r.result, r.detail, r.run_at FROM agent_skill_eval_results r JOIN agent_skill_cases k ON k.id = r.case_id
      WHERE r.skill_id = ? AND r.evidence_hash = ?
        AND r.id = (SELECT MAX(x.id) FROM agent_skill_eval_results x WHERE x.case_id = r.case_id AND x.model_id = r.model_id AND x.evidence_hash = r.evidence_hash)`,
  ).bind(skillId, evidenceHash).all<LatestResult>()).results ?? [];
}

export type CellResult = 'pass' | 'fail' | 'not_run' | 'not_evaluated';

function summarise(e: Evidence, latest: readonly LatestResult[]) {
  const models = e.models.required;
  const rows = e.suite.cases.map((c) => ({
    uid: c.uid, name: c.name,
    results: models.map((m) => {
      const hit = latest.find((l) => l.case_uid === c.uid && l.model_id === m);
      // A required model with no result is NOT EVALUATED: listed, and never a pass.
      return { model: m, result: (hit?.result ?? 'not_evaluated') as CellResult, detail: hit?.detail ?? null, run_at: hit?.run_at ?? null, result_id: hit?.id ?? null };
    }),
  }));
  const total = rows.length * models.length;
  const count = (r: CellResult) => rows.reduce((n, c) => n + c.results.filter((x) => x.result === r).length, 0);
  const pass = count('pass');
  const notEvaluated = count('not_evaluated');
  const counted = latest.filter((l) => e.suite.cases.some((c) => c.uid === l.case_uid) && models.includes(l.model_id));
  const lastRun = counted.reduce<string | null>((a, l) => (!a || l.run_at > a ? l.run_at : a), null);
  return { rows, models, pass, total, not_evaluated: notEvaluated, meets_bar: notEvaluated === 0 && meetsBar(pass, total), last_run: lastRun };
}

/**
 * Every live case on every required model under the current evidence, and the
 * bar. The matrix comes from the evidence, never from the results: a cell with
 * no result reads `not_evaluated`.
 */
export async function evalSummary(env: Env, skillId: number, e: Evidence) {
  const s = summarise(e, await latestResults(env, skillId, e.evidence_hash));
  return {
    cases: s.rows.map((c) => ({ uid: c.uid, name: c.name, results: c.results.map(({ result_id: _id, ...r }) => r) })),
    models: s.models, pass: s.pass, total: s.total, not_evaluated: s.not_evaluated, meets_bar: s.meets_bar, last_run: s.last_run,
  };
}

/** 9 of 10: pass × 10 ≥ total × 9, and at least one result. */
export function meetsBar(pass: number, total: number): boolean {
  return total > 0 && pass * PASS_BAR.of >= total * PASS_BAR.pass;
}

// ── Review ──────────────────────────────────────────────────────────────────

export type ReviewRow = {
  id: number; skill_id: number; draft_hash: string; requested_by: number; reviewer_id: number;
  status: 'requested' | 'approved' | 'changes_requested' | 'withdrawn'; comment: string | null; requested_at: string; decided_at: string | null;
  /** D4533: the evidence the review was asked on; null on a review from before it. */
  evidence_hash: string | null; evidence_json: string | null;
};

export async function openReview(env: Env, skillId: number): Promise<ReviewRow | null> {
  return env.DB.prepare("SELECT * FROM agent_skill_reviews WHERE skill_id = ? AND status = 'requested'").bind(skillId).first<ReviewRow>();
}

/**
 * The approval on exactly this evidence that has not released a version yet, if any. A review from before D4533 (no
 * evidence) never matches. D4533 step 5: an approval releases ONE version. The version's manifest names the review it
 * was published on (`$.review.review_id`), and that review never counts again, so publishing the same draft twice, or
 * restoring an old version's definition (`skillRecovery.ts`), needs a new review by a second Super Admin.
 */
export async function approvalFor(env: Env, skillId: number, evidenceHash: string): Promise<ReviewRow | null> {
  return env.DB.prepare(`SELECT r.* FROM agent_skill_reviews r WHERE r.skill_id = ? AND r.evidence_hash = ? AND r.status = 'approved'
      AND NOT EXISTS (SELECT 1 FROM agent_skill_versions v WHERE v.skill_id = r.skill_id AND json_extract(v.evidence_json, '$.review.review_id') = r.id)
    ORDER BY r.id DESC LIMIT 1`).bind(skillId, evidenceHash).first<ReviewRow>();
}

/** D4533 step 5: the latest version an approval on exactly this evidence already released; null when none did. */
export async function releasedOn(env: Env, skillId: number, evidenceHash: string): Promise<number | null> {
  const r = await env.DB.prepare(`SELECT MAX(v.version) AS version FROM agent_skill_versions v JOIN agent_skill_reviews r
      ON r.skill_id = v.skill_id AND r.id = json_extract(v.evidence_json, '$.review.review_id')
    WHERE v.skill_id = ? AND r.evidence_hash = ? AND r.status = 'approved'`).bind(skillId, evidenceHash).first<{ version: number | null }>();
  return r?.version ?? null;
}

/** The four states: a draft with an open review on its current evidence is `in_review`. */
export function lifecycleStatus(status: 'draft' | 'published' | 'retired', open: Pick<ReviewRow, 'evidence_hash'> | null, evidenceHash: string): 'draft' | 'in_review' | 'published' | 'retired' {
  if (status === 'retired') return 'retired';
  if (open && open.evidence_hash === evidenceHash) return 'in_review';
  return status;
}

export type Blocking = 'needs_approval' | 'evaluation_incomplete' | 'golden_cases_failing';

/**
 * THE FRESHNESS DECISION (D4533): whether this draft's evidence is complete and
 * current, computed once on the server. The publish gate refuses on it and GET
 * /:uid answers it, so #4537's screen reads the same object. No timestamps: the
 * same evidence gives the same decision.
 */
export type ReleaseDecision = {
  ready: boolean;
  blocking: Blocking[];
  evidence: Evidence;
  /**
   * `changes`: what differs from the latest approval of this skill; null when it never had one.
   * `released_version` (D4533 step 5): the version an approval on this same evidence already released, so it is spent
   * and a new review is needed; null when none did.
   */
  review: { approved: boolean; changes: Record<EvidencePart, boolean | null> | null; released_version: number | null };
  /**
   * `reused` (D4533 A3): when results this decision counts are the very rows a published version's manifest counted,
   * the latest such version and how many of the counted cells it named (`results` of `total`); null when none are.
   * A restore of vK's definition onto vK's evidence reads `{ version: K }`: the results still count (A3), only the
   * approval is spent (§10.1), and the reviewer is told the runs were not made again.
   */
  evaluation: { pass: number; total: number; not_evaluated: number; meets_bar: boolean; pass_bar: typeof PASS_BAR; reused: { version: number; results: number } | null };
};

/**
 * D4533 A3: the latest version on this same evidence whose manifest counted any of these result rows, and how many of
 * them it counted. A manifest names each cell's eval result by row id (`manifestOf`), and a result row is immutable, so
 * the same id is the same run. Only versions published on this evidence can name these rows; one released before D4533
 * has no manifest and names none.
 */
export async function reusedFrom(env: Env, skillId: number, evidenceHash: string, resultIds: readonly (number | null)[]): Promise<{ version: number; results: number } | null> {
  const counted = resultIds.filter((id): id is number => id != null);
  if (!counted.length) return null;
  const versions = (await env.DB.prepare(`SELECT version, evidence_json FROM agent_skill_versions
      WHERE skill_id = ? AND evidence_json IS NOT NULL AND json_extract(evidence_json, '$.evidence_hash') = ? ORDER BY version DESC`)
    .bind(skillId, evidenceHash).all<{ version: number; evidence_json: string }>()).results ?? [];
  for (const v of versions) {
    let named: Set<number>;
    try {
      const m = JSON.parse(v.evidence_json) as { results?: { result_id?: unknown }[] };
      named = new Set((Array.isArray(m?.results) ? m.results : []).map((r) => r?.result_id).filter((id): id is number => typeof id === 'number'));
    } catch { continue; }
    const results = counted.filter((id) => named.has(id)).length;
    if (results > 0) return { version: v.version, results };
  }
  return null;
}

/** The decision and what the manifest is made from: the approval and the results it counted. */
export async function releaseEvidence(env: Env, s: { id: number; required_models_json?: string | null }, p: DraftParts) {
  const evidence = await evidenceOf(env, s, p);
  const approval = await approvalFor(env, s.id, evidence.evidence_hash);
  const last = approval ?? await env.DB.prepare("SELECT * FROM agent_skill_reviews WHERE skill_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1").bind(s.id).first<ReviewRow>();
  const sum = summarise(evidence, await latestResults(env, s.id, evidence.evidence_hash));
  const reused = await reusedFrom(env, s.id, evidence.evidence_hash, sum.rows.flatMap((c) => c.results.map((x) => x.result_id)));
  const blocking: Blocking[] = [];
  if (!approval) blocking.push('needs_approval');
  if (sum.not_evaluated > 0) blocking.push('evaluation_incomplete');
  if (!meetsBar(sum.pass, sum.total)) blocking.push('golden_cases_failing');
  const decision: ReleaseDecision = {
    ready: blocking.length === 0, blocking, evidence,
    review: {
      approved: !!approval, changes: last ? evidenceChanges(last.draft_hash, parseEvidence(last.evidence_json), evidence) : null,
      released_version: approval ? null : await releasedOn(env, s.id, evidence.evidence_hash),
    },
    evaluation: { pass: sum.pass, total: sum.total, not_evaluated: sum.not_evaluated, meets_bar: sum.meets_bar, pass_bar: PASS_BAR, reused },
  };
  return { decision, approval, cells: sum.rows };
}

export async function releaseDecision(env: Env, s: { id: number; required_models_json?: string | null }, p: DraftParts): Promise<ReleaseDecision> {
  return (await releaseEvidence(env, s, p)).decision;
}

export type PublishRefusal = { status: 409; code: Blocking; message: string; extra?: Record<string, unknown> };

/** Why a decision does not let the draft be published; null when it does. The first blocking reason answers. */
export function publishRefusalOf(d: ReleaseDecision): PublishRefusal | null {
  const freshness = d;
  const e = d.evaluation;
  switch (d.blocking[0]) {
    case undefined: return null;
    case 'needs_approval':
      return { status: 409, code: 'needs_approval', extra: { freshness },
        message: d.review.released_version != null
          ? `The approval of this draft already released v${d.review.released_version}. A new version needs a new review by a second Super Admin.`
          : 'A second Super Admin approves this draft, its golden cases, the evaluator and the required models before it is published. Request a review.' };
    case 'evaluation_incomplete':
      // A case with no result on a required model is never a pass, and never left out.
      return { status: 409, code: 'evaluation_incomplete', message: `${e.not_evaluated} of ${e.total} required golden-case runs have no result for this draft, its cases, the evaluator and the required models. Run the evals on every required model.`,
        extra: { not_evaluated: e.not_evaluated, total: e.total, freshness } };
    default:
      return { status: 409, code: 'golden_cases_failing', message: `This draft passes ${e.pass} of ${e.total} golden-case runs; publishing needs ${PASS_BAR.pass} of every ${PASS_BAR.of}. Re-run the evals or fix the skill.`,
        extra: { pass: e.pass, total: e.total, freshness } };
  }
}

/** Why an HQ skill's current draft may not be published; null when it may. */
export async function publishRefusal(env: Env, s: { id: number; required_models_json?: string | null }, p: DraftParts): Promise<PublishRefusal | null> {
  return publishRefusalOf(await releaseDecision(env, s, p));
}

/**
 * The release-evidence manifest an HQ version is published with (manifest 1):
 * the definition hash, the exact cases and suite revision, the evaluator
 * version, the required models, every case × model result it counted (by row
 * id) and the approval. Written in the same INSERT as the version row.
 */
export function manifestOf(r: Awaited<ReturnType<typeof releaseEvidence>>, version: number) {
  const { decision: d, approval, cells } = r;
  return {
    manifest: 1, version,
    definition_hash: d.evidence.definition_hash, evidence_hash: d.evidence.evidence_hash,
    suite: d.evidence.suite, evaluator_version: d.evidence.evaluator_version, models: d.evidence.models,
    results: cells.flatMap((c) => c.results.map((x) => ({ case_uid: c.uid, model: x.model, result: x.result, result_id: x.result_id }))),
    bar: { pass: d.evaluation.pass, total: d.evaluation.total, pass_bar: PASS_BAR },
    review: approval ? { review_id: approval.id, requested_by: approval.requested_by, reviewer_id: approval.reviewer_id, decided_at: approval.decided_at } : null,
  };
}

// ── Diff ────────────────────────────────────────────────────────────────────

export type StepChange = { op: 'same' | 'added' | 'removed'; text: string };

/** The steps from `a` to `b` as an ordered list of kept, added and removed lines (longest common subsequence). */
export function diffSteps(a: readonly string[], b: readonly string[]): StepChange[] {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: StepChange[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: 'same', text: a[i] }); i += 1; j += 1; }
    else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ op: 'removed', text: a[i] }); i += 1; }
    else { out.push({ op: 'added', text: b[j] }); j += 1; }
  }
  while (i < n) out.push({ op: 'removed', text: a[i++] });
  while (j < m) out.push({ op: 'added', text: b[j++] });
  return out;
}

/** The frontmatter fields that changed, each `{ field, from, to }`, and the steps. */
export function diffParts(a: DraftParts, b: DraftParts) {
  const fields = ['name', 'purpose', 'output_kind', 'tools', 'roles', 'tags'] as const;
  const frontmatter = fields
    .filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]))
    .map((f) => ({ field: f, from: a[f], to: b[f] }));
  return { frontmatter, steps: diffSteps(a.steps, b.steps) };
}

/**
 * D4533: the case suite, evaluator and required models from `a` to `b`, beside
 * `diffParts`. A side with no manifest (a version published before D4533)
 * recorded none of them, so its parts read null, never "unchanged".
 */
export function diffEvidence(a: Evidence | null, b: Evidence | null) {
  const caseRef = (k: SuiteCase) => ({ uid: k.uid, name: k.name });
  const less = <T>(x: readonly T[], y: readonly T[], key: (t: T) => string) => x.filter((t) => !y.some((u) => key(u) === key(t)));
  return {
    recorded: { from: !!a, to: !!b },
    cases: a && b ? {
      from: a.suite.revision, to: b.suite.revision,
      added: less(b.suite.cases, a.suite.cases, (k) => k.uid).map(caseRef),
      removed: less(a.suite.cases, b.suite.cases, (k) => k.uid).map(caseRef),
    } : null,
    models: a && b ? {
      from: a.models.required, to: b.models.required,
      added: less(b.models.required, a.models.required, String), removed: less(a.models.required, b.models.required, String),
    } : null,
    evaluator: { from: a?.evaluator_version ?? null, to: b?.evaluator_version ?? null },
  };
}

/** Live agents pinned to a skill. */
export async function pinnedAgents(env: Env, skillId: number): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM agent_skill_links l JOIN team_agents a ON a.id = l.agent_id
    WHERE l.skill_id = ? AND a.status <> 'removed'`).bind(skillId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

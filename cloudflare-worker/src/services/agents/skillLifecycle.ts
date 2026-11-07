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
 * THE PUBLISH GATE (`publishRefusal`), for an HQ skill only, in order:
 *   needs_approval         409: no approval on the current draft by a second Super Admin
 *   golden_cases_failing   409: below the bar, 9 of 10 (`PASS_BAR`), over every live
 *                          case on every model it was run on for this draft; a
 *                          case with no result on a model counts as not run, and
 *                          a skill with no case or no result is below the bar
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

export type CaseExpect = { output: OutputKind; must_include: string[]; must_say_not_recorded: string[]; must_not_include: string[] };
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
  if (!must.length && !nr.length && !not.length) return bad('Give the case at least one phrase it must or must not contain.');
  return { ok: true, name, input: { records }, expect: { output: e.output, must_include: must, must_say_not_recorded: nr, must_not_include: not } };
}

/** Whether an output meets a case's expectation; `detail` says the first miss. */
export function judge(expect: CaseExpect, output: string): { result: 'pass' | 'fail'; detail: string | null } {
  const text = output.toLowerCase();
  for (const w of expect.must_include) if (!text.includes(w.toLowerCase())) return { result: 'fail', detail: `It left out "${w}".` };
  for (const w of expect.must_say_not_recorded) {
    if (!text.includes(w.toLowerCase()) || !text.includes('not recorded')) return { result: 'fail', detail: `It did not say ${w} is not recorded.` };
  }
  for (const w of expect.must_not_include) if (text.includes(w.toLowerCase())) return { result: 'fail', detail: `It said "${w}", which it must not.` };
  return { result: 'pass', detail: null };
}

/** The run, behind a seam the tests replace; production is `aiRouter.run`. */
export const EVAL_DEPS: { run: (env: Env, opts: RunOptions) => Promise<RunResult> } = { run: aiRun };

/** One case on one model, through `run()`, charged to the admin who pressed Re-run (HQ). */
export async function runCase(env: Env, p: DraftParts, input: CaseInput, expect: CaseExpect, model: string, adminId: number):
  Promise<{ result: 'pass' | 'fail' | 'not_run'; detail: string | null; usage_log_id: number | null }> {
  const system = [
    `You are running the skill "${p.name}": ${p.purpose}`,
    `Propose ${expect.output === 'record_change' ? 'a record change' : `a ${expect.output}`}; a named person decides. Never invent a figure: say "Not recorded" for anything the records do not hold.`,
    'Steps:', ...p.steps.map((s, i) => `${i + 1}. ${s}`),
  ].join('\n');
  let r: RunResult;
  try {
    r = await EVAL_DEPS.run(env, {
      task: 'module_chat', model, pinned: true, userId: adminId, surface: '/hq/ai-agents', systemPrompt: system, maxTokens: 900, temperature: 0,
      messages: [{ role: 'user', content: `Records (made up, for a golden case):\n${JSON.stringify(input.records, null, 2)}` }],
    });
  } catch {
    return { result: 'not_run', detail: 'The run failed before the model answered.', usage_log_id: null };
  }
  if (!r.ok || typeof r.output !== 'string') return { result: 'not_run', detail: r.refusal ? `The run was refused: ${r.refusal}.` : 'The model gave no answer.', usage_log_id: r.usageLogId ?? null };
  return { ...judge(expect, r.output), usage_log_id: r.usageLogId ?? null };
}

/**
 * The latest result per live case and model for one draft, and the bar. A
 * model counts when any case was run on it for this draft; a case with no
 * result on such a model is `not_run`.
 */
export async function evalSummary(env: Env, skillId: number, hash: string) {
  const cases = ((await env.DB.prepare('SELECT id, uid, name FROM agent_skill_cases WHERE skill_id = ? AND removed_at IS NULL ORDER BY id')
    .bind(skillId).all<{ id: number; uid: string; name: string }>()).results ?? []);
  const latest = ((await env.DB.prepare(
    `SELECT r.case_id, r.model_id, r.result, r.detail, r.run_at FROM agent_skill_eval_results r
      WHERE r.skill_id = ? AND r.draft_hash = ?
        AND r.id = (SELECT MAX(x.id) FROM agent_skill_eval_results x WHERE x.case_id = r.case_id AND x.model_id = r.model_id AND x.draft_hash = r.draft_hash)`,
  ).bind(skillId, hash).all<{ case_id: number; model_id: string; result: 'pass' | 'fail' | 'not_run'; detail: string | null; run_at: string }>()).results ?? []);
  const models = [...new Set(latest.map((l) => l.model_id))].sort();
  const rows = cases.map((c) => ({
    uid: c.uid, name: c.name,
    results: models.map((m) => {
      const hit = latest.find((l) => l.case_id === c.id && l.model_id === m);
      return { model: m, result: hit?.result ?? 'not_run', detail: hit?.detail ?? null, run_at: hit?.run_at ?? null };
    }),
  }));
  const total = cases.length * models.length;
  const pass = rows.reduce((n, c) => n + c.results.filter((x) => x.result === 'pass').length, 0);
  const lastRun = latest.reduce<string | null>((a, l) => (!a || l.run_at > a ? l.run_at : a), null);
  return { cases: rows, models, pass, total, meets_bar: meetsBar(pass, total), last_run: lastRun };
}

/** 9 of 10: pass × 10 ≥ total × 9, and at least one result. */
export function meetsBar(pass: number, total: number): boolean {
  return total > 0 && pass * PASS_BAR.of >= total * PASS_BAR.pass;
}

// ── Review ──────────────────────────────────────────────────────────────────

export type ReviewRow = {
  id: number; skill_id: number; draft_hash: string; requested_by: number; reviewer_id: number;
  status: 'requested' | 'approved' | 'changes_requested' | 'withdrawn'; comment: string | null; requested_at: string; decided_at: string | null;
};

export async function openReview(env: Env, skillId: number): Promise<ReviewRow | null> {
  return env.DB.prepare("SELECT * FROM agent_skill_reviews WHERE skill_id = ? AND status = 'requested'").bind(skillId).first<ReviewRow>();
}

export async function approvalFor(env: Env, skillId: number, hash: string): Promise<ReviewRow | null> {
  return env.DB.prepare("SELECT * FROM agent_skill_reviews WHERE skill_id = ? AND draft_hash = ? AND status = 'approved' ORDER BY id DESC LIMIT 1")
    .bind(skillId, hash).first<ReviewRow>();
}

/** The four states: a draft with an open review on its current text is `in_review`. */
export function lifecycleStatus(status: 'draft' | 'published' | 'retired', open: Pick<ReviewRow, 'draft_hash'> | null, hash: string): 'draft' | 'in_review' | 'published' | 'retired' {
  if (status === 'retired') return 'retired';
  if (open && open.draft_hash === hash) return 'in_review';
  return status;
}

export type PublishRefusal = { status: 409; code: 'needs_approval' | 'golden_cases_failing'; message: string; extra?: Record<string, unknown> };

/** Why an HQ skill's current draft may not be published; null when it may. */
export async function publishRefusal(env: Env, skillId: number, p: DraftParts): Promise<PublishRefusal | null> {
  const hash = await draftHash(p);
  if (!(await approvalFor(env, skillId, hash))) {
    return { status: 409, code: 'needs_approval', message: 'A second Super Admin approves this draft before it is published. Request a review.' };
  }
  const s = await evalSummary(env, skillId, hash);
  if (!s.meets_bar) {
    return { status: 409, code: 'golden_cases_failing', message: `This draft passes ${s.pass} of ${s.total} golden-case runs; publishing needs ${PASS_BAR.pass} of every ${PASS_BAR.of}. Re-run the evals or fix the skill.`,
      extra: { pass: s.pass, total: s.total } };
  }
  return null;
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

/** Live agents pinned to a skill. */
export async function pinnedAgents(env: Env, skillId: number): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM agent_skill_links l JOIN team_agents a ON a.id = l.agent_id
    WHERE l.skill_id = ? AND a.status <> 'removed'`).bind(skillId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

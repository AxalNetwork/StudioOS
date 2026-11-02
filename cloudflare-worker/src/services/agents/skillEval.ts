/**
 * D1612 part D (#3954, of #3945) — a skill on the agent run path, and the
 * golden cases of Axal's published skills on the evaluation board.
 *
 * ON THE RUN PATH (`skillForRun`, called by `agentRun`). A run that names a
 * skill uses the version PINNED on the agent (`agent_skill_links.version`),
 * never the skill's latest. Before the model sees anything, in order:
 *   skill_not_attached   422  the agent has no link to that skill
 *   skill_unavailable    409  the pinned version cannot be read
 *   skill_suspended      409  HQ suspended it (D4161, `skillRunRefusal`)
 *   tool_not_approved    422  a tool the version uses is no longer in the
 *                             agent's grants (the same code as A2's attach gate)
 *   tool_not_in_skill    422  a read the sponsor named is not in the version's
 *                             tool allow-list
 * The version's SKILL.md steps and its allow-list go into the system prompt
 * (`skillPrompt`). After the run, the usage row (and its guard rows) carry
 * `skill_id` and `skill_version` (migration 202611022313), so consumption reads
 * per skill.
 *
 * ON THE BOARD (`evaluatePublished`, `skillBoard`). Each published Axal skill
 * runs its golden cases on its CURRENT version: the case shipped with it
 * (`skills/cases/<slug>.json`, key `starter`) and every live case HQ added
 * (`agent_skill_cases`, key = its uid). Each result is one row of
 * `agent_skill_version_evals`. A case whose latest earlier result on a model
 * was `pass` and is now `fail` is a REGRESSION: HQ is told once per skill,
 * version, case and model (`tellHq`). A case that could not run (`not_run`)
 * is never a regression and never a pass.
 *
 * Every run goes through `skillLifecycle.runCase`, through `run()`, charged to
 * the admin who pressed Run. Neither prompts nor outputs are stored.
 */
import type { Env } from '../../types';
import { checkCase, runCase, type CaseExpect, type CaseInput, type DraftParts } from './skillLifecycle';
import { missingTools, type OutputKind } from './skills';
import { versionOf, versionTools, toolLabel, type SkillRow, type VersionRow } from './skillLinks';
import { skillRunRefusal } from './skillModeration';
import { grantsOf } from './agentTools';
import type { tellHq } from './alerts';
import type { AgentRow } from './teams';

import approvalsQueueTriage from './skills/cases/approvals-queue-triage.json';
import boardMeetingBrief from './skills/cases/board-meeting-brief.json';
import competitorWatchSummary from './skills/cases/competitor-watch-summary.json';
import customerFollowUpDraft from './skills/cases/customer-follow-up-draft.json';
import customerInterviewSummary from './skills/cases/customer-interview-summary.json';
import dataRoomDocumentSummary from './skills/cases/data-room-document-summary.json';
import deckClaimsCheck from './skills/cases/deck-claims-check.json';
import dueDiligenceRequestList from './skills/cases/due-diligence-request-list.json';
import jobPostDraft from './skills/cases/job-post-draft.json';
import monthlyInvestorUpdate from './skills/cases/monthly-investor-update.json';
import preMeetingInvestorBrief from './skills/cases/pre-meeting-investor-brief.json';
import weeklyKpiDigest from './skills/cases/weekly-kpi-digest.json';

export const STARTER_KEY = 'starter';
/** The most Axal skills one press evaluates; the rest wait for the next. */
export const SKILLS_PER_RUN = 20;
const REGRESSION_ALERT_TTL = 90 * 86_400;

type StarterFile = { skill: string; version?: number; note?: string; input: unknown; expect: unknown };
const STARTER_FILES: StarterFile[] = [
  approvalsQueueTriage, boardMeetingBrief, competitorWatchSummary, customerFollowUpDraft, customerInterviewSummary, dataRoomDocumentSummary,
  deckClaimsCheck, dueDiligenceRequestList, jobPostDraft, monthlyInvestorUpdate, preMeetingInvestorBrief, weeklyKpiDigest,
] as StarterFile[];

export type GoldenCase = { key: string; name: string; input: CaseInput; expect: CaseExpect };

/** The case shipped with a starter skill, by its slug; null when none is, or it does not pass `checkCase`. */
export function starterCase(slug: string): GoldenCase | null {
  const f = STARTER_FILES.find((x) => x.skill === slug);
  if (!f) return null;
  const c = checkCase({ name: `Starter case: ${slug}`, input: f.input, expect: f.expect });
  return c.ok ? { key: STARTER_KEY, name: c.name, input: c.input, expect: c.expect } : null;
}
export const starterSlugs = (): string[] => STARTER_FILES.map((f) => f.skill);

const parse = <T>(json: string | null | undefined, fallback: T): T => { try { const v = JSON.parse(json ?? ''); return v ?? fallback; } catch { return fallback; } };

/** A published version as the parts a case runs on. */
export function versionParts(v: VersionRow): DraftParts {
  return {
    name: v.name, purpose: v.purpose, steps: parse<string[]>(v.steps_json, []), tools: versionTools(v),
    output_kind: v.output_kind as OutputKind, tags: [], roles: parse<string[]>(v.roles_json, []),
  };
}

// ── The run path ────────────────────────────────────────────────────────────

export type SkillRefusal = { ok: false; status: number; code: string; message: string; extra?: Record<string, unknown> };
export type SkillForRun = { ok: true; skill: SkillRow; version: VersionRow; tools: string[] } | SkillRefusal;
const no = (status: number, code: string, message: string, extra?: Record<string, unknown>): SkillRefusal => ({ ok: false, status, code, message, ...(extra ? { extra } : {}) });

/** The pinned version of the skill `uid` for this agent, gated; see the header for the order. */
export async function skillForRun(env: Env, a: Pick<AgentRow, 'id' | 'tool_grants_json'>, uid: unknown, readTools: readonly string[]): Promise<SkillForRun> {
  const s = typeof uid === 'string' && /^[a-f0-9]{32}$/.test(uid)
    ? await env.DB.prepare('SELECT * FROM agent_skills WHERE uid = ?').bind(uid).first<SkillRow>() : null;
  const link = s ? await env.DB.prepare('SELECT version FROM agent_skill_links WHERE agent_id = ? AND skill_id = ?').bind(a.id, s.id).first<{ version: number }>() : null;
  if (!s || !link) return no(422, 'skill_not_attached', 'This agent does not have that skill. Add it on the agent first.');
  const v = await versionOf(env, s.id, Number(link.version));
  if (!v) return no(409, 'skill_unavailable', 'The version of this skill the agent uses could not be read, so it was not run.');
  const suspended = await skillRunRefusal(env, s.id, Number(link.version));
  if (suspended) return no(409, suspended.code, suspended.message);
  const tools = versionTools(v);
  const missing = missingTools(tools, grantsOf(a.tool_grants_json));
  if (missing.length) {
    return no(422, 'tool_not_approved', `This skill needs ${toolLabel(missing[0])}, which this agent's sponsor no longer approves.`, { tool: { key: missing[0], label: toolLabel(missing[0]) } });
  }
  const outside = readTools.find((t) => !tools.includes(t));
  if (outside) return no(422, 'tool_not_in_skill', `This skill does not use ${toolLabel(outside)}. Name only the reads it lists.`, { tool: { key: outside, label: toolLabel(outside) } });
  return { ok: true, skill: s, version: v, tools };
}

/** The skill's part of the system prompt: the pinned version's steps and its allow-list. */
export function skillPrompt(v: VersionRow): string {
  const p = versionParts(v);
  return [
    `You are using the skill "${p.name}" (version ${v.version}): ${p.purpose}`,
    `It proposes ${p.output_kind === 'record_change' ? 'a record change' : `a ${p.output_kind}`}; a named person decides.`,
    'Follow its steps:', ...p.steps.map((s, i) => `${i + 1}. ${s}`),
    p.tools.length ? `It may read only: ${p.tools.join(', ')}.` : 'It reads nothing beyond what you are given.',
    'Never invent a figure: write "Not recorded" for anything the records do not hold.',
  ].join('\n');
}

/** Name the skill on the run's usage row and its guard rows. A failed write never fails the run. */
export async function tagUsage(env: Env, usageLogId: number | null, skillId: number, version: number): Promise<void> {
  if (!usageLogId) return;
  try {
    await env.DB.prepare('UPDATE ai_usage_logs SET skill_id = ?, skill_version = ? WHERE id = ? OR guard_for = ?').bind(skillId, version, usageLogId, usageLogId).run();
  } catch { console.warn('[agents] skill usage tag not written'); }
}

/** The skill a usage row names, for the run detail; null when none, or unreadable. */
export async function skillOfUsage(env: Env, usageLogId: number | null): Promise<{ uid: string; name: string; version: number } | null> {
  if (!usageLogId) return null;
  try {
    const r = await env.DB.prepare(
      `SELECT s.uid, v.name, l.skill_version AS version FROM ai_usage_logs l
         JOIN agent_skills s ON s.id = l.skill_id
         LEFT JOIN agent_skill_versions v ON v.skill_id = l.skill_id AND v.version = l.skill_version
        WHERE l.id = ? AND l.skill_id IS NOT NULL`,
    ).bind(usageLogId).first<{ uid: string; name: string | null; version: number }>();
    return r ? { uid: r.uid, name: r.name ?? 'Not recorded', version: Number(r.version) } : null;
  } catch { return null; }
}

// ── The board ───────────────────────────────────────────────────────────────

/** The golden cases of a published Axal skill: its starter case, then HQ's live ones. */
export async function casesOf(env: Env, s: Pick<SkillRow, 'id' | 'slug'>): Promise<GoldenCase[]> {
  const out: GoldenCase[] = [];
  const starter = starterCase(s.slug);
  if (starter) out.push(starter);
  const rows = (await env.DB.prepare('SELECT uid, name, input_json, expect_json FROM agent_skill_cases WHERE skill_id = ? AND removed_at IS NULL ORDER BY id')
    .bind(s.id).all<{ uid: string; name: string; input_json: string; expect_json: string }>()).results ?? [];
  for (const r of rows) {
    const c = checkCase({ name: r.name, input: parse(r.input_json, null), expect: parse(r.expect_json, null) });
    if (c.ok) out.push({ key: r.uid, name: c.name, input: c.input, expect: c.expect });
  }
  return out;
}

export type Regression = { skill_uid: string; skill: string; version: number; case: string; model: string; detail: string | null };
export type EvalDeps = { runCase: typeof runCase; tellHq: typeof tellHq };

/**
 * Run every golden case of each published Axal skill (at most `SKILLS_PER_RUN`)
 * on `models`, on its current version; record each result; tell HQ of each
 * regression once.
 */
export async function evaluatePublished(env: Env, adminId: number, models: string[], deps: Partial<EvalDeps> = {}, onlySkillId: number | null = null):
  Promise<{ skills: number; results: number; regressions: Regression[] }> {
  // `alerts.ts` reaches the engine, which reaches `agentRun`, which imports this file: loaded when used.
  const alerts = await import('./alerts');
  const d: EvalDeps = { runCase, tellHq: alerts.tellHq, ...deps };
  const skills = (await env.DB.prepare(
    `SELECT * FROM agent_skills WHERE scope = 'hq' AND status = 'published' AND current_version >= 1 AND (? IS NULL OR id = ?) ORDER BY id LIMIT ?`,
  ).bind(onlySkillId, onlySkillId, SKILLS_PER_RUN).all<SkillRow>()).results ?? [];
  const regressions: Regression[] = [];
  let results = 0;
  for (const s of skills) {
    const v = await versionOf(env, s.id, s.current_version);
    if (!v) continue;
    const parts = versionParts(v);
    for (const c of await casesOf(env, s)) {
      for (const model of models) {
        const before = await env.DB.prepare(
          'SELECT result FROM agent_skill_version_evals WHERE skill_id = ? AND case_key = ? AND model_id = ? AND result <> ? ORDER BY id DESC LIMIT 1',
        ).bind(s.id, c.key, model, 'not_run').first<{ result: 'pass' | 'fail' }>();
        const r = await d.runCase(env, parts, c.input, c.expect, model, adminId);
        await env.DB.prepare(
          `INSERT INTO agent_skill_version_evals (skill_id, version, case_key, case_name, model_id, result, detail, usage_log_id, run_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(s.id, v.version, c.key, c.name, model, r.result, r.detail, r.usage_log_id, adminId).run();
        results += 1;
        if (before?.result === 'pass' && r.result === 'fail') {
          const reg: Regression = { skill_uid: s.uid, skill: s.name, version: v.version, case: c.name, model, detail: r.detail };
          regressions.push(reg);
          if (await alerts.firstInWindow(env, `agents:alert:skill_regressed:${s.id}:${v.version}:${c.key}:${model}`, REGRESSION_ALERT_TTL)) {
            await d.tellHq(env, {
              type: 'agent_skill_regressed',
              title: `${s.name} failed a golden case it used to pass`,
              body: `${c.name} on ${model}, version ${v.version}: ${r.detail ?? 'It no longer meets the case.'}`,
              link: `/hq/ai-agents/skills/${s.uid}/edit`,
            });
          }
        }
      }
    }
  }
  return { skills: skills.length, results, regressions };
}

export type SkillBoardRow = {
  skill_uid: string; name: string; version: number;
  /** Over the latest result per case and model on this version; `total` 0 means it was never run. */
  pass: number; total: number; not_run: number;
  regressed: Array<{ case: string; model: string }>;
  last_run: string | null;
};

/**
 * The board's skill rows: for each skill id, its current version's latest
 * result per case and model. A case that regressed is one whose latest result
 * is `fail` and that passed before on this version; it stays regressed until it
 * passes again. (HQ is told once, when it first turns from pass to fail.)
 */
export async function skillBoard(env: Env, skillIds: number[]): Promise<SkillBoardRow[]> {
  if (!skillIds.length) return [];
  const skills = (await env.DB.prepare(
    'SELECT id, uid, name, current_version FROM agent_skills WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) ORDER BY name, id',
  ).bind(JSON.stringify(skillIds)).all<{ id: number; uid: string; name: string; current_version: number }>()).results ?? [];
  const out: SkillBoardRow[] = [];
  for (const s of skills) {
    const rows = (await env.DB.prepare(
      'SELECT id, version, case_key, case_name, model_id, result, run_at FROM agent_skill_version_evals WHERE skill_id = ? ORDER BY id DESC LIMIT 2000',
    ).bind(s.id).all<{ id: number; version: number; case_key: string; case_name: string; model_id: string; result: 'pass' | 'fail' | 'not_run'; run_at: string }>()).results ?? [];
    const latest = new Map<string, typeof rows[number]>();
    for (const r of rows) if (r.version === s.current_version && !latest.has(`${r.case_key}|${r.model_id}`)) latest.set(`${r.case_key}|${r.model_id}`, r);
    const regressed: Array<{ case: string; model: string }> = [];
    for (const [k, r] of latest) {
      if (r.result !== 'fail') continue;
      // It stays regressed until it passes again: its latest result fails and it passed before on this version.
      if (rows.some((x) => `${x.case_key}|${x.model_id}` === k && x.id < r.id && x.version === s.current_version && x.result === 'pass')) {
        regressed.push({ case: r.case_name, model: r.model_id });
      }
    }
    const vals = [...latest.values()];
    out.push({
      skill_uid: s.uid, name: s.name, version: s.current_version,
      pass: vals.filter((r) => r.result === 'pass').length, total: vals.length, not_run: vals.filter((r) => r.result === 'not_run').length,
      regressed, last_run: vals.reduce<string | null>((a, r) => (!a || r.run_at > a ? r.run_at : a), null),
    });
  }
  return out;
}

/** The Axal skills pinned on a scope's agents, for the scope's board. */
export async function scopeSkillIds(env: Env, scope: { kind: 'company' | 'project'; id: number }): Promise<number[]> {
  const rows = (await env.DB.prepare(
    `SELECT DISTINCT l.skill_id FROM agent_skill_links l JOIN team_agents a ON a.id = l.agent_id JOIN agent_skills s ON s.id = l.skill_id
      WHERE a.scope_kind = ? AND (CASE a.scope_kind WHEN 'company' THEN a.company_id ELSE a.project_id END) = ? AND a.status != 'removed' AND s.scope = 'hq'`,
  ).bind(scope.kind, scope.id).all<{ skill_id: number }>()).results ?? [];
  return rows.map((r) => Number(r.skill_id));
}

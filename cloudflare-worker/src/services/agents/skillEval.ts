/**
 * D1612 part D (#3954, of #3945) — a skill on the agent run path, and the
 * golden cases of Axal's published skills on the evaluation board.
 *
 * ON THE RUN PATH (`skillForRun`, called by `agentRun`). A run that names a
 * skill uses the version PINNED on the agent (`agent_skill_links.version`),
 * never the skill's latest. Before the model sees anything, in order:
 *   skill_not_attached   422  the agent has no link to that skill
 *   skill_version_changed 409 the caller saved another version than the one
 *                             pinned now (D4534: a scheduled session)
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
export async function skillForRun(env: Env, a: Pick<AgentRow, 'id' | 'tool_grants_json'>, uid: unknown, readTools: readonly string[], expectedVersion: number | null = null): Promise<SkillForRun> {
  const s = typeof uid === 'string' && /^[a-f0-9]{32}$/.test(uid)
    ? await env.DB.prepare('SELECT * FROM agent_skills WHERE uid = ?').bind(uid).first<SkillRow>() : null;
  const link = s ? await env.DB.prepare('SELECT version FROM agent_skill_links WHERE agent_id = ? AND skill_id = ?').bind(a.id, s.id).first<{ version: number }>() : null;
  if (!s || !link) return no(422, 'skill_not_attached', 'This agent does not have that skill. Add it on the agent first.');
  // D4534: a run saved for one version (a scheduled session) never runs another the agent was re-pinned to since.
  if (expectedVersion != null && Number(link.version) !== expectedVersion) {
    return no(409, 'skill_version_changed', `This was saved for version ${expectedVersion} of the skill, and the agent now uses version ${Number(link.version)}. Review it and save it again.`,
      { saved_version: expectedVersion, pinned_version: Number(link.version) });
  }
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

type Alerts = typeof import('./alerts');
type Done = { results: number; regressions: Regression[]; cases: Array<{ key: string; name: string }> };
/** Writes one result; a campaign writes its item in the same batch, so the two stand or fall together. */
type Record_ = (s: SkillRow, v: VersionRow, c: GoldenCase, model: string, r: { result: string; detail: string | null; usage_log_id: number | null }) => Promise<void>;

/**
 * Every golden case of one skill's version `v` on `models`: record each result,
 * tell HQ of each regression once. `skip` names the case|model units already
 * done (a resumed campaign), which are neither run nor charged again.
 */
async function evaluateSkill(env: Env, s: SkillRow, v: VersionRow, models: string[], adminId: number, d: EvalDeps, alerts: Alerts,
  record: Record_, skip: Set<string> = new Set()): Promise<Done> {
  const parts = versionParts(v);
  const out: Done = { results: 0, regressions: [], cases: [] };
  for (const c of await casesOf(env, s)) {
    out.cases.push({ key: c.key, name: c.name });
    for (const model of models) {
      if (skip.has(`${c.key}|${model}`)) continue;
      const before = await env.DB.prepare(
        'SELECT result FROM agent_skill_version_evals WHERE skill_id = ? AND case_key = ? AND model_id = ? AND result <> ? ORDER BY id DESC LIMIT 1',
      ).bind(s.id, c.key, model, 'not_run').first<{ result: 'pass' | 'fail' }>();
      const r = await d.runCase(env, parts, c.input, c.expect, model, adminId);
      await record(s, v, c, model, r);
      out.results += 1;
      if (before?.result === 'pass' && r.result === 'fail') {
        const reg: Regression = { skill_uid: s.uid, skill: s.name, version: v.version, case: c.name, model, detail: r.detail };
        out.regressions.push(reg);
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
  return out;
}

const EVAL_INSERT = `INSERT INTO agent_skill_version_evals (skill_id, version, case_key, case_name, model_id, result, detail, usage_log_id, run_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Run every golden case of each published Axal skill (at most `SKILLS_PER_RUN`)
 * on `models`, on its current version; record each result; tell HQ of each
 * regression once. With `onlySkillId`, that one skill. A global evaluation that
 * must reach every skill is a campaign (`startCampaign`, `continueCampaign`).
 */
export async function evaluatePublished(env: Env, adminId: number, models: string[], deps: Partial<EvalDeps> = {}, onlySkillId: number | null = null):
  Promise<{ skills: number; results: number; regressions: Regression[] }> {
  // `alerts.ts` reaches the engine, which reaches `agentRun`, which imports this file: loaded when used.
  const alerts = await import('./alerts');
  const d: EvalDeps = { runCase, tellHq: alerts.tellHq, ...deps };
  const skills = (await env.DB.prepare(
    `SELECT * FROM agent_skills WHERE scope = 'hq' AND status = 'published' AND current_version >= 1 AND (? IS NULL OR id = ?) ORDER BY id LIMIT ?`,
  ).bind(onlySkillId, onlySkillId, SKILLS_PER_RUN).all<SkillRow>()).results ?? [];
  const record: Record_ = async (s, v, c, model, r) => {
    await env.DB.prepare(EVAL_INSERT).bind(s.id, v.version, c.key, c.name, model, r.result, r.detail, r.usage_log_id, adminId).run();
  };
  const regressions: Regression[] = [];
  let results = 0;
  for (const s of skills) {
    const v = await versionOf(env, s.id, s.current_version);
    if (!v) continue;
    const done = await evaluateSkill(env, s, v, models, adminId, d, alerts, record);
    results += done.results;
    regressions.push(...done.regressions);
  }
  return { skills: skills.length, results, regressions };
}

// ── Campaigns (D4668, #4668) ────────────────────────────────────────────────
//
// A campaign is a global evaluation that reaches every eligible skill, a batch
// of at most SKILLS_PER_RUN per press. Its MANIFEST is written when it starts:
// each published Axal skill at the version it had then, in id order. When a
// skill's turn comes it is checked again: still published, an Axal skill, not
// suspended (`not_eligible`), still at that version (`version_changed`; the
// campaign never evaluates a version it did not start with), and readable
// (`version_unreadable`). A skipped skill is listed with its reason, never run.
// Skills published after the start are not in it: the next campaign takes them.
// The case suite is a skill's live cases when its turn comes, and the items
// name each case run. The models are the campaign's, fixed at the start.
//
// Each skill, version, case and model is one ITEM, written in the same batch as
// its result: a resumed press skips the items it finds, so done work is never
// run or charged twice in a campaign; a new attempt is a new campaign. A press
// holds a short lease, so two never run one batch at once. A batch that stops
// part-way (an error, a cancel between skills) leaves its skill pending, and
// the next press runs only what is missing. Cancelled is final.

export const CAMPAIGN_LEASE_MS = 15 * 60_000;
export type CampaignStatus = 'running' | 'complete' | 'cancelled';
type CampaignRow = { id: number; uid: string; models_json: string; status: CampaignStatus; started_at: string; finished_at: string | null; lease_until: string | null };
export type CampaignProgress = {
  uid: string; status: CampaignStatus; models: string[]; started_at: string; finished_at: string | null;
  /** Skills in the manifest, and how many are done, skipped and still pending. */
  total: number; done: number; skipped: number; pending: number;
  /** Over the results this campaign recorded. */
  results: { pass: number; fail: number; not_run: number };
  skipped_skills: Array<{ skill_uid: string; version: number; reason: string }>;
};
export type CampaignBatch = {
  skills: number; results: number; regressions: Regression[];
  /** What this press ran: each skill at its version, the cases and the models. */
  evaluated: Array<{ skill_uid: string; name: string; version: number; cases: Array<{ key: string; name: string }>; models: string[]; results: number }>;
  campaign: CampaignProgress;
};
export type CampaignRefusal = { ok: false; status: number; code: string; message: string; campaign?: CampaignProgress };

const campaignByUid = (env: Env, uid: unknown) => typeof uid === 'string' && /^[a-f0-9]{32}$/.test(uid)
  ? env.DB.prepare('SELECT * FROM agent_skill_eval_campaigns WHERE uid = ?').bind(uid).first<CampaignRow>() : Promise.resolve(null);

/** A campaign's progress; null when there is no campaign `uid`. */
export async function campaignProgress(env: Env, uid: unknown): Promise<CampaignProgress | null> {
  const c = await campaignByUid(env, uid);
  return c ? progressOf(env, c) : null;
}

async function progressOf(env: Env, c: CampaignRow): Promise<CampaignProgress> {
  const states = (await env.DB.prepare('SELECT state, COUNT(*) AS n FROM agent_skill_eval_campaign_skills WHERE campaign_id = ? GROUP BY state')
    .bind(c.id).all<{ state: string; n: number }>()).results ?? [];
  const n = (k: string) => Number(states.find((r) => r.state === k)?.n ?? 0);
  const res = (await env.DB.prepare(
    'SELECT e.result, COUNT(*) AS n FROM agent_skill_eval_campaign_items i JOIN agent_skill_version_evals e ON e.id = i.eval_id WHERE i.campaign_id = ? GROUP BY e.result',
  ).bind(c.id).all<{ result: string; n: number }>()).results ?? [];
  const r = (k: string) => Number(res.find((x) => x.result === k)?.n ?? 0);
  const skipped = (await env.DB.prepare(
    `SELECT s.uid, m.version, m.skip_reason FROM agent_skill_eval_campaign_skills m JOIN agent_skills s ON s.id = m.skill_id
      WHERE m.campaign_id = ? AND m.state = 'skipped' ORDER BY m.skill_id`,
  ).bind(c.id).all<{ uid: string; version: number; skip_reason: string }>()).results ?? [];
  return {
    uid: c.uid, status: c.status, models: parse<string[]>(c.models_json, []), started_at: c.started_at, finished_at: c.finished_at,
    total: n('pending') + n('done') + n('skipped'), done: n('done'), skipped: n('skipped'), pending: n('pending'),
    results: { pass: r('pass'), fail: r('fail'), not_run: r('not_run') },
    skipped_skills: skipped.map((x) => ({ skill_uid: x.uid, version: Number(x.version), reason: x.skip_reason })),
  };
}

/** Start a campaign on `models`: its manifest is every eligible published Axal skill, now, at its current version. */
export async function startCampaign(env: Env, adminId: number, models: string[], uid: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO agent_skill_eval_campaigns (uid, models_json, started_by) VALUES (?, ?, ?)').bind(uid, JSON.stringify(models), adminId),
    env.DB.prepare(
      `INSERT INTO agent_skill_eval_campaign_skills (campaign_id, skill_id, version)
       SELECT (SELECT id FROM agent_skill_eval_campaigns WHERE uid = ?), id, current_version
         FROM agent_skills WHERE scope = 'hq' AND status = 'published' AND current_version >= 1 ORDER BY id`,
    ).bind(uid),
  ]);
}

/**
 * The campaign's next batch: at most SKILLS_PER_RUN pending skills, each checked
 * again and run on the campaign's models; then its progress. A campaign that
 * has nothing pending is complete.
 */
export async function continueCampaign(env: Env, adminId: number, uid: unknown, now: Date, deps: Partial<EvalDeps> = {}):
  Promise<({ ok: true } & CampaignBatch) | CampaignRefusal> {
  const c = await campaignByUid(env, uid);
  if (!c) return { ok: false, status: 404, code: 'campaign_not_found', message: 'There is no such evaluation campaign.' };
  if (c.status === 'cancelled') return { ok: false, status: 409, code: 'campaign_cancelled', message: 'This evaluation campaign was cancelled. Start a new one.', campaign: await progressOf(env, c) };
  const empty = { skills: 0, results: 0, regressions: [], evaluated: [] };
  if (c.status === 'complete') return { ok: true, ...empty, campaign: await progressOf(env, c) };
  const iso = now.toISOString();
  const lease = await env.DB.prepare(
    `UPDATE agent_skill_eval_campaigns SET lease_until = ? WHERE id = ? AND status = 'running' AND (lease_until IS NULL OR lease_until <= ?)`,
  ).bind(new Date(now.getTime() + CAMPAIGN_LEASE_MS).toISOString(), c.id, iso).run();
  if (!lease.meta?.changes) return { ok: false, status: 409, code: 'campaign_busy', message: 'Another press is running this campaign\'s next batch. Try again when it finishes.', campaign: await progressOf(env, c) };

  const alerts = await import('./alerts');
  const d: EvalDeps = { runCase, tellHq: alerts.tellHq, ...deps };
  const models = parse<string[]>(c.models_json, []);
  const batch: CampaignBatch = { ...empty, regressions: [], evaluated: [], campaign: null as unknown as CampaignProgress };
  const record: Record_ = async (s, v, k, model, r) => {
    await env.DB.batch([
      env.DB.prepare(EVAL_INSERT).bind(s.id, v.version, k.key, k.name, model, r.result, r.detail, r.usage_log_id, adminId),
      env.DB.prepare(`INSERT INTO agent_skill_eval_campaign_items (campaign_id, skill_id, version, case_key, model_id, eval_id)
        VALUES (?, ?, ?, ?, ?, last_insert_rowid())`).bind(c.id, s.id, v.version, k.key, model),
    ]);
  };
  const settle = (skillId: number, state: 'done' | 'skipped', reason: string | null) => env.DB.prepare(
    `UPDATE agent_skill_eval_campaign_skills SET state = ?, skip_reason = ?, finished_at = ? WHERE campaign_id = ? AND skill_id = ? AND state = 'pending'`,
  ).bind(state, reason, iso, c.id, skillId).run();
  try {
    const next = (await env.DB.prepare(
      `SELECT skill_id, version FROM agent_skill_eval_campaign_skills WHERE campaign_id = ? AND state = 'pending' ORDER BY skill_id LIMIT ?`,
    ).bind(c.id, SKILLS_PER_RUN).all<{ skill_id: number; version: number }>()).results ?? [];
    for (const m of next) {
      // A cancel between skills stops the batch; the skill it reached stays pending.
      const live = await env.DB.prepare('SELECT status FROM agent_skill_eval_campaigns WHERE id = ?').bind(c.id).first<{ status: CampaignStatus }>();
      if (live?.status !== 'running') break;
      const version = Number(m.version);
      const s = await env.DB.prepare('SELECT * FROM agent_skills WHERE id = ?').bind(m.skill_id).first<SkillRow>();
      if (!s || s.scope !== 'hq' || s.status !== 'published' || await skillRunRefusal(env, s.id, version)) { await settle(m.skill_id, 'skipped', 'not_eligible'); continue; }
      if (Number(s.current_version) !== version) { await settle(m.skill_id, 'skipped', 'version_changed'); continue; }
      const v = await versionOf(env, s.id, version);
      if (!v) { await settle(m.skill_id, 'skipped', 'version_unreadable'); continue; }
      const had = (await env.DB.prepare('SELECT case_key, model_id FROM agent_skill_eval_campaign_items WHERE campaign_id = ? AND skill_id = ? AND version = ?')
        .bind(c.id, s.id, version).all<{ case_key: string; model_id: string }>()).results ?? [];
      const done = await evaluateSkill(env, s, v, models, adminId, d, alerts, record, new Set(had.map((x) => `${x.case_key}|${x.model_id}`)));
      await settle(s.id, 'done', null);
      batch.skills += 1;
      batch.results += done.results;
      batch.regressions.push(...done.regressions);
      batch.evaluated.push({ skill_uid: s.uid, name: s.name, version, cases: done.cases, models, results: done.results });
    }
    await env.DB.prepare(
      `UPDATE agent_skill_eval_campaigns SET status = 'complete', finished_at = ?
        WHERE id = ? AND status = 'running' AND NOT EXISTS (SELECT 1 FROM agent_skill_eval_campaign_skills WHERE campaign_id = ? AND state = 'pending')`,
    ).bind(iso, c.id, c.id).run();
  } finally {
    await env.DB.prepare('UPDATE agent_skill_eval_campaigns SET lease_until = NULL WHERE id = ?').bind(c.id).run();
  }
  const after = await env.DB.prepare('SELECT * FROM agent_skill_eval_campaigns WHERE id = ?').bind(c.id).first<CampaignRow>();
  batch.campaign = await progressOf(env, after ?? c);
  return { ok: true, ...batch };
}

/** Cancel a running campaign: final; what it ran stays recorded. Cancelling a cancelled one changes nothing. */
export async function cancelCampaign(env: Env, adminId: number, uid: unknown, now: Date): Promise<{ ok: true; campaign: CampaignProgress } | CampaignRefusal> {
  const c = await campaignByUid(env, uid);
  if (!c) return { ok: false, status: 404, code: 'campaign_not_found', message: 'There is no such evaluation campaign.' };
  if (c.status === 'complete') return { ok: false, status: 409, code: 'campaign_complete', message: 'This evaluation campaign already finished, so there is nothing to cancel.', campaign: await progressOf(env, c) };
  await env.DB.prepare(`UPDATE agent_skill_eval_campaigns SET status = 'cancelled', finished_at = ?, cancelled_by = ? WHERE id = ? AND status = 'running'`)
    .bind(now.toISOString(), adminId, c.id).run();
  const after = await env.DB.prepare('SELECT * FROM agent_skill_eval_campaigns WHERE id = ?').bind(c.id).first<CampaignRow>();
  return { ok: true, campaign: await progressOf(env, after ?? c) };
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

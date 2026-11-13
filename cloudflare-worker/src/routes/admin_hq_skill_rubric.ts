/**
 * D4531 part 5 (#4531, section C) — HQ › AI agents › the model-judged rubric, on synthetic golden
 * cases only. Mounts itself at `/api/admin/ai-agents/skill-rubric`. Super Admin only, like
 * `admin_hq_skills.ts`. See `services/agents/skillRubric.ts` for the rubric, the judge, the $25
 * monthly cap and the gate rule.
 *
 *   GET  /                      the rubric, the judge, this month's spend against the cap, the
 *                               calibration agreement and the gate → { rubric, judge, cap, calibration, gate }
 *   GET  /calibration?skill=    the calibration items of one skill (synthetic outputs from its scenario
 *                               pack), each with HQ's label and the judge's latest score → { items }
 *   POST /calibration/labels    { item, score, note? }  HQ's own score for one item, under the current
 *                               rubric version; a second label replaces the first → { label }
 *                               400 item_unknown, score_invalid, note_too_long
 *   POST /calibration/run       judges labelled items that have no score under the current rubric and
 *                               judge, up to 10 a press → { judged, stopped, calibration, gate }
 *                               409 nothing_to_judge, judge_model_unavailable · 402 rubric_cap_reached ·
 *                               503 rubric_spend_unreadable
 *   POST /skills/:uid/run       { model }  each live golden case of the HQ skill's draft, written by `model`
 *                               and scored by the judge; the output is never stored → { results, stopped, gate }
 *                               404 not_found · 400 models_invalid · 409 no_cases, judge_model_unavailable ·
 *                               402 rubric_cap_reached · 503 rubric_spend_unreadable
 *   GET  /skills/:uid           the latest rubric score per case and model for the current draft → { results, gate }
 *
 * Every write is audited with `logAdminAction` (a label's score before and after; a run's counts and
 * spend bound). No result is part of the 9-of-10 publish bar.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { logAdminAction } from '../services/adminAudit';
import { agentModels } from './team_agents';
import { skillByUid, type SkillRow } from '../services/agents/skillLinks';
import { draftPartsOf } from '../services/agents/skillPublish';
import { CASE_MAX_TOKENS, casePrompt, caseOutput, caseSha, checkCase, draftHash, liveCases } from '../services/agents/skillLifecycle';
import {
  CALIBRATION, CALIBRATION_PER_RUN, ITEM_KEY, JUDGE, RUBRIC, RUBRIC_CAP_MICROUSD, RUBRIC_DEPS, RUBRIC_SURFACE,
  agreementOf, calibrationItems, capRefusal, judgeOutput, monthSpend, rubricGate, rubricPrompt, worstCaseMicro, type CapRefusal,
} from '../services/agents/skillRubric';

type C = Context<{ Bindings: Env }>;
const rubric = new Hono<{ Bindings: Env }>();

const say = (c: C, status: number, code: string, message: string, extra?: Record<string, unknown>) => refuse(c, status, { code, message, extra });
const body = async (c: C): Promise<Record<string, any>> => { const b = await c.req.json().catch(() => null); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; };
const capSay = (c: C, r: CapRefusal) => say(c, r.status, r.code, r.message, r.extra);
const parse = (json: string): unknown => { try { return JSON.parse(json); } catch { return null; } };
const NOTE_MAX = 500;

async function hqSkill(env: Env, uid: unknown): Promise<SkillRow | null> {
  const s = await skillByUid(env, uid);
  return s && s.scope === 'hq' ? s : null;
}
const judgeOffered = (env: Env, admin: User) => agentModels(env, admin).some((m) => m.id === JUDGE.model && !m.plan_locked);
const noJudge = (c: C) => say(c, 409, 'judge_model_unavailable', `The pinned judge model (${JUDGE.model}) is not offered right now, so nothing was run.`);

/** HQ's labels under the current rubric, with who gave each ({ uid, name }, never an email). */
async function labels(env: Env) {
  return (await env.DB.prepare(`SELECT l.item_key, l.score, l.note, l.labelled_at, u.uid AS by_uid, u.name AS by_name
      FROM agent_skill_rubric_labels l LEFT JOIN users u ON u.id = l.labelled_by WHERE l.rubric_version = ? ORDER BY l.id`)
    .bind(RUBRIC.version).all<{ item_key: string; score: number; note: string | null; labelled_at: string; by_uid: string | null; by_name: string | null }>()).results ?? [];
}
/** The judge's latest score per calibration item, under the current rubric and judge model. */
async function judgedScores(env: Env): Promise<Map<string, { score: number; run_at: string }>> {
  const rows = (await env.DB.prepare(`SELECT r.item_key, r.score, r.run_at FROM agent_skill_rubric_results r
      WHERE r.kind = 'calibration' AND r.result = 'scored' AND r.rubric_version = ? AND r.judge_model = ?
        AND r.id = (SELECT MAX(x.id) FROM agent_skill_rubric_results x WHERE x.kind = 'calibration' AND x.result = 'scored'
          AND x.item_key = r.item_key AND x.rubric_version = r.rubric_version AND x.judge_model = r.judge_model)`)
    .bind(RUBRIC.version, JUDGE.model).all<{ item_key: string; score: number; run_at: string }>()).results ?? [];
  return new Map(rows.map((r) => [r.item_key, { score: r.score, run_at: r.run_at }]));
}
async function agreement(env: Env) {
  const [l, j] = await Promise.all([labels(env), judgedScores(env)]);
  return agreementOf(l, new Map([...j].map(([k, v]) => [k, v.score])));
}

rubric.get('/', async (c) => {
  await requireSuperAdmin(c);
  const spent = await monthSpend(c.env, RUBRIC_DEPS.now());
  const a = await agreement(c.env);
  return c.json({
    rubric: RUBRIC, judge: JUDGE,
    cap: { cap_microusd: RUBRIC_CAP_MICROUSD, surface: RUBRIC_SURFACE, spent_microusd: spent.available ? spent.microusd : null, spend: spent.available ? 'recorded' : 'unreadable' },
    calibration: { ...a, min_items: CALIBRATION.min_items, agree_at: CALIBRATION.agree_at },
    gate: rubricGate(a),
  });
});

rubric.get('/calibration', async (c) => {
  await requireSuperAdmin(c);
  const skill = c.req.query('skill') ?? '';
  const all = [...calibrationItems().values()];
  if (!all.some((i) => i.skill === skill)) return say(c, 404, 'not_found', 'No calibration items for that skill. Name a skill that has a scenario pack.');
  const [l, j] = await Promise.all([labels(c.env), judgedScores(c.env)]);
  const byItem = new Map(l.map((x) => [x.item_key, x]));
  return c.json({
    rubric_version: RUBRIC.version, judge_model: JUDGE.model,
    items: all.filter((i) => i.skill === skill).map((i) => {
      const lab = byItem.get(i.key), jud = j.get(i.key);
      return {
        key: i.key, case_id: i.case_id, revision: i.revision, case_name: i.case_name, output: i.output, targets: i.targets,
        records: i.records, text: i.text,
        label: lab ? { score: lab.score, note: lab.note, at: lab.labelled_at, by: lab.by_uid ? { uid: lab.by_uid, name: lab.by_name } : null } : null,
        judge: jud ? { score: jud.score, at: jud.run_at } : null,
      };
    }),
  });
});

rubric.post('/calibration/labels', async (c) => {
  const admin = await requireSuperAdmin(c);
  const b = await body(c);
  const key = typeof b.item === 'string' && ITEM_KEY.test(b.item) ? b.item : null;
  if (!key || !calibrationItems().has(key)) return say(c, 400, 'item_unknown', 'Name a calibration item by its key, as GET /calibration lists it.');
  if (!Number.isInteger(b.score) || b.score < RUBRIC.scale.min || b.score > RUBRIC.scale.max) return say(c, 400, 'score_invalid', `Score it with a whole number from ${RUBRIC.scale.min} to ${RUBRIC.scale.max}.`);
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.replace(/\s+/g, ' ').trim() : null;
  if (note && note.length > NOTE_MAX) return say(c, 400, 'note_too_long', `Keep the note under ${NOTE_MAX} characters.`);
  const before = await c.env.DB.prepare('SELECT score FROM agent_skill_rubric_labels WHERE item_key = ? AND rubric_version = ?').bind(key, RUBRIC.version).first<{ score: number }>();
  await c.env.DB.prepare(`INSERT INTO agent_skill_rubric_labels (item_key, rubric_version, score, note, labelled_by) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (item_key, rubric_version) DO UPDATE SET score = excluded.score, note = excluded.note, labelled_by = excluded.labelled_by, labelled_at = CURRENT_TIMESTAMP`)
    .bind(key, RUBRIC.version, b.score, note, admin.id).run();
  await logAdminAction(c.env, admin.id, admin.email, 'agent_skill_rubric_labelled', { item: key, rubric_version: RUBRIC.version, before: before?.score ?? null, after: b.score });
  return c.json({ label: { item: key, rubric_version: RUBRIC.version, score: b.score, note } });
});

rubric.post('/calibration/run', async (c) => {
  const admin = await requireSuperAdmin(c);
  if (!judgeOffered(c.env, admin)) return noJudge(c);
  const [l, j] = await Promise.all([labels(c.env), judgedScores(c.env)]);
  const items = calibrationItems();
  const todo = l.map((x) => items.get(x.item_key)).filter((i): i is NonNullable<typeof i> => !!i && !j.has(i.key)).slice(0, CALIBRATION_PER_RUN);
  if (!todo.length) return say(c, 409, 'nothing_to_judge', 'Every labelled item already has a judge score under this rubric. Label more items first.');
  const judged: Array<{ item: string; result: 'scored' | 'not_run'; score: number | null }> = [];
  let stopped: CapRefusal | null = null;
  for (const i of todo) {
    const p = rubricPrompt(i.skill, i.records, i.text);
    const refusal = await capRefusal(c.env, worstCaseMicro(JUDGE.model, p.system + p.user, JUDGE.max_tokens));
    if (refusal) { stopped = refusal; break; }
    const r = await judgeOutput(c.env, admin.id, i.skill, i.records, i.text);
    await c.env.DB.prepare(`INSERT INTO agent_skill_rubric_results (kind, item_key, rubric_version, judge_model, result, score, detail, judge_usage_log_id, run_by)
        VALUES ('calibration', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(i.key, RUBRIC.version, JUDGE.model, r.ok ? 'scored' : 'not_run', r.ok ? r.score : null, r.ok ? null : r.detail, r.usage_log_id, admin.id).run();
    judged.push({ item: i.key, result: r.ok ? 'scored' : 'not_run', score: r.ok ? r.score : null });
  }
  if (!judged.length && stopped) return capSay(c, stopped);
  const a = await agreement(c.env);
  await logAdminAction(c.env, admin.id, admin.email, 'agent_skill_rubric_calibration_run', {
    rubric_version: RUBRIC.version, judge_model: JUDGE.model, judged: judged.length, scored: judged.filter((x) => x.result === 'scored').length,
    stopped: stopped?.code ?? null, agrees: a.agrees,
  });
  return c.json({ judged, stopped: stopped ? { code: stopped.code, message: stopped.message } : null, calibration: a, gate: rubricGate(a) });
});

rubric.post('/skills/:uid/run', async (c) => {
  const admin = await requireSuperAdmin(c);
  const s = await hqSkill(c.env, c.req.param('uid'));
  if (!s) return say(c, 404, 'not_found', 'There is no such Axal skill.');
  const model = (await body(c)).model;
  if (typeof model !== 'string' || !agentModels(c.env, admin).some((m) => m.id === model && !m.plan_locked)) return say(c, 400, 'models_invalid', 'Choose one of the models agents may run on.');
  if (!judgeOffered(c.env, admin)) return noJudge(c);
  const cases = await liveCases(c.env, s.id);
  if (!cases.length) return say(c, 409, 'no_cases', 'This skill has no golden cases yet. Add one, then run the rubric.');
  const parts = await draftPartsOf(c.env, s);
  const hash = await draftHash(parts);
  const results: Array<{ case_uid: string; case_name: string; model_id: string; result: 'scored' | 'not_run'; score: number | null; meets: boolean | null }> = [];
  let stopped: CapRefusal | null = null;
  for (const k of cases) {
    // A golden case is synthetic by construction: made-up records, checked on every write (D4160).
    const checked = checkCase({ name: k.name, input: parse(k.input_json), expect: parse(k.expect_json) });
    if (!checked.ok) continue;
    const gen = casePrompt(parts, checked.input, checked.expect);
    // The output is not written yet: the judge's worst case stands in its full allowance at 16 characters a token.
    const jp = rubricPrompt(parts.name, checked.input.records, 'x'.repeat(CASE_MAX_TOKENS * 16));
    const need = worstCaseMicro(model, gen.system + gen.user, CASE_MAX_TOKENS) + worstCaseMicro(JUDGE.model, jp.system + jp.user, JUDGE.max_tokens);
    const refusal = await capRefusal(c.env, need);
    if (refusal) { stopped = refusal; break; }
    const out = await caseOutput(c.env, parts, checked.input, checked.expect, model, admin.id, RUBRIC_SURFACE);
    const r = out.ok ? await judgeOutput(c.env, admin.id, parts.name, checked.input.records, out.output) : null;
    const scored = r?.ok ? r.score : null;
    const detail = !out.ok ? out.detail : r && !r.ok ? r.detail : null;
    await c.env.DB.prepare(`INSERT INTO agent_skill_rubric_results
        (kind, skill_id, draft_hash, case_uid, case_sha256, model_id, rubric_version, judge_model, result, score, detail, usage_log_id, judge_usage_log_id, run_by)
        VALUES ('case', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(s.id, hash, k.uid, await caseSha(checked), model, RUBRIC.version, JUDGE.model, scored == null ? 'not_run' : 'scored', scored, detail,
        out.usage_log_id, r?.usage_log_id ?? null, admin.id).run();
    results.push({ case_uid: k.uid, case_name: k.name, model_id: model, result: scored == null ? 'not_run' : 'scored', score: scored, meets: scored == null ? null : scored >= RUBRIC.meets_at });
  }
  if (!results.length && stopped) return capSay(c, stopped);
  const a = await agreement(c.env);
  await logAdminAction(c.env, admin.id, admin.email, 'agent_skill_rubric_run', {
    skill_uid: s.uid, skill_name: s.name, draft_hash: hash, model, rubric_version: RUBRIC.version, judge_model: JUDGE.model,
    cases: results.length, scored: results.filter((x) => x.result === 'scored').length, stopped: stopped?.code ?? null,
  });
  return c.json({ rubric_version: RUBRIC.version, judge_model: JUDGE.model, results, stopped: stopped ? { code: stopped.code, message: stopped.message } : null, gate: rubricGate(a) });
});

rubric.get('/skills/:uid', async (c) => {
  await requireSuperAdmin(c);
  const s = await hqSkill(c.env, c.req.param('uid'));
  if (!s) return say(c, 404, 'not_found', 'There is no such Axal skill.');
  const hash = await draftHash(await draftPartsOf(c.env, s));
  const rows = (await c.env.DB.prepare(`SELECT r.case_uid, r.model_id, r.rubric_version, r.judge_model, r.result, r.score, r.detail, r.run_at
      FROM agent_skill_rubric_results r WHERE r.kind = 'case' AND r.skill_id = ? AND r.draft_hash = ?
        AND r.id = (SELECT MAX(x.id) FROM agent_skill_rubric_results x WHERE x.kind = 'case' AND x.skill_id = r.skill_id
          AND x.draft_hash = r.draft_hash AND x.case_uid = r.case_uid AND x.model_id = r.model_id AND x.rubric_version = r.rubric_version AND x.judge_model = r.judge_model)
      ORDER BY r.case_uid, r.model_id, r.rubric_version, r.judge_model`).bind(s.id, hash).all()).results ?? [];
  return c.json({ draft_hash: hash, results: rows, gate: rubricGate(await agreement(c.env)) });
});

export default rubric;
export const mount: RouteMount = { path: '/api/admin/ai-agents/skill-rubric', router: rubric };

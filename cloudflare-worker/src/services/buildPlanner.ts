/** D1065: deterministic proposals only. Acceptance belongs to D1066. No AI run. */
import type { Env } from '../types';
import { loadPainGroupModel } from './painGroups';
import { themesOf } from './cycleValidate';
import { evidenceFor } from './validateEvidence';

export const PLAN_MIN_INTERVIEWS = 3;
export const PLAN_RISK_HIGH_MENTIONS = 3;
export const PLAN_MODULES = ['solution-design', 'prototype-mvp', 'product-roadmap', 'company-creation', 'operating-systems'] as const;
type Module = typeof PLAN_MODULES[number];
type Ref = { kind: string; ref: string; label: string; source_label: 'Recorded' | 'Typed' | 'Document' };
type Hypothesis = { id: number; claim: string; supporting: number; contradicting: number };
export type PlanEvidence = {
  themes: Array<{ id: number; title: string; mentions: number; severity: string | null; hypotheses: number[] }>;
  hypotheses: Hypothesis[];
  experiments: Array<{ id: number; hypothesis_id: number; title: string }>;
  signals: Array<{ id: number; kind: string; source_label: Ref['source_label'] }>;
  objections: Array<{ about: string; mentions: number; refs: number[] }>;
  segments: Array<{ id: number; label: string }>;
  positioning: { valueProp?: string; differentiator?: string; tone?: string } | null;
  alternatives: Array<{ id: string | number; label: string; kind?: 'finding' | 'competitor' }>;
  features: Array<{ id: number; title: string; is_must_have: number | null; pain_group_id: number | null }>;
  commitments: Array<{ id: number; text: string }>;
  formation: string[];
  hasEntity: boolean;
  decision: { id: number; decision: string; state: string; hypothesis_id: number | null; pivot_hypothesis_id: number | null; evidence_hypotheses?: number[] } | null;
};
export type PlanRuleItem = {
  module: Module; kind: string; item_key: string; payload: Record<string, unknown>; evidence: Ref[];
};
export class BuildPlanError extends Error {
  code: 'no_evidence' | 'plan_paused' | 'not_this_project';
  status: number;
  constructor(code: BuildPlanError['code'], status = 409) { super(code); this.code = code; this.status = status; }
}
const parse = (s: unknown): any => { try { return JSON.parse(String(s)); } catch { return null; } };
/** Structured labels only; contacts, links and quoted interview wording never travel. */
export function planLabel(v: unknown): string {
  return typeof v === 'string' ? v.replace(/"[^"]*"|“[^”]*”/g, '').replace(/\b\S+@\S+\b|https?:\/\/\S+|\+?\d[\d ()-]{7,}\d|[$€£]\s*\d[\d,.]*|\b\d{4}-\d{2}-\d{2}\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 280) : '';
}
const reference = (kind: string, id: string | number, label: string, source_label: Ref['source_label'] = 'Typed'): Ref => ({ kind, ref: String(id), label, source_label });

/** Reads committed module rows, never validate_proposals, session text or contact columns. */
export async function readEvidence(env: Env, projectId: number, scope = 'venture'): Promise<PlanEvidence> {
  const project = await env.DB.prepare('SELECT id, entity_id, icp_definition_meta FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first<{ id: number; entity_id: number | null; icp_definition_meta: string | null }>();
  if (!project) throw new BuildPlanError('not_this_project', 404);
  const hid = scope === 'venture' ? 0 : Number(scope.slice(2));
  if (hid && !await env.DB.prepare('SELECT id FROM hypotheses WHERE id = ? AND project_id = ? AND retired_at IS NULL').bind(hid, projectId).first()) throw new BuildPlanError('not_this_project', 404);
  const decision = await env.DB.prepare(`SELECT id, decision, state, hypothesis_id, pivot_hypothesis_id FROM validation_decisions
    WHERE project_id = ? AND superseded_at IS NULL AND ((? = 0 AND hypothesis_id IS NULL) OR hypothesis_id = ?) ORDER BY id DESC LIMIT 1`).bind(projectId, hid, hid).first<PlanEvidence['decision']>();
  const selected = decision?.decision === 'pivot' && decision.state === 'given' ? decision.pivot_hypothesis_id : hid || null;
  const n = selected || 0;
  const hyps = (await env.DB.prepare(`SELECT id, claim FROM hypotheses
    WHERE project_id = ? AND retired_at IS NULL AND (? = 0 OR id = ?) ORDER BY id`).bind(projectId, n, n).all<{ id: number; claim: string }>()).results || [];
  // Resolve links through the standing evidence reader: an orphan link is no evidence.
  // Its detailed labels/dates/amounts are deliberately not carried into this projection.
  const evidence = await evidenceFor({ env, projectId }, n ? { hypothesisId: n } : {});
  if (decision) {
    const refs = (await env.DB.prepare("SELECT ref_id FROM validation_decision_evidence WHERE decision_id = ? AND direction = 'supports'").bind(decision.id).all<{ ref_id: string }>()).results || [];
    decision.evidence_hypotheses = [...new Set(evidence.filter(e => e.direction === 'supports' && refs.some(r => r.ref_id === e.id)).map(e => e.hypothesis_id))];
  }
  const hypotheses = hyps.map(h => ({ ...h, supporting: evidence.filter(e => e.hypothesis_id === h.id && e.direction === 'supports').length,
    contradicting: evidence.filter(e => e.hypothesis_id === h.id && e.direction === 'contradicts').length }));
  const model = await loadPainGroupModel(env, projectId, { strict: true });
  const interviews = (await env.DB.prepare('SELECT id, pains_json FROM discovery_interviews WHERE project_id = ? ORDER BY id').bind(projectId).all<{ id: number; pains_json: string | null }>()).results || [];
  const severities = (await env.DB.prepare(`SELECT s.interview_id, s.phrase_norm, s.severity FROM interview_pain_severities s
    JOIN discovery_interviews i ON i.id = s.interview_id WHERE i.project_id = ?`).bind(projectId).all<{ interview_id: number; phrase_norm: string; severity: string }>()).results || [];
  const links = (await env.DB.prepare(`SELECT l.pain_group_id, l.hypothesis_id FROM hypothesis_pain_links l
    JOIN hypotheses h ON h.id = l.hypothesis_id JOIN pain_groups g ON g.id = l.pain_group_id
    WHERE h.project_id = ? AND g.project_id = ? AND h.retired_at IS NULL AND l.direction = 'supports'`).bind(projectId, projectId).all<{ pain_group_id: number; hypothesis_id: number }>()).results || [];
  const themes = themesOf(interviews as Parameters<typeof themesOf>[0], model, severities, '1970-01-01').filter(t => t.group_id != null).map(t => ({
    id: t.group_id!, title: planLabel(t.title), mentions: t.mentions, severity: t.severity,
    hypotheses: links.filter(l => l.pain_group_id === t.group_id && hypotheses.some(h => h.id === l.hypothesis_id)).map(l => l.hypothesis_id),
  })).filter(t => t.title && (!n || t.hypotheses.includes(n)));
  const experiments = (await env.DB.prepare(`SELECT x.id, x.hypothesis_id, x.title FROM hypothesis_experiments x JOIN hypotheses h ON h.id = x.hypothesis_id
    WHERE x.project_id = ? AND h.project_id = ? AND h.retired_at IS NULL AND x.status = 'planned' AND (? = 0 OR x.hypothesis_id = ?) ORDER BY x.id`).bind(projectId, projectId, n, n).all<PlanEvidence['experiments'][number]>()).results || [];
  const signals = (await env.DB.prepare(`SELECT s.id, s.kind, CASE WHEN s.evidence_file_key IS NOT NULL THEN 'Document' WHEN s.interview_id IS NOT NULL THEN 'Recorded' ELSE 'Typed' END AS source_label
    FROM demand_signals s WHERE s.project_id = ? AND s.status = 'confirmed' AND s.kind IN ('would_pay', 'loi', 'pre_sale')
    AND (? = 0 OR EXISTS (SELECT 1 FROM hypothesis_evidence_links e WHERE e.project_id = ? AND e.hypothesis_id = ? AND e.kind = 'signal' AND e.ref_id = 'signal-' || s.id)) ORDER BY s.id`).bind(projectId, n, projectId, n).all<PlanEvidence['signals'][number]>()).results || [];
  // Objections are counted by their typed category. Payload details and quote are not selected.
  const objections = (await env.DB.prepare(`SELECT json_extract(f.payload_json, '$.about') AS about, COUNT(DISTINCT f.interview_id) AS mentions, json_group_array(f.id) AS refs
    FROM interview_findings f JOIN discovery_interviews i ON i.id = f.interview_id
    WHERE f.project_id = ? AND i.project_id = ? AND f.kind = 'objection' AND json_valid(f.payload_json)
    AND json_extract(f.payload_json, '$.about') IN ('price', 'risk', 'trust') AND ? = 0
    GROUP BY json_extract(f.payload_json, '$.about') ORDER BY about`).bind(projectId, projectId, n).all<{ about: string; mentions: number; refs: string }>()).results || [];
  const segments = n ? [] : (await env.DB.prepare('SELECT id, name AS label FROM customer_segments WHERE project_id = ? AND archived_at IS NULL ORDER BY id').bind(projectId).all<{ id: number; label: string }>()).results || [];
  const def = parse(project.icp_definition_meta);
  const positioning = !n && def?.status === 'confirmed' ? Object.fromEntries(['valueProp', 'differentiator', 'tone'].map(k => [k, planLabel(def.fields?.[k])]).filter(([, v]) => v)) : null;
  const alternatives = n ? [] : (await env.DB.prepare(`SELECT f.id, json_extract(f.payload_json, '$.name') AS label FROM interview_findings f JOIN discovery_interviews i ON i.id = f.interview_id
    WHERE f.project_id = ? AND i.project_id = ? AND f.kind = 'alternative' AND json_valid(f.payload_json) ORDER BY f.id`).bind(projectId, projectId).all<{ id: number; label: string }>()).results || [];
  const competitors = n ? [] : (await env.DB.prepare(`SELECT c.id, c.name AS label FROM competitor_candidates c JOIN competitor_analyses a ON a.id = c.analysis_id
    WHERE a.project_id = ? AND a.status = 'complete' AND (a.edited = 1 OR c.origin = 'manual') ORDER BY c.id`).bind(projectId).all<{ id: string; label: string }>()).results || [];
  const features = (await env.DB.prepare(`SELECT id, title, is_must_have, pain_group_id FROM mvp_features WHERE project_id = ? AND (? = 0 OR hypothesis_id = ?) ORDER BY id`).bind(projectId, n, n).all<PlanEvidence['features'][number]>()).results || [];
  const commitments = decision ? (await env.DB.prepare('SELECT id, text FROM validation_decision_commitments WHERE project_id = ? AND decision_id = ? AND done_at IS NULL ORDER BY id').bind(projectId, decision.id).all<{ id: number; text: string }>()).results || [] : [];
  const formation = (await env.DB.prepare('SELECT title FROM formation_steps WHERE project_id = ? ORDER BY id').bind(projectId).all<{ title: string }>()).results || [];
  return { themes, hypotheses: hypotheses.map(h => ({ ...h, claim: planLabel(h.claim) })).filter(h => h.claim), experiments: experiments.map(x => ({ ...x, title: planLabel(x.title) })), signals,
    objections: objections.map(o => ({ ...o, refs: parse(o.refs) || [] })), segments: segments.map(s => ({ ...s, label: planLabel(s.label) })).filter(s => s.label), positioning,
    alternatives: [...alternatives.map(a => ({ ...a, kind: 'finding' as const, label: planLabel(a.label) })), ...competitors.map(c => ({ id: c.id, kind: 'competitor' as const, label: planLabel(c.label) }))].filter(a => a.label), features: features.map(f => ({ ...f, title: planLabel(f.title) })).filter(f => f.title),
    commitments: commitments.map(c => ({ ...c, text: planLabel(c.text) })).filter(c => c.text), formation: formation.map(f => planLabel(f.title)), hasEntity: project.entity_id != null, decision };
}

/** One branch per mapping row in #2426. Only existing evidence unlocks a branch. */
export function planRules(e: PlanEvidence): { items: PlanRuleItem[]; brief: Record<string, unknown> } {
  const items: PlanRuleItem[] = [];
  const add = (module: Module, kind: string, key: string, payload: Record<string, unknown>, evidence: Ref[]) => {
    if (typeof payload.title === 'string' && payload.title.trim() && evidence.length) items.push({ module, kind, item_key: `${module}:${kind}:${key}`, payload, evidence });
  };
  const given = e.decision?.state === 'given';
  const pivot = given && e.decision?.decision === 'pivot';
  if (given && e.decision?.decision === 'stop') return { items: [], brief: {} };
  const hypRef = (h: Hypothesis) => reference('hypothesis', h.id, h.claim);
  // 1. A recorded, repeated Severe/Real theme linked to a supported claim.
  for (const t of e.themes) if (!pivot && t.mentions >= PLAN_MIN_INTERVIEWS && ['severe', 'real'].includes(t.severity || '')) {
    for (const h of e.hypotheses.filter(h => t.hypotheses.includes(h.id) && h.supporting > 0)) add('solution-design', 'feature', `theme-${t.id}-h-${h.id}`, {
      title: t.title, pain_group_id: t.id, hypothesis_id: h.id, added_value: t.severity === 'severe' ? 'High' : 'Medium',
    }, [reference('pain_group', t.id, t.title, 'Recorded'), hypRef(h)]);
  }
  // 2. Must-haves follow a given Proceed, never a Pivot or a guessed decision.
  if (given && e.decision?.decision === 'proceed') for (const h of e.hypotheses.filter(h => h.supporting > 0 && (h.id === e.decision?.hypothesis_id || e.decision?.evidence_hypotheses?.includes(h.id)))) {
    add('prototype-mvp', 'must-have', `h-${h.id}`, { title: `Prove ${h.claim}`, hypothesis_id: h.id }, [hypRef(h)]);
  }
  // 3. Untested claims, planned experiments and a Pivot's new claim.
  const tests = new Map<number, Hypothesis>();
  for (const h of e.hypotheses) if ((h.supporting === 0 && h.contradicting === 0) || e.experiments.some(x => x.hypothesis_id === h.id) || (pivot && h.id === e.decision?.pivot_hypothesis_id)) tests.set(h.id, h);
  for (const h of tests.values()) add('prototype-mvp', 'prototype-test', `h-${h.id}`, { title: `Test ${h.claim}`, hypothesis_id: h.id, method: 'Prototype test' }, [hypRef(h), ...e.experiments.filter(x => x.hypothesis_id === h.id).map(x => reference('experiment', x.id, x.title))]);
  // 4. Confirmed signals supply counts, not customers' names, to an actual test.
  if (e.signals.length) for (const item of items.filter(i => i.kind === 'prototype-test')) {
    item.payload.target = `${e.signals.length} confirmed demand signals to invite`;
    item.evidence.push(...e.signals.map(s => reference('signal', s.id, s.kind, s.source_label)));
  }
  // 5. Risk categories and contrary evidence; severity is a named count rule.
  for (const o of e.objections) add('solution-design', 'risk', `objection-${o.about}`, { title: `Test the ${o.about} objection`, severity: o.mentions >= PLAN_RISK_HIGH_MENTIONS ? 'high' : 'medium' }, o.refs.map(id => reference('finding', id, `${o.about} objection`, 'Recorded')));
  for (const h of e.hypotheses.filter(h => h.contradicting > 0)) add('solution-design', 'risk', `contrary-h-${h.id}`, { title: `Resolve contrary evidence for ${h.claim}`, severity: h.contradicting >= PLAN_RISK_HIGH_MENTIONS ? 'high' : 'medium' }, [hypRef(h)]);
  // 6. The brief is an evidence snapshot, not a pending Build record.
  const brief = { audience: e.segments.map(s => ({ key: `segment-${s.id}`, label: s.label })), problems: e.themes.map(t => ({ key: `theme-${t.id}`, label: t.title })), positioning: e.positioning, replaces: e.alternatives.map(a => ({ key: `${a.kind || 'finding'}-${a.id}`, label: a.label })) };
  // 7. Existing (already accepted) features go to the roadmap.
  for (const f of e.features) {
    const theme = e.themes.find(t => t.id === f.pain_group_id);
    const lane = f.is_must_have ? 'Now' : theme?.severity === 'real' ? 'Next' : theme?.severity === 'mild' ? 'Later' : null;
    if (lane) add('product-roadmap', 'roadmap', `feature-${f.id}`, { title: f.title, feature_id: f.id, lane }, [reference('feature', f.id, f.title)]);
  }
  const pay = e.signals.filter(s => s.kind === 'would_pay');
  if (pay.length) add('product-roadmap', 'roadmap', 'paying-accounts', { title: 'First paying customer', kpi_key: 'paying_accounts', lane: 'Now' }, pay.map(s => reference('signal', s.id, 'Would pay', s.source_label)));
  // 8. Copy the accepted commitment label only. No owner name or date proposed.
  for (const c of e.commitments) add('product-roadmap', 'roadmap', `commitment-${c.id}`, { title: c.text, from_commitment: c.id }, [reference('commitment', c.id, c.text)]);
  // 9. A recorded Proceed, no entity, and no existing equivalent formation step.
  if (given && e.decision?.decision === 'proceed' && !e.hasEntity) for (const title of ['Incorporate', 'Assign the IP to the company']) {
    if (!e.formation.some(s => s.toLowerCase() === title.toLowerCase())) add('company-creation', 'formation-step', title === 'Incorporate' ? 'incorporate' : 'assign-ip', { title }, [reference('decision', e.decision.id, 'Recorded Proceed')]);
  }
  // 10. Doors only, justified by actual proposed build/test work. Never a system write.
  if (items.some(i => i.module === 'prototype-mvp' || i.kind === 'feature')) for (const [provider, label] of [['github', 'GitHub (Code)'], ['vercel', 'Vercel (Hosting)'], ['posthog', 'PostHog (Product analytics)']]) {
    add('operating-systems', 'connect-door', provider, { title: `Connect ${label}`, href: `/build/connect?tool=${provider}` }, items.find(i => i.module === 'prototype-mvp' || i.kind === 'feature')!.evidence);
  }
  return { items, brief };
}

type PlanRow = { id: number; uid: string; scope: string; trigger: string; decision_id: number | null; status: string; brief_json: string; evidence_hash: string };
const currentPlan = (env: Env, projectId: number, scope: string) => env.DB.prepare(`SELECT id, uid, scope, trigger, decision_id, status, brief_json, evidence_hash
  FROM build_plans WHERE project_id = ? AND scope = ? AND status IN ('draft', 'open', 'paused') ORDER BY id DESC LIMIT 1`).bind(projectId, scope).first<PlanRow>();

/** Partners get landed accepted items only, without the private plan or decision references. */
export async function readPlan(env: Env, projectId: number, scope = 'venture', partner = false) {
  const plan = await currentPlan(env, projectId, scope);
  const modules = Object.fromEntries([...PLAN_MODULES, 'founding-team'].map(m => [m, [] as any[]]));
  if (!plan) return { plan: null, modules, brief: null };
  const rows = (await env.DB.prepare(`SELECT i.uid, i.module, i.kind, i.item_key, i.evidence_json, i.landed_table, i.landed_id, i.marker,
    q.uid AS proposal_uid, q.status, q.payload_json, q.decided_payload_json, q.source_kind, q.source_ref, q.source_label
    FROM build_plan_items i JOIN ai_rail_proposals q ON q.uid = i.proposal_uid JOIN build_plans p ON p.id = i.plan_id
    WHERE p.scope = ? AND p.project_id = ? AND i.project_id = p.project_id
      AND (i.plan_id = ? OR q.status IN ('accepted', 'edited'))
      AND (? = 0 OR (q.status IN ('accepted', 'edited') AND i.landed_table IS NOT NULL AND i.landed_id IS NOT NULL))
    ORDER BY i.module, i.item_key`).bind(scope, projectId, plan.id, partner ? 1 : 0).all<any>()).results || [];
  for (const r of rows) {
    const evidence = (parse(r.evidence_json) || []).filter((e: Ref) => !partner || !['decision', 'commitment'].includes(e.kind));
    const payload = parse(r.decided_payload_json || r.payload_json);
    if (partner && payload) delete payload.from_commitment;
    modules[r.module].push({ uid: r.uid, kind: r.kind, ...(partner ? {} : { item_key: r.item_key }), proposal_uid: r.proposal_uid, status: r.status,
      payload, evidence, landed_table: r.landed_table, landed_id: r.landed_id, marker: r.marker,
      ...(partner ? {} : { source_kind: r.source_kind, source_ref: r.source_ref, source_label: r.source_label }) });
  }
  return { plan: partner ? null : { uid: plan.uid, scope: plan.scope, trigger: plan.trigger, decision_id: plan.decision_id, status: plan.status, evidence_hash: plan.evidence_hash },
    modules, brief: partner ? null : parse(plan.brief_json) };
}

/** A single D1 batch creates the plan, source proposals and their items, or none. */
export async function preparePlan(env: Env, projectId: number, userId: number, scope = 'venture', trigger: 'manual' | 'decision' | 'update' = 'manual') {
  const old = await currentPlan(env, projectId, scope);
  if (old?.status === 'paused') throw new BuildPlanError('plan_paused');
  const ventureDecision = await env.DB.prepare(`SELECT decision, state FROM validation_decisions WHERE project_id = ? AND hypothesis_id IS NULL AND superseded_at IS NULL ORDER BY id DESC LIMIT 1`).bind(projectId).first<{ decision: string; state: string }>();
  if (ventureDecision?.state === 'given' && ventureDecision.decision === 'stop') throw new BuildPlanError('plan_paused');
  const evidence = await readEvidence(env, projectId, scope);
  if (evidence.decision?.state === 'given' && evidence.decision.decision === 'stop') throw new BuildPlanError('plan_paused');
  const result = planRules(evidence);
  if (!old && !result.items.length && !evidence.segments.length && !evidence.themes.length && !evidence.alternatives.length && !Object.keys(evidence.positioning || {}).length) throw new BuildPlanError('no_evidence');
  // AUTOFILL owns these shared source columns. Fail before writing anything if
  // its schema is not deployed; never substitute payload-only provenance.
  await env.DB.prepare('SELECT source_kind, source_ref, source_label FROM ai_rail_proposals LIMIT 0').all();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(evidence)));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const changedDecision = Boolean(old && old.decision_id !== (evidence.decision?.id ?? null));
  const uid = changedDecision ? crypto.randomUUID() : old?.uid || crypto.randomUUID();
  const batch: D1PreparedStatement[] = [];
  if (changedDecision) {
    batch.push(env.DB.prepare(`UPDATE build_plans SET status = 'superseded', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('draft', 'open')`).bind(old!.id));
    batch.push(env.DB.prepare(`UPDATE ai_rail_proposals SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP WHERE status = 'proposed'
      AND uid IN (SELECT i.proposal_uid FROM build_plan_items i JOIN build_plans p ON p.id = i.plan_id WHERE p.id = ? AND p.status = 'superseded')`).bind(old!.id));
  }
  batch.push(env.DB.prepare(`INSERT OR IGNORE INTO build_plans (uid, project_id, scope, trigger, decision_id, status, brief_json, evidence_hash, created_by)
    SELECT ?, ?, ?, ?, ?, 'draft', ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL)`)
    .bind(uid, projectId, scope, trigger, evidence.decision?.id ?? null, JSON.stringify(result.brief), hash, userId, projectId),
    env.DB.prepare(`UPDATE build_plans SET brief_json = ?, evidence_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ? AND scope = ? AND status IN ('draft', 'open')`).bind(JSON.stringify(result.brief), hash, projectId, scope),
    // No longer supported pending items withdraw; decided items are immutable.
    env.DB.prepare(`UPDATE ai_rail_proposals SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP WHERE status = 'proposed'
      AND uid IN (SELECT i.proposal_uid FROM build_plan_items i JOIN build_plans p ON p.id = i.plan_id WHERE p.project_id = ? AND p.scope = ? AND p.status IN ('draft', 'open')
        AND i.item_key NOT IN (SELECT value FROM json_each(?)))`).bind(projectId, scope, JSON.stringify(result.items.map(i => i.item_key))));
  for (const item of result.items) {
    const proposal = crypto.randomUUID(), itemUid = crypto.randomUUID();
    const marker = `VB-${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;
    const source = item.evidence[0];
    const payload = JSON.stringify({ ...item.payload, ...(item.kind === 'connect-door' ? { href: `${item.payload.href}&project_id=${projectId}` } : {}), module: item.module, kind: item.kind });
    batch.push(env.DB.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, record_ref, kind, payload_json, source_kind, source_ref, source_label)
      SELECT ?, ?, 'Founder.Build.Plan', 'draft:build/plan', ?, 'proposal', ?, 'module', ?, ? FROM build_plans p
      WHERE p.project_id = ? AND p.scope = ? AND p.status IN ('draft', 'open')
      AND NOT EXISTS (SELECT 1 FROM build_plan_items i WHERE i.plan_id = p.id AND i.item_key = ?)
      AND NOT EXISTS (SELECT 1 FROM build_plan_items i JOIN build_plans prior ON prior.id = i.plan_id JOIN ai_rail_proposals q ON q.uid = i.proposal_uid
        WHERE prior.project_id = p.project_id AND prior.scope = p.scope AND i.item_key = ? AND q.status IN ('discarded', 'accepted', 'edited'))`)
      .bind(proposal, userId, `project:${projectId}`, payload, `${source.kind}:${source.ref}`, source.source_label, projectId, scope, item.item_key, item.item_key));
    batch.push(env.DB.prepare(`INSERT OR IGNORE INTO build_plan_items (uid, plan_id, project_id, module, kind, item_key, proposal_uid, evidence_json, marker)
      SELECT ?, p.id, p.project_id, ?, ?, ?, ?, ?, ? FROM build_plans p
      WHERE p.project_id = ? AND p.scope = ? AND p.status IN ('draft', 'open') AND EXISTS (SELECT 1 FROM ai_rail_proposals WHERE uid = ?)`)
      .bind(itemUid, item.module, item.kind, item.item_key, proposal, JSON.stringify(item.evidence), marker, projectId, scope, proposal));
    batch.push(env.DB.prepare(`UPDATE ai_rail_proposals SET payload_json = ?, source_ref = ?, source_label = ?, status = 'proposed', updated_at = CURRENT_TIMESTAMP
      WHERE status IN ('proposed', 'withdrawn') AND uid IN (SELECT i.proposal_uid FROM build_plan_items i JOIN build_plans p ON p.id = i.plan_id
        WHERE p.project_id = ? AND p.scope = ? AND p.status IN ('draft', 'open') AND i.item_key = ?)`)
      .bind(payload, `${source.kind}:${source.ref}`, source.source_label, projectId, scope, item.item_key));
    batch.push(env.DB.prepare(`UPDATE build_plan_items SET evidence_json = ? WHERE plan_id IN (SELECT id FROM build_plans WHERE project_id = ? AND scope = ? AND status IN ('draft', 'open'))
      AND item_key = ? AND proposal_uid IN (SELECT uid FROM ai_rail_proposals WHERE status = 'proposed')`)
      .bind(JSON.stringify(item.evidence), projectId, scope, item.item_key));
  }
  await env.DB.batch(batch);
  const out = await readPlan(env, projectId, scope);
  if (out.plan?.status === 'paused') throw new BuildPlanError('plan_paused');
  return out;
}

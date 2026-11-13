/** D1144: PMF snapshots in SCORING's shared store. All callers gate the venture first. */
import { signHmac } from '../scoreIntegrity';
import type { Env } from '../../types';
import { READINESS_ITEMS, type ComputedScore } from '../raiseCycle';
import { collectPmfInputs, type PmfCollected } from './pmfCollector';
import { GRADES, PMF_MODEL_V1, scorePmf, type PmfModel, type PmfResult } from './pmf';

export type PmfTrigger = 'module_read' | 'rescore';
type Stored = { project_id: number; value: number | null; band: string | null; confidence: number; coverage: number; signature: string; id: number; uid: string; inputs_hash: string; inputs_json: string; model_version: string; trigger: PmfTrigger; computed_by: number | null; computed_at: string };
/** Key order, request time and trigger cannot manufacture a changed input set. */
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
async function signatureFor(env: Env, row: Omit<Stored, 'id' | 'signature'>): Promise<string> {
  const { project_id, uid, value, band, confidence, coverage, inputs_json, inputs_hash, model_version, trigger, computed_by, computed_at } = row;
  return signHmac(env, 'venture-scorecard:' + JSON.stringify(canonical({ project_id, scope: 'pmf', uid, value, band, confidence, coverage, inputs_json, inputs_hash, model_version, trigger, computed_by, computed_at })));
}
async function verify(env: Env, row: Stored): Promise<void> {
  const expected = await signatureFor(env, row);
  if (!/^[a-f0-9]{64}$/.test(row.signature)) throw new Error('pmf_snapshot_unreadable');
  let different = 0;
  for (let i = 0; i < expected.length; i++) different |= expected.charCodeAt(i) ^ row.signature.charCodeAt(i);
  if (different) throw new Error('pmf_snapshot_unreadable');
}
export async function pmfInputHash(collected: PmfCollected, result: PmfResult): Promise<string> {
  // The day is not an input. Crossing a freshness boundary is: it changes the effective grades.
  const text = JSON.stringify(canonical({ model: PMF_MODEL_V1, inputs: collected.inputs, pivot_at: collected.pivot_at,
    freshness: result.inputs.map(i => ({ key: i.key, stale: i.stale })) }));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
}
function payload(row: Stored): { result: PmfResult; pivot_at: string | null } {
  const data = JSON.parse(row.inputs_json);
  if (!data.result || !Array.isArray(data.result.inputs) || !Array.isArray(data.result.steps)) throw new Error('pmf_snapshot_unreadable');
  return data;
}
export function pmfChecklist(result: PmfResult): ComputedScore {
  const eligible = result.state === 'scored' && result.value != null && ['Medium','High'].includes(result.confidence_word || '');
  return { key: 'pmf', score: eligible ? result.value! / 10 : null, evidence: eligible ? 'pattern' : null,
    missing: eligible ? null : 'Not scored: Product-market fit needs Medium confidence or more.',
    reads: [{ a: 'Product-market fit', b: result.value == null ? 'Not enough recorded' : `${result.value} / 100 · ${result.confidence_word} confidence`,
      c: eligible ? 'Counted' : 'Missing', tone: eligible ? 'ok' : 'bad' }] };
}
async function latest(env: Env, projectId: number): Promise<Stored | null> {
  const row = await env.DB.prepare("SELECT * FROM venture_scorecards WHERE project_id = ? AND scope = 'pmf' ORDER BY id DESC LIMIT 1").bind(projectId).first<Stored>();
  if (row) await verify(env, row);
  return row;
}
export async function storedPmfChecklist(env: Env, projectId: number): Promise<ComputedScore | null> {
  const row = await latest(env, projectId);
  return row ? pmfChecklist(payload(row).result) : null;
}
/** D1147: verified inputs only. Explaining never recomputes or writes a scorecard. */
export async function storedPmfInputs(env: Env, projectId: number) {
  const row = await latest(env, projectId);
  return row ? { inputs: payload(row).result.inputs, hash: row.inputs_hash, snapshot: row.uid } : null;
}
export async function recomputePmf(env: Env, projectId: number, userId: number, trigger: PmfTrigger, today: string) {
  if (!Number.isSafeInteger(projectId) || projectId < 1 || !Number.isSafeInteger(userId) || userId < 1
    || !['module_read','rescore'].includes(trigger)) throw new Error('invalid_pmf_context');
  const collected = await collectPmfInputs(env, projectId, today);
  const result = scorePmf(collected.inputs, PMF_MODEL_V1, today);
  // D1145 (#3031, RD16 B): an input that could not be read makes this a partial
  // score. It is drawn as it is, without that input and at the lower confidence,
  // but never stored: history, checklist item 8 and the audit keep the last
  // complete read, and a store that answers again writes the next point.
  // Below the floor it is not "Not enough recorded" (what is recorded is not
  // known), so the part is Unreadable, as a failed read always was.
  if (collected.inputs.some((f) => f.unreadable)) {
    if (result.state !== 'scored') return { state: 'unreadable' as const, reason: 'Product-market fit could not be read', changed: false };
    const previous = await latest(env, projectId).catch(() => null);
    return { ...result, id: previous?.id ?? null, inputs_hash: null, computed_at: new Date().toISOString(),
      computed_by: userId, trigger, changed: false, partial: true, pivot_at: collected.pivot_at, verdict: collected.verdict };
  }
  const hash = await pmfInputHash(collected, result);
  const previous = await latest(env, projectId);
  let changed = false;
  if (previous?.inputs_hash !== hash) {
    const uid = crypto.randomUUID();
    const at = new Date().toISOString();
    const modelJson = JSON.stringify(canonical(PMF_MODEL_V1));
    const model = await env.DB.prepare("SELECT model_json FROM scoring_model_versions WHERE scope = 'pmf' AND version = ?").bind(PMF_MODEL_V1.version).first<{model_json: string}>();
    if (model && model.model_json !== modelJson) throw new Error('pmf_model_mismatch');
    const checklist = pmfChecklist(result);
    const snapshot = { uid, project_id: projectId, value: result.value, band: result.band, confidence: result.confidence,
      coverage: result.coverage.applies ? result.coverage.present / result.coverage.applies : 0,
      inputs_json: JSON.stringify({ facts: collected.inputs, result, pivot_at: collected.pivot_at }), inputs_hash: hash,
      model_version: result.model, trigger, computed_by: userId, computed_at: at };
    const signature = await signatureFor(env, snapshot);
    // The latest-hash test is in the INSERT itself, so two identical reads create one snapshot.
    // Dependent inserts key off this request's uid, keeping snapshot, checklist and audit atomic.
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO scoring_model_versions (scope,version,model_json,published_at) VALUES ('pmf',?,?,?)")
        .bind(PMF_MODEL_V1.version, modelJson, PMF_MODEL_V1.published),
      env.DB.prepare("INSERT INTO venture_scorecards (uid,project_id,scope,value,band,confidence,coverage,inputs_json,inputs_hash,signature,model_version,trigger,computed_by,computed_at) SELECT ?,?,'pmf',?,?,?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT inputs_hash FROM venture_scorecards WHERE project_id = ? AND scope = 'pmf' ORDER BY id DESC LIMIT 1),'') <> ?")
        .bind(uid, projectId, result.value, result.band, result.confidence, result.coverage.applies ? result.coverage.present / result.coverage.applies : 0,
          snapshot.inputs_json, hash, signature, result.model, trigger, userId, at, projectId, hash),
      ...READINESS_ITEMS.map((item, position) => env.DB.prepare("INSERT OR IGNORE INTO readiness_items (project_id,item_key,label,position) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM venture_scorecards WHERE uid = ?)").bind(projectId, item.key, item.label, position, uid)),
      env.DB.prepare("INSERT INTO readiness_scores (item_id,project_id,score,evidence,missing,source,scored_by,scored_at) SELECT i.id,?,?,?,?, 'computed',?,? FROM readiness_items i WHERE i.project_id = ? AND i.item_key = 'pmf' AND EXISTS (SELECT 1 FROM venture_scorecards WHERE uid = ?)")
        .bind(projectId, checklist.score, checklist.evidence, checklist.missing, userId, at, projectId, uid),
      env.DB.prepare("INSERT INTO activity_logs (project_id,user_id,entity_type,entity_id,action,details,actor) SELECT ?,?,'raise.fundraising-readiness','pmf','pmf_recomputed',?,? WHERE EXISTS (SELECT 1 FROM venture_scorecards WHERE uid = ?)")
        .bind(projectId, userId, JSON.stringify({ model_version: result.model, trigger, inputs_hash: hash }), `user:${userId}`, uid),
    ]);
    changed = !!await env.DB.prepare('SELECT 1 AS present FROM venture_scorecards WHERE uid = ?').bind(uid).first();
  }
  const row = await latest(env, projectId);
  if (!row) throw new Error('pmf_snapshot_unreadable');
  return { ...payload(row).result, id: row.id, inputs_hash: row.inputs_hash, computed_at: row.computed_at,
    computed_by: row.computed_by, trigger: row.trigger, changed, pivot_at: payload(row).pivot_at, verdict: collected.verdict };
}
export async function pmfHistory(env: Env, projectId: number, limit = 200, before: number | null = null) {
  const rows = await env.DB.prepare("SELECT * FROM venture_scorecards WHERE project_id = ? AND scope = 'pmf' AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?")
    .bind(projectId, before, before, limit + 1).all<Stored>();
  const page = (rows.results || []).slice(0, limit);
  const items = await Promise.all(page.map(async row => {
    await verify(env, row);
    const result = payload(row).result;
    return { id: row.id, value: result.value, band: result.band, confidence: result.confidence, confidence_word: result.confidence_word,
      coverage: result.coverage, model: row.model_version, trigger: row.trigger, computed_at: row.computed_at };
  }));
  items.reverse();
  return { items, has_more: (rows.results || []).length > limit, next_cursor: (rows.results || []).length > limit ? page.at(-1)!.id : null };
}

/** A stored model as RD4 draws it: every field the method dialog names, or the read refuses it. */
function modelShape(raw: string): PmfModel {
  const m = JSON.parse(raw);
  const pairs = (x: unknown) => Array.isArray(x) && x.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'string');
  const ok = m && typeof m.version === 'string' && typeof m.published === 'string' && typeof m.floor === 'number'
    && pairs(m.confidence) && pairs(m.bands) && m.freshness_days && typeof m.freshness_days.records === 'number' && typeof m.freshness_days.connector === 'number'
    && Array.isArray(m.inputs) && m.inputs.length > 0 && m.inputs.every((i: any) => i && typeof i.key === 'string' && typeof i.label === 'string'
      && typeof i.weight === 'number' && typeof i.reads === 'string' && typeof i.module === 'string' && (i.freshness === 'records' || i.freshness === 'connector'));
  if (!ok) throw new Error('pmf_model_unreadable');
  return m as PmfModel;
}

/**
 * D1146 (#3032): the model RD4 draws, from `scoring_model_versions`. It is the
 * version this venture's latest stored point was scored with, or, before any
 * point, the version the code scores with. That version is stored with the
 * first score (D1144), so before it the read says `stored: false` and answers
 * the code's own definition, which the first score will publish unchanged. A
 * point whose model row is missing, or a row RD4 cannot draw, is unreadable,
 * never the code's copy in its place.
 */
export async function pmfModelRead(env: Env, projectId: number) {
  const last = await env.DB.prepare("SELECT model_version FROM venture_scorecards WHERE project_id = ? AND scope = 'pmf' ORDER BY id DESC LIMIT 1")
    .bind(projectId).first<{ model_version: string }>();
  const version = last?.model_version ?? PMF_MODEL_V1.version;
  const row = await env.DB.prepare("SELECT version, model_json, published_at FROM scoring_model_versions WHERE scope = 'pmf' AND version = ?")
    .bind(version).first<{ version: string; model_json: string; published_at: string }>();
  if (!row) {
    if (last) throw new Error('pmf_model_missing');
    return { version, stored: false, scored_with: false, published_at: null, model: PMF_MODEL_V1, grades: GRADES };
  }
  return { version: row.version, stored: true, scored_with: !!last, published_at: row.published_at, model: modelShape(row.model_json), grades: GRADES };
}

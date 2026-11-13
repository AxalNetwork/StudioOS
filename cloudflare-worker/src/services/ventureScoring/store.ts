/**
 * D1255 (#3278) — the venture scorecard, recomputed on read and kept only on
 * change, in SCORING's shared store (migration 598; `state` from 625).
 *
 * ONE ROW PER SCOPE PER CHANGE. A recompute collects every scope, scores it
 * with the pure engine, and hashes what the score rests on: the scope's model,
 * its collected facts, which inputs are stale and the stage. A scope whose
 * hash equals its latest row writes nothing; the hash test sits inside the
 * INSERT, so two identical reads write one row (the pattern of `pmfStore.ts`
 * and `verdictHistory.ts`). Every row is signed with the scoring key
 * (`scoreIntegrity.ts` `signHmac`) and verified on every read.
 *
 * Product-market fit is D1143's and is kept by `../scoring/pmfStore.ts`, its
 * one writer: the scorecard asks it to recompute and reads its answer.
 *
 * A scope whose stores could not be read, or that has an unreadable input, is
 * returned as it is and never stored: the last complete row stays.
 *
 * Callers gate the venture first. No client sends a computed field: every
 * figure here is collected by the Worker. No score sets a deal or venture
 * status. Logs and the audit row carry the scope, model, trigger and hash only.
 */
import type { Env } from '../../types';
import { signHmac } from '../scoreIntegrity';
import { recomputePmf, storedPmfInputs } from '../scoring/pmfStore';
import { collectScope, readVenture } from './collectors';
import { scoreScope, type InputFacts, type ScopeResult } from './engine';
import { DEFAULT_MODEL_VERSION, SCORED_SCOPES, SCOPE_ORDER, VENTURE_MODEL_V1, modelFor, type AnyScopeKey, type ScopeKey, type VentureModel } from './model';

export const TRIGGERS = ['read', 'rescore', 'sync', 'nightly', 'publish'] as const;
export type Trigger = (typeof TRIGGERS)[number];
/** D1256: the jobs' triggers. They run with no person behind them, so they carry no actor. */
export const SYSTEM_TRIGGERS: ReadonlySet<Trigger> = new Set(['sync', 'nightly']);

/** A confidence's word from SCORING's cut-offs; null below the floor. */
export function confidenceWord(confidence: number | null | undefined): 'High' | 'Medium' | 'Low' | null {
  const c = Number(confidence);
  if (!Number.isFinite(c)) return null;
  for (const [cut, word] of VENTURE_MODEL_V1.confidence) if (c >= cut) return word;
  return null;
}

type Row = {
  id: number; uid: string; project_id: number; scope: string; value: number | null; band: string | null;
  confidence: number; coverage: number; inputs_json: string; inputs_hash: string; signature: string;
  model_version: string; trigger: string; computed_by: number | null; computed_at: string; state: string | null;
};

/** Key order cannot manufacture a changed input set. */
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}
async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** What a scope's score rests on. The day is not an input; crossing a freshness window is. */
export async function scopeHash(scope: ScopeKey, facts: readonly InputFacts[], result: ScopeResult, model: VentureModel = VENTURE_MODEL_V1): Promise<string> {
  return sha256(JSON.stringify(canonical({
    model: { version: model.version, floor: model.floor, freshness: model.freshness_days, scope: model.scopes[scope] },
    facts, state: result.state, stale: result.inputs.map((i) => ({ key: i.key, stale: i.stale })),
  })));
}

async function signatureFor(env: Env, row: Omit<Row, 'id' | 'signature'>): Promise<string> {
  const { project_id, scope, uid, value, band, confidence, coverage, inputs_json, inputs_hash, model_version, trigger, computed_by, computed_at, state } = row;
  return signHmac(env, 'venture-scorecard:' + JSON.stringify(canonical({
    project_id, scope, uid, value, band, confidence, coverage, inputs_json, inputs_hash, model_version, trigger, computed_by, computed_at, state,
  })));
}

/** A row whose signature does not verify is unreadable, never shown. */
async function verify(env: Env, row: Row): Promise<void> {
  const expected = await signatureFor(env, row);
  if (!/^[a-f0-9]{64}$/.test(row.signature)) throw new Error('scorecard_unreadable');
  let different = 0;
  for (let i = 0; i < expected.length; i++) different |= expected.charCodeAt(i) ^ row.signature.charCodeAt(i);
  if (different) throw new Error('scorecard_unreadable');
}

const LATEST = 'SELECT * FROM venture_scorecards WHERE project_id = ? AND scope = ? ORDER BY id DESC LIMIT 1';
const INSERT = `INSERT INTO venture_scorecards
    (uid, project_id, scope, value, band, confidence, coverage, inputs_json, inputs_hash, signature, model_version, trigger, computed_by, computed_at, state)
  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  WHERE COALESCE((SELECT inputs_hash FROM venture_scorecards WHERE project_id = ? AND scope = ? ORDER BY id DESC LIMIT 1), '') <> ?`;
const MODEL = 'INSERT OR IGNORE INTO scoring_model_versions (scope, version, model_json, published_at) VALUES (?, ?, ?, ?)';
const AUDIT = `INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor)
  SELECT ?, ?, 'venture.scorecard', ?, 'venture_score_recomputed', ?, ? WHERE EXISTS (SELECT 1 FROM venture_scorecards WHERE uid = ?)`;

/** The scope's model as stored with its first row. A stored copy that differs is refused: versions are frozen. */
function modelJson(scope: ScopeKey, m: VentureModel): string {
  return JSON.stringify(canonical({ version: m.version, published: m.published, floor: m.floor, confidence: m.confidence, bands: m.bands,
    freshness_days: m.freshness_days, scope: m.scopes[scope] }));
}

export type ScopeAnswer = (ScopeResult | { scope: 'pmf'; state: string; value: number | null; band: string | null; confidence: number;
  confidence_word: string | null; coverage: { present: number; applies: number }; partial: boolean; reason: string | null; inputs: unknown[]; model: string })
  & { changed: boolean; computed_at: string | null };

/** Keeps one scope's result if it changed. Returns whether a row was written. */
async function keep(env: Env, projectId: number, result: ScopeResult, hash: string, trigger: Trigger, actorId: number | null, model: VentureModel): Promise<{ changed: boolean; computed_at: string }> {
  const scope = result.scope;
  const stored = await env.DB.prepare("SELECT model_json FROM scoring_model_versions WHERE scope = ? AND version = ?")
    .bind(scope, model.version).first<{ model_json: string }>();
  const json = modelJson(scope, model);
  if (stored && stored.model_json !== json) throw new Error('scorecard_model_mismatch');
  const uid = crypto.randomUUID();
  const at = new Date().toISOString();
  const row = {
    uid, project_id: projectId, scope, value: result.value, band: result.band, confidence: result.confidence,
    coverage: result.coverage.applies ? result.coverage.present / result.coverage.applies : 0,
    inputs_json: JSON.stringify({ result }), inputs_hash: hash, model_version: result.model, trigger, computed_by: actorId, computed_at: at,
    state: result.state === 'not_expected' ? 'not_expected' : result.state === 'scored' ? 'scored' : 'not_enough',
  };
  const signature = await signatureFor(env, row);
  await env.DB.batch([
    env.DB.prepare(MODEL).bind(scope, model.version, json, model.published),
    env.DB.prepare(INSERT).bind(uid, projectId, scope, row.value, row.band, row.confidence, row.coverage, row.inputs_json, hash, signature,
      row.model_version, trigger, actorId, at, row.state, projectId, scope, hash),
    env.DB.prepare(AUDIT).bind(projectId, actorId, scope, JSON.stringify({ scope, model_version: row.model_version, trigger, inputs_hash: hash }),
      actorId == null ? `system:${trigger}` : `user:${actorId}`, uid),
  ]);
  const changed = !!await env.DB.prepare('SELECT 1 AS present FROM venture_scorecards WHERE uid = ?').bind(uid).first();
  return { changed, computed_at: at };
}

/**
 * D1259: the live model is the latest version a Super Admin published
 * (`venture_model_publications`, migration 627); before any publication it is
 * v1, as D1255 shipped it. A read that fails throws: scoring on a guessed
 * version would write rows the live model never computed.
 */
export async function liveModel(env: Env): Promise<VentureModel> {
  const row = await env.DB.prepare('SELECT version FROM venture_model_publications ORDER BY id DESC LIMIT 1').first<{ version: string }>();
  const model = modelFor(row?.version ?? DEFAULT_MODEL_VERSION);
  if (!model) throw new Error('scorecard_model_unknown');
  return model;
}

/**
 * Recomputes every scope for one venture and keeps each that changed.
 * `actorId` is the signed-in person whose read or Re-score asked for it.
 * D1256: the nightly and post-sync jobs pass `null`; their rows carry no
 * actor and their audit names `system:<trigger>`. A job leaves Product-market
 * fit to its own writer (`recomputePmf` needs a person) and answers its stored row.
 */
export async function scoreVenture(env: Env, projectId: number, opts: { actorId: number | null; trigger: Trigger; today: string }) {
  const { actorId, trigger, today } = opts;
  const system = actorId === null;
  if (!Number.isSafeInteger(projectId) || projectId < 1
    || (system ? !SYSTEM_TRIGGERS.has(trigger) : !Number.isSafeInteger(actorId) || (actorId as number) < 1 || SYSTEM_TRIGGERS.has(trigger))
    || !(TRIGGERS as readonly string[]).includes(trigger) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('invalid_scorecard_context');
  const venture = await readVenture(env, projectId);
  if (!venture) throw new Error('venture_not_found');
  const model = await liveModel(env);
  const answers = new Map<AnyScopeKey, ScopeAnswer>();
  for (const scope of SCORED_SCOPES) {
    let facts: InputFacts[];
    try {
      facts = await collectScope(env, scope, projectId, venture, today, model);
    } catch {
      console.warn(`[ventureScoring] scope unreadable scope=${scope}`);
      answers.set(scope, { scope, model: model.version, state: 'unreadable', value: null, band: null, confidence: 0, confidence_word: null,
        coverage: { present: 0, applies: 0 }, partial: true, reason: 'Could not be read', inputs: [], changed: false, computed_at: null });
      continue;
    }
    const result = scoreScope(scope, facts, today, { stage: venture.stage, model });
    if (result.partial) { answers.set(scope, { ...result, changed: false, computed_at: null }); continue; }
    const kept = await keep(env, projectId, result, await scopeHash(scope, facts, result, model), trigger, actorId, model);
    answers.set(scope, { ...result, ...kept });
  }
  if (system) {
    try {
      const stored = (await storedScorecard(env, projectId)).find((r) => r.scope === 'pmf')!;
      answers.set('pmf', stored.state === 'not_read'
        ? { scope: 'pmf', model: '1.0', state: 'not_enough', value: null, band: null, confidence: 0, confidence_word: null,
          coverage: { present: 0, applies: 0 }, partial: false, reason: 'Not scored yet', inputs: [], changed: false, computed_at: null }
        : { scope: 'pmf', model: stored.model ?? '1.0', state: stored.state, value: stored.value ?? null, band: stored.band ?? null,
          confidence: stored.confidence ?? 0, confidence_word: stored.confidence_word ?? null, coverage: { present: 0, applies: 0 },
          partial: false, reason: stored.state === 'scored' ? null : 'Not enough recorded', inputs: [], changed: false, computed_at: stored.computed_at ?? null });
    } catch {
      answers.set('pmf', { scope: 'pmf', model: '1.0', state: 'unreadable', value: null, band: null, confidence: 0, confidence_word: null,
        coverage: { present: 0, applies: 0 }, partial: true, reason: 'Could not be read', inputs: [], changed: false, computed_at: null });
    }
    return { model: model.version, stage: venture.stage, scopes: SCOPE_ORDER.map((k) => answers.get(k)!) };
  }
  try {
    const pmf = await recomputePmf(env, projectId, actorId as number, trigger === 'rescore' || trigger === 'publish' ? 'rescore' : 'module_read', today);
    answers.set('pmf', 'inputs' in pmf
      ? { scope: 'pmf', model: pmf.model, state: pmf.state, value: pmf.value, band: pmf.band, confidence: pmf.confidence, confidence_word: pmf.confidence_word,
        coverage: pmf.coverage, partial: Boolean((pmf as { partial?: boolean }).partial), reason: pmf.state === 'scored' ? null : 'Not enough recorded',
        inputs: pmf.inputs, changed: Boolean(pmf.changed), computed_at: pmf.computed_at ?? null }
      : { scope: 'pmf', model: '1.0', state: 'unreadable', value: null, band: null, confidence: 0, confidence_word: null, coverage: { present: 0, applies: 0 },
        partial: true, reason: pmf.reason, inputs: [], changed: false, computed_at: null });
  } catch {
    console.warn('[ventureScoring] scope unreadable scope=pmf');
    answers.set('pmf', { scope: 'pmf', model: '1.0', state: 'unreadable', value: null, band: null, confidence: 0, confidence_word: null,
      coverage: { present: 0, applies: 0 }, partial: true, reason: 'Could not be read', inputs: [], changed: false, computed_at: null });
  }
  return { model: model.version, stage: venture.stage, scopes: SCOPE_ORDER.map((k) => answers.get(k)!) };
}

export type StoredScope = {
  scope: AnyScopeKey; state: 'not_read' | 'scored' | 'not_enough' | 'not_expected' | string;
  value?: number | null; band?: string | null; confidence?: number; confidence_word?: 'High' | 'Medium' | 'Low' | null;
  coverage?: number; model?: string; computed_at?: string; uid?: string;
  /** With `{ inputs: true }`: the stored result's inputs, verified. */
  inputs?: unknown[];
};

/**
 * The latest stored row of each scope, verified, without recomputing. Part 3's
 * reads build on this (D1256): `{ inputs: true }` adds each scope's stored
 * inputs, read from the signed row (PMF's through `storedPmfInputs`, which
 * verifies its own). A row that does not verify throws `scorecard_unreadable`.
 */
export async function storedScorecard(env: Env, projectId: number, opts: { inputs?: boolean } = {}): Promise<StoredScope[]> {
  const out: StoredScope[] = [];
  for (const scope of SCOPE_ORDER) {
    const row = await env.DB.prepare(LATEST).bind(projectId, scope).first<Row>();
    if (!row) { out.push({ scope, state: 'not_read' as const }); continue; }
    const base = { scope, value: row.value, band: row.band, confidence: row.confidence, confidence_word: confidenceWord(row.confidence),
      coverage: row.coverage, model: row.model_version, computed_at: row.computed_at, uid: row.uid };
    if (scope === 'pmf') {
      // D1144's rows are signed by pmfStore; it verifies its own on read.
      const entry: StoredScope = { ...base, state: row.value == null ? 'not_enough' : 'scored' };
      if (opts.inputs) entry.inputs = (await storedPmfInputs(env, projectId))?.inputs ?? [];
      out.push(entry);
      continue;
    }
    await verify(env, row);
    const entry: StoredScope = { ...base, state: row.state ?? (row.value == null ? 'not_enough' : 'scored') };
    if (opts.inputs) {
      const parsed = JSON.parse(row.inputs_json) as { result?: ScopeResult };
      entry.inputs = Array.isArray(parsed?.result?.inputs) ? parsed.result!.inputs : [];
    }
    out.push(entry);
  }
  return out;
}

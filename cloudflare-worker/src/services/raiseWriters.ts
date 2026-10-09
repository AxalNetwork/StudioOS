/**
 * D663 — the one writer for each Raise record migration 442 added.
 *
 * Each writer validates its values against a fixed list and binds every one
 * of them. None decides who may write: `routes/cycle_raise.ts` checks
 * `canWrite` on the project first. Every write records its actor in
 * `activity_logs`, so a write an admin makes on a founder's venture is never
 * silent; the readiness score and the narrative version also carry the actor
 * on their own row (`scored_by`, `updated_by`).
 */
import type { Env } from '../types';
import { WriterError, isoDateOrNull } from './validateWriters';
import { ensureSpinoutDeckOverridesSchema } from './decks/spinoutDeckOverrides';
import {
  READINESS_ITEMS, READINESS_KEYS, EVIDENCE, INVESTOR_TYPES, VERSION_MARKER_KEY, CHECKLIST_KEYS,
  computeReadiness, checkInputs, consistencyCheck, type Mismatch,
} from './raiseCycle';

export { WriterError };

const trimOrNull = (v: unknown, max = 500): string | null => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

async function recordActor(env: Env, userId: number, projectId: number, action: string, details: string) {
  await env.DB.prepare(
    `INSERT INTO activity_logs (action, details, actor, user_id, project_id) VALUES (?, ?, ?, ?, ?)`,
  ).bind(action, details.slice(0, 500), `user:${userId}`, userId, projectId).run();
}

/** Create the project's seven readiness items if they are missing; returns key → item id. */
export async function ensureReadinessItems(env: Env, projectId: number): Promise<Map<string, number>> {
  for (const [i, item] of READINESS_ITEMS.entries()) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO readiness_items (project_id, item_key, label, position) VALUES (?, ?, ?, ?)`,
    ).bind(projectId, item.key, item.label, i).run();
  }
  const res = await env.DB.prepare('SELECT id, item_key FROM readiness_items WHERE project_id = ?')
    .bind(projectId).all<{ id: number; item_key: string }>();
  return new Map((res.results || []).map((r) => [r.item_key, Number(r.id)]));
}

/** A person's score for one readiness item. */
export async function scoreReadinessItem(env: Env, a: {
  projectId: number; userId: number; key: unknown; score: unknown; evidence: unknown; missing: unknown;
}): Promise<{ ok: true }> {
  const key = String(a.key ?? '');
  if (!READINESS_KEYS.includes(key)) throw new WriterError(400, 'Unknown readiness item');
  const score = Number(a.score);
  if (!Number.isInteger(score) || score < 0 || score > 10) throw new WriterError(400, 'The score is a whole number from 0 to 10');
  const evidence = String(a.evidence ?? '');
  if (!(EVIDENCE as readonly string[]).includes(evidence)) throw new WriterError(400, 'Evidence is anecdote, pattern or measured');
  const ids = await ensureReadinessItems(env, a.projectId);
  await env.DB.prepare(
    `INSERT INTO readiness_scores (item_id, project_id, score, evidence, missing, source, scored_by) VALUES (?, ?, ?, ?, ?, 'manual', ?)`,
  ).bind(ids.get(key), a.projectId, score, evidence, trimOrNull(a.missing), a.userId).run();
  await recordActor(env, a.userId, a.projectId, 'raise.readiness.scored', `${key}: ${score}/10 (${evidence})`);
  return { ok: true };
}

/** Run every computed readiness check and store what it found. */
export async function rescoreReadiness(env: Env, a: { projectId: number; userId: number }): Promise<{ scored: number }> {
  const ids = await ensureReadinessItems(env, a.projectId);
  const computed = await computeReadiness(env, a.projectId);
  for (const c of computed) {
    await env.DB.prepare(
      `INSERT INTO readiness_scores (item_id, project_id, score, evidence, missing, source, scored_by) VALUES (?, ?, ?, ?, ?, 'computed', ?)`,
    ).bind(ids.get(c.key), a.projectId, c.score, c.evidence, c.missing, a.userId).run();
  }
  await recordActor(env, a.userId, a.projectId, 'raise.readiness.rescored', `${computed.length} computed checks`);
  return { scored: computed.length };
}

/**
 * Save the live deck wording (version 0) as narrative version N for an
 * investor type, with the deck version it goes with, then run the
 * consistency check on it and store every mismatch.
 */
export async function saveNarrativeVersion(env: Env, a: { projectId: number; userId: number; investorType: unknown }): Promise<{ version: number; mismatches: Mismatch[] }> {
  const investorType = String(a.investorType ?? '');
  if (!(INVESTOR_TYPES as readonly string[]).includes(investorType)) throw new WriterError(400, 'Unknown investor type');
  await ensureSpinoutDeckOverridesSchema(env);
  const max = await env.DB.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM spinout_deck_overrides WHERE project_id = ?')
    .bind(a.projectId).first<{ v: number }>();
  const version = Number(max?.v ?? 0) + 1;
  const deck = await env.DB.prepare(
    'SELECT version FROM pitch_decks WHERE project_id = ? ORDER BY COALESCE(is_current, 0) DESC, version DESC, id DESC LIMIT 1',
  ).bind(a.projectId).first<{ version: number }>();
  const deckVersion = deck ? Number(deck.version) : null;
  await env.DB.prepare(
    `INSERT INTO spinout_deck_overrides (project_id, field_key, value, updated_by, updated_at, version, investor_type, deck_version)
     SELECT project_id, field_key, value, ?, datetime('now'), ?, ?, ? FROM spinout_deck_overrides
      WHERE project_id = ? AND version = 0`,
  ).bind(a.userId, version, investorType, deckVersion, a.projectId).run();
  // The marker row: a version saved before any wording was overridden still exists.
  await env.DB.prepare(
    `INSERT INTO spinout_deck_overrides (project_id, field_key, value, updated_by, updated_at, version, investor_type, deck_version)
     VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?)`,
  ).bind(a.projectId, VERSION_MARKER_KEY, investorType, a.userId, version, investorType, deckVersion).run();
  const { stated, metrics } = await checkInputs(env, a.projectId, version);
  const mismatches = consistencyCheck(stated, metrics);
  for (const m of mismatches) {
    await env.DB.prepare(
      `INSERT INTO narrative_checks (project_id, version, figure, stated_value, stated_source, metric_value, metric_source) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(a.projectId, version, m.figure, m.stated_value, m.stated_source, m.metric_value, m.metric_source).run();
  }
  await recordActor(env, a.userId, a.projectId, 'raise.narrative.saved', `v${version} for ${investorType}; ${mismatches.length} mismatches`);
  return { version, mismatches };
}

/** Which diligence-checklist item a data-room file answers; null clears it. */
export async function setFileChecklistItem(env: Env, a: { projectId: number; userId: number; fileId: number; item: unknown }): Promise<{ ok: true }> {
  const item = a.item == null || a.item === '' ? null : String(a.item);
  if (item != null && !CHECKLIST_KEYS.has(item)) throw new WriterError(400, 'Unknown checklist item');
  const r = await env.DB.prepare(
    `UPDATE data_room_files SET checklist_item = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`,
  ).bind(item, a.fileId, a.projectId).run();
  if (!Number(r?.meta?.changes ?? 0)) throw new WriterError(404, 'File not found');
  await recordActor(env, a.userId, a.projectId, 'raise.data_room.checklist', `file ${a.fileId}: ${item ?? 'cleared'}`);
  return { ok: true };
}

/** A prospect's next step, when it is due, and its warm path. Each may be cleared with an empty value. */
export async function setProspectNextStep(env: Env, a: {
  projectId: number; userId: number; prospectId: number; next_step: unknown; next_step_due: unknown; warm_path: unknown;
}): Promise<{ ok: true }> {
  const due = a.next_step_due == null || a.next_step_due === '' ? null : isoDateOrNull(a.next_step_due);
  if (a.next_step_due != null && a.next_step_due !== '' && due == null) throw new WriterError(400, 'The due date is YYYY-MM-DD');
  const r = await env.DB.prepare(
    `UPDATE raise_prospects SET next_step = ?, next_step_due = ?, warm_path = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`,
  ).bind(trimOrNull(a.next_step, 300), due, trimOrNull(a.warm_path, 300), a.prospectId, a.projectId).run();
  if (!Number(r?.meta?.changes ?? 0)) throw new WriterError(404, 'Prospect not found');
  await recordActor(env, a.userId, a.projectId, 'raise.prospect.next_step', `prospect ${a.prospectId}`);
  return { ok: true };
}

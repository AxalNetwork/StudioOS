/** D5829: survey answers propose; only an explicit founder decision creates evidence. */
import type { Env } from '../../types';
import { WriterError, writeDemandSignal, evidenceStatements, EVIDENCE_STRENGTHS } from '../validateWriters';
import { logCycleWriteStatement } from '../cycleActivity';
import { mappingSignature } from './signature';
import { ledgerKey } from './importer';

export interface ReviewScope { projectId: number; integrationId: number; userId: number }
const positive = (x: unknown) => Number.isSafeInteger(Number(x)) && Number(x) > 0;

async function target(env: Env, projectId: number, hypothesisId: number, experimentId: number | null) {
  const h = await env.DB.prepare('SELECT id FROM hypotheses WHERE id = ? AND project_id = ?').bind(hypothesisId, projectId).first();
  const e = experimentId == null || await env.DB.prepare('SELECT id FROM hypothesis_experiments WHERE id = ? AND hypothesis_id = ? AND project_id = ?')
    .bind(experimentId, hypothesisId, projectId).first();
  if (!h || !e) throw new WriterError(404, 'That hypothesis or experiment is not on this venture');
}

/** Append a version; do not silently retarget already reviewed evidence. */
export async function mapTypeformEvidence(env: Env, scope: ReviewScope, input: {
  field_mapping_id: unknown; hypothesis_id: unknown; experiment_id?: unknown; direction?: unknown; strength?: unknown;
}) {
  const fid = Number(input.field_mapping_id); const hid = Number(input.hypothesis_id);
  const eid = input.experiment_id == null ? null : Number(input.experiment_id);
  if (!positive(fid) || !positive(hid) || (eid != null && !positive(eid))) throw new WriterError(400, 'Choose the mapped question and a hypothesis');
  const dir = input.direction ?? 'supports'; const strength = input.strength ?? null;
  if (!['supports', 'contradicts'].includes(String(dir)) || (strength != null && !(EVIDENCE_STRENGTHS as readonly unknown[]).includes(strength))) {
    throw new WriterError(400, 'Choose a direction and an optional evidence strength');
  }
  await target(env, scope.projectId, hid, eid);
  const field = await env.DB.prepare(`SELECT m.* FROM typeform_field_mappings m JOIN typeform_form_syncs s ON s.id = m.sync_id
    WHERE m.id = ? AND s.project_id = ? AND s.integration_id = ? AND s.status = 'active' AND m.status = 'active'`)
    .bind(fid, scope.projectId, scope.integrationId).first<any>();
  if (!field) throw new WriterError(404, 'That mapped question is not available on this venture');
  const signature = mappingSignature(field);
  const old = await env.DB.prepare('SELECT * FROM typeform_evidence_mappings WHERE field_mapping_id = ? ORDER BY version DESC LIMIT 1').bind(fid).first<any>();
  if (old && old.mapping_signature === signature && old.hypothesis_id === hid && old.experiment_id === eid && old.direction === dir && old.strength === strength) return { id: old.id, version: old.version };
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO typeform_evidence_mappings
      (project_id, integration_id, field_mapping_id, mapping_signature, version, hypothesis_id, experiment_id, direction, strength, created_by)
      SELECT ?, ?, ?, ?, COALESCE(MAX(version), 0) + 1, ?, ?, ?, ?, ? FROM typeform_evidence_mappings WHERE field_mapping_id = ? RETURNING id, version`)
      .bind(scope.projectId, scope.integrationId, fid, signature, hid, eid, dir, strength, scope.userId, fid),
    logCycleWriteStatement(env, { projectId: scope.projectId, userId: scope.userId, cycle: 'validate', module: 'experiments', entityId: hid, action: 'typeform_mapping_set', summary: 'Typeform evidence mapping set' }),
  ]);
  return result[0].results?.[0];
}

/** Bounded explicit preparation, not a GET side effect. Internal source keys recover an interrupted write. */
export async function prepareTypeformReviews(env: Env, scope: ReviewScope) {
  const answers = (await env.DB.prepare(`SELECT a.id, a.mapping_signature, a.field_id, r.response_id, r.submitted_at, s.form_id,
      m.kind, m.field_type, m.rule_json, m.keep_text, e.id AS evidence_mapping_id, e.version
    FROM typeform_answers a JOIN typeform_responses r ON r.id = a.response_row_id
      JOIN typeform_form_syncs s ON s.id = r.sync_id JOIN typeform_field_mappings m ON m.id = a.mapping_id
      JOIN typeform_evidence_mappings e ON e.field_mapping_id = m.id
    WHERE s.project_id = ? AND s.integration_id = ? AND s.status = 'active' AND r.status = 'active' AND r.response_type = 'completed'
      AND m.status = 'active' AND a.mapping_signature IS NOT NULL AND a.mapping_signature = e.mapping_signature
      AND e.version = (SELECT MAX(v.version) FROM typeform_evidence_mappings v WHERE v.field_mapping_id = m.id)
      AND NOT EXISTS (SELECT 1 FROM typeform_reviews q WHERE q.project_id = s.project_id AND q.integration_id = s.integration_id
        AND q.source_key = 'typeform:' || s.form_id || ':' || s.project_id || ':' || r.response_id || ':' || a.field_id)
    ORDER BY a.id LIMIT 100`).bind(scope.projectId, scope.integrationId).all<any>()).results || [];
  let proposed = 0;
  for (const a of answers) {
    const sig = mappingSignature(a);
    const mapping = await env.DB.prepare('SELECT * FROM typeform_evidence_mappings WHERE id = ? AND project_id = ? AND integration_id = ?')
      .bind(a.evidence_mapping_id, scope.projectId, scope.integrationId).first<any>();
    if (!a.mapping_signature || a.mapping_signature !== sig || !mapping || mapping.mapping_signature !== sig) continue;
    await target(env, scope.projectId, mapping.hypothesis_id, mapping.experiment_id);
    const source = ledgerKey(a.form_id, scope.projectId, a.response_id, a.field_id);
    const signal = await writeDemandSignal(env, { projectId: scope.projectId, userId: scope.userId, kind: a.kind,
      source_kind: 'typeform', sourceTypeformKey: source, status: 'to_confirm', signal_date: a.submitted_at?.slice(0, 10) });
    const res = await env.DB.prepare(`INSERT INTO typeform_reviews
      (project_id, integration_id, source_key, evidence_mapping_id, mapping_version, answer_id, signal_id)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, integration_id, source_key) DO NOTHING`)
      .bind(scope.projectId, scope.integrationId, source, mapping.id, mapping.version, a.id, signal.id).run();
    proposed += Number(res.meta?.changes ?? 0);
  }
  return { proposed };
}

const reviewOf = (env: Env, scope: ReviewScope, id: number) => env.DB.prepare(
  'SELECT * FROM typeform_reviews WHERE id = ? AND project_id = ? AND integration_id = ?',
).bind(id, scope.projectId, scope.integrationId).first<any>();

export async function decideTypeformReview(env: Env, scope: ReviewScope, id: number, action: 'confirm' | 'dismiss' | 'unlink') {
  const review = await reviewOf(env, scope, id);
  if (!review) throw new WriterError(404, 'That review is not on this venture');
  if (action === 'confirm') {
    if (review.status === 'confirmed') return { status: 'confirmed' };
    if (review.status !== 'pending') throw new WriterError(409, 'This source has already been removed');
    const mapping = await env.DB.prepare('SELECT * FROM typeform_evidence_mappings WHERE id = ? AND project_id = ? AND integration_id = ?')
      .bind(review.evidence_mapping_id, scope.projectId, scope.integrationId).first<any>();
    if (!mapping) throw new WriterError(409, 'Map this question again before reviewing it');
    await target(env, scope.projectId, mapping.hypothesis_id, mapping.experiment_id);
    const stmts = await evidenceStatements(env, { projectId: scope.projectId, userId: scope.userId, hypothesisId: mapping.hypothesis_id,
      kind: 'signal', ref_id: `signal-${review.signal_id}`, direction: mapping.direction, strength: mapping.strength });
    // The database guard rechecks source ownership/liveness and the pending decision INSIDE this batch.
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE typeform_reviews SET status = 'confirmed', decided_by = ?, decided_at = datetime('now') WHERE id = ?")
          .bind(scope.userId, id),
        env.DB.prepare("UPDATE demand_signals SET status = 'confirmed' WHERE id = ? AND project_id = ?").bind(review.signal_id, scope.projectId),
        ...stmts,
      ]);
    } catch (e) {
      // Concurrent confirmation is the same decision. Other failures still propagate for retry.
      if (!String((e as Error)?.message).includes('typeform_reviews.status:')) throw e;
      if ((await reviewOf(env, scope, id))?.status === 'confirmed') return { status: 'confirmed' };
      throw new WriterError(409, 'This source or mapping is no longer reviewable');
    }
    return { status: 'confirmed' };
  }
  const status = action === 'unlink' ? 'unlinked' : 'dismissed';
  if (review.status === 'withdrawn' || review.status === status) return { status: review.status };
  await env.DB.batch([
    env.DB.prepare("DELETE FROM hypothesis_evidence_links WHERE project_id = ? AND kind = 'signal' AND ref_id = ?").bind(scope.projectId, `signal-${review.signal_id}`),
    env.DB.prepare('DELETE FROM demand_signals WHERE id = ? AND project_id = ?').bind(review.signal_id, scope.projectId),
    env.DB.prepare('UPDATE typeform_reviews SET status = ?, signal_id = NULL, decided_by = ?, decided_at = datetime(\'now\') WHERE id = ?')
      .bind(status, scope.userId, id),
    logCycleWriteStatement(env, { projectId: scope.projectId, userId: scope.userId, cycle: 'validate', module: 'experiments', entityId: id, action: 'typeform_review_removed', summary: 'Typeform evidence removed' }),
  ]);
  return { status };
}

/** Private source read; never used as a public quotation or a permission to publish. */
export async function typeformReviews(env: Env, scope: ReviewScope, before = 0) {
  const rows = (await env.DB.prepare(`SELECT q.id, q.status, q.mapping_version, q.source_key, q.signal_id,
      a.answer_text AS private_answer, e.hypothesis_id, e.experiment_id, e.direction, e.strength
    FROM typeform_reviews q LEFT JOIN typeform_answers a ON a.id = q.answer_id
      LEFT JOIN typeform_evidence_mappings e ON e.id = q.evidence_mapping_id
    WHERE q.project_id = ? AND q.integration_id = ? AND (? = 0 OR q.id < ?) ORDER BY q.id DESC LIMIT 100`)
    .bind(scope.projectId, scope.integrationId, before, before).all<any>()).results || [];
  const counts = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM typeform_responses r JOIN typeform_form_syncs s ON s.id = r.sync_id
      WHERE s.project_id = ? AND s.integration_id = ? AND r.response_type = 'completed' AND r.status <> 'provider_deleted') AS completed,
    (SELECT COUNT(*) FROM typeform_answers a JOIN typeform_responses r ON r.id = a.response_row_id JOIN typeform_form_syncs s ON s.id = r.sync_id
      WHERE s.project_id = ? AND s.integration_id = ? AND r.status = 'active' AND r.response_type = 'completed') AS matching_answers,
    (SELECT COUNT(*) FROM typeform_reviews q JOIN demand_signals d ON d.id = q.signal_id
      WHERE q.project_id = ? AND q.integration_id = ? AND q.status = 'confirmed' AND d.status IN ('confirmed', 'counted')) AS confirmed_signals`)
    .bind(scope.projectId, scope.integrationId, scope.projectId, scope.integrationId, scope.projectId, scope.integrationId).first();
  return { rows, counts, next_before: rows.length === 100 ? Number(rows.at(-1).id) : null,
    quote_audience: 'private', publication_permission: 'not_recorded' };
}

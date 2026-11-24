/** D5829: per-form reconciliation, distinct from the venture/connection review totals. */
import type { Env } from '../../types';

export async function typeformReviewCounts(env: Env, projectId: number, integrationId: number) {
  return (await env.DB.prepare(`SELECT s.form_id, s.sync_state,
    (SELECT COUNT(*) FROM typeform_responses r WHERE r.sync_id = s.id
      AND r.response_type = 'completed' AND r.status <> 'provider_deleted') AS completed,
    (SELECT COUNT(*) FROM typeform_answers a JOIN typeform_responses r ON r.id = a.response_row_id
      WHERE r.sync_id = s.id AND r.response_type = 'completed' AND r.status = 'active') AS matching_answers,
    (SELECT COUNT(*) FROM typeform_reviews q JOIN demand_signals d ON d.id = q.signal_id
      JOIN typeform_answers a ON a.id = q.answer_id JOIN typeform_responses r ON r.id = a.response_row_id
      WHERE r.sync_id = s.id AND q.project_id = s.project_id AND q.integration_id = s.integration_id
        AND q.status = 'confirmed' AND d.status IN ('confirmed', 'counted')) AS confirmed_signals
    FROM typeform_form_syncs s WHERE s.project_id = ? AND s.integration_id = ? ORDER BY s.form_id`)
    .bind(projectId, integrationId).all()).results || [];
}

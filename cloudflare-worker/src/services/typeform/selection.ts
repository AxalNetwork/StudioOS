/**
 * D5828 part 2 (#5828) — the importer's sync row follows the venture's one
 * Typeform binding (#5827). The binding is the only selection: this file
 * never chooses a form, it only brings `typeform_form_syncs` into step.
 *
 *   binding (integration, venture, form)  ->  that sync row is `active`
 *                                              (created if new, reactivated
 *                                              with its checkpoint if the
 *                                              same form is chosen again)
 *   every other sync row of the venture   ->  `stopped`, rows kept: its
 *                                              responses, answers, ledger and
 *                                              counts stay per form (D5829)
 *
 * Every write reads the binding inside its own statement, all in one D1
 * batch, so a binding changed between them cannot leave two active rows.
 * The two stores stay apart: the binding holds the choice and its access
 * check, the sync row holds checkpoints, leases and outcomes.
 */
import type { Env } from '../../types';

export interface SelectedSync { syncId: number; integrationId: number; projectId: number; formId: string }

/** Bring the venture's sync rows in step with its binding; the selected row, or null when nothing is bound. */
export async function followTypeformBinding(env: Env, projectId: number): Promise<SelectedSync | null> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO typeform_form_syncs (integration_id, project_id, form_id)
       SELECT b.integration_id, b.project_id, b.form_id FROM typeform_form_bindings b WHERE b.project_id = ?
       ON CONFLICT (integration_id, project_id, form_id) DO NOTHING`,
    ).bind(projectId),
    env.DB.prepare(
      `UPDATE typeform_form_syncs SET status = 'active', updated_at = datetime('now')
        WHERE project_id = ? AND status <> 'active'
          AND EXISTS (SELECT 1 FROM typeform_form_bindings b
                       WHERE b.project_id = typeform_form_syncs.project_id AND b.integration_id = typeform_form_syncs.integration_id
                         AND b.form_id = typeform_form_syncs.form_id)`,
    ).bind(projectId),
    env.DB.prepare(
      `UPDATE typeform_form_syncs SET status = 'stopped', updated_at = datetime('now')
        WHERE project_id = ? AND status = 'active'
          AND NOT EXISTS (SELECT 1 FROM typeform_form_bindings b
                           WHERE b.project_id = typeform_form_syncs.project_id AND b.integration_id = typeform_form_syncs.integration_id
                             AND b.form_id = typeform_form_syncs.form_id)`,
    ).bind(projectId),
  ]);
  return selectedTypeformSync(env, projectId);
}

/** Read only: the sync row the binding selects, or null when nothing is bound or it has never been followed. */
export async function selectedTypeformSync(env: Env, projectId: number): Promise<SelectedSync | null> {
  const row = await env.DB.prepare(
    `SELECT s.id, s.integration_id, s.project_id, s.form_id FROM typeform_form_bindings b
       JOIN typeform_form_syncs s ON s.integration_id = b.integration_id AND s.project_id = b.project_id AND s.form_id = b.form_id
      WHERE b.project_id = ?`,
  ).bind(projectId).first<{ id: number; integration_id: number; project_id: number; form_id: string }>();
  return row ? { syncId: Number(row.id), integrationId: Number(row.integration_id), projectId: Number(row.project_id), formId: String(row.form_id) } : null;
}

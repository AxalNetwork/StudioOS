import { safeReadJSON, safeWriteJSON } from '../lib/storage';

/**
 * The model a founder picked on the Worker AI rail, per section and per task.
 *
 * PER TASK, because the router's menus are per task: `validate_tag_pains`
 * offers the 3B and `validate_draft_hypotheses` does not (aiRouter.ts says
 * why). One choice per section would send the 3B to a task that refuses it.
 *
 * PER SECTION, not per zone (D402): a founder picks on Validate and every
 * Validate zone follows. The rail writes this and `FillProposals` reads it
 * when its button is pressed, so the choice on the rail is the model the run
 * asks for. The router still checks it against the task's `alternates`, and a
 * refusal clears it.
 */
export const RAIL_MODEL_PREFIX = 'worker_rail_model:';

export const railModelKey = (workspace, task) =>
  `${RAIL_MODEL_PREFIX}${String(workspace || '').toLowerCase().trim()}:${task}`;

/** The stored id, or null. Never a default: the router owns the default. */
export function readRailModel(workspace, task) {
  const id = safeReadJSON(railModelKey(workspace, task), null);
  return typeof id === 'string' && id ? id : null;
}

export function writeRailModel(workspace, task, id) {
  safeWriteJSON(railModelKey(workspace, task), id || null);
}

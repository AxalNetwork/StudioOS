/**
 * D1614 W7 (#3993): a project task's labels, kept in two places that never
 * disagree. `task_label_links` (migration 763) is the record; W1's
 * `scope_tasks.labels_json` is the names' mirror the board reads.
 *
 * W1's own writes still name labels (`labels: ['finance']`). These statements
 * run inside W1's batch, only when that batch's change committed (the row's
 * `work_change_uid`), so a name becomes the project's label, the link follows
 * it, and the mirror is rewritten in the labels' own spelling.
 */
import type { Env } from '../../types';
import { newUid } from '../../routes/_t13t14t15_helpers';

/** Statements that make `names` the task's labels, for a batch whose change is `change`. */
export function labelSyncStatements(env: Env, taskUid: string, projectId: number, names: string[], change: string) {
  return [
    ...names.map((name) => env.DB.prepare(
      `INSERT OR IGNORE INTO task_labels (uid, project_id, name) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM scope_tasks WHERE uid = ? AND work_change_uid = ?)`,
    ).bind(newUid(), projectId, name, taskUid, change)),
    env.DB.prepare(`DELETE FROM task_label_links WHERE task_id = (SELECT id FROM scope_tasks WHERE uid = ?) AND EXISTS (SELECT 1 FROM scope_tasks WHERE uid = ? AND work_change_uid = ?)`).bind(taskUid, taskUid, change),
    env.DB.prepare(
      `INSERT OR IGNORE INTO task_label_links (task_id, label_id)
       SELECT (SELECT id FROM scope_tasks WHERE uid = ?), l.id FROM task_labels l
       WHERE l.project_id = ? AND lower(l.name) IN (SELECT lower(value) FROM json_each(?)) AND EXISTS (SELECT 1 FROM scope_tasks WHERE uid = ? AND work_change_uid = ?)`,
    ).bind(taskUid, projectId, JSON.stringify(names), taskUid, change),
    env.DB.prepare(`UPDATE scope_tasks SET labels_json = (SELECT COALESCE(json_group_array(name), '[]') FROM (
  SELECT l.name FROM task_label_links k JOIN task_labels l ON l.id = k.label_id WHERE k.task_id = scope_tasks.id ORDER BY l.name COLLATE NOCASE)) WHERE uid = ? AND work_change_uid = ?`).bind(taskUid, change),
  ];
}

/**
 * #3850 (E6 of #3742, D1528 §4.4) — the agent engine's tables, for a fixture
 * built from the baseline. A project's move writes to them in its own batch
 * (`projectMoveStatements` → `transferStatements`), so any fixture that moves
 * a project needs them, as production has them. `ai_rail_proposals` and
 * `ai_usage_logs` come first: 712 and 727 alter or reference them.
 * D1614 W8 (#3994): a seat's removal flags its open Work in its own batch, so
 * `scope_tasks.needs_reassignment` (202611022015) is here too.
 */
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { tableFromBaseline } from './_baseline.mjs';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const ENGINE = ['506_ai_rail_proposals', '712_team_agents', '727_scope_goals_and_tasks', '728_agent_engine', '762_scope_task_work_board', '763_task_comments_labels_milestones',
  '202611022015_scope_task_needs_reassignment']
  .map((m) => readFileSync(new URL(`../sql/migrations/${m}.sql`, import.meta.url), 'utf8'));

export function addAgentEngineTables(db: DatabaseSync): void {
  db.exec(tableFromBaseline(BASELINE, 'ai_usage_logs'));
  for (const m of ENGINE) db.exec(m);
}

/** D891: bring older, intentionally narrow Raise fixtures to the deployed provenance schema. */
import { readFileSync } from 'node:fs';
import { tableFromBaseline } from './_baseline.mjs';
import { withGrantFolders } from './_data_room_scope.mjs';
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const sql = (name: string) => readFileSync(new URL('../sql/migrations/' + name, import.meta.url), 'utf8');
export function raiseEvidenceTables(db: any) {
  const exists = (name: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  for (const table of ['data_room_grants', 'pairwise_ndas', 'project_members', 'integrations']) {
    if (!exists(table)) db.exec(tableFromBaseline(baseline, table));
  }
  withGrantFolders(db); // D1103: a grant's folder scope (migration 594), read by every investor gate
  if (!exists('revenue_entries')) db.exec(sql('311_revenue_entries.sql'));
  if (!exists('mercury_raise_facts')) db.exec(sql('520_mercury_raise_feeds.sql'));
  if (exists('readiness_scores')) {
    db.exec(sql('536_readiness_stated_evidence.sql'));
    db.exec(sql('558_readiness_scores_nullable_score.sql'));
  }
}

/**
 * D6654 (#6654) — the record suppression ledger table, for fixtures that build their own schema.
 *
 * `eraseRecordObjects` (services/recordErasure.ts) writes a `record_suppression_ledger` row before it
 * deletes, and deletes nothing when that write fails. A fixture whose database is assembled table by
 * table, and whose flow erases a record file, applies the migration itself with this helper.
 */
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../sql/migrations/', import.meta.url);
const [FILE] = readdirSync(DIR).filter((f) => /^\d{12}_6654_record_suppression_ledger\.sql$/.test(f));

/** The ledger migration's SQL, exactly as committed. */
export const SUPPRESSION_LEDGER_SQL = readFileSync(new URL(FILE, DIR), 'utf8');

/** Apply the ledger migration to a node:sqlite database and return it. */
export function applySuppressionLedger(db) {
  db.exec(SUPPRESSION_LEDGER_SQL);
  return db;
}
